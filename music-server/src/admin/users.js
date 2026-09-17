// Administración de usuarios por línea de comandos.
//
// Es la CÁSCARA de terminal de src/users/service.js — el gemelo de
// src/api/admin-users.js, que es la cáscara HTTP del mismo servicio. Acá adentro no
// hay ni una validación ni una consulta: solo leer la terminal, formatear y traducir
// un UserError a un mensaje con exit code. Si aparece una regla escrita acá, se
// escapó del servicio y ya empezó a divergir de la API.
//
// POR QUÉ SIGUE EXISTIENDO AHORA QUE HAY API: la API necesita un admin con sesión, y
// el primero no se puede crear desde ahí — huevo y gallina. Esta es la vía para
// marcar al primer admin, y la única que queda si alguien se deja afuera solo.
//
// CÓMO SE CORRE
//   Desarrollo:  npm run users -- list
//   Producción:  docker exec -it <contenedor> node src/admin/users.js list
//
// EN WINDOWS EL PROMPT DE CONTRASEÑA NO FUNCIONA. Ver la nota de promptHidden: el
// prompt oculto necesita Linux/macOS, y en Windows la única vía es --generate. El
// prompt de `delete` sí anda en Windows, porque es VISIBLE y va por readline.
// En producción da igual, porque docker exec entra a un contenedor Linux.
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
//      dejaría huérfanas, apuntando a un id que ya no existe. Desde que el servicio
//      comprueba el PRAGMA antes de borrar, con una conexión propia se negaría.
//   Costo aceptado: importarlo corre su bootstrap (los CREATE TABLE IF NOT EXISTS,
//   los PRAGMA y los ALTER TABLE de migración). Es idempotente y es exactamente el
//   mismo camino que recorre el servidor al arrancar.
//
// SQLITE EN WAL, CON EL SERVIDOR VIVO
//   No hace falta parar el contenedor: WAL admite un escritor y N lectores a la
//   vez, y lo que se escribe desde acá dura milisegundos.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import db from '../db/database.js';
import {
  UserError,
  listUsers,
  findByUsername,
  createUser,
  updateUser,
  deleteUser,
  assertPassword,
  ROLES,
} from '../users/service.js';

// Ni database.js ni el servidor definen uno. Sin esto, si el servidor está
// escribiendo justo en ese instante (crear playlist, agregar canción), nuestra
// consulta aborta al toque con SQLITE_BUSY en vez de esperar su turno.
db.exec('PRAGMA busy_timeout = 5000');

// ---- list ----

// LIMITACIÓN CONOCIDA, para que nadie la busque: esto NO puede distinguir un
// usuario de contraseña de uno creado por Cloudflare Access. upsertUserByEmail()
// guarda un bcrypt REAL de un randomUUID() para cumplir el NOT NULL, así que en la
// tabla los dos se ven idénticos ($2b$12$, 60 caracteres). La única pista es que
// los de SSO tienen un email como username, y es una pista, no un dato.
function list() {
  const rows = listUsers();

  if (!rows.length) {
    console.log('[USERS] No hay usuarios en la base.');
    return;
  }

  // El password_hash no se selecciona ni se imprime, ni siquiera truncado: un
  // prefijo de bcrypt no sirve para nada salvo para filtrarse en un log. De eso se
  // ocupa el servicio, que es el único que arma el SELECT.
  const w = Math.max(8, ...rows.map(r => String(r.username).length));
  console.log(`[USERS] ${rows.length} ${rows.length === 1 ? 'usuario' : 'usuarios'}\n`);
  console.log(
    `  ${'ID'.padStart(4)}  ${'USUARIO'.padEnd(w)}  ${'ROL'.padEnd(5)}  ` +
    `${'CREADO'.padEnd(19)}  ${'PLAYLISTS'.padStart(9)}  ${'PLAYS'.padStart(6)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${String(r.id).padStart(4)}  ${String(r.username).padEnd(w)}  ${String(r.role).padEnd(5)}  ` +
      `${String(r.created_at ?? '—').padEnd(19)}  ${String(r.playlists).padStart(9)}  ${String(r.plays).padStart(6)}`,
    );
  }
}

