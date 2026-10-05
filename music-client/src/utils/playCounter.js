// Cuándo CUENTA una escucha. Módulo puro (sin React, sin red): lo usa utils/usePlayLogger.js y
// se prueba solo. Es una réplica EXACTA de la app iOS (sonorarev-ios, lib/player/provider.tsx):
// misma regla, mismas constantes, así una escucha vale lo mismo desde el teléfono que desde la web.
//
//   · Cuenta a la MITAD de la pista o a los 4 minutos, lo que pase primero (regla de Last.fm).
//   · Pistas de menos de 30 s, o sin duración conocida, no cuentan nunca.
//   · Lo escuchado es la SUMA de avances de posición entre ticks, y sólo mientras suena: un avance
//     de 2 s o más es un salto (seek) y no suma; ir hacia atrás tampoco. Arrastrar al final y
//     escuchar 20 s no puede contar como una pista completa.
//   · Una vez por PASADA. Pasada nueva = la pista vuelve a arrancar desde el reproductor (cambio
//     de pista, "repetir una", "repetir todo"): cada vuelta cuenta. Volver a 0 con "anterior"
//     (más de 3 s) es un seek, no una pasada nueva, igual que en iOS.
//
// En la web la pasada nueva se reconoce desde afuera de PlayerContext: cambia el `_qid` de la
// pista actual, o el mismo `_qid` vuelve a empezar (playIndex pone la duración en 0 hasta que el
// <audio> lee la nueva).

export const PLAY_FRACTION = 0.5;
export const PLAY_CAP_S = 240;
export const MIN_TRACK_S = 30;
export const SEEK_JUMP_S = 2;

function newPass(qid, owner) {
  return { qid, owner, heardMs: 0, lastPos: null, lastDur: 0, counted: false };
}

// Una observación del reproductor. Devuelve { pass, msPlayed }: msPlayed es un número SÓLO en la
// observación en la que la escucha cruza el umbral (una vez por pasada); si no, null.
export function observe(pass, { qid, owner, pos, duration, playing }) {
  const dur = Number.isFinite(duration) ? duration : 0;
  let p = pass;
  if (!p || p.qid !== qid || p.owner !== owner || (p.lastDur > 0 && dur === 0)) {
    p = newPass(qid, owner);
  } else {
    p = { ...p };
  }

  if (p.lastPos != null && playing) {
    const dt = pos - p.lastPos;
    if (dt > 0 && dt < SEEK_JUMP_S) p.heardMs += dt * 1000;
  }
  p.lastPos = pos;
  p.lastDur = dur;

  let msPlayed = null;
  if (!p.counted && dur >= MIN_TRACK_S) {
    const threshold = Math.min(dur * PLAY_FRACTION, PLAY_CAP_S) * 1000;
    if (p.heardMs >= threshold) {
      p.counted = true;
      msPlayed = Math.round(p.heardMs);
    }
  }
  return { pass: p, msPlayed };
}
