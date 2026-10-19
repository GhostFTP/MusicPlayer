// Prueba del CLIENTE de Ollama del locutor (src/ia/ollama.js). Sin Ollama real: un servidor
// FALSO en node:http, en un puerto libre, con modos (ok, demora, 500, raw, enorme).
//
//   npm run test:locutor-ollama
//
// Sale con código 1 si algo falla, incluido cualquier unhandledRejection.
import http from 'node:http';
import { crearCliente, leerConfig } from '../src/ia/ollama.js';
import { ESQUEMA_RESPUESTA } from '../src/locutor/frase.js';

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Todo rechazo sin atrapar es una falla de la prueba.
const sinAtrapar = [];
process.on('unhandledRejection', (e) => sinAtrapar.push(e));
process.on('uncaughtException', (e) => sinAtrapar.push(e));

// ---------- Ollama falso ----------
const fake = { modo: 'ok', raw: '', demoraMs: 0, peticiones: [], escrito: 0, timers: new Set() };
const CONTENIDO_OK = '{"frase":"SECRETO-RESPUESTA"}';
const servidor = http.createServer((req, res) => {
  const trozos = [];
  req.on('data', (c) => trozos.push(c));
  req.on('end', () => {
    fake.peticiones.push({ method: req.method, url: req.url, headers: req.headers, bruto: Buffer.concat(trozos).toString('utf8') });
    const json = (status, cuerpo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(cuerpo); };
    switch (fake.modo) {
      case 'ok': return json(200, JSON.stringify({ message: { role: 'assistant', content: CONTENIDO_OK } }));
      case 'demora': {
        const t = setTimeout(() => { fake.timers.delete(t); if (!res.destroyed) json(200, JSON.stringify({ message: { content: CONTENIDO_OK } })); }, fake.demoraMs);
        fake.timers.add(t);
        res.on('close', () => { clearTimeout(t); fake.timers.delete(t); });
        return undefined;
      }
      case '500': return json(500, '{"error":"SECRETO-RESPUESTA"}');
      case 'raw': return json(200, fake.raw);
      case 'enorme': {
        // 20 MB en trozos de 16 KB, respetando la contrapresión; se detiene si el cliente corta.
        res.writeHead(200, { 'content-type': 'application/json' });
        const trozo = Buffer.alloc(16 * 1024, 97);
        let cerrado = false;
        let despertar = null;
        res.on('close', () => { cerrado = true; despertar?.(); });
        res.on('drain', () => despertar?.());
        (async () => {
          while (!cerrado && fake.escrito < 20 * 1024 * 1024) {
            fake.escrito += trozo.length;
            if (!res.write(trozo)) await new Promise((r) => { despertar = r; });
          }
          if (!cerrado) res.end();
        })();
        return undefined;
      }
      default: return json(200, '{}');
    }
  });
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const PUERTO = servidor.address().port;
const URL_FAKE = `http://127.0.0.1:${PUERTO}`;
const reset = (modo = 'ok') => { fake.modo = modo; fake.peticiones.length = 0; fake.escrito = 0; fake.demoraMs = 0; fake.raw = ''; };

const MSGS = [{ role: 'system', content: 'SECRETO-MENSAJE sistema' }, { role: 'user', content: 'SECRETO-MENSAJE usuario' }];
const envBase = { OLLAMA_URL: URL_FAKE, LOCUTOR_TIMEOUT_MS: '150', LOCUTOR_TIMEOUT_FRIO_MS: '3000' };
let reloj = 1_000_000;
const ahora = () => reloj;
const nuevo = (env = {}, extra = {}) => crearCliente({ env: { ...envBase, ...env }, ahora, ...extra });

// Intercepta el log para comprobar cuántas líneas salen y que no se cuele contenido.
const lineas = [];
const warnOriginal = console.warn;
const logOriginal = console.log;
const capturar = () => { lineas.length = 0; console.warn = (...a) => lineas.push(a.join(' ')); };
const soltar = () => { console.warn = warnOriginal; console.log = logOriginal; };

console.log('apagado');
for (const [etq, env] of [['ausente', {}], ['vacío', { OLLAMA_URL: '' }], ['solo espacios', { OLLAMA_URL: '   ' }]]) {
  reset();
  const c = crearCliente({ env, ahora });
  const g = await c.generar(MSGS);
  const k = await c.calentar();
  check(igual(g, { ok: false, motivo: 'apagado' }) && igual(k, { ok: false, motivo: 'apagado' }), `OLLAMA_URL ${etq}: apagado (generar y calentar)`);
  check(fake.peticiones.length === 0 && c.estado().encendido === false, `OLLAMA_URL ${etq}: 0 peticiones y encendido=false`);
}
{
  // Con la URL del falso en el entorno de OTRO cliente apagado, el falso sigue en 0.
  reset();
  await crearCliente({ env: { OLLAMA_URL: '' }, ahora }).generar(MSGS);
  check(fake.peticiones.length === 0, 'el servidor falso no recibió nada');
}

console.log('\npetición');
{
  reset();
  const c = nuevo({ OLLAMA_URL: URL_FAKE + '/', LOCUTOR_MODELO: 'otro:1b', LOCUTOR_KEEP_ALIVE: '10m' });
  const r = await c.generar(MSGS);
  const p = fake.peticiones[0];
  const body = JSON.parse(p.bruto);
  check(r.ok && r.texto === CONTENIDO_OK && typeof r.ms === 'number' && r.ms >= 0, 'éxito: { ok, texto, ms }');
  check(p.method === 'POST' && p.url === '/api/chat', 'POST /api/chat (sin // con barra final)', `${p.method} ${p.url}`);
  check(String(p.headers['content-type']).startsWith('application/json'), 'content-type json');
  check(body.model === 'otro:1b' && body.stream === false && body.think === false && body.keep_alive === '10m', 'model, stream:false, think:false, keep_alive');
  check(igual(body.format, ESQUEMA_RESPUESTA), 'format igual a ESQUEMA_RESPUESTA');
  check(igual(body.messages, MSGS), 'messages tal cual');
  check(body.options.temperature === 0.6 && body.options.num_predict === 80, 'options: temperature 0.6, num_predict 80');
  check(!('num_ctx' in body) && !('num_ctx' in body.options) && !p.bruto.includes('num_ctx'), 'NO lleva num_ctx');
  reset();
  const d = nuevo();
  await d.generar(MSGS);
  const b2 = JSON.parse(fake.peticiones[0].bruto);
  check(b2.model === 'gemma4:12b' && b2.keep_alive === '30m', 'defectos: gemma4:12b y 30m');
}

console.log('\nfallos de una petición (sin lanzar)');
{
  reset('demora'); fake.demoraMs = 2000;
  const t0 = Date.now();
  const r = await nuevo().generar(MSGS);
  check(igual(r, { ok: false, motivo: 'timeout' }) && Date.now() - t0 < 1500, 'servidor lento: timeout sin lanzar', JSON.stringify(r));
  reset('500');
  check(igual(await nuevo().generar(MSGS), { ok: false, motivo: 'http-500' }), 'HTTP 500 → http-500');
  reset('raw'); fake.raw = '{"message":';
  check(igual(await nuevo().generar(MSGS), { ok: false, motivo: 'json-invalido' }), 'JSON roto → json-invalido');
  for (const crudo of ['{}', '{"message":{}}', '{"message":{"content":5}}', '{"message":{"content":""}}', '{"message":{"content":"   "}}', '[]', 'null', '"hola"']) {
    reset('raw'); fake.raw = crudo;
    const r2 = await nuevo().generar(MSGS);
    check(igual(r2, { ok: false, motivo: 'forma-inesperada' }), `forma inesperada ${crudo}`, JSON.stringify(r2));
  }
  const cerrado = http.createServer();
  await new Promise((r) => cerrado.listen(0, '127.0.0.1', r));
  const puertoMuerto = cerrado.address().port;
  await new Promise((r) => cerrado.close(r));
  check(igual(await nuevo({ OLLAMA_URL: `http://127.0.0.1:${puertoMuerto}` }).generar(MSGS), { ok: false, motivo: 'red' }), 'conexión rechazada → red');
  reset('enorme');
  const g = await nuevo({ LOCUTOR_TIMEOUT_MS: '5000' }).generar(MSGS);
  await espera(150);
  check(igual(g, { ok: false, motivo: 'respuesta-grande' }), 'respuesta enorme → respuesta-grande', JSON.stringify(g));
  check(fake.escrito < 20 * 1024 * 1024, `se cortó la lectura (el servidor alcanzó a escribir ${(fake.escrito / 1024 / 1024).toFixed(1)} de 20 MB)`);
  for (const m of [null, undefined, [], 'hola', [{}], [{ role: 'user' }], [{ role: 1, content: 'x' }]]) {
    reset();
    const c = nuevo();
    const r3 = await c.generar(m);
    check(igual(r3, { ok: false, motivo: 'mensajes-invalidos' }) && fake.peticiones.length === 0 && c.estado().fallosSeguidos === 0, `mensajes inválidos ${JSON.stringify(m)}: sin petición ni fallo`);
  }
  const lanza = crearCliente({ env: envBase, ahora, fetch: () => { throw new Error('boom'); } });
  check(igual(await lanza.generar(MSGS), { ok: false, motivo: 'red' }), 'fetch que lanza de forma síncrona: red, sin lanzar');
  const rechaza = crearCliente({ env: envBase, ahora, fetch: () => Promise.reject(new Error('boom')) });
  check(igual(await rechaza.generar(MSGS), { ok: false, motivo: 'red' }), 'fetch que rechaza: red, sin lanzar');
  const rarito = crearCliente({ env: envBase, ahora, fetch: async () => undefined });
  check((await rarito.generar(MSGS)).ok === false, 'fetch que devuelve undefined: ok:false, sin lanzar');
}

console.log('\ncortacircuitos');
{
  reset('500');
  reloj = 5_000_000;
  const c = nuevo();
  capturar();
  const motivos = [];
  for (let i = 0; i < 3; i++) motivos.push((await c.generar(MSGS)).motivo);
  check(igual(motivos, ['http-500', 'http-500', 'http-500']), '3 fallos seguidos llegan al servidor');
  check(igual(c.estado(), { encendido: true, circuito: 'abierto', fallosSeguidos: 3 }), 'el circuito queda abierto', JSON.stringify(c.estado()));
  const antes = fake.peticiones.length;
  const r4 = await c.generar(MSGS);
  const k4 = await c.calentar();
  check(igual(r4, { ok: false, motivo: 'circuito-abierto' }) && igual(k4, { ok: false, motivo: 'circuito-abierto' }) && fake.peticiones.length === antes, 'abierto: generar y calentar NO llegan al servidor');

  reloj += 59_999;
  check((await c.generar(MSGS)).motivo === 'circuito-abierto' && c.estado().circuito === 'abierto' && fake.peticiones.length === antes, 'a 59 999 ms sigue abierto');
  reloj += 1;
  check(c.estado().circuito === 'semi', 'a 60 000 ms: semi-abierto');

  fake.modo = 'demora'; fake.demoraMs = 80;
  const [a, b] = await Promise.all([c.generar(MSGS), c.generar(MSGS)]);
  const resultados = [a, b];
  check(resultados.filter((r) => r.ok).length === 1 && resultados.filter((r) => r.motivo === 'circuito-abierto').length === 1, 'semi: UN solo intento de prueba; el simultáneo no pasa');
  check(fake.peticiones.length === antes + 1, 'semi: una sola petición llegó al servidor');
  check(igual(c.estado(), { encendido: true, circuito: 'cerrado', fallosSeguidos: 0 }), 'la prueba exitosa cierra y reinicia el contador', JSON.stringify(c.estado()));
  const salida = [...lineas];
  soltar();
  check(salida.length === 2 && /abierto/.test(salida[0]) && /cerrado/.test(salida[1]), 'log: exactamente una línea al abrirse y una al cerrarse', JSON.stringify(salida));
  check(!salida.some((l) => l.includes('SECRETO')), 'el log no incluye mensajes ni respuestas');
  capturar(); // el resto de las secciones abre y cierra circuitos sin ensuciar la salida

  // Una prueba que falla vuelve a abrir con otros 60 s.
  reset('500');
  for (let i = 0; i < 3; i++) await c.generar(MSGS);
  check(c.estado().circuito === 'abierto', 'se vuelve a abrir tras 3 fallos');
  reloj += 60_000;
  const prueba = await c.generar(MSGS);
  check(prueba.motivo === 'http-500' && c.estado().circuito === 'abierto', 'la prueba falla: vuelve a abrir');
  reloj += 59_999;
  check(c.estado().circuito === 'abierto', 'y con 60 s nuevos desde la prueba fallida');
}
{
  // Un éxito reinicia el contador.
  reset('500');
  const c = nuevo();
  await c.generar(MSGS); await c.generar(MSGS);
  fake.modo = 'ok';
  await c.generar(MSGS);
  check(c.estado().fallosSeguidos === 0, 'un éxito reinicia el contador');
  fake.modo = '500';
  await c.generar(MSGS); await c.generar(MSGS);
  check(c.estado().circuito === 'cerrado' && c.estado().fallosSeguidos === 2, '2 + éxito + 2 no abre el circuito');
}
{
  // Lo que no llegó a Ollama no suma.
  reset();
  const c = nuevo();
  for (let i = 0; i < 5; i++) await c.generar(null);
  const apagado = crearCliente({ env: {}, ahora });
  for (let i = 0; i < 5; i++) await apagado.generar(MSGS);
  check(c.estado().fallosSeguidos === 0 && apagado.estado().fallosSeguidos === 0 && apagado.estado().circuito === 'cerrado', 'apagado y mensajes-invalidos no suman fallos');
}

console.log('\ncalentar');
{
  reset('demora'); fake.demoraMs = 150;
  const c = nuevo();
  const p1 = c.calentar();
  const p2 = c.calentar();
  check(p1 === p2, 'dos llamadas simultáneas devuelven la misma promesa');
  const [r1, r2] = await Promise.all([p1, p2]);
  check(r1.ok && r2.ok && fake.peticiones.length === 1, 'una sola petición para las dos', `peticiones=${fake.peticiones.length}`);
  const b = JSON.parse(fake.peticiones[0].bruto);
  check(fake.peticiones[0].url === '/api/chat' && b.options.num_predict === 1 && b.stream === false && b.think === false && !('format' in b) , 'calentar: POST /api/chat con num_predict:1, sin format');
  await c.calentar();
  check(fake.peticiones.length === 2, 'terminada la anterior, otra llamada hace una petición nueva');
}
{
  // Usa el timeout FRÍO, no el normal (150 ms): el servidor tarda 400 ms.
  reset('demora'); fake.demoraMs = 400;
  const c = nuevo();
  check((await c.calentar()).ok, 'calentar usa LOCUTOR_TIMEOUT_FRIO_MS (tarda 400 ms con timeout normal de 150)');
  check((await c.generar(MSGS)).motivo === 'timeout', 'mientras que generar sí vence con el timeout normal');
}
{
  // Mientras se calienta, generar() no llama a Ollama ni suma fallos.
  reset('demora'); fake.demoraMs = 400;
  const c = nuevo();
  const caliente = c.calentar();
  await espera(60);
  const n0 = fake.peticiones.length;
  const f0 = c.estado().fallosSeguidos;
  const g = await c.generar(MSGS);
  check(igual(g, { ok: false, motivo: 'calentando' }), "mientras calentar() está en curso: generar() → 'calentando'");
  check(fake.peticiones.length === n0 && n0 === 1, 'ninguna petición HTTP extra (el falso sigue en 1: la de calentar)', `peticiones=${fake.peticiones.length}`);
  check(c.estado().fallosSeguidos === f0 && f0 === 0, 'fallosSeguidos sin cambio');
  for (let i = 0; i < 5; i++) await c.generar(MSGS);
  check(c.estado().circuito === 'cerrado' && c.estado().fallosSeguidos === 0, "varias 'calentando' seguidas tampoco abren el circuito");
  check((await caliente).ok, 'calentar termina bien');
  fake.modo = 'ok';
  const despues = await c.generar(MSGS);
  check(despues.ok === true, 'al terminar calentar(), generar() vuelve a funcionar normal');
}
{
  // El resultado de calentar() cuenta para el cortacircuitos.
  reset('500');
  const c = nuevo();
  await c.calentar(); await c.calentar(); await c.calentar();
  check(c.estado().circuito === 'abierto' && c.estado().fallosSeguidos === 3, 'fallos de calentar() suman y abren el circuito');
  reloj += 60_000;
  fake.modo = 'ok';
  check((await c.calentar()).ok && c.estado().circuito === 'cerrado', 'un calentar() exitoso cierra el circuito');
}

console.log('\nconfiguración');
{
  const d = leerConfig({});
  check(d.url === null && d.modelo === 'gemma4:12b' && d.keepAlive === '30m' && d.timeoutMs === 8000 && d.timeoutFrioMs === 150000, 'defectos', JSON.stringify(d));
  for (const v of ['abc', '-5', '0', '1.5', '', ' ', '1e3', 'NaN', null, undefined, {}, [], -1, 0, 1.5, NaN]) {
    const k = leerConfig({ LOCUTOR_TIMEOUT_MS: v, LOCUTOR_TIMEOUT_FRIO_MS: v });
    check(k.timeoutMs === 8000 && k.timeoutFrioMs === 150000, `timeouts ${JSON.stringify(v)} → defecto`);
  }
  check(leerConfig({ LOCUTOR_TIMEOUT_MS: ' 500 ', LOCUTOR_TIMEOUT_FRIO_MS: 900 }).timeoutMs === 500 && leerConfig({ LOCUTOR_TIMEOUT_FRIO_MS: 900 }).timeoutFrioMs === 900, 'valores válidos (texto con espacios o número)');
  for (const v of ['rápido', '10', 'm', '1.5h', '', 5]) check(leerConfig({ LOCUTOR_KEEP_ALIVE: v }).keepAlive === '30m', `keep_alive ${JSON.stringify(v)} → defecto`);
  check(leerConfig({ LOCUTOR_KEEP_ALIVE: '-1' }).keepAlive === '-1' && leerConfig({ LOCUTOR_KEEP_ALIVE: '2h' }).keepAlive === '2h', 'keep_alive válido: -1 y 2h');
  for (const v of ['', '   ', 5, null]) check(leerConfig({ LOCUTOR_MODELO: v }).modelo === 'gemma4:12b', `modelo ${JSON.stringify(v)} → defecto`);
  check(leerConfig({ LOCUTOR_MODELO: 'x'.repeat(101) }).modelo === 'gemma4:12b', 'modelo de más de 100 caracteres → defecto');
  capturar();
  for (const v of ['ftp://x', 'no es url', 'javascript:1', 'file:///etc/passwd']) {
    const k = leerConfig({ OLLAMA_URL: v });
    check(k.url === null && k.urlInvalida === true, `OLLAMA_URL ${JSON.stringify(v)} → apagado`);
  }
  soltar();
  check(leerConfig({ OLLAMA_URL: 'http://ollama:11434/' }).url === 'http://ollama:11434', 'URL http válida, sin barra final');
  check(leerConfig({ OLLAMA_URL: 'https://x.y/z//' }).url === 'https://x.y/z', 'https con ruta');
  for (const e of [null, undefined, 42, 'texto', [], { OLLAMA_URL: 5 }]) {
    let ok = true; try { leerConfig(e); } catch { ok = false; }
    check(ok, `leerConfig(${JSON.stringify(e)}) no lanza`);
  }
  capturar();
  const inv = crearCliente({ env: { OLLAMA_URL: 'ftp://x' }, ahora });
  soltar();
  check(lineas.length === 1 && !lineas[0].includes('ftp'), 'URL inválida: una línea de aviso, sin imprimir el valor', JSON.stringify(lineas));
  check(inv.estado().encendido === false && (await inv.generar(MSGS)).motivo === 'apagado', 'URL inválida: apagado');
}

// ---------- cierre ----------
for (const t of fake.timers) clearTimeout(t);
servidor.closeAllConnections?.();
await new Promise((r) => servidor.close(r));
await espera(200); // deja pasar cualquier rechazo tardío
check(sinAtrapar.length === 0, 'ningún unhandledRejection ni excepción sin atrapar durante toda la prueba', sinAtrapar.map(String).join(' | '));

soltar();
console.log(`\n${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
