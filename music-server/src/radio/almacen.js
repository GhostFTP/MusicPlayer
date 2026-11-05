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
// 'no-existe' | 'no-es-tuya' | 'terminada' | 'frecuencia' | 'demasiadas' | 'llena', y desde 1.43.0
// (moderadores) 'sin-permiso' | 'es-el-anfitrion' | 'no-escucha' | 'sin-soporte' | 'moderadores-llenos'.
// 'no-es-tuya' queda SOLO para publicar: la web y la app de iOS abandonan la radio ante ese motivo,
// así que nada de la moderación lo devuelve (por eso existe 'sin-permiso'). Las órdenes suman
// 'obsoleta' | 'ordenes-llenas'.
//
// MODERADORES (1.43.0): el anfitrión nombra a quien está escuchando. El rol dura hasta que el
// anfitrión lo quite o la radio termine: NO caduca por dejar de escuchar (leer() limpia los
// oyentes, nunca los moderadores). Para ORDENAR, en cambio, tiene que estar escuchando.
//
// ÓRDENES (1.43.0, control remoto): un moderador ordena, el reproductor del anfitrión ejecuta y
// confirma en su próxima publicación (`ordenHasta`, `aplicadas`). Cada orden aplicada queda como
// EVENTO ("Sonia pasó a la siguiente"), igual que nombrar o quitar un moderador.
//
// TODO LO NUEVO ES A PEDIDO: leer() solo devuelve moderadores, capacidades, eventos y órdenes a
// quien los pide (`capacidades.moderar` o `desde`), y publicar() solo devuelve órdenes con una
// confirmación. Sin pedirlo, las dos devuelven exactamente lo de 1.42.0.
import { randomInt } from 'node:crypto';
import { REGLAS, contar, nuevoCodigo, tituloPublico, vidaDe } from './reglas.js';

/** Lo que declara un cliente: el anfitrión, si ejecuta órdenes; un oyente, si sabe moderar. Solo
 *  cuenta un `true` de verdad (un "true" en texto o un 1 no). Sin nada, la app de iOS de hoy. */
