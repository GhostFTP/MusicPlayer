import { useCallback, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import { currentOwner } from './playsOutbox.js';

// FAVORITOS = la playlist "Mis favoritos", la MISMA que usa la app iOS (lib/playlists/favoritos.ts),
// así el corazón del iPhone y el de la web son el mismo. No hay endpoint propio: es una playlist más.
//
// Cuál es (mismo criterio que iOS, `elegirFavoritos`):
//   1. la que este navegador ya usó (id guardado por cuenta), si sigue existiendo;
//   2. si no, la MÁS VIEJA (created_at, id) cuyo nombre recortado sea exactamente "Mis favoritos";
//   3. si no hay ninguna, no existe todavía.
// Se crea PEREZOSAMENTE, recién al guardar el primer corazón (POST /api/playlists { name }, sin
// emoji, igual que iOS), y con UN solo vuelo a la vez: el nombre no es único en la base, y dos
// corazones seguidos crearían dos playlists. Si existe una creada desde el iPhone, se reutiliza.
//
// El conjunto de favoritos vive en memoria POR CUENTA (patrón de api/viewCache.js): si el JWT es de
// otro usuario, se descarta entero antes de devolver nada. El corazón es OPTIMISTA: cambia al
// instante y, si el servidor falla, vuelve a como estaba y avisa con un toast ámbar.
//
// La carga NO ocurre al abrir la app (competía con la carga de la Biblioteca): se pide cuando hace
// falta — al empezar a sonar una pista (FavButton, para pintar el corazón), al abrir el menú
// contextual y, como red, al tocar el corazón si todavía no se cargó.

export const FAV_NAME = 'Mis favoritos';
const ID_KEY = 'sonorarev.favoritos';

let state = { owner: null, ids: new Set(), playlistId: null, loaded: false };
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getVersion = () => version;

let loading = null;     // promesa de la carga en curso (una por cuenta)
let resolving = null;   // promesa de "encontrar o crear" en curso (un solo vuelo)
let chain = Promise.resolve();   // los cambios salen al servidor en orden, de a uno
const pendingByTrack = new Map();

function storedId(owner) {
  try {
    const d = JSON.parse(localStorage.getItem(ID_KEY) ?? 'null');
    return d && d.owner === owner && Number.isInteger(d.id) ? d.id : null;
  } catch { return null; }
}
function storeId(owner, id) {
  try {
    if (id == null) localStorage.removeItem(ID_KEY);
    else localStorage.setItem(ID_KEY, JSON.stringify({ owner, id }));
  } catch { /* sin storage: se vuelve a elegir por nombre */ }
}

// Estado de la cuenta ACTUAL: si cambió el usuario, se descarta lo anterior.
function current() {
  const owner = currentOwner();
  if (state.owner !== owner) {
    state = { owner, ids: new Set(), playlistId: null, loaded: false };
    loading = null; resolving = null; pendingByTrack.clear();
  }
  return state;
}

// La elección de iOS: id guardado si existe; si no, la más vieja con el nombre exacto.
export function pickFavorites(playlists, savedId) {
  const list = Array.isArray(playlists) ? playlists : [];
  if (savedId != null) {
    const s = list.find((p) => p.id === savedId);
    if (s) return s;
  }
  const named = list.filter((p) => typeof p.name === 'string' && p.name.trim() === FAV_NAME);
  named.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id - b.id);
  return named[0] ?? null;
}

// Busca "Mis favoritos" (sin crearla). Devuelve su id o null.
async function find(owner) {
  const pl = pickFavorites(await api.playlists(), storedId(owner));
  if (currentOwner() !== owner) throw new Error('owner changed');
  storeId(owner, pl?.id ?? null);
  return pl?.id ?? null;
}

// Carga el conjunto (una vez por cuenta). No crea nada.
export function loadFavorites() {
  const s = current();
  if (!s.owner) return Promise.resolve();
  if (loading) return loading;
  const owner = s.owner;
  loading = (async () => {
    const id = await find(owner);
    const tracks = id != null ? await api.playlistTracks(id) : [];
    if (currentOwner() !== owner) return;
    // Un corazón tocado MIENTRAS cargaba gana sobre lo que trajo el servidor (todavía viaja), y
    // si "encontrar o crear" ya resolvió la playlist mientras tanto, no se pisa con un null viejo.
    const ids = new Set(tracks.map((t) => t.id));
    for (const t of pendingByTrack.keys()) { if (state.ids.has(t)) ids.add(t); else ids.delete(t); }
    state = { ...state, playlistId: state.playlistId ?? id, ids, loaded: true };
    emit();
  })().catch(() => { if (state.owner === owner) loading = null; });   // reintenta en el próximo montaje
  return loading;
}

