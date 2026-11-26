// La tarjeta «Inicia tu radio» de la vista Radio (1.46.0, R1): elegir QUÉ SUENA y empezar. Sin radio abierta.
// La lógica que decide (fuentes, por defecto, si reemplaza tu cola, textos) es pura: utils/radioInicio.js.
//
// ORDEN, como la app del iPhone: primero se cargan las canciones de la fuente y SUENAN (play, una función que ya
// existe del motor), después se crea la radio (iniciar de RadioContext). Si la fuente viene vacía o falla la carga,
// NO se crea la radio y se dice por qué. Si lo elegido ya suena y la radio no se pudo crear, se dice que sigue sonando
// solo para ti, con «Reintentar» (vuelve a crear la radio con lo que ya suena, sin volver a cargar nada).
// «Lo que estoy escuchando» no toca el reproductor: crea la radio con lo que hay.
//
// Cargadores que ya existían (no se agrega ninguno):
//   · Mix de toda la biblioteca → libraryTracks (utils/viewTracks.js), como el Mix de cada vista.
//   · playlist → api.playlists / api.playlistTracks (api/client.js), como Playlists.jsx.
//   · álbum → api.albums + albumTracks (utils/itemTracks.js), como el menú «Reproducir álbum».
//   · género → api.genres + genreTracks; año → api.years + yearTracks (utils/itemTracks.js).
//
// Colores (Oscar, para todo 1.46.0): nada de verde ni rojo (son de las calidades del audio); lo elegido en el lila de
// la app; el ámbar SOLO para avisos de rechazo (la fuente vacía, la carga o la creación que fallan).
// Íconos: el mismo juego monocromo de trazo de la app (Sidebar.jsx, y el de aleatorio de Player.jsx).
//
// Accesible: las fuentes son un grupo de <input type="radio"> nativos (teclado y lector de siempre); el selector de
// ítem es un <select> nativo con su <label>; el aviso de reemplazo describe al botón (aria-describedby); los errores
// van en una región role="alert" siempre montada.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import { libraryTracks } from '../utils/viewTracks.js';
import { textoDeFallo } from '../utils/radioSync.js';
import { albumTracks, genreTracks, yearTracks } from '../utils/itemTracks.js';
import {
  fuentesDisponibles, fuentePorDefecto, pideItem, reemplazaCola, opcionesDePlay, soloCanciones,
  TEXTO_REEMPLAZA, TEXTO_FALLO_CARGA, TEXTO_FALLO_LISTA, textoDeVacia, textoDeFalloAlIniciar, TEXTO_CON_VIDEO,
} from '../utils/radioInicio.js';

const cuenta = (n) => (Number.isFinite(n) ? ` · ${n} ${n === 1 ? 'canción' : 'canciones'}` : '');

// Por fuente con ítem: cómo se pide la lista, cómo se muestra cada ítem, su clave y sus canciones.
const ITEMS = {
  playlist: {
    lista: () => api.playlists(),
    rotulo: (p) => `${p.emoji ? `${p.emoji} ` : ''}${p.name}${cuenta(p.track_count)}`,
    clave: (p) => String(p.id),
    canciones: (p) => api.playlistTracks(p.id),
  },
  album: {
    lista: () => api.albums(),
    rotulo: (a) => `${a.album}${a.album_artist ? ` — ${a.album_artist}` : ''}${cuenta(a.track_count)}`,
    clave: (a) => `${a.album_artist ?? ''}\u0000${a.album}`,
    canciones: albumTracks,
  },
  genero: { lista: () => api.genres(), rotulo: (g) => `${g.genre}${cuenta(g.track_count)}`, clave: (g) => String(g.genre), canciones: genreTracks },
  anio: { lista: () => api.years(), rotulo: (y) => `${y.year}${cuenta(y.track_count)}`, clave: (y) => String(y.year), canciones: yearTracks },
};

