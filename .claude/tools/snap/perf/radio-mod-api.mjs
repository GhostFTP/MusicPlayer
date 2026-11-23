// radio-mod-api.mjs — la MODERACIÓN de la radio (1.45.0) por HTTP real, contra el backend de la corrida
// (SNAP_BASE: el preview :4173 del runner, que pasa /api al backend :3100 sobre la copia de la base; o el
// backend directo). Solo API: no abre navegador.
//
// TRES CUENTAS, todas por el mismo POST /api/auth/login que la app (nunca se fabrican tokens):
//   · anfitrión  SNAP_USER / SNAP_PASS (o el .env de snap, como todos los scripts)
//   · B          SNAP2_USER / SNAP2_PASS — la oyente que el anfitrión hace moderadora
//   · C          SNAP3_USER / SNAP3_PASS — otra oyente (sin rol, después moderadora para los topes)
// Hasta que el runner cree la tercera cuenta (S5), se corre a mano con las tres por entorno.
//
// Qué cubre: sin sesión (401) · el GET y el PUT sin pedir nada (las claves de 1.42.0) · a pedido
// (?cap=mod, ?desde=) · userId y desde inválidos (400) · nombrar y quitar (403 sin-permiso, 409
// es-el-anfitrion / no-escucha / sin-soporte) · una moderadora no publica el estado (403) · dos radios
// vivas a la vez: el rol no cruza de una a otra (403 sin-permiso) · órdenes (202, repetida, 403, 400, 422 sin-pista y
// video, 409 obsoleta) · cuerpo de más de 512 bytes (413) · confirmación y eventos con nombres y
// título · solo el anfitrión ve las órdenes · quitar borra lo pendiente · topes (409 ordenes-llenas,
// 429 con Retry-After) · una radio creada sin capabilities (409 sin-soporte, como la app de iOS) ·
// orden a una radio terminada (410).
//
// Lo que NO cubre (está en npm run test:radio, con el reloj inyectado): el TTL de las órdenes y los
// idCliente, moderadores-llenos (hacen falta 4 oyentes) y la ventana de eventos perdidos.
// Uso: SNAP_BASE=http://localhost:4173 SNAP_USER=… SNAP_PASS=… SNAP2_USER=… SNAP2_PASS=… SNAP3_USER=… SNAP3_PASS=… node radio-mod-api.mjs
import { getToken, BASE } from '../session.mjs';

const T0 = Date.now();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try { if (!(await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(5_000) })).ok) throw new Error('no 200'); }
catch (e) { console.error(`[radio-mod-api] no responde ${BASE}/api/health (${e.message})`); process.exit(1); }

async function entrar(u, p, cual) {
  if (!u || !p) { console.error(`[radio-mod-api] faltan ${cual}_USER/${cual}_PASS`); process.exit(1); }
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json().catch(() => ({}));
  if (!j.token) { console.error(`[radio-mod-api] no entra la cuenta ${cual}`); process.exit(1); }
  return j.token;
}
const tA = await getToken();
const tB = await entrar(process.env.SNAP2_USER, process.env.SNAP2_PASS, 'SNAP2');
const tC = await entrar(process.env.SNAP3_USER, process.env.SNAP3_PASS, 'SNAP3');

/** `crudo`: un cuerpo ya serializado. `tok: null`: sin sesión. */
async function api(tok, method, path, body, { crudo } = {}) {
  const hay = body !== undefined || crudo !== undefined;
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(hay ? { 'Content-Type': 'application/json' } : {}) },
    ...(hay ? { body: crudo ?? JSON.stringify(body) } : {}),
  });
  const texto = await r.text();
  let j = null; try { j = texto ? JSON.parse(texto) : null; } catch { /* no es JSON */ }
  return { status: r.status, j, texto, retry: r.headers.get('retry-after') };
}
const yo = async (tok) => (await api(tok, 'GET', '/api/me')).j;
const [uA, uB, uC] = [await yo(tA), await yo(tB), await yo(tC)];
const idDe = (u) => u?.id ?? u?.user?.id;
const [A, B, C] = [idDe(uA), idDe(uB), idDe(uC)];
if (![A, B, C].every(Number.isInteger) || new Set([A, B, C]).size !== 3) { console.error('[radio-mod-api] hacen falta tres cuentas distintas', [A, B, C]); process.exit(1); }

