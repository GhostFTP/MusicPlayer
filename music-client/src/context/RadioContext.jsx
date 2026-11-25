import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { registrarRadioEnMenu } from '../components/ContextMenu.jsx';
import { usePlayer, usePlayerTime } from './PlayerContext.jsx';
import {
  PUERTA_INICIAL, puertaAbierta, alPublicar, alResponder, debePublicar,
  estadoDelAnfitrion, textoDeFin, textoDeFallo,
  mejorReloj, horaServidor, posicionProyectada, SINCRO_INICIAL, decidirCorreccion, pasoDelOyente,
  esperaDelSondeo, resolverColaDelOyente, fotoDeLaCola, planDeRestauracion, pausaDelOyente,
  idDeCancion, DESAJUSTE_MS, avisarVuelta, textoDeVuelta, textoEnLaRadio,
  planDeOrden, siguienteDelMotor, alFinalDeLaCola, confirmacionDe, colaDelOyente,
  juntarEventos, avisarEvento, textoDeEvento, pasoDeEventos,
  esModerador, resolverOrden, ORDEN_ESPERANDO_MS, ORDEN_VENCE_MS, ORDENES_DE_LA_TARJETA, ORDENES_DEL_MENU, eventoDeOrden, TEXTOS_ORDEN, textoDeEspera,
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
//  · <PuenteAnfitrion/> — sin UI, montado SÓLO con fase === 'anfitrion'. Publica el estado, lee oyentes
//    y (1.45.0) aplica las órdenes de quien modera.
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
//    M4 (aleatorio con orden fijo): el motor camina por posición y play() respeta [pista, siguiente];
//    lo encolado va al final. Medido A NIVEL MOTOR (play([A, B]) + aleatorio + addToQueue(X), A termina
//    sola): antes 13 de 20 saltaban a X, con M4 0 de 20. Falta medirlo de punta a punta con la radio
//    real antes de dar la deuda por cerrada y descartar P-h.
//  · Un 403 durante (Cloudflare Access, no el servidor) se toma como pasajero: si es permanente, el
//    aviso "sin respuesta" queda para siempre. Igual que iOS.

const RadioContext = createContext(null);

/** Cada cuánto se revisa el reproductor aunque no cambie nada (iOS: MIRAR_CADA_MS). Es el respaldo
 *  para la pausa, donde no hay 'timeupdate', y para soltar un reintento o un Retry-After. */
const MIRAR_CADA_MS = 500;
/** Cada cuánto se lee la sala para saber quién escucha (iOS: OYENTES_CADA_MS). */
const OYENTES_CADA_MS = 5000;
/** 1.45.0: con moderadores la sala se lee además cada 2 s, porque ahí llegan las órdenes. Es un
 *  intervalo APARTE, montado solo mientras haya moderadores: sin ellos quedan los dos de siempre. */
const ORDENES_CADA_MS = 2000;
/** Dos lecturas de la sala no más cerca que esto (el intervalo de 2 s y el de 5 s se cruzan). */
const LECTURA_MIN_MS = 1500;
/** Cuánto se espera a que el motor muestre lo que hizo una orden (otra pista, la pausa, la cola). */
const ESPERA_MOTOR_MS = 1000;
/** 1.45.0: cada lectura del OYENTE declara que esta app sabe moderar (?cap=mod). Va en TODAS (unirse
 *  y cada vuelta): el servidor anota el soporte en cada lectura, y una sin cap lo apagaría. */
const LECTURA_OYENTE = { cap: 'mod' };
/** Cuánto dura el aviso breve de un evento ajeno. NO 2000 ms: radio-oyente-func cuenta los setTimeout
 *  de 2000 ms pendientes (es la demora del sondeo del oyente). */
const AVISO_EVENTO_MS = 3500;
/** 1.45.1: cuánto dura el "Volviste a la radio de…" (es más largo que un evento). Ni 2000 ni 5000/30000:
 *  radio-oyente-func cuenta los setTimeout de 2000 y radio-menu-func los de 5000 y 30000 (las órdenes). */
const AVISO_VUELTA_MS = 4500;
/** W5b-1: lo que ve de la radio quien escucha, para sus botones de moderar. Sin el seq: sube con cada
 *  publicación del anfitrión (también el latido) y re-renderizaría la sala cada vez sin que cambie nada
 *  visible. El seq (la base de "siguiente") vive solo en vistaModRef; acá, si lo hay (conBase). */
const VISTA_MOD_VACIA = Object.freeze({ modera: false, admite: false, playing: null, conBase: false, trackId: null });
/** W5b-2: ¿se está fuera de la vista Radio? Ahí la línea de estado no se ve y va también como toast. */
const fueraDeLaRadio = () => typeof window !== 'undefined' && !/^\/radio(\/|$)/.test(window.location.pathname);
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
  // Sólo del anfitrión (1.45.0, W4): quién modera, lo que pasó en la radio y a quién no se puede nombrar.
  const [moderadores, setModeradores] = useState([]);           // [{ id, name, avatar }]
  const [eventos, setEventos] = useState([]);                   // los últimos EVENTOS_MAX, sin repetidos
  const [sinSoporte, setSinSoporte] = useState(() => new Set());   // ids con 409 sin-soporte (esta sala)
  const eventosVistosRef = useRef(new Set());   // ids ya vistos: un evento avisa una sola vez
  // Del oyente (W5a): lo último que se anunció de la radio (eventos y aviso de rol) → { texto, n } | null.
  const [anuncio, setAnuncio] = useState(null);
  // Del oyente que modera (W5b-1): lo que ve de la radio, sus órdenes en vuelo, la línea de estado y la
  // cuenta de un 429. Las órdenes viven en un ref (con sus temporizadores); el estado es lo que pinta.
  const [vistaMod, setVistaMod] = useState(VISTA_MOD_VACIA);
  const [ordenando, setOrdenando] = useState({});        // tipo → true mientras está en vuelo
  const [lineaOrden, setLineaOrden] = useState(null);    // { texto, n } | null
  const [esperaOrden, setEsperaOrden] = useState(0);     // segundos que faltan por un 429 (0 = ninguno)
  const vistaModRef = useRef({ ...VISTA_MOD_VACIA, estado: null, cursor: 0 });
  // 1.45.1: quien transmite, síncrono (el menú lo lee al abrirse, no en el render), y cuándo fue el último
  // "Volviste a la radio de…" (como mucho uno cada AVISO_VUELTA_CADA_MS, en esta y en la próxima radio).
  const anfitrionRef = useRef(null);
  const ultimaVueltaRef = useRef(null);
  const ordenesRef = useRef(new Map());   // tipo → { tipo, baseTrackId, cursor, enviadaEn, enviando, resuelta, esperando, timers }
  const esperaRef = useRef({ t: null, s: 0 });
  const lineaDeRef = useRef(null);        // de quién es la línea: un tipo, 'espera' o null
  // Lo pone el puente del anfitrión: (moderadores) → arranca o corta la lectura de 2 s en el acto.
  const moderarRef = useRef(null);
  const toast = useToast();

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

  // ── Las órdenes de quien modera (W5b-1). Funciones de render que solo tocan refs y setters. ──
  /** La línea de estado. Un texto nuevo es un nodo nuevo (key n): así un texto repetido se vuelve a
   *  anunciar. `mismo`: la cuenta regresiva cambia el texto sin montar otro nodo. `fallo`: es un error
   *  (textoDeFallo): su toast va con la variante de aviso, no con la de éxito. */
  const decirOrden = (texto, de = null, mismo = false, fallo = false) => {
    lineaDeRef.current = texto ? de : null;
    setLineaOrden((l) => (texto ? { texto, n: mismo && l ? l.n : (l?.n ?? 0) + 1 } : null));
    // W5b-2: fuera de la vista Radio la línea no se ve → el mismo texto sale también como toast. No el
    // "Enviando…" (dura lo que la petición) ni cada segundo de la cuenta (mismo).
    if (texto && !mismo && texto !== TEXTOS_ORDEN.enviando && fueraDeLaRadio()) toast(texto, { duration: AVISO_EVENTO_MS, ...(fallo ? { variant: 'warning' } : {}) });
  };
  const cerrarOrden = (tipo) => {
    const o = ordenesRef.current.get(tipo);
    if (!o) return;
    for (const t of o.timers) clearTimeout(t);
    ordenesRef.current.delete(tipo);
    setOrdenando((x) => { const y = { ...x }; delete y[tipo]; return y; });
  };
  const cortarEspera = () => {
    clearTimeout(esperaRef.current.t);
    esperaRef.current = { t: null, s: 0 };
    setEsperaOrden(0);
  };
  /** Sin órdenes ni cuenta ni línea (salir, terminar, perder el rol, otra sala). */
  const limpiarOrdenes = () => {
    for (const tipo of [...ordenesRef.current.keys()]) cerrarOrden(tipo);
    cortarEspera();
    lineaDeRef.current = null;
    setLineaOrden(null);
  };
  /** Lo que dijo resolverOrden, a la línea. */
  const cerrarCon = (tipo, res, aviso = null) => {
    const o = ordenesRef.current.get(tipo);
    if (!o) return;
    switch (res) {
      case 'cancelada': cerrarOrden(tipo); if (lineaDeRef.current === tipo) decirOrden(null); break;
      // Aplicada: la línea se vacía y lo dice el evento ("Tú pausaste") en SU región: nada se pisa.
      // W5b-2: una orden del menú, fuera de la vista Radio, lo avisa con un toast (el texto del evento).
      case 'aplicada':
        cerrarOrden(tipo);
        if (lineaDeRef.current === tipo) decirOrden(null);
        if (aviso && fueraDeLaRadio()) toast(aviso, { duration: AVISO_EVENTO_MS });
        break;
      case 'ya-cambio': cerrarOrden(tipo); decirOrden(TEXTOS_ORDEN.yaCambio, tipo); break;
      case 'no-se-aplico': cerrarOrden(tipo); decirOrden(TEXTOS_ORDEN.noSeAplico, tipo); break;
      case 'esperando': if (!o.esperando) { o.esperando = true; decirOrden(TEXTOS_ORDEN.esperando, tipo); } break;
      default: break;
    }
  };
  /** Mira una orden contra lo último que se vio. Mientras se envía, solo se anota lo que la resuelve. */
  const revisarOrden = (tipo, nuevos = []) => {
    const o = ordenesRef.current.get(tipo);
    if (!o) return;
    const v = vistaModRef.current;
    const yo = Number(userIdRef.current);
    const res = resolverOrden(o, { ahoraMs: Date.now(), modera: v.modera, estado: v.estado, eventos: nuevos, yo });
    let aviso = null;
    if (res === 'aplicada' && ORDENES_DEL_MENU.includes(tipo)) {
      const ev = eventoDeOrden(o, nuevos, yo);
      aviso = (ev && textoDeEvento(ev, yo)) || TEXTOS_ORDEN.yaSuena;
    }
    if (o.enviando) { if (res === 'aplicada' || res === 'ya-cambio' || res === 'cancelada') { o.resuelta = res; o.aviso = aviso; } return; }
    cerrarCon(tipo, res, aviso);
  };
  /** La cuenta de un 429: una cadena de setTimeout de 1000 ms (nunca setInterval). */
  const empezarEspera = (s) => {
    clearTimeout(esperaRef.current.t);
    const paso = (n) => {
      esperaRef.current.s = n;
      setEsperaOrden(n);
      if (n <= 0) { esperaRef.current.t = null; if (lineaDeRef.current === 'espera') decirOrden(null); return; }
      decirOrden(textoDeEspera(n), 'espera', lineaDeRef.current === 'espera');
      esperaRef.current.t = setTimeout(() => paso(n - 1), 1000);
    };
    paso(s);
  };

  /** Lo de la moderación vuelve a cero (otra sala, o ninguna). */
  const limpiarModeracion = () => {
    setModeradores([]);
    setEventos([]);
    setSinSoporte(new Set());
    eventosVistosRef.current = new Set();
    setAnuncio(null);
    limpiarOrdenes();
    vistaModRef.current = { ...VISTA_MOD_VACIA, estado: null, cursor: 0 };
    setVistaMod(VISTA_MOD_VACIA);
  };

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      genRef.current += 1;
      // W5b-1: ningún temporizador de las órdenes sobrevive al provider.
      for (const o of ordenesRef.current.values()) for (const t of o.timers) clearTimeout(t);
      ordenesRef.current.clear();
      clearTimeout(esperaRef.current.t);
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
    limpiarModeracion();
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
    anfitrionRef.current = null;
    setAnfitrion(null);
    setAviso(null);
    setSilenciada(false);
    setQuiereSonar(false);
    limpiarModeracion();
    if (razon) setFin({ razon, texto: textoDeFin('oyente', razon) });
  }, []);

  const alOyentes = useCallback((gen, lista) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setOyentes((prev) => (mismosOyentes(prev, lista) ? prev : lista));
  }, []);

  /** Del puente del anfitrión, en cada lectura con moderación: quién modera y los eventos nuevos. A la
   *  región viva van todos; al aviso breve, solo el último de OTRA persona (lo propio ya se vio). */
  const alModeracion = useCallback((gen, lista, llegados) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setModeradores((prev) => (mismosOyentes(prev, lista) ? prev : lista));
    const nuevos = (llegados ?? []).filter((e) => !eventosVistosRef.current.has(e.id));
    if (!nuevos.length) return;
    for (const e of nuevos) eventosVistosRef.current.add(e.id);
    setEventos((prev) => juntarEventos(prev, nuevos));
    const ajenos = nuevos.filter((e) => avisarEvento(e, userIdRef.current));
    if (ajenos.length) toast(textoDeEvento(ajenos[ajenos.length - 1], userIdRef.current), { duration: AVISO_EVENTO_MS });
  }, [toast]);

  /** Del puente del oyente (W5a): los eventos nuevos y lo que hay que anunciar (pasoDeEventos). A la región
   *  viva va TODO lo de esta lectura junto (así nada se pisa); al toast, lo último que lleva toast. */
  const alEventosOyente = useCallback((gen, nuevos, anuncios) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    if (nuevos.length) setEventos((prev) => juntarEventos(prev, nuevos));
    if (!anuncios.length) return;
    const texto = anuncios.map((a) => a.texto).join('. ');
    setAnuncio((a) => ({ texto, n: (a?.n ?? 0) + 1 }));
    const conToast = anuncios.filter((a) => a.toast);
    if (conToast.length) toast(conToast[conToast.length - 1].texto, { duration: AVISO_EVENTO_MS });
  }, [toast]);

  /** Del puente del oyente (W5b-1), en cada lectura con moderación: lo que ve (si modera, si la radio
   *  admite órdenes, el estado y el cursor de eventos) y los eventos nuevos. Con eso se revisan las
   *  órdenes en vuelo; perder el rol las cancela sin error. */
  const alVistaOyente = useCallback((gen, obs) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    const antes = vistaModRef.current;
    const e = obs.estado ?? null;
    vistaModRef.current = { modera: obs.modera, admite: obs.admite, playing: e?.playing ?? null, seq: e?.seq ?? null, trackId: e?.trackId ?? null, estado: e, cursor: obs.cursor ?? 0 };
    const v = { modera: obs.modera, admite: obs.admite, playing: e?.playing ?? null, conBase: e?.seq != null, trackId: e?.trackId ?? null };
    setVistaMod((prev) => (Object.keys(v).every((k) => prev[k] === v[k]) ? prev : v));
    if (!obs.modera) { if (antes.modera) limpiarOrdenes(); return; }
    for (const tipo of [...ordenesRef.current.keys()]) revisarOrden(tipo, obs.nuevos);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const alAviso = useCallback((gen, a) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setAviso(a);
  }, []);

  const alQuiereSonar = useCallback((gen, q) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setQuiereSonar(q);
  }, []);

  // 1.45.1: el desajuste devolvió al oyente a la de la radio (PuenteOyente). Un toast que dice por qué, si
  // avisarVuelta lo pide: no cuando la canción terminó sola, y como mucho uno cada 30 s.
  const alVuelta = useCallback((gen, d) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    const ahora = Date.now();
    if (!avisarVuelta({ ...d, ahoraMs: ahora, ultimoMs: ultimaVueltaRef.current })) return;
    ultimaVueltaRef.current = ahora;
    toast(textoDeVuelta(anfitrionRef.current?.name), { duration: AVISO_VUELTA_MS });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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
    // 1.45.0: este reproductor ejecuta órdenes de quien modera (se declara solo al crear).
    const r = await api.radioCrear({ capabilities: { orders: true } });
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
    limpiarModeracion();
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
    limpiarModeracion();
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
    limpiarModeracion();
    const r = await api.radioLeer(codigoSala, LECTURA_OYENTE);
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
    anfitrionRef.current = r.radio.host ?? null;
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

  /** El anfitrión nombra (si) o quita (no) a quien modera → { ok } | { ok: false, error }. Al salir bien,
   *  la lista entra ya y el puente arranca (o corta) la lectura de 2 s en el acto, sin esperar la de 5 s.
   *  Un 409 sin-soporte deja a esa persona sin botón en esta sala (no se reintenta); lo demás, al aviso. */
  const moderar = useCallback(async (userId, si) => {
    if (faseRef.current !== 'anfitrion') return { ok: false, error: 'fase' };
    const gen = genRef.current;
    const r = await api.radioModerador(codigoRef.current, userId, si);
    if (gen !== genRef.current || !montadoRef.current) return { ok: false, error: 'vieja' };
    if (r.ok) {
      setModeradores(r.moderators);
      moderarRef.current?.(r.moderators, r.serverNow);
      return { ok: true };
    }
    if (r.error === 'sin-soporte') setSinSoporte((s) => new Set(s).add(userId));
    else setError(textoDeFallo('moderar', r));
    return { ok: false, error: r.error };
  }, []);
  /** Quien modera manda una orden desde su tarjeta (W5b-1) o desde el menú "En la radio" (W5b-2, con la
   *  pista): una en vuelo por tipo. "siguiente" lleva la base (el seq del estado que se ve). → lo de
   *  api.radioOrdenar, o { ok: false, error } sin mandar. Sin el rol (el menú no lo refresca abierto)
   *  cancela sin error; del menú, una segunda del mismo tipo en vuelo lo dice en la línea. */
  const ordenar = useCallback(async (tipo, trackId = null) => {
    const delMenu = ORDENES_DEL_MENU.includes(tipo);
    if (faseRef.current !== 'oyente' || !(delMenu || ORDENES_DE_LA_TARJETA.includes(tipo))) return { ok: false, error: 'fase' };
    const v = vistaModRef.current;
    if (!v.modera || !v.admite) return { ok: false, error: 'sin-rol' };
    if (ordenesRef.current.has(tipo) || esperaRef.current.s > 0) {
      if (delMenu) {
        if (esperaRef.current.s > 0) decirOrden(textoDeEspera(esperaRef.current.s), 'espera');
        else decirOrden(TEXTOS_ORDEN.anterior, tipo);
      }
      return { ok: false, error: 'ocupado' };
    }
    if (tipo === 'siguiente' && v.seq == null) return { ok: false, error: 'sin-estado' };
    const gen = genRef.current;
    const o = { tipo, trackId: delMenu ? trackId : null, baseTrackId: v.trackId, cursor: v.cursor, enviadaEn: Date.now(), enviando: true, resuelta: null, aviso: null, esperando: false, timers: [] };
    ordenesRef.current.set(tipo, o);
    setOrdenando((x) => ({ ...x, [tipo]: true }));
    decirOrden(TEXTOS_ORDEN.enviando, tipo);
    const r = await api.radioOrdenar(codigoRef.current,
      tipo === 'siguiente' ? { type: tipo, seqBase: v.seq } : delMenu ? { type: tipo, trackId } : { type: tipo });
    if (gen !== genRef.current || !montadoRef.current || ordenesRef.current.get(tipo) !== o) return { ok: false, error: 'vieja' };
    o.enviando = false;
    if (!r.ok) {
      cerrarOrden(tipo);
      if (r.error === 'frecuencia') empezarEspera(Math.max(1, Math.ceil(r.esperaMs / 1000)));
      else decirOrden(textoDeFallo('ordenar', r), tipo, false, true);
      return r;
    }
    if (o.resuelta) { cerrarCon(tipo, o.resuelta, o.aviso); return r; }
    if (lineaDeRef.current === tipo) decirOrden(null);
    o.timers = [setTimeout(() => revisarOrden(tipo), ORDEN_ESPERANDO_MS), setTimeout(() => revisarOrden(tipo), ORDEN_VENCE_MS)];
    return r;
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // W5b-2: el menú contextual (montado POR ENCIMA de este provider) lee lo que ve quien modera y manda
  // las órdenes "En la radio" por acá. Es un ref, no un contexto: el menú lo lee solo al armar sus
  // acciones, así que ni la radio re-renderiza el menú ni el menú a la radio.
  useEffect(() => registrarRadioEnMenu({
    // 1.45.1: además, quién transmite y la línea "Estás en la radio de…" para quien escucha sin moderar.
    vista: () => (faseRef.current === 'oyente'
      ? { ...vistaModRef.current, anfitrion: anfitrionRef.current?.name ?? null, enLaRadio: textoEnLaRadio(anfitrionRef.current?.name) }
      : null),
    ordenar,
  }), [ordenar]);

  const nombrarModerador = useCallback((userId) => moderar(userId, true), [moderar]);
  const quitarModerador = useCallback((userId) => moderar(userId, false), [moderar]);

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
      moderadores, eventos, sinSoporte, nombrarModerador, quitarModerador, anuncio,
      vistaMod, ordenando, lineaOrden, esperaOrden, ordenar,
    }),
    [fase, codigo, oyentes, fin, error, anfitrion, aviso, silenciada, quiereSonar, iniciar, terminar, limpiarFin, unirse, salir, tocarParaEscuchar,
      moderadores, eventos, sinSoporte, nombrarModerador, quitarModerador, anuncio,
      vistaMod, ordenando, lineaOrden, esperaOrden, ordenar],
  );

  return (
    <RadioContext.Provider value={value}>
      {children}
      {fase === 'anfitrion' && codigo && (
        <PuenteAnfitrion key={codigo} codigo={codigo} gen={genSala} genRef={genRef} salir={finAnfitrion} alOyentes={alOyentes}
          alModeracion={alModeracion} moderarRef={moderarRef} />
      )}
      {fase === 'oyente' && codigo && (
        <PuenteOyente
          key={codigo} codigo={codigo} gen={genSala} genRef={genRef}
          primeraRef={primeraRef} fotoRef={fotoRef} motorRef={motorRef} tocarRef={tocarRef}
          salir={finOyente} alOyentes={alOyentes} alAviso={alAviso} alSilenciada={alSilenciada} alVuelta={alVuelta}
          alQuiereSonar={alQuiereSonar} alEventos={alEventosOyente} alVista={alVistaOyente} yoRef={userIdRef}
        />
      )}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  return useContext(RadioContext);
}

