// La cara de QUIEN TRANSMITE en la vista Radio (1.46.0, R2). En escritorio, dos columnas que usan el ancho: a la
// izquierda el código, lo que suena (pausar / siguiente para todos) y la fila; a la derecha quién escucha, lo que pasó
// y «Terminar radio». En el teléfono (≤700 px), pestañas de verdad Radio / Fila / Gente, UNA a la vez, con el avance
// «Siguen N · ver fila» en Radio. Sin tarjeta de chat: la app no promete lo que todavía no tiene.
//
// SOLO con lo que ya existe (ni servidor ni motor nuevos):
//   · lo que suena, pausar y siguiente → currentTrack, isPlaying, togglePlay y next del reproductor (los de siempre:
//     tu reproductor ES la radio, así que pausar o pasar acá lo hace para todos);
//   · la fila → las canciones que el reproductor marca «a continuación» (upNext), en el orden de la cola (que ES el
//     orden en que van a sonar), y «Quitar» con removeFromQueue;
//   · quién la pidió → los eventos que ya existen ('a-continuacion' / 'ahora', con su trackId y su nombre); sin
//     evento (o si fuiste tú), es tuya;
//   · quién escucha y lo que pasó → oyentes, moderadores, sinSoporte y eventos de RadioContext.
// Quien escucha se cuenta SIN ti (antes «1 oyente» y debajo dos filas: Tú + la otra persona).
// El AVANCE vive en un hijo propio (usePlayerTime, ~4 Hz): el resto de la vista no se re-renderiza con el reloj.
//
// Colores (Oscar, todo 1.46.0): nada de verde ni rojo; insignias y lo activo en el lila de la app; «Terminar radio»
// en gris neutro (terminar no es un error). Textos sencillos.
import { useEffect, useId, useRef, useState } from 'react';
import { coverUrl } from '../api/client.js';
import { usePlayer, usePlayerTime } from '../context/PlayerContext.jsx';
import { cuentaDeOyentes, filaDeOyente, lineaDelTope, textoDeEvento, personasDeLaLista } from '../utils/radioSync.js';

const PESTANAS = [['radio', 'Radio'], ['fila', 'Fila'], ['gente', 'Gente']];
// Exportadas (CON_PISTA, EVENTOS_A_LA_VISTA, useTelefono, Avance, Portada): la vista del oyente (RadioOyente.jsx, R3)
// usa las mismas, así las dos caras se ven y se comportan igual.
export const CON_PISTA = new Set(['a-continuacion', 'ahora']);
export const EVENTOS_A_LA_VISTA = 8;
/** La nota de quien no puede moderar (su versión no lo admite, p. ej. desde el iPhone). */
export const TEXTO_SOLO_ESCUCHA = 'Solo escucha: su versión todavía no permite moderar.';

const mmss = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const personas = (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/** ¿Pantalla de teléfono? Reactivo: al cruzar los 700 px cambia de pestañas a columnas sin recargar. */
export function useTelefono() {
  const q = '(max-width: 700px)';
  const [si, setSi] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const al = () => setSi(m.matches);
    al();
    m.addEventListener?.('change', al);
    return () => m.removeEventListener?.('change', al);
  }, []);
  return si;
}

/** El avance de lo que suena: lo único que escucha el reloj. */
export function Avance() {
  const { currentTime, duration } = usePlayerTime();
  const pct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  return (
    <div className="radio-avance">
      <div className="radio-avance-barra" role="progressbar" aria-label="Avance de la canción" aria-valuemin={0}
        aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(currentTime || 0)}
        aria-valuetext={`${mmss(currentTime)} de ${mmss(duration)}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="radio-avance-tiempos" aria-hidden="true"><span>{mmss(currentTime)}</span><span>{mmss(duration)}</span></div>
    </div>
  );
}

/** Una portada (o un cuadro con una nota musical si la canción no tiene). */
export function Portada({ track, chica = false }) {
  const [rota, setRota] = useState(null);   // el id cuya imagen falló
  const src = track?.id != null && track?.cover_path && rota !== track.id ? coverUrl(track.id, { thumb: chica }) : null;
  return (
    <span className={`radio-portada${chica ? ' radio-portada--chica' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} onError={() => setRota(track.id)} /> : <span className="radio-portada-glifo">♪</span>}
    </span>
  );
}

