// Límite de intentos por IP, EN MEMORIA y sin dependencias. Hoy lo usa solo el login con
// Google (api/auth.js).
//
// POR QUÉ ASÍ Y NO UNA LIBRERÍA: es un proceso, doce personas y una ruta. Una ventana fija
// por IP en un Map alcanza; lo que se pierde es que un reinicio del servidor vacía los
// contadores, y eso no le importa a nadie.
//
// VENTANA FIJA desde el primer intento: los primeros `max` pasan, del siguiente en adelante
// 429 hasta que la ventana vence. Cuenta TODAS las peticiones, las que salen bien también:
// lo que se limita es cuánto se golpea la ruta, no cuánto se falla.

// ¿De quién es la petición? Detrás del túnel, la conexión llega SIEMPRE desde cloudflared
// (o desde Traefik), así que la dirección del socket sería la misma para todo el mundo y
// el límite sería uno solo para toda la familia. La IP real la escribe Cloudflare en
// `CF-Connecting-IP`, y pisa la que traiga el cliente, así que por esa vía no se falsifica.
//
// ⚠️ LÍMITE CONOCIDO: el contenedor también es alcanzable directo por la red local (lo
// mismo que anota auth/cloudflare.js), y ahí el header lo pone quien pide. Desde adentro de
// la casa alguien podría rotarlo y saltarse el límite. Se acepta: el límite frena el abuso
// que llega por internet, que es el que pasa por Cloudflare.
function ipDe(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.socket?.remoteAddress ?? 'desconocida';
}

// Cuántas entradas se aguantan antes de barrer las vencidas. Barrer en cada petición
// sería recorrer el Map entero por nada; no barrer nunca, que el Map crezca sin tope.
const BARRER_DESDE = 1000;

export function limitePorIp({ max, ventanaMs, mensaje }) {
  const cubetas = new Map();

  return function limitar(req, res, next) {
    const ahora = Date.now();

    if (cubetas.size > BARRER_DESDE) {
      for (const [clave, c] of cubetas) if (c.hasta <= ahora) cubetas.delete(clave);
    }

    const clave = ipDe(req);
    let c = cubetas.get(clave);
    if (!c || c.hasta <= ahora) {
      c = { n: 0, hasta: ahora + ventanaMs };
      cubetas.set(clave, c);
    }
    c.n++;

    if (c.n > max) {
      res.set('Retry-After', String(Math.ceil((c.hasta - ahora) / 1000)));
      return res.status(429).json({ error: mensaje });
    }
    next();
  };
}
