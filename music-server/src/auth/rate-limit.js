// Límites de intentos, EN MEMORIA y sin dependencias. Dos sabores, los dos en api/auth.js:
//   · limitePorIp     — cuenta TODAS las peticiones de una IP. Lo usa el login con Google.
//   · limiteDeFallos  — cuenta sólo los FALLOS de una clave (IP o cuenta) y un acierto la
//                       borra. Lo usa el login con contraseña (1.37.1), más abajo.
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
  return ipDeCloudflare(req) ?? req.socket?.remoteAddress ?? 'desconocida';
}

// La IP que escribió Cloudflare, o `null` si la petición no la trae. SIN caer al socket, a
// diferencia de ipDe: el login con contraseña necesita saber que falta, porque contar por
// el socket ahí sería contar a todo el mundo junto (ver api/auth.js).
export function ipDeCloudflare(req) {
  const cf = req.headers['cf-connecting-ip'];
  return typeof cf === 'string' && cf.trim() ? cf.trim() : null;
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

// ---- Límite de FALLOS (1.37.1) ----
//
// No es un middleware, porque quien sabe si el intento falló es la ruta, después de comparar
// la contraseña. Son tres llamadas que la ruta hace en orden:
//   · bloqueado(clave) → segundos que faltan para que venza la ventana, o 0 si no lo está.
//   · intento(clave)   → suma uno ANTES de comparar.
//   · acierto(clave)   → borra la clave: un login correcto la deja en cero.
//
// SE SUMA ANTES DE COMPARAR, Y NO AL FALLAR, por la concurrencia. bcrypt tarda ~200 ms y es
// asíncrono: si el fallo se anotara al terminar, cien peticiones en paralelo pasarían todas
// por bloqueado() con el contador en cero antes de que la primera anotara nada, y el límite
// no frenaría nada. Sumando antes —en el mismo tick que el bloqueado(), sin un await en el
// medio— la undécima ya ve diez. Como el acierto borra la clave, en la cuenta sólo quedan
// los fallos, que es lo que se quiere contar.
//
// VENTANA FIJA desde el primer fallo, y un bloqueado NO suma: la ventana no se estira por
// seguir golpeando, vence cuando venció. Mientras dura, un acierto no llega a comparar (la
// ruta devuelve 429 antes), así que tampoco desbloquea: si desbloqueara, el atacante sólo
// tendría que seguir probando hasta acertar.
//
// `ahora` entra como parámetro sólo para que las pruebas puedan saltar la ventana sin
// esperar quince minutos; en producción es siempre Date.now().
export function limiteDeFallos({ max, ventanaMs }) {
  const cubetas = new Map();

  function vigente(clave, ahora) {
    const c = cubetas.get(clave);
    if (c && c.hasta <= ahora) { cubetas.delete(clave); return null; }
    return c ?? null;
  }

  return {
    bloqueado(clave, ahora = Date.now()) {
      const c = vigente(clave, ahora);
      return c && c.n >= max ? Math.ceil((c.hasta - ahora) / 1000) : 0;
    },
    intento(clave, ahora = Date.now()) {
      if (cubetas.size > BARRER_DESDE) {
        for (const [k, c] of cubetas) if (c.hasta <= ahora) cubetas.delete(k);
      }
      let c = vigente(clave, ahora);
      if (!c) {
        c = { n: 0, hasta: ahora + ventanaMs };
        cubetas.set(clave, c);
      }
      c.n++;
    },
    acierto(clave) {
      cubetas.delete(clave);
    },
  };
}
