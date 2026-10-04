// Caché en memoria de las listas de las vistas (Frente 1, sub-paso 5): stale-while-revalidate.
//
// Al volver a una vista ya visitada (Biblioteca, Álbumes) se pinta al instante con lo cacheado y se
// revalida en segundo plano. Sólo vive en memoria (se pierde al recargar) y es POR USUARIO:
//
//   · Cada entrada pertenece al usuario del JWT vigente (id del payload). Si al leer el usuario no
//     es el dueño de la caché, se vacía ENTERA antes de devolver nada → una cuenta nunca ve la
//     biblioteca de otra, aunque nadie haya llamado a clearViewCache().
//   · Una revalidación que arrancó con un usuario y termina con otro se DESCARTA (no escribe ni
//     devuelve datos): ése es el agujero clásico por el que se filtran datos entre cuentas.
//   · clearViewCache() además se llama en login, en cada 401 (client.js) y al desmontar Layout
//     (cerrar sesión).

let owner = null;            // usuario dueño de lo cacheado
const store = new Map();     // key → { data, sig }

// Id del usuario del JWT guardado (payload base64url). null = sin sesión.
function currentUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(b64));
    return p.id != null ? `id:${p.id}` : (p.username ? `u:${p.username}` : null);
  } catch {
    return null;
  }
}

export function clearViewCache() {
  store.clear();
  owner = null;
}

// Firma barata para "¿cambió algo?": el JSON de la respuesta. Ante cualquier diferencia en
// cualquier campo, la vista se actualiza; si es idéntica, no se hace setState (no se re-renderizan
// las filas por una revalidación sin cambios).
export function signatureOf(data) {
  return JSON.stringify(data);
}

// { data, sig } de la caché del usuario ACTUAL, o undefined.
export function readCache(key) {
  const user = currentUser();
  if (!user) { clearViewCache(); return undefined; }
  if (owner !== user) { clearViewCache(); owner = user; return undefined; }
  return store.get(key);
}

// Pide datos frescos y los guarda. Devuelve { data, sig }, o null si el usuario cambió mientras la
// petición estaba en vuelo (el resultado se descarta). Los errores se propagan.
export async function fetchFresh(key, fetcher) {
  const user = currentUser();
  const data = await fetcher();
  if (!user || currentUser() !== user) return null;
  if (owner !== user) { store.clear(); owner = user; }
  const entry = { data, sig: signatureOf(data) };
  store.set(key, entry);
  return entry;
}
