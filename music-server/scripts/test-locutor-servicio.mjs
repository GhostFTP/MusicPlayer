// Prueba del SERVICIO del locutor (src/locutor/servicio.js). Sin HTTP, sin base, sin Ollama y
// SIN dormir: un cliente falso, un reloj inyectado y un cerrojo (latch) para congelar el worker.
//
//   npm run test:locutor-servicio
//
// Sale con código 1 si algo falla, incluido cualquier unhandledRejection.
import { crearServicio, huellaDe, leerConfigServicio, REINTENTAR_S } from '../src/locutor/servicio.js';
import { extraerHechos } from '../src/locutor/hechos.js';

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise((r) => setImmediate(r)); // deja correr los microtasks pendientes

const sinAtrapar = [];
process.on('unhandledRejection', (e) => sinAtrapar.push(e));
process.on('uncaughtException', (e) => sinAtrapar.push(e));

const MIN = 60_000;
const HORA = 60 * MIN;

// ---------- escenario ----------
const FRASE = 'Suena Daft Punk con Discovery, una noche tranquila para dejarse llevar.';
const OK = () => ({ ok: true, texto: JSON.stringify({ frase: FRASE }), ms: 5 });
const pista = (id, o = {}) => ({
  title: `Tema ${id}`, artist: 'Daft Punk', album_artist: 'Daft Punk', album: 'Discovery',
  genre: 'Electronic', year: 2001, track_number: id, disc_total: 1, ...o,
});

function clienteFalso() {
  const c = {
    encendido: true, circuito: 'cerrado',
    generarN: 0, calentarN: 0, orden: [], mensajes: [],
    generarFn: async () => OK(),
    calentarFn: async () => ({ ok: true, texto: 'x', ms: 1 }),
    generar(m) {
      c.generarN++;
      c.mensajes.push(m);
      try { c.orden.push(JSON.parse(m[1].content.split('<<<DATOS\n')[1].split('\nDATOS>>>')[0]).titulo); } catch { /* sin título */ }
      return c.generarFn(m);
    },
    calentar() { c.calentarN++; return c.calentarFn(); },
    estado() { return { encendido: c.encendido, circuito: c.circuito, fallosSeguidos: 0 }; },
  };
  return c;
}

// Un cerrojo: generarFn devuelve una promesa que solo se resuelve al soltar.
function cerrojo() {
  let soltar;
  const espera = new Promise((r) => { soltar = r; });
  return { espera, soltar: () => soltar() };
}

function montar(over = {}, tracksIniciales = null) {
  const reloj = { t: 1_000_000_000 };
  const cliente = clienteFalso();
  const tracks = new Map(tracksIniciales ?? [1, 2, 3, 4, 5, 6].map((i) => [i, pista(i)]));
  const escuchas = new Map();
  const config = { ...leerConfigServicio({}), friaMs: 25 * MIN, ...over };
  const s = crearServicio({
    cliente,
    ahora: () => reloj.t,
    leerTrack: (id) => tracks.get(id) ?? null,
    contarEscuchas: (u, t) => escuchas.get(`${u}:${t}`) ?? 0,
    config,
  });
  const pedir = (trackId, userId = 1) => s.consultar({ trackId, userId });
  return { reloj, cliente, tracks, escuchas, s, pedir };
}

// ---------- pruebas ----------

console.log('apagado y pista inexistente');
{
  const { cliente, pedir, s } = montar();
  cliente.encendido = false;
  check(igual(pedir(1), { estado: 'apagado', frase: null, escuchas: null }), "apagado: { estado:'apagado', frase:null, escuchas:null }");
  check(cliente.generarN === 0 && cliente.calentarN === 0 && s.estadisticas().cola === 0, 'apagado: no encola ni llama a nada');
  check(pedir(999) === null, 'pista inexistente → null (el endpoint da 404)');
}

