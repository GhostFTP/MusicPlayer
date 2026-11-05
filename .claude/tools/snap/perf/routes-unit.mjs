// routes-unit.mjs — ida y vuelta de las rutas de álbum (music-client/src/utils/routes.js), con foco en
// los álbumes SIN album_artist (centinela "@" crudo: /albums/@/<álbum>). Sin navegador. Comprueba que
// stateToPath → pathToState devuelve el mismo álbum (acentos, NFD, "/" y "&" en nombres, y el propio
// "@" como nombre de álbum o de artista), que un link de la app iOS (siempre con album_artist,
// codificado con encodeURIComponent) se sigue leyendo igual, y que las demás vistas no cambian.
// Uso: node routes-unit.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { stateToPath, pathToState, NO_ALBUM_ARTIST } = await import(pathToFileURL(join(ROOT, 'music-client/src/utils/routes.js')).href);

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
// pathname como lo vería el navegador (new URL no toca "@" ni los %XX).
const asBrowser = (p) => new URL('https://sonorarev.com' + p).pathname;
const trip = (album_artist, album) => {
  const path = stateToPath({ view: 'albums', target: { album_artist, album } });
  const back = pathToState(asBrowser(path));
  return { path, back: back.target };
};
const same = (t, aa, a) => t && t.album === a.normalize('NFC') && (aa == null ? t.album_artist === null : t.album_artist === aa.normalize('NFC'));

ok('centinela_es_arroba', NO_ALBUM_ARTIST === '@');

// Sin album_artist (null, undefined y "") → /albums/@/<álbum> → album_artist null.
for (const [k, aa] of [['null', null], ['undefined', undefined], ['vacio', '']]) {
  const r = trip(aa, 'Random Access Memories (10th Anniversary Edition)');
  ok(`sin_artista_${k}`, r.path === '/albums/@/Random%20Access%20Memories%20(10th%20Anniversary%20Edition)' && same(r.back, null, 'Random Access Memories (10th Anniversary Edition)'), r);
}

// Ida y vuelta con nombres difíciles, con y sin artista.
const NAMES = [
  ['Daft Punk', 'Discovery'],
  ['Árbol Ñ', 'Canción de ñandú über'],
  ['Él', 'Café'],                 // NFD → vuelve en NFC
  ['C/D & E', 'A&B? #1 / 50% + más'],
  ['@', 'Discovery'],                        // artista llamado literalmente "@"
  ['Daft Punk', '@'],                        // álbum llamado "@"
  ['@', '@'],
  ['%40', 'raro'],                           // artista llamado literalmente "%40"
  ['YOASOBI ✨', '🎧 夜に駆ける'],
];
for (const [aa, a] of NAMES) {
  const r = trip(aa, a);
  ok(`ida_vuelta_${aa}_${a}`.slice(0, 48), same(r.back, aa, a), r);
  const r0 = trip(null, a);
  ok(`ida_vuelta_sin_artista_${a}`.slice(0, 48), same(r0.back, null, a) && r0.path.startsWith('/albums/@/'), r0);
}
// Un artista "@" NUNCA cae en el centinela (va como %40), y el centinela crudo no es un artista.
ok('artista_arroba_codificado', stateToPath({ view: 'albums', target: { album_artist: '@', album: 'X' } }) === '/albums/%40/X');
ok('centinela_crudo_es_null', pathToState('/albums/@/X').target?.album_artist === null);
ok('arroba_codificado_es_artista', pathToState('/albums/%40/X').target?.album_artist === '@');

// Links que la app iOS YA compartió (lib/compartir.ts: siempre con album_artist, encodeURIComponent).
const ios = (aa, a) => `/albums/${encodeURIComponent(aa.trim().normalize('NFC'))}/${encodeURIComponent(a.trim().normalize('NFC'))}`;
for (const [aa, a] of [['Daft Punk', 'Discovery'], ['Kali Uchis', 'ORQUÍDEAS'], ['C/D & E', 'A&B? #1 / 50% + más'], ['@', 'Discovery']]) {
  const t = pathToState(asBrowser(ios(aa, a))).target;
  ok(`link_ios_${aa}`, same(t, aa, a), { path: ios(aa, a), t });
}

// Lo que NO cambia: álbumes con artista, sin target, otras vistas, ruta incompleta.
ok('lista_albums', stateToPath({ view: 'albums', target: null }) === '/albums' && pathToState('/albums').target === null);
ok('albums_un_segmento', pathToState('/albums/@').target === null);
ok('artista', stateToPath({ view: 'artists', target: { artist: 'Daft Punk' } }) === '/artists/Daft%20Punk' && pathToState('/artists/Daft%20Punk').target.artist === 'Daft Punk');
ok('artista_arroba', pathToState('/artists/@').target.artist === '@');
ok('year_y_playlist', pathToState('/years/2007').target.year === 2007 && pathToState('/playlists/12').target.id === 12);
ok('biblioteca', stateToPath({ view: 'library' }) === '/' && pathToState('/').view === 'library');

// Radio: /radio = sin radio; /radio/CODIGO con la regla de normalizarCodigo (radioSync.js).
const radio = (p) => pathToState(asBrowser(p));
const esCodigo = (s, c) => s.view === 'radio' && s.target?.codigo === c && Object.keys(s.target).length === 1;
const esInvalido = (s) => s.view === 'radio' && s.target?.invalido === true && !('codigo' in s.target);
ok('radio_sin_codigo', radio('/radio').view === 'radio' && radio('/radio').target === null && radio('/radio/').target === null && stateToPath({ view: 'radio', target: null }) === '/radio');
ok('radio_codigo_ida_vuelta', esCodigo(radio('/radio/K7M2QX'), 'K7M2QX') && stateToPath(radio('/radio/K7M2QX')) === '/radio/K7M2QX');
ok('radio_minusculas', esCodigo(radio('/radio/k7m2qx'), 'K7M2QX'));
ok('radio_armar_minusculas', stateToPath({ view: 'radio', target: { codigo: 'k7m2qx' } }) === '/radio/K7M2QX');
ok('radio_guion', esCodigo(radio('/radio/K7M-2QX'), 'K7M2QX'));
ok('radio_espacio', esCodigo(radio('/radio/k7m%202qx'), 'K7M2QX'));
for (const ch of ['0', '1', 'I', 'L', 'O']) ok(`radio_invalido_letra_${ch}`, esInvalido(radio(`/radio/K7M2Q${ch}`)));
ok('radio_invalido_largo_5', esInvalido(radio('/radio/K7M2Q')));
ok('radio_invalido_largo_7', esInvalido(radio('/radio/K7M2QXA')));
ok('radio_invalido_porciento', esInvalido(pathToState('/radio/%')));
ok('radio_invalido_se_escribe_radio', stateToPath({ view: 'radio', target: { invalido: true } }) === '/radio'
  && stateToPath({ view: 'radio', target: { codigo: 'xyz' } }) === '/radio'
  && stateToPath({ view: 'radio', target: { codigo: 123 } }) === '/radio');
ok('radio_segmento_de_mas', esCodigo(radio('/radio/K7M2QX/extra'), 'K7M2QX'));
for (const p of ['/Radio', '/RADIO', '/radios', '/radio-x', '/api/radio']) ok(`radio_no_choca_${p}`, pathToState(p).view === 'library' && pathToState(p).target === null);

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nroutes-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
