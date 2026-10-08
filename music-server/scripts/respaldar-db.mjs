// RESPALDO DE LA BASE (1.25.0): una copia CONSISTENTE de music.db en un solo archivo, con el
// servidor andando. Usa `VACUUM INTO` de SQLite (por node:sqlite de Node 22): lee la base como la
// ve una transacción —incluido lo que todavía está en el WAL— y escribe un archivo nuevo, sin
// -wal ni -shm. No hace falta parar el servidor.
//
//   npm run respaldar            (en producción: dentro del contenedor, ver el README)
//
// Escribe data/respaldos/music-AAAA-MM-DD-HHMM.db (o junto a MUSIC_DB_PATH si se usa), y antes de
// decir que salió bien ABRE la copia y verifica: `PRAGMA integrity_check` en "ok" y el mismo
// número de filas que la original en cada tabla. Sale con código 1 si algo no cuadra.
//
// ⚠️ NO importa db/database.js a propósito: ese archivo corre las migraciones al abrirse, y un
// respaldo tiene que copiar la base TAL COMO ESTÁ.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const origen = resolve(process.env.MUSIC_DB_PATH ?? join(__dir, '../data/music.db'));
if (!existsSync(origen)) {
  console.error(`[RESPALDO] No existe la base: ${origen}`);
  process.exit(1);
}

const d = new Date();
const dos = (n) => String(n).padStart(2, '0');
const sello = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}`;
const carpeta = join(dirname(origen), 'respaldos');
mkdirSync(carpeta, { recursive: true });
const destino = join(carpeta, `music-${sello}.db`);
if (existsSync(destino)) {
  console.error(`[RESPALDO] Ya existe ${destino}: espera un minuto o bórralo.`);
  process.exit(1);
}

const src = new DatabaseSync(origen);
src.exec('PRAGMA busy_timeout = 5000');
// La ruta va como literal de SQL: se escapan las comillas simples.
src.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

// Verificar la copia: abre, está íntegra y tiene las mismas filas.
const tablas = src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const cuenta = (db, t) => db.prepare(`SELECT COUNT(*) c FROM "${t.replace(/"/g, '""')}"`).get().c;
const antes = Object.fromEntries(tablas.map((t) => [t, cuenta(src, t)]));
src.close();

const copia = new DatabaseSync(destino, { readOnly: true });
const integridad = copia.prepare('PRAGMA integrity_check').get().integrity_check;
const despues = Object.fromEntries(tablas.map((t) => [t, cuenta(copia, t)]));
copia.close();

const distintas = tablas.filter((t) => antes[t] !== despues[t]);
const mb = (statSync(destino).size / 1e6).toFixed(1);
console.log(`[RESPALDO] ${destino} · ${mb} MB · integridad: ${integridad}`);
console.log(`[RESPALDO] filas: ${tablas.map((t) => `${t} ${despues[t]}`).join(' · ')}`);
// Entre leer la original y leer la copia el servidor pudo escribir algo (una escucha): una
// diferencia de pocas filas en plays no es un error de la copia. Igual se avisa.
if (integridad !== 'ok') { console.error('[RESPALDO] ⚠️ La copia NO pasó integrity_check.'); process.exit(1); }
if (distintas.length) {
  console.warn(`[RESPALDO] ⚠️ Filas distintas en: ${distintas.map((t) => `${t} ${antes[t]}→${despues[t]}`).join(', ')}` +
    ' (puede ser una escritura del servidor justo entre las dos lecturas; si dudas, vuelve a correrlo).');
}
