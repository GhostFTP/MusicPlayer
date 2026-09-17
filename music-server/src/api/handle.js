import { UserError } from '../users/service.js';

// Traduce un UserError a su respuesta HTTP, y todo lo demás a un 500 genérico.
//
// Nació dentro de api/admin-users.js y salió acá cuando api/me.js necesitó lo mismo.
// Dos copias de esto no serían un detalle de estilo: la que importa es la rama de
// abajo —lo que NO es un UserError se loguea y sale como 500 sin cuerpo útil, porque
// un mensaje de SQLite en la respuesta le cuenta el esquema a quien pregunte—, y ese
// es justo el cuidado que se olvida al copiar.
//
// Envuelve funciones async: un throw dentro de una ruta async de Express NO lo
// atrapa Express 4, así que sin este try/catch quedaría una promesa rechazada suelta
// y la petición colgada hasta el timeout del cliente.
export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error('[api]', e);
      res.status(500).json({ error: 'Internal error' });
    }
  };
}
