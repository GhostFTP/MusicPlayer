// EL ALMACÉN DE RADIOS (1.29.0): todas las radios abiertas, EN MEMORIA, detrás de cinco
// funciones —crear, publicar, leer, terminar, expirar—. No sabe de HTTP ni de la base: recibe
// ids y datos ya validados y devuelve objetos planos. Así el transporte (hoy, peticiones
// cortas; mañana quizá SSE) se cambia en api/radio.js sin tocar esto.
//
// ⚠️ UN REINICIO O UN REDEPLOY BORRA TODAS LAS RADIOS. Es a propósito: no hay tabla. El
// anfitrión recibe un 404 en su siguiente publicación y tiene que crear otra.
//
// El reloj y el azar entran por parámetro (`crearAlmacen({ ahora, azar })`), para probarlo
// sin esperar minutos (`npm run test:radio`). Nunca se usa un reloj del cliente.
//
// Las respuestas: `{ ok: true, ... }` o `{ ok: false, motivo }`, con motivo en
// 'no-existe' | 'no-es-tuya' | 'terminada' | 'frecuencia' | 'demasiadas' | 'llena'.
import { randomInt } from 'node:crypto';
import { REGLAS, contar, nuevoCodigo, vidaDe } from './reglas.js';

export function crearAlmacen({ ahora = Date.now, azar = randomInt, reglas = REGLAS } = {}) {
  /** código → radio */
  const radios = new Map();
  /** id de usuario → código de SU radio abierta */
  const deQuien = new Map();
  /** id de usuario → cubeta de creaciones */
  const creaciones = new Map();

  const abierta = (r) => r.terminadaEn == null;

  function cerrar(r, motivo, t) {
    if (!abierta(r)) return;
    r.terminadaEn = t;
    r.motivo = motivo;
    r.oyentes.clear();
    if (deQuien.get(r.anfitrion) === r.codigo) deQuien.delete(r.anfitrion);
  }

  /** Cierra lo que venció y borra lo que ya nadie tiene que ver. Corre al principio de cada
   *  operación (y cada tanto desde la ruta, para que la memoria no dependa del tráfico). */
  function expirar() {
    const t = ahora();
    for (const [codigo, r] of radios) {
      if (abierta(r)) {
        const v = vidaDe(r, t, reglas);
        if (typeof v === 'object') cerrar(r, v.cerrar, t);
      }
      if (!abierta(r) && t - r.terminadaEn >= reglas.ENDED_VISIBLE_MS) radios.delete(codigo);
    }
    for (const [id, c] of creaciones) if (c.hasta <= t) creaciones.delete(id);
  }

  const cuantasAbiertas = () => {
    let n = 0;
    for (const r of radios.values()) if (abierta(r)) n++;
    return n;
  };

  /** Una radio nueva de `anfitrion`. Si ya tenía una abierta, esa termina. */
  function crear(anfitrion) {
    expirar();
    const t = ahora();

    const c = contar(creaciones.get(anfitrion), t, reglas.MAX_CREACIONES, reglas.VENTANA_CREACIONES_MS);
    creaciones.set(anfitrion, c.cubeta);
    if (!c.pasa) return { ok: false, motivo: 'frecuencia', esperaMs: c.esperaMs };

    const anterior = radios.get(deQuien.get(anfitrion));
    // El tope se mira SIN contar la que esta misma persona está por reemplazar.
    if (cuantasAbiertas() - (anterior ? 1 : 0) >= reglas.MAX_RADIOS) return { ok: false, motivo: 'demasiadas' };
    if (anterior) cerrar(anterior, 'reemplazada', t);

    let codigo;
    do { codigo = nuevoCodigo(azar); } while (radios.has(codigo));

    radios.set(codigo, {
      codigo,
      anfitrion,
      creadaEn: t,
      ultimaDelAnfitrion: t,
      enPausaDesde: null,
      seq: 0,
      estado: null,
      oyentes: new Map(),      // id de usuario → último GET
      publicaciones: null,     // cubeta de frecuencia
      terminadaEn: null,
      motivo: null,
    });
    deQuien.set(anfitrion, codigo);
    return { ok: true, codigo, serverNow: t };
  }

  /**
   * El anfitrión publica su estado. `estado` ya viene validado y acotado por la ruta:
   * `{ trackId, positionMs, playing, nextTrackId, enPausaPorVideo }`. Sirve de latido.
   */
  function publicar(codigo, quien, estado) {
    expirar();
    const r = radios.get(codigo);
    if (!r) return { ok: false, motivo: 'no-existe' };
    if (r.anfitrion !== quien) return { ok: false, motivo: 'no-es-tuya' };
    if (!abierta(r)) return { ok: false, motivo: 'terminada', razon: r.motivo };

    const t = ahora();
    const c = contar(r.publicaciones, t, reglas.MAX_PUBLICACIONES, reglas.VENTANA_PUBLICACIONES_MS);
    r.publicaciones = c.cubeta;
    if (!c.pasa) return { ok: false, motivo: 'frecuencia', esperaMs: c.esperaMs };

    r.seq += 1;
    r.ultimaDelAnfitrion = t;
    // La pausa se cuenta desde que EMPEZÓ: un latido en pausa no la reinicia.
    if (estado.playing) r.enPausaDesde = null;
    else if (r.enPausaDesde == null) r.enPausaDesde = t;
    r.estado = {
      seq: r.seq,
      trackId: estado.trackId,
      positionMs: estado.positionMs,
      playing: estado.playing,
      nextTrackId: estado.nextTrackId,
      enPausaPorVideo: estado.enPausaPorVideo,
      publishedAtServerMs: t,
    };
    return { ok: true, serverNow: t, estado: r.estado };
  }

  /**
   * Lo que ve quien pregunta. Si no es el anfitrión, queda anotado como oyente por un rato.
   * Devuelve ids (anfitrión y oyentes): nombres y avatares los pone la ruta, desde la base.
   */
  function leer(codigo, quien) {
    expirar();
    const r = radios.get(codigo);
    if (!r) return { ok: false, motivo: 'no-existe' };
    const t = ahora();

    // `expirar` ya cerró lo vencido, pero con su propia lectura del reloj: si entre las dos
    // se cruzó un límite, se cierra acá.
    let status = abierta(r) ? vidaDe(r, t, reglas) : 'ended';
    if (typeof status === 'object') { cerrar(r, status.cerrar, t); status = 'ended'; }

    if (status === 'ended') {
      return { ok: true, serverNow: t, codigo, status, motivo: r.motivo, estado: r.estado, anfitrion: r.anfitrion, oyentes: [] };
    }

    for (const [id, visto] of r.oyentes) if (t - visto >= reglas.OYENTE_MS) r.oyentes.delete(id);
    if (quien !== r.anfitrion) {
      if (!r.oyentes.has(quien) && r.oyentes.size >= reglas.MAX_OYENTES) return { ok: false, motivo: 'llena' };
      r.oyentes.set(quien, t);
    }

    return {
      ok: true,
      serverNow: t,
      codigo,
      status,                         // "live" o "stale"
      motivo: null,
      estado: r.estado,
      anfitrion: r.anfitrion,
      oyentes: [...r.oyentes.keys()],
    };
  }

  /** Termina la radio. Solo el anfitrión, o quien la ruta diga que es admin. Terminar una
   *  ya terminada no es un error. */
  function terminar(codigo, quien, { esAdmin = false } = {}) {
    expirar();
    const r = radios.get(codigo);
    if (!r) return { ok: false, motivo: 'no-existe' };
    if (r.anfitrion !== quien && !esAdmin) return { ok: false, motivo: 'no-es-tuya' };
    const t = ahora();
    cerrar(r, r.anfitrion === quien ? 'anfitrion' : 'admin', t);
    return { ok: true, serverNow: t, motivo: r.motivo };
  }

  return { crear, publicar, leer, terminar, expirar, cuantas: () => radios.size };
}

/** El almacén del servidor: uno solo por proceso. */
export const radios = crearAlmacen();
