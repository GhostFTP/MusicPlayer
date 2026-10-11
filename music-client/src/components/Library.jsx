import { memo, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import QualityChip from './QualityChip.jsx';
import ShuffleButton from './ShuffleButton.jsx';
import { useContextMenu, ContextMenuButton } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';
import { useDragQueue } from '../context/DragQueueContext.jsx';
import { fmtTotal } from '../utils/formatTotal.js';
import { foldForSearch, trackHaystack } from '../utils/searchText.js';
import { readCache, fetchFresh } from '../api/viewCache.js';
import { useWindowedRows } from '../utils/useWindowedRows.js';
import SearchBox from './SearchBox.jsx';

// Clave de la caché de vistas (viewCache.js): la biblioteca completa.
const LIB_CACHE_KEY = 'tracks:all';

// Comparadores de texto (Frente 1, sub-paso 9): UN Intl.Collator por configuración, creado una vez.
// `a.localeCompare(b, 'es', opts)` hace lo mismo (la especificación lo define como
// `new Intl.Collator('es', opts).compare`) pero resuelve el idioma en CADA comparación: ordenar 3000
// pistas pasaba de ~130 ms en el montaje. Mismo orden, verificado en los 10 modos/direcciones.
const COLL_ES = new Intl.Collator('es', { sensitivity: 'base' });
const COLL_ES_NUM = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// Orden AGRUPADO de la biblioteca (modo "Artista", DEFAULT): ALBUMARTIST → álbum
// → nº de pista → título. Así queda agrupada por artista/álbum y navegable;
// el collator respeta acentos. `sign` invierte SOLO el eje de artista (la
// agrupación): dentro de cada artista los álbumes y las pistas quedan siempre en
// orden natural (1→N), para que un disco se lea igual en asc y en desc. Con
// sign=1 es idéntico al orden que ve el usuario hoy → el default no cambia.
function groupedCompare(a, b, sign = 1) {
  const aa = (a.album_artist || a.artist || '').trim();
  const ba = (b.album_artist || b.artist || '').trim();
  let c = sign * COLL_ES.compare(aa, ba);
  if (c) return c;
  c = COLL_ES.compare((a.album || ''), b.album || '');
  if (c) return c;
  const at = a.track_number ?? 0, bt = b.track_number ?? 0;
  if (at !== bt) return at - bt;
  return COLL_ES.compare((a.title || ''), b.title || '');
}

export default function Library({ target, clearTarget }) {
  // Stale-while-revalidate (Frente 1, sub-paso 5): si ya se visitó la Biblioteca en esta sesión, el
  // PRIMER render ya trae la lista cacheada (sin spinner) y se revalida en segundo plano. Se lee en
  // el inicializador para que no haya ni un frame de "Cargando…".
  const [cached] = useState(() => readCache(LIB_CACHE_KEY));   // { data, sig } | undefined
  const sigRef = useRef(cached?.sig ?? null);                   // firma de lo que está en pantalla
  const [tracks,  setTracks]  = useState(() => cached?.data ?? []);   // biblioteca COMPLETA del backend (sin ordenar en cliente)
  const [search,  setSearch]  = useState('');   // lo que hay en el input: se actualiza al instante
  const [loading, setLoading] = useState(!cached);
  const [error,   setError]   = useState(null);
  const [hasLoaded, setHasLoaded] = useState(!!cached); // hubo al menos un load OK → el pill del contador queda montado
  const [libStats, setLibStats] = useState(() => (cached ? computeLibStats(cached.data) : null));    // stats de la biblioteca COMPLETA (se congelan; ver fetch)
  const [sortMode, setSortMode] = useState('artist'); // 'title'|'artist'|'album'|'year'|'duration'
  const [sortDir,  setSortDir]  = useState('asc');    // 'asc' | 'desc'
  const { play, currentTrack, isPlaying } = usePlayer();
  const { openMenu } = useContextMenu();   // clic derecho sobre la fila (desktop; el gate lo pone el menú)
  // C1 · long-press = el mismo menú en móvil (ver TrackTable, misma fila y mismo hook).
  const bindPress = useLongPress((track, ev) => openMenu(ev, { type: 'track', item: track, via: 'longpress' }));
  // Drag-to-enqueue (fase a): misma fila que TrackTable, mismo trato (ver el comentario de allá).
  const { dragProps } = useDragQueue();

  // Búsqueda LOCAL (Frente 1, sub-paso 4): se trae la biblioteca completa UNA vez y el buscador
  // filtra en memoria — sin request por tecla, sin debounce y sin spinner que desmonte la tabla.
  // El servidor sigue aceptando `search` (lo usa la app iOS); acá simplemente ya no se le pide.
  // `background`: revalidación con datos ya en pantalla → sin spinner y, si falla, se queda lo
  // cacheado sin mostrar error.
  const fetchTracks = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    try {
      // Hogar central: traemos TODA la biblioteca (no el tope de 50 por defecto).
      const fresh = await fetchFresh(LIB_CACHE_KEY, () => api.tracks({ limit: 10000 }));
      if (!fresh) return;   // cambió la cuenta mientras la petición estaba en vuelo → se descarta
      // Sólo si cambió algo: una revalidación idéntica no toca el estado (cero re-renders de filas).
      if (fresh.sig !== sigRef.current) {
        sigRef.current = fresh.sig;
        // Guardamos el array crudo; el orden visible se deriva en cliente (useMemo)
        // según el Riel, para que el índice de play() coincida con la fila visible.
        setTracks(fresh.data);
        // Stats del subtítulo: de la biblioteca completa (`data` lo es siempre) → el subtítulo
        // queda estable mientras el pill refleja el conteo filtrado.
        setLibStats(computeLibStats(fresh.data));
      }
      setHasLoaded(true);
      setError(null);
    } catch (e) {
      // No tragar el error: sin esto, un 401 dejaba `tracks` en su valor previo
      // y se veía "Biblioteca vacía" — indistinguible de una biblioteca real
      // vacía. Un 401 además dispara la reautenticación automática (client.js).
      // En segundo plano no se muestra: se queda lo cacheado.
      if (!background) setError(e);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTracks({ background: !!cached }); }, [fetchTracks]);

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

  // Texto normalizado de cada pista, calculado UNA vez por carga (no por tecla).
  const haystacks = useMemo(() => {
    const m = new Map();
    for (const t of tracks) m.set(t, trackHaystack(t));
    return m;
  }, [tracks]);

  // El input se pinta con `search` (urgente); la lista filtra con la versión DIFERIDA, así el
  // filtrado de cientos de filas nunca traba el tecleo (React lo hace en segundo plano y lo
  // descarta si llega otra tecla). Mismo criterio que el LIKE del servidor: subcadena de la frase
  // completa sobre título/artista/álbum, sin recortar espacios; "" = todo. Diferencia buscada:
  // también ignora acentos (ver foldForSearch). Filtrar la lista YA ordenada conserva el orden.
  const deferredSearch = useDeferredValue(search);
  // Los espacios de los EXTREMOS no cuentan, como en los demás listados (useListFilter): "daft " ==
  // "daft" y un texto de sólo espacios es "sin filtro". Se recorta ACÁ, en lo que se compara; el
  // estado `search` guarda lo tecleado tal cual (el campo muestra lo que escribiste).
  const activeSearch = deferredSearch.trim();
  const visibleTracks = useMemo(() => {
    const q = foldForSearch(activeSearch);
    if (!q) return displayTracks;
    return displayTracks.filter((t) => haystacks.get(t).includes(q));
  }, [displayTracks, haystacks, activeSearch]);

  // La cola se arma desde la lista VISIBLE (filtrada), como antes con los resultados del servidor.
  // Se lee de un ref que se fija DESPUÉS del commit: así onPlay es estable (las filas memoizadas no
  // se re-renderizan por cada tecla) y un render diferido descartado no puede dejar una lista que
  // no está en pantalla.
  const visibleRef = useRef(visibleTracks);
  useLayoutEffect(() => { visibleRef.current = visibleTracks; }, [visibleTracks]);

  // Handlers ESTABLES para LibraryRow (memo): la fila los llama con SUS datos (índice / pista), así
  // ninguna closure nueva por render le rompe el memo. onPlay sólo cambia si cambia la lista visible
  // — y ahí todas las filas cambian de verdad.
  const onPlay = useCallback((i) => play(visibleRef.current, i), [play]);
  const onCtx  = useCallback((e, track) => openMenu(e, { type: 'track', item: track }), [openMenu]);

  // Ventana (Frente 1, sub-paso 9): sólo se montan las filas visibles + overscan; el resto son
  // espaciadoras del mismo alto (ver utils/useWindowedRows.js). Quedan montadas aunque salgan de la
  // ventana la fila que se arrastra (sin ella se pierde su dragend) y la que tiene el foco.
  const [dragIndex, setDragIndex] = useState(null);
  const [focusIndex, setFocusIndex] = useState(null);
  const pinned = useMemo(() => [dragIndex, focusIndex], [dragIndex, focusIndex]);
  const { tbodyRef, segments, pitch, tableMode } = useWindowedRows(visibleTracks.length, { overscan: 10, pinned });
  const rowIndexOf = (e) => {
    const tr = e.target.closest?.('tr[data-index]');
    return tr ? Number(tr.dataset.index) : null;
  };
  const tbodyHandlers = {
    onDragStart: (e) => setDragIndex(rowIndexOf(e)),
    onDragEnd:   () => setDragIndex(null),
    onFocus:     (e) => setFocusIndex(rowIndexOf(e)),
    onBlur:      (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusIndex(null); },
  };

  // Filas memoizadas como ARREGLO: al teclear, el render urgente (sólo cambió `search`) recibe los
  // MISMOS elementos y React salta la tabla entera sin comparar fila por fila. Se rearman cuando
  // cambia la lista visible (render diferido), lo que suena o la ventana (al scrollear: las filas que
  // siguen en la ventana conservan su nodo y, por el memo, no se re-renderizan).
  const rowElements = useMemo(() => {
    const out = [];
    for (const seg of segments) {
      if (seg.type === 'gap') {
        // Espaciadora: alto = filas que representa × paso medido. Key estable para la de arriba y la
        // de abajo (no se remontan al scrollear); las intermedias (filas fijadas) por su inicio.
        const key = seg.from === 0 ? 'gap-top' : seg.to === visibleTracks.length ? 'gap-end' : `gap-${seg.from}`;
        out.push(
          <tr key={key} aria-hidden="true">
            <td colSpan={7} style={GAP_TD(seg.to - seg.from, pitch, tableMode)} />
          </tr>,
        );
        continue;
      }
      for (let i = seg.from; i < seg.to; i++) {
        const track = visibleTracks[i];
        const active = currentTrack?.id === track.id;
        out.push(
          <LibraryRow
            key={track.id}
            track={track}
            index={i}
            active={active}
            playing={active && isPlaying}
            bindPress={bindPress}
            dragProps={dragProps}
            onPlay={onPlay}
            onCtx={onCtx}
          />,
        );
      }
    }
    return out;
  }, [segments, pitch, tableMode, visibleTracks, currentTrack, isPlaying, bindPress, dragProps, onPlay, onCtx]);

  // Contador animado: el número sube 0→N SOLO en la carga inicial; en búsqueda
  // snapea + tick (ver useCountUp). El pill queda montado desde el primer load
  // (hasLoaded) para que el snap+tick se vea (no parpadea al re-buscar).
  const total = visibleTracks.length;
  const { shown, seq } = useCountUp(total, !loading, !!cached);
  const noun = countWord(total, !!activeSearch);
  const finalLabel = `${total} ${noun}`;   // texto FINAL (aria) — número real

  // Stats del header: identidad ESTABLE de la biblioteca completa (no repite el
  // conteo de pistas, que es del pill). Cada dato es un chip; la duración se omite
  // si fmtTotal devuelve null. Duración vía el util compartido.
  const stats = libStats
    ? [
        `${libStats.artists} ${plural(libStats.artists, 'artista', 'artistas')}`,
        `${libStats.albums} ${plural(libStats.albums, 'álbum', 'álbumes')}`,
        fmtTotal(libStats.duration),
      ].filter(Boolean)
    : null;

  return (
    <div>
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title">Biblioteca</h1>
            {stats && (
              <div className="lib-stats">
                {stats.map(s => <span key={s} className="lib-stat">{s}</span>)}
              </div>
            )}
          </div>
        </div>
        {/* El campo es el SearchBox de los listados (✕, foco visible, Esc que limpia o suelta el foco
            sin llegar al Esc global). Sólo el campo: el filtrado de abajo sigue siendo el de la
            Biblioteca (texto precalculado + valor diferido + ventana), no useListFilter. */}
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar título, artista, álbum…" label="Buscar en la biblioteca" />
      </div>

      {/* Banner de acción: Mix aleatorio + contador */}
      <div className="library-actions">
        <ShuffleButton tracks={visibleTracks} />
        {hasLoaded && !error && (
          // Pill accent-ghost (hermano muteado de Mezclar). aria-label lleva el
          // texto FINAL; los dígitos animados van aria-hidden → el lector no lee
          // los intermedios del count-up. key={seq} remonta el span en cada
          // búsqueda para replay del tick (seq>0 = ya hubo un cambio posterior).
          <span className="library-count" aria-label={finalLabel}>
            {/* Número (odómetro, mono): es lo que anima el count-up. key={seq}
                remonta el span en cada búsqueda para replay del tick. */}
            <span
              key={seq}
              aria-hidden="true"
              className={`lc-num${seq > 0 ? ' lc-tick' : ''}`}
            >
              {shown}
            </span>
            <span className="lc-word" aria-hidden="true">{noun}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="spinner">Cargando…</div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">No se pudo cargar la biblioteca</div>
          <div className="empty-sub">Intenta de nuevo en un momento.</div>
          <button className="btn-primary" onClick={() => fetchTracks()}>Reintentar</button>
        </div>
      ) : visibleTracks.length === 0 ? (
        // Mismo bloque y mismas clases para los dos vacíos; sólo cambia el texto. Con búsqueda activa
        // sobre una biblioteca que SÍ tiene pistas, no es "Biblioteca vacía": es que nada coincide.
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          {activeSearch && tracks.length > 0 ? (
            <div className="empty-title">Sin resultados para «{activeSearch}»</div>
          ) : (
            <>
              <div className="empty-title">Biblioteca vacía</div>
              <div className="empty-sub">
                Copia tus archivos de audio a <code>music/</code> y ejecuta <code>npm run scan</code>.
              </div>
            </>
          )}
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
        {/* aria-rowcount / aria-rowindex (sub-paso 10): con la ventana sólo están montadas las filas
            cercanas a la vista; así el lector anuncia el TOTAL de la lista actual (la filtrada si hay
            búsqueda) y la posición real de cada fila. Cabecera = fila 1, datos desde la 2. Sin
            aria-colcount: las 7 columnas están siempre en el DOM. */}
        <table className="track-table library-tracks" aria-rowcount={visibleTracks.length + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <th className="col-num">#</th>
              <th>Título</th>
              <th className="col-artist">Artista</th>
              <th className="col-album">Álbum</th>
              <th className="col-quality">Calidad</th>
              <th className="col-time">⏱</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody ref={tbodyRef} {...tbodyHandlers}>
            {rowElements}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}

// Estilo de la celda espaciadora de la ventana (ver rowElements): alto = n filas × paso.
// · Tabla (border-collapse): borde inferior transparente de 1 px como el de las filas reales; sin él,
//   la fila vecina pierde medio píxel del borde compartido.
// · Lista/móvil (filas en bloque): display:block y sin borde; una celda de tabla suelta crearía una
//   tabla anónima que hereda border-collapse y sumaría medio píxel.
const GAP_TD = (n, pitch, tableMode) => (tableMode
  ? { height: n * pitch, padding: 0, border: 0, borderBottom: '1px solid transparent' }
  : { display: 'block', height: n * pitch, padding: 0, border: 0 });

// Fila memoizada. Props primitivas o estables: `active`/`playing` se calculan en el padre, así que
// al cambiar de canción sólo cambian 2 filas (la que deja de sonar y la nueva) y en play/pausa 1.
// bindPress (useLongPress) y dragProps (useDragQueue) son estables; onPlay/onCtx vienen con
// useCallback. Las closures de abajo se crean SÓLO cuando la fila se re-renderiza.
const LibraryRow = memo(function LibraryRow({ track, index, active, playing, bindPress, dragProps, onPlay, onCtx }) {
  return (
    <tr
      className={`track-row${active ? ' playing' : ''}`}
      data-index={index}
      aria-rowindex={index + 2}
      {...bindPress(track, {
        onClick: () => onPlay(index),
        onContextMenu: (e) => onCtx(e, track),
      })}
      {...dragProps(track)}
    >
      <td className="col-num">
        <span className={`track-num${active ? ' active' : ''}`}>
          {playing ? '▶' : index + 1}
        </span>
        {/* El ▶ del hover es un ::after de esta celda (.library-tracks en main.css), no un nodo por
            fila: mismo lugar (último hijo de la celda), mismo display y color. */}
      </td>
      <td>
        <div className="track-info-cell">
          {/* draggable={false}: ver TrackTable — si no, agarrar por la carátula
              arrancaría el arrastre nativo de la imagen en vez del de la fila. */}
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
              {/* Sin chip inline (Frente 1, sub-paso 7): .chip-inline está en display:none en los tres
                  modos de la Biblioteca (tabla, lista ≤1024 y móvil: el modo lista lo apaga por
                  especificidad) → era un nodo por fila que nunca se ve. La calidad está en su columna. */}
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
      {/* Ver el comentario de TrackTable: el "⋯" reemplaza al "+" (playlist es un
          ítem del menú desde la fase D) y en modo lista manda el clic derecho. */}
      <td className="col-actions">
        <ContextMenuButton type="track" item={track} />
      </td>
    </tr>
  );
});

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
// comparador agrupado; texto (título/álbum) usa el collator; año/duración son
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
    const c = sign * COLL_ES_NUM.compare(av, bv);
    if (c) return c;
    // Álbum: desempatar por track# → título para que el disco se lea 1→N.
    if (field === 'album') {
      const at = a.track_number ?? 0, bt = b.track_number ?? 0;
      if (at !== bt) return at - bt;
      return COLL_ES.compare((a.title || ''), b.title || '');
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
  return COLL_ES.compare((a.title || ''), b.title || '');
}

// Cuenta 0→N con requestAnimationFrame SOLO en la carga inicial (primer load, sin
// búsqueda). Salta el count-up si N<15 o si el usuario pide reduced-motion → muestra
// el número directo. En cambios posteriores (búsqueda) snapea al valor y bumpea `seq`
// para disparar el tick. Cancela el rAF si el target/estado cambia a mitad o al
// desmontar. `active` = !loading (no animamos mientras carga).
// `fromCache`: la vista volvió con datos cacheados → el número arranca ya en su valor, sin el
// count-up 0→N (eso es para la PRIMERA carga de la sesión). Un valor igual al ya mostrado (volver
// con caché, revalidación sin cambios) no hace ni snap ni tick; uno distinto, el tick de siempre.
function useCountUp(target, active, fromCache = false) {
  const [shown, setShown] = useState(fromCache ? target : 0);
  const [seq,   setSeq]   = useState(0);   // 0 = aún sin cambio posterior; >0 = búsqueda → tick
  const didInit = useRef(fromCache);
  const lastTarget = useRef(fromCache ? target : null);
  const raf     = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);       // corta un count-up en curso si cambia target/active
    if (!active) return;                     // durante loading no animamos

    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!didInit.current) {
      didInit.current = true;
      lastTarget.current = target;
      if (reduce || target < 15) { setShown(target); return; }  // salta el count-up
      setShown(0);
      const dur = 900, t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);                   // easeOutCubic
        setShown(Math.round(eased * target));
        if (p < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf.current);
    }

    if (target === lastTarget.current) return;   // mismo número → nada que animar
    lastTarget.current = target;
    setShown(target);          // ya inicializado → snap directo
    setSeq(s => s + 1);        // → tick (el key remonta el span y replaya time-tick)
  }, [active, target]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);   // cleanup al desmontar
  return { shown, seq };
}

// Palabra del contador, pluralizada por el número FINAL: canciones / resultados.
function countWord(n, searching) {
  if (searching) return n === 1 ? 'resultado' : 'resultados';
  return n === 1 ? 'canción' : 'canciones';
}

// Stats agregadas de la biblioteca COMPLETA, derivadas del array de /api/tracks.
// Artistas = distinct album_artist||artist; álbumes = distinct (artista+álbum);
// duración = suma de duration. Puro cliente, cero backend.
function computeLibStats(tracks) {
  const artists = new Set();
  const albums  = new Set();
  let duration = 0;
  for (const t of tracks) {
    const a = (t.album_artist || t.artist || '').trim();
    if (a)       artists.add(a);
    if (t.album) albums.add(a + '|' + t.album);
    duration += t.duration || 0;
  }
  return { artists: artists.size, albums: albums.size, duration };
}

function plural(n, one, many) { return n === 1 ? one : many; }

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
