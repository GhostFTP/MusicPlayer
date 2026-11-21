// Mutaciones de control del sub-paso 3b (tarjeta pública «Servidor» de Ajustes: EstadoServidor.jsx y
// el sondeo de music-client/src/utils/sondeoServidor.js).
// SÓLO DATOS LITERALES (sin lógica), con el formato de mutar.mjs (rama feat/web-dj): cada `ancla`
// tiene que aparecer EXACTAMENTE una vez en su archivo, contando sobre el texto ya cambiado por los
// cambios anteriores de la MISMA mutación; si no, la mutación sale NO APLICÓ y no se toca nada.
// ⚠️ mutar.mjs todavía no está en esta rama (y hoy solo acepta las suites dj-*): en 3b se corrieron con
// un driver equivalente fuera del repo: servidor-unit directo y servidor-func POR EL RUNNER
// (regresion.mjs --solo servidor-func, con build, SERVIDOR_FUNC_SALIDA para el detalle), restaurando
// desde los bytes y verificando el sha256.
// `esperados` = los casos que deberían caer, de cualquiera de las dos suites.
// ⚠️ T2 (no cortar en 401) NO se puede ver en el navegador: un 401 hace logout() (AuthContext) y
// Ajustes se desmonta, así que el sondeo muere igual. Por eso su esperado es solo el de servidor-unit.
export const suites = ['servidor-unit', 'servidor-func'];

export const mutaciones = [
  {
    id: "T1",
    que: "no pausar con la pestaña oculta (se agenda igual y el timer pendiente no se cancela)",
    cambios: [
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "    if (!vivo || cortado || oculto()) return;\n",
        reemplazo: "    if (!vivo || cortado) return;\n",
      },
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "    if (oculto()) { quitarTimer(); return; }\n",
        reemplazo: "    if (oculto()) return;\n",
      },
    ],
    // También caen los de «vuelve visible»: sin pausa, el pedido ya salió con la pestaña oculta y al
    // volver no pasaron 30 s, así que no pide en el acto.
    esperados: ["sond_pausa_oculta", "pausa_oculta", "sond_vuelve_visible_pide", "vuelve_visible_pide"],
  },
  {
    id: "T2",
    que: "un 401 no corta el sondeo",
    cambios: [
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "      if (clave === 'sesion') cortado = true;\n",
        reemplazo: "",
      },
    ],
    esperados: ["sond_401_corta"],
  },
  {
    id: "T3",
    que: "aria-live en «hace N s»",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "<span className=\"srv-hace\">",
        reemplazo: "<span className=\"srv-hace\" aria-live=\"polite\">",
      },
    ],
    esperados: ["aria_live"],
  },
  {
    id: "T4",
    que: "usar el JSON sin validar",
    cambios: [
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "      dato = validar(await leer());\n",
        reemplazo: "      dato = await leer();\n",
      },
    ],
    esperados: ["sond_valida_y_clasifica", "json_forma_mala"],
  },
  {
    id: "T5",
    que: "permitir dos lecturas en vuelo",
    cambios: [
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "    if (enVuelo || cortado) return;\n",
        reemplazo: "    if (cortado) return;\n",
      },
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "    if (enVuelo) return;   // cuando termine, agenda él\n",
        reemplazo: "",
      },
    ],
    esperados: ["sond_una_en_vuelo", "una_en_vuelo"],
  },
  {
    id: "T6",
    que: "no limpiar el timer al desmontar",
    cambios: [
      {
        archivo: "music-client/src/utils/sondeoServidor.js",
        ancla: "      vivo = false;\n      quitarTimer();\n",
        reemplazo: "      vivo = false;\n",
      },
    ],
    esperados: ["sond_detener_limpia", "sale_de_ajustes_corta"],
  },
  {
    // Extra (no estaba en el prompt): el bug que mostraron las capturas de 3b. Con la especificidad de
    // .srv-viejo sola, .settings-row dd le gana el color y los valores viejos NO se ven atenuados.
    id: "T7",
    que: "el atenuado de «Sin respuesta» pierde contra .settings-row dd (especificidad corta)",
    cambios: [
      {
        archivo: "music-client/src/styles/main.css",
        ancla: ".settings-row dd.srv-viejo { color: var(--text-muted); }\n",
        reemplazo: ".srv-viejo { color: var(--text-muted); }\n",
      },
    ],
    esperados: ["sin_respuesta_red"],
  },
];
