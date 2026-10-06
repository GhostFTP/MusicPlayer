// Smoke test del RESUMEN DE ESCUCHA (1.22.0): GET /api/plays/resumen, más una prueba de
// humo de lo que ya existía en /api/plays (POST, /top y /stats) para ver que siga igual.
//
// CÓMO SE CORRE
//   npm run smoke:resumen
// No hace falta levantar nada: monta SOLO el router de /api/plays en un express propio, en
// un puerto libre, dentro de este proceso.
//
// CORRE SOBRE UNA BASE TEMPORAL, como los otros smokes: MUSIC_DB_PATH se pone ANTES de
// importar nada del servidor (db/database.js abre el archivo al evaluarse). Los usuarios
// llevan ids desde 900001. Todo se borra al terminar, también si algo falla.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-resumen-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
process.env.JWT_SECRET = 'smoke-resumen';

const { default: express } = await import('express');
const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { default: playsRoutes } = await import('../src/api/plays.js');

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Datos ----

const A = 900001;   // la cuenta principal
const B = 900002;   // otra cuenta: nada suyo puede aparecer en lo de A
const C = 900003;   // una cuenta sin reproducciones
for (const [id, nombre] of [[A, 'smoke-res-a'], [B, 'smoke-res-b'], [C, 'smoke-res-c']]) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, nombre, 'x');
}
const tok = (id) => signToken({ id, username: `u${id}` });

const pista = (id, campos) => db.prepare(`
  INSERT INTO tracks (id, title, artist, album, album_artist, genre, year, duration, file_path, cover_path)
  VALUES (@id, @title, @artist, @album, @album_artist, @genre, @year, @duration, @file_path, @cover_path)
`).run({
  id, title: `T${id}`, artist: 'Art', album: 'Alb', album_artist: 'Art', genre: 'Rock', year: 1999,
  duration: 200, file_path: `/m/${id}.flac`, cover_path: null, ...campos,
});

