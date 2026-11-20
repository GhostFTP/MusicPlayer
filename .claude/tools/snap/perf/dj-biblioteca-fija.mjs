// dj-biblioteca-fija.mjs — una BIBLIOTECA FIJA para la matriz visual del Modo DJ (sub-paso h5b). No toca la base real.
//
// Cómo la carga la página (leído en el commit a446b7f):
//   · DjPage.jsx:480–529 (BibliotecaDj) → libraryTracks() (utils/viewTracks.js), que pide con loadAllTracks()
//     (utils/libraryLoader.js:42–67): GET /api/tracks?limit=5000&offset=0 y sigue paginando (limit=20000) mientras
//     una página venga LLENA. La respuesta es un ARRAY de pistas (music-server/src/api/tracks.js, res.json(rows)).
//   · Pinta cada fila con title, artist, album, duration y el QualityChip (codec, bits_per_sample, sample_rate,
//     bitrate, lossless); el buscador filtra por title/artist/album con foldForSearch (minúsculas y sin acentos).
//   · «Cargar» (dj/motor/carga.js:150) baja /stream/<id>: lo sirve el WAV sintético de tablet-util.mjs:30–36 para
//     CUALQUIER id, así que toda pista de acá se puede cargar en un deck. antesDeBajar mira duration y sample_rate:
//     las de 96 kHz piden confirmación («Cargar igual»), por eso la matriz sólo carga pistas de 44,1 kHz.
//
// servirBiblioteca(ctx) intercepta SÓLO el pathname exacto /api/tracks (no /api/tracks/:id/…): offset 0 → las 40
// pistas (menos que el limit, así loadAllTracks termina en un pedido); offset > 0 → []. Sin ETag (viewCache usa su
// hash propio). Todo lo demás de /api/ sigue yendo al servidor del runner.
//
// Las 40 pistas son DETERMINISTAS (sin azar ni fecha). Especiales:
//   · [0]  TITULO_LARGO (102 caracteres): visible arriba de la lista en todos los estados; E3/E10 la cargan en A.
//   · [20] ACENTOS: título, artista y álbum con tildes y eñe; sale en la búsqueda de E7b.
//   · [39] ARTISTA_LARGO (99 caracteres): la última fila (E7a baja hasta ella); E3/E10 la cargan en B.
//   · Calidades: 24/96 FLAC (Hi-Res) en i % 8 === 3, MP3 320 en i % 8 === 6, el resto FLAC 16/44,1.
//   · BUSQUEDA = 'corazon' coincide con EXACTAMENTE 4 pistas: [5], [6], [7] (álbum «Corazón Abierto») y [20].
export const TITULO_LARGO = 'Una canción con un título larguísimo que no cabe en la fila de la biblioteca ni en la tarjeta del deck';
export const ARTISTA_LARGO = 'Orquesta Sinfónica y Coro Filarmónico de la Ciudad con Invitados Especiales de Todo el Mundo Entero';
export const BUSQUEDA = 'corazon';
export const BUSQUEDA_N = 4;
export const NADA = 'zzzz sin resultados';

const ARTISTAS = ['Los Planetas de Prueba', 'Nubes Fijas', 'Trío Determinista', 'La Banda del Fixture', 'Ecos de Laboratorio'];
const PALABRAS = ['Amanecer', 'Ruta Norte', 'Marea', 'Luz de Neón', 'Ciudad Dormida', 'Faro', 'Viento Sur', 'Eclipse'];

function pista(i) {
  const calidad = i % 8 === 3 ? { codec: 'FLAC', bits_per_sample: 24, sample_rate: 96000, bitrate: 2800000, lossless: 1 }
    : i % 8 === 6 ? { codec: 'MP3', bits_per_sample: null, sample_rate: 44100, bitrate: 320000, lossless: 0 }
      : { codec: 'FLAC', bits_per_sample: 16, sample_rate: 44100, bitrate: 900000, lossless: 1 };
  const artista = ARTISTAS[i % ARTISTAS.length];
  const t = {
    id: 900001 + i, title: `Tema ${String(i + 1).padStart(2, '0')} · ${PALABRAS[i % PALABRAS.length]}`, artist: artista,
    album: `Disco ${Math.floor(i / 8) + 1}`, album_artist: artista, genre: 'Prueba', year: 2020 + (i % 5), track_number: (i % 8) + 1,
    disc_number: null, disc_total: null, duration: 120 + ((i * 37) % 241), cover_path: null, ...calidad,
  };
  if (i >= 5 && i <= 7) t.album = 'Corazón Abierto';
  if (i === 0) t.title = TITULO_LARGO;
  if (i === 20) Object.assign(t, { title: 'Canción del Ñandú: Pingüino, Árbol y Corazón', artist: 'José Ángel Núñez', album_artist: 'José Ángel Núñez', album: 'Música para Él' });
  if (i === 39) Object.assign(t, { artist: ARTISTA_LARGO, album_artist: ARTISTA_LARGO });
  return t;
}
export const PISTAS = Object.freeze(Array.from({ length: 40 }, (_, i) => Object.freeze(pista(i))));

export const servirBiblioteca = (ctx) => ctx.route((u) => u.pathname === '/api/tracks', (r) => {
  const q = new URL(r.request().url()).searchParams;
  const cuerpo = Number(q.get('offset') ?? 0) > 0 ? [] : PISTAS;
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });
});