console.log('\ngenerando → lista');
{
  const { cliente, escuchas, pedir, s } = montar();
  const a = pedir(1);
  check(a.estado === 'generando' && a.frase === null && a.escuchas === 'Primera vez que la escuchas.' && a.reintentar_s === REINTENTAR_S, 'primer GET: generando al instante, con escuchas y reintentar_s', JSON.stringify(a));
  await s.reposo();
  const b = pedir(1);
  check(b.estado === 'lista' && b.frase === FRASE && !('reintentar_s' in b), 'después: lista con la frase', JSON.stringify(b));
  check(cliente.generarN === 1 && cliente.calentarN === 1, 'una generación y un calentamiento (primer encargo, modelo frío)');
  escuchas.set('1:1', 2);
  check(pedir(1).escuchas === 'Ya la has escuchado 2 veces.' && cliente.generarN === 1, 'el conteo se recalcula en cada GET y no regenera');
  escuchas.set('1:1', 1);
  check(pedir(1).escuchas === 'Ya la habías escuchado una vez.', 'una escucha previa');
  const enviado = JSON.stringify(cliente.mensajes[0]);
  check(!/escuchas|"pista"/.test(enviado) && !enviado.includes('Ya la'), 'el modelo no recibe escuchas ni pista');
  check(igual(pedir(1, 2), { estado: 'lista', frase: FRASE, escuchas: 'Primera vez que la escuchas.' }), 'la caché es compartida: otro usuario la recibe sin generar', JSON.stringify(pedir(1, 2)));
  check(cliente.generarN === 1, 'el otro usuario no disparó nada');
}

console.log('\nlo que no se puede generar');
{
  const m = montar({}, [[1, pista(1, { artist: null, album_artist: null })], [2, pista(2, { title: '' })]]);
  check(m.pedir(1).estado === 'sin-frase' && m.pedir(2).estado === 'sin-frase', 'sin título o sin artista: sin-frase');
  check(m.cliente.generarN === 0 && m.s.estadisticas().cola === 0, '…sin encolar nada');
  check(m.pedir(1).escuchas === 'Primera vez que la escuchas.', '…pero las escuchas siguen saliendo');
}

console.log('\nfrase que no valida (negativa de 10 min)');
{
  const m = montar();
  m.cliente.generarFn = async () => ({ ok: true, texto: JSON.stringify({ frase: 'Metallica suena esta noche.' }), ms: 1 });
  m.pedir(1); await m.s.reposo();
  check(m.pedir(1).estado === 'sin-frase', 'frase inválida: sin-frase');
  check(m.s.estadisticas().rechazos['primera-palabra'] === 1, 'el rechazo queda contado por etiqueta');
  check(m.pedir(1).estado === 'sin-frase' && m.cliente.generarN === 1, 'no se vuelve a pedir al modelo (negativa)');
  m.reloj.t += 10 * MIN - 1;
  check(m.pedir(1).estado === 'sin-frase' && m.cliente.generarN === 1, 'a 10 min − 1 ms sigue la negativa');
  m.reloj.t += 1;
  check(m.pedir(1).estado === 'generando', 'a los 10 min se reintenta');
  m.cliente.generarFn = async () => OK();
  await m.s.reposo();
  check(m.pedir(1).estado === 'lista' && m.cliente.generarN === 2, 'y esta vez valida');

  const j = montar();
  j.cliente.generarFn = async () => ({ ok: true, texto: 'basura que no es json', ms: 1 });
  j.pedir(1); await j.s.reposo();
  check(j.pedir(1).estado === 'sin-frase' && j.s.estadisticas().rechazos.extraccion === 1, 'respuesta que no es JSON: sin-frase (extraccion)');
}

console.log('\nfallo transitorio (negativa de 30 s)');
{
  const m = montar();
  m.cliente.generarFn = async () => ({ ok: false, motivo: 'timeout' });
  m.pedir(1); await m.s.reposo();
  check(m.pedir(1).estado === 'sin-frase', 'timeout: sin-frase');
  m.reloj.t += 30_000 - 1;
  check(m.pedir(1).estado === 'sin-frase' && m.cliente.generarN === 1, 'a 30 s − 1 ms no se reintenta');
  m.reloj.t += 1;
  check(m.pedir(1).estado === 'generando', 'a los 30 s sí');
  await m.s.reposo();
}

