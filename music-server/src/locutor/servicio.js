// EL SERVICIO DEL LOCUTOR (frente "locutor"): decide qué contesta GET /api/tracks/:id/locutor
// y mueve la generación en segundo plano. Une hechos.js, frase.js y el cliente de Ollama.
//
// SIN BASE Y SIN EXPRESS: la base y el cliente entran por parámetro (crearServicio), así el
// servicio se prueba con dependencias falsas y un reloj inyectado (npm run test:locutor-servicio).
// El cableado real vive en api/locutor.js.
//
// LA REGLA QUE MANDA: la música nunca espera a la IA. consultar() es SÍNCRONO y contesta al
// instante con lo que haya; si no hay frase, la deja encargada y contesta "generando". Quien
// la genera es un único worker (Ollama corre con NUM_PARALLEL=1: dos a la vez solo se
// estorbarían), y el cliente web vuelve a preguntar cuando quiera.
//
// NADA SE LOGUEA. Ni frases, ni mensajes, ni motivos por petición: lo que haga falta saber
// está en estadisticas() (contadores en memoria), que el servidor no imprime.

import { createHash } from 'node:crypto';
import { leerConfig } from '../ia/ollama.js';
import { extraerHechos } from './hechos.js';
import { SYSTEM, construirMensajes, extraerFrase, plantillaEscuchas, puedeGenerar, validarFrase } from './frase.js';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const MARGEN_FRIO_MS = 5 * 60_000; // se considera frío un poco ANTES de que venza el keep_alive
const MIN_FRIO_MS = 60_000;

// Cuánto se recuerda que algo no salió, para no volver a pedírselo al modelo en cada GET.
// Una frase que no VALIDÓ se da por mala un buen rato (tarda en cambiar algo: la pista, el
// prompt o la suerte del muestreo); un fallo de red/timeout se reintenta pronto.
const NEG_VALIDACION_MS = 10 * 60_000;
const NEG_TRANSITORIO_MS = 30_000;

/** Cuántos segundos le sugiere el endpoint al cliente esperar antes de volver a preguntar. */
export const REINTENTAR_S = 10;

// Motivos del cliente en los que NUNCA se llegó a Ollama: no cuestan cupo ni dejan negativa.
const NO_LLEGO = new Set(['apagado', 'circuito-abierto', 'calentando', 'mensajes-invalidos']);

// ---------- configuración ----------

function entero(v, defecto) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : defecto;
}

// '30m' → 1 800 000; '-1' (en memoria para siempre) → Infinity.
function keepAliveMs(ka) {
  if (ka === '-1') return Infinity;
  const m = /^(\d+)([smh])$/.exec(ka);
  return m ? Number(m[1]) * { s: 1000, m: 60_000, h: HORA_MS }[m[2]] : 30 * 60_000;
}

// Nunca lanza: un valor inválido cae al defecto. Todo por variable de entorno.
export function leerConfigServicio(env = process.env) {
  const e = env && typeof env === 'object' ? env : {};
  const ia = leerConfig(e);
  const ka = keepAliveMs(ia.keepAlive);
  return {
    modelo: ia.modelo,
    limiteUsuarioHora: entero(e.LOCUTOR_LIMITE_USUARIO_HORA, 60),
    limiteDia: entero(e.LOCUTOR_LIMITE_DIA, 1500),
    cacheMax: entero(e.LOCUTOR_CACHE_MAX, 2000),
    colaMax: entero(e.LOCUTOR_COLA_MAX, 20),
    // Cuánto sin actividad antes de dar el modelo por descargado de la GPU.
    friaMs: ka === Infinity ? Infinity : Math.max(MIN_FRIO_MS, ka - MARGEN_FRIO_MS),
    // Apagado por defecto: ver calentarAlArrancar().
    calentarAlArrancar: e.LOCUTOR_CALENTAR_AL_ARRANCAR === '1',
  };
}

// Qué cuenta como "los mismos datos" para la caché. Solo lo que VE el modelo, más el modelo y
// el texto del system: cambiar el prompt o el modelo invalida las frases viejas. `pista` y
// `escuchas` no entran: el modelo no las ve, y regenerar por ellas no cambiaría nada.
export function huellaDe(hechos, modelo) {
  const h = hechos ?? {};
  return createHash('sha1')
    .update(JSON.stringify([h.titulo, h.artista, h.album, h.anio, h.genero, modelo, SYSTEM]))
    .digest('hex');
}

// ---------- servicio ----------

