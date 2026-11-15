import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import QualityChip from '../components/QualityChip.jsx';
import { libraryTracks, onLibraryChange } from '../utils/viewTracks.js';
import { useListFilter } from '../utils/useListFilter.js';
import { useWindowedRows } from '../utils/useWindowedRows.js';
import { crearMotor, MEZCLA_INICIAL } from './motor/motor.js';
import { antesDeBajar, cargarPista, mbTexto } from './motor/carga.js';
import { filtroFrecuencias, LP_NEUTRA, HP_NEUTRA } from './motor/mezcla.js';
import { crearConexionMidi } from './motor/midi.js';

// MODO DJ (V1). Sub-paso a: la página y la CONVIVENCIA con el reproductor normal. Sub-paso b: el motor
// de audio propio (motor/motor.js, un AudioContext con dos decks) y la carga de una pista en A o B
// (motor/carga.js). Sub-paso c: la sección «Mezcla» (volumen de cada deck, crossfader y filtro) con el
// ratón; los valores viven en el motor. Sub-paso d: el DDJ-400 por Web MIDI (motor/midi.js) mueve esos
// mismos valores, directo a los setters del motor, sin pasar por React. Nada de esto toca PlayerContext.
//  · La consola se re-renderiza con los avisos del motor AGRUPADOS por requestAnimationFrame: un fader
//    del DDJ-400 manda decenas de mensajes por segundo y cada uno llega en su propia tarea, así que sin
//    agrupar sería un render por mensaje. Con el ratón el render sigue siendo inmediato (el <input> es
//    controlado: si esperara al cuadro, el navegador lo devolvería a su valor anterior entre medio).
//  · ?diag=1 (/dj?diag=1): expone window.__djMidi = { stats(), reiniciar() } con el retraso MIDI →
//    AudioParam. Se lee en el PRIMER render: Layout, al montar, canoniza la URL con replaceState('/dj')
//    y la query desaparece de la barra (pathToState sólo mira el pathname). Sin ?diag=1 no se mide nada.
//    Con ?diag=1 también window.__djCue (sub-paso e2b): el cue a audífonos del motor, para probarlo con
//    el hardware desde la consola antes de que haya selector. Desde e2c, fijarSalidaCue(id, nombre,
//    { canales: '3-4' }) manda el cue a los canales 3-4 (el jack de audífonos de la DDJ-400); sin
//    opciones, por los 1-2 como siempre.
//
//  · Radio activa (fase distinta de 'sin-radio'): la página sólo pide salir de la radio y NO toma
//    nada (no pausa, no tapa teclas, NO monta la consola → no crea AudioContext). La barra del
//    reproductor sigue visible (Layout no pone .layout--dj).
//  · Sin radio: al entrar (o cuando la radio termina estando acá) se guarda si sonaba y se llama a
//    pause(). Al salir NO se reanuda solo: si sonaba, sale el aviso «Reanuda con play».
//  · Mientras la página está montada y SIN radio, un keydown en window en fase de CAPTURA hace
//    preventDefault de Espacio, ←, → y M y F. Los atajos globales (Espacio y ←/→ en PlayerContext, la M en
//    useMixShortcut, la F en useVideoFullscreenShortcut) escuchan en burbuja y lo primero que miran es
//    e.defaultPrevented, así que se callan sin tocarlos. No se tapa nada con Ctrl, Alt o Meta (Ctrl+F
//    busca en la página, Alt+← es el atrás del navegador), ni con el foco en un campo de texto.
//    La barra de posición de un deck y los controles de «Mezcla» son <input type="range">: ahí
//    Espacio y las flechas son del control (los atajos ya ignoran los <input>), pero M y F se siguen
//    tapando, porque
//    useVideoFullscreenShortcut NO excluye los range y la F abriría la pantalla completa del
//    reproductor normal.
//  · El tiempo de cada deck se pinta con requestAnimationFrame leyendo el reloj del AudioContext
//    (deck.posicion()), escribiendo directo en el DOM: React no se entera de cada frame.

