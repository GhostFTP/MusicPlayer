// plays-unit.mjs — prueba UNITARIA de la regla de escuchas (music-client/src/utils/playCounter.js),
// sin navegador ni servidor: se simulan ticks de reproducción y se compara contra la regla de iOS
// (lib/player/provider.tsx: mitad o 240 s, mínimo 30 s, saltos ≥2 s no suman, una vez por pasada).
// Uso: node plays-unit.mjs
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { observe, PLAY_FRACTION, PLAY_CAP_S, MIN_TRACK_S, SEEK_JUMP_S } =
  await import(pathToFileURL(join(ROOT, 'music-client/src/utils/playCounter.js')).href);

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

// Simulador: reproduce `secs` segundos en ticks de `step` s desde la posición actual.
function sim({ duration, qid = 1, owner = 'id:1' }) {
  let pass = null, pos = 0;
  const counts = [];
  const tick = (o = {}) => {
    const r = observe(pass, { qid: o.qid ?? qid, owner: o.owner ?? owner, pos, duration: o.duration ?? duration, playing: o.playing ?? true });
    pass = r.pass;
    if (r.msPlayed != null) counts.push({ at: pos, ms: r.msPlayed });
  };
  return {
    play(secs, step = 0.25, o) { const n = Math.round(secs / step); for (let i = 0; i < n; i++) { pos += step; tick(o); } },
    seek(to, o) { pos = to; tick(o); },
    pause(secs, step = 0.25) { const n = Math.round(secs / step); for (let i = 0; i < n; i++) tick({ playing: false }); },
    restart(o) { pos = 0; tick({ duration: 0, ...o }); },   // playIndex: currentTime 0 + duration 0
    newTrack(q, d) { pos = 0; qid = q; duration = d; tick(); },
    counts, get pos() { return pos; }, get pass() { return pass; },
  };
}

ok('constantes_iOS', PLAY_FRACTION === 0.5 && PLAY_CAP_S === 240 && MIN_TRACK_S === 30 && SEEK_JUMP_S === 2);

// 1) umbral exacto: 200 s → 100 s. A 99.75 no cuenta, a 100 sí, ms_played = 100000.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(99.75);
  const antes = s.counts.length; s.play(0.25);
  ok('umbral_mitad', antes === 0 && s.counts.length === 1 && s.counts[0].ms === 100000, { antes, counts: s.counts }); }

// 2) tope 240 s: pista de 600 s cuenta a 240 s, no a 300.
{ const s = sim({ duration: 600 }); s.seek(0); s.play(239.75); const antes = s.counts.length; s.play(0.25);
  ok('umbral_tope_240', antes === 0 && s.counts.length === 1 && s.counts[0].ms === 240000, { counts: s.counts }); }

// 3) pista < 30 s no cuenta nunca; de 30 s exactos cuenta a 15 s.
{ const s = sim({ duration: 29.9 }); s.seek(0); s.play(29.75);
  const s2 = sim({ duration: 30 }); s2.seek(0); s2.play(15);
  ok('minimo_30s', s.counts.length === 0 && s2.counts.length === 1, { corta: s.counts.length, de30: s2.counts }); }

// 4) duración desconocida (0 / NaN) no cuenta.
{ const s = sim({ duration: NaN }); s.seek(0); s.play(200);
  ok('sin_duracion', s.counts.length === 0); }

// 5) seek hacia ADELANTE no suma: saltar a 150 de 200 y escuchar 20 s → no cuenta.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(5); s.seek(150); s.play(20);
  ok('seek_adelante_no_suma', s.counts.length === 0, { heard: s.pass.heardMs }); }

// 6) seek hacia ATRÁS tras contar no cuenta doble (misma pasada).
{ const s = sim({ duration: 200 }); s.seek(0); s.play(110); s.seek(0); s.play(110);
  ok('seek_atras_no_doble', s.counts.length === 1, { counts: s.counts }); }

// 7) "anterior" con >3 s (sólo currentTime=0, sin reset de duración) = seek: no recuenta.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(110); s.seek(0); s.play(150);
  ok('anterior_>3s_no_recuenta', s.counts.length === 1); }

// 8) repetir una: playIndex sobre el MISMO _qid (duración→0) → pasada nueva → cuenta otra vez.
{ const s = sim({ duration: 60 }); s.seek(0); s.play(60); s.restart(); s.play(60); s.restart(); s.play(60);
  ok('repeat_one_cuenta_cada_vuelta', s.counts.length === 3, { counts: s.counts }); }

// 9) skip antes del umbral: pista 1 hasta 50 de 200, pasa a otra → nada; la nueva arranca de 0.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(50); s.newTrack(2, 200); s.play(60);
  ok('skip_antes_no_cuenta', s.counts.length === 0 && Math.round(s.pass.heardMs) === 60000, { heard: s.pass.heardMs }); }

// 10) pausa: el tiempo en pausa no suma, y una pausa larga no reinicia lo escuchado.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(60); s.pause(600); s.play(40);
  ok('pausa_no_suma_ni_reinicia', s.counts.length === 1 && s.counts[0].ms === 100000, { counts: s.counts }); }

// 11) cambio de cuenta a mitad de pasada: la nueva cuenta empieza de cero (no hereda lo de la otra).
{ const s = sim({ duration: 200 }); s.seek(0); s.play(80); s.play(30, 0.25, { owner: 'id:2' });
  ok('cambio_de_cuenta_reinicia', s.counts.length === 0, { heard: s.pass.heardMs, owner: s.pass.owner }); }

// 12) mismo _qid con la duración aún desconocida no dispara reset falso (no hay lastDur>0).
{ const s = sim({ duration: 0 }); s.seek(0); s.play(1, 0.25); s.play(110, 0.25, { duration: 200 });
  ok('carga_inicial_sin_reset_falso', s.counts.length === 1, { counts: s.counts }); }

// 13) un tick de 1.99 s suma; uno de 2.0 s no.
{ const s = sim({ duration: 200 }); s.seek(0); s.play(1.99, 1.99); const a = s.pass.heardMs; s.play(2, 2); const b = s.pass.heardMs;
  ok('limite_salto_2s', Math.round(a) === 1990 && b === a, { a, b }); }

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nplays-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
