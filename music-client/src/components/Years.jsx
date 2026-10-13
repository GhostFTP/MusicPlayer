import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { api } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import ShuffleButton from './ShuffleButton.jsx';
import { yearsViewTracks, onLibraryChange, refreshLibraryIfStale } from '../utils/viewTracks.js';
import BackButton from './BackButton.jsx';
import SearchBox from './SearchBox.jsx';
import { foldForSearch } from '../utils/searchText.js';
import { useContextMenu } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';
import { useDragQueue } from '../context/DragQueueContext.jsx';

export default function Years({ target, clearTarget, setDetailOpen, navigate }) {
  const [years,    setYears]    = useState(null);
  const [sel,      setSel]      = useState(null);   // año seleccionado
  const [albums,   setAlbums]   = useState(null);

  useEffect(() => { api.years().then(setYears); }, []);

  // Menú sobre una FILA de año, igual que la tarjeta de género: clic derecho en escritorio y
  // pulsación larga en el teléfono (ContextMenu, case 'year': reproducir el año o mandarlo a la
  // cola). Y la fila se arrastra a la cola o a la barra (DragQueueContext, kind 'year'). El detalle
  // de un año no necesita nada: sus tarjetas son las de AlbumGrid, que ya traen el menú de álbum.
  const { openMenu } = useContextMenu();
  const bindPress = useLongPress((y, ev) => openMenu(ev, { type: 'year', item: y, via: 'longpress' }));
  const { dragProps } = useDragQueue();

  // Consumo del target de navegación: reset vuelve a la lista; { year } abre el detalle del año
  // (deep-link /years/2007 y pop de ruta). El year llega como NÚMERO (coerción en pathToState) →
  // matchea y.year (INTEGER) con ===.
  useEffect(() => {
    // Con `tab` (tocar la pestaña activa, ver Layout.navigate) además se borra el buscador; sin él es
    // el atrás desde el detalle de un año, que lo conserva.
    if (target?.reset) { setSel(null); setAlbums(null); if (target.tab) setQuery(''); clearTarget(); return; }
    if (target?.year == null || !years) return;
    const y = years.find(x => x.year === target.year);
    if (y) open(y);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, years]);

  // Reporta a Layout si hay un detalle abierto — lo usa el GATE del swipe-atrás de móvil. El
  // cleanup de desmontaje evita que quede colgado al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!sel); }, [sel, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  // BUSCADOR de la lista. Un solo campo con dos modos, según lo escrito:
  //   · sólo dígitos → por AÑO, desde el principio: "199" son los 90, "1994" es ese año;
  //   · con letras   → por ÁLBUM o ARTISTA: quedan los años que tienen alguna pista que coincide.
  // No usa useListFilter (filtra una lista por subcadena en campos fijos) porque acá el criterio
  // cambia con el texto y el modo de letras necesita la biblioteca, que la lista de años no trae
  // (el endpoint da sólo conteos). Es la que ya usa el Mix de Años (utils/viewTracks.js: la de
  // Biblioteca en memoria, o UN pedido), y se pide recién al escribir la primera letra. Mismo trato
  // que el hook: sin mayúsculas ni acentos, sin los espacios de los extremos, y la lista filtra con
  // la versión diferida del texto. La lista no tiene entrada escalonada: no hace falta --still.
  const [query, setQuery] = useState('');
  const [lib, setLib] = useState(null);   // pistas con año, para buscar por texto: null = sin pedir · 'error'
  const activeQuery = useDeferredValue(query).trim();
  const q = foldForSearch(activeQuery);
  const porAnio = /^\d+$/.test(q);
  const porTexto = q !== '' && !porAnio;
  useEffect(() => {
    if (!porTexto) { if (lib === 'error') setLib(null); return undefined; }   // al limpiar, un error se puede reintentar
    if (lib) return undefined;
    let vivo = true;
    yearsViewTracks().then((t) => { if (vivo) setLib(t); }, () => { if (vivo) setLib('error'); });
    return () => { vivo = false; };
  }, [porTexto, lib]);
  // La biblioteca en memoria puede quedar vieja (un escaneo con la pestaña abierta). Al escribir se
  // pide revalidarla —viewTracks decide: a lo sumo una vez por ventana, nunca por tecla— y, si
  // llega distinta, la lista se recalcula en el lugar: sin spinner y sin desmontar nada. Si llega
  // igual no hay aviso, así que no hay ni un render.
  useEffect(() => { if (porTexto) refreshLibraryIfStale(); }, [porTexto, q]);
  useEffect(() => {
    let vivo = true;
    const off = onLibraryChange(() => {
      yearsViewTracks().then((t) => { if (vivo) setLib((prev) => (Array.isArray(prev) ? t : prev)); }, () => {});
      api.years().then((ys) => { if (vivo) setYears(ys); }, () => {});   // los conteos y los años nuevos
    });
    return () => { vivo = false; off(); };
  }, []);
  const libFold = useMemo(() => (Array.isArray(lib)
    ? lib.map((t) => [t, foldForSearch(`${t.album ?? ''}\n${t.album_artist ?? ''}\n${t.artist ?? ''}`)])
    : null), [lib]);
  // Las pistas que coinciden con el texto: de ahí salen los años que se ven Y lo que mezcla el Mix.
  const matchTracks = useMemo(() => (porTexto && libFold ? libFold.filter(([, h]) => h.includes(q)).map(([t]) => t) : null), [porTexto, libFold, q]);
  const shown = useMemo(() => {
    if (!years || q === '') return years ?? [];
    if (porAnio) return years.filter((y) => String(y.year).startsWith(q));
    if (!matchTracks) return [];
    const con = new Set(matchTracks.map((t) => t.year));
    return years.filter((y) => con.has(y.year));
  }, [years, q, porAnio, matchTracks]);
  // Mix sin texto: toda la vista, como siempre. Por año: las pistas de los años que se ven.
  const mixDeLosVisibles = async () => { const ys = new Set(shown.map((y) => y.year)); return (await yearsViewTracks()).filter((t) => ys.has(t.year)); };

  async function open(y) {
    setSel(y);
    setAlbums(null);
    setAlbums(await api.albums({ year: y.year }));
  }

  // ── Detalle: los álbumes de un año ──
  if (sel) {
    return (
      <div>
        <BackButton label="Todos los años" view="years" onList={() => navigate('years')} />
        <div className="section-header">
          <h1 className="section-title">{sel.year}</h1>
        </div>
        {/* Fila de acciones B (Frente 2, M2d): debajo del título — Mix y contador. */}
        <div className="view-actions">
          <ShuffleButton getTracks={() => api.tracks({ year: sel.year, limit: 10000 })} count={sel.track_count} />
          <span className="section-count">{sel.album_count} álbumes · {sel.track_count} pistas</span>
        </div>
        {albums ? <AlbumGrid albums={albums} onOpen={(a) => navigate('albums', { album: a.album, album_artist: a.album_artist })} /> : <div className="spinner">Cargando…</div>}
      </div>
    );
  }

  if (!years) return <div className="spinner">Cargando años…</div>;
  if (years.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📅</div>
        <div className="empty-title">Sin años</div>
        <div className="empty-sub">Tus pistas no tienen año en las etiquetas.</div>
      </div>
    );
  }

  // ── Lista de años (uno por uno, desc) ──
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Años</h1>
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar año, álbum o artista…" label="Buscar en años" />
      </div>
      {/* Fila de acciones B (Frente 2, M2d): debajo del título, igual en todas las vistas — Mix y
          contador (los listados no tienen ▶ Reproducir). Los dos siguen lo que se ve: con texto, el
          Mix mezcla SÓLO las pistas que coinciden (no todo lo de esos años). */}
      <div className="view-actions">
        <ShuffleButton
          tracks={matchTracks ?? undefined}
          getTracks={matchTracks ? undefined : (q === '' ? yearsViewTracks : mixDeLosVisibles)}
          count={shown.reduce((s, y) => s + (y.track_count ?? 0), 0)}
        />
        <span className="section-count">{shown.length} {shown.length === 1 ? 'año' : 'años'}</span>
      </div>
      {porTexto && lib === null ? (
        <div className="spinner">Buscando…</div>
      ) : porTexto && lib === 'error' ? (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">No se pudo buscar</div>
          <div className="empty-sub">No se pudieron cargar los álbumes y artistas. Borra el texto e intenta de nuevo.</div>
        </div>
      ) : shown.length === 0 ? (
        // Hay años pero ninguno coincide: la cabecera y el buscador siguen arriba para corregir.
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div className="empty-title">Sin resultados para «{activeQuery}»</div>
        </div>
      ) : (
      <ul className="browse-list">
        {shown.map(y => (
          <li
            key={y.year}
            className="browse-item year-item"
            {...bindPress(y, {
              onClick: () => navigate('years', { year: y.year }),
              onContextMenu: (e) => openMenu(e, { type: 'year', item: y }),
            })}
            {...dragProps(y, 'year')}
          >
            <span className="browse-item-name">{y.year}</span>
            <span className="browse-item-meta">{y.album_count} álbumes · {y.track_count} pistas</span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