// ---- Contraseñas ----

// 18 bytes → 24 caracteres base64url, ~144 bits. No se tipea nunca: no pasa por el
// historial del shell, ni por `ps`, ni por la pantalla salvo una vez al final.
function generatePassword() {
  return randomBytes(18).toString('base64url');
}

// Sin eco. Lee carácter por carácter en raw mode; itera el chunk porque un pegado
// llega entero en un solo evento 'data' y hay que separarle el Enter.
// SOLO LINUX/macOS. En Windows setRawMode() no da error pero no entrega teclas, así
// que esto quedaría colgado para siempre; por eso readNewPassword() corta antes de
// llegar acá.
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
        if (ch === '\r' || ch === '\n' || ch === '') return done(resolve, buf);
        if (ch === '') return done(reject, new Error('Cancelado.'));           // Ctrl-C
        if (ch === '' || ch === '\b') { buf = buf.slice(0, -1); continue; }    // borrar
        if (ch >= ' ') buf += ch;   // descarta flechas y demás secuencias de control
      }
    };
    stdin.on('data', onData);
  });
}

// Prompt VISIBLE, para lo que no es secreto. Va por readline y no por promptHidden
// justamente porque tiene que VERSE lo que se escribe —el sentido de escribir el
// nombre es leerlo mientras se tipea— y de paso funciona en Windows, donde el raw
// mode no entrega teclas.
async function promptLine(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}

// Consigue una contraseña nueva: la genera, o la pide dos veces por pantalla. Las
// REGLAS de la contraseña ya no están acá: las pone assertPassword() del servicio,
// el mismo que valida la API. Acá queda solo lo que es de la terminal —el guard de
// Windows, el de TTY y la confirmación— y traducir el error a un mensaje.
//
// `abortNote` existe porque el mensaje tiene que decir qué NO pasó, y eso depende de
// quién llame: "No se cambió nada." no sirve cuando lo que falló fue una creación.
async function readNewPassword(label, { generate, abortNote }) {
  if (generate) return generatePassword();

  // COMPROBADO en PowerShell y en Git Bash: en Windows el prompt se cuelga para
  // siempre después de imprimir el label. setRawMode() no falla —Node lo acepta—
  // pero detrás no hay un TTY real y no llega ni una tecla. Se corta acá y con un
  // mensaje que dice qué hacer, porque colgarse mudo es el peor modo de fallo:
  // dentro de seis meses nadie se acuerda de por qué y son diez minutos perdidos.
  if (process.platform === 'win32') {
    console.error('[USERS] En Windows el prompt interactivo se cuelga: no hay un TTY real detrás');
    console.error('        de la consola ni de MinTTY, y setRawMode() se queda esperando teclas.');
    console.error('        Usá --generate acá, o corré el prompt sobre Linux/macOS (docker exec -it).');
    process.exit(1);
  }
  // A propósito NO se lee de un pipe: aceptarlo invita al `echo "clave" | ...`
  // que deja la contraseña en el historial, que es justo lo que esto evita.
  if (!process.stdin.isTTY) {
    console.error('[USERS] Sin terminal interactiva. Usá `docker exec -it …` o pasá --generate.');
    process.exit(1);
  }

  const password = await promptHidden(label);
  const again = await promptHidden('Repetila: ');
  if (password !== again) {
    console.error(`[USERS] No coinciden. ${abortNote}`);
    process.exit(1);
  }
  try {
    assertPassword(password);
  } catch (e) {
    console.error(`[USERS] ${e.message} ${abortNote}`);
    process.exit(1);
  }
  return password;
}

// Resuelve el usuario por NOMBRE, porque en la terminal nadie se acuerda de un id.
// La API trabaja por id porque ahí el id lo acaba de devolver un GET; acá el dato
// que la persona tiene a mano es el nombre.
function mustFind(username) {
  const user = findByUsername(String(username ?? '').trim());
  if (!user) {
    console.error(`[USERS] No existe el usuario "${username}". Mirá la lista con: users.js list`);
    process.exit(1);
  }
  return user;
}