// ── Íconos: los trazos de la app (24×24, trazo 2, redondeado, del color del texto) ──
const Svg = ({ children }) => (
  <svg className="radio-fuente-icono" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const ICONOS = {
  actual: <Svg><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></Svg>,
  mix: <Svg><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></Svg>,
  playlist: <Svg><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Svg>,
  album: <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></Svg>,
  genero: <Svg><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Svg>,
  anio: <Svg><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>,
};

export default function RadioInicio({ antes }) {
  const { currentTrack, play } = usePlayer();
  const { fase, iniciar } = useRadio();
  // FIX-146: un video no cuenta como «lo que estoy escuchando» (la radio arrancaría muda), pero sí como algo que suena:
  // elegir otra fuente lo reemplaza, y eso se avisa.
  const hayVideo = currentTrack?.kind === 'video';
  const hayCancion = !!currentTrack && !hayVideo;
  const algoSuena = !!currentTrack;
  const [fuente, setFuente] = useState(() => fuentePorDefecto(hayCancion));
  const [listas, setListas] = useState({});        // id → { estado: 'cargando' | 'ok' | 'error', items }
  const [elegido, setElegido] = useState({});      // id → clave del ítem elegido
  const [preparando, setPreparando] = useState(false);
  const [problema, setProblema] = useState(null);
  const [reintentar, setReintentar] = useState(false);   // lo elegido ya suena y la radio no se creó
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  const ids = { grupo: useId(), item: useId(), aviso: useId() };

  // «Lo que estoy escuchando» desaparece si deja de sonar algo: se pasa al Mix.
  useEffect(() => { if (fuente === 'actual' && !hayCancion) setFuente('mix'); }, [fuente, hayCancion]);

  // La lista de una fuente con ítem se pide la primera vez que se elige (y al reintentar).
  const pedirLista = (id) => {
    setListas((l) => ({ ...l, [id]: { estado: 'cargando', items: [] } }));
    ITEMS[id].lista().then(
      (items) => {
        if (!vivo.current) return;
        const arr = Array.isArray(items) ? items : [];
        setListas((l) => ({ ...l, [id]: { estado: 'ok', items: arr } }));
        setElegido((e) => (e[id] != null || !arr.length ? e : { ...e, [id]: ITEMS[id].clave(arr[0]) }));
      },
      () => { if (vivo.current) setListas((l) => ({ ...l, [id]: { estado: 'error', items: [] } })); },
    );
  };
  useEffect(() => { if (pideItem(fuente) && !listas[fuente]) pedirLista(fuente); }, [fuente]);   // eslint-disable-line react-hooks/exhaustive-deps

  const lista = listas[fuente];
  const itemElegido = pideItem(fuente) ? (lista?.items ?? []).find((x) => ITEMS[fuente].clave(x) === elegido[fuente]) ?? null : null;
  const reemplaza = reemplazaCola({ fuente, hayCancion: algoSuena }) && !reintentar;
  const creando = fase === 'creando';
  const ocupado = preparando || creando || fase !== 'sin-radio';
  const falta = pideItem(fuente) && !itemElegido;
  const limpiar = () => { setProblema(null); setReintentar(false); };

  /** Crea la radio con lo que ya suena; si no se pudo, lo dice y ofrece reintentar. */
  // FIX-146: el fallo lo dice SOLO esta tarjeta (con «Reintentar»): RadioContext no pone además el aviso de arriba.
  const crear = async (cancion) => {
    let motivo = null;
    const ok = await iniciar(cancion, { alFallar: (t) => { motivo = t; } });
    if (!ok && vivo.current) { setProblema(textoDeFalloAlIniciar(motivo, textoDeFallo('iniciar', {}))); setReintentar(true); }
  };

  const onIniciar = async () => {
    if (ocupado || falta) return;
    antes?.();
    limpiar();
    if (fuente === 'actual') { if (currentTrack) await crear(currentTrack); return; }   // FIX-146: su fallo también, en la tarjeta
    setPreparando(true);
    let canciones;
    try {
      canciones = soloCanciones(await (fuente === 'mix' ? libraryTracks() : ITEMS[fuente].canciones(itemElegido)));
    } catch {
      if (vivo.current) { setProblema(TEXTO_FALLO_CARGA); setPreparando(false); }
      return;
    }
    if (!vivo.current) return;
    if (!canciones.length) { setProblema(textoDeVacia(fuente)); setPreparando(false); return; }
    // Primero suena (función del motor que ya existe), después se crea la radio.
    play(canciones, 0, opcionesDePlay(fuente));
    setPreparando(false);
    await crear(canciones[0]);
  };

  // Reintentar: la radio con lo que YA suena (no se vuelve a cargar la fuente ni se toca la cola).
  const onReintentar = async () => {
    if (ocupado || !currentTrack) return;
    antes?.();
    limpiar();
    await crear(currentTrack);
  };

  const fuentes = fuentesDisponibles(hayCancion);
  const detalle = (f) => (f.id === 'actual' && currentTrack
    ? `${currentTrack.title ?? 'Sin título'}${currentTrack.artist ? ` — ${currentTrack.artist}` : ''}, y lo que sigue`
    : f.detalle ?? null);

  return (
    <section className="radio-card radio-inicio">
      <h2 className="radio-card-title">Inicia tu radio</h2>
      <fieldset className="radio-inicio-fuentes" disabled={ocupado}>
        <legend className="radio-inicio-paso" id={ids.grupo}>¿Qué suena?</legend>
        {hayVideo && <p className="radio-inicio-video">{TEXTO_CON_VIDEO}</p>}
        <div className="radio-inicio-grilla">
          {fuentes.map((f) => (
            <label key={f.id} className={`radio-fuente${fuente === f.id ? ' radio-fuente--on' : ''}`} data-fuente={f.id}>
              <input type="radio" name={ids.grupo} value={f.id} checked={fuente === f.id}
                onChange={() => { setFuente(f.id); limpiar(); }} />
              {ICONOS[f.id]}
              <span className="radio-fuente-texto">
                <span className="radio-fuente-titulo">{f.titulo}</span>
                {detalle(f) && <span className="radio-fuente-detalle">{detalle(f)}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {pideItem(fuente) && (
        <div className="radio-inicio-item">
          <label htmlFor={ids.item} className="radio-inicio-paso">{fuentes.find((f) => f.id === fuente)?.elegir}</label>
          {lista?.estado === 'error' ? (
            <p className="radio-aviso radio-inicio-lista-error">
              {TEXTO_FALLO_LISTA}{' '}
              <button type="button" className="radio-btn radio-btn--chico" onClick={() => pedirLista(fuente)}>Reintentar</button>
            </p>
          ) : (
            <select id={ids.item} className="radio-select" value={elegido[fuente] ?? ''} disabled={ocupado || lista?.estado !== 'ok'}
              onChange={(e) => { setElegido((x) => ({ ...x, [fuente]: e.target.value })); limpiar(); }}>
              {lista?.estado !== 'ok' && <option value="">Cargando…</option>}
              {lista?.estado === 'ok' && !lista.items.length && <option value="">No hay ninguno</option>}
              {(lista?.items ?? []).map((x) => <option key={ITEMS[fuente].clave(x)} value={ITEMS[fuente].clave(x)}>{ITEMS[fuente].rotulo(x)}</option>)}
            </select>
          )}
        </div>
      )}

      {reemplaza && <p id={ids.aviso} className="radio-inicio-reemplaza">{TEXTO_REEMPLAZA}</p>}
      <div className="radio-inicio-acciones">
        <button type="button" className="radio-btn radio-btn--iniciar" onClick={onIniciar} disabled={ocupado || falta}
          aria-describedby={reemplaza ? ids.aviso : undefined}>
          {preparando ? 'Preparando…' : creando ? 'Creando…' : 'Iniciar radio'}
        </button>
      </div>
      {/* Siempre montado (vacío sin problema): un role="alert" que aparece de golpe no siempre se anuncia. */}
      <p className="radio-aviso radio-inicio-problema" role="alert">{problema ?? ''}</p>
      {reintentar && (
        <div className="radio-inicio-reintentar">
          <button type="button" className="radio-btn" onClick={onReintentar} disabled={ocupado}>Reintentar</button>
        </div>
      )}
    </section>
  );
}