export default function RadioAnfitrion({
  Avatar, miCodigo, oyentes, moderadores, sinSoporte, eventos, yo, fase,
  moderando, onModerar, copiar, confirmando, setConfirmando, onConfirmarKey, terminar, limpiarFin,
  copiarRef, terminarRef, noRef, listaRef, ultimoEvento, textoUltimo,
}) {
  const { currentTrack, isPlaying, togglePlay, next, queue, queueIndex, upNext, removeFromQueue } = usePlayer();
  const telefono = useTelefono();
  const [pestana, setPestana] = useState('radio');
  const terminando = fase === 'terminando';
  const base = useId();
  const tabRefs = useRef({});
  // _qid → el evento que la pidió. Se recuerda lo visto en la fila: cuando la canción pasa a sonar sigue diciendo
  // quién la pidió aunque su evento ya no sea el último.
  const pidioRef = useRef(new Map());
  const esMio = (ev) => ev != null && ev.by != null && yo != null && String(ev.by) === String(yo);

  // Quién pidió cada canción: el último evento con pista que la nombra.
  const pedidas = new Map();
  for (const e of eventos) if (CON_PISTA.has(e?.type) && e.trackId != null) pedidas.set(e.trackId, e);

  // La fila: lo marcado «a continuación», en el orden de la cola (el orden en que va a sonar).
  const fila = [];
  for (let i = queueIndex >= 0 ? queueIndex + 1 : 0; i < queue.length; i++) {
    const t = queue[i];
    if (!t || !upNext.has(t._qid)) continue;
    const ev = pedidas.get(t.id) ?? null;
    if (ev) pidioRef.current.set(t._qid, ev);
    fila.push({ t, ev: ev && !esMio(ev) ? ev : null });
  }
  // Lo que suena: «la pidió…» si pasó por la fila, o si el último evento fue un «ahora» con esa canción.
  const ultimo = eventos.length ? eventos[eventos.length - 1] : null;
  const evAhora = currentTrack ? (pidioRef.current.get(currentTrack._qid)
    ?? (ultimo?.type === 'ahora' && ultimo.trackId === currentTrack.id ? ultimo : null)) : null;
  const pidioAhora = evAhora && !esMio(evAhora) ? evAhora.byName || 'alguien' : null;

  const gente = personasDeLaLista({ oyentes, moderadores });
  const sinSop = new Set([...(sinSoporte instanceof Set ? sinSoporte : Array.isArray(sinSoporte) ? sinSoporte : [])]
    .map((x) => (x && typeof x === 'object' ? x.id : x)));
  const recientes = eventos.slice(-EVENTOS_A_LA_VISTA).reverse();
  const n = oyentes.length;
  const tope = lineaDelTope(moderadores);

  const irA = (id) => { setPestana(id); requestAnimationFrame(() => tabRefs.current[id]?.focus()); };
  const onTabsKey = (e) => {
    const i = PESTANAS.findIndex(([id]) => id === pestana);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % PESTANAS.length;
    else if (e.key === 'ArrowLeft') j = (i + PESTANAS.length - 1) % PESTANAS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = PESTANAS.length - 1;
    if (j == null) return;
    e.preventDefault();
    irA(PESTANAS[j][0]);
  };
  const tabId = (id) => `${base}-tab-${id}`;
  const panelId = (id) => `${base}-panel-${id}`;
  // En el teléfono cada panel es un tabpanel y sólo se monta el elegido; en escritorio se ven todos, sin roles de pestaña.
  const ver = (id) => !telefono || pestana === id;
  const panel = (id) => (telefono ? { id: panelId(id), role: 'tabpanel', 'aria-labelledby': tabId(id) } : {});

  return (
    <div className={`radio-transmite${telefono ? ' radio-transmite--pestanas' : ''}`}>
      {telefono && (
        <div className="radio-pestanas" role="tablist" aria-label="Partes de tu radio" onKeyDown={onTabsKey}>
          {PESTANAS.map(([id, nombre]) => (
            <button key={id} type="button" role="tab" id={tabId(id)} aria-controls={panelId(id)} aria-selected={pestana === id}
              tabIndex={pestana === id ? 0 : -1} ref={(el) => { tabRefs.current[id] = el; }}
              className={`radio-pestana${pestana === id ? ' radio-pestana--on' : ''}`} onClick={() => setPestana(id)}>
              {nombre}
              {id === 'fila' && fila.length ? <span className="radio-pestana-n"> · {fila.length}</span> : null}
              {id === 'gente' && n ? <span className="radio-pestana-n"> · {n}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* Lo último que pasó, siempre montado y a la vista en cualquier pestaña (una región viva escondida no se
          anuncia). Cada evento es un hijo con key: dos eventos con el mismo texto montan dos nodos. */}
      <p className="radio-evento" role="status">{ultimoEvento && textoUltimo ? <span key={ultimoEvento.id}>{textoUltimo}</span> : null}</p>

      <div className="radio-transmite-cols">
        <div className="radio-transmite-col">
          {ver('radio') && (
            <div className="radio-panel" {...panel('radio')}>
              <section className="radio-card radio-card--codigo">
                <h2 className="radio-card-title">Código de tu radio</h2>
                <p className="radio-codigo radio-codigo--grande" aria-label={`Código ${miCodigo.split('').join(' ')}`}>
                  <span>{miCodigo.slice(0, 3)}</span><span>{miCodigo.slice(3)}</span>
                </p>
                <div className="radio-fila radio-acciones">
                  <button type="button" ref={copiarRef} className="radio-btn" disabled={terminando}
                    onClick={() => copiar(miCodigo, 'Código copiado')}>Copiar código</button>
                  <button type="button" className="radio-btn" disabled={terminando}
                    onClick={() => copiar(`${window.location.origin}/radio/${miCodigo}`, 'Enlace copiado')}>Copiar enlace</button>
                </div>
              </section>

              <section className="radio-card radio-ahora" aria-labelledby={`${base}-ahora`}>
                <Portada track={currentTrack} />
                <div className="radio-ahora-datos">
                  <h2 id={`${base}-ahora`} className="radio-card-title">Suena ahora</h2>
                  {currentTrack ? (
                    <>
                      <p className="radio-ahora-cancion">{currentTrack.title ?? 'Sin título'}</p>
                      {currentTrack.artist ? <p className="radio-ahora-artista">{currentTrack.artist}</p> : null}
                      {pidioAhora ? <p className="radio-ahora-pidio">La pidió {pidioAhora}</p> : null}
                      <Avance />
                    </>
                  ) : <p className="radio-ahora-artista">Nada por ahora.</p>}
                  <div className="radio-fila radio-ahora-controles">
                    <button type="button" className="radio-btn" disabled={terminando || !currentTrack} onClick={togglePlay}>
                      {isPlaying ? 'Pausar para todos' : 'Reanudar para todos'}
                    </button>
                    <button type="button" className="radio-btn" disabled={terminando || !currentTrack} onClick={next}>Siguiente</button>
                  </div>
                </div>
              </section>

              {telefono && (
                <button type="button" className="radio-ver-fila" onClick={() => irA('fila')}>
                  {fila.length ? `Siguen ${fila.length} · ver fila` : 'Nada pedido todavía · ver fila'}
                </button>
              )}
            </div>
          )}

          {ver('fila') && (
            <section className="radio-card radio-panel" aria-labelledby={`${base}-fila`} {...panel('fila')}>
              <h2 id={`${base}-fila`} className="radio-card-title">La fila</h2>
              {fila.length ? (
                <ol className="radio-cola">
                  {fila.map(({ t, ev }, i) => (
                    <li key={t._qid} className="radio-cola-item">
                      <span className="radio-cola-n" aria-hidden="true">{i + 1}</span>
                      <Portada track={t} chica />
                      <span className="radio-cola-texto">
                        <span className="radio-cola-titulo">{t.title ?? 'Sin título'}</span>
                        <span className="radio-cola-pidio">{ev ? `La pidió ${ev.byName || 'alguien'}` : 'La pusiste tú'}</span>
                      </span>
                      <button type="button" className="radio-btn radio-btn--cola" disabled={terminando}
                        aria-label={`Quitar «${t.title ?? 'Sin título'}» de la fila`} onClick={() => removeFromQueue(t._qid)}>Quitar</button>
                    </li>
                  ))}
                </ol>
              ) : <p className="radio-nota radio-cola-vacia">Nadie pidió nada todavía. Quienes moderan pueden poner una canción «a continuación».</p>}
              <p className="radio-cola-luego">Luego, tu música.</p>
            </section>
          )}
        </div>

        <div className="radio-transmite-col">
          {ver('gente') && (
            <div className="radio-panel" {...panel('gente')}>
              <section className="radio-card" aria-labelledby={`${base}-gente`}>
                <h2 id={`${base}-gente`} className="radio-card-title">Quién escucha</h2>
                <p className="radio-oyentes" aria-live="polite">{cuentaDeOyentes(n)}</p>
                <ul className="radio-personas" aria-label="Quién escucha tu radio" ref={listaRef} tabIndex={-1}>
                  {gente.map((o) => {
                    const f = filaDeOyente({ id: o.id, moderadores, sinSoporte, ausente: o.ausente });
                    const nombre = o.name || 'Alguien';
                    const nota = sinSop.has(o.id) ? TEXTO_SOLO_ESCUCHA : f.nota;
                    return (
                      <li key={o.id} className="radio-persona">
                        <Avatar key="avatar" persona={o} />
                        <span key="nombre" className="radio-persona-nombre">{nombre}</span>
                        {f.insignia && <span key="insignia" className="radio-insignia">{f.insignia}</span>}
                        {f.boton && (
                          <button key="boton" type="button" className="radio-btn radio-btn--persona" data-persona={o.id}
                            disabled={terminando} aria-busy={moderando === o.id ? 'true' : undefined}
                            aria-label={f.boton === 'quitar' ? `Quitar a ${nombre} de moderar` : `Hacer moderador a ${nombre}`}
                            onClick={() => onModerar(o, f.boton === 'nombrar')}>
                            {f.boton === 'quitar' ? 'Quitar rol' : 'Hacer moderador'}
                          </button>
                        )}
                        {nota && <span key="nota" id={`radio-persona-nota-${o.id}`} className="radio-persona-nota" tabIndex={-1}>{nota}</span>}
                      </li>
                    );
                  })}
                </ul>
                {tope && <p className="radio-nota radio-tope">{tope}</p>}
              </section>

              <section className="radio-card" aria-labelledby={`${base}-paso`}>
                <h2 id={`${base}-paso`} className="radio-card-title">Lo que pasó</h2>
                {recientes.length ? (
                  <ul className="radio-eventos">
                    {recientes.map((e) => { const tx = textoDeEvento(e, yo); return tx ? <li key={e.id}>{tx}</li> : null; })}
                  </ul>
                ) : <p className="radio-nota">Todavía no pasó nada.</p>}
              </section>
            </div>
          )}

          {/* Terminar: en escritorio al pie de la derecha; en el teléfono, en la pestaña Radio. */}
          {ver('radio') && (
            <div className="radio-terminar">
              {confirmando ? (
                <div className="radio-confirmar" role="group" aria-labelledby="radio-confirmar-pregunta" onKeyDown={onConfirmarKey}>
                  <span id="radio-confirmar-pregunta" className="radio-confirmar-pregunta">
                    ¿Terminar la radio? {n ? `Se ${n === 1 ? 'le' : 'les'} cierra a ${personas(n)}.` : 'No hay nadie escuchando.'}
                  </span>
                  <button type="button" className="radio-btn radio-btn--terminar" disabled={terminando} onClick={terminar}>
                    {terminando ? 'Terminando…' : 'Sí, terminar'}
                  </button>
                  <button type="button" ref={noRef} className="radio-btn" disabled={terminando} onClick={() => setConfirmando(false)}>No</button>
                </div>
              ) : (
                <button type="button" ref={terminarRef} className="radio-btn radio-btn--terminar" disabled={terminando}
                  onClick={() => { limpiarFin(); setConfirmando(true); }}>Terminar radio</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
