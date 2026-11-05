import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { usePlayer, usePlayerTime } from './PlayerContext.jsx';
import {
  PUERTA_INICIAL, puertaAbierta, alPublicar, alResponder, debePublicar,
  estadoDelAnfitrion, textoDeFin, textoDeFallo,
  mejorReloj, horaServidor, posicionProyectada, SINCRO_INICIAL, decidirCorreccion, pasoDelOyente,
  esperaDelSondeo, resolverColaDelOyente, fotoDeLaCola, planDeRestauracion, pausaDelOyente,
  idDeCancion, DESAJUSTE_MS,
} from '../utils/radioSync.js';

// RADIO WEB: EL ANFITRIÓN (fase 1, sub-paso 3) Y EL OYENTE (sub-paso 4). Port de los puentes de iOS
// (sonorarev-ios components/radio/puente-anfitrion.tsx y puente-oyente.tsx, 2a3bc86) sobre la lógica
// pura de utils/radioSync.js. Tres piezas:
//
//  · RadioProvider — el estado de la SALA: fase, código, oyentes, anfitrión, aviso, si la radio
//    quiere sonar (quiereSonar: el anfitrión suena una canción), por qué terminó,
//    el último error, e iniciar()/terminar() (anfitrión) y unirse()/salir()/tocarParaEscuchar()
//    (oyente). Va en App.jsx alrededor de <Layout/>: queda POR ENCIMA de las vistas (navegar no corta
//    la radio) y DEBAJO de Auth/Player/Toast. Con logout o el reauth de SSO, App deja de pintar Layout
//    y esto se desmonta: se cortan los temporizadores, NO se manda DELETE (el token ya no vale; el
//    servidor cierra la sala sola a los 5 min sin latido) y al oyente NO se le restaura la cola.
//    El provider NO lee el reproductor: su valor sólo cambia cuando cambia la sala (no a 4 Hz). Lo
//    que necesita del motor (la foto al entrar, play/seek/pause para devolverla) se lo deja el
//    puente del oyente en refs.
//
//  · <PuenteAnfitrion/> — sin UI, montado SÓLO con fase === 'anfitrion'. Publica el estado y lee oyentes.
//  · <PuenteOyente/> — sin UI, montado SÓLO con fase === 'oyente'. Lee la sala y mueve el reproductor.
//    Los dos son los únicos que leen usePlayer y usePlayerTime: re-renderizan a ~4 Hz mientras suena,
//    pero son hojas aparte que devuelven null, así que eso no toca a Layout ni a las vistas.
//
// UNA SOLA máquina de fases: 'sin-radio' | 'creando' | 'anfitrion' | 'terminando' | 'uniendose' |
// 'oyente'. iniciar() y unirse() exigen 'sin-radio', así que anfitrión y oyente se excluyen solos.
// Nada crea ni une una radio solo: únicamente iniciar() y unirse(), que llama la vista desde un clic.
// Por eso el doble montaje de StrictMode (desarrollo) no puede abrir dos salas ni unirse dos veces.
//
// DEUDAS CONOCIDAS del oyente (decididas, no olvidos):
//  · Aleatorio. No se apaga al unirse (sí el repeat). Con la cola de la radio [pista, siguiente] es
//    determinista (medido: 10/10 de A pasa a B en off/all), pero si el oyente encola algo con el
//    aleatorio encendido, al terminar la pista el motor puede saltar a lo encolado (medido: 11 de 20)
//    hasta que el desajuste (DESAJUSTE_MS, 6 s) vuelve a poner la de la radio. Arreglo propuesto: un
//    setShuffleMode(bool) idempotente en el motor (P-h), apagarlo al unirse y devolverlo al salir.
//  · Un 403 durante (Cloudflare Access, no el servidor) se toma como pasajero: si es permanente, el
//    aviso "sin respuesta" queda para siempre. Igual que iOS.

const RadioContext = createContext(null);

/** Cada cuánto se revisa el reproductor aunque no cambie nada (iOS: MIRAR_CADA_MS). Es el respaldo
 *  para la pausa, donde no hay 'timeupdate', y para soltar un reintento o un Retry-After. */
const MIRAR_CADA_MS = 500;
/** Cada cuánto se lee la sala para saber quién escucha (iOS: OYENTES_CADA_MS). */
const OYENTES_CADA_MS = 5000;
/** Unirse a la sala propia (decisión del usuario: el texto). */
const TEXTO_SALA_PROPIA = 'Esta radio es tuya.';

