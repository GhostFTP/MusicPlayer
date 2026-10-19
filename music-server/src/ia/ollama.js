// Cliente de Ollama para el locutor (frente "locutor"): un POST a /api/chat con timeout,
// lectura acotada y un cortacircuitos en memoria. Todo gratis y local: Ollama corre en la
// red del servidor, no hay APIs de pago.
//
// REGLAS DE ESTE MÓDULO
//  - NUNCA lanza ni deja una promesa sin atrapar: todo camino devuelve { ok, ... }.
//  - OLLAMA_URL vacío o inválido = APAGADO: no se intenta ninguna petición.
//  - El que lo usa (el endpoint) NO espera a la IA: este cliente solo acota cuánto tarda.
//  - Los mensajes y las respuestas NUNCA se imprimen. Solo hay dos líneas de log en la vida
//    de una caída: al abrirse el circuito y al cerrarse.
//
// Lo probado y lo no probado está en scripts/test-locutor-ollama.mjs. Lo que se SUPONE sin
// haberlo medido va marcado [NO MEDIDO] abajo.

import { ESQUEMA_RESPUESTA } from '../locutor/frase.js';

const DEFECTOS = Object.freeze({
  modelo: 'gemma4:12b',
  keepAlive: '30m',
  timeoutMs: 8000,
  timeoutFrioMs: 150000,
});

const MAX_BYTES = 64 * 1024; // lo máximo que se lee de una respuesta
const FALLOS_PARA_ABRIR = 3;
const APERTURA_MS = 60_000;

// ---------- configuración ----------

// Entero positivo, de número o de texto («8000», « 500 »). Cualquier otra cosa → defecto.
function entero(v, defecto) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : defecto;
}

// Nunca lanza. Una URL inválida NO cae a un defecto (no hay una URL por defecto razonable):
// cae a apagado, y `urlInvalida` deja que el cliente lo avise una vez.
export function leerConfig(env = process.env) {
  const e = env && typeof env === 'object' ? env : {};
  const crudo = typeof e.OLLAMA_URL === 'string' ? e.OLLAMA_URL.trim() : '';
  let url = null;
  let urlInvalida = false;
  if (crudo) {
    try {
      const u = new URL(crudo);
      if (u.protocol === 'http:' || u.protocol === 'https:') url = (u.origin + u.pathname).replace(/\/+$/, '');
      else urlInvalida = true;
    } catch {
      urlInvalida = true;
    }
  }
  const modelo = typeof e.LOCUTOR_MODELO === 'string' ? e.LOCUTOR_MODELO.trim() : '';
  const keep = typeof e.LOCUTOR_KEEP_ALIVE === 'string' ? e.LOCUTOR_KEEP_ALIVE.trim() : '';
  return {
    url,
    urlInvalida,
    modelo: modelo && modelo.length <= 100 ? modelo : DEFECTOS.modelo,
    keepAlive: /^(-1|\d+[smh])$/.test(keep) ? keep : DEFECTOS.keepAlive,
    timeoutMs: entero(e.LOCUTOR_TIMEOUT_MS, DEFECTOS.timeoutMs),
    timeoutFrioMs: entero(e.LOCUTOR_TIMEOUT_FRIO_MS, DEFECTOS.timeoutFrioMs),
  };
}

// ---------- cliente ----------

const mensajesValidos = (m) =>
  Array.isArray(m) && m.length > 0 &&
  m.every((x) => x && typeof x === 'object' && typeof x.role === 'string' && typeof x.content === 'string');

const fallo = (motivo) => ({ ok: false, motivo });

