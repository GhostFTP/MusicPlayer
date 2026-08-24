import { coverUrl } from '../api/client.js';
import { useContextMenu } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';
import { useDragQueue } from '../context/DragQueueContext.jsx';

// Grid de álbumes reutilizable. Lo usan Artistas y Años.
//
// `secondary` = qué campo DESAMBIGUA en este contexto, que es distinto según la vista:
//   · Artistas ("year")   → todos los álbumes son del mismo artista; el nombre repetido en
//                           las 8 tarjetas es ruido, y el año es lo que los distingue.
//   · Años     ("artist") → todos los álbumes son del mismo año; ahí el año es el ruido.
// Default "artist" para que Años (y cualquier consumidor futuro) no cambie.
//
// NO ordena: el orden es responsabilidad de quien pasa la lista. Ordenar acá por año
// rompería Años, donde todos comparten año y el desempate mandaría la grilla a orden
// alfabético en vez del "agrupado por artista" que trae el backend.
//
// `hue` (opcional) → CSS var `--h` de identidad por artista (mismo lenguaje Prisma que
// Playlists/Géneros): solo tiñe cromo (el kicker de año), NUNCA la carátula. Quien no lo
// pasa (Años) deja `--h` sin setear → las fórmulas caen al morado 265 de siempre.
export default function AlbumGrid({ albums, onOpen, secondary = 'artist', hue }) {
  const byYear = secondary === 'year';
  const { openMenu } = useContextMenu();   // clic derecho sobre la tarjeta (desktop; el gate lo pone el menú)
  // C1 · long-press = el mismo menú en móvil. El hook ENVUELVE el onClick de la tarjeta: un
  // long-press ya no cuenta como tap, así que abrir el menú no navega también al álbum. Scrollear
  // la grilla tampoco dispara (el movimiento y el pointercancel del scroll matan el timer).
  const bindPress = useLongPress((album, ev) => openMenu(ev, { type: 'album', item: album, via: 'longpress' }));
  // Drag-to-enqueue fase (b): con la cola abierta en desktop, la tarjeta se arrastra hasta la
  // columna y encola el álbum ENTERO (el drop va a buscar sus pistas). Devuelve {} con la cola
  // cerrada. No trae onPointerDown → no le pisa el suyo a bindPress, así que el long-press del
  // menú en móvil sigue igual; y como el arrastre suprime el click, abrir el álbum tampoco cambia.
  const { dragProps } = useDragQueue();
  return (
    <div className="album-grid album-grid-anim" style={hue != null ? { '--h': hue } : undefined}>
      {albums.map((album, i) => (
        <div
          key={`${album.album}-${album.album_artist}`}
          className="album-card"
          style={{ '--i': i }}
          {...bindPress(album, {
            onClick: () => onOpen(album),
            onContextMenu: (e) => openMenu(e, { type: 'album', item: album }),
          })}
          {...dragProps(album, 'album')}
        >
          {/* Marco que recorta el zoom-on-hover de la carátula (overflow:hidden) sin que
              la imagen desborde sus esquinas redondeadas. NADA la tapa. */}
          <div className="album-cover-frame">
            {/* draggable={false}: una <img> es arrastrable NATIVAMENTE y la carátula ES la
                tarjeta — sin esto, agarrar por ahí arrancaría el arrastre de la imagen en vez
                del de la tarjeta y el drop no encolaría nada. */}
            {album.sample_track_id
              ? <img className="album-cover" src={coverUrl(album.sample_track_id)} alt="" loading="lazy" draggable={false} />
              : <div className="album-cover-placeholder">♫</div>
            }
          </div>
          {/* En modo año el kicker va ARRIBA del título: es la cronología la que ordena la
              grilla, así que el año se lee primero. Sin año conocido, se reserva el hueco
              para que las tarjetas no queden desalineadas entre sí. */}
          {byYear && <div className="album-year">{album.year ?? '—'}</div>}
          <div className="album-name">{album.album}</div>
          {!byYear && <div className="album-artist">{album.album_artist ?? '—'}</div>}
          <div className="album-count">{album.track_count} canciones</div>
        </div>
      ))}
    </div>
  );
}
