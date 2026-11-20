// Mutaciones de control del sub-paso h5a (matriz visual del Modo DJ, dj-matriz.mjs).
// SÓLO DATOS LITERALES (sin lógica): lo lee mutar.mjs, ver su cabecera. Cada `ancla` tiene que aparecer EXACTAMENTE una
// vez en su archivo, contando sobre el texto ya cambiado por los cambios anteriores de la MISMA mutación; si no, la
// mutación sale NO APLICÓ y no se toca nada.
// Por defecto corre la matriz; con «--suites dj-unit,dj-func» se ve si las suites de antes la detectan.
// D1 = control obvio: el área de contenido de .main-content medida en E1 es 672 px a 900, 996 a 1280 y 1082 a 1366
// (REG de dj-matriz, h5a), así que una sección de 1200 px se sale en las tres ventanas.
// D2 = la H5a del diagnóstico h5: sin `esperados` porque no se sabía de antemano qué la ve (eso es lo que se mide).
export const suites = ['dj-matriz'];

export const mutaciones = [
  {
    id: "D1",
    que: "la biblioteca del DJ con un ancho fijo de 1200 px",
    cambios: [
      {
        archivo: "music-client/src/styles/main.css",
        ancla: ".dj-biblioteca { margin-top: 20px; }\n",
        reemplazo: ".dj-biblioteca { margin-top: 20px; width: 1200px; }\n",
      },
    ],
    esperados: [
      "e1_900x800_sin_scroll_horizontal", "e1_900x800_nada_fuera_del_area",
      "e1_1280x800_sin_scroll_horizontal", "e1_1280x800_nada_fuera_del_area",
      "e1_1366x768_sin_scroll_horizontal", "e1_1366x768_nada_fuera_del_area",
    ],
  },
  {
    id: "D2",
    que: "la fila de «Audífonos (cue)» no se parte (flex-wrap: nowrap)",
    cambios: [
      {
        archivo: "music-client/src/styles/main.css",
        ancla: ".dj-cue-fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }\n",
        reemplazo: ".dj-cue-fila { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px 16px; }\n",
      },
    ],
  },
];
