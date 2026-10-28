import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useContextMenu } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';
import { useDragQueue } from '../context/DragQueueContext.jsx';
import { stringHue, emojiHue } from '../utils/emojiHue.js';
import { contadorDeLista } from '../utils/playlistVideos.js';
import { matchArtist } from '../utils/artistMatch.js';
import {
  GROUPS, TITLES, LIMITS, EXPANDED_MAX, searchGroup, savedSearch, saveSearch,
} from '../utils/searchAll.js';
import { useSearchSources } from '../utils/searchSources.js';
import SearchBox from './SearchBox.jsx';
import TrackTable from './TrackTable.jsx';
import AlbumGrid from './AlbumGrid.jsx';
import ArtistImage from './ArtistImage.jsx';
import PlaylistCover from './PlaylistCover.jsx';
import VideoCard from './VideoCard.jsx';

// Vista «Buscar» (/search): una caja y, debajo, lo que coincide en TODA la música, en cinco grupos con
// su conteo (Canciones, Álbumes, Artistas, Playlists, Videos). Los grupos sin coincidencias no se pintan.
//
// Nada de lo que se ve es nuevo: cada grupo reusa el componente de su vista, así que reproducir, el menú
// contextual (clic derecho / long-press) y el arrastre a la cola funcionan igual que allá —
//   · canciones → TrackTable      · álbumes → AlbumGrid      · videos → VideoCard (como Videos.jsx)
//   · artistas  → el retrato de Artistas.jsx, con sus mismos hooks
//   · playlists → la tarjeta de Playlists.jsx (sin «eliminar»: borrar no es cosa de un buscador; y esa
//     lista no tiene menú ni arrastre, así que acá tampoco).
// Como en el resto de la app, la cola sale de lo que se VE: tocar una canción reproduce las canciones
// visibles de ese grupo desde ésa.
//
// La consulta vive en memoria (utils/searchAll.js), NO en la URL: abrir un resultado desmonta la vista y
// el atrás la restaura; F5 y entrar de nuevo desde el menú arrancan vacías. Tocar la pestaña activa (el
// `tab` de Layout.navigate) la limpia y enfoca la caja, como en las demás vistas.
//
// El filtrado es LOCAL y sin pedido por tecla (utils/searchAll.js). El input se pinta con `query`
// (urgente) y los resultados con su versión DIFERIDA: escribir nunca se traba por repintar tarjetas.
export default function Search({ target, clearTarget, navigate }) {
  // `target` con valor = se llegó por historial (atrás/adelante): se restaura lo escrito. Sin target es
  // una entrada nueva (menú, botón flotante, F5): vacía.
  const restored = useRef(!!target);
  const [query, setQueryState] = useState(() => (target ? savedSearch() : ''));
  const setQuery = useCallback((v) => { setQueryState(v); saveSearch(v); }, []);
  const inputRef = useRef(null);
  const [open, setOpen] = useState({});   // grupos con «Ver todo» abierto
  const src = useSearchSources();
  const q = useDeferredValue(query).trim();

  useEffect(() => {
    if (!restored.current) saveSearch('');
    // Escritorio: se puede escribir de una. En el teléfono no (el teclado taparía la pantalla): ahí se toca la caja.
    if (!restored.current && window.matchMedia('(min-width: 701px)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Tocar la pestaña ya activa (`tab`): limpia y enfoca. Sin `tab` es el atrás: se conserva todo.
  useEffect(() => {
    if (!target?.reset) return;
    if (target.tab) { setQuery(''); inputRef.current?.focus(); }
    clearTarget?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // «Ver todo» vuelve a su tamaño al limpiar la consulta (una búsqueda nueva empieza chica).
  useEffect(() => { if (!q) setOpen({}); }, [q]);

  const results = useMemo(
    () => Object.fromEntries(GROUPS.map((g) => [g, searchGroup(g, src[g].list, q)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src.songs.list, src.albums.list, src.artists.list, src.playlists.list, src.videos.list, q],
  );
  const hits = GROUPS.filter((g) => results[g].length > 0);
  const pending = GROUPS.filter((g) => src[g].status === 'loading');
  const failed = GROUPS.filter((g) => src[g].status === 'error');
  const names = (list) => list.map((g) => TITLES[g]).join(', ');

  const toggle = useCallback((g) => setOpen((o) => ({ ...o, [g]: !o[g] })), []);
  const retry = () => failed.forEach((g) => src[g].reload());

  // Menú, long-press y arrastre de los grupos que no traen su componente (artistas, videos).
  const { play } = usePlayer();
  const { openMenu } = useContextMenu();
  const { dragProps } = useDragQueue();
  const bindArtistPress = useLongPress((a, ev) => openMenu(ev, { type: 'artist', item: a, via: 'longpress' }));
  const libArtists = src.artists.list;
  // Como Videos.jsx: `artistLink` viaja en el payload del menú; el menú no compara nombres.
  const videoMenu = useCallback((v) => ({ type: 'video', item: v, artistLink: matchArtist(v.artist, libArtists) }), [libArtists]);
  const bindVideoPress = useLongPress((v, ev) => openMenu(ev, { ...videoMenu(v), via: 'longpress' }));

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openAlbum = useCallback((a) => navigateRef.current('albums', { album: a.album, album_artist: a.album_artist }), []);
  const openArtist = (name) => navigate('artists', { artist: name });
  const openPlaylist = (id) => navigate('playlists', { id });

  const body = (g, shown) => {
    switch (g) {
      case 'songs':
        // flat: lista mezclada de varios álbumes → sin «Disco N», numeración de resultados y sin saltar a la que suena.
        return <TrackTable tracks={shown} flat />;
      case 'albums':
        return <AlbumGrid albums={shown} onOpen={openAlbum} />;
      case 'artists':
        return (
          <div className="artist-grid artist-grid--still">
            {shown.map((a, i) => (
              <div
                key={a.artist}
                className="artist-portrait"
                style={{ '--i': i, '--h': stringHue(a.artist) }}
                {...bindArtistPress(a, {
                  onClick: () => openArtist(a.artist),
                  onContextMenu: (e) => openMenu(e, { type: 'artist', item: a }),
                })}
                {...dragProps(a, 'artist')}
              >
                <ArtistImage artist={a} />
                <div className="artist-portrait-info">
                  <div className="artist-portrait-name">{a.artist}</div>
                  <div className="artist-portrait-count">{a.album_count} álbumes · {a.track_count} pistas</div>
                </div>
              </div>
            ))}
          </div>
        );
      case 'playlists':
        return (
          <ul className="playlist-list playlist-list--still">
            {shown.map((pl, i) => (
              <li
                key={pl.id}
                className="playlist-item"
                style={{ '--h': emojiHue(pl.emoji), '--i': i }}
                tabIndex={0}
                onClick={() => openPlaylist(pl.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlaylist(pl.id); } }}
              >
                <span className="playlist-medallion">
                  <PlaylistCover ids={parseCovers(pl.sample_covers)} emoji={pl.emoji} lazy />
                </span>
                <div className="playlist-card-text">
                  <div className="playlist-name">{pl.name}</div>
                  <div className="playlist-meta">{contadorDeLista(pl.track_count ?? 0, pl.video_count)}</div>
                </div>
              </li>
            ))}
          </ul>
        );
      default:   // videos
        return (
          <div className="video-grid">
            {shown.map((v, i) => (
              <VideoCard
                key={v.id}
                video={v}
                artistLink={matchArtist(v.artist, libArtists)}
                onArtist={openArtist}
                press={bindVideoPress(v, {
                  onClick: () => play(shown, i),
                  onContextMenu: (e) => openMenu(e, videoMenu(v)),
                })}
              />
            ))}
          </div>
        );
    }
  };

  return (
    <div className="search-view">
      <div className="section-header">
        <h1 className="section-title">Buscar</h1>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar canciones, álbumes, artistas…"
          label="Buscar en toda la música"
          inputRef={inputRef}
        />
      </div>

      {!q ? (
        <div className="empty-state search-hint">
          <div className="empty-icon">🔎</div>
          <div className="empty-title">Busca en toda tu música</div>
          <div className="empty-sub">Canciones, álbumes, artistas, playlists y videos.</div>
        </div>
      ) : (
        <>
          {hits.map((g) => {
            const total = results[g].length;
            const isOpen = !!open[g];
            const shown = results[g].slice(0, isOpen ? EXPANDED_MAX : LIMITS[g]);
            return (
              <section key={g} className="search-group" data-group={g}>
                <header className="search-group-head">
                  <h2 className="search-group-title">{TITLES[g]}</h2>
                  <span className="search-group-count">{total}</span>
                  {total > LIMITS[g] && (
                    <button type="button" className="search-group-more" aria-expanded={isOpen} onClick={() => toggle(g)}>
                      {isOpen ? 'Ver menos' : 'Ver todo'}
                    </button>
                  )}
                </header>
                {body(g, shown)}
                {isOpen && total > EXPANDED_MAX && (
                  <p className="search-group-note">Mostrando {EXPANDED_MAX} de {total} · escribe más para afinar</p>
                )}
              </section>
            );
          })}

          {/* Una fuente que no cargó NO tumba a las demás: lo que sí hay se ve y esto avisa de lo que falta.
              Mientras falte una, no se afirma «sin resultados» (sería mentira a medias). */}
          {failed.length > 0 ? (
            <div className="search-status search-status--error" role="status">
              <span>No se pudieron cargar: {names(failed)}.</span>
              <button type="button" onClick={retry}>Reintentar</button>
            </div>
          ) : pending.length > 0 ? (
            <div className="search-status" role="status">Cargando {names(pending)}…</div>
          ) : hits.length === 0 ? (
            <div className="empty-state search-none">
              <div className="empty-icon">🔎</div>
              <div className="empty-title">Sin resultados para «{q}»</div>
              <div className="empty-sub">Prueba con otro título, artista o álbum.</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// Las carátulas de la tarjeta de playlist llegan como JSON en texto (igual que en Playlists.jsx).
function parseCovers(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}
