// Administración de usuarios por línea de comandos.
//
// Existe porque el backend NO expone ninguna vía para esto: src/api/auth.js solo
// tiene register (cerrado por ALLOW_REGISTRATION), login, el canje de Cloudflare
// Access y el config público. No hay endpoint de cambio de contraseña, ni de
// listar, ni de borrar; y la vista de Ajustes del cliente solo muestra el usuario
// y el método de acceso, sin acciones.
//
// CÓMO SE CORRE
//   Desarrollo:  npm run users -- list
//   Producción:  docker exec -it <contenedor> node src/admin/users.js list
//
// En producción SIEMPRE por docker exec, nunca desde el host: la DB vive en el
// volumen `musicplayer-data` y solo dentro del contenedor compartimos con el
// servidor el mismo espacio de montaje y, sobre todo, los mismos locks.
//
// POR QUÉ IMPORTA ../db/database.js EN VEZ DE ABRIR SU PROPIA CONEXIÓN
//   1. Resuelve DB_PATH relativo al MÓDULO y no al cwd, así que la misma llamada
//      funciona desde la raíz del repo, desde music-server/ y desde
//      /app/music-server dentro de la imagen.
//   2. `PRAGMA foreign_keys = ON` es POR CONEXIÓN. Con una conexión propia, el
//      DELETE de un usuario NO cascadearía: en vez de borrar sus playlists las
//      dejaría huérfanas, apuntando a un id que ya no existe.
//   Costo aceptado: importarlo corre su bootstrap (los CREATE TABLE IF NOT EXISTS,
//   los PRAGMA y los ALTER TABLE de migración). Es idempotente y es exactamente el
//   mismo camino que recorre el servidor al arrancar.
//
// SQLITE EN WAL, CON EL SERVIDOR VIVO
//   No hace falta parar el contenedor: WAL admite un escritor y N lectores a la
//   vez, y lo que se escribe desde acá dura milisegundos.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import db from '../db/database.js';

// Ni database.js ni el servidor definen uno. Sin esto, si el servidor está
// escribiendo justo en ese instante (crear playlist, agregar canción), nuestra
// consulta aborta al toque con SQLITE_BUSY en vez de esperar su turno.
db.exec('PRAGMA busy_timeout = 5000');

// El MISMO coste que usa el registro (src/api/auth.js). Está duplicado a
// propósito y no importado: hoy en auth.js es un 12 literal, y hoistearlo a un
// módulo compartido obliga a tocar el camino de login, que corre en producción,
// por una herramienta de mantenimiento. Si algún día se unifica, este es el otro
// sitio que hay que mover. Si divergen, las contraseñas puestas acá quedan con
// otra fuerza que las del registro y nadie se entera.
const BCRYPT_ROUNDS = 12;

// bcrypt IGNORA en silencio todo lo que pase de 72 bytes: una contraseña más
// larga se guardaría truncada y el usuario creería tener algo que no tiene.
const MAX_BYTES = 72;
const MIN_LENGTH = 10;

// ---- list ----

