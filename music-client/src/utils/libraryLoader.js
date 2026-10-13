import { api } from '../api/client.js';

// EL CARGADOR ÚNICO DE PISTAS (1.33.0). Hasta la 1.32.1 cada vista pedía GET /api/tracks con un
// `limit` escrito a mano (10000 la biblioteca, artistas y años; 500 géneros): con más pistas que
// eso, las de más allá no aparecían ni sonaban, y nadie avisaba. Ahora se PAGINA hasta agotar: no
// hay un número máximo de pistas.
//
// Cómo: páginas con `offset`, en el orden del servidor, hasta que una página trae menos de lo
// pedido. El servidor no devuelve el total, así que el final se reconoce así (si el total cae justo
// en el borde de una página, cuesta un pedido más, que vuelve vacío).
//
// TAMAÑO DE PÁGINA: la primera es de FIRST_PAGE_SIZE (5000) y las siguientes de PAGE_SIZE (20000).
// El servidor ORDENA la tabla entera en cada pedido, así que cada página cuesta un ordenamiento
// completo: medido con 50 000 pistas en localhost, todo de a 5000 son 11 pedidos y 1,6 s; con
// 5000 + 20000 son 4 pedidos y 1,1 s (un solo pedido sin tope, 0,8 s). Una biblioteca de hasta 5000
// pistas —el caso de hoy— sigue siendo UN pedido, igual que antes. Para volver a páginas parejas
// de 5000 alcanza con poner PAGE_SIZE en 5000.
//
// Repetidos: se quitan por `id`. Paginar con offset sobre una tabla que CAMBIA entre páginas (un
// escaneo en curso) puede devolver una pista dos veces o saltearse otra; lo primero se corrige acá,
// lo segundo lo corrige la siguiente revalidación. Y el orden del servidor no desempata por id, así
// que dos pistas idénticas en artista, álbum, número y título podrían cruzarse entre dos páginas:
// el filtro por id también cubre ese caso.
//
// Cada página es un pedido aparte con su propio tope de tiempo (api/client.js): una biblioteca
// grande ya no depende de que UNA respuesta enorme llegue antes de los 10 s.
//
//   · `params`: filtros de GET /api/tracks (genre, album_artist, year…). Sin filtros, la biblioteca.
//   · `signal`: AbortSignal. Al abortar no se pide la página siguiente y se rechaza con AbortError.
//   · `onPage(pistasHastaAhora, { done })`: avisa tras cada página (el mismo array que se devuelve).
//
// LA FIRMA (`serverSig`): el servidor manda un ETag por respuesta (el hash del cuerpo; Express lo
// pone solo). Si TODAS las páginas lo traen, el array devuelto lleva `serverSig` = cantidad + los
// ETags en orden: cambia si cambió cualquier byte de cualquier página, y no cuesta nada calcularlo.
// api/viewCache.js la usa como firma de revalidación; sin ETag (un proxy que lo quite) no se pone
// y viewCache cae a su hash propio. No es enumerable: no viaja si alguien copia o serializa el array.
export const FIRST_PAGE_SIZE = 5000;
export const PAGE_SIZE = 20000;

const aborted = () => new DOMException('La carga de pistas se canceló', 'AbortError');

export async function loadAllTracks({ params = {}, signal, onPage } = {}) {
  const seen = new Set();
  const all = [];
  const etags = [];
  for (let offset = 0, limit = FIRST_PAGE_SIZE; ; offset += limit, limit = PAGE_SIZE) {
    if (signal?.aborted) throw aborted();
    const res = await api.tracks({ ...params, limit, offset }, { signal, raw: true });
    if (signal?.aborted) throw aborted();
    const page = Array.isArray(res?.data) ? res.data : [];
    etags.push(res?.etag ?? null);
    const antes = all.length;
    for (const t of page) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
    }
    // Fin: la página vino incompleta. O vino llena pero SIN NADA NUEVO: algo del otro lado está
    // ignorando el `offset` (devuelve siempre lo mismo) y seguir sería pedir para siempre.
    const done = page.length < limit || all.length === antes;
    onPage?.(all, { done });
    if (done) {
      if (etags.every(Boolean)) Object.defineProperty(all, 'serverSig', { value: `${all.length}:${etags.join(',')}` });
      return all;
    }
  }
}
