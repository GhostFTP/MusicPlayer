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
// Puro salvo `shareText`, que usa la hoja del sistema (navigator.share) si existe y si no el
// portapapeles. El aviso al usuario lo da quien llama, según el resultado.

function limpio(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().normalize('NFC');
  return t ? t : null;
}

export function albumLink(baseUrl, album, albumArtist) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  const a = limpio(album);
  const aa = limpio(albumArtist);
  if (!base || !a || !aa) return null;
  return `${base}/albums/${encodeURIComponent(aa)}/${encodeURIComponent(a)}`;
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

// Abre la hoja del sistema o copia al portapapeles. Resuelve 'shared' | 'copied' | 'cancelled';
// rechaza si no se pudo ninguna de las dos. Hay que llamarla DENTRO del gesto (el clic): fuera de
// él el navegador niega las dos cosas.
export async function shareText(text) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
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
