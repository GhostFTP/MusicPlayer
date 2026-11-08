// radio-oyente-sondeo-func.mjs — el SONDEO del oyente de la radio web cuando algo falla DURANTE la sala, contra el
// BUILD DE PRODUCCIÓN (preview :4173) y el backend REAL del runner (:3100, copia de la base), con la sala de un
// SERVIDOR FALSO (page.route sobre /api/radio/FK… y /api/tracks/:id). Salió de radio-oyente-func (sus cinco bloques D,
// tal cual) para que ninguna suite se acerque al tope de 5 min del runner. El montaje es el de radio-oyente-comun.mjs.
//
// Casos:
//   D_*  durante: 410, ended y 409 (llena) salen con su texto de fin y la foto restaurada; 403
//        persistente: aviso sin-respuesta, no sale y sigue sonando; 429 con Retry-After: 6: el hueco
//        entre lecturas es ≥ 6 s y después vuelve a 2 s; red caída (route.abort): aviso, sigue sonando y
//        al volver la red se apaga; /api/tracks 404 y 500: falta-cancion / no-se-pudo-cargar, en pausa,
//        reintento en cada sondeo y, cuando responde bien, arranca.
//
// CONTROL NEGATIVO: con el sondeo fijo en 2 s (sin esperaDelSondeo), falla D_429; con el 403 tratado como salida,
// falla D_403; sin devolver `seguido` cuando falla api.track, fallan los dos D_track; con un aviso de red que no se
// apaga, falla D_red.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-oyente-sondeo-func.mjs
// SONDEO_DUMP=<archivo>: deja ahí los resultados con sus valores.
import {
  R, ok, REG, sleep, TOLERANCIA_S, SONDEO_MS, DESAJUSTE_MS, TXT_FIN, tokHost, login2, tokOye, idOye, api, lista,
  todas, largas, A, B, C, D, PROPIAS, wav, WAV, chromium, browser, ctx, p, errores, lecturas, esperar, foto, r2,
  mismo, salaComoHost, pub, publicar, proyectada, medir, sondeoPendiente, abrirSala, prepararFoto, restaurada,
  ALFA, FK, nFk, seqFk, HOST_FK, YO_FK, salaFalsa, estadoFk, vivoFk, json, esFk, rutaFk, idOrdenFk, esOrdenFk,
  rutaOrdenFk, TRK, pedidosTrk, PNG, AVATAR_ROTO, pedidosAvatar, sinToken, irA, escuchar, vista, sonandoEn,
  medirFk, entrarFk, salirFk, TXT_SIN_RESPUESTA, TXT_BLOQUEADO, TXT_SILENCIADA, sinSesion, volverAEntrar, salas,
  BASE
} from './radio-oyente-comun.mjs';