// `env`, `fetch` y `ahora` se inyectan para las pruebas; `fallosParaAbrir` y `aperturaMs` son
// las constantes del cortacircuitos.
export function crearCliente({
  env = process.env,
  fetch: fetchInyectado,
  ahora = Date.now,
  fallosParaAbrir = FALLOS_PARA_ABRIR,
  aperturaMs = APERTURA_MS,
} = {}) {
  const cfg = leerConfig(env);
  const hacerFetch = fetchInyectado ?? ((...a) => globalThis.fetch(...a));
  if (cfg.urlInvalida) console.warn('[ollama] OLLAMA_URL inválida; locutor apagado');

  let fallosSeguidos = 0;
  let abiertoHasta = null; // null = cerrado
  let probando = false; // hay un intento de prueba en vuelo (semi-abierto)
  let calentando = null; // la promesa de calentar() en curso

  function circuito() {
    if (abiertoHasta === null) return 'cerrado';
    return ahora() < abiertoHasta ? 'abierto' : 'semi';
  }

  // Cerrado: pasa. Abierto: no. Semi: pasa UN solo intento; los demás, mientras tanto, no.
  function admitir() {
    const c = circuito();
    if (c === 'cerrado') return { pasa: true, prueba: false };
    if (c === 'semi' && !probando) {
      probando = true;
      return { pasa: true, prueba: true };
    }
    return { pasa: false, prueba: false };
  }

  function exito() {
    fallosSeguidos = 0;
    probando = false;
    if (abiertoHasta !== null) {
      abiertoHasta = null;
      console.warn('[ollama] circuito cerrado');
    }
  }

  // Una prueba que falla vuelve a abrir en silencio: se loguea abrir y cerrar, no cada minuto
  // de una caída larga.
  function falla(prueba) {
    fallosSeguidos++;
    if (prueba) {
      probando = false;
      abiertoHasta = ahora() + aperturaMs;
    } else if (abiertoHasta === null && fallosSeguidos >= fallosParaAbrir) {
      abiertoHasta = ahora() + aperturaMs;
      console.warn(`[ollama] circuito abierto tras ${fallosSeguidos} fallos seguidos`);
    }
  }

  // Una petición a /api/chat. Devuelve { ok:true, texto } | { ok:false, motivo }; no lanza.
  async function llamar(body, timeoutMs) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const resp = await hacerFetch(`${cfg.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) {
        resp.body?.cancel?.().catch?.(() => {});
        return fallo(`http-${resp.status}`);
      }
      const declarado = Number(resp.headers?.get?.('content-length'));
      if (declarado > MAX_BYTES) {
        resp.body?.cancel?.().catch?.(() => {});
        return fallo('respuesta-grande');
      }

      let crudo;
      if (resp.body && typeof resp.body.getReader === 'function') {
        const lector = resp.body.getReader();
        const trozos = [];
        let total = 0;
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) {
            lector.cancel().catch(() => {});
            return fallo('respuesta-grande');
          }
          trozos.push(value);
        }
        crudo = Buffer.concat(trozos).toString('utf8');
      } else if (typeof resp.text === 'function') {
        crudo = await resp.text();
        if (typeof crudo === 'string' && crudo.length > MAX_BYTES) return fallo('respuesta-grande');
      } else {
        return fallo('forma-inesperada');
      }

      let datos;
      try { datos = JSON.parse(crudo); } catch { return fallo('json-invalido'); }
      const texto = datos?.message?.content;
      if (typeof texto !== 'string' || texto.trim() === '') return fallo('forma-inesperada');
      return { ok: true, texto };
    } catch {
      // Un timeout aborta el signal, tanto en la conexión como a media lectura.
      return fallo(signal.aborted ? 'timeout' : 'red');
    }
  }

  // Admisión + petición + cuenta del cortacircuitos. Nunca rechaza.
  async function ejecutar(body, timeoutMs) {
    const { pasa, prueba } = admitir();
    if (!pasa) return fallo('circuito-abierto');
    const t0 = ahora();
    const r = await llamar(body, timeoutMs);
    if (r.ok) {
      exito();
      return { ok: true, texto: r.texto, ms: Math.max(0, ahora() - t0) };
    }
    falla(prueba);
    return r;
  }

  async function generar(mensajes) {
    try {
      if (!cfg.url) return fallo('apagado');
      if (!mensajesValidos(mensajes)) return fallo('mensajes-invalidos');
      // Mientras se calienta el modelo, una petición normal solo toparía con la carga en frío
      // y contaría como fallo sin serlo: no se llama a Ollama ni se cuenta.
      if (calentando) return fallo('calentando');
      return await ejecutar({
        model: cfg.modelo,
        messages: mensajes,
        stream: false,
        think: false,
        format: ESQUEMA_RESPUESTA,
        keep_alive: cfg.keepAlive,
        // Sin num_ctx a propósito: cambiarlo recarga el runner entre peticiones. [NO MEDIDO]
        options: { temperature: 0.6, num_predict: 80 },
      }, cfg.timeoutMs);
    } catch {
      return fallo('error');
    }
  }

  // Carga el modelo en la GPU con una petición mínima. De un solo vuelo: si ya hay una en
  // curso, devuelve LA MISMA promesa.
  //
  // Cuenta para el cortacircuitos (éxito reinicia, fallo suma). Un timeout de 150 s en una
  // carga en frío cuenta como fallo, y se acepta: si el modelo no cargó en ese tiempo, el
  // servicio no está en condiciones de responder dentro de los 8 s del locutor, y tres de
  // esas seguidas son exactamente la señal para dejar de insistir un minuto.
  //
  // [NO MEDIDO] que num_predict:1 evite generar texto en Ollama 0.40.3 con gemma4:12b; igual
  // el modelo queda cargado. Se mide desde el contenedor, en el paso de infra.
  function calentar() {
    try {
      if (!cfg.url) return Promise.resolve(fallo('apagado'));
      if (calentando) return calentando;
      const p = ejecutar({
        model: cfg.modelo,
        messages: [{ role: 'user', content: 'hola' }],
        stream: false,
        think: false,
        keep_alive: cfg.keepAlive,
        options: { num_predict: 1 },
      }, cfg.timeoutFrioMs).catch(() => fallo('error'));
      // Si el circuito no dejó pasar, `ejecutar` ya terminó y esto se limpia enseguida.
      calentando = p.finally(() => { calentando = null; });
      return calentando;
    } catch {
      return Promise.resolve(fallo('error'));
    }
  }

  function estado() {
    return { encendido: cfg.url !== null, circuito: circuito(), fallosSeguidos };
  }

  return { generar, calentar, estado };
}

// Instancia por defecto: process.env, fetch global, Date.now.
export const ollama = crearCliente();
export const generar = (mensajes) => ollama.generar(mensajes);
export const calentar = () => ollama.calentar();
export const estado = () => ollama.estado();
