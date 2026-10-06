// share-unit.mjs — PARIDAD del texto de "Compartir" entre la web (music-client/src/utils/share.js)
// y la app iOS (sonorarev-ios/lib/compartir.ts, sólo lectura: se importa, no se toca). Para cada
// caso, los dos tienen que dar EXACTAMENTE el mismo texto, y el link tiene que volver a leerse como
// el mismo álbum con la regla de routes.js (pathToState). Sin navegador ni servidor.
// Uso: node share-unit.mjs   (IOS_REPO=C:\Dev\sonorarev-ios por defecto)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const web = await import(pathToFileURL(join(ROOT, 'music-client/src/utils/share.js')).href);
const routes = await import(pathToFileURL(join(ROOT, 'music-client/src/utils/routes.js')).href);
const IOS = join(process.env.IOS_REPO ?? 'C:/Dev/sonorarev-ios', 'lib/compartir.ts');
const ios = existsSync(IOS) ? await import(pathToFileURL(IOS).href) : null;

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const BASE = 'https://sonorarev.com';

const tracks = {
  normal: { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', album_artist: 'Daft Punk' },
  feat_va: { title: 'Ditto', artist: 'NewJeans feat. X', album: 'OMG', album_artist: 'Various Artists' },
  acentos: { title: 'Canción de ñandú über', artist: 'Árbol Ñ', album: 'Canción de ñandú über', album_artist: 'Árbol Ñ' },
  raros: { title: 'A&B? #1', artist: 'C/D & E', album: 'A&B? #1 / 50% + más', album_artist: 'C/D & E' },
  comillas: { title: "Don't Stop", artist: 'Rock \'n\' Roll "Band"', album: "Don't Stop", album_artist: 'Rock \'n\' Roll "Band"' },
  nfd: { title: 'Cafe\u0301', artist: 'E\u0301l', album: 'Cafe\u0301', album_artist: 'E\u0301l' },
  emoji: { title: '夜に駆ける', artist: 'YOASOBI ✨', album: '🎧 夜に駆ける', album_artist: 'YOASOBI ✨' },
  espacios: { title: '  Aerodynamic ', artist: ' Daft Punk ', album: '  Discovery  ', album_artist: '  Daft Punk ' },
  sin_album_artist: { title: 'Californication', artist: 'Red Hot Chili Peppers', album: 'Californication', album_artist: null },
  sin_album: { title: 'Suelta', artist: 'Metallica', album: '', album_artist: 'Metallica' },
  sin_artista: { title: 'Intro', artist: null, album: 'X', album_artist: 'Y' },
  sin_titulo: { title: '   ', artist: 'Nujabes', album: 'Modal Soul', album_artist: 'Nujabes' },
  vacio: {},
};

if (!ios) ok('ios_disponible', false, { IOS });
for (const [name, t] of Object.entries(tracks)) {
  const w = web.trackMessage(t, BASE);
  if (ios) {
    const i = ios.mensajeDeCancion(t, BASE);
    // Única diferencia buscada con iOS: SIN album_artist la web agrega el link con el centinela de
    // routes.js (/albums/@/<álbum>), que abre ESE álbum; iOS en ese caso manda sólo el texto.
    const sinAA = !(typeof t.album_artist === 'string' && t.album_artist.trim()) && typeof t.album === 'string' && t.album.trim();
    const esperado = sinAA ? `${i}
${BASE}/albums/@/${encodeURIComponent(t.album.trim().normalize('NFC'))}` : i;
    ok(`paridad_${name}`, w === esperado, w === esperado ? { texto: w } : { web: w, ios: i, esperado });
  }
}
ok('null_no_lanza', web.trackMessage(null, BASE) === 'Canción');
ok('formato_exacto', web.trackMessage(tracks.normal, BASE) === 'One More Time – Daft Punk\nhttps://sonorarev.com/albums/Daft%20Punk/Discovery');
ok('base_con_barra', web.trackMessage(tracks.normal, BASE + '///') === web.trackMessage(tracks.normal, BASE));

// Ida y vuelta con el router de la web: el link abre EXACTAMENTE ese álbum.
for (const name of ['normal', 'acentos', 'raros', 'comillas', 'nfd', 'emoji', 'feat_va']) {
  const t = tracks[name];
  const link = web.albumLink(BASE, t.album, t.album_artist);
  const s = routes.pathToState(new URL(link).pathname);
  const want = { album: t.album.trim().normalize('NFC'), album_artist: t.album_artist.trim().normalize('NFC') };
  ok(`ruta_${name}`, s.view === 'albums' && s.target?.album === want.album && s.target?.album_artist === want.album_artist, { link, target: s.target });
}
// El link SIN album_artist vuelve a leerse con routes.js como ese álbum con album_artist null.
{
  const link = web.albumLink(BASE, 'Californication', null);
  const s = routes.pathToState(new URL(link).pathname);
  ok('ruta_sin_album_artist', link === BASE + '/albums/@/Californication' && s.view === 'albums' && s.target?.album === 'Californication' && s.target?.album_artist === null, { link, target: s.target });
}
ok('sin_token_ni_query', !/[?#]|token/i.test(web.albumLink(BASE, 'Discovery', 'Daft Punk')));

// Álbum (sólo web): «Álbum – Artista del álbum» + el mismo link.
ok('album_mensaje', web.albumMessage({ album: 'Discovery', album_artist: 'Daft Punk' }, BASE) === 'Discovery – Daft Punk\nhttps://sonorarev.com/albums/Daft%20Punk/Discovery');

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nshare-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