export function crearServicio({ cliente, ahora = Date.now, leerTrack, contarEscuchas, config = leerConfigServicio() }) {
  // CACHÉ: una entrada por pista (trackId → { huella, frase, hasta }), compartida entre
  // usuarios porque los hechos no llevan nada de nadie. Las positivas NO expiran por tiempo:
  // solo las saca el LRU o un cambio de huella (retag, prompt o modelo nuevos). Viven en
  // memoria y se pierden en cada deploy; es aceptado (la primera escucha las regenera).
  // Las negativas (frase=null) sí llevan `hasta`.
  const cache = new Map();

  const cola = []; //                 trabajos esperando, el más viejo primero
  const pendientes = new Map(); //    clave → trabajo (en cola o corriendo): el dedupe
  let trabajando = null; //           la promesa del worker mientras hay trabajo

  // Última vez que Ollama contestó bien (generar o calentar). null = no sabemos (recién
  // arrancado) y se trata como frío.
  let ultimaActividad = null;

  // CUPOS, ventana fija como auth/rate-limit.js. Por usuario y por hora; global por día.
  const usuarios = new Map();
  let dia = { n: 0, hasta: 0 };

  const est = { generadas: 0, descartadas: 0, sinCupo: 0, errores: 0, rechazos: {} };

  // ----- caché -----
  function leerCache(trackId, huella) {
    const e = cache.get(trackId);
    if (!e) return null;
    if (e.huella !== huella) { cache.delete(trackId); return null; }
    if (e.frase === null && e.hasta <= ahora()) { cache.delete(trackId); return null; }
    cache.delete(trackId); // LRU: lo usado pasa al final
    cache.set(trackId, e);
    return e;
  }

  function guardar(trackId, entrada) {
    cache.delete(trackId);
    cache.set(trackId, entrada);
    while (cache.size > config.cacheMax) cache.delete(cache.keys().next().value);
  }

  const negativa = (job, ms) => guardar(job.trackId, { huella: job.huella, frase: null, hasta: ahora() + ms });

  // ----- cupos -----
  // Se CONSULTA al encolar y otra vez al despachar, pero se COBRA solo si la llamada llegó a
  // Ollama, y la paga quien disparó la generación aunque la frase quede para todos: así los
  // reintentos mientras el modelo calienta, o con el circuito abierto, no se comen el cupo, y
  // quien pide una pista que ya estaba lista no paga nada.
  function cupoAgotado(userId) {
    const t = ahora();
    const u = usuarios.get(userId);
    if (u && u.hasta > t && u.n >= config.limiteUsuarioHora) return true;
    return dia.hasta > t && dia.n >= config.limiteDia;
  }

  function cobrar(userId) {
    const t = ahora();
    if (usuarios.size > 1000) for (const [k, v] of usuarios) if (v.hasta <= t) usuarios.delete(k);
    let u = usuarios.get(userId);
    if (!u || u.hasta <= t) { u = { n: 0, hasta: t + HORA_MS }; usuarios.set(userId, u); }
    u.n++;
    if (dia.hasta <= t) dia = { n: 0, hasta: t + DIA_MS };
    dia.n++;
  }

  // ----- worker -----
  const frio = () => ultimaActividad === null || ahora() - ultimaActividad >= config.friaMs;

  async function procesar(job) {
    if (cupoAgotado(job.userId)) { est.sinCupo++; return; }
    let llego = false;
    try {
      // Perezoso: solo se calienta cuando hace falta. El GET que lo disparó ya contestó.
      // Un timeout de calentar() cuenta para el cortacircuitos del cliente, y acá deja una
      // negativa corta.
      if (frio()) {
        const k = await Promise.resolve()
          .then(() => cliente.calentar())
          .catch(() => ({ ok: false, motivo: 'error' }));
        if (!k.ok) {
          if (!NO_LLEGO.has(k.motivo)) { llego = true; negativa(job, NEG_TRANSITORIO_MS); }
          return;
        }
        llego = true;
        ultimaActividad = ahora();
      }

      const r = await Promise.resolve()
        .then(() => cliente.generar(construirMensajes(job.hechos)))
        .catch(() => ({ ok: false, motivo: 'error' }));
      if (!r.ok) {
        // Sin llegar a Ollama (calentando, circuito abierto…) no hay negativa: el próximo GET
        // vuelve a encargarla.
        if (!NO_LLEGO.has(r.motivo)) { llego = true; negativa(job, NEG_TRANSITORIO_MS); }
        return;
      }
      llego = true;
      ultimaActividad = ahora();

      const frase = extraerFrase(r.texto);
      const v = frase === null ? { ok: false, motivo: 'extraccion' } : validarFrase(frase, job.hechos);
      if (v.ok) {
        est.generadas++;
        guardar(job.trackId, { huella: job.huella, frase: v.frase, hasta: null });
      } else {
        est.rechazos[v.motivo] = (est.rechazos[v.motivo] ?? 0) + 1;
        negativa(job, NEG_VALIDACION_MS);
      }
    } finally {
      if (llego) cobrar(job.userId);
    }
  }

  // `trabajando` se limpia DENTRO del bucle, en el mismo turno en que se ve la cola vacía: así
  // un encargo que llegue justo después arranca un worker nuevo y no se queda esperando a uno
  // que ya salió. (bucle nunca termina de forma síncrona: procesar siempre cede el turno.)
  async function bucle() {
    try {
      while (cola.length) {
        const job = cola.shift();
        try {
          await procesar(job);
        } catch {
          est.errores++; // un bug acá no puede tumbar el worker ni dejar el trabajo colgado
        } finally {
          pendientes.delete(job.key);
        }
      }
    } finally {
      trabajando = null;
    }
  }

  function despertar() {
    if (!trabajando) trabajando = bucle();
  }

  // ----- respuesta -----
  const responder = (estado, frase, escuchas, extra = {}) => ({ estado, frase, escuchas, ...extra });

  // → null si la pista no existe; si no, el cuerpo del endpoint. Síncrono a propósito.
  function consultar({ trackId, userId }) {
    if (!cliente.estado().encendido) {
      // Apagado del todo: ni frase ni escuchas, y no se toca ni el conteo ni la cola.
      return leerTrack(trackId) ? responder('apagado', null, null) : null;
    }
    const track = leerTrack(trackId);
    if (!track) return null;

    // El conteo va por plantilla, nunca por el modelo, y se calcula en cada petición: es de
    // este usuario y es lo único que cambia. Son las escuchas PREVIAS porque la app registra
    // una escucha a la mitad de la pista, no al empezar; con la pista recién arrancada, la
    // actual todavía no existe.
    const escuchas = plantillaEscuchas(contarEscuchas(userId, trackId));

    const hechos = extraerHechos(track);
    if (!puedeGenerar(hechos)) return responder('sin-frase', null, escuchas);

    const huella = huellaDe(hechos, config.modelo);
    const hit = leerCache(trackId, huella);
    if (hit) return hit.frase !== null ? responder('lista', hit.frase, escuchas) : responder('sin-frase', null, escuchas);

    const key = `${trackId}:${huella}`;
    const hay = pendientes.get(key);
    if (hay) {
      // Ya encargada: no se duplica. Si aún espera turno, vuelve a ser "la más reciente".
      const i = cola.indexOf(hay);
      if (i !== -1) { cola.splice(i, 1); cola.push(hay); }
      return responder('generando', null, escuchas, { reintentar_s: REINTENTAR_S });
    }

    // Con el circuito abierto no se encola nada; se recupera solo al cerrarse.
    if (cliente.estado().circuito === 'abierto') return responder('sin-frase', null, escuchas);
    if (cupoAgotado(userId)) return responder('limite', null, escuchas);

    const job = { key, trackId, huella, hechos, userId };
    // Cola llena: se descarta la pendiente MÁS VIEJA (la que menos probablemente siga
    // sonando). La que está corriendo ya salió de la cola y no se toca.
    while (cola.length >= config.colaMax) {
      const viejo = cola.shift();
      pendientes.delete(viejo.key);
      est.descartadas++;
    }
    cola.push(job);
    pendientes.set(key, job);
    despertar();
    return responder('generando', null, escuchas, { reintentar_s: REINTENTAR_S });
  }

  // Resuelve cuando no queda trabajo. Para pruebas y diagnóstico.
  const reposo = () => trabajando ?? Promise.resolve();

  // Opcional (LOCUTOR_CALENTAR_AL_ARRANCAR=1) y apagado por defecto: cada merge a main
  // redespliega y reinicia el servidor, y calentar en cada deploy cargaría un modelo de 12B en
  // una GPU compartida aunque nadie lo use en media hora. Sin esto, el worker calienta solo
  // cuando llega el primer encargo. No espera: el que llama no se bloquea.
  function calentarAlArrancar() {
    if (!cliente.estado().encendido) return Promise.resolve();
    return Promise.resolve()
      .then(() => cliente.calentar())
      .then((r) => { if (r?.ok) ultimaActividad = ahora(); })
      .catch(() => {});
  }

  const estadisticas = () => ({
    cache: cache.size,
    cola: cola.length,
    trabajando: trabajando !== null,
    ...est,
    rechazos: { ...est.rechazos },
  });

  return { consultar, reposo, calentarAlArrancar, estadisticas };
}
