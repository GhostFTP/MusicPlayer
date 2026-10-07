import { useEffect } from 'react';
import { usePlayer, usePlayerTime } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { observe } from './playCounter.js';
import { currentOwner, newClientId, recordPlay, flushPending, discardForeign } from './playsOutbox.js';

// Registro de escuchas (POST /api/plays), con la misma regla que la app iOS (utils/playCounter.js)
// y su misma bandeja de salida (utils/playsOutbox.js). NO toca PlayerContext: sólo LEE lo que ya
// expone (pista actual con su `_qid`, isPlaying, y el tiempo de usePlayerTime).
//
// Se monta como <PlayLogger /> dentro de Layout (sólo existe con sesión) y no como un hook suelto
// en el cuerpo de Layout: usePlayerTime cambia ~4 veces por segundo y re-renderizaría el Layout
// entero. Así lo único que se re-renderiza es este componente, que no pinta nada.
//
// La pasada en curso vive a nivel de MÓDULO, no en un ref: Layout se desmonta durante un reauth
// mientras la música sigue (el <audio> vive más arriba). Al volver, la misma pasada sigue donde
// estaba: una pista ya contada no vuelve a contar, y el tiempo que no se vio no suma (el primer
// avance tras el hueco es un salto).
let pass = null;

export function usePlayLogger() {
  const { currentTrack, isPlaying } = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const { token } = useAuth();
  const owner = token ? currentOwner() : null;

  // Al entrar (o cambiar de cuenta): descartar lo ajeno YA, y mandar lo pendiente cuando el
  // navegador esté libre (requestIdleCallback, a más tardar ~3 s; setTimeout donde no existe), para
  // no competir con la primera carga de la vista. Cada vez que vuelve la red: mandar ya. Sin toasts:
  // si falla, queda guardado.
  useEffect(() => {
    if (!owner) return undefined;
    discardForeign(owner);
    const flush = () => flushPending(owner);
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(flush, { timeout: 3000 }) : window.setTimeout(flush, 3000);
    window.addEventListener('online', flush);
    return () => {
      if (idle) window.cancelIdleCallback(handle); else window.clearTimeout(handle);
      window.removeEventListener('online', flush);
    };
  }, [owner]);

  const qid = currentTrack?._qid;
  const trackId = currentTrack?.id;
  // Los videos no son escuchas: no van a /api/plays (ni a recientes ni al Resumen del año).
  const isVideo = currentTrack?.kind === 'video';
  useEffect(() => {
    if (isVideo || qid == null || trackId == null || !owner) return;
    const r = observe(pass, { qid, owner, pos: currentTime, duration, playing: isPlaying });
    pass = r.pass;
    if (r.msPlayed == null) return;
    recordPlay(owner, { client_id: newClientId(), track_id: trackId, played_at: Date.now(), ms_played: r.msPlayed });
    if (navigator.onLine !== false) flushPending(owner);
  }, [isVideo, qid, trackId, owner, currentTime, duration, isPlaying]);
}

export function PlayLogger() {
  usePlayLogger();
  return null;
}