// Encuentra o CREA "Mis favoritos" (un solo vuelo).
function ensurePlaylist(owner) {
  if (state.playlistId != null) return Promise.resolve(state.playlistId);
  if (!resolving) {
    resolving = (async () => {
      let id = await find(owner);
      if (id == null) {
        const created = await api.createPlaylist(FAV_NAME);   // sin emoji, como iOS
        id = created?.id;
        if (!Number.isInteger(id)) throw new Error('no se pudo crear');
        storeId(owner, id);
      }
      if (currentOwner() === owner) state = { ...state, playlistId: id };
      return id;
    })().finally(() => { resolving = null; });
  }
  return resolving;
}

async function send(owner, trackId, on) {
  const run = async (id) => (on ? api.addToPlaylist(id, trackId) : api.removeFromPlaylist(id, trackId));
  const id = await ensurePlaylist(owner);
  try {
    await run(id);
  } catch (e) {
    // 404: la borraron (desde la web o el iPhone). Se vuelve a resolver UNA vez, como iOS.
    if (e?.status !== 404) throw e;
    if (currentOwner() === owner) state = { ...state, playlistId: null };
    storeId(owner, null);
    if (!on) return;   // quitar de una playlist que ya no existe: ya no está
    await run(await ensurePlaylist(owner));
  }
}

export function isFavorite(trackId) {
  return current().ids.has(trackId);
}

// Alterna el corazón de una pista. `onError` recibe el texto del aviso si hubo que deshacer.
export function toggleFavorite(trackId, onError, afterLoad = false) {
  const s = current();
  if (!s.owner || trackId == null) return;
  // Sin el conjunto cargado no se sabe si el toque agrega o quita: primero se carga (una vez; si la
  // carga falla, se sigue con lo que hay, como antes).
  if (!s.loaded && !afterLoad) { loadFavorites().then(() => toggleFavorite(trackId, onError, true)); return; }
  const owner = s.owner;
  const on = !s.ids.has(trackId);
  const ids = new Set(s.ids);
  if (on) ids.add(trackId); else ids.delete(trackId);
  state = { ...s, ids };
  emit();
  const mine = (pendingByTrack.get(trackId) ?? 0) + 1;
  pendingByTrack.set(trackId, mine);
  chain = chain.then(() => send(owner, trackId, on)).then(
    () => { if (pendingByTrack.get(trackId) === mine) pendingByTrack.delete(trackId); },
    () => {
      if (currentOwner() !== owner || state.owner !== owner) return;
      // Deshacer SÓLO si nadie volvió a tocar ese corazón después (si no, manda el último toque).
      if (pendingByTrack.get(trackId) === mine) {
        pendingByTrack.delete(trackId);
        const back = new Set(state.ids);
        if (on) back.delete(trackId); else back.add(trackId);
        state = { ...state, ids: back };
        emit();
      }
      onError?.(on ? 'No se pudo guardar en «Mis favoritos»' : 'No se pudo quitar de «Mis favoritos»');
    },
  );
}

// Hook: se re-renderiza sólo cuando cambia el conjunto. NO carga nada por sí solo (ver arriba):
// quien lo usa llama a loadFavorites() cuando de verdad lo necesita. `version` sirve de dependencia
// para recalcular lo que dependa del conjunto (p. ej. los ítems del menú).
export function useFavorites() {
  const version = useSyncExternalStore(subscribe, getVersion);
  const toggle = useCallback((trackId, onError) => toggleFavorite(trackId, onError), []);
  return { isFavorite, toggle, version };
}

// Para pruebas: vaciar el estado en memoria.
export function _resetFavorites() {
  state = { owner: null, ids: new Set(), playlistId: null, loaded: false };
  loading = null; resolving = null; pendingByTrack.clear(); chain = Promise.resolve();
  emit();
}
