import { api } from '../api/client.js';

// Bandeja de salida de las escuchas (POST /api/plays). Réplica de la app iOS (lib/plays/outbox.ts):
//
//   · Cada escucha se GUARDA primero (localStorage) y después se intenta mandar. Si la red o el
//     servidor fallan, queda guardada y sale en el próximo intento: al contar otra, al volver a
//     montar la app o al volver la red. Nunca avisa (no hay toasts) y nunca toca la reproducción.
//   · Sólo un 2xx saca escuchas de la bandeja, y las saca por `client_id`, no por posición: mientras
//     viajaba el envío pudieron entrar escuchas nuevas. Un reintento de un lote ya recibido no
//     cuenta doble: el servidor ignora un `client_id` repetido (UNIQUE + INSERT OR IGNORE).
//   · Lotes de 500 (el máximo del servidor), hasta 4 seguidos por intento. Tope de 5000 guardadas:
//     si se pasa, se descartan las más viejas.
//   · POR CUENTA: la bandeja lleva dueño (el usuario del JWT). Si otra cuenta entra en este
//     navegador, lo pendiente de la anterior se descarta sin mandarse: nunca se le cuenta a una
//     cuenta lo que escuchó otra. (Diferencia con iOS, que vacía la bandeja en TODO login: acá la
//     misma cuenta que vuelve a entrar conserva lo suyo, porque un reauth de Cloudflare no es un
//     cambio de cuenta.)

const KEY = 'sonorarev.plays.outbox';
const MAX_PENDING = 5000;
const BATCH = 500;
const MAX_BATCHES = 4;

// Dueño de la sesión actual, desde el JWT guardado (mismo criterio que api/viewCache.js).
export function currentOwner() {
  let token = null;
  try { token = localStorage.getItem('token'); } catch { return null; }
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(b64));
    return p.id != null ? `id:${p.id}` : (p.username ? `u:${p.username}` : null);
  } catch {
    return null;
  }
}

// Mismo formato que iOS: base36 de la hora, un contador y un aleatorio.
let seq = 0;
export function newClientId() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function readRaw() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

// Lo pendiente de `owner`. Lo de otra cuenta no se devuelve nunca.
function read(owner) {
  const d = readRaw();
  return d && d.owner === owner && Array.isArray(d.plays) ? d.plays : [];
}

function write(owner, plays) {
  try {
    if (plays.length) localStorage.setItem(KEY, JSON.stringify({ owner, plays }));
    else localStorage.removeItem(KEY);
  } catch { /* storage lleno o bloqueado: la escucha se pierde, la reproducción sigue */ }
}

// Si lo guardado es de otra cuenta, se descarta.
export function discardForeign(owner) {
  const d = readRaw();
  if (d && d.owner !== owner) write(owner, []);
}

export function recordPlay(owner, play) {
  if (!owner) return;
  discardForeign(owner);
  const plays = read(owner);
  plays.push(play);
  if (plays.length > MAX_PENDING) plays.splice(0, plays.length - MAX_PENDING);
  write(owner, plays);
}

let flushing = false;

// Manda hasta MAX_BATCHES lotes de lo pendiente de `owner`. Devuelve cuántas escuchas salieron.
export async function flushPending(owner) {
  if (!owner || flushing) return 0;
  flushing = true;
  let sentTotal = 0;
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = read(owner).slice(0, BATCH);
      if (!batch.length || currentOwner() !== owner) break;
      try {
        await api.recordPlays(batch);
      } catch {
        break;          // red caída, 4xx o 5xx: todo queda guardado para el próximo intento
      }
      if (currentOwner() !== owner) break;   // cambió la cuenta en vuelo: no se toca nada
      const sent = new Set(batch.map((p) => p.client_id));
      write(owner, read(owner).filter((p) => !sent.has(p.client_id)));
      sentTotal += batch.length;
    }
  } finally {
    flushing = false;
  }
  return sentTotal;
}
