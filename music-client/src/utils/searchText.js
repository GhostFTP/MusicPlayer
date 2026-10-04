// Normalización para la búsqueda LOCAL de la Biblioteca (Frente 1, sub-paso 4).
//
// Minúsculas + sin acentos (NFD y quitar las marcas combinantes): "Beyoncé" y "beyonce" coinciden.
// Ojo, es un cambio leve respecto del servidor: su LIKE ignora mayúsculas sólo en ASCII y NO ignora
// acentos. Para volver a "acentos sí cuentan", borrar la línea marcada abajo.
export function foldForSearch(s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // ← plegado de acentos (quitar esta línea para desactivarlo)
    ;
}

// Texto buscable de una pista: los MISMOS campos que mira el servidor (título, artista, álbum).
// Separados por "\n" para que una búsqueda no coincida "cruzando" dos campos (el input es de una
// sola línea, así que la consulta nunca contiene "\n").
export function trackHaystack(t) {
  return foldForSearch(`${t.title ?? ''}\n${t.artist ?? ''}\n${t.album ?? ''}`);
}