export const TECLAS_TAPADAS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyF']);
const CAMPOS = 'input, textarea, select';
const TAPADAS_EN_RANGO = new Set(['KeyM', 'KeyF']);

export default function DjPage() {
  const { isPlaying, pause } = usePlayer();
  const { fase } = useRadio();
  const toast = useToast();
  const radioActiva = fase !== 'sin-radio';
  // ?diag=1 se lee en el primer render (antes del replaceState de Layout, que borra la query).
  const [diag] = useState(leerDiag);

  // Se lee por ref: el efecto de la pausa NO depende de isPlaying (si no, volvería a correr al pausar).
  const sonandoRef = useRef(isPlaying);
  sonandoRef.current = isPlaying;
  const sonabaRef = useRef(false);   // ¿sonaba algo cuando el Modo DJ lo pausó?
  const avisoRef  = useRef(null);    // temporizador del aviso al salir (ver la limpieza)

  useEffect(() => {
    if (radioActiva) return undefined;
    // En desarrollo, StrictMode desmonta y vuelve a montar los efectos una vez: el aviso de esa
    // limpieza simulada se cancela acá y no sale. En producción no hay remontaje.
    clearTimeout(avisoRef.current);
    if (sonandoRef.current) {
      sonabaRef.current = true;
      pause();
    }
    return () => {
      if (!sonabaRef.current) return;
      avisoRef.current = setTimeout(() => {
        sonabaRef.current = false;
        toast('Reanuda con play', { icon: '⏸' });
      }, 0);
    };
  }, [radioActiva, pause, toast]);

  // Con radio activa no se tapa nada: el reproductor normal es el que suena y sus atajos siguen vivos.
  useEffect(() => {
    if (radioActiva) return undefined;
    const onKey = (e) => {
      if (!TECLAS_TAPADAS.has(e.code)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (t?.tagName === 'INPUT' && t.type === 'range') {
        if (!TAPADAS_EN_RANGO.has(e.code)) return;
      } else if (t?.closest?.(CAMPOS) || t?.isContentEditable) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [radioActiva]);

  return (
    <div className="dj-page">
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title">Modo DJ</h1>
          </div>
        </div>
      </div>

      {/* Sólo se ve por debajo de 900 px (main.css). */}
      <p className="dj-aviso dj-solo-escritorio" role="note">El Modo DJ es solo para escritorio</p>

      {radioActiva
        ? <p className="dj-aviso dj-aviso-radio" role="status">Sal de la radio para usar el Modo DJ</p>
        : <ConsolaDj diag={diag} />}
    </div>
  );
}

// ── Consola: el motor, los dos decks y la biblioteca ─────────────────────────────────────────────

const LADOS = ['A', 'B'];
function leerDiag() {
  try { return new URLSearchParams(window.location.search).get('diag') === '1'; } catch { return false; }
}
const DECK_VACIO = Object.freeze({ cargando: null, aviso: null, confirmar: null });

function mmss(seg) {
  if (!Number.isFinite(seg) || seg < 0) return '0:00';
  const s = Math.floor(seg);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const khz = (hz) => `${String(Math.round(hz / 100) / 10).replace('.', ',')} kHz`;

function ConsolaDj({ diag }) {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // El motor se crea al montar pero SIN AudioContext (lo crea el primer «Cargar»). Al desmontar se
  // cierra: para lo que suena, suelta los buffers y cierra el contexto, y (alCerrar) la conexión MIDI
  // quita sus oyentes.
  const motorRef = useRef(null);
  const midiRef = useRef(null);
  const [midi, setMidi] = useState({ estado: 'inactivo', nombre: null });
  const [, setVersion] = useState(0);
  const refrescar = useCallback(() => setVersion((v) => v + 1), []);
  // Avisos del motor → a lo sumo UN render por cuadro. `pendienteRef` se apaga en cada render ya pintado
  // (useLayoutEffect de abajo): si el ratón ya forzó el render, el cuadro no repite otro.
  const pendienteRef = useRef(false);
  const controlesRef = useRef({ A: null, B: null });   // AbortController de la carga en curso por deck
  useEffect(() => {
    const m = crearMotor();
    motorRef.current = m;
    let cuadro = 0;
    const quitar = m.suscribir(() => {
      pendienteRef.current = true;
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => { cuadro = 0; if (pendienteRef.current) setVersion((v) => v + 1); });
    });
    const conexion = crearConexionMidi({ motor: m, diag, alCambiar: () => setMidi(conexion.estado()) });
    midiRef.current = conexion;
    setMidi(conexion.estado());
    conexion.autoConectar();
    const expuesto = diag ? { stats: () => conexion.stats(), reiniciar: () => conexion.reiniciar() } : null;
    if (expuesto) window.__djMidi = expuesto;
    // Sub-paso e2b: el cue a audífonos desde la consola, antes de que exista el selector. Envoltorios finos
    // del motor; sólo con ?diag=1. fijarCue(lado, true) crea el contexto de cue y NECESITA UN GESTO DEL
    // USUARIO (si no, el contexto nace 'suspended'): desde la consola de Edge sirve porque la página ya
    // tuvo clics (la activación del usuario queda pegada a la página). Ej.: tras «Cargar» y play en A,
    //   const s = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    //   await __djCue.fijarSalidaCue(s[1].deviceId, s[1].label); __djCue.fijarCue('A', true); __djCue.diag();
    // Con la DDJ-400 (audífonos en los canales 3-4): __djCue.fijarSalidaCue(id, nombre, { canales: '3-4' }).
    const expuestoCue = diag ? {
      fijarSalidaCue: (deviceId, nombre, opciones) => m.fijarSalidaCue(deviceId, nombre, opciones),
      fijarCue: (lado, activo) => m.fijarCue(lado, activo),
      fijarVolumenCue: (v) => m.fijarVolumenCue(v),
      fijarDesfaseCue: (ms) => m.fijarDesfaseCue(ms),
      cue: () => m.cue(),
      diag: () => m.diagCue(),
    } : null;
    if (expuestoCue) window.__djCue = expuestoCue;
    setVersion((v) => v + 1);
    const controles = controlesRef.current;
    return () => {
      quitar();
      cancelAnimationFrame(cuadro);
      for (const lado of LADOS) { controles[lado]?.abort(); controles[lado] = null; }
      m.cerrar();          // también cierra la conexión MIDI (alCerrar)
      conexion.cerrar();   // idempotente
      if (expuesto && window.__djMidi === expuesto) delete window.__djMidi;
      if (expuestoCue && window.__djCue === expuestoCue) delete window.__djCue;
      if (motorRef.current === m) motorRef.current = null;
      if (midiRef.current === conexion) midiRef.current = null;
    };
  }, [diag]);
  useLayoutEffect(() => { pendienteRef.current = false; });
  const conectarMidi = useCallback(() => { midiRef.current?.conectar(); }, []);

  const [ui, setUi] = useState({ A: DECK_VACIO, B: DECK_VACIO });
  const ponerUi = useCallback((lado, cambios) => setUi((u) => ({ ...u, [lado]: { ...u[lado], ...cambios } })), []);

  const cargar = useCallback(async (lado, pista, { forzar = false } = {}) => {
    // El contexto se crea ANTES de revisar la pista, dentro del clic (el gesto que Chrome pide): así
    // antesDeBajar estima la memoria con su sampleRate REAL (decodeAudioData remuestrea a esa tasa).
    // Consecuencia: el primer clic en «A»/«B» crea el AudioContext aunque la pista se rechace.
    const m = motorRef.current;
    const contexto = m?.asegurarContexto();
    if (!contexto) return;
    const pre = antesDeBajar(pista, { tasa: contexto.sampleRate });
    if (!pre.ok) { ponerUi(lado, { aviso: pre.error.mensaje, confirmar: null }); return; }
    if (pre.aviso && !forzar) { ponerUi(lado, { aviso: pre.aviso, confirmar: pista }); return; }
    controlesRef.current[lado]?.abort();
    const ctrl = new AbortController();
    controlesRef.current[lado] = ctrl;
    ponerUi(lado, { cargando: { pista, pct: null }, aviso: null, confirmar: null });
    let ultimoPct = -1;
    const r = await cargarPista(pista, {
      contexto, token: tokenRef.current, signal: ctrl.signal,
      onProgreso: ({ recibidos, total }) => {
        const pct = total ? Math.floor((recibidos / total) * 100) : null;
        if (pct === ultimoPct) return;
        ultimoPct = pct;
        ponerUi(lado, { cargando: { pista, pct } });
      },
    });
    if (ctrl.signal.aborted || controlesRef.current[lado] !== ctrl) return;   // otra carga o desmontaje
    controlesRef.current[lado] = null;
    // Si falla, el deck queda EXACTAMENTE como estaba (lo cargado antes sigue ahí): sólo sale el aviso.
    if (!r.ok) { ponerUi(lado, { cargando: null, aviso: r.error.mensaje }); return; }
    m.decks[lado].cargarBuffer(r.buffer, { pista, registro: r.registro });
    ponerUi(lado, { cargando: null, aviso: null });
  }, [ponerUi]);

  const cancelarAviso = useCallback((lado) => ponerUi(lado, { aviso: null, confirmar: null }), [ponerUi]);

  // Tiempo de los decks: un rAF mientras la consola está montada, escribiendo sólo si cambió.
  const vistasRef = useRef({ A: null, B: null });   // { tiempo, rango, arrastrando, ultimo, ultimoTxt }
  useEffect(() => {
    let id = 0;
    const paso = () => {
      const m = motorRef.current;
      for (const lado of LADOS) {
        const v = vistasRef.current[lado];
        if (!m || !v?.tiempo || !v.rango) continue;
        const pos = m.decks[lado].posicion();
        const txt = mmss(pos);
        if (txt !== v.ultimoTxt) { v.tiempo.textContent = txt; v.ultimoTxt = txt; }
        if (!v.arrastrando && pos !== v.ultimo) { v.rango.value = String(pos); v.ultimo = pos; }
      }
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, []);

  const motor = motorRef.current;
  return (
    <>
      <div className="dj-decks">
        {LADOS.map((lado) => (
          <Deck key={lado} lado={lado} deck={motor?.decks[lado] ?? null} estado={motor?.decks[lado].estado() ?? null}
            ui={ui[lado]} vistas={vistasRef.current} onCargar={cargar} onCancelar={cancelarAviso} />
        ))}
      </div>
      <MezclaDj motor={motor} refrescar={refrescar} midi={midi} onConectarMidi={conectarMidi} />
      <BibliotecaDj onCargar={cargar} />
    </>
  );
}

function Deck({ lado, deck, estado, ui, vistas, onCargar, onCancelar }) {
  const cargado = !!estado?.cargado;
  const pista = estado?.meta?.pista ?? null;
  const registro = estado?.meta?.registro ?? null;
  const duracion = estado?.duracion ?? 0;
  const sonando = !!estado?.sonando;

  // Refs por callback: el rAF de la consola escribe en estos nodos.
  const vista = (vistas[lado] ??= { tiempo: null, rango: null, arrastrando: false, ultimo: null, ultimoTxt: null });
  const refTiempo = useCallback((el) => { vista.tiempo = el; vista.ultimoTxt = null; }, [vista]);
  const refRango = useCallback((el) => { vista.rango = el; vista.ultimo = null; }, [vista]);

  // Barra de posición: arrastrando con el puntero sólo se mueve el número; el seek va al soltar (si
  // no, cada píxel recrearía la fuente). Con el teclado (flechas) el seek es inmediato.
  const alMover = (e) => {
    const v = Number(e.target.value);
    if (vista.arrastrando) { if (vista.tiempo) vista.tiempo.textContent = mmss(v); return; }
    deck?.seek(v);
  };
  // El fin del arrastre se escucha en window: el puntero puede soltarse fuera de la barra.
  const alApretar = (e) => {
    const el = e.currentTarget;
    vista.arrastrando = true;
    const fin = () => {
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      if (!vista.arrastrando) return;
      vista.arrastrando = false;
      deck?.seek(Number(el.value));
    };
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  };

  const textoEstado = ui.cargando
    ? `Cargando${ui.cargando.pct != null ? ` ${ui.cargando.pct} %` : '…'}`
    : !cargado ? 'Vacío' : sonando ? 'Sonando' : 'En pausa';
  const dataEstado = ui.cargando ? 'cargando' : !cargado ? 'vacio' : sonando ? 'sonando' : 'pausa';

  return (
    <section className={`dj-deck dj-deck--${lado.toLowerCase()}`} data-lado={lado} data-estado={dataEstado} aria-label={`Deck ${lado}`}>
      <div className="dj-deck-cabeza">
        <span className="dj-deck-lado" aria-hidden="true">{lado}</span>
        <div className="dj-deck-pista">
          <div className="dj-deck-titulo">{pista ? pista.title : 'Sin pista'}</div>
          <div className="dj-deck-artista">{pista ? (pista.artist ?? '') : 'Carga una canción con el botón ' + lado}</div>
        </div>
        {pista && <QualityChip track={pista} />}
      </div>

      <div className="dj-deck-tiempos">
        <span className="dj-deck-transcurrido" ref={refTiempo}>0:00</span>
        <span className="dj-deck-duracion">{mmss(duracion)}</span>
      </div>
      <input
        type="range" className="dj-deck-seek" ref={refRango}
        min="0" max={cargado ? duracion : 0} step="any" defaultValue="0"
        disabled={!cargado} aria-label={`Posición del deck ${lado}`}
        onPointerDown={alApretar}
        onChange={alMover}
      />

      <div className="dj-deck-controles">
        <button type="button" className="dj-btn dj-play" disabled={!cargado}
          aria-label={`${sonando ? 'Pausar' : 'Reproducir'} el deck ${lado}`}
          onClick={() => (sonando ? deck?.pausa() : deck?.play())}>
          {sonando ? 'Pausa' : 'Play'}
        </button>
        <button type="button" className="dj-btn dj-inicio" disabled={!cargado}
          aria-label={`Volver al inicio del deck ${lado}`} onClick={() => deck?.alInicio()}>
          Al inicio
        </button>
        <span className="dj-deck-estado">{textoEstado}</span>
      </div>

      {registro && (
        <p className="dj-deck-registro"
          data-bytes={registro.bytes} data-ms-bajada={registro.msBajada} data-ms-decodificacion={registro.msDecodificacion}
          data-duracion={registro.duracion} data-sample-rate={registro.sampleRate} data-canales={registro.canales}
          data-memoria={registro.memoriaBytes}>
          Bajada {registro.msBajada} ms · decodificación {registro.msDecodificacion} ms · {khz(registro.sampleRate)} ·{' '}
          {registro.canales === 1 ? '1 canal' : `${registro.canales} canales`} · {mbTexto(registro.memoriaBytes)} en memoria
        </p>
      )}

      {ui.aviso && (
        <div className="dj-deck-aviso" role="alert">
          <p>{ui.aviso}</p>
          {ui.confirmar ? (
            <div className="dj-deck-aviso-acciones">
              <button type="button" className="dj-btn dj-confirmar" onClick={() => onCargar(lado, ui.confirmar, { forzar: true })}>Cargar igual</button>
              <button type="button" className="dj-btn dj-cancelar" onClick={() => onCancelar(lado)}>Cancelar</button>
            </div>
          ) : (
            <button type="button" className="dj-btn dj-cancelar" onClick={() => onCancelar(lado)}>Cerrar</button>
          )}
        </div>
      )}
    </section>
  );
}

// ── Mezcla: volumen A y B, crossfader y filtro ───────────────────────────────────────────────────
// Los valores se leen del motor en cada render (la consola se re-renderiza con sus avisos, agrupados por
// cuadro; con el ratón, al momento) y se cambian con sus setters, que llevan cada valor a su AudioParam
// con una rampa. El DDJ-400 llama a los mismos setters desde midi.js. Antes del primer «Cargar» no
// hay AudioContext: el setter sólo guarda el valor. Doble clic vuelve al valor por defecto.

const num = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2).replace('.', ',')}`;
const hzTexto = (hz) => (hz >= 1000 ? `${String(Math.round(hz / 100) / 10).replace('.', ',')} kHz` : `${Math.round(hz)} Hz`);
function textoFiltro(f) {
  const fr = filtroFrecuencias(f);
  if (fr.lp < LP_NEUTRA) return `${num(f)} · paso bajo ${hzTexto(fr.lp)}`;
  if (fr.hp > HP_NEUTRA) return `+${num(f)} · paso alto ${hzTexto(fr.hp)}`;
  return `${num(f)} · plano`;
}

// Estado de la conexión MIDI → texto corto. El botón sólo sale cuando hace falta un clic.
const TEXTO_MIDI = {
  'sin-soporte': 'Este navegador no tiene Web MIDI',
  inactivo: '',
  pidiendo: 'Pidiendo permiso de MIDI…',
  denegado: 'Permiso de MIDI denegado',
  error: 'No se pudo abrir MIDI',
  esperando: 'Esperando el DDJ-400…',
  desconectado: 'DDJ-400 desconectado',
};
const CON_BOTON = new Set(['inactivo', 'denegado', 'error']);

function MezclaDj({ motor, refrescar, midi, onConectarMidi }) {
  const m = motor?.mezcla() ?? MEZCLA_INICIAL;
  // Con el ratón: el setter y el render en el MISMO evento (ver la cabecera: el <input> es controlado).
  const con = (fijar) => (v) => { if (motor && fijar(motor, v)) refrescar(); };
  const textoMidi = midi.estado === 'conectado' ? `Conectado: ${midi.nombre}` : TEXTO_MIDI[midi.estado] ?? '';
  return (
    <section className="dj-mezcla" aria-label="Mezcla">
      <div className="dj-mezcla-cabeza">
        <h2 className="dj-mezcla-titulo">Mezcla</h2>
        <div className="dj-midi" data-estado={midi.estado}>
          {CON_BOTON.has(midi.estado) && (
            <button type="button" className="dj-btn dj-midi-conectar" onClick={onConectarMidi}>Conectar DDJ-400</button>
          )}
          {textoMidi && <span className="dj-midi-estado" role="status">{textoMidi}</span>}
        </div>
      </div>
      <div className="dj-mezcla-controles">
        <ControlMezcla clase="dj-vol-a" etiqueta="Volumen A" min={0} max={1} valor={m.volumen.A} porDefecto={1}
          texto={num(m.volumen.A)} onCambio={con((mo, v) => mo.fijarVolumen('A', v))} />
        <ControlMezcla clase="dj-vol-b" etiqueta="Volumen B" min={0} max={1} valor={m.volumen.B} porDefecto={1}
          texto={num(m.volumen.B)} onCambio={con((mo, v) => mo.fijarVolumen('B', v))} />
        <ControlMezcla clase="dj-crossfader" etiqueta="Crossfader" min={0} max={1} valor={m.crossfader} porDefecto={0.5}
          texto={num(m.crossfader)} extremos={['A', 'B']} onCambio={con((mo, v) => mo.fijarCrossfader(v))} />
        <ControlMezcla clase="dj-filtro" etiqueta="Filtro" min={-1} max={1} valor={m.filtro} porDefecto={0}
          texto={textoFiltro(m.filtro)} extremos={['Paso bajo', 'Paso alto']} onCambio={con((mo, v) => mo.fijarFiltro(v))} />
      </div>
    </section>
  );
}

function ControlMezcla({ clase, etiqueta, min, max, valor, porDefecto, texto, extremos, onCambio }) {
  return (
    <div className={`dj-control ${clase}`}>
      <div className="dj-control-cabeza">
        <span className="dj-control-nombre">{etiqueta}</span>
        <output className="dj-control-valor" data-valor={valor}>{texto}</output>
      </div>
      <input
        type="range" className="dj-control-rango" min={min} max={max} step="0.01" value={valor}
        aria-label={etiqueta} aria-valuetext={texto} title="Doble clic: valor por defecto"
        onChange={(e) => onCambio(Number(e.target.value))}
        onDoubleClick={() => onCambio(porDefecto)}
      />
      {extremos && (
        <div className="dj-control-extremos" aria-hidden="true"><span>{extremos[0]}</span><span>{extremos[1]}</span></div>
      )}
    </div>
  );
}

// ── Biblioteca: buscador local + lista con ventana de filas ──────────────────────────────────────

const CAMPOS_BUSQUEDA = ['title', 'artist', 'album'];

const BibliotecaDj = memo(function BibliotecaDj({ onCargar }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    const leer = () => libraryTracks().then((l) => { if (vivo) { setLista(l); setError(false); } }).catch(() => { if (vivo) setError(true); });
    leer();
    const quitar = onLibraryChange(leer);
    return () => { vivo = false; quitar(); };
  }, []);

  const { query, setQuery, filtered } = useListFilter(lista, CAMPOS_BUSQUEDA);
  const { listRef, segments, pitch } = useWindowedRows(filtered.length, { overscan: 8, scroller: '.dj-lista-scroll' });

  const filas = [];
  for (const seg of segments) {
    if (seg.type === 'gap') {
      filas.push(<li key={`gap-${seg.from}`} className="dj-gap" aria-hidden="true" style={{ height: (seg.to - seg.from) * pitch }} />);
      continue;
    }
    for (let i = seg.from; i < seg.to; i++) {
      const t = filtered[i];
      filas.push(
        <li key={t.id} className="dj-fila" data-index={i} data-id={t.id}>
          <div className="dj-fila-texto">
            <span className="dj-fila-titulo">{t.title}</span>
            <span className="dj-fila-sub">{t.artist ?? ''}{t.album ? ` · ${t.album}` : ''}</span>
          </div>
          <QualityChip track={t} />
          <span className="dj-fila-dur">{mmss(t.duration)}</span>
          <button type="button" className="dj-cargar dj-cargar-a" onClick={() => onCargar('A', t)} aria-label={`Cargar «${t.title}» en el deck A`}>A</button>
          <button type="button" className="dj-cargar dj-cargar-b" onClick={() => onCargar('B', t)} aria-label={`Cargar «${t.title}» en el deck B`}>B</button>
        </li>,
      );
    }
  }

  return (
    <section className="dj-biblioteca" aria-label="Biblioteca">
      <input type="search" className="dj-buscar" placeholder="Buscar en la biblioteca" aria-label="Buscar en la biblioteca"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="dj-aviso">No se pudo cargar la biblioteca.</p>}
      {lista === null && !error && <p className="dj-biblioteca-nota">Cargando la biblioteca…</p>}
      {lista !== null && filtered.length === 0 && <p className="dj-biblioteca-nota">Nada coincide con la búsqueda.</p>}
      <div className="dj-lista-scroll">
        <ul className="dj-lista" ref={listRef}>{filas}</ul>
      </div>
    </section>
  );
});