// Tres canciones de la base: una suena, otra se ordena, la tercera hace "obsoleta" la orden vieja.
const pistas = (await api(tA, 'GET', '/api/tracks')).j;
const lista = Array.isArray(pistas) ? pistas : pistas?.tracks ?? [];
const [P1, P2, P3] = lista.slice(0, 3);
if (!P3) { console.error('[radio-mod-api] hacen falta 3 canciones en la base'); process.exit(1); }

let nCli = 0;
const cli = () => `mod${Date.now().toString(36)}${++nCli}`.slice(0, 24);
/** Crea una radio del anfitrión; si el tope de creaciones por minuto (otros scripts) la frena, espera. */
async function crear(body) {
  for (let i = 0; i < 3; i++) {
    const r = await api(tA, 'POST', '/api/radio', body);
    if (r.status !== 429) return r;
    await sleep((Number(r.retry) || 10) * 1000 + 200);
  }
  return api(tA, 'POST', '/api/radio', body);
}
const orden = (tok, code, body) => api(tok, 'POST', `/api/radio/${code}/ordenes`, body);
const mod = (tok, method, code, id) => api(tok, method, `/api/radio/${code}/moderadores/${id}`);
const CLAVES_142 = ['serverNow', 'code', 'status', 'state', 'host', 'listeners'];
const MODERACION = /moderat|capabilit|events|orders/i;
let code;
let codeC = null;   // la radio de C (dos radios vivas a la vez, sección 8)

