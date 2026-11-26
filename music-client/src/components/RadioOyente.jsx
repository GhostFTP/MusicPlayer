// La cara de quien ESCUCHA (y de quien MODERA) en la vista Radio (1.46.0, R3). Arriba, «La radio de <nombre>» con
// «En vivo», cuántos escuchan y «Salir de la radio». Debajo, en escritorio dos columnas: a la izquierda «Suena ahora»
// (portada grande, título, artista, «La pidió X», el avance, «Pausar para mí» y, para quien modera, «Siguiente» y
// «Pausar la radio») y «Después suena»; a la derecha quién escucha y lo que pasó. En el teléfono (≤700 px), pestañas
// de verdad Radio / Gente, una a la vez. Sin fila de peticiones ni buscador (llegan con el servidor en 1.47.0) y sin
// chat: la app no promete lo que todavía no tiene.
//
// SOLO con lo que ya existe (ni servidor ni motor nuevos):
//   · lo que suena y lo que sigue → la cola del oyente, que el puente arma con lo que publica la radio
//     ([la que suena, la siguiente]); «Pausar para mí» → togglePlay, el mismo play/pausa de la barra (te silencia a
//     ti, como hoy; play te devuelve al vivo);
//   · «Siguiente» y «Pausar la radio» de quien modera → ordenar(), las órdenes de siempre (con su línea de estado);
//   · quién escucha, quién modera, los eventos y el anuncio → RadioContext (quién modera llega en la misma lectura).
// El AVANCE es el hijo de RadioAnfitrion (usePlayerTime): el resto de la vista no se re-renderiza con el reloj.
//
// FIX-146: los avisos de la radio («Sin conexión…», «En pausa para ti…», el de la orden de quien modera) y «Toca para
// escuchar» van FUERA de las pestañas, debajo de la cabecera: siempre montados y a la vista en Radio y en Gente (antes,
// en el teléfono, se desmontaban en la pestaña Gente y no se veían ni se anunciaban). En escritorio, el mismo lugar.
// Para las suites: el contenedor conserva la clase .radio-card--oyente; adentro siguen .radio-aviso-vivo,
// .radio-evento (el anuncio), .radio-orden-estado, .radio-btn--orden con sus aria-label de siempre, .radio-ordenes-nota,
// .radio-btn--toca y «Salir de la radio» dentro de .radio-terminar.
import { useId, useRef, useState } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import { textoDeEvento, INSIGNIA, TEXTOS_ORDEN } from '../utils/radioSync.js';
import { CON_PISTA, EVENTOS_A_LA_VISTA, useTelefono, Avance, Portada } from './RadioAnfitrion.jsx';

const PESTANAS = [['radio', 'Radio'], ['gente', 'Gente']];
/** La insignia de quien transmite, en la lista del oyente. */
export const TEXTO_TRANSMITE = 'Transmite';

/** Cuántos escuchan, contándote (la lista del oyente te incluye; antes decía «1 oyente» y eras tú). */
export function cuantosEscuchan(total) {
  return total <= 1 ? 'Solo tú escuchando' : `${total} escuchando, contigo`;
}

