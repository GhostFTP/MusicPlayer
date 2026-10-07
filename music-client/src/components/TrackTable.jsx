import { Fragment, memo, useRef, useEffect, useCallback } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { coverUrl } from '../api/client.js';
import QualityChip from './QualityChip.jsx';
import { useContextMenu, ContextMenuButton } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';
import { useDragQueue } from '../context/DragQueueContext.jsx';

// Tabla de pistas reutilizable — mismo diseño de fila que la Biblioteca
// (carátula, jerarquía título/artista, QualityChip y botón "⋯" del menú contextual).
// `showAlbum`: oculta la columna Álbum cuando el contexto ya es un álbum.
export default function TrackTable({ tracks, showAlbum = true }) {
  const { play, currentTrack, isPlaying } = usePlayer();
  const { openMenu } = useContextMenu();   // clic derecho sobre la fila (desktop; el gate lo pone el menú)
  // C1 · long-press = el mismo menú en móvil. El hook envuelve onClick/onContextMenu de la fila:
  // un long-press ya no cuenta como tap (no reproduce) y el menú nativo queda prevenido.
  const bindPress = useLongPress((track, ev) => openMenu(ev, { type: 'track', item: track, via: 'longpress' }));
  // Drag-to-enqueue (fase a): con la cola abierta en desktop, la fila se arrastra hasta la columna
  // para encolarla. Devuelve {} con la cola cerrada → la fila no queda draggable. NO trae
  // onPointerDown, así que no le pisa el suyo a bindPress (el long-press del menú en móvil).
  const { dragProps } = useDragQueue();
  const activeRowRef = useRef(null);

  // Handlers ESTABLES para TrackRow (memo): la fila los llama con su índice / su pista.
  const onPlay = useCallback((i) => play(tracks, i), [play, tracks]);
  const onCtx  = useCallback((e, track) => openMenu(e, { type: 'track', item: track }), [openMenu]);

  // Al abrir una lista (álbum/género), desplaza la pista que suena a la vista.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'center' });
  }, [tracks]);

  // Separador "Disco N" solo si hay más de un disco distinto entre las pistas
  // (un álbum de un solo disco no debe mostrar "Disco 1"). disc_number NULL
  // se trata como disco 1, igual que el backend (COALESCE).
  const discOf = (t) => t.disc_number ?? 1;
  const showDiscHeaders = new Set(tracks.map(discOf)).size > 1;

  // `track-table--no-album`: refleja un hecho estructural real (esta tabla NO tiene columna Álbum,
  // porque el contexto YA es un álbum). Lo usa la compactación con la cola abierta para sacrificar
  // primero Artista —redundante acá, todas las pistas son del mismo artista— en vez de Álbum.
  return (
    <table className={`track-table${showAlbum ? '' : ' track-table--no-album'}`}>
      <thead>
        <tr>
          <th className="col-num">#</th>
          <th>Título</th>
          <th className="col-artist">Artista</th>
          {showAlbum && <th className="col-album">Álbum</th>}
          <th className="col-quality">Calidad</th>
          <th className="col-time">⏱</th>
          <th className="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, i) => {
          const active = currentTrack?.id === track.id;
          const disc = discOf(track);
          const isNewDisc = showDiscHeaders && (i === 0 || discOf(tracks[i - 1]) !== disc);
          return (
            <Fragment key={track.id}>
              {isNewDisc && (
                <tr className="track-disc-header">
                  <td colSpan={showAlbum ? 7 : 6}>Disco {disc}</td>
                </tr>
              )}
              <TrackRow
                track={track}
                index={i}
                active={active}
                playing={active && isPlaying}
                showAlbum={showAlbum}
                rowRef={active ? activeRowRef : undefined}
                bindPress={bindPress}
                dragProps={dragProps}
                onPlay={onPlay}
                onCtx={onCtx}
              />
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// Fila memoizada (misma idea que LibraryRow; copias separadas a propósito, ver actions-lab §11).
// `active`/`playing` llegan calculados → al cambiar de canción sólo cambian 2 filas, en play/pausa 1.
// `rowRef` sólo lo recibe la fila activa (el auto-scroll a la pista que suena).
const TrackRow = memo(function TrackRow({ track, index, active, playing, showAlbum, rowRef, bindPress, dragProps, onPlay, onCtx }) {
  return (
    <tr
      ref={rowRef}
      className={`track-row${active ? ' playing' : ''}`}
      {...bindPress(track, {
        onClick: () => onPlay(index),
        onContextMenu: (e) => onCtx(e, track),
      })}
      {...dragProps(track)}
    >
      <td className="col-num">
        <span className={`track-num${active ? ' active' : ''}`}>
          {playing ? '▶' : (track.track_number ?? index + 1)}
        </span>
        <span className="track-play-icon">▶</span>
      </td>
      <td>
        <div className="track-info-cell">
          {/* draggable={false}: una <img> es arrastrable NATIVAMENTE, así que agarrar
              la fila por la carátula —el punto de agarre más natural— arrancaría el
              arrastre de la IMAGEN en vez del de la fila y el drop no encolaría nada. */}
          {track.cover_path
            ? <img className="track-art" src={coverUrl(track.id, { thumb: true })} alt="" loading="lazy" draggable={false} />
            : <div className="track-art-placeholder">♪</div>
          }
          <div className="track-text">
            <div className={`track-title${active ? ' active' : ''}`}>
              {track.title ?? 'Sin título'}
            </div>
            <div className="track-sub">
              <span className="track-artist">{track.artist ?? '—'}</span>
              <QualityChip track={track} className="chip-inline" />
            </div>
          </div>
        </div>
      </td>
      <td className="col-artist track-artist">{track.artist ?? '—'}</td>
      {showAlbum && <td className="col-album track-album">{track.album ?? '—'}</td>}
      <td className="col-quality"><QualityChip track={track} /></td>
      <td className="col-time">{fmt(track.duration)}</td>
      {/* El "⋯" reemplaza al "+": "agregar a playlist" es ahora un ítem del menú
          (fase D), así que una sola puerta por fila en vez de dos botones peleando
          los 46px de la celda. Ojo: en modo lista esta celda es display:none — ahí
          la puerta es el clic derecho, y es lo aceptado. */}
      <td className="col-actions">
        <ContextMenuButton type="track" item={track} />
      </td>
    </tr>
  );
});

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