// 800001-800003: un álbum de Daft Punk, con carátula en la 2.
pista(800001, { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', album_artist: 'Daft Punk', genre: 'Electronic', year: 2001, duration: 320.4 });
pista(800002, { title: 'Aerodynamic', artist: 'Daft Punk', album: 'Discovery', album_artist: 'Daft Punk', genre: 'Electronic', year: 2001, duration: 212.5, cover_path: '/c/2.jpg' });
pista(800003, { title: 'Digital Love', artist: 'Daft Punk', album: 'Discovery', album_artist: 'Daft Punk', genre: 'Electronic', year: 2001, duration: 301 });
// 800004: sin género, sin año y sin duración.
pista(800004, { title: 'Sin datos', artist: 'X', album: 'Y', album_artist: 'X', genre: null, year: null, duration: null });
// 800005-800006: dos pistas que van a EMPATAR en reproducciones.
pista(800005, { title: 'Empate A', artist: 'Zeta', album: 'Z1', album_artist: 'Zeta', genre: 'Jazz', year: 1965, duration: 100 });
pista(800006, { title: 'Empate B', artist: 'Alfa', album: 'A1', album_artist: 'Alfa', genre: 'Jazz', year: 1965, duration: 100 });
// 800007: la escuchada ANTES del periodo (no cuenta como nueva).
pista(800007, { title: 'Vieja', artist: 'Vieja', album: 'V', album_artist: 'Vieja', genre: 'Pop', year: 1985, duration: 180 });
// 800008: la compartida con B.
pista(800008, { title: 'Compartida', artist: 'Ambos', album: 'Amb', album_artist: 'Ambos', genre: 'Pop', year: 2010, duration: 240 });

let cid = 0;
const play = (user, track, at) => db.prepare(
  'INSERT INTO plays (user_id, track_id, played_at, ms_played, client_id) VALUES (?, ?, ?, ?, ?)'
).run(user, track, at, 90000, `smoke-res-${++cid}`);

const Z = (iso) => Date.parse(iso);                     // un instante en UTC
const DESDE = Z('2026-01-01T06:00:00Z');                 // 1-ene-2026 00:00 en Querétaro
const HASTA = Z('2027-01-01T06:00:00Z');                 // 1-ene-2027 00:00 en Querétaro

// El periodo es 2026 en Querétaro (UTC−6).
play(A, 800001, Z('2026-03-16T05:30:00Z'));   // 15-mar 23:30 local (domingo): NO el 16 UTC
play(A, 800001, Z('2026-03-20T18:00:00Z'));   // 20-mar 12:00 local
play(A, 800001, Z('2026-07-04T01:15:00Z'));   // 3-jul 19:15 local
play(A, 800002, Z('2026-03-20T19:00:00Z'));
play(A, 800003, Z('2026-05-01T12:00:00Z'));
play(A, 800004, Z('2026-05-02T12:00:00Z'));   // sin duración: cuenta, 0 ms
play(A, 800005, Z('2026-06-01T12:00:00Z'));   // empate: misma cuenta y misma última
play(A, 800006, Z('2026-06-01T12:00:00Z'));
play(A, 800007, Z('2025-06-01T12:00:00Z'));   // primera vez ANTES del periodo
play(A, 800007, Z('2026-02-01T12:00:00Z'));   // ...y otra dentro: no es nueva
play(A, 800008, Z('2026-08-01T12:00:00Z'));
play(A, 800008, Z('2026-08-02T12:00:00Z'));   // primera vez dentro, repetida: nueva UNA vez
// Los bordes: since incluido, until excluido.
play(A, 800002, DESDE);                       // exactamente en since → entra
play(A, 800002, HASTA);                       // exactamente en until → NO entra
// La frontera de año: 31-dic-2025 23:30 en Querétaro = 1-ene-2026 05:30 UTC.
play(A, 800003, Z('2026-01-01T05:30:00Z'));
// B: el mismo track y otros; nada de esto puede salir en lo de A.
play(B, 800008, Z('2026-08-01T13:00:00Z'));
play(B, 800008, Z('2026-08-01T14:00:00Z'));
play(B, 800008, Z('2026-08-01T15:00:00Z'));
play(B, 800005, Z('2026-02-01T12:00:00Z'));

// ---- Servidor propio, solo con /api/plays ----

const app = express();
app.use(express.json());
app.use('/api/plays', playsRoutes);
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BASE = `http://127.0.0.1:${server.address().port}`;

async function get(path, user = A) {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tok(user)}` } });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
const resumen = (qs, user = A) => get(`/api/plays/resumen?${qs}`, user);
const Q = `since=${DESDE}&until=${HASTA}&tz=-360`;

try {
  console.log('[SMOKE-RESUMEN] base temporal:', dir);

  // ---- 1. Aislamiento ----
  console.log('\n1. aislamiento');
  {
    const a = await resumen(Q);
    check(a.status === 200 && a.data?.version === 1, 'A: 200 y version 1', JSON.stringify(a.data)?.slice(0, 120));
    // A, dentro de 2026 local: 800001 ×3, 800002 ×2 (con la de since), 800003 ×1, 800004, 800005,
    // 800006 y 800007 ×1, 800008 ×2 = 12. Fuera: la de 2025, la de until y la de fin de año
    // (31-dic 23:30 local, que es 2025 aunque en UTC ya sea 2026).
    check(a.data.totales.reproducciones === 12, 'A: 12 reproducciones en el periodo', String(a.data.totales.reproducciones));
    const comp = a.data.top_canciones.find((c) => c.id === 800008);
    check(comp?.plays === 2, 'A: la canción compartida cuenta SOLO las 2 de A (B tiene 3)', JSON.stringify(comp));
    const b = await resumen(Q, B);
    check(b.data.totales.reproducciones === 4, 'B: 4 reproducciones, ninguna de A', String(b.data.totales.reproducciones));
    check(b.data.top_canciones.every((c) => [800008, 800005].includes(c.id)), 'B: solo sus pistas en el top');
    check(b.data.nuevas === 2, 'B: 2 nuevas (las suyas)', String(b.data.nuevas));
    const cc = await resumen(Q, C);
    check(cc.data.totales.reproducciones === 0 && cc.data.nuevas === 0, 'C: nada (aunque A y B tengan)');
    const sinToken = await fetch(`${BASE}/api/plays/resumen?${Q}`);
    check(sinToken.status === 401, 'sin token → 401', String(sinToken.status));
    const conUser = await resumen(`${Q}&user_id=${B}&user=${B}`);
    check(conUser.data.totales.reproducciones === 12, 'un user_id en la query se ignora: siguen siendo los de A');
  }

  // ---- 2. Rango ----
  console.log('\n2. rango [since, until)');
  {
    const a = (await resumen(Q)).data;
    check(a.totales.primera === Z('2026-01-01T05:30:00Z') || a.totales.primera === DESDE,
      'la primera es una de dentro');
    const enSince = await resumen(`since=${DESDE}&until=${DESDE + 1}&tz=-360`);
    check(enSince.data.totales.reproducciones === 1, 'exactamente en since → entra', String(enSince.data.totales.reproducciones));
    const enUntil = await resumen(`since=${HASTA}&until=${HASTA + 1}&tz=-360`);
    check(enUntil.data.totales.reproducciones === 1, 'la de until existe (en el rango siguiente)');
    const antesUntil = await resumen(`since=${HASTA - 1}&until=${HASTA}&tz=-360`);
    check(antesUntil.data.totales.reproducciones === 0, 'exactamente en until → NO entra', String(antesUntil.data.totales.reproducciones));
    check(a.totales.ultima < HASTA, 'la última es anterior a until');
  }

  // ---- 3. Zona horaria ----
  console.log('\n3. zona horaria');
  {
    const r = (await resumen(`since=${Z('2026-03-16T00:00:00Z')}&until=${Z('2026-03-16T23:59:59Z')}&tz=-360`)).data;
    check(igual(r.dias, [{ dia: '2026-03-15', plays: 1 }]), '23:30 local de Querétaro cae el 15 y no el 16 UTC', JSON.stringify(r.dias));
    check(r.por_hora[23] === 1 && r.por_hora[5] === 0, '...a las 23 locales (y no a las 5 UTC)');
    check(r.por_dia_semana[0] === 1, '...en domingo local (15-mar-2026), no lunes', JSON.stringify(r.por_dia_semana));
    const fin = (await resumen(`since=${Z('2026-01-01T05:00:00Z')}&until=${Z('2026-01-01T06:00:00Z')}&tz=-360`)).data;
    check(igual(fin.por_mes.map((m) => m.mes), ['2025-12']), 'fin de año: 1-ene 05:30 UTC → diciembre de 2025 local', JSON.stringify(fin.por_mes));
    check(igual(fin.dias, [{ dia: '2025-12-31', plays: 1 }]) && fin.por_hora[23] === 1 && fin.por_dia_semana[3] === 1,
      '...el 31-dic a las 23, miércoles', JSON.stringify({ dias: fin.dias, h: fin.por_hora[23], d: fin.por_dia_semana }));
    const tokio = (await resumen(`since=${Z('2026-01-01T05:00:00Z')}&until=${Z('2026-01-01T06:00:00Z')}&tz=540`)).data;
    check(igual(tokio.dias, [{ dia: '2026-01-01', plays: 1 }]) && tokio.por_hora[14] === 1 && tokio.por_dia_semana[4] === 1,
      'la misma con tz=+540: 1-ene 14:30, jueves', JSON.stringify({ dias: tokio.dias, h: tokio.por_hora[14] }));
    const utc = (await resumen(`since=${Z('2026-01-01T05:00:00Z')}&until=${Z('2026-01-01T06:00:00Z')}`)).data;
    check(utc.tz === 0 && utc.por_hora[5] === 1 && utc.dias[0]?.dia === '2026-01-01', 'sin tz → UTC');
  }

  // ---- 4. Sin datos ----
  console.log('\n4. sin datos');
  {
    const r = (await resumen(Q, C)).data;
    check(igual(r.totales, { reproducciones: 0, canciones_distintas: 0, artistas_distintos: 0, albumes_distintos: 0, ms_estimados: 0, primera: null, ultima: null }),
      'totales en 0 (primera y ultima en null)', JSON.stringify(r.totales));
    for (const k of ['top_canciones', 'top_artistas', 'top_albumes', 'generos', 'anios', 'por_mes', 'dias']) {
      check(Array.isArray(r[k]) && r[k].length === 0, `${k} = []`);
    }
    check(igual(r.por_hora, new Array(24).fill(0)), 'por_hora = 24 ceros');
    check(igual(r.por_dia_semana, new Array(7).fill(0)), 'por_dia_semana = 7 ceros');
    check(r.nuevas === 0, 'nuevas = 0');
  }

  // ---- 5. Pista sin género, sin año y sin duración ----
  console.log('\n5. sin género, año ni duración');
  {
    const r = (await resumen(`since=${Z('2026-05-02T00:00:00Z')}&until=${Z('2026-05-03T00:00:00Z')}&tz=-360`)).data;
    check(r.totales.reproducciones === 1 && r.totales.ms_estimados === 0, 'cuenta y aporta 0 ms', JSON.stringify(r.totales));
    check(igual(r.generos, [{ genero: null, plays: 1, ms_estimados: 0 }]), 'genero null', JSON.stringify(r.generos));
    check(igual(r.anios, [{ anio: null, plays: 1 }]), 'anio null', JSON.stringify(r.anios));
    check(!JSON.stringify(r).includes('NaN'), 'sin NaN en la respuesta');
    const a = (await resumen(Q)).data;
    // Duraciones de A en el periodo, en ms: 800001 ×3 (320,4 s), 800002 ×2 (212,5), 800003 ×1 (301),
    // 800004 ×1 (sin), 800005 ×1 (100), 800006 ×1 (100), 800007 ×1 (180), 800008 ×2 (240).
    const esperado = Math.round(3 * 320400 + 2 * 212500 + 301000 + 100000 + 100000 + 180000 + 2 * 240000);
    check(a.totales.ms_estimados === esperado, `ms_estimados = la duración × las reproducciones (${esperado})`, String(a.totales.ms_estimados));
    check(a.totales.ms_estimados !== 12 * 90000, 'y NO la suma de ms_played');
    const suma = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
    check(suma(a.por_mes, 'plays') === 12 && suma(a.dias, 'plays') === 12, 'por_mes y dias suman las 12');
    check(a.por_hora.reduce((s, x) => s + x, 0) === 12 && a.por_dia_semana.reduce((s, x) => s + x, 0) === 12, 'por_hora y por_dia_semana suman las 12');
    check(a.generos.some((g) => g.genero === 'Electronic' && g.plays === 6), 'géneros crudos: Electronic con 6');
    check(a.anios[a.anios.length - 1].anio === null && a.anios[0].anio === 1965, 'años del más viejo al más nuevo, null al final', JSON.stringify(a.anios));
    check(a.dias.every((d, i) => i === 0 || a.dias[i - 1].dia < d.dia), 'dias ascendente');
  }

  // ---- 6. Nuevas ----
  console.log('\n6. nuevas');
  {
    const a = (await resumen(Q)).data;
    // Nuevas en 2026 para A: 800001, 800002, 800004, 800005, 800006 y 800008 = 6. La 800007 ya
    // sonó en 2025, y la 800003 sonó primero el 31-dic local (antes del periodo).
    check(a.nuevas === 6, 'nuevas = 6: las que sonaron antes no cuentan, la compartida cuenta una vez', String(a.nuevas));
    const todo = (await resumen('tz=-360')).data;
    check(todo.nuevas === 8 && todo.desde === 0, 'sin since: toda la historia, 8 nuevas');
  }

  // ---- 7. limit ----
  console.log('\n7. limit');
  {
    const uno = (await resumen(`${Q}&limit=1`)).data;
    check(uno.top_canciones.length === 1 && uno.top_artistas.length === 1 && uno.top_albumes.length === 1, 'limit=1 recorta los tres tops');
    const mucho = await resumen(`${Q}&limit=9999`);
    check(mucho.status === 200, 'limit=9999 → se acota a 50 (200)');
    const def = (await resumen(Q)).data;
    check(def.top_canciones.length === 8, 'sin limit: 10 por defecto (A tiene 8 canciones)');
    for (const v of ['0', '-1', 'abc', '2.5']) {
      const r = await resumen(`${Q}&limit=${v}`);
      check(r.status === 400 && typeof r.data?.error === 'string', `limit=${v} → 400`);
    }
  }

  // ---- 8. Parámetros inválidos ----
  console.log('\n8. parámetros inválidos');
  for (const [qs, nombre] of [
    ['since=abc', 'since=abc'], ['since=-5', 'since negativo'], ['since=1e3', 'since=1e3'],
    ['until=xyz', 'until=xyz'], [`since=${HASTA}&until=${DESDE}`, 'until < since'], [`since=${DESDE}&until=${DESDE}`, 'until = since'],
    ['tz=9999', 'tz=9999'], ['tz=-841', 'tz=-841'], ['tz=12.5', 'tz=12.5'], ['tz=abc', 'tz=abc'],
    ['until=99999999999999999', 'until fuera de rango'],
  ]) {
    const r = await resumen(qs);
    check(r.status === 400 && typeof r.data?.error === 'string', `${nombre} → 400`, `${r.status} ${JSON.stringify(r.data)}`);
  }
  check((await resumen('tz=840')).status === 200 && (await resumen('tz=-840')).status === 200, 'tz=±840 → 200');

  // ---- 9. Empates ----
  console.log('\n9. empates');
  {
    const a = (await resumen(`since=${Z('2026-06-01T00:00:00Z')}&until=${Z('2026-06-02T00:00:00Z')}&tz=-360`)).data;
    check(igual(a.top_canciones.map((c) => c.id), [800005, 800006]), 'canciones: mismo plays y misma última → id ASC', JSON.stringify(a.top_canciones.map((c) => c.id)));
    check(igual(a.top_artistas.map((x) => x.artist), ['Alfa', 'Zeta']), 'artistas: nombre ASC', JSON.stringify(a.top_artistas));
    check(igual(a.top_albumes.map((x) => x.album), ['A1', 'Z1']), 'álbumes: nombre ASC');
    const r1 = JSON.stringify((await resumen(Q)).data);
    const r2 = JSON.stringify((await resumen(Q)).data);
    check(r1 === r2, 'dos llamadas iguales dan lo mismo');
    const full = (await resumen(Q)).data;
    check(full.top_canciones[0].id === 800001 && full.top_canciones[0].plays === 3, 'el top 1 es One More Time con 3');
    check(full.top_artistas[0].artist === 'Daft Punk' && full.top_artistas[0].canciones === 3, 'artista top: Daft Punk, 3 canciones distintas');
    check(full.top_albumes[0].album === 'Discovery' && full.top_albumes[0].id_de_una_pista === 800002, 'álbum top con la pista que tiene carátula');
  }

  // ---- 10. Lo que ya existía sigue igual ----
  console.log('\n10. POST, /top y /stats');
  {
    const r = await fetch(`${BASE}/api/plays`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok(C)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plays: [{ track_id: 800001, played_at: Z('2026-09-01T12:00:00Z'), ms_played: 5000, client_id: 'smoke-res-post-1' }] }),
    });
    const d = await r.json();
    check(r.status === 201 && igual(d, { added: 1, already: 0, skipped: 0 }), 'POST /api/plays → 201 { added: 1 }', JSON.stringify(d));
    const top = await get('/api/plays/top?type=tracks', C);
    check(top.status === 200 && top.data[0]?.id === 800001 && top.data[0]?.plays === 1 && top.data[0]?.ms_played === 5000,
      '/top sigue con ms_played crudo', JSON.stringify(top.data?.[0]));
    const st = await get('/api/plays/stats', C);
    check(st.status === 200 && igual(Object.keys(st.data), ['plays', 'ms_played', 'tracks', 'artists', 'albums', 'first_play', 'last_play']) && st.data.plays === 1,
      '/stats con sus mismas claves', JSON.stringify(st.data));
  }

  // Un ejemplo, recortado, para el reporte.
  if (process.argv.includes('--ejemplo')) {
    const e = (await resumen(`${Q}&limit=2`)).data;
    console.log('\nEJEMPLO', JSON.stringify({ ...e, dias: e.dias.slice(0, 3) }, null, 2));
  }
} finally {
  server.close();
  try { db.close(); } catch {}
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-RESUMEN] ${pass} ok · ${fail} fallas`);
if (fail) process.exit(1);
