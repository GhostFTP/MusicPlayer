// COMPARTIR una canción (o un álbum): el texto y el link, con el MISMO formato que la app iOS
// (sonorarev-ios, lib/compartir.ts — mensajeDeCancion), así un link mandado desde el iPhone y uno
// mandado desde la web son idénticos:
//
//   «Título – Artista»
//   <origen>/albums/<album_artist>/<album>
//
// · El link es el del ÁLBUM (no hay ruta de canción). Cada segmento va en NFC y con
//   encodeURIComponent; routes.js lo lee al revés (decode + NFC), así que el link abre el álbum.
// · `album_artist` CRUDO, sin caer a `artist`: Albums.jsx busca el álbum por ese campo exacto.
//   Sin álbum o sin album_artist no hay link: se comparte sólo el texto.
// · Sin token ni query: el link no da acceso a nadie; quien lo abre pasa por Cloudflare Access.
// · Sólo familia (decisión de Oscar): nada de link público ni de backend.
//
// Puro salvo `shareText`: en pantallas táctiles, la hoja del sistema (navigator.share) si existe;
// en escritorio, y si no hay hoja, el portapapeles. El aviso al usuario lo da quien llama.

import { NO_ALBUM_ARTIST } from './routes.js';

function limpio(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().normalize('NFC');
  return t ? t : null;
}

// Sin album_artist el link usa el centinela de routes.js (/albums/@/<álbum>), así abre ESE álbum y no
// uno homónimo con artista. Es la única diferencia con iOS, que en ese caso no manda link.
export function albumLink(baseUrl, album, albumArtist) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  const a = limpio(album);
  const aa = limpio(albumArtist);
  if (!base || !a) return null;
  return `${base}/albums/${aa ? encodeURIComponent(aa) : NO_ALBUM_ARTIST}/${encodeURIComponent(a)}`;
}

const SIN_TITULO = 'Canción';

export function shareMessage(titulo, artista, enlace) {
  const t = limpio(titulo) ?? SIN_TITULO;
  const a = limpio(artista);
  const linea = a ? `${t} – ${a}` : t;
  const e = limpio(enlace);
  return e ? `${linea}\n${e}` : linea;
}

// El mensaje de una PISTA: title, artist, album y album_artist crudos (mapeo exacto de iOS).
export function trackMessage(track, baseUrl) {
  const t = track && typeof track === 'object' ? track : {};
  return shareMessage(t.title, t.artist, albumLink(baseUrl, t.album, t.album_artist));
}

// El mensaje de un ÁLBUM (no existe en iOS): «Álbum – Artista del álbum» y el mismo link.
export function albumMessage(item, baseUrl) {
  const t = item && typeof item === 'object' ? item : {};
  return shareMessage(t.album ?? 'Álbum', t.album_artist, albumLink(baseUrl, t.album, t.album_artist));
}

// ¿Teléfono o tableta? Se decide por el puntero PRINCIPAL grueso (el dedo). En escritorio la hoja
// del sistema (la de Windows o macOS) es más lenta que pegar, y el texto ya trae el link: ahí va
// SIEMPRE el portapapeles. La hoja sólo tiene sentido donde se comparte a otra app del teléfono.
// NO se usa navigator.maxTouchPoints: una PC o laptop con pantalla táctil reporta puntos de toque
// (medido: 10 en el equipo de desarrollo) aunque se use con mouse, y caería en la hoja.
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

// Abre la hoja del sistema (sólo en pantallas táctiles) o copia al portapapeles. Resuelve
// 'shared' | 'copied' | 'cancelled'; rechaza si no se pudo ninguna de las dos. Hay que llamarla
// DENTRO del gesto (el clic): fuera de él el navegador niega las dos cosas.
export async function shareText(text) {
  if (isTouchDevice() && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });   // el link va DENTRO del texto, como en iOS
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';   // lo cerró el usuario: no se avisa nada
      // Otro error (sin permiso, destino que falla): se cae al portapapeles.
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

// shareText + el aviso de la casa: sólo el portapapeles se confirma con un toast (la hoja del
// sistema ya dice lo que pasó, y cerrarla sin elegir no avisa nada, igual que iOS); si no se pudo,
// toast ámbar. Lo usan el menú contextual y el botón del reproductor expandido.
export function shareAndNotify(text, toast) {
  return shareText(text)
    .then((r) => { if (r === 'copied') toast('Copiado para compartir'); })
    .catch(() => toast('No se pudo compartir', { variant: 'warning' }));
}