try {
  // ---- 1. Sin sesión: 401 en las rutas nuevas ----
  const sin = await Promise.all([
    api(null, 'PUT', '/api/radio/ABCDEF/moderadores/5'),
    api(null, 'DELETE', '/api/radio/ABCDEF/moderadores/5'),
    api(null, 'POST', '/api/radio/ABCDEF/ordenes', { type: 'pausa', clientId: 'sin-sesion' }),
    api(null, 'GET', '/api/radio/ABCDEF?cap=mod&desde=0'),
  ]);
  ok('sin sesión: 401 en moderadores (PUT y DELETE), órdenes y el GET a pedido', sin.every((r) => r.status === 401), { status: sin.map((r) => r.status) });

  // ---- 2. Una radio que ejecuta órdenes; lo de siempre sin pedir nada ----
  const c = await crear({ capabilities: { orders: true } });
  code = c.j?.code;
  ok('crear con capabilities: 201, la respuesta de 1.42.0', c.status === 201 && igual(Object.keys(c.j), ['code', 'serverNow', 'status']), { status: c.status });
  const pub = await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P1.id, positionMs: 1000, playing: true });
  ok('PUT /state sin confirmación: las claves de 1.42.0', pub.status === 200 && igual(Object.keys(pub.j), ['serverNow', 'status', 'state']), { status: pub.status, claves: Object.keys(pub.j ?? {}) });
  const gB = await api(tB, 'GET', `/api/radio/${code}`);
  const gA = await api(tA, 'GET', `/api/radio/${code}`);
  ok('GET sin pedir nada (oyente y anfitrión): las claves de 1.42.0 y ni una palabra de moderación',
    [gB, gA].every((g) => g.status === 200 && igual(Object.keys(g.j), CLAVES_142) && !MODERACION.test(g.texto)), { claves: Object.keys(gB.j ?? {}) });

  // ---- 3. A pedido ----
  const mB = await api(tB, 'GET', `/api/radio/${code}?cap=mod`);
  ok('?cap=mod: moderators, capabilities, events, eventsUntil y eventsLost, sin orders (no es el anfitrión)',
    mB.status === 200 && igual(Object.keys(mB.j), [...CLAVES_142, 'moderators', 'capabilities', 'events', 'eventsUntil', 'eventsLost'])
    && igual(mB.j.capabilities, { orders: true }) && igual(mB.j.moderators, []) && mB.j.eventsLost === false, { claves: Object.keys(mB.j ?? {}) });
  const dA = await api(tA, 'GET', `/api/radio/${code}?desde=0`);
  ok('?desde=0 del anfitrión: además, orders', dA.status === 200 && Array.isArray(dA.j.orders) && dA.j.orders.length === 0);
  const malos = await Promise.all(['x', '-1', '1.5', '1e3'].map((v) => api(tB, 'GET', `/api/radio/${code}?desde=${v}`)));
  const doble = await api(tB, 'GET', `/api/radio/${code}?desde=1&desde=2`);
  ok('?desde= que no es un entero ≥ 0 (o repetido): 400', [...malos, doble].every((r) => r.status === 400), { status: [...malos, doble].map((r) => r.status) });

  // ---- 4. Nombrar y quitar ----
  const noEntero = await Promise.all(['abc', '0', '1.5', '-3', '007'].map((v) => mod(tA, 'PUT', code, v)));
  ok('userId que no es un entero > 0: 400', noEntero.every((r) => r.status === 400), { status: noEntero.map((r) => r.status) });
  const propio = await mod(tA, 'PUT', code, A);
  ok('el anfitrión nombrándose: 409 es-el-anfitrion', propio.status === 409 && propio.j?.reason === 'es-el-anfitrion', { status: propio.status, j: propio.j });
  await api(tC, 'GET', `/api/radio/${code}?cap=mod`);
  const deOyente = await mod(tB, 'PUT', code, C);
  ok('una oyente que nombra a otra: 403 sin-permiso (no "no es tuya")', deOyente.status === 403 && deOyente.j?.reason === 'sin-permiso' && !/no es tuya/i.test(deOyente.texto), { j: deOyente.j });
  const quitarDeOyente = await mod(tB, 'DELETE', code, C);
  ok('una oyente que quita el rol: 403 sin-permiso', quitarDeOyente.status === 403 && quitarDeOyente.j?.reason === 'sin-permiso');
  const nadie = await mod(tA, 'PUT', code, 999_999_999);
  ok('nombrar a quien no está escuchando: 409 no-escucha', nadie.status === 409 && nadie.j?.reason === 'no-escucha', { j: nadie.j });
  await api(tC, 'GET', `/api/radio/${code}`);   // C vuelve a preguntar SIN ?cap=mod: su cliente "no sabe moderar"
  const viejo = await mod(tA, 'PUT', code, C);
  ok('nombrar a quien escucha desde un cliente que no sabe moderar: 409 sin-soporte', viejo.status === 409 && viejo.j?.reason === 'sin-soporte', { j: viejo.j });
  await api(tB, 'GET', `/api/radio/${code}?cap=mod`);
  const nb = await mod(tA, 'PUT', code, B);
  ok('el anfitrión nombra a B: 200 con moderators (id, nombre, avatar) y su nombre',
    nb.status === 200 && igual(Object.keys(nb.j), ['serverNow', 'moderators', 'name']) && nb.j.moderators.length === 1
    && nb.j.moderators[0].id === B && typeof nb.j.moderators[0].name === 'string' && 'avatar' in nb.j.moderators[0] && nb.j.name === nb.j.moderators[0].name,
    { j: nb.j });
  const otraVez = await mod(tA, 'PUT', code, B);
  ok('nombrarla otra vez: 200, igual', otraVez.status === 200 && otraVez.j.moderators.length === 1);
  // Moderar no es publicar: el estado lo publica solo el anfitrión (403, el "no es tuya" de 1.42.0).
  const pubB = await api(tB, 'PUT', `/api/radio/${code}/state`, { trackId: P2.id, positionMs: 0, playing: true });
  const sigue = (await api(tA, 'GET', `/api/radio/${code}`)).j?.state;
  ok('una moderadora que publica el estado: 403, y lo publicado no cambia', pubB.status === 403 && sigue?.trackId === P1.id,
    { status: pubB.status, j: pubB.j, trackId: sigue?.trackId });

  // ---- 5. Órdenes ----
  const deC = await orden(tC, code, { type: 'pausa', clientId: cli() });
  ok('una oyente sin rol que ordena: 403 sin-permiso', deC.status === 403 && deC.j?.reason === 'sin-permiso', { j: deC.j });
  const grande = await api(tB, 'POST', `/api/radio/${code}/ordenes`, undefined, { crudo: JSON.stringify({ type: 'pausa', clientId: 'grande1', relleno: 'x'.repeat(600) }) });
  ok('un cuerpo de más de 512 bytes: 413 en JSON', grande.status === 413 && typeof grande.j?.error === 'string', { status: grande.status });
  const mal = await Promise.all([
    orden(tB, code, { type: 'saltar', clientId: cli() }),
    orden(tB, code, { type: 'pausa' }),
    orden(tB, code, { type: 'siguiente', clientId: cli() }),
    orden(tB, code, { type: 'ahora', trackId: '7', clientId: cli() }),
  ]);
  ok('una orden mal formada (tipo, clientId, seqBase, trackId): 400', mal.every((r) => r.status === 400), { status: mal.map((r) => r.status), e: mal.map((r) => r.j?.error) });
  ok('el error del clientId nombra el campo como viaja', /clientId/.test(mal[1].j?.error ?? '') && !/idCliente/.test(mal[1].j?.error ?? ''), { e: mal[1].j?.error });
  const X = cli();
  const p1 = await orden(tB, code, { type: 'pausa', clientId: X });
  ok('B ordena pausa: 202 con id y repeated false', p1.status === 202 && igual(Object.keys(p1.j), ['id', 'repeated', 'serverNow']) && p1.j.repeated === false && Number.isInteger(p1.j.id), { j: p1.j });
  const p2 = await orden(tB, code, { type: 'pausa', clientId: X });
  ok('el mismo clientId otra vez: 202, el mismo id y repeated true', p2.status === 202 && p2.j.id === p1.j.id && p2.j.repeated === true, { j: p2.j });
  const fantasma = await orden(tB, code, { type: 'ahora', trackId: 2_000_000_000, clientId: cli() });
  ok('una canción que no existe: 422 sin-pista', fantasma.status === 422 && fantasma.j?.reason === 'sin-pista', { j: fantasma.j });
  const videos = await Promise.all([
    orden(tB, code, { type: 'ahora', trackId: '0123456789abcdef', clientId: cli() }),
    orden(tB, code, { type: 'a-continuacion', trackId: P2.id, kind: 'video', clientId: cli() }),
  ]);
  ok('un video (su id de 16 hex, o kind:"video"): 422 video', videos.every((r) => r.status === 422 && r.j?.reason === 'video'), { j: videos.map((r) => r.j) });
  const p3 = await orden(tB, code, { type: 'a-continuacion', trackId: P2.id, clientId: cli() });
  ok('B pone una canción a continuación: 202', p3.status === 202, { j: p3.j });
  const hA = await api(tA, 'GET', `/api/radio/${code}?desde=0`);
  ok('el anfitrión ve 2 órdenes (lo rechazado no entró), con tipo, quién y el título de la base',
    igual(hA.j?.orders?.map((o) => [o.id, o.type, o.by]), [[p1.j.id, 'pausa', B], [p3.j.id, 'a-continuacion', B]])
    && hA.j.orders[1].title === P2.title && hA.j.orders[1].trackBase === P1.id && hA.j.orders[0].title === null, { orders: hA.j?.orders });
  ok('las órdenes llevan solo id, type, trackId, seqBase, trackBase, by y title', igual(Object.keys(hA.j.orders[0]), ['id', 'type', 'trackId', 'seqBase', 'trackBase', 'by', 'title']));
  const vB = await api(tB, 'GET', `/api/radio/${code}?cap=mod&desde=0`);
  ok('la moderadora no ve las órdenes (ni con ?desde=)', vB.status === 200 && !('orders' in vB.j));

  // "siguiente" sobre la canción que veía: si ya empezó otra, obsoleta.
  const seqVisto = vB.j.state.seq;
  await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P3.id, positionMs: 0, playing: true });
  const vieja = await orden(tB, code, { type: 'siguiente', seqBase: seqVisto, clientId: cli() });
  ok('siguiente sobre una canción que ya cambió: 409 obsoleta', vieja.status === 409 && vieja.j?.reason === 'obsoleta', { j: vieja.j });
  const actual = (await api(tB, 'GET', `/api/radio/${code}?cap=mod`)).j.state.seq;
  const sig = await orden(tB, code, { type: 'siguiente', seqBase: actual, clientId: cli() });
  ok('siguiente sobre la que suena: 202', sig.status === 202, { j: sig.j });

  // ---- 6. Confirmación y eventos ----
  const antes = (await api(tB, 'GET', `/api/radio/${code}?cap=mod&desde=0`)).j;
  ok('el evento de nombrarla: moderador, por el anfitrión, con los dos nombres',
    antes.events.length === 1 && antes.events[0].type === 'moderador' && antes.events[0].by === A && antes.events[0].target === B
    && antes.events[0].byName === gA.j.host.name && antes.events[0].targetName === nb.j.name
    && igual(Object.keys(antes.events[0]), ['id', 'type', 'by', 'byName', 'target', 'targetName', 'trackId', 'title', 'at']), { events: antes.events });
  const conf = await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P3.id, positionMs: 5000, playing: false, ordenHasta: p3.j.id, aplicadas: [p1.j.id, p3.j.id] });
  ok('PUT /state con confirmación: 200 y las que quedan en orders (la "siguiente")',
    conf.status === 200 && igual(conf.j.orders?.map((o) => o.id), [sig.j.id]), { status: conf.status, orders: conf.j?.orders });
  const ev = (await api(tB, 'GET', `/api/radio/${code}?cap=mod&desde=${antes.eventsUntil}`)).j;
  ok('con ?desde=: solo lo nuevo, las dos aplicadas con el nombre de B y el título',
    igual(ev.events.map((e) => [e.type, e.by, e.trackId]), [['pausa', B, null], ['a-continuacion', B, P2.id]])
    && ev.events.every((e) => e.byName === nb.j.name) && ev.events[1].title === P2.title && ev.eventsUntil === antes.eventsUntil + 2, { events: ev.events });
  const malConf = await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P3.id, positionMs: 0, playing: true, ordenHasta: 'x' });
  ok('una confirmación inválida: 400', malConf.status === 400, { j: malConf.j });

  // ---- 7. Quitar borra lo pendiente ----
  const q = await mod(tA, 'DELETE', code, B);
  ok('el anfitrión le quita el rol: 200, moderators vacío y su nombre', q.status === 200 && igual(q.j.moderators, []) && q.j.name === nb.j.name, { j: q.j });
  const trasQuitar = (await api(tA, 'GET', `/api/radio/${code}?desde=0`)).j;
  ok('su "siguiente" pendiente se borró, y quedó el evento sin-moderador',
    trasQuitar.orders.length === 0 && trasQuitar.events.at(-1).type === 'sin-moderador' && trasQuitar.events.at(-1).target === B);
  const ya = await orden(tB, code, { type: 'pausa', clientId: cli() });
  ok('sin el rol ya no ordena: 403 sin-permiso', ya.status === 403 && ya.j?.reason === 'sin-permiso');
  const deNuevo = await mod(tA, 'DELETE', code, B);
  ok('quitárselo a quien no lo tiene: 200 con name null', deNuevo.status === 200 && deNuevo.j.name === null);

  // ---- 8. Topes, en una radio nueva (la anterior queda reemplazada) ----
  const c2 = await crear({ capabilities: { orders: true } });
  const viejaCode = code;
  code = c2.j?.code;
  const aLaVieja = await orden(tB, viejaCode, { type: 'pausa', clientId: cli() });
  ok('una orden a la radio reemplazada: 410', aLaVieja.status === 410, { status: aLaVieja.status });
  await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P1.id, positionMs: 0, playing: true });
  await api(tB, 'GET', `/api/radio/${code}?cap=mod`);
  await api(tC, 'GET', `/api/radio/${code}?cap=mod`);
  const dos = [await mod(tA, 'PUT', code, B), await mod(tA, 'PUT', code, C)];
  ok('en la radio nueva hay que volver a nombrar (B y C)', dos.every((r) => r.status === 200) && dos[1].j.moderators.length === 2);
  // Dos radios vivas a la vez: C abre la suya (sigue moderando la de A). B, moderadora de la de A, la
  // escucha desde un cliente que sabe moderar y le ordena: el rol es de UNA radio, no de la cuenta.
  const cC = await api(tC, 'POST', '/api/radio', { capabilities: { orders: true } });
  codeC = cC.j?.code;
  await api(tC, 'PUT', `/api/radio/${codeC}/state`, { trackId: P1.id, positionMs: 0, playing: true });
  await api(tB, 'GET', `/api/radio/${codeC}?cap=mod`);
  const cruzada = await orden(tB, codeC, { type: 'pausa', clientId: cli() });
  const enC = (await api(tC, 'GET', `/api/radio/${codeC}?desde=0`)).j;
  const deA = (await api(tA, 'GET', `/api/radio/${code}?cap=mod`)).j;
  ok('dos radios vivas: la moderadora de una que le ordena a la otra recibe 403 sin-permiso',
    cC.status === 201 && cruzada.status === 403 && cruzada.j?.reason === 'sin-permiso' && igual(enC?.orders, []) && igual(enC?.moderators, [])
    && deA?.status === 'live' && deA.moderators.length === 2,
    { crear: cC.status, status: cruzada.status, j: cruzada.j, ordenesEnC: enC?.orders, vivaA: deA?.status });
  await api(tC, 'DELETE', `/api/radio/${codeC}`);
  codeC = null;
  const serie = [];
  for (let i = 0; i < 5; i++) serie.push(await orden(tB, code, { type: 'pausa', clientId: cli() }));
  for (let i = 0; i < 5; i++) serie.push(await orden(tC, code, { type: 'reanudar', clientId: cli() }));
  const llena = await orden(tC, code, { type: 'pausa', clientId: cli() });
  ok('10 pendientes entre las dos y la siguiente: 409 ordenes-llenas', serie.every((r) => r.status === 202) && llena.status === 409 && llena.j?.reason === 'ordenes-llenas',
    { status: [...serie, llena].map((r) => r.status) });
  const rafaga = [];
  for (let i = 0; i < 6; i++) rafaga.push(await orden(tB, code, { type: 'pausa', clientId: cli() }));
  const ult = rafaga.at(-1);
  ok('la orden 11 de la misma persona en la ventana: 429 con Retry-After', ult.status === 429 && Number(ult.retry) >= 1 && rafaga.slice(0, -1).every((r) => r.status === 409),
    { status: rafaga.map((r) => r.status), retry: ult.retry });

  // ---- 9. Una radio creada SIN capabilities (un anfitrión de iOS) ----
  const c3 = await crear(undefined);
  code = c3.j?.code;
  await api(tA, 'PUT', `/api/radio/${code}/state`, { trackId: P1.id, positionMs: 0, playing: true });
  const v3 = await api(tB, 'GET', `/api/radio/${code}?cap=mod`);
  ok('sin capabilities: capabilities.orders false', c3.status === 201 && igual(v3.j?.capabilities, { orders: false }), { status: c3.status, cap: v3.j?.capabilities });
  const n3 = await mod(tA, 'PUT', code, B);
  const o3 = await orden(tB, code, { type: 'pausa', clientId: cli() });
  ok('se puede nombrar, pero una orden da 409 sin-soporte', n3.status === 200 && o3.status === 409 && o3.j?.reason === 'sin-soporte', { n: n3.status, j: o3.j });
  const raro = await crear({ capabilities: { orders: 'true' } });
  code = raro.j?.code;
  const vr = await api(tB, 'GET', `/api/radio/${code}?cap=mod`);
  ok('capabilities con un "true" en texto: como sin capabilities', raro.status === 201 && igual(vr.j?.capabilities, { orders: false }));

  // ---- 10. Lo de 1.42.0 sigue igual ----
  const fin = await api(tA, 'DELETE', `/api/radio/${code}`);
  ok('DELETE: la respuesta de 1.42.0', fin.status === 200 && igual(Object.keys(fin.j), ['serverNow', 'status', 'endedReason']));
  const term = await api(tB, 'GET', `/api/radio/${code}`);
  ok('GET de una terminada sin pedir nada: las claves de 1.42.0', term.status === 200 && igual(Object.keys(term.j), ['serverNow', 'code', 'status', 'endedReason', 'state', 'host', 'listeners']));
  code = null;
} catch (e) {
  ok('el script no se cortó', false, { error: String(e?.stack ?? e).slice(0, 400) });
} finally {
  if (code) await api(tA, 'DELETE', `/api/radio/${code}`).catch(() => {});
  if (codeC) await api(tC, 'DELETE', `/api/radio/${codeC}`).catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\n[radio-mod-api] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-mod-api: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
