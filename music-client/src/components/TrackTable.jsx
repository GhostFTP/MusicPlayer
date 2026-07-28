import { Fragment, useRef, useEffect } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { coverUrl } from '../api/client.js';
import QualityChip from './QualityChip.jsx';
import { useContextMenu, ContextMenuButton } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';

// Tabla de pistas reutilizable — mismo diseño de fila que la Biblioteca
// (carátula, jerarquía título/artista, QualityChip y botón "⋯" del menú contextual).
// `showAlbum`: oculta la columna Álbum cuando el contexto ya es un álbum.
export default function TrackTable({ tracks, showAlbum = true }) {
  const { play, currentTrack, isPlaying } = usePlayer();
  const { openMenu } = useContextMenu();   // clic derecho sobre la fila (desktop; el gate lo pone el menú)
  // C1 · long-press = el mismo menú en móvil. El hook envuelve onClick/onContextMenu de la fila:
  // un long-press ya no cuenta como tap (no reproduce) y el menú nativo queda prevenido.
  const bindPress = useLongPress((track, ev) => openMenu(ev, { type: 'track', item: track, via: 'longpress' }));
  const activeRowRef = useRef(null);

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
              <tr
                ref={active ? activeRowRef : null}
                className={`track-row${active ? ' playing' : ''}`}
                {...bindPress(track, {
                  onClick: () => play(tracks, i),
                  onContextMenu: (e) => openMenu(e, { type: 'track', item: track }),
                })}
              >
                <td className="col-num">
                  <span className={`track-num${active ? ' active' : ''}`}>
                    {active && isPlaying ? '▶' : (track.track_number ?? i + 1)}
                  </span>
                  <span className="track-play-icon">▶</span>
                </td>
                <td>
                  <div className="track-info-cell">
                    {track.cover_path
                      ? <img className="track-art" src={coverUrl(track.id)} alt="" />
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
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
