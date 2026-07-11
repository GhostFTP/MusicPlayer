import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import QualityChip from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';
import ShuffleButton from './ShuffleButton.jsx';

// Orden AGRUPADO de la biblioteca (modo "Artista", DEFAULT): ALBUMARTIST → álbum
// → nº de pista → título. Así queda agrupada por artista/álbum y navegable;
// localeCompare respeta acentos. `sign` invierte SOLO el eje de artista (la
// agrupación): dentro de cada artista los álbumes y las pistas quedan siempre en
// orden natural (1→N), para que un disco se lea igual en asc y en desc. Con
// sign=1 es idéntico al orden que ve el usuario hoy → el default no cambia.
function groupedCompare(a, b, sign = 1) {
  const aa = (a.album_artist || a.artist || '').trim();
  const ba = (b.album_artist || b.artist || '').trim();
  let c = sign * aa.localeCompare(ba, 'es', { sensitivity: 'base' });
  if (c) return c;
  c = (a.album || '').localeCompare(b.album || '', 'es', { sensitivity: 'base' });
  if (c) return c;
  const at = a.track_number ?? 0, bt = b.track_number ?? 0;
  if (at !== bt) return at - bt;
  return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
}

export default function Library({ target, clearTarget }) {
  const [tracks,  setTracks]  = useState([]);   // crudo del backend (sin ordenar en cliente)
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [sortMode, setSortMode] = useState('artist'); // 'title'|'artist'|'album'|'year'|'duration'
  const [sortDir,  setSortDir]  = useState('asc');    // 'asc' | 'desc'
  const { play, currentTrack, isPlaying } = usePlayer();

  const fetchTracks = useCallback(async (q) => {
    setLoading(true);
    try {
      // Hogar central: traemos TODA la biblioteca (no el tope de 50 por defecto).
      const params = { limit: 10000 };
      if (q) params.search = q;
      const data = await api.tracks(params);
      // Guardamos el array crudo; el orden visible se deriva en cliente (useMemo)
      // según el Riel, para que el índice de play() coincida con la fila visible.
      setTracks(data);
      setError(null);
    } catch (e) {
      // No tragar el error: sin esto, un 401 dejaba `tracks` en su valor previo
      // y se veía "Biblioteca vacía" — indistinguible de una biblioteca real
      // vacía. Un 401 además dispara la reautenticación automática (client.js).
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchTracks(search), 280);
    return () => clearTimeout(t);
  }, [search, fetchTracks]);

  // Tap en la pestaña ya activa → limpiar el buscador (volver a la lista completa).
  // La Biblioteca no tiene "detalle", pero el filtro de búsqueda es su estado navegable.
  useEffect(() => {
    if (!target?.reset) return;
    setSearch('');
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Cambiar de modo arranca en su dirección natural (asc: A-Z / menor→mayor);
  // tocar el modo YA activo voltea la dirección (toggle asc/desc fusionado, igual
  // que el Riel de playlists).
  function cycleSort(key) {
    if (sortMode === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortMode(key);
      setSortDir('asc');
    }
  }

  // Orden visible derivado UNA vez: lo usan el .map(), el índice de play(), el
  // ShuffleButton y el contador → la fila que suena coincide con la vista.
  // sortTracks copia con [...tracks] → el array del fetch NUNCA se muta.
  const displayTracks = useMemo(
    () => sortTracks(tracks, sortMode, sortDir),
    [tracks, sortMode, sortDir]
  );

  const countLabel = search
    ? `${displayTracks.length} resultado${displayTracks.length === 1 ? '' : 's'}`
    : `${displayTracks.length} canción${displayTracks.length === 1 ? '' : 'es'}`;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Biblioteca</h1>
        <div className="search-box">
          <SearchIcon />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar título, artista, álbum…"
          />
        </div>
      </div>

      {/* Banner de acción: Mix aleatorio + contador */}
      <div className="library-actions">
        <ShuffleButton tracks={displayTracks} />
        {!loading && <span className="library-count">{countLabel}</span>}
      </div>

      {loading ? (
        <div className="spinner">Cargando…</div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">No se pudo cargar la biblioteca</div>
          <div className="empty-sub">Intenta de nuevo en un momento.</div>
          <button className="btn-primary" onClick={() => fetchTracks(search)}>Reintentar</button>
        </div>
      ) : tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          <div className="empty-title">Biblioteca vacía</div>
          <div className="empty-sub">
            Copia tus archivos de audio a <code>music/</code> y ejecuta <code>npm run scan</code>.
          </div>
        </div>
      ) : (
        <>
        {/* Riel de orden: REUSA las clases .pl-sort* de playlists (hue-neutras: sin
            --h caen al 265 morado-acento, coherente con el botón Mezclar de al lado).
            Cero CSS nuevo → flip de la flecha y prefers-reduced-motion vienen gratis. */}
        <div className="pl-sortbar" role="group" aria-label="Ordenar biblioteca">
          {SORT_MODES.map(m => {
            const isActive = sortMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                className={`pl-sort-seg${isActive ? ' active' : ''}`}
                aria-pressed={isActive}
                aria-label={isActive
                  ? `${m.label}, ${sortDir === 'asc' ? 'ascendente' : 'descendente'} (tocar para invertir)`
                  : `Ordenar por ${m.label}`}
                onClick={() => cycleSort(m.key)}
              >
                <span className="pl-sort-label">{m.label}</span>
                {isActive && (
                  <span className="pl-sort-arrow" key={sortDir} aria-hidden="true">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <table className="track-table">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th>Título</th>
              <th className="col-artist">Artista</th>
              <th className="col-album">Álbum</th>
              <th className="col-quality">Calidad</th>
              <th className="col-time">⏱</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {displayTracks.map((track, i) => {
              const active = currentTrack?.id === track.id;
              return (
                <tr
                  key={track.id}
                  className={`track-row${active ? ' playing' : ''}`}
                  onClick={() => play(displayTracks, i)}
                >
                  <td className="col-num">
                    <span className={`track-num${active ? ' active' : ''}`}>
                      {active && isPlaying ? '▶' : i + 1}
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
                          {/* En móvil las columnas colapsan: el chip viaja junto al título */}
                          <QualityChip track={track} className="chip-inline" />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="col-artist track-artist">{track.artist ?? '—'}</td>
                  <td className="col-album track-album">{track.album ?? '—'}</td>
                  <td className="col-quality">
                    <QualityChip track={track} />
                  </td>
                  <td className="col-time">{fmt(track.duration)}</td>
                  <td className="col-actions">
                    <AddToPlaylistMenu trackId={track.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}

// Modos del Riel de orden. "Artista" NO es un sort plano: delega en groupedCompare
// (album_artist → álbum → track#) para no romper la agrupación de Various Artists
// y los feats. Es el DEFAULT. El orden de segmentos sigue las columnas de la tabla.
const SORT_MODES = [
  { key: 'title',    label: 'Título'   },
  { key: 'artist',   label: 'Artista'  },
  { key: 'album',    label: 'Álbum'    },
  { key: 'year',     label: 'Año'      },
  { key: 'duration', label: 'Duración' },
];

// Ordena una COPIA (nunca muta el array del fetch). Nulos/vacíos SIEMPRE al fondo
// en ambas direcciones (no se invierten con el toggle). "artista" delega en el
// comparador agrupado; texto (título/álbum) usa localeCompare; año/duración son
// numéricos con desempate ESTABLE (año por artista→álbum→track#, duración por título).
function sortTracks(tracks, mode, dir) {
  const arr = [...tracks];
  const sign = dir === 'asc' ? 1 : -1;

  if (mode === 'artist') {
    arr.sort((a, b) => groupedCompare(a, b, sign));
    return arr;
  }

  if (mode === 'year' || mode === 'duration') {
    arr.sort((a, b) => {
      const av = numOrNull(a[mode]);
      const bv = numOrNull(b[mode]);
      if (av == null && bv == null) return tieBreak(a, b, mode);
      if (av == null) return 1;   // sin dato al fondo, sin importar la dirección
      if (bv == null) return -1;
      if (av !== bv) return sign * (av - bv);
      return tieBreak(a, b, mode); // empate → orden estable
    });
    return arr;
  }

  // texto: title | album
  const field = mode === 'album' ? 'album' : 'title';
  arr.sort((a, b) => {
    const av = a[field], bv = b[field];
    const aEmpty = av == null || av === '';
    const bEmpty = bv == null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;   // vacío al fondo, sin importar la dirección
    if (bEmpty) return -1;
    const c = sign * av.localeCompare(bv, 'es', { sensitivity: 'base', numeric: true });
    if (c) return c;
    // Álbum: desempatar por track# → título para que el disco se lea 1→N.
    if (field === 'album') {
      const at = a.track_number ?? 0, bt = b.track_number ?? 0;
      if (at !== bt) return at - bt;
      return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
    }
    return 0;
  });
  return arr;
}

// year/duration → número usable, o null si falta (null, 0, NaN → sin dato → al fondo).
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Desempate ESTABLE: "año" agrupa por artista→álbum→track#; "duración" por título.
function tieBreak(a, b, mode) {
  if (mode === 'year') return groupedCompare(a, b, 1);
  return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