// ---- passwd ----

async function passwd(username, { generate }) {
  const user = mustFind(username);

  const password = await readNewPassword(
    `Nueva contraseña para "${user.username}": `,
    { generate, abortNote: 'No se cambió nada.' },
  );

  await updateUser(user.id, { password });

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

// ---- create ----

// QUÉ PONER DE USERNAME, que no es cosmético: si el username es el EMAIL de la
// persona, el día que entre al web con Google, upsertUserByEmail() encuentra esta
// misma fila y la ADOPTA (auth.js: SELECT por username, y si existe la devuelve).
// O sea, una sola cuenta y las mismas playlists desde la app y desde el navegador.
// Con un nombre corto pasa lo contrario: el SSO crea una SEGUNDA cuenta con su
// email y la persona termina con dos, cada una con sus playlists.
//   · Personas  → su email.
//   · Cuentas técnicas (app-ios, apple-review) → nombre corto, NUNCA un email:
//     no son nadie y no deben cruzarse con una identidad real.
// El costo de la primera regla está anotado en list(): con emails de los dos lados
// se pierde la única pista para distinguir SSO de contraseña. Se acepta a
// conciencia; la solución de verdad sería una columna, y eso es una migración.
async function create(username, { generate, admin }) {
  // El duplicado se adelanta acá para no hacer tipear una contraseña que va a
  // fallar igual. La garantía real sigue siendo createUser() + el UNIQUE de la
  // tabla; esto solo mueve el error antes del prompt.
  if (findByUsername(String(username ?? '').trim())) {
    console.error(`[USERS] Ya existe el usuario "${username}". No se creó nada.`);
    console.error(`        Si lo que querías era cambiarle la contraseña: users.js passwd ${username}`);
    process.exit(1);
  }

  const password = await readNewPassword(
    `Contraseña para "${username}": `,
    { generate, abortNote: 'No se creó el usuario.' },
  );

  const user = await createUser({ username, password, role: admin ? 'admin' : 'user' });

  console.log(`[USERS] Usuario "${user.username}" creado (id=${user.id}, rol=${user.role}).`);
  // Igual que en passwd: solo se muestra la generada. La tipeada ya la sabe quien
  // la tipeó, y reimprimirla solo la deja en pantalla para quien pase por atrás.
  if (generate) {
    console.log(`\n  ${password}\n`);
    console.log('  ^ Copiala AHORA. No se vuelve a mostrar y no queda guardada en ningún lado.');
  }
  // A propósito NO se repite el aviso de los JWT de passwd: un usuario que acaba de
  // nacer no tiene ninguno emitido.
}

// ---- set-role ----

async function setRole(username, role) {
  const user = mustFind(username);

  if (user.role === role) {
    console.log(`[USERS] "${user.username}" ya es ${role}. No se cambió nada.`);
    return;
  }

  // updateUser() es quien valida el rol y quien se niega a dejar la base sin
  // admins. Acá no se repite ninguna de las dos cuentas: sería la segunda copia de
  // la regla, y el día que cambie una sola el CLI y la API dirían cosas distintas.
  const after = await updateUser(user.id, { role });

  console.log(`[USERS] "${after.username}" ahora es ${after.role} (antes ${user.role}).`);
  console.log('[USERS] El cambio vale YA: el rol se lee de la base en cada petición,');
  console.log('        así que no hace falta que vuelva a entrar ni que expire su token.');
}

// ---- delete ----

async function remove(username) {
  const user = mustFind(username);

  // Se dice ANTES lo que se va a llevar. El servicio hace la cascada igual, pero una
  // confirmación sin saber qué se pierde no es una confirmación.
  console.log(`[USERS] Vas a borrar "${user.username}" (id=${user.id}, rol=${user.role}).`);
  console.log(`        Se van con él: ${user.playlists} playlist(s) y ${user.plays} reproducción(es).`);
  console.log('        Esto no se deshace.');

  const typed = await promptLine(`Escribí "${user.username}" para confirmar: `);

  // Se corta acá con un mensaje claro en vez de dejar que suba el UserError del
  // servicio: el servicio no sabe que del otro lado hay alguien mirando un prompt.
  if (typed !== user.username) {
    console.error('[USERS] No coincide. No se borró nada.');
    process.exit(1);
  }

  deleteUser(user.id, { confirm: typed });
  console.log(`[USERS] Usuario "${user.username}" borrado, con sus playlists y sus reproducciones.`);
}

// ---- CLI ----

const USAGE = `
[USERS] Administración de usuarios de SonoraRev

  node src/admin/users.js list     Lista los usuarios (id, usuario, rol, creado,
                                   playlists, plays)
  node src/admin/users.js create <usuario> [--admin] [--generate]
                                   Crea un usuario nuevo. Falla si ya existe.
                                   --admin: nace como administrador.
                                   Para personas el usuario es su EMAIL (así el día
                                     que entren por Google es la MISMA cuenta);
                                     para cuentas técnicas, nombre corto.
  node src/admin/users.js passwd <usuario> [--generate]
                                   Cambia la contraseña.
                                   --generate: la crea sola y la muestra UNA vez.
                                     Es la ÚNICA vía en Windows.
                                   Sin --generate: la pide por pantalla, oculta y dos
                                     veces. Requiere Linux/macOS y TTY (docker exec -it);
                                     en Windows el prompt se cuelga y no se usa.
  node src/admin/users.js set-role <usuario> user|admin
                                   Cambia el rol. Se niega a dejar la base sin admins.
  node src/admin/users.js delete <usuario>
                                   Borra el usuario y, EN CASCADA, sus playlists y sus
                                   reproducciones. Pide escribir el usuario para
                                   confirmar. No se deshace.

La contraseña NUNCA se pasa por argumento ni por variable de entorno: quedaría en el
historial del shell y en la salida de \`ps\`. O prompt oculto, o --generate.

En producción la DB está en el volumen del contenedor, así que va por docker exec:
  docker exec -it <contenedor> node src/admin/users.js list
`.trimEnd();

// Mismo patrón que el scanner: solo actúa si se lo invoca directo, así el módulo
// se puede importar sin que se dispare nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const libres = rest.filter(a => !a.startsWith('--'));
  const flags = {
    generate: rest.includes('--generate'),
    admin: rest.includes('--admin'),
  };

  // Un UserError es una regla del servicio que se incumplió, y la persona necesita
  // leerla, no un stack trace. Cualquier otro error SÍ sube entero: eso es un bug, y
  // ahí el stack es el dato.
  try {
    switch (cmd) {
      case 'list':
        list();
        break;

      case 'create': {
        if (!libres[0]) {
          console.error('[USERS] Falta el usuario. Uso: users.js create <username> [--admin] [--generate]');
          process.exit(1);
        }
        // Top-level await: el archivo es ESM ("type": "module"), así que se puede
        // esperar acá mismo. bcrypt.hash es async y el proceso no debe salir antes
        // de que el INSERT haya corrido.
        await create(libres[0], flags);
        break;
      }

      case 'passwd': {
        if (!libres[0]) {
          console.error('[USERS] Falta el usuario. Uso: users.js passwd <username> [--generate]');
          process.exit(1);
        }
        await passwd(libres[0], flags);
        break;
      }

      case 'set-role': {
        if (!libres[0] || !libres[1]) {
          console.error(`[USERS] Uso: users.js set-role <username> ${ROLES.join('|')}`);
          process.exit(1);
        }
        await setRole(libres[0], libres[1]);
        break;
      }

      case 'delete': {
        if (!libres[0]) {
          console.error('[USERS] Falta el usuario. Uso: users.js delete <username>');
          process.exit(1);
        }
        await remove(libres[0]);
        break;
      }

      default:
        console.log(USAGE);
        // Sin comando es pedir ayuda (éxito). Un comando que no existe es un error,
        // para que algo que lo invoque mal no siga de largo como si hubiera andado.
        process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    console.error(`[USERS] ${e.message}`);
    process.exit(1);
  }
}

export { list, create, passwd, setRole, remove };
