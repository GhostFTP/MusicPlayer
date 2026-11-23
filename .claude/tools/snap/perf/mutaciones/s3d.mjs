// Mutaciones de control del sub-paso 3d («Copiar diagnóstico»: textoDiagnostico en
// music-client/src/utils/estadoServidor.js, CopiarDiagnostico en EstadoServidor.jsx y su CSS).
// SÓLO DATOS LITERALES (sin lógica), con el formato de mutar.mjs (rama feat/web-dj): cada `ancla`
// tiene que aparecer EXACTAMENTE una vez en su archivo, contando sobre el texto ya cambiado por los
// cambios anteriores de la MISMA mutación; si no, la mutación sale NO APLICÓ y no se toca nada.
// ⚠️ mutar.mjs todavía no está en esta rama (y hoy solo acepta las suites dj-*): se corrieron con el
// mismo driver de 3b/3c, fuera del repo (servidor-unit directo, servidor-func por el runner con build,
// SERVIDOR_FUNC_SALIDA para el detalle; restaura desde los bytes y verifica el sha256).
// `esperados` = los casos que deberían caer, de cualquiera de las dos suites.
export const suites = ['servidor-unit', 'servidor-func'];

export const mutaciones = [
  {
    id: "V1",
    que: "el texto del diagnóstico lleva el token de localStorage",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "    ['pestaña', visible ? 'visible' : 'oculta'],\n",
        reemplazo: "    ['pestaña', visible ? 'visible' : 'oculta'],\n    ['sesión', globalThis.localStorage?.getItem?.('token') ?? '—'],\n",
      },
    ],
    esperados: ["dx_sin_secretos", "dx_no_lee_localstorage", "copiar_no_incluye_secretos"],
  },
  {
    id: "V2",
    que: "copiar pide el endpoint de admin",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "    const t = armar();\n",
        reemplazo: "    api.adminServidor().catch(() => {});\n    const t = armar();\n",
      },
    ],
    // También copiar_publico, que exige 0 pedidos de admin al copiar.
    esperados: ["copiar_admin_cerrado_no_pide", "copiar_publico"],
  },
  {
    id: "V3",
    que: "sin el respaldo a mano: si no se pudo copiar, no pasa nada (mudo)",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "      setTexto(t);\n      setFase('manual');\n",
        reemplazo: "",
      },
    ],
    esperados: ["copiar_fallback_textarea", "copiar_390_sin_desborde"],
  },
  {
    id: "V4",
    que: "el texto no lleva la versión del cliente",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "    ['versión del cliente', buildSeguro(build)],\n",
        reemplazo: "",
      },
    ],
    esperados: ["dx_publico", "dx_sin_datos_nunca", "dx_version_cliente", "copiar_publico", "copiar_sin_respuesta"],
  },
  {
    id: "V5",
    que: "«Copiado» pintado en un color de estado (el verde de los tiers)",
    cambios: [
      {
        archivo: "music-client/src/styles/main.css",
        ancla: ".srv-copiar-boton--hecho { color: var(--text); border-color: var(--text-muted); }\n",
        reemplazo: ".srv-copiar-boton--hecho { color: var(--q-lossless); border-color: var(--q-lossless); }\n",
      },
    ],
    esperados: ["copiar_feedback_aria"],
  },
];