const mismosOyentes = (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id && p.name === b[i].name);

export function RadioProvider({ children }) {
  const { user } = useAuth();
  const [fase, setFase] = useState('sin-radio');   // ver la máquina de fases arriba
  const [codigo, setCodigo] = useState(null);      // la sala en la que estoy, con cualquiera de los dos roles
  const [genSala, setGenSala] = useState(0);       // la generación con que se abrió (o se entró a) la sala actual
  const [oyentes, setOyentes] = useState([]);
  const [fin, setFin] = useState(null);            // { razon, texto } | null
  const [error, setError] = useState(null);        // texto | null
  // Sólo del oyente:
  const [anfitrion, setAnfitrion] = useState(null);   // { id, name, avatar } de quien transmite
  const [aviso, setAviso] = useState(null);           // null | 'sin-senal' | 'sin-respuesta' | 'esperando-anfitrion' | 'video' | 'falta-cancion' | 'no-se-pudo-cargar'
  const [silenciada, setSilenciada] = useState(false);   // el oyente pausó por su cuenta ("en pausa para ti")
  const [quiereSonar, setQuiereSonar] = useState(false);  // el anfitrión suena una canción (no en pausa ni en video)

  // Espejos síncronos: un segundo clic llega antes del re-render, y pagehide lee la fase en el acto.
  const faseRef = useRef('sin-radio');
  const codigoRef = useRef(null);
  const ponerFase = (f) => { faseRef.current = f; setFase(f); };
  // GENERACIÓN: cada sala (y cada salida) la sube. Toda respuesta asíncrona trae la generación con
  // que salió y se ignora si ya no es la actual: así una respuesta tardía de una radio anterior, o
  // de un puente ya desmontado, no puede pisar el estado.
  const genRef = useRef(0);
  const montadoRef = useRef(true);
  const userIdRef = useRef(null);
  userIdRef.current = user?.id ?? null;

  // Del oyente, en refs (los escribe el puente; los lee la salida):
  //  · fotoRef: { gen, foto, repeat } — lo que tenía el reproductor al entrar y su modo de repetición.
  //  · motorRef: { play, seek, pause, setRepeatMode } — funciones estables del motor.
  //  · tocarRef: lo que hace "Toca para escuchar" (necesita el reloj y lo seguido, que viven en el puente).
  //  · primeraRef: la lectura con la que se entró, para que el puente no la repita.
  const fotoRef = useRef(null);
  const motorRef = useRef(null);
  const tocarRef = useRef(null);
  const primeraRef = useRef(null);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      genRef.current += 1;
      // Logout (o reauth) siendo oyente: el reproductor vive por encima y seguiría sonando lo de la
      // radio. Se calla y se devuelve el repeat; la cola NO se restaura. La salida normal no pasa por
      // acá: finOyente ya dejó la fase en 'sin-radio' antes de desmontar.
      if (faseRef.current === 'oyente' && motorRef.current) {
        motorRef.current.pause();
        if (fotoRef.current?.repeat) motorRef.current.setRepeatMode(fotoRef.current.repeat);
      }
    };
  }, []);

  /** El anfitrión sale de la radio por una razón (del servidor o local). Sólo si `gen` sigue siendo la actual. */
  const finAnfitrion = useCallback((gen, razon) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    genRef.current += 1;
    codigoRef.current = null;
    ponerFase('sin-radio');
    setCodigo(null);
    setOyentes([]);
    setFin({ razon, texto: textoDeFin('anfitrion', razon) });
  }, []);

  /** El oyente sale: corta el puente (la generación), le devuelve lo suyo y el repeat. `razon` null =
   *  salió él (sin texto de fin). Sólo si `gen` sigue siendo la actual. */
  const finOyente = useCallback((gen, razon) => {
    if (gen !== genRef.current || !montadoRef.current || faseRef.current !== 'oyente') return;
    genRef.current += 1;   // el puente queda sin voz desde ya (y se desmonta con la fase)
    const m = motorRef.current;
    const guardado = fotoRef.current;
    if (m) {
      // La foto se devuelve EN PAUSA (P-b): a diferencia de iOS, no suena ni una fracción de segundo.
      const plan = planDeRestauracion(guardado?.foto ?? null);
      if (plan.tipo === 'cola') {
        m.play(plan.lista, plan.indice, { sonar: false });
        if (plan.posicionSeg > 0) m.seek(plan.posicionSeg);
      } else m.pause();
      if (guardado?.repeat) m.setRepeatMode(guardado.repeat);
    }
    fotoRef.current = null;
    tocarRef.current = null;
    primeraRef.current = null;
    codigoRef.current = null;
    ponerFase('sin-radio');
    setCodigo(null);
    setOyentes([]);
    setAnfitrion(null);
    setAviso(null);
    setSilenciada(false);
    setQuiereSonar(false);
    if (razon) setFin({ razon, texto: textoDeFin('oyente', razon) });
  }, []);

  const alOyentes = useCallback((gen, lista) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setOyentes((prev) => (mismosOyentes(prev, lista) ? prev : lista));
  }, []);

  const alAviso = useCallback((gen, a) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setAviso(a);
  }, []);

  const alQuiereSonar = useCallback((gen, q) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setQuiereSonar(q);
  }, []);

  const alSilenciada = useCallback((gen, s) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setSilenciada(s);
  }, []);

  /** Desde un clic. `cancion` = el currentTrack de la vista (un video cuenta): el provider no lee el
   *  reproductor, así que se lo pasa quien llama. Devuelve true si la sala quedó abierta. */
  const iniciar = useCallback(async (cancion) => {
    if (faseRef.current !== 'sin-radio') return false;   // un segundo clic mientras 'creando' no hace nada
    if (!cancion) return false;
    const gen = ++genRef.current;
    ponerFase('creando');
    setError(null);
    setFin(null);
    const r = await api.radioCrear();
    if (gen !== genRef.current || !montadoRef.current) return false;
    if (!r.ok) {
      ponerFase('sin-radio');
      setError(textoDeFallo('iniciar', r));
      return false;
    }
    codigoRef.current = r.code;
    setCodigo(r.code);
    setGenSala(gen);
    setOyentes([]);
    ponerFase('anfitrion');   // monta el puente, que publica en el acto
    return true;
  }, []);

  /** Termina la sala. Siempre acaba en 'sin-radio', aunque falle la red. */
  const terminar = useCallback(async () => {
    if (faseRef.current !== 'anfitrion') return;
    const c = codigoRef.current;
    const gen = ++genRef.current;   // el puente queda sin voz desde ya (y se desmonta con la fase)
    ponerFase('terminando');
    setError(null);
    const r = await api.radioTerminar(c);
    if (gen !== genRef.current || !montadoRef.current) return;
    genRef.current += 1;
    codigoRef.current = null;
    ponerFase('sin-radio');
    setCodigo(null);
    setOyentes([]);
    if (r.ok) setFin({ razon: 'anfitrion', texto: textoDeFin('anfitrion', 'anfitrion') });
    else if (r.error === 'terminada') setFin({ razon: r.razon, texto: textoDeFin('anfitrion', r.razon) });
    else if (r.error === 'no-existe') setFin({ razon: 'no-existe', texto: textoDeFin('anfitrion', 'no-existe') });
    else setError(textoDeFallo('terminar', r));
  }, []);

  /** Desde un clic ("Escuchar"). La primera lectura es la que anota al oyente en el servidor (el GET
   *  registra a quien lee, salvo al anfitrión). Devuelve true si quedó adentro. */
  const unirse = useCallback(async (codigoSala) => {
    if (faseRef.current !== 'sin-radio') return false;
    const gen = ++genRef.current;
    ponerFase('uniendose');
    setError(null);
    setFin(null);
    setAviso(null);
    const r = await api.radioLeer(codigoSala);
    if (gen !== genRef.current || !montadoRef.current) return false;
    if (!r.ok) {
      ponerFase('sin-radio');
      setError(textoDeFallo('unirse', r));
      return false;
    }
    if (r.radio.status === 'ended') {
      ponerFase('sin-radio');
      const razon = r.radio.endedReason ?? 'otro';
      setFin({ razon, texto: textoDeFin('oyente', razon) });
      return false;
    }
    // La sala propia: el servidor no anota al anfitrión como oyente, así que leerla no dejó rastro.
    if (r.radio.host && userIdRef.current != null && r.radio.host.id === Number(userIdRef.current)) {
      ponerFase('sin-radio');
      setError(TEXTO_SALA_PROPIA);
      return false;
    }
    primeraRef.current = r;
    fotoRef.current = null;
    codigoRef.current = r.radio.code;
    setCodigo(r.radio.code);
    setGenSala(gen);
    setAnfitrion(r.radio.host);
    setOyentes(r.radio.listeners.filter((p) => p.id !== r.radio.host?.id));
    setSilenciada(false);
    ponerFase('oyente');   // monta el puente, que toma la foto y aplica la primera lectura
    return true;
  }, []);

  /** Desde un clic ("Salir"). Mientras 'uniendose' sólo cancela (no se tocó el reproductor). */
  const salir = useCallback(() => {
    if (faseRef.current === 'uniendose') {
      genRef.current += 1;
      ponerFase('sin-radio');
      return;
    }
    finOyente(genRef.current, null);
  }, [finOyente]);

  /** Desde un clic ("Toca para escuchar"), cuando el navegador bloqueó el play(): seek al vivo y
   *  resume() en el MISMO gesto (sin await en el medio, o el navegador lo vuelve a bloquear). */
  const tocarParaEscuchar = useCallback(() => {
    if (faseRef.current !== 'oyente') return;
    tocarRef.current?.();
  }, []);

  const limpiarFin = useCallback(() => { setFin(null); setError(null); }, []);

  // Cerrar la pestaña (o navegar fuera): DELETE con keepalive, que sobrevive a la descarga y lleva el
  // Bearer. Si la página no se descarga sino que queda en la caché del navegador (event.persisted) y
  // vuelve, la sala ya está cerrada: el próximo latido recibe 410 y el puente sale limpio, con su texto.
  // El oyente no manda nada: el servidor lo saca de la lista a los 10 s sin leer.
  useEffect(() => {
    const alOcultar = () => {
      if (faseRef.current === 'anfitrion' && codigoRef.current) {
        api.radioTerminar(codigoRef.current, { keepalive: true });
      }
    };
    window.addEventListener('pagehide', alOcultar);
    return () => window.removeEventListener('pagehide', alOcultar);
  }, []);

  const value = useMemo(
    () => ({
      fase, codigo, oyentes, fin, error, anfitrion, aviso, silenciada, quiereSonar,
      iniciar, terminar, limpiarFin, unirse, salir, tocarParaEscuchar,
    }),
    [fase, codigo, oyentes, fin, error, anfitrion, aviso, silenciada, quiereSonar, iniciar, terminar, limpiarFin, unirse, salir, tocarParaEscuchar],
  );

  return (
    <RadioContext.Provider value={value}>
      {children}
      {fase === 'anfitrion' && codigo && (
        <PuenteAnfitrion key={codigo} codigo={codigo} gen={genSala} genRef={genRef} salir={finAnfitrion} alOyentes={alOyentes} />
      )}
      {fase === 'oyente' && codigo && (
        <PuenteOyente
          key={codigo} codigo={codigo} gen={genSala} genRef={genRef}
          primeraRef={primeraRef} fotoRef={fotoRef} motorRef={motorRef} tocarRef={tocarRef}
          salir={finOyente} alOyentes={alOyentes} alAviso={alAviso} alSilenciada={alSilenciada}
          alQuiereSonar={alQuiereSonar}
        />
      )}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  return useContext(RadioContext);
}

