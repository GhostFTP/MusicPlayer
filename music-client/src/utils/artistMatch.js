import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { readCache, fetchFresh } from '../api/viewCache.js';
import { foldForSearch } from './searchText.js';

// VIDEO → ARTISTA (1.32.0). El artista de un video es sólo TEXTO: el nombre de su carpeta en
// VIDEO_DIR (music-server/src/videos/index.js). No comparte ningún id con la biblioteca, así que el
// enlace a la página del artista sólo puede salir de comparar nombres. Esa comparación vive ACÁ y
// en ningún otro lado: la tarjeta de Videos, su menú y el expandido preguntan lo mismo.

// El nombre EXACTO con que la biblioteca conoce a `name`, o null si no lo conoce.
// `artists` es la lista de GET /api/browse/artists ([{ artist, … }], donde `artist` es album_artist).
// Se compara sin mayúsculas ni acentos (el mismo plegado del buscador) y sin los espacios de los
// extremos: la carpeta «daft punk» es «Daft Punk». NO se adivina nada más: «Daft Punk feat. X» o
// «A & B» no son ningún artista de la biblioteca → null, y quien pregunta no muestra el enlace.
// Se devuelve el nombre de la biblioteca (no el de la carpeta) porque la vista de Artistas busca
// por nombre exacto.
export function matchArtist(name, artists) {
  if (!name || !Array.isArray(artists)) return null;
  const wanted = foldForSearch(name).trim();
  if (!wanted) return null;
  const hit = artists.find((a) => a.artist === name) ?? artists.find((a) => foldForSearch(a.artist).trim() === wanted);
  return hit?.artist ?? null;
}

// La lista de artistas de la biblioteca, pedida UNA vez y compartida (viewCache: en memoria y por
// usuario, como la de Biblioteca). null mientras no se sabe → sin enlaces, que es el estado seguro.
// Con `enabled` en false no pide nada (el reproductor sólo la necesita cuando suena un video).
// Si lo cacheado tiene más de REFRESH_MS se vuelve a pedir al montar, en segundo plano.
const KEY = 'artists:list';
const REFRESH_MS = 30000;
let inflight = null;
const subs = new Set();

function load() {
  inflight ??= fetchFresh(KEY, () => api.artists())
    .then((entry) => { subs.forEach((fn) => fn()); return entry; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useLibraryArtists(enabled = true) {
  const [list, setList] = useState(() => (enabled ? readCache(KEY)?.data ?? null : null));
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const sync = () => { if (alive) setList(readCache(KEY)?.data ?? null); };
    subs.add(sync);
    const cached = readCache(KEY);
    if (cached) sync();
    if (!cached || Date.now() - (cached.at ?? 0) > REFRESH_MS) load().catch(() => {});   // si falla: sin enlaces
    return () => { alive = false; subs.delete(sync); };
  }, [enabled]);
  return enabled ? list : null;
}
