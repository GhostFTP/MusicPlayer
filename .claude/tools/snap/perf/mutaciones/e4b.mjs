// Mutaciones de control del sub-paso e4b (Modo DJ: motivo visible del Cue, un solo botón que olvida, desfase al «Usar»).
// SÓLO DATOS LITERALES (sin lógica): lo lee mutar.mjs, ver su cabecera. Cada `ancla` tiene que aparecer EXACTAMENTE una
// vez en su archivo, contando sobre el texto ya cambiado por los cambios anteriores de la MISMA mutación; si no, la
// mutación sale NO APLICÓ y no se toca nada.
// Migradas del driver de e4b (scratchpad). `esperados` = los casos que la detectaron al entregar e4b, SIN los de arrastre:
// en N5, ce17 cae porque le llega el estado sucio; en N6, cr9 cae por el conteo de escrituras. Salen como aviso COLATERAL.
export const suites = ['dj-unit', 'dj-func'];

export const mutaciones = [
  {
    id: "N1",
    que: "sin renglón de motivo bajo el deck",
    cambios: [
      {
        archivo: "music-client/src/dj/DjPage.jsx",
        ancla: "      {botonCue.motivo && <p className=\"dj-deck-cue-motivo\" id={idMotivo}>{botonCue.motivo}</p>}\n",
        reemplazo: "",
      },
    ],
    esperados: ["cr13_motivo_visible_con_cue_deshabilitado"],
  },
  {
    id: "N2",
    que: "sin aria-describedby en el botón Cue",
    cambios: [
      {
        archivo: "music-client/src/dj/DjPage.jsx",
        ancla: "          aria-describedby={botonCue.motivo ? idMotivo : undefined}\n",
        reemplazo: "",
      },
    ],
    esperados: ["cr13_motivo_visible_con_cue_deshabilitado"],
  },
  {
    id: "N3",
    que: "el botón del aviso de error olvida lo guardado (vuelve a ser «Quitar salida»)",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "          <button type=\"button\" className=\"dj-btn dj-cue-cerrar-error\" onClick={() => setMotorCerrado(c.aviso)}>Cerrar</button>\n",
        reemplazo: "          <button type=\"button\" className=\"dj-btn dj-cue-cerrar-error\" onClick={quitar}>Cerrar</button>\n",
      },
    ],
    esperados: ["cs9b_error_se_cierra_y_la_fila_quita", "cr14_cerrar_no_olvida_y_quitar_de_la_fila_si"],
  },
  {
    id: "N4",
    que: "«Cerrar» el aviso de desconexión olvida lo guardado",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "          <button type=\"button\" className=\"dj-btn dj-cue-cerrar\" onClick={() => setAvisoUi(null)}>Cerrar</button>\n",
        reemplazo: "          <button type=\"button\" className=\"dj-btn dj-cue-cerrar\" onClick={() => { setAvisoUi(null); guardar(olvidarActual); }}>Cerrar</button>\n",
      },
    ],
    esperados: ["cr14_cerrar_no_olvida_y_quitar_de_la_fila_si"],
  },
  {
    id: "N5",
    que: "la fila no ofrece «Quitar salida» en 'error'",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "  const hayQuitar = !!c.salida || falta !== null;   // e4b: también en 'error' y con la que falta\n",
        reemplazo: "  const hayQuitar = (!!c.salida && c.estado !== 'error') || falta !== null;\n",
      },
    ],
    esperados: ["cs9b_error_se_cierra_y_la_fila_quita", "cr14_cerrar_no_olvida_y_quitar_de_la_fila_si"],
  },
  {
    id: "N6",
    que: "«Quitar salida» no olvida actual",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    guardar(olvidarActual);   // e4a: olvida la salida; los desfases quedan\n",
        reemplazo: "",
      },
    ],
    esperados: ["cr11_usar_recargar_y_quitar_ida_y_vuelta", "cr14_cerrar_no_olvida_y_quitar_de_la_fila_si"],
  },
  {
    id: "N7",
    que: "«Usar» ignora el desfase guardado",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    const d = motor ? desfaseAlUsar(leerGuardado(), { id, nombre: cruda }, motor.cue().desfaseMs) : null;\n",
        reemplazo: "    const d = null;\n",
      },
    ],
    esperados: ["cr15_usar_aplica_el_desfase_guardado_o_deja_el_actual"],
  },
  {
    id: "N8",
    que: "«Usar» pisa el actual con 0 si no hay guardado",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  if (d === null || d === undefined) return null;\n",
        reemplazo: "  if (d === null || d === undefined) return recortarDesfase(actualMs) === 0 ? null : 0;\n",
      },
    ],
    esperados: ["cue_e4b_desfase_al_usar", "cr15_usar_aplica_el_desfase_guardado_o_deja_el_actual"],
  },
  {
    id: "N9",
    que: "texto viejo de la línea de estado",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "    case 'lista': return conContexto ? `Listo: ${q} · ${c}${cues}.` : `${q} · ${c}${cues}. Se abre al cargar una pista o al activar un cue.`;\n",
        reemplazo: "    case 'lista': return conContexto ? `Listo: ${q} · ${c}${cues}.` : `${q} · ${c}${cues}. Se abre al activar un cue.`;\n",
      },
    ],
    esperados: ["cue_texto_estado_cue", "cue_texto_cues_activos_y_estado", "cr1_restaura_sin_abrir_nada"],
  },
  {
    id: "N10",
    que: "la página no pasa la salida que falta al deck (cueFalta=null): sin motivo «conecta X»",
    cambios: [
      {
        archivo: "music-client/src/dj/DjPage.jsx",
        ancla: "            cueActivo={!!cue?.activo[lado]} cueEstado={cue?.estado ?? null} cueFalta={cueFalta} onCue={alternarCue} />\n",
        reemplazo: "            cueActivo={!!cue?.activo[lado]} cueEstado={cue?.estado ?? null} cueFalta={null} onCue={alternarCue} />\n",
      },
    ],
    esperados: ["cr13_motivo_visible_con_cue_deshabilitado"],
  },
];