export default function RadioOyente({ Avatar, oyenteRef, yo, textoAviso, tono, tocar }) {
  const { currentTrack, isPlaying, togglePlay, queue, queueIndex } = usePlayer();
  const {
    anfitrion, oyentes, moderadores, eventos, anuncio, aviso: avisoRadio, tocarParaEscuchar, limpiarFin, salir,
    vistaMod, ordenando, lineaOrden, esperaOrden, ordenar,
  } = useRadio();
  const telefono = useTelefono();
  const [pestana, setPestana] = useState('radio');
  const base = useId();
  const tabRefs = useRef({});

  const nombreHost = anfitrion?.name || 'el anfitrión';
  const esYo = (id) => id != null && yo != null && Number(id) === Number(yo);
  // Quién pidió cada canción: el último evento con pista que la nombra (los que ya existen: 'a-continuacion' / 'ahora').
  const pedidas = new Map();
  for (const e of eventos) if (CON_PISTA.has(e?.type) && e.trackId != null) pedidas.set(e.trackId, e);
  const pidio = (t) => {
    const ev = t ? pedidas.get(t.id) : null;
    if (!ev) return null;
    return esYo(ev.by) ? 'La pediste tú' : `La pidió ${ev.byName || 'alguien'}`;
  };

  // Lo que suena y lo que sigue. Con un video del anfitrión, la radio no muestra pista (el aviso lo explica).
  const conPista = avisoRadio !== 'video';
  const actual = conPista ? currentTrack : null;
  const despues = conPista && queueIndex >= 0 ? queue[queueIndex + 1] ?? null : null;

  // Quién escucha: quien transmite, quien modera, los demás y tú al final.
  const mods = new Set((moderadores ?? []).map((m) => m?.id));
  const otros = oyentes.filter((o) => !esYo(o.id));
  const yoEnLista = oyentes.find((o) => esYo(o.id)) ?? null;
  const gente = [
    ...otros.filter((o) => mods.has(o.id)),
    ...otros.filter((o) => !mods.has(o.id)),
  ];
  const total = otros.length + 1;
  const recientes = eventos.slice(-EVENTOS_A_LA_VISTA).reverse();

  // Lo de quien modera (W5b-1, igual que antes): aria-disabled durante la espera de un 429 (conserva el foco).
  const modera = vistaMod.modera;
  const pausada = vistaMod.playing === false;
  const tipoPausa = pausada ? 'reanudar' : 'pausa';
  const textoPausa = pausada ? 'Reanudar la radio' : 'Pausar la radio';
  const ocupadoPausa = !!(ordenando.pausa || ordenando.reanudar);
  const enEspera = esperaOrden > 0;

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
  const ver = (id) => !telefono || pestana === id;
  const panel = (id) => (telefono ? { id: panelId(id), role: 'tabpanel', 'aria-labelledby': tabId(id) } : {});

  return (
    <div className={`radio-card--oyente radio-transmite radio-escucha${telefono ? ' radio-transmite--pestanas' : ''}`}>
      <section className="radio-card radio-escucha-cabecera">
        <Avatar persona={anfitrion} grande />
        <div className="radio-escucha-quien">
          <h2 className="radio-anfitrion-nombre" ref={oyenteRef} tabIndex={-1}>
            <span className="radio-anfitrion-texto">La radio de <strong>{nombreHost}</strong></span>
          </h2>
          <p className="radio-escucha-sub">
            <span className="radio-en-vivo"><span className="radio-vivo" aria-hidden="true"></span>En vivo</span>
            {modera && <span className="radio-insignia">{INSIGNIA.moderador}</span>}
            <span className="radio-escucha-cuantos" aria-live="polite">{cuantosEscuchan(total)}</span>
          </p>
        </div>
        <div className="radio-terminar">
          <button type="button" className="radio-btn" onClick={() => { limpiarFin(); salir(); }}>Salir de la radio</button>
        </div>
      </section>

      <div className="radio-escucha-avisos">
        {tocar ? (
          <button type="button" className="radio-btn radio-btn--escuchar radio-btn--toca" onClick={tocarParaEscuchar}>
            Toca para escuchar
          </button>
        ) : null}
        {/* Siempre montadas (vacías sin texto): una región viva que aparece de golpe no siempre se anuncia. */}
        <p className={`radio-aviso-vivo radio-aviso-vivo--${tono}`} role="status" aria-live="polite">{textoAviso}</p>
        <p className="radio-orden-estado" role="status" aria-live="polite">{lineaOrden ? <span key={lineaOrden.n}>{lineaOrden.texto}</span> : null}</p>
      </div>

      {telefono && (
        <div className="radio-pestanas" role="tablist" aria-label="Partes de la radio" onKeyDown={onTabsKey}>
          {PESTANAS.map(([id, nombre]) => (
            <button key={id} type="button" role="tab" id={tabId(id)} aria-controls={panelId(id)} aria-selected={pestana === id}
              tabIndex={pestana === id ? 0 : -1} ref={(el) => { tabRefs.current[id] = el; }}
              className={`radio-pestana${pestana === id ? ' radio-pestana--on' : ''}`} onClick={() => setPestana(id)}>
              {nombre}
              {id === 'gente' ? <span className="radio-pestana-n"> · {total + 1}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* W5a: lo que pasó en la radio (eventos y aviso de rol), en su PROPIA región, siempre montada y a la vista en
          cualquier pestaña. Cada anuncio es un hijo con key: un texto repetido monta un nodo nuevo. */}
      <p className="radio-evento" role="status" aria-live="polite">{anuncio ? <span key={anuncio.n}>{anuncio.texto}</span> : null}</p>

      <div className="radio-transmite-cols">
        <div className="radio-transmite-col">
          {ver('radio') && (
            <div className="radio-panel" {...panel('radio')}>
              <section className="radio-card radio-ahora" aria-labelledby={`${base}-ahora`}>
                <Portada track={actual} />
                <div className="radio-ahora-datos">
                  <h2 id={`${base}-ahora`} className="radio-card-title">Suena ahora</h2>
                  {actual ? (
                    <>
                      <p className="radio-ahora-cancion">{actual.title ?? 'Sin título'}</p>
                      {actual.artist ? <p className="radio-ahora-artista">{actual.artist}</p> : null}
                      {pidio(actual) ? <p className="radio-ahora-pidio">{pidio(actual)}</p> : null}
                      <Avance />
                    </>
                  ) : <p className="radio-ahora-artista">Nada por ahora.</p>}
                  <div className="radio-fila radio-ahora-controles">
                    {!tocar && (
                      <button type="button" className="radio-btn" disabled={!actual} onClick={togglePlay}>
                        {isPlaying ? 'Pausar para mí' : 'Volver al vivo'}
                      </button>
                    )}
                    {modera && vistaMod.admite && vistaMod.conBase && (
                      <button type="button" className="radio-btn radio-btn--orden" aria-label="Siguiente canción de la radio"
                        aria-busy={ordenando.siguiente || undefined} aria-disabled={enEspera || undefined}
                        onClick={() => { if (!ordenando.siguiente && !enEspera) ordenar('siguiente'); }}>
                        Siguiente
                      </button>
                    )}
                    {modera && vistaMod.admite && (
                      <button type="button" className="radio-btn radio-btn--orden" aria-label={textoPausa}
                        aria-busy={ocupadoPausa || undefined} aria-disabled={enEspera || undefined}
                        onClick={() => { if (!ocupadoPausa && !enEspera) ordenar(tipoPausa); }}>
                        {textoPausa}
                      </button>
                    )}
                  </div>
                  {modera && !vistaMod.admite && <p className="radio-nota radio-ordenes-nota">{TEXTOS_ORDEN.sinOrdenes}</p>}
                </div>
              </section>

              {despues && (
                <section className="radio-card radio-despues" aria-labelledby={`${base}-despues`}>
                  <h2 id={`${base}-despues`} className="radio-card-title">Después suena</h2>
                  <div className="radio-cola-item">
                    <Portada track={despues} chica />
                    <span className="radio-cola-texto">
                      <span className="radio-cola-titulo">{despues.title ?? 'Sin título'}</span>
                      <span className="radio-cola-pidio">{[despues.artist, pidio(despues)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </div>
                </section>
              )}

              {telefono && (
                <button type="button" className="radio-ver-fila" onClick={() => irA('gente')}>
                  {`${cuantosEscuchan(total)} · ver quién`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="radio-transmite-col">
          {ver('gente') && (
            <div className="radio-panel" {...panel('gente')}>
              <section className="radio-card" aria-labelledby={`${base}-gente`}>
                <h2 id={`${base}-gente`} className="radio-card-title">Quién escucha</h2>
                <ul className="radio-personas radio-escucha-personas" aria-label="Quién está en la radio">
                  <li className="radio-persona">
                    <Avatar persona={anfitrion} />
                    <span className="radio-persona-nombre">{nombreHost}</span>
                    <span className="radio-insignia radio-insignia--anfitrion">{TEXTO_TRANSMITE}</span>
                  </li>
                  {gente.map((o) => (
                    <li key={o.id} className="radio-persona">
                      <Avatar persona={o} />
                      <span className="radio-persona-nombre">{o.name || 'Alguien'}</span>
                      {mods.has(o.id) && <span className="radio-insignia">{INSIGNIA.moderador}</span>}
                    </li>
                  ))}
                  <li className="radio-persona radio-persona--yo">
                    <Avatar persona={yoEnLista ?? { name: 'Tú' }} />
                    <span className="radio-persona-nombre">Tú</span>
                    {modera && <span className="radio-insignia">{INSIGNIA.moderador}</span>}
                  </li>
                </ul>
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
        </div>
      </div>
    </div>
  );
}
