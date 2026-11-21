// Mutaciones de control del sub-paso 3c (detalle de admin plegado y gráfica: EstadoServidor.jsx y
// puntosGrafica de music-client/src/utils/estadoServidor.js).
// SÓLO DATOS LITERALES (sin lógica), con el formato de mutar.mjs (rama feat/web-dj): cada `ancla`
// tiene que aparecer EXACTAMENTE una vez en su archivo, contando sobre el texto ya cambiado por los
// cambios anteriores de la MISMA mutación; si no, la mutación sale NO APLICÓ y no se toca nada.
// ⚠️ mutar.mjs todavía no está en esta rama (y hoy solo acepta las suites dj-*): se corrieron con el
// mismo driver de 3b, fuera del repo (servidor-unit directo, servidor-func por el runner con build,
// SERVIDOR_FUNC_SALIDA para el detalle; restaura desde los bytes y verifica el sha256).
// `esperados` = los casos que deberían caer, de cualquiera de las dos suites.
export const suites = ['servidor-unit', 'servidor-func'];

export const mutaciones = [
  {
    id: "U1",
    que: "el detalle de admin se muestra (y se puede pedir) sin admin:true",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "{dato?.admin === true && !prohibido && <DetalleAdmin ",
        reemplazo: "{!prohibido && <DetalleAdmin ",
      },
    ],
    esperados: ["usuario_sin_detalle"],
  },
  {
    id: "U2",
    que: "el endpoint de admin se pide con el bloque cerrado (el contenido se monta siempre)",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "{abierto && <DetalleAbierto alProhibido={alProhibido} alDatoAdmin={alDatoAdmin} />}",
        reemplazo: "<DetalleAbierto alProhibido={alProhibido} alDatoAdmin={alDatoAdmin} />",
      },
    ],
    // También sin_pedido_admin (3b) y admin_403_oculta: el detalle se pide al montar y el 403 lo
    // esconde antes del clic.
    esperados: ["admin_detalle_cerrado_sin_pedido", "admin_abre_pide_una_vez", "admin_cierra_detiene", "sin_pedido_admin", "admin_403_oculta", "copiar_admin_cerrado_no_pide"],
  },
  {
    id: "U3",
    que: "cerrar el bloque no detiene su sondeo (solo se escucha la apertura)",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "onToggle={(e) => setAbierto(e.currentTarget.open)}",
        reemplazo: "onToggle={(e) => { if (e.currentTarget.open) setAbierto(true); }}",
      },
    ],
    esperados: ["admin_cierra_detiene"],
  },
  {
    id: "U4",
    que: "la gráfica usa un techo FIJO de 150 ms",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "  const techo = Math.max(TECHO_MIN_MS, pico.max * HOLGURA_TECHO);\n",
        reemplazo: "  const techo = TECHO_MIN_MS;\n",
      },
    ],
    esperados: ["grafica_guias", "graf_techo_dinamico", "graf_guia_500_si_cabe", "graf_pico_no_toca_techo", "graf_borde_guia_500", "graf_valores_altos_dentro"],
  },
  {
    id: "U5",
    que: "la guía de 500 se muestra siempre (aunque no quepa en el techo)",
    cambios: [
      {
        archivo: "music-client/src/utils/estadoServidor.js",
        ancla: "    guias: GUIAS.filter((g) => g.valor <= techo).map(",
        reemplazo: "    guias: GUIAS.map(",
      },
    ],
    esperados: ["grafica_guias", "graf_guia_100_sin_500", "graf_borde_guia_500"],
  },
  {
    id: "U6",
    que: "un 403 del detalle no lo esconde (se muestra como «Sin respuesta»)",
    cambios: [
      {
        archivo: "music-client/src/components/EstadoServidor.jsx",
        ancla: "alFallo: (clave) => { if (clave === 'prohibido') alProhibido(); else setFallo(clave); },",
        reemplazo: "alFallo: (clave) => setFallo(clave === 'prohibido' ? 'sin_respuesta' : clave),",
      },
    ],
    esperados: ["admin_403_oculta"],
  },
];