console.log('\nla caché positiva no expira y la huella la invalida');
{
  const m = montar();
  m.pedir(1); await m.s.reposo();
  m.reloj.t += 365 * 24 * HORA;
  check(m.pedir(1).estado === 'lista' && m.cliente.generarN === 1, 'un año después sigue lista (sin expiración por tiempo)');
  m.tracks.set(1, pista(1, { album: 'Otro álbum' }));
  // La frase vieja nombra «Discovery», que ya no está en los hechos: el modelo daría otra.
  m.cliente.generarFn = async () => ({ ok: true, texto: JSON.stringify({ frase: 'Suena Daft Punk, una noche tranquila para dejarse llevar.' }), ms: 1 });
  check(m.pedir(1).estado === 'generando', 'un retag (otro álbum) invalida la entrada');
  await m.s.reposo();
  check(m.s.estadisticas().cache === 1 && m.cliente.generarN === 2, 'se regenera y la caché sigue en una entrada por pista');
  m.tracks.set(1, pista(1, { album: 'Otro álbum', track_number: 9 }));
  check(m.pedir(1).estado === 'lista', 'cambiar solo la pista (que el modelo no ve) NO invalida');
  const h = extraerHechos(pista(1));
  check(huellaDe(h, 'a') === huellaDe(h, 'a') && huellaDe(h, 'a') !== huellaDe(h, 'b'), 'la huella depende del modelo');
  check(huellaDe(h, 'a') !== huellaDe(extraerHechos(pista(1, { genre: 'Rock' })), 'a') && huellaDe(h, 'a') === huellaDe(extraerHechos(pista(1, { track_number: 7 })), 'a'), 'la huella depende de los datos del modelo y no de la pista');
}

console.log('\ndedupe y orden');
{
  const m = montar();
  const c = cerrojo();
  m.cliente.generarFn = () => c.espera.then(OK);
  const r = [1, 2, 3, 4, 5].map(() => m.pedir(1));
  await tick();
  check(r.every((x) => x.estado === 'generando') && m.cliente.generarN === 1, 'cinco GET de la misma pista: una sola generación');
  c.soltar(); await m.s.reposo();
  check(m.pedir(1).estado === 'lista', 'y luego lista');

  const n = montar();
  const k = cerrojo();
  n.cliente.generarFn = () => k.espera.then(OK);
  n.pedir(1); await tick(); // la 1 queda corriendo, retenida
  n.pedir(2); n.pedir(3);
  n.pedir(2); // la 2 vuelve a ser "la más reciente": pasa detrás de la 3
  k.soltar(); await n.s.reposo();
  check(igual(n.cliente.orden, ['Tema 1', 'Tema 3', 'Tema 2']), 'una repetida mientras espera pasa al final', n.cliente.orden.join());
}

console.log('\ncola con tope');
{
  const m = montar({ colaMax: 3 });
  const c = cerrojo();
  m.cliente.generarFn = () => c.espera.then(OK);
  m.pedir(1); await tick(); // corriendo (ya no cuenta como cola)
  m.pedir(2); m.pedir(3); m.pedir(4);
  check(m.s.estadisticas().cola === 3, 'tres en espera (el tope)');
  m.pedir(5); // se llena: sale la más vieja en espera (la 2)
  const st = m.s.estadisticas();
  check(st.cola === 3 && st.descartadas === 1, 'la cuarta en espera descarta una');
  c.soltar(); await m.s.reposo();
  check(igual(m.cliente.orden, ['Tema 1', 'Tema 3', 'Tema 4', 'Tema 5']), 'se descartó la más vieja en espera (2) y nunca la que corría (1)', m.cliente.orden.join());
  check(m.pedir(2).estado === 'generando', 'la descartada puede volver a encargarse');
  await m.s.reposo();
}