const capacidadesDe = (c) => ({ ordenes: c?.ordenes === true, moderar: c?.moderar === true });

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
    r.moderadores.clear();
    r.soporte.clear();
    r.ordenes = [];
    r.idsCliente.clear();
    r.cubetasOrden.clear();
    r.eventos = [];
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
        else olvidarViejas(r, t);
      }
      if (!abierta(r) && t - r.terminadaEn >= reglas.ENDED_VISIBLE_MS) radios.delete(codigo);
    }
    for (const [id, c] of creaciones) if (c.hasta <= t) creaciones.delete(id);
  }

  /** Las órdenes sin confirmar y los idCliente de más de ORDEN_TTL_MS se olvidan. */
  function olvidarViejas(r, t) {
    r.ordenes = r.ordenes.filter((o) => t - o.en < reglas.ORDEN_TTL_MS);
    for (const [k, v] of r.idsCliente) if (t - v.en >= reglas.ORDEN_TTL_MS) r.idsCliente.delete(k);
  }

  /** Un evento para mostrar. Se guardan los últimos MAX_EVENTOS; el id no se reusa nunca. */
  function anotar(r, t, e) {
    r.eventos.push({
      id: ++r.seqEventos, tipo: e.tipo, por: e.por, porNombre: e.porNombre ?? null,
      sobre: e.sobre ?? null, sobreNombre: e.sobreNombre ?? null, trackId: e.trackId ?? null, titulo: e.titulo ?? null, en: t,
    });
    if (r.eventos.length > reglas.MAX_EVENTOS) r.eventos.shift();
  }

  /** Una orden como la ve el anfitrión (sin el idCliente de nadie). */
  const paraElAnfitrion = (o) => ({ id: o.id, tipo: o.tipo, trackId: o.trackId, seqBase: o.seqBase, trackBase: o.trackBase, por: o.por, titulo: o.titulo });

  const cuantasAbiertas = () => {
    let n = 0;
    for (const r of radios.values()) if (abierta(r)) n++;
    return n;
  };

  /** Una radio nueva de `anfitrion`. Si ya tenía una abierta, esa termina (y con ella sus
   *  moderadores: la nueva empieza sin ninguno). `capacidades.ordenes`: el anfitrión ejecuta órdenes.
   *  `nombre`: su nombre público, que pone la ruta, para los eventos. */
  function crear(anfitrion, { capacidades, nombre = null } = {}) {
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
      capacidades: { ordenes: capacidadesDe(capacidades).ordenes },
      moderadores: new Map(),  // id de usuario → nombre público (lo pasa la ruta al otorgar)
      soporte: new Map(),      // id de oyente → ¿su cliente sabe moderar? (lo último que declaró)
      nombreAnfitrion: nombre,
      seqPista: 0,             // el seq de la publicación en que empezó la pista actual
      ordenes: [],             // sin confirmar: { id, tipo, trackId, seqBase, trackBase, por, titulo, en }
      seqOrdenes: 0,
      idsCliente: new Map(),   // "quién:idCliente" → { id, en }: ORDEN_TTL_MS, aunque ya se haya confirmado
      cubetasOrden: new Map(), // id de moderador → cubeta de frecuencia
      eventos: [],
      seqEventos: 0,
      terminadaEn: null,
      motivo: null,
    });
    deQuien.set(anfitrion, codigo);
    return { ok: true, codigo, serverNow: t };
  }

  /**
   * El anfitrión publica su estado. `estado` ya viene validado y acotado por la ruta:
   * `{ trackId, positionMs, playing, nextTrackId, enPausaPorVideo }`. Sirve de latido.
   * `confirmacion` (1.43.0, la de leerPublicacion): sin ella, la respuesta es la de siempre; con
   * ella, se confirman las órdenes y vuelven las que siguen pendientes.
   */
  function publicar(codigo, quien, estado, confirmacion) {
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
    if (!r.estado || r.estado.trackId !== estado.trackId) r.seqPista = r.seq;
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
    if (confirmacion == null) return { ok: true, serverNow: t, estado: r.estado };

    // Todo hasta `ordenHasta` sale de la lista; de eso, lo que el anfitrión APLICÓ queda como
    // evento. Lo que descartó (ya sonaba otra canción) no deja rastro.
    const hasta = Math.min(confirmacion.ordenHasta ?? 0, r.seqOrdenes);
    const aplicadas = new Set(confirmacion.aplicadas ?? []);
    const quedan = [];
    for (const o of r.ordenes) {
      if (o.id > hasta) { quedan.push(o); continue; }
      if (aplicadas.has(o.id)) anotar(r, t, { tipo: o.tipo, por: o.por, porNombre: r.moderadores.get(o.por) ?? null, trackId: o.trackId, titulo: o.titulo });
    }
    r.ordenes = quedan;
    return { ok: true, serverNow: t, estado: r.estado, ordenes: r.ordenes.map(paraElAnfitrion) };
  }

  /** Lo de la moderación, solo para quien lo pide. `desde`: el último evento que ya vio. */
  function extras(r, quien, desde) {
    const hasta = r.seqEventos;
    let eventos = [];
    let perdidos = false;
    // Sin cursor (recién entra) o con uno que no es de esta radio (mayor que el último): nada
    // viejo, solo dónde va la cuenta.
    if (abierta(r) && Number.isSafeInteger(desde) && desde >= 0 && desde <= hasta) {
      eventos = r.eventos.filter((e) => e.id > desde);
      perdidos = desde < (r.eventos[0]?.id ?? hasta + 1) - 1;
    }
    return {
      moderadores: [...r.moderadores.keys()],   // con el rol, estén o no escuchando ahora
      capacidades: { ...r.capacidades },
      eventos,
      eventosHasta: hasta,
      eventosPerdidos: perdidos,
      ...(quien === r.anfitrion ? { ordenes: r.ordenes.map(paraElAnfitrion) } : {}),
    };
  }

  /**
   * Lo que ve quien pregunta. Si no es el anfitrión, queda anotado como oyente por un rato.
   * Devuelve ids (anfitrión y oyentes): nombres y avatares los pone la ruta, desde la base.
   */
  function leer(codigo, quien, { capacidades, desde } = {}) {
    expirar();
    const r = radios.get(codigo);
    if (!r) return { ok: false, motivo: 'no-existe' };
    const t = ahora();

    // `expirar` ya cerró lo vencido, pero con su propia lectura del reloj: si entre las dos
    // se cruzó un límite, se cierra acá.
    let status = abierta(r) ? vidaDe(r, t, reglas) : 'ended';
    if (typeof status === 'object') { cerrar(r, status.cerrar, t); status = 'ended'; }

    // A pedido: `?cap=mod` (capacidades.moderar) o `?desde=`. Sin eso, lo de 1.42.0.
    const pide = capacidadesDe(capacidades).moderar || desde !== undefined;

    if (status === 'ended') {
      const base = { ok: true, serverNow: t, codigo, status, motivo: r.motivo, estado: r.estado, anfitrion: r.anfitrion, oyentes: [] };
      return pide ? { ...base, ...extras(r, quien, desde) } : base;
    }

    for (const [id, visto] of r.oyentes) if (t - visto >= reglas.OYENTE_MS) r.oyentes.delete(id);
    if (quien !== r.anfitrion) {
      if (!r.oyentes.has(quien) && r.oyentes.size >= reglas.MAX_OYENTES) return { ok: false, motivo: 'llena' };
      r.oyentes.set(quien, t);
      r.soporte.set(quien, capacidadesDe(capacidades).moderar);
    }

    const base = {
      ok: true,
      serverNow: t,
      codigo,
      status,                         // "live" o "stale"
      motivo: null,
      estado: r.estado,
      anfitrion: r.anfitrion,
      oyentes: [...r.oyentes.keys()],
    };
    return pide ? { ...base, ...extras(r, quien, desde) } : base;
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

  /** La radio abierta de `codigo` para que su ANFITRIÓN la modere, o el motivo por el que no. */
  function paraModerar(codigo, quien) {
    const r = radios.get(codigo);
    if (!r) return { error: { ok: false, motivo: 'no-existe' } };
    if (!abierta(r)) return { error: { ok: false, motivo: 'terminada', razon: r.motivo } };
    if (r.anfitrion !== quien) return { error: { ok: false, motivo: 'sin-permiso' } };
    return { r };
  }

  /**
   * El anfitrión nombra moderador a `objetivo`, que tiene que estar escuchando (un GET en los
   * últimos OYENTE_MS) desde un cliente que sabe moderar. `nombre` es su nombre público, que pone
   * la ruta (el almacén no lee la base): se guarda con el rol y se devuelve, para el evento.
   * Nombrar a quien ya es moderador no es un error (no cambia nada, aunque ya no esté escuchando).
   */
  function otorgar(codigo, quien, objetivo, { nombre = null } = {}) {
    expirar();
    const { r, error } = paraModerar(codigo, quien);
    if (error) return error;
    const t = ahora();
    if (objetivo === r.anfitrion) return { ok: false, motivo: 'es-el-anfitrion' };
    const lista = () => [...r.moderadores.keys()];
    if (r.moderadores.has(objetivo)) return { ok: true, serverNow: t, moderadores: lista(), nombre: r.moderadores.get(objetivo) };
    const visto = r.oyentes.get(objetivo);
    if (visto == null || t - visto >= reglas.OYENTE_MS) return { ok: false, motivo: 'no-escucha' };
    if (r.soporte.get(objetivo) !== true) return { ok: false, motivo: 'sin-soporte' };
    if (r.moderadores.size >= reglas.MAX_MODERADORES) return { ok: false, motivo: 'moderadores-llenos' };
    r.moderadores.set(objetivo, nombre);
    anotar(r, t, { tipo: 'moderador', por: quien, porNombre: r.nombreAnfitrion, sobre: objetivo, sobreNombre: nombre });
    return { ok: true, serverNow: t, moderadores: lista(), nombre };
  }

  /** El anfitrión le quita el rol a `objetivo` (esté o no escuchando). Quitárselo a quien no lo
   *  tiene no es un error: `nombre` vuelve en null. Sus órdenes sin confirmar se BORRAN: una orden
   *  en camino de alguien que ya no es moderador no se entrega nunca. */
  function quitar(codigo, quien, objetivo) {
    expirar();
    const { r, error } = paraModerar(codigo, quien);
    if (error) return error;
    const t = ahora();
    const tenia = r.moderadores.has(objetivo);
    const nombre = tenia ? r.moderadores.get(objetivo) : null;
    if (tenia) {
      r.moderadores.delete(objetivo);
      r.ordenes = r.ordenes.filter((o) => o.por !== objetivo);
      anotar(r, t, { tipo: 'sin-moderador', por: quien, porNombre: r.nombreAnfitrion, sobre: objetivo, sobreNombre: nombre });
    }
    return { ok: true, serverNow: t, moderadores: [...r.moderadores.keys()], nombre };
  }

  /**
   * Un moderador manda una orden, ya leída por leerOrden. `titulo` (el de la canción, para el
   * evento) lo pone la ruta, y se limpia acá. → `{ ok, serverNow, id, repetida }`.
   * Un reintento (mismo moderador, mismo idCliente) devuelve la MISMA orden con repetida: true,
   * aunque ya se haya confirmado y borrado: el par se recuerda ORDEN_TTL_MS.
   */
  function ordenar(codigo, quien, orden, { titulo = null } = {}) {
    expirar();
    const r = radios.get(codigo);
    if (!r) return { ok: false, motivo: 'no-existe' };
    if (!abierta(r)) return { ok: false, motivo: 'terminada', razon: r.motivo };
    if (!r.moderadores.has(quien)) return { ok: false, motivo: 'sin-permiso' };
    const t = ahora();
    const clave = `${quien}:${orden.idCliente}`;
    const ya = r.idsCliente.get(clave);
    if (ya) return { ok: true, serverNow: t, id: ya.id, repetida: true };
    const visto = r.oyentes.get(quien);
    if (visto == null || t - visto >= reglas.OYENTE_MS) return { ok: false, motivo: 'no-escucha' };
    if (!r.capacidades.ordenes) return { ok: false, motivo: 'sin-soporte' };
    // "siguiente" salta LA canción que veía quien ordena (ver TIPOS_ORDEN en reglas.js).
    if (orden.tipo === 'siguiente' && (!r.estado || orden.seqBase < r.seqPista || orden.seqBase > r.seq)) {
      return { ok: false, motivo: 'obsoleta' };
    }
    const c = contar(r.cubetasOrden.get(quien), t, reglas.MAX_ORDENES_PERSONA, reglas.VENTANA_ORDENES_MS);
    r.cubetasOrden.set(quien, c.cubeta);
    if (!c.pasa) return { ok: false, motivo: 'frecuencia', esperaMs: c.esperaMs };
    if (r.ordenes.length >= reglas.MAX_ORDENES) return { ok: false, motivo: 'ordenes-llenas' };
    const id = ++r.seqOrdenes;
    r.ordenes.push({
      id, tipo: orden.tipo, trackId: orden.trackId, seqBase: orden.seqBase,
      trackBase: r.estado?.trackId ?? null, por: quien,
      titulo: orden.trackId != null ? tituloPublico(titulo, reglas) || null : null, en: t,
    });
    r.idsCliente.set(clave, { id, en: t });
    return { ok: true, serverNow: t, id, repetida: false };
  }

  return { crear, publicar, leer, terminar, expirar, otorgar, quitar, ordenar, cuantas: () => radios.size };
}

/** El almacén del servidor: uno solo por proceso. */
export const radios = crearAlmacen();
