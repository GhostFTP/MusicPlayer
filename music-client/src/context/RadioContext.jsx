import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { usePlayer, usePlayerTime } from './PlayerContext.jsx';
import {
  PUERTA_INICIAL, puertaAbierta, alPublicar, alResponder, debePublicar,
  estadoDelAnfitrion, textoDeFin, textoDeFallo,
} from '../utils/radioSync.js';

// RADIO WEB, EL ANFITRIÓN (fase 1, sub-paso 3). Port del puente de iOS
// (sonorarev-ios components/radio/puente-anfitrion.tsx, 2a3bc86) sobre la lógica pura de
// utils/radioSync.js. Dos piezas:
//
//  · RadioProvider — el estado de la SALA: fase, código, oyentes, por qué terminó, el último error,
//    e iniciar()/terminar(). Va en App.jsx alrededor de <Layout/>: queda POR ENCIMA de las vistas
//    (navegar no corta la radio) y DEBAJO de Auth/Player/Toast. Con logout o el reauth de SSO, App
//    deja de pintar Layout y esto se desmonta: se cortan los temporizadores y NO se manda DELETE
//    (el token ya no vale; el servidor cierra la sala sola a los 5 min sin latido).
//    El provider NO lee el reproductor: su valor sólo cambia cuando cambia la sala (no a 4 Hz).
//
//  · <PuenteAnfitrion/> — sin UI, montado SÓLO con fase === 'anfitrion'. Es el único que lee
//    usePlayer y usePlayerTime: re-renderiza a ~4 Hz mientras suena, pero es una hoja aparte que
//    devuelve null, así que eso no toca a Layout ni a las vistas. Publica el estado y lee oyentes.
//
// Nada crea una radio solo: únicamente iniciar(), que llama la vista desde un clic. Por eso el
// doble montaje de StrictMode (desarrollo) no puede abrir dos salas.

const RadioContext = createContext(null);

/** Cada cuánto se revisa el reproductor aunque no cambie nada (iOS: MIRAR_CADA_MS). Es el respaldo
 *  para la pausa, donde no hay 'timeupdate', y para soltar un reintento o un Retry-After. */
const MIRAR_CADA_MS = 500;
/** Cada cuánto se lee la sala para saber quién escucha (iOS: OYENTES_CADA_MS). */
const OYENTES_CADA_MS = 5000;

const mismosOyentes = (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id && p.name === b[i].name);

export function RadioProvider({ children }) {
  const [fase, setFase] = useState('sin-radio');   // 'sin-radio' | 'creando' | 'anfitrion' | 'terminando'
  const [codigo, setCodigo] = useState(null);
  const [genSala, setGenSala] = useState(0);       // la generación con que se abrió la sala actual
  const [oyentes, setOyentes] = useState([]);
  const [fin, setFin] = useState(null);            // { razon, texto } | null
  const [error, setError] = useState(null);        // texto | null

  // Espejos síncronos: un segundo clic llega antes del re-render, y pagehide lee la fase en el acto.
  const faseRef = useRef('sin-radio');
  const codigoRef = useRef(null);
  const ponerFase = (f) => { faseRef.current = f; setFase(f); };
  // GENERACIÓN: cada sala (y cada salida) la sube. Toda respuesta asíncrona trae la generación con
  // que salió y se ignora si ya no es la actual: así una respuesta tardía de una radio anterior, o
  // de un puente ya desmontado, no puede pisar el estado.
  const genRef = useRef(0);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; genRef.current += 1; };
  }, []);

  /** Sale la radio por una razón (del servidor o local). Sólo si `gen` sigue siendo la actual. */
  const salir = useCallback((gen, razon) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    genRef.current += 1;
    codigoRef.current = null;
    ponerFase('sin-radio');
    setCodigo(null);
    setOyentes([]);
    setFin({ razon, texto: textoDeFin('anfitrion', razon) });
  }, []);

  const alOyentes = useCallback((gen, lista) => {
    if (gen !== genRef.current || !montadoRef.current) return;
    setOyentes((prev) => (mismosOyentes(prev, lista) ? prev : lista));
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

  const limpiarFin = useCallback(() => { setFin(null); setError(null); }, []);

  // Cerrar la pestaña (o navegar fuera): DELETE con keepalive, que sobrevive a la descarga y lleva el
  // Bearer. Si la página no se descarga sino que queda en la caché del navegador (event.persisted) y
  // vuelve, la sala ya está cerrada: el próximo latido recibe 410 y el puente sale limpio, con su texto.
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
    () => ({ fase, codigo, oyentes, fin, error, iniciar, terminar, limpiarFin }),
    [fase, codigo, oyentes, fin, error, iniciar, terminar, limpiarFin],
  );

  return (
    <RadioContext.Provider value={value}>
      {children}
      {fase === 'anfitrion' && codigo && (
        <PuenteAnfitrion key={codigo} codigo={codigo} gen={genSala} genRef={genRef} salir={salir} alOyentes={alOyentes} />
      )}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  return useContext(RadioContext);
}

// ── El puente: publica lo que suena y lee quién escucha ──
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