console.log('\ncalentamiento perezoso');
{
  const m = montar();
  m.pedir(1); await m.s.reposo();
  check(m.cliente.calentarN === 1 && m.cliente.generarN === 1, 'primer encargo: calienta y luego genera');
  m.reloj.t += 25 * MIN - 1;
  m.pedir(2); await m.s.reposo();
  check(m.cliente.calentarN === 1, 'a 25 min − 1 ms de actividad: no se vuelve a calentar');
  m.reloj.t += 25 * MIN;
  m.pedir(3); await m.s.reposo();
  check(m.cliente.calentarN === 2, 'a los 25 min exactos de la última actividad: calienta otra vez');

  const f = montar();
  f.cliente.calentarFn = async () => ({ ok: false, motivo: 'timeout' });
  f.pedir(1); await f.s.reposo();
  check(f.cliente.generarN === 0 && f.pedir(1).estado === 'sin-frase', 'calentar falla (timeout): no se genera y queda negativa corta');
  f.reloj.t += 30_000;
  f.cliente.calentarFn = async () => ({ ok: true });
  f.pedir(1); await f.s.reposo();
  check(f.pedir(1).estado === 'lista', 'pasada la negativa, se recupera');

  const cc = montar();
  cc.cliente.calentarFn = async () => ({ ok: false, motivo: 'circuito-abierto' });
  cc.pedir(1); await cc.s.reposo();
  check(cc.cliente.generarN === 0 && cc.pedir(1).estado === 'generando', 'calentar sin llegar a Ollama: sin negativa, se puede volver a encargar');
  await cc.s.reposo();

  const k = leerConfigServicio({ LOCUTOR_KEEP_ALIVE: '-1' });
  check(k.friaMs === Infinity, "keep_alive -1: nunca se considera frío después del primer uso");
  check(leerConfigServicio({}).friaMs === 25 * MIN && leerConfigServicio({ LOCUTOR_KEEP_ALIVE: '1h' }).friaMs === 55 * MIN && leerConfigServicio({ LOCUTOR_KEEP_ALIVE: '2m' }).friaMs === MIN, 'friaMs = keep_alive − 5 min (mínimo 1 min)');
  const a = montar();
  await a.s.calentarAlArrancar();
  a.pedir(1); await a.s.reposo();
  check(a.cliente.calentarN === 1, 'calentarAlArrancar: el primer encargo ya no vuelve a calentar');
  const ap = montar();
  ap.cliente.encendido = false;
  await ap.s.calentarAlArrancar();
  check(ap.cliente.calentarN === 0, 'calentarAlArrancar apagado: no llama');
  const fa = montar();
  fa.cliente.calentarFn = async () => ({ ok: false, motivo: 'timeout' });
  await fa.s.calentarAlArrancar();
  fa.cliente.calentarFn = async () => ({ ok: true });
  fa.pedir(1); await fa.s.reposo();
  check(fa.cliente.calentarN === 2, 'si calentar al arrancar falló, el primer encargo vuelve a intentarlo');
}

console.log('\ncircuito y "calentando"');
{
  const m = montar();
  m.cliente.circuito = 'abierto';
  const r = m.pedir(1);
  check(r.estado === 'sin-frase' && m.s.estadisticas().cola === 0 && m.cliente.generarN === 0, 'circuito abierto: sin-frase y no se encola');
  m.cliente.circuito = 'cerrado';
  check(m.pedir(1).estado === 'generando', 'cerrado: vuelve a encolar (no quedó negativa)');
  await m.s.reposo();

  for (const motivo of ['circuito-abierto', 'calentando']) {
    const n = montar({ limiteUsuarioHora: 1 });
    await n.s.calentarAlArrancar(); // ya caliente: aquí solo se prueba lo que pasa en generar()
    n.cliente.generarFn = async () => ({ ok: false, motivo });
    n.pedir(1); await n.s.reposo();
    check(n.pedir(1).estado === 'generando', `generar → ${motivo}: el trabajo se descarta sin negativa`);
    await n.s.reposo();
    check(n.pedir(2).estado !== 'limite', `generar → ${motivo}: no cobró cupo`);
    await n.s.reposo();
  }
}