// ── El puente del anfitrión: publica lo que suena y lee quién escucha ──
//
// Publica por CAMBIOS (pista, pausa, siguiente, salto, posición: cada render trae el estado nuevo y
// se mira en el acto) y con un temporizador de respaldo cada MIRAR_CADA_MS para la pausa, el latido
// y los reintentos. Quién decide: debePublicar (¿hay algo?), la puerta (¿se puede ahora?: una sola en
// vuelo, Retry-After, reintento a los 3 s, canción rechazada) y alResponder (qué hacer con la
// respuesta). Todo eso es puro y vive en radioSync.js.
function PuenteAnfitrion({ codigo, gen, genRef, salir, alOyentes }) {
  const { currentTrack, isPlaying, queue, queueIndex } = usePlayer();
  const { currentTime } = usePlayerTime();

  const actual = estadoDelAnfitrion({ current: currentTrack, queue, queueIndex, playing: isPlaying, posicionSeg: currentTime });
  const actualRef = useRef(actual);   // lo último, para el temporizador (se escribe en un efecto, no en el render)

  const puertaRef = useRef(PUERTA_INICIAL);
  const publicadoRef = useRef(null);
  const leyendoRef = useRef(false);

  const mirar = useCallback(async () => {
    const vigente = () => gen === genRef.current;
    if (!vigente()) return;
    const ahora = Date.now();
    const a = actualRef.current;
    if (!puertaAbierta(puertaRef.current, a, ahora)) return;
    if (!debePublicar(publicadoRef.current, a, ahora)) return;
    puertaRef.current = alPublicar(puertaRef.current);
    const salidaMs = Date.now();
    const r = await api.radioPublicar(codigo, a);
    if (!vigente()) return;
    const x = alResponder(puertaRef.current, r, a, salidaMs, Date.now());
    puertaRef.current = x.puerta;
    if (x.publicado) publicadoRef.current = x.publicado;
    if (x.expulsar) salir(gen, x.expulsar);
  }, [codigo, gen, genRef, salir]);

  const leerOyentes = useCallback(async () => {
    const vigente = () => gen === genRef.current;
    if (!vigente() || leyendoRef.current) return;
    leyendoRef.current = true;
    const r = await api.radioLeer(codigo);
    leyendoRef.current = false;
    if (!vigente()) return;
    if (r.ok) {
      if (r.radio.status === 'ended') { salir(gen, r.radio.endedReason ?? 'otro'); return; }
      const host = r.radio.host?.id;
      alOyentes(gen, r.radio.listeners.filter((p) => p.id !== host));
      return;
    }
    if (r.error === 'no-existe') salir(gen, 'no-existe');
    else if (r.error === 'terminada') salir(gen, r.razon);
    else if (r.error === 'sesion') salir(gen, 'sesion');
    // red caída, 429, 5xx: se vuelve a intentar en el próximo turno, sin salir.
  }, [codigo, gen, genRef, salir, alOyentes]);

  // Por cambios: en cada render se guarda lo último y se mira (debePublicar devuelve null casi
  // siempre, y es barato). El primer render publica en el acto ('primero').
  useEffect(() => { actualRef.current = actual; mirar(); });

  // Respaldo y oyentes. Se montan una vez por sala; al desmontar (salida, terminar, logout) se cortan.
  useEffect(() => {
    leerOyentes();
    const t1 = setInterval(mirar, MIRAR_CADA_MS);
    const t2 = setInterval(leerOyentes, OYENTES_CADA_MS);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [mirar, leerOyentes]);

  return null;
}

// ── El puente del oyente: lee la sala y mueve el reproductor ──
//
// Una CADENA de setTimeout, no un setInterval: siempre hay una sola lectura en vuelo y el Retry-After
// se respeta solo (esperaDelSondeo). En cada vuelta:
//   1. lee la sala (la primera vez usa la lectura con que se entró) y afina el reloj (mejorReloj);
//   2. pasoDelOyente decide la orden y aplicarla mueve el motor (P-g: pause/resume idempotentes);
//   3. con lo que suena de verdad: el desajuste (si no es la canción de la radio por más de
//      DESAJUSTE_MS, se vuelve a poner), la pausa propia (pausaDelOyente → "silenciada": la radio
//      deja de moverlo hasta que el oyente le da play, y ahí salta al vivo) y la corrección del
//      desfase (decidirCorreccion).
// Cada orden propia anota cuándo fue (la gracia de pausaDelOyente) y reinicia la sincro.
// Si no se pudo cargar la canción (api.track), se pausa lo que sonaba, se avisa y `seguido` vuelve
// a lo de antes: el próximo sondeo da 'arrancar' otra vez y reintenta, sin sacar al oyente.
function PuenteOyente({ codigo, gen, genRef, primeraRef, fotoRef, motorRef, tocarRef, salir, alOyentes, alAviso, alSilenciada, alQuiereSonar }) {
  const { currentTrack, isPlaying, playBlocked, queue, queueIndex, repeat, play, seek, pause, resume, setRepeatMode } = usePlayer();
  const { currentTime, duration } = usePlayerTime();

  // Lo último del reproductor, para la cadena (se escribe en un efecto, no en el render).
  const jugRef = useRef(null);
  useEffect(() => {
    jugRef.current = { currentTrack, isPlaying, playBlocked, queue, queueIndex, repeat, currentTime, duration };
  });

  const relojRef = useRef(null);
  const seguidoRef = useRef(null);
  const estadoRef = useRef(null);         // el último estado leído (lleva nextTrackId, que `seguido` no)
  const sincroRef = useRef(SINCRO_INICIAL);
  const ordenEnRef = useRef(0);           // hora local de la última orden propia
  const silenciadaRef = useRef(false);
  const desajusteDesdeRef = useRef(null);
  const cargaFallidaRef = useRef(null);   // null | 'falta-cancion' | 'no-se-pudo-cargar'
  const ctPrevioRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    let timer = null;
    const vigente = () => vivo && gen === genRef.current;

    const durMs = () => { const d = jugRef.current?.duration; return d > 0 ? d * 1000 : null; };
    const objetivo = (dur) => {
      const s = seguidoRef.current;
      return s ? posicionProyectada(s, horaServidor(relojRef.current, Date.now()), dur) : 0;
    };
    const orden = () => { ordenEnRef.current = Date.now(); sincroRef.current = SINCRO_INICIAL; };
    const silenciar = (s) => { silenciadaRef.current = s; alSilenciada(gen, s); };

    // La canción de la radio, con la siguiente de pista. `sonando`: lo que dice el anfitrión.
    const arrancar = async (trackId, nextTrackId, sonando, previo) => {
      const res = await resolverColaDelOyente(api.track, trackId, nextTrackId);
      if (!vigente()) return;
      if (!res.cola) {
        cargaFallidaRef.current = res.motivo === 'no-esta' ? 'falta-cancion' : 'no-se-pudo-cargar';
        seguidoRef.current = previo;   // el próximo sondeo vuelve a dar 'arrancar'
        orden();
        pause();
        return;
      }
      cargaFallidaRef.current = null;
      desajusteDesdeRef.current = null;
      orden();
      const t = res.cola[0];
      const dur = Number.isFinite(t.duration) && t.duration > 0 ? t.duration * 1000 : null;
      play(res.cola, 0, { sonar: sonando && !silenciadaRef.current });
      seek(objetivo(dur) / 1000);   // P-a: vale antes de los metadatos
    };

    // ¿Lo que tiene cargado el reproductor es la canción de la radio? Si el oyente puso otra, las
    // órdenes no la tocan (ni seek ni resume sobre lo suyo): eso lo arregla el desajuste.
    const enLaDeLaRadio = () => idDeCancion(jugRef.current?.currentTrack) === seguidoRef.current?.trackId;

    const aplicar = async (o, previo) => {
      switch (o.tipo) {
        case 'arrancar': await arrancar(o.trackId, o.nextTrackId, o.sonando, previo); break;
        case 'pausar':
          orden();
          pause();
          if (!silenciadaRef.current && enLaDeLaRadio()) seek(o.positionMs / 1000);
          break;
        case 'reanudar':
          if (silenciadaRef.current || !enLaDeLaRadio()) break;
          orden();
          seek(objetivo(durMs()) / 1000);
          resume();
          break;
        case 'saltar':
          if (silenciadaRef.current || !enLaDeLaRadio()) break;
          orden();
          seek(objetivo(durMs()) / 1000);
          break;
        case 'pausar-por-video': orden(); pause(); break;
        case 'salir': salir(gen, o.razon); break;
        default: break;   // 'nada', 'esperar-anfitrion'
      }
    };

    // Con lo que suena de verdad: desajuste, pausa propia y corrección.
    const revisar = async () => {
      const s = seguidoRef.current;
      const j = jugRef.current;
      if (!s || !j || s.enPausaPorVideo || s.trackId == null || cargaFallidaRef.current) { desajusteDesdeRef.current = null; return; }
      const ahora = Date.now();
      const ct = j.currentTime;
      const avanza = ctPrevioRef.current != null && ct !== ctPrevioRef.current;
      ctPrevioRef.current = ct;
      const esLaDeLaRadio = idDeCancion(j.currentTrack) === s.trackId;

      if (!esLaDeLaRadio) {
        if (silenciadaRef.current) return;
        if (desajusteDesdeRef.current == null) { desajusteDesdeRef.current = ahora; return; }
        if (ahora - desajusteDesdeRef.current < DESAJUSTE_MS) return;
        const e = estadoRef.current;
        await arrancar(s.trackId, e?.trackId === s.trackId ? e.nextTrackId : null, s.playing, s);
        return;
      }
      desajusteDesdeRef.current = null;

      const sonando = j.isPlaying && avanza;
      const dur = durMs();
      if (!silenciadaRef.current && !j.playBlocked && pausaDelOyente({
        quiereSonar: s.playing, pausado: !j.isPlaying, sonando, posicionMs: ct * 1000, duracionMs: dur,
        msDesdeOrden: ahora - ordenEnRef.current,
      })) { silenciar(true); return; }
      if (silenciadaRef.current || !s.playing) return;

      const d = decidirCorreccion({ sincro: sincroRef.current, ahoraMs: ahora, objetivoMs: objetivo(dur), posicionMs: ct * 1000, sonando, duracionMs: dur });
      sincroRef.current = d.sincro;
      if (d.seekMs != null) { ordenEnRef.current = ahora; seek(d.seekMs / 1000); }
    };

    const vuelta = async () => {
      if (!vigente()) return;
      let lectura = primeraRef.current;
      primeraRef.current = null;
      if (!lectura) lectura = await api.radioLeer(codigo);
      if (!vigente()) return;
      if (lectura.ok) {
        relojRef.current = mejorReloj(relojRef.current, lectura.muestra);
        if (lectura.radio.status !== 'ended') {
          const host = lectura.radio.host?.id;
          alOyentes(gen, lectura.radio.listeners.filter((p) => p.id !== host));
          if (lectura.radio.state) estadoRef.current = lectura.radio.state;
        }
      }
      const previo = seguidoRef.current;
      const paso = pasoDelOyente(previo, lectura);
      seguidoRef.current = paso.seguido;
      await aplicar(paso.orden, previo);
      if (!vigente()) return;
      await revisar();
      if (!vigente()) return;
      const s = seguidoRef.current;
      // Lo que quiere la radio (para "Toca para escuchar"): sólo cambia cuando el anfitrión pausa,
      // reanuda o pone un video; con el mismo valor React no re-renderiza.
      alQuiereSonar(gen, !!s && s.playing && !s.enPausaPorVideo);
      alAviso(gen, paso.aviso ?? cargaFallidaRef.current
        ?? (s?.enPausaPorVideo ? 'video' : !s && lectura.ok ? 'esperando-anfitrion' : null));
      timer = setTimeout(vuelta, esperaDelSondeo(lectura.ok ? null : lectura));
    };

    // La foto y el repeat, UNA vez por sala (el doble montaje de StrictMode no la vuelve a tomar
    // cuando ya puede haber sonado lo de la radio).
    const j = jugRef.current;
    if (fotoRef.current?.gen !== gen) {
      fotoRef.current = { gen, foto: fotoDeLaCola({ queue: j.queue, queueIndex: j.queueIndex, posicionSeg: j.currentTime }), repeat: j.repeat };
      setRepeatMode('off');   // P-e: con repeat la cola [pista, siguiente] repetiría o volvería atrás
    }
    motorRef.current = { play, seek, pause, setRepeatMode };
    tocarRef.current = () => {
      const s = seguidoRef.current;
      if (!s || s.enPausaPorVideo || s.trackId == null) return;
      orden();
      if (silenciadaRef.current) silenciar(false);
      seek(objetivo(durMs()) / 1000);
      resume();
    };
    vuelta();
    return () => { vivo = false; clearTimeout(timer); };
  }, [codigo, gen, genRef, primeraRef, fotoRef, motorRef, tocarRef, salir, alOyentes, alAviso, alSilenciada, alQuiereSonar, play, seek, pause, resume, setRepeatMode]);

  // El oyente le dio play estando "en pausa para ti": salta al vivo y la radio vuelve a moverlo.
  useEffect(() => {
    if (!isPlaying || !silenciadaRef.current || gen !== genRef.current) return;
    const s = seguidoRef.current;
    silenciadaRef.current = false;
    alSilenciada(gen, false);
    if (!s || s.enPausaPorVideo || idDeCancion(currentTrack) !== s.trackId) return;
    ordenEnRef.current = Date.now();
    sincroRef.current = SINCRO_INICIAL;
    const d = duration > 0 ? duration * 1000 : null;
    seek(posicionProyectada(s, horaServidor(relojRef.current, Date.now()), d) / 1000);
  }, [isPlaying]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