// LIMITACIÓN CONOCIDA, para que nadie la busque: esto NO puede distinguir un
// usuario de contraseña de uno creado por Cloudflare Access. upsertUserByEmail()
// guarda un bcrypt REAL de un randomUUID() para cumplir el NOT NULL, así que en la
// tabla los dos se ven idénticos ($2b$12$, 60 caracteres). La única pista es que
// los de SSO tienen un email como username, y es una pista, no un dato.
function list() {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.created_at, COUNT(p.id) AS playlists
    FROM users u
    LEFT JOIN playlists p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id
  `).all();

  if (!rows.length) {
    console.log('[USERS] No hay usuarios en la base.');
    return;
  }

  // El password_hash no se selecciona ni se imprime, ni siquiera truncado: un
  // prefijo de bcrypt no sirve para nada salvo para filtrarse en un log.
  const w = Math.max(8, ...rows.map(r => String(r.username).length));
  console.log(`[USERS] ${rows.length} ${rows.length === 1 ? 'usuario' : 'usuarios'}\n`);
  console.log(`  ${'ID'.padStart(4)}  ${'USUARIO'.padEnd(w)}  ${'CREADO'.padEnd(19)}  PLAYLISTS`);
  for (const r of rows) {
    console.log(
      `  ${String(r.id).padStart(4)}  ${String(r.username).padEnd(w)}  ` +
      `${String(r.created_at ?? '—').padEnd(19)}  ${r.playlists}`,
    );
  }
}

// ---- passwd ----

// 18 bytes → 24 caracteres base64url, ~144 bits. No se tipea nunca: no pasa por el
// historial del shell, ni por `ps`, ni por la pantalla salvo una vez al final.
function generatePassword() {
  return randomBytes(18).toString('base64url');
}

// Sin eco. Lee carácter por carácter en raw mode; itera el chunk porque un pegado
// llega entero en un solo evento 'data' y hay que separarle el Enter.
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buf = '';
    const done = (fn, arg) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      fn(arg);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        // Enter (Unix y Windows) o Ctrl-D: se termina de leer.
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(resolve, buf);
        if (ch === '\u0003') return done(reject, new Error('Cancelado.'));           // Ctrl-C
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }    // borrar
        if (ch >= ' ') buf += ch;   // descarta flechas y demás secuencias de control
      }
    };
    stdin.on('data', onData);
  });
}

async function passwd(username, { generate }) {
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error(`[USERS] No existe el usuario "${username}". Mirá la lista con: users.js list`);
    process.exit(1);
  }

  let password;
  if (generate) {
    password = generatePassword();
  } else {
    // A propósito NO se lee de un pipe: aceptarlo invita al `echo "clave" | ...`
    // que deja la contraseña en el historial, que es justo lo que esto evita.
    if (!process.stdin.isTTY) {
      console.error('[USERS] Sin terminal interactiva. Usá `docker exec -it …` o pasá --generate.');
      process.exit(1);
    }
    password = await promptHidden(`Nueva contraseña para "${user.username}": `);
    const again = await promptHidden('Repetila: ');
    if (password !== again) {
      console.error('[USERS] No coinciden. No se cambió nada.');
      process.exit(1);
    }
    if (password.length < MIN_LENGTH) {
      console.error(`[USERS] Mínimo ${MIN_LENGTH} caracteres. No se cambió nada.`);
      process.exit(1);
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) {
      console.error(`[USERS] Más de ${MAX_BYTES} bytes: bcrypt la truncaría en silencio. No se cambió nada.`);
      process.exit(1);
    }
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  console.log(`[USERS] Contraseña actualizada para "${user.username}" (id=${user.id}).`);
  if (generate) {
    console.log(`\n  ${password}\n`);
    console.log('  ^ Copiala AHORA. No se vuelve a mostrar y no queda guardada en ningún lado.');
  }
  // El aviso importa tanto como el cambio: si el motivo fue una filtración, esto
  // solo la cierra a medias.
  console.log('[USERS] Ojo: los JWT ya emitidos siguen siendo válidos hasta 7 días.');
  console.log('        Para invalidarlos hay que rotar JWT_SECRET, y eso desloguea a todos.');
}

// ---- CLI ----

const USAGE = `
[USERS] Administración de usuarios de SonoraRev

  node src/admin/users.js list     Lista los usuarios (id, usuario, creado, playlists)
  node src/admin/users.js passwd <usuario> [--generate]
                                   Cambia la contraseña. Sin --generate la pide por
                                   pantalla, oculta y dos veces (necesita -it).
                                   Con --generate la crea sola y la muestra UNA vez.

En producción la DB está en el volumen del contenedor, así que va por docker exec:
  docker exec -it <contenedor> node src/admin/users.js list
`.trimEnd();

// Mismo patrón que el scanner: solo actúa si se lo invoca directo, así el módulo
// se puede importar sin que se dispare nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      list();
      break;
    case 'passwd': {
      const username = rest.find(a => !a.startsWith('--'));
      if (!username) {
        console.error('[USERS] Falta el usuario. Uso: users.js passwd <username> [--generate]');
        process.exit(1);
      }
      // Top-level await: el archivo es ESM ("type": "module"), así que se puede
      // esperar acá mismo. bcrypt.hash es async y el proceso no debe salir antes
      // de que el UPDATE haya corrido.
      await passwd(username, { generate: rest.includes('--generate') });
      break;
    }
    default:
      console.log(USAGE);
      // Sin comando es pedir ayuda (éxito). Un comando que no existe es un error,
      // para que algo que lo invoque mal no siga de largo como si hubiera andado.
      process.exit(cmd ? 1 : 0);
  }
}

export { list, passwd };