try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.() && !!window.__auth?.());
  const sondeoAntes = await sondeoPendiente();

  // ── D. durante: 410, ended y llena salen con su texto de fin y la foto restaurada ──
  for (const [k, modo, razon, texto] of [
    ['410', { status: 410, body: { error: 'Radio ended', endedReason: 'admin' } }, null, 'Un administrador terminó la radio.'],
    ['ended', 'ended', 'pausa', 'La radio se cerró por estar mucho tiempo en pausa.'],
    ['409_llena', { status: 409, body: { error: 'Radio full' } }, null, 'La radio está llena.'],
  ]) {
    const e = await entrarFk();
    if (razon) FK[e.code].razon = razon;
    FK[e.code].modo = modo;
    const fuera = await esperar(async () => ((await foto()).fase === 'sin-radio' ? true : null), 6000);
    await sleep(1200);
    const m = await foto(); const v = await vista();
    ok(`D_${k}_durante_sale_y_restaura`, e.sono && !!fuera.v && m.fin === texto && v.estado === texto && restaurada(m, e.antes),
      { sono: e.sono, ms: fuera.ms, fin: m.fin, estado: v.estado, cola: m.cola, indice: m.indice, ct: m.ct, paused: m.paused, nPlay: m.nPlay, repeat: m.repeat });
  }

  // ── D. 403 persistente: aviso sin-respuesta, no sale, lo que suena sigue sonando ──
  {
    const e = await entrarFk();
    const ct0 = (await foto()).ct; const t0 = Date.now();
    FK[e.code].modo = { status: 403, body: { error: 'Forbidden' } };
    const av = await esperar(async () => ((await foto()).aviso === 'sin-respuesta' ? true : null), 5000);
    const vAv = await vista();
    await sleep(7000);
    const m = await foto();
    const n403 = FK[e.code].lecturas.filter((t) => t > t0).length;
    ok('D_403_persistente_avisa_y_sigue_sonando', e.sono && !!av.v && vAv.avisoVivo === TXT_SIN_RESPUESTA && m.fase === 'oyente' && m.aviso === 'sin-respuesta'
      && m.actual === A.id && m.isPlaying && !m.paused && m.ct - ct0 > 7 && n403 >= 4,
      { avisoEnMs: av.ms, avisoVivo: vAv.avisoVivo, fase: m.fase, aviso: m.aviso, paused: m.paused, avanzoS: r2(m.ct - ct0), lecturas403: n403 });
    await salirFk();
  }

  // ── D. 429 con Retry-After: 6 → el hueco es ≥ 6 s y después vuelve a 2 s ──
  {
    const e = await entrarFk();
    await sleep(2500);
    let n = 0; const t0 = Date.now();
    FK[e.code].modo = () => (n++ === 0 ? { status: 429, headers: { 'Retry-After': '6' }, body: { error: 'Too many requests' } } : 'ok');
    await sleep(12_500);
    const ls = FK[e.code].lecturas.filter((t) => t >= t0);
    const huecos = ls.slice(1).map((t, i) => t - ls[i]);
    const m = await foto();
    ok('D_429_respeta_retry_after_y_vuelve_a_2s', e.sono && huecos.length >= 3 && huecos[0] >= 6000 && huecos[0] < 7500
      && huecos.slice(1, 3).every((h) => h >= SONDEO_MS - 300 && h <= SONDEO_MS + 700) && m.fase === 'oyente' && !m.paused,
      { huecosMs: huecos, fase: m.fase, paused: m.paused });
    await salirFk();
  }

  // ── D. red caída: aviso, sigue sonando; al volver la red el aviso se apaga ──
  {
    const e = await entrarFk();
    const ct0 = (await foto()).ct;
    FK[e.code].modo = 'abort';
    const av = await esperar(async () => ((await foto()).aviso === 'sin-respuesta' ? true : null), 5000);
    const vAv = await vista();
    await sleep(4000);
    const mCaida = await foto();
    FK[e.code].modo = 'ok';
    const off = await esperar(async () => ((await foto()).aviso === null ? true : null), 5000);
    await sleep(200);
    const vOff = await vista();
    ok('D_red_caida_avisa_sigue_sonando_y_se_apaga', e.sono && !!av.v && vAv.avisoVivo === TXT_SIN_RESPUESTA && mCaida.fase === 'oyente'
      && mCaida.aviso === 'sin-respuesta' && !mCaida.paused && mCaida.ct - ct0 > 4 && !!off.v && vOff.avisoVivo === '',
      { avisoEnMs: av.ms, avisoVivo: vAv.avisoVivo, caida: { fase: mCaida.fase, paused: mCaida.paused, avanzoS: r2(mCaida.ct - ct0) }, apagadoEnMs: off.ms, avisoVivoDespues: vOff.avisoVivo });
    await salirFk();
  }

  // ── D. /api/tracks 404 y 500: aviso, en pausa, reintento en cada sondeo y, al responder, arranca ──
  // (y V: esos avisos entran en la región viva, el mismo nodo de la entrada)
  {
    const e = await entrarFk();
    const region = async () => { const v = await vista(); return { ...v.region, texto: v.avisoVivo }; };
    const R0 = await region();
    const caso = async (t, siguiente, status, aviso) => {
      const p0 = pedidosTrk[t.id] ?? 0;
      TRK[t.id] = { fallos: 3, status };
      estadoFk(e.code, { trackId: t.id, positionMs: 20_000, playing: true, nextTrackId: siguiente.id });
      const falla = await esperar(async () => { const f = await foto(); return f.aviso === aviso && f.paused ? f : null; }, 5000);
      const Rf = await region();
      const arranca = await sonandoEn(t.id, 12_000);
      await sleep(600);
      const m = await medirFk(e.code);
      return { falla: !!falla.v, Rf, arrancaEnMs: arranca.ms, pedidos: (pedidosTrk[t.id] ?? 0) - p0, pendientes: TRK[t.id].fallos,
        m: { actual: m.actual, cola: m.cola, aviso: m.aviso, paused: m.paused, desfase: m.desfase }, okArranca: !!arranca.v && mismo(m.cola, [t.id, siguiente.id]) && m.aviso === null && Math.abs(m.desfase) < TOLERANCIA_S };
    };
    const c404 = await caso(B, C, 404, 'falta-cancion');
    ok('D_track_404_falta_cancion_pausa_y_reintenta', e.sono && c404.falla && c404.pedidos >= 4 && c404.pendientes === 0 && c404.okArranca, c404);
    const c500 = await caso(C, A, 500, 'no-se-pudo-cargar');
    ok('D_track_500_no_se_pudo_cargar_pausa_y_reintenta', e.sono && c500.falla && c500.pedidos >= 4 && c500.pendientes === 0 && c500.okArranca, c500);
    const R1 = await region();
    const enRegion = (r, texto) => r.mismo === true && r.role === 'status' && r.live === 'polite' && r.texto === texto;
    ok('V_avisos_entran_en_la_region_viva', enRegion(R0, '') && enRegion(c404.Rf, 'No se encontró la canción que suena en la radio. Reintentando…')
      && enRegion(c500.Rf, 'No se pudo cargar la canción. Reintentando…') && enRegion(R1, ''),
      { alEntrar: R0, falta: c404.Rf, noSePudo: c500.Rf, alFinal: R1 });
    await salirFk();
  }

} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.SONDEO_DUMP) (await import('node:fs')).writeFileSync(process.env.SONDEO_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-oyente-sondeo-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
