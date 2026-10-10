import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { foldForSearch } from './searchText.js';

const EMPTY = [];

// Filtro LOCAL de un listado (buscador de las vistas): la lista ya está completa en memoria, así que
// se filtra en el cliente, sin pedido por tecla y sin debounce. Mismo criterio que la Biblioteca
// (utils/searchText.js): subcadena, sin distinguir mayúsculas ni acentos, y los campos separados por
// "\n" para que una búsqueda no coincida "cruzando" dos campos.
//
// · `fields`: las claves del ítem donde se busca. Tiene que ser una referencia ESTABLE (una constante
//   de módulo): es dependencia del texto precalculado.
// · El texto buscable de cada ítem se calcula UNA vez por lista, no por tecla.
// · El input se pinta con `query` (urgente) y la lista filtra con su versión DIFERIDA: escribir nunca
//   se traba por volver a pintar las tarjetas (React lo hace en segundo plano y lo descarta si llega
//   otra tecla).
// · Los espacios de los extremos no cuentan: "daft " encuentra lo mismo que "daft", y un texto de
//   sólo espacios es "sin filtro".
//
// Devuelve `filtered` (la MISMA referencia que `list` cuando no hay filtro → quien memoiza por la
// lista no se entera), `activeQuery` (el texto que de verdad está filtrando lo que se ve) y `touched`:
// ya se escribió algo en esta visita. Las vistas con entrada escalonada (Artistas, Géneros) la apagan
// con eso: esa animación es para cuando la lista MONTA, no para cada tarjeta que vuelve al borrar una
// letra. No vuelve a false al limpiar; se reinicia cuando la vista se desmonta.
export function useListFilter(list, fields) {
  const items = list ?? EMPTY;
  const [query, setQueryState] = useState('');
  const [touched, setTouched] = useState(false);
  const setQuery = useCallback((v) => { if (v) setTouched(true); setQueryState(v); }, []);
  const deferredQuery = useDeferredValue(query);

  const haystacks = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it, foldForSearch(fields.map((f) => it[f] ?? '').join('\n')));
    return m;
  }, [items, fields]);

  const activeQuery = deferredQuery.trim();
  const filtered = useMemo(() => {
    const q = foldForSearch(activeQuery);
    if (!q) return items;
    return items.filter((it) => haystacks.get(it).includes(q));
  }, [items, haystacks, activeQuery]);

  return { query, setQuery, activeQuery, filtered, touched };
}