console.log('\ncupos');
{
  const m = montar({ limiteUsuarioHora: 2 });
  m.pedir(1); await m.s.reposo();
  m.pedir(2); await m.s.reposo();
  check(m.pedir(3).estado === 'limite', 'tercer encargo del usuario en la hora: limite');
  check(m.pedir(3).escuchas === 'Primera vez que la escuchas.', "'limite' también lleva escuchas");
  check(m.pedir(1).estado === 'lista', 'una pista ya lista no gasta cupo: sigue saliendo');
  check(m.pedir(3, 2).estado === 'generando', 'otro usuario no está limitado');
  await m.s.reposo();
  m.reloj.t += HORA - 1;
  check(m.pedir(4).estado === 'limite', 'a 1 h − 1 ms sigue limitado');
  m.reloj.t += 1;
  check(m.pedir(4).estado === 'generando', 'a la hora vence la ventana');
  await m.s.reposo();

  const g = montar({ limiteUsuarioHora: 100, limiteDia: 3 });
  for (let i = 1; i <= 3; i++) { g.pedir(i, i); await g.s.reposo(); }
  check(g.pedir(4, 9).estado === 'limite', 'tope global del día: limite');
  g.reloj.t += 24 * HORA - 1;
  check(g.pedir(4, 9).estado === 'limite', 'a 24 h − 1 ms sigue');
  g.reloj.t += 1;
  check(g.pedir(4, 9).estado === 'generando', 'al día vence la ventana global');
  await g.s.reposo();

  // Paga quien dispara: el que pide algo ya generado no paga.
  const p = montar({ limiteUsuarioHora: 1 });
  p.pedir(1, 1); await p.s.reposo();
  check(p.pedir(1, 2).estado === 'lista', 'el usuario 2 recibe la frase que pagó el 1…');
  check(p.pedir(2, 2).estado === 'generando', '…y conserva su propio cupo');
  await p.s.reposo();
  check(p.pedir(3, 2).estado === 'limite' && p.pedir(3, 1).estado === 'limite', 'cada uno pagó solo lo que disparó');

  // Se consulta otra vez al despachar: dos encargos en cola, cupo de uno.
  const d = montar({ limiteUsuarioHora: 1 });
  const c = cerrojo();
  d.cliente.generarFn = () => c.espera.then(OK);
  d.pedir(1); await tick();
  d.pedir(2);
  c.soltar(); await d.s.reposo();
  check(d.cliente.generarN === 1 && d.pedir(2).estado === 'limite', 'el segundo encargo en cola no se despacha si el cupo se agotó mientras esperaba');

  // Un timeout SÍ llegó a Ollama: se cobra.
  const t = montar({ limiteUsuarioHora: 1 });
  t.cliente.generarFn = async () => ({ ok: false, motivo: 'timeout' });
  t.pedir(1); await t.s.reposo();
  check(t.pedir(2).estado === 'limite', 'una llamada que llegó a Ollama y venció también cobra');
}

console.log('\nLRU');
{
  const m = montar({ cacheMax: 3 });
  for (const i of [1, 2, 3]) { m.pedir(i); await m.s.reposo(); }
  m.pedir(1); // toca la 1: el orden queda 2, 3, 1
  m.pedir(4); await m.s.reposo(); // entra la 4 y sale la menos usada (2)
  check(m.s.estadisticas().cache === 3, 'la caché respeta el tope');
  check(m.pedir(3).estado === 'lista' && m.pedir(1).estado === 'lista' && m.pedir(4).estado === 'lista', 'las usadas siguen');
  check(m.pedir(2).estado === 'generando', 'la menos usada (2) fue la expulsada');
  await m.s.reposo();
}

