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
const store = new Map();     // key → { data, sig, at }  (at = cuándo llegó, Date.now())

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

// Firma para "¿cambió algo?". Ante cualquier diferencia en cualquier campo la vista se actualiza;
// si es idéntica no se hace setState (no se re-renderizan las filas por una revalidación sin cambios).
//
// Hasta la 1.32.1 era el JSON.stringify de toda la respuesta: una cadena del tamaño de la
// biblioteca (20 MB con 50 000 pistas) armada en cada revalidación. Ahora es la CANTIDAD más dos
// hashes de 32 bits que recorren, en orden, cada campo de cada elemento: los números enteros, los
// strings carácter por carácter, y null/booleanos con su marca. Mira lo mismo que miraba el JSON
// (cualquier campo, y el orden), sin construir la cadena. Dos hashes independientes: que dos
// respuestas distintas coincidan en la cantidad y en los 64 bits no es un caso práctico.
// Lo que no es un array de objetos planos (o trae algo anidado) cae al JSON de antes.
//
// Y el atajo: la biblioteca que arma utils/libraryLoader.js ya trae su firma (`serverSig`, hecha con
// los ETag del servidor: el hash de cada página tal como salió). Si está, se usa ésa y no se
// recorre nada; el hash de abajo queda para las listas chicas (álbumes) y para cuando no hay ETag.
export function signatureOf(data) {
  if (typeof data?.serverSig === 'string') return data.serverSig;
  if (!Array.isArray(data)) return JSON.stringify(data);
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < data.length; i++) {
    const o = data[i];
    if (o === null || typeof o !== 'object') return JSON.stringify(data);
    for (const k in o) {
      const v = o[k];
      let n;
      if (typeof v === 'string') {
        for (let c = 0; c < v.length; c++) {
          n = v.charCodeAt(c);
          h1 = Math.imul(h1 ^ n, 16777619);
          h2 = (Math.imul(h2, 33) + n) | 0;
        }
        n = -1;                                              // fin de string: "ab","c" ≠ "a","bc"
      } else if (typeof v === 'number') {
        n = Number.isInteger(v) ? v | 0 : Math.round(v * 1000) | 0;   // duración con decimales
      } else if (v === null || v === undefined) {
        n = -2;
      } else if (typeof v === 'boolean') {
        n = v ? -3 : -4;
      } else {
        return JSON.stringify(data);                         // algo anidado: no es el caso de las listas
      }
      h1 = Math.imul(h1 ^ n, 16777619);
      h2 = (Math.imul(h2, 33) + n) | 0;
    }
    h1 = Math.imul(h1 ^ -5, 16777619);                       // fin de elemento
    h2 = (Math.imul(h2, 33) - 5) | 0;
  }
  return `${data.length}:${h1 >>> 0}:${h2 >>> 0}`;
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
  const entry = { data, sig: signatureOf(data), at: Date.now() };
  store.set(key, entry);
  return entry;
}
