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

  // Al entrar (o cambiar de cuenta) y cada vez que vuelve la red: descartar lo ajeno y mandar lo
  // pendiente. Sin toasts: si falla, queda guardado.
  useEffect(() => {
    if (!owner) return undefined;
    discardForeign(owner);
    flushPending(owner);
    const onOnline = () => flushPending(owner);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [owner]);

  const qid = currentTrack?._qid;
  const trackId = currentTrack?.id;
  useEffect(() => {
    if (qid == null || trackId == null || !owner) return;
    const r = observe(pass, { qid, owner, pos: currentTime, duration, playing: isPlaying });
    pass = r.pass;
    if (r.msPlayed == null) return;
    recordPlay(owner, { client_id: newClientId(), track_id: trackId, played_at: Date.now(), ms_played: r.msPlayed });
    if (navigator.onLine !== false) flushPending(owner);
  }, [qid, trackId, owner, currentTime, duration, isPlaying]);
}

export function PlayLogger() {
  usePlayLogger();
  return null;
}