console.log('\nnada se loguea');
{
  const lineas = [];
  const originales = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { originales[k] = console[k]; console[k] = (...a) => lineas.push(`${k}: ${a.join(' ')}`); }
  try {
    const m = montar({ limiteUsuarioHora: 3, cacheMax: 2 });
    m.pedir(1); await m.s.reposo(); // lista
    m.cliente.generarFn = async () => ({ ok: true, texto: JSON.stringify({ frase: 'Metallica suena.' }), ms: 1 });
    m.pedir(2); await m.s.reposo(); // no valida
    m.cliente.generarFn = async () => { throw new Error('SECRETO'); };
    m.pedir(3); await m.s.reposo(); // lanza
    m.cliente.circuito = 'abierto'; m.pedir(4);
    m.cliente.circuito = 'cerrado'; m.pedir(5);
    await m.s.reposo();
    m.pedir(6);
  } finally {
    for (const k of Object.keys(originales)) console[k] = originales[k];
  }
  check(lineas.length === 0, 'ningún camino escribe en la consola (ni frases, ni mensajes, ni motivos)', lineas.join(' | '));
}

console.log('\ncliente que lanza o rechaza');
{
  const m = montar();
  m.cliente.generarFn = () => { throw new Error('boom'); };
  m.pedir(1); await m.s.reposo();
  check(m.pedir(1).estado === 'sin-frase', 'generar lanza de forma síncrona: sin-frase, sin lanzar');
  const r = montar();
  r.cliente.generarFn = () => Promise.reject(new Error('boom'));
  r.pedir(1); await r.s.reposo();
  check(r.pedir(1).estado === 'sin-frase', 'generar rechaza: sin-frase');
  const c = montar();
  c.cliente.calentarFn = () => { throw new Error('boom'); };
  c.pedir(1); await c.s.reposo();
  check(c.pedir(1).estado === 'sin-frase', 'calentar lanza: sin-frase');
  const w = montar();
  w.pedir(1); w.pedir(2); await w.s.reposo();
  check(w.s.estadisticas().trabajando === false && w.s.estadisticas().cola === 0, 'el worker termina y queda libre');
  w.pedir(3);
  check(w.s.estadisticas().trabajando === true, 'y un encargo posterior lo despierta');
  await w.s.reposo();
}

console.log('\nconfiguración');
{
  const d = leerConfigServicio({});
  check(d.limiteUsuarioHora === 60 && d.limiteDia === 1500 && d.cacheMax === 2000 && d.colaMax === 20 && d.calentarAlArrancar === false && d.modelo === 'gemma4:12b', 'defectos', JSON.stringify(d));
  const e = leerConfigServicio({ LOCUTOR_LIMITE_USUARIO_HORA: '5', LOCUTOR_LIMITE_DIA: '7', LOCUTOR_CACHE_MAX: '9', LOCUTOR_COLA_MAX: '3', LOCUTOR_CALENTAR_AL_ARRANCAR: '1', LOCUTOR_MODELO: 'otro:1b' });
  check(e.limiteUsuarioHora === 5 && e.limiteDia === 7 && e.cacheMax === 9 && e.colaMax === 3 && e.calentarAlArrancar === true && e.modelo === 'otro:1b', 'todo por variable de entorno');
  for (const v of ['abc', '0', '-1', '1.5', '', null]) {
    const k = leerConfigServicio({ LOCUTOR_LIMITE_USUARIO_HORA: v, LOCUTOR_LIMITE_DIA: v, LOCUTOR_CACHE_MAX: v, LOCUTOR_COLA_MAX: v });
    check(k.limiteUsuarioHora === 60 && k.limiteDia === 1500 && k.cacheMax === 2000 && k.colaMax === 20, `inválido ${JSON.stringify(v)} → defecto`);
  }
  check(leerConfigServicio({ LOCUTOR_CALENTAR_AL_ARRANCAR: 'true' }).calentarAlArrancar === false, "solo '1' enciende calentar al arrancar");
  let ok = true; try { leerConfigServicio(null); leerConfigServicio(42); } catch { ok = false; }
  check(ok, 'leerConfigServicio no lanza con entradas raras');
}

await tick();
check(sinAtrapar.length === 0, 'ningún unhandledRejection ni excepción sin atrapar durante toda la prueba', sinAtrapar.map(String).join(' | '));

console.log(`\n${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
