// Mutaciones de control del sub-paso 3a (estado del servidor en Ajustes: funciones puras de
// music-client/src/utils/estadoServidor.js y su suite servidor-unit.mjs).
// SÓLO DATOS LITERALES (sin lógica), con el formato de mutar.mjs (rama feat/web-dj): cada `ancla`
// tiene que aparecer EXACTAMENTE una vez en su archivo, contando sobre el texto ya cambiado por los
// cambios anteriores de la MISMA mutación; si no, la mutación sale NO APLICÓ y no se toca nada.
// ⚠️ mutar.mjs todavía no está en esta rama y hoy solo acepta las suites dj-*: en 3a estas
// mutaciones se corrieron con un driver equivalente fuera del repo (aplica, corre
// `node servidor-unit.mjs`, restaura desde los bytes y verifica el sha256).
// `esperados` = los casos que deberían caer.
export const suites = ['servidor-unit'];

export const mutaciones = [
  {
    id: "S1",
    que: "validarServidor acepta un estado desconocido",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  if (!ESTADOS.includes(x.estado)) return null;\n",
        reemplazo: "",
      },
    ],
    // También cae pub_campo_que_falta: sin `estado` (undefined) el validador mutado lo acepta igual.
    esperados: ["pub_estado_desconocido", "pub_campo_que_falta"],
  },
  {
    id: "S2",
    que: "validarAdminServidor acepta una muestra inválida (la deja pasar tal cual)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "    const v = validarMuestra(m);\n    if (!v) return null;\n    muestras.push(v);\n",
        reemplazo: "    muestras.push(validarMuestra(m) ?? m);\n",
      },
    ],
    esperados: ["adm_muestra_basura", "diag_admin_invalido_null"],
  },
  {
    id: "S3",
    que: "la fecha de SQLite deja de tratarse como UTC (Date.parse sin «Z» = hora local)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  const ms = Date.UTC(a, mes - 1, d, h, mi, s);\n",
        reemplazo: "  const ms = Date.parse(texto.replace(' ', 'T'));\n",
      },
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d || f.getUTCHours() !== h || f.getUTCMinutes() !== mi || f.getUTCSeconds() !== s) return null;\n",
        reemplazo: "  if (Number.isNaN(ms) || f.getMonth() !== mes - 1 || f.getDate() !== d) return null;\n",
      },
    ],
    esperados: ["fecha_es_utc", "fecha_no_es_local", "fecha_local_04", "fecha_zona_utc", "fecha_cruce_de_dia"],
  },
  {
    id: "S4",
    que: "la gráfica usa un techo FIJO de 150 ms en vez de max(150, pico × 1,15)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  const techo = Math.max(TECHO_MIN_MS, pico.max * HOLGURA_TECHO);\n",
        reemplazo: "  const techo = TECHO_MIN_MS;\n",
      },
    ],
    esperados: ["graf_techo_dinamico", "graf_guia_500_si_cabe", "graf_pico_no_toca_techo", "graf_borde_guia_500", "graf_valores_altos_dentro"],
  },
  {
    id: "S5",
    que: "el diagnóstico incluye el token de localStorage",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "cliente: { build: b }, servidor }",
        reemplazo: "cliente: { build: b, token: globalThis.localStorage?.getItem?.('token') ?? null }, servidor }",
      },
    ],
    esperados: ["diag_sin_token", "diag_no_lee_localstorage"],
  },
  {
    id: "S6a",
    que: "textoEncendido cruza mal los 60 s (60 s todavía dice «menos de 1 min»)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  if (s < 60) return 'hace menos de 1 min';\n",
        reemplazo: "  if (s <= 60) return 'hace menos de 1 min';\n",
      },
    ],
    esperados: ["encendido_bordes"],
  },
  {
    id: "S6b",
    que: "textoEncendido cruza mal la hora (3600 s todavía dice «hace 60 min»)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;\n  if (s < 86400) return `hace ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;\n",
        reemplazo: "  if (s <= 3600) return `hace ${Math.floor(s / 60)} min`;\n  if (s < 86400) return `hace ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;\n",
      },
    ],
    esperados: ["encendido_bordes"],
  },
  {
    id: "S6c",
    que: "textoEncendido cruza mal el día (86400 s todavía dice «hace 24 h 0 min»)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  if (s < 86400) return `hace ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;\n",
        reemplazo: "  if (s <= 86400) return `hace ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;\n",
      },
    ],
    esperados: ["encendido_bordes"],
  },
];