/** Los ids de una lista de moderadores (personas ya leídas por leerPersona) → Set. */
const idsDeModeradores = (lista) => new Set((Array.isArray(lista) ? lista : []).map((p) => p?.id).filter(Number.isSafeInteger));

// ── El puente del anfitrión: publica lo que suena, lee quién escucha y aplica las órdenes ──
//
// Publica por CAMBIOS (pista, pausa, siguiente, salto, posición: cada render trae el estado nuevo y
// se mira en el acto) y con un temporizador de respaldo cada MIRAR_CADA_MS para la pausa, el latido
// y los reintentos. Quién decide: debePublicar (¿hay algo?), la puerta (¿se puede ahora?: una sola en
// vuelo, Retry-After, reintento a los 3 s, canción rechazada) y alResponder (qué hacer con la
// respuesta). Todo eso es puro y vive en radioSync.js.
//
// ÓRDENES (1.45.0). Llegan en la lectura de la sala (?desde=) y en la respuesta del PUT que confirma.
//  · Un Set de ids vistos: una orden que vuelve a llegar (sigue pendiente hasta confirmarla) no se
//    aplica dos veces.
//  · De a UNA, en orden de id: la siguiente espera a que el motor muestre lo que hizo la anterior
//    (esperarMotor, tope ESPERA_MOTOR_MS). Así el cambio de pista de una no se toma por el de otra,
//    y cada una se decide (planDeOrden) con lo que suena de verdad.
//  · planDeOrden recibe, además de lo publicado, dos datos LOCALES que no se publican: haySiguiente
//    (siguienteDelMotor) y alFinal (alFinalDeLaCola). Lo que se publica es lo de 1.42.0.
//  · "siguiente" cuando no se sabe si el motor tiene a dónde ir (haySiguiente null): se llama next() y
//    cuenta como aplicada SOLO si cambió la pista o el índice en ESPERA_MOTOR_MS; si no, se descarta
//    ('sin-siguiente'), sin evento. Hasta M4 era el caso del aleatorio sin repetir la cola (el motor
//    sorteaba entre las no sonadas); desde M4 el aleatorio camina por posición y siguienteDelMotor
//    siempre sabe, así que el camino queda como red.
//    CASO RARO, aceptado: si el propio anfitrión cambia de pista (o quita una de antes y corre el
//    índice) dentro de esa ventana, ese cambio se cuenta como efecto de la orden.
//  · Resuelta (aplicada o descartada), va a resueltasRef y sale en el próximo PUT (confirmacionDe:
//    ordenHasta y las aplicadas, en tandas de 10). Con algo por confirmar, debePublicar da
//    'confirmar' aunque el estado no cambie. Si el PUT falla (429, red), queda para el siguiente.
//    Lo aplicado se confirma en el MISMO render que muestra el cambio, antes de mirar(): el PUT lleva
//    el estado nuevo y la confirmación juntos.
//  · Al desmontar (terminar, salir, cerrar sesión, otra radio: key={codigo}) se corta la espera del
//    motor y una orden a medio traer su pista (api.track) se abandona: vigente() antes de tocar nada.
function PuenteAnfitrion({ codigo, gen, genRef, salir, alOyentes, alModeracion, moderarRef }) {
  const { currentTrack, isPlaying, queue, queueIndex, shuffle, repeat, upNext, next, pause, resume, playAfterCurrent, pendientesDe } = usePlayer();
  const { currentTime, duration } = usePlayerTime();

  const actual = estadoDelAnfitrion({ current: currentTrack, queue, queueIndex, playing: isPlaying, posicionSeg: currentTime });
  const actualRef = useRef(actual);   // lo último, para el temporizador (se escribe en un efecto, no en el render)
  const motorRef = useRef(null);      // lo local del motor para las órdenes (tampoco se publica)

  const puertaRef = useRef(PUERTA_INICIAL);
  const publicadoRef = useRef(null);
  const leyendoRef = useRef(false);
  const leidaEnRef = useRef(0);       // hora local de la última lectura de la sala
  const cursorRef = useRef(0);        // eventsUntil: el último evento visto (?desde=)
  const [conModeradores, setConModeradores] = useState(false);

  const vivoRef = useRef(true);
  const vistasRef = useRef(new Set());   // ids de órdenes ya recibidas
  const porAplicarRef = useRef([]);      // recibidas y sin aplicar, en orden de id
  const aplicandoRef = useRef(false);
  const resueltasRef = useRef([]);       // [{ id, aplicada }] sin confirmar
  const esperaRef = useRef(null);        // { listo(motor), fin(cambio), timer } | null
  const modsRef = useRef(null);          // ids de quienes moderan AHORA (lo último del servidor); null: todavía nada
  const modsEnRef = useRef(-Infinity);   // el serverNow de esa lista: una más vieja que llega tarde no la pisa

  const vigente = useCallback(() => vivoRef.current && gen === genRef.current, [gen, genRef]);
  // ¿Quien mandó la orden sigue moderando? Sin lista todavía, sí: las órdenes llegan junto con ella
  // (la lectura con ?desde= las trae con moderators, y el PUT solo las devuelve después de esa).
  const sigueModerando = (o) => modsRef.current == null || modsRef.current.has(o.by);
  // La lista nueva, solo si es la más nueva vista (por serverNow, el reloj del servidor): una lectura que
  // salió antes de nombrar y llega después no la pisa. Solo refs: no hay render.
  const ponerModeradores = (lista, serverNow) => {
    if (!Number.isFinite(serverNow) || serverNow < modsEnRef.current) return;
    modsEnRef.current = serverNow;
    modsRef.current = idsDeModeradores(lista);
  };

  // Las órdenes y mirar() se llaman entre sí (mirar recibe las del PUT; resolver una pide publicar):
  // se cruzan por refs para no encadenar dependencias.
  const mirarRef = useRef(null);
  const recibirRef = useRef(null);

  const mirar = useCallback(async () => {
    if (!vigente()) return;
    const ahora = Date.now();
    const a = actualRef.current;
    if (!puertaAbierta(puertaRef.current, a, ahora)) return;
    const conf = confirmacionDe(resueltasRef.current);
    if (!debePublicar(publicadoRef.current, a, ahora, conf != null)) return;
    puertaRef.current = alPublicar(puertaRef.current);
    const salidaMs = Date.now();
    // Sin nada que confirmar, la llamada (y el cuerpo) de 1.42.0.
    const r = conf ? await api.radioPublicar(codigo, a, conf) : await api.radioPublicar(codigo, a);
    if (!vigente()) return;
    const x = alResponder(puertaRef.current, r, a, salidaMs, Date.now());
    puertaRef.current = x.puerta;
    if (x.publicado) publicadoRef.current = x.publicado;
    if (x.expulsar) { salir(gen, x.expulsar); return; }
    if (r.ok && conf) {
      resueltasRef.current = resueltasRef.current.filter((o) => o.id > conf.ordenHasta);
      if (r.orders) recibirRef.current?.(r.orders);
    }
  }, [codigo, gen, salir, vigente]);
  mirarRef.current = mirar;

  /** Una orden resuelta: queda para el próximo PUT, y se intenta publicar ya. */
  const anotar = (id, aplicada) => {
    resueltasRef.current.push({ id, aplicada });
    mirarRef.current?.();
  };

  /** Espera a que el motor cumpla `listo` (lo mira cada render) o a ESPERA_MOTOR_MS. `alTerminar()`
   *  corre SÍNCRONA dentro del render que lo muestra, antes de mirar(); al vencer el tope, en el temporizador. */
  const esperarMotor = (listo, alTerminar) => new Promise((resolve) => {
    const e = {
      listo,
      fin: () => {
        if (esperaRef.current !== e) return;
        clearTimeout(e.timer);
        esperaRef.current = null;
        alTerminar();
        resolve();
      },
    };
    e.timer = setTimeout(() => e.fin(), ESPERA_MOTOR_MS);
    esperaRef.current = e;
    if (listo(motorRef.current)) e.fin();   // ya estaba así (p. ej. pausa sobre algo en pausa)
  });

  /** Lo que planDeOrden necesita saber AHORA: lo publicado más lo local del motor (y, para el tope, cuántas
   *  peticiones de quien mandó `o` siguen pendientes). */
  const loLocal = (o) => {
    const a = actualRef.current;
    const m = motorRef.current;
    const haySiguiente = siguienteDelMotor(m);
    return { ...a, haySiguiente, alFinal: alFinalDeLaCola({ playing: a.playing, posicionMs: a.positionMs, duracionMs: m.duracionMs, haySiguiente }),
      pendientesDeQuienPide: pendientesDe(o.by) };
  };

  const aplicarOrden = async (o) => {
    let plan = planDeOrden(o, loLocal(o));
    if (!plan.aplicar) return anotar(o.id, false);
    const m = motorRef.current;
    // ¿Pasó a otra entrada de la cola? (la pista o el índice: el estado real del motor)
    const otraPista = (antes) => (x) => (x.currentTrack?.id ?? null) !== (antes.currentTrack?.id ?? null) || x.queueIndex !== antes.queueIndex;
    // Lo que pone otra pista (next, "ahora") la hace SONAR (playIndex): se espera a que suene, así el PUT
    // que confirma no la publica "en pausa" por el instante entre el cambio y el evento play del <audio>.
    const otraSonando = (antes) => (x) => otraPista(antes)(x) && x.isPlaying;
    switch (o.type) {
      case 'pausa': pause(); return esperarMotor((x) => !x.isPlaying, () => anotar(o.id, true));
      case 'reanudar': resume(); return esperarMotor((x) => x.isPlaying, () => anotar(o.id, true));
      case 'siguiente':
        next();
        // Con lo que se sabe, se aplica igual; si no se sabía (verificar), solo si de verdad cambió de
        // pista (aunque el navegador no la deje sonar: eso no la hace menos aplicada).
        return esperarMotor(otraSonando(m), () => anotar(o.id, plan.verificar ? otraPista(m)(motorRef.current) : true));
      default: {   // 'a-continuacion' | 'ahora': primero la pista
        let cola = null;
        try { const t = await api.track(o.trackId); cola = colaDelOyente(() => t, o.trackId, null); } catch { cola = null; }
        if (!vigente()) return;
        if (!sigueModerando(o)) return anotar(o.id, false);   // le quitaron el rol mientras llegaba la pista
        if (!cola) return anotar(o.id, false);
        plan = planDeOrden(o, loLocal(o));  // pudo cambiar mientras llegaba la pista (un video, otra canción)
        if (!plan.aplicar) return anotar(o.id, false);
        const m2 = motorRef.current;
        const sonabaAlgo = m2.queueIndex >= 0;
        const ahora = o.type === 'ahora' || plan.como === 'ahora';
        // "a continuación" de la radio va en ORDEN DE LLEGADA (pedidoPor); "ahora" se inserta como el menú
        // local y next() la hace sonar. Sin nada sonando, ya arranca con ella.
        playAfterCurrent(cola, ahora ? undefined : { pedidoPor: o.by });
        if (ahora && sonabaAlgo) next();       // "a continuación" gana: suena ella
        const listo = ahora || !sonabaAlgo ? otraSonando(m2) : (x) => x.queue !== m2.queue;
        return esperarMotor(listo, () => anotar(o.id, true));
      }
    }
  };

  const procesar = async () => {
    if (aplicandoRef.current) return;
    aplicandoRef.current = true;
    try {
      while (vigente() && porAplicarRef.current.length) {
        const o = porAplicarRef.current.shift();
        // Quien la mandó dejó de moderar mientras esperaba su turno: se descarta sin evento (el servidor
        // ya anotó el "sin-moderador" al quitar) y se confirma como descartada, para que no quede colgada.
        if (!sigueModerando(o)) { anotar(o.id, false); continue; }
        try { await aplicarOrden(o); } catch { if (vigente()) anotar(o.id, false); }
      }
    } finally { aplicandoRef.current = false; }
  };

  recibirRef.current = (lista) => {
    if (!vigente() || !Array.isArray(lista)) return;
    for (const o of lista) {
      if (vistasRef.current.has(o.id)) continue;   // sigue pendiente hasta confirmarla: llega otra vez
      vistasRef.current.add(o.id);
      porAplicarRef.current.push(o);
    }
    porAplicarRef.current.sort((a, b) => a.id - b.id);
    procesar();
  };

  const leerOyentes = useCallback(async () => {
    if (!vigente() || leyendoRef.current) return;
    if (Date.now() - leidaEnRef.current < LECTURA_MIN_MS) return;
    leyendoRef.current = true;
    leidaEnRef.current = Date.now();
    const r = await api.radioLeer(codigo, { desde: cursorRef.current });
    leyendoRef.current = false;
    if (!vigente()) return;
    if (r.ok) {
      if (r.radio.status === 'ended') { salir(gen, r.radio.endedReason ?? 'otro'); return; }
      const host = r.radio.host?.id;
      alOyentes(gen, r.radio.listeners.filter((p) => p.id !== host));
      // Lo de la moderación, si el servidor lo trae (uno sin moderación no lo manda: nada cambia).
      if (r.radio.moderators) {
        ponerModeradores(r.radio.moderators, r.serverNow);
        if (r.radio.eventsUntil != null) cursorRef.current = r.radio.eventsUntil;
        setConModeradores(r.radio.moderators.length > 0);
        alModeracion(gen, r.radio.moderators, r.radio.events);   // W4: la lista y los eventos, a la vista
        if (r.radio.orders) recibirRef.current?.(r.radio.orders);
      }
      return;
    }
    if (r.error === 'no-existe') salir(gen, 'no-existe');
    else if (r.error === 'terminada') salir(gen, r.razon);
    else if (r.error === 'sesion') salir(gen, 'sesion');
    // red caída, 429, 5xx: se vuelve a intentar en el próximo turno, sin salir.
  }, [codigo, gen, salir, alOyentes, alModeracion, vigente]);

  // W4: al nombrar o quitar desde la vista, la lectura de 2 s arranca (o se corta) en ESE render, sin
  // esperar a la de 5 s, y se lee ya para traer lo nuevo (LECTURA_MIN_MS evita una lectura pegada).
  useEffect(() => {
    moderarRef.current = (lista, serverNow) => {
      if (!vigente()) return;
      ponerModeradores(lista, serverNow);
      setConModeradores(lista.length > 0);
      leerOyentes();
    };
    return () => { moderarRef.current = null; };
  }, [moderarRef, vigente, leerOyentes]);

  // Vivo mientras está montado (va PRIMERO: el doble montaje de StrictMode lo vuelve a poner en true
  // antes de que el efecto de abajo publique); al desmontar se corta la espera del motor (su temporizador).
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
      const e = esperaRef.current;
      esperaRef.current = null;
      if (e) clearTimeout(e.timer);
    };
  }, []);

  // Por cambios: en cada render se guarda lo último, se resuelve la orden que esperaba al motor (su
  // confirmación sale en ESTE mirar, junto con el estado nuevo) y se mira (debePublicar devuelve null
  // casi siempre, y es barato). El primer render publica en el acto ('primero').
  useEffect(() => {
    actualRef.current = actual;
    motorRef.current = { currentTrack, queue, queueIndex, shuffle, repeat, upNext, isPlaying, duracionMs: duration > 0 ? duration * 1000 : null };
    const e = esperaRef.current;
    if (e && e.listo(motorRef.current)) e.fin(true);
    mirar();
  });

  // Respaldo y oyentes. Se montan una vez por sala; al desmontar (salida, terminar, logout) se cortan.
  useEffect(() => {
    leerOyentes();
    const t1 = setInterval(mirar, MIRAR_CADA_MS);
    const t2 = setInterval(leerOyentes, OYENTES_CADA_MS);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [mirar, leerOyentes]);

  // Con moderadores, la lectura más seguida (ver ORDENES_CADA_MS). Sin ellos no existe.
  useEffect(() => {
    if (!conModeradores) return undefined;
    const t = setInterval(leerOyentes, ORDENES_CADA_MS);
    return () => clearInterval(t);
  }, [conModeradores, leerOyentes]);

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
function PuenteOyente({ codigo, gen, genRef, primeraRef, fotoRef, motorRef, tocarRef, salir, alOyentes, alAviso, alSilenciada, alVuelta, alQuiereSonar, alEventos, alVista, yoRef }) {
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
  // 1.45.1: cómo empezó el desajuste (para el aviso) y la duración MEDIDA de la de la radio mientras sonaba.
  const desvioRef = useRef(null);
  const durRadioRef = useRef(null);
  const cargaFallidaRef = useRef(null);   // null | 'falta-cancion' | 'no-se-pudo-cargar'
  const ctPrevioRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    // W5a: { cursor, moderaba } de los eventos; null hasta la primera lectura (la de unirse fija la base).
    let eventos = null;
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
      durRadioRef.current = null;   // es otra canción (o la misma desde otro punto): se vuelve a medir
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
        if (desajusteDesdeRef.current == null) {
          desajusteDesdeRef.current = ahora;
          // 1.45.1: qué sonaba, la siguiente que publicó el anfitrión y lo que le faltaba a la de la radio.
          const dr = durRadioRef.current;
          desvioRef.current = { sonaba: idDeCancion(j.currentTrack), siguienteId: estadoRef.current?.nextTrackId ?? null, restanteMs: dr ? dr - objetivo(dr) : null };
          return;
        }
        if (ahora - desajusteDesdeRef.current < DESAJUSTE_MS) return;
        const e = estadoRef.current;
        const desvio = desvioRef.current;
        desvioRef.current = null;
        await arrancar(s.trackId, e?.trackId === s.trackId ? e.nextTrackId : null, s.playing, s);
        if (vigente() && !cargaFallidaRef.current && desvio) alVuelta(gen, desvio);
        return;
      }
      desajusteDesdeRef.current = null;
      desvioRef.current = null;
      { const dm = durMs(); if (dm) durRadioRef.current = dm; }

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
      // Con la base fijada, la MISMA vuelta lee además los eventos desde el cursor (?desde=).
      if (!lectura) lectura = await api.radioLeer(codigo, eventos ? { ...LECTURA_OYENTE, desde: eventos.cursor } : LECTURA_OYENTE);
      if (!vigente()) return;
      if (lectura.ok) {
        relojRef.current = mejorReloj(relojRef.current, lectura.muestra);
        if (lectura.radio.status !== 'ended') {
          const host = lectura.radio.host?.id;
          alOyentes(gen, lectura.radio.listeners.filter((p) => p.id !== host));
          if (lectura.radio.state) estadoRef.current = lectura.radio.state;
          const pe = pasoDeEventos(eventos, lectura.radio, Number(yoRef.current));
          eventos = pe.estado;
          if (pe.nuevos.length || pe.anuncios.length) alEventos(gen, pe.nuevos, pe.anuncios);
          // W5b-1: lo que ve quien modera (después de los eventos: la región ya tiene el "Tú pausaste").
          if (Array.isArray(lectura.radio.moderators)) {
            alVista(gen, {
              modera: esModerador(lectura.radio, Number(yoRef.current)), admite: lectura.radio.capabilities?.orders === true,
              estado: lectura.radio.state ?? null, cursor: eventos?.cursor ?? 0, nuevos: pe.nuevos,
            });
          }
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
  }, [codigo, gen, genRef, primeraRef, fotoRef, motorRef, tocarRef, salir, alOyentes, alAviso, alSilenciada, alVuelta, alQuiereSonar, play, seek, pause, resume, setRepeatMode]);

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
