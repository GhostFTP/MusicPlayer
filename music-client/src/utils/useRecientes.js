import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { cachedLibrary, libraryTracks, onLibraryChange } from './viewTracks.js';
import { umbralDe, indicesRecientes } from './recientes.js';
import { ERROR_TOAST_MS, MIX_ERROR_TEXT } from './mixPlayback.js';

// «Recién añadidas» en Álbumes, Artistas, Géneros y Años (utils/recientes.js). Lo comparten las cuatro
// vistas: el estado del chip y los índices de lo reciente, derivados de la biblioteca COMPLETA.
//
// LA FUENTE es la misma de la Biblioteca, el Mix y el buscador: la lista 'tracks:all' de viewCache,
// stale-while-revalidate (utils/viewTracks.js). Y SE PIDE AL PRIMER TOQUE, NO AL MONTAR: abrir la vista
// no cuesta ni un /api/tracks (son ~270 KB con 680 pistas, ~20 MB con 50 000: no se paga por una vista
// cuyo chip quizá nunca se toque). El montaje sólo LEE la caché, de forma síncrona y sin pedir nada.
//   · Primer toque con la lista ya en memoria (p. ej. porque se visitó la Biblioteca): se aplica al instante.
//   · Primer toque sin ella: el chip queda ENCENDIDO pero OCUPADO (`cargando` → aria-busy, como el Mix:
//     sin `disabled` nativo, que perdería el foco) y el filtro se aplica cuando llega la lista, SÓLO si el
//     chip sigue encendido. Un segundo toque mientras carga CANCELA la intención (la respuesta tardía se
//     descarta; el pedido igual queda cacheado para el próximo toque).
//   · Si el pedido falla, el chip vuelve a apagarse con el MISMO aviso ámbar que el Mix (mixPlayback.js).
//     Con 401 no hay aviso: el cliente ya cierra la sesión (api/client.js).
//   · La lista cacheada NO se revalida por tocar el chip (ningún pedido nuevo con la caché caliente); si
//     otra pantalla revalida y cambia la biblioteca (onLibraryChange), los índices se recalculan en el lugar.
//
// PRECARGA (opcional, `precargar`): pasar el ratón por el chip o enfocarlo con el teclado calienta la
// misma caché (sin estado, sin bloquear, errores ignorados, a lo sumo una cada PRECARGA_MS). Con el dedo no
// hay «pasar por encima»: el primer toque paga el pedido, igual que el Mix.
//
// Una biblioteca vacía ([], que es también lo que devuelve libraryTracks si la cuenta cambió) no cuenta
// como lista: no hay nada reciente que filtrar.
//
// SIN PERSISTENCIA: el estado es de esta visita (ni localStorage ni URL). La vista se desmonta al salir y
// arranca apagada. `apagar` es para «tocar la pestaña activa», igual que borra el buscador.
// `tocado`: ya se usó el chip en esta visita; las vistas con entrada escalonada (Artistas, Géneros) lo
// suman a `touched` del buscador para no reanimar cada tarjeta que vuelve al alternar.
//
// Devuelve:  on (el filtro está APLICADO: lo que usan las vistas para filtrar) · pulsado (la INTENCIÓN: lo
// que muestra el chip) · cargando · idx · toggle · precargar · apagar · tocado.
const PRECARGA_MS = 30000;

export function useRecientes() {
  const toast = useToast();
  const [lib, setLib] = useState(() => cachedLibrary());
  const [pulsado, setPulsado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [tocado, setTocado] = useState(false);
  const intento = useRef(0);        // sube con cada cambio de intención: la respuesta de un intento viejo se descarta
  const vivo = useRef(true);
  const ultimoAviso = useRef(0);
  const ultimaPrecarga = useRef(0);

  useEffect(() => {
    vivo.current = true;
    // Sólo escucha: no pide nada. Si otra pantalla revalidó y cambió la biblioteca, se relee la caché.
    const off = onLibraryChange(() => { const c = cachedLibrary(); if (c) setLib((prev) => (prev === c ? prev : c)); });
    return () => { vivo.current = false; intento.current++; off(); };
  }, []);

  const listo = Array.isArray(lib) && lib.length > 0;
  const idx = useMemo(() => (listo ? indicesRecientes(lib, umbralDe(lib)) : null), [listo, lib]);

  const toggle = useCallback(() => {
    setTocado(true);
    if (pulsado) {                  // encendido o cargando: apaga y cancela cualquier intención en vuelo
      intento.current++;
      setPulsado(false); setCargando(false);
      return;
    }
    const c = cachedLibrary();      // lectura fresca: la lista pudo llegar por el Mix después de montar
    if (Array.isArray(c) && c.length > 0) { setLib(c); setPulsado(true); return; }
    const mio = ++intento.current;
    setPulsado(true); setCargando(true);
    libraryTracks().then((t) => {
      if (!vivo.current || intento.current !== mio) return;
      setCargando(false);
      if (Array.isArray(t) && t.length > 0) setLib(t);
      else setPulsado(false);       // [] = la cuenta cambió a mitad del pedido: nada que filtrar, sin aviso
    }, (err) => {
      if (!vivo.current || intento.current !== mio) return;
      setCargando(false); setPulsado(false);
      const ahora = Date.now();
      if (err?.status !== 401 && ahora - ultimoAviso.current > ERROR_TOAST_MS) {
        ultimoAviso.current = ahora;
        toast(MIX_ERROR_TEXT, { variant: 'warning' });
      }
    });
  }, [pulsado, toast]);

  const precargar = useCallback(() => {
    if (cachedLibrary()) return;
    const ahora = Date.now();
    if (ahora - ultimaPrecarga.current < PRECARGA_MS) return;
    ultimaPrecarga.current = ahora;
    libraryTracks().catch(() => {});
  }, []);

  const apagar = useCallback(() => { intento.current++; setPulsado(false); setCargando(false); }, []);
  return { on: pulsado && listo, pulsado, cargando, idx, toggle, precargar, apagar, tocado };
}
