// Piezas COMPARTIDAS del "Mix aleatorio" (Frente 2): las usan el botón de cada vista
// (components/ShuffleButton.jsx) y el atajo de teclado M (utils/useMixShortcut.js), así los dos
// barajan, reproducen y avisan los errores exactamente igual.

// Con menos de esto no hay nada que mezclar (el botón queda deshabilitado; el atajo no hace nada).
export const MIN_TRACKS = 2;

// El aviso de error no se repite mientras sigue en pantalla (la variante 'warning' de Toast dura 3,5 s):
// clics o teclas seguidos con la red caída dan UN solo aviso.
export const ERROR_TOAST_MS = 3500;

// Mismo texto que el menú contextual y el arrastre a la cola cuando no se pudo pedir la lista.
export const MIX_ERROR_TEXT = 'No se pudieron cargar las pistas';

// Baraja una copia (Fisher–Yates) sin mutar el original.
export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
