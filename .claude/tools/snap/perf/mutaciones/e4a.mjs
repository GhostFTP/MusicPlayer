// Mutaciones de control del sub-paso e4a (Modo DJ: recordar el cue entre recargas, localStorage djCue).
// SÓLO DATOS LITERALES (sin lógica): lo lee mutar.mjs, ver su cabecera. Cada `ancla` tiene que aparecer EXACTAMENTE una
// vez en su archivo, contando sobre el texto ya cambiado por los cambios anteriores de la MISMA mutación; si no, la
// mutación sale NO APLICÓ y no se toca nada.
// Migradas del driver de e4a (scratchpad). M8: su ancla cambió en e4b (faltaRef.current = … pasó a ponerFalta(…)) y se
// tomó la línea nueva con la misma intención. M4 la detectó dj-func sólo por 'excepcion' (la página quedó rota en cr9):
// sale como aviso POR EXCEPCIÓN, no hace falta listarla. Los `esperados` son los de la entrega de e4a, sobre su código.
export const suites = ['dj-unit', 'dj-func'];

export const mutaciones = [
  {
    id: "M1a",
    que: "emparejar por nombre VISIBLE (nombresVisibles) en vez del crudo único",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const { salida, motivo } = elegirGuardada(a, Array.isArray(salidas) ? salidas : []);\n",
        reemplazo: "  const _l = Array.isArray(salidas) ? salidas : []; const _v = nombresVisibles(_l); let salida = _l.find((s) => s.id === a.id) ?? null; let motivo = salida ? 'id' : 'ausente'; if (!salida && _v.includes(a.nombre)) { salida = _l[_v.indexOf(a.nombre)]; motivo = 'nombre'; }\n",
      },
    ],
    esperados: ["cue_e4_restaurar_empareja", "cr4_nombre_repetido_no_restaura_y_conserva"],
  },
  {
    id: "M1b",
    que: "emparejar por la PRIMERA coincidencia de nombre (sin exigir único)",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const { salida, motivo } = elegirGuardada(a, Array.isArray(salidas) ? salidas : []);\n",
        reemplazo: "  const _l = Array.isArray(salidas) ? salidas : []; let salida = _l.find((s) => s.id === a.id) ?? null; let motivo = salida ? 'id' : 'ausente'; if (!salida) { salida = _l.find((s) => s.nombre === a.nombre) ?? null; if (salida) motivo = 'nombre'; }\n",
      },
    ],
    esperados: ["cue_e4_restaurar_empareja", "cr4_nombre_repetido_no_restaura_y_conserva"],
  },
  {
    id: "M2a",
    que: "deducir '3-4' de maxChannelCount de la salida al restaurar",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const canales = validarCanales(a.canales) ?? '1-2';\n",
        reemplazo: "  const canales = salida.maxChannelCount >= 4 ? '3-4' : (validarCanales(a.canales) ?? '1-2');\n",
      },
    ],
    esperados: ["cue_e4_restaurar_permiso_master_y_canales"],
  },
  {
    id: "M2b",
    que: "deducir '3-4' de un maxChannelCount guardado al leer",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const canales = base ? validarCanales(a.canales) : null;   // sin canales → '1-2'; inválidos → se descarta\n",
        reemplazo: "  const canales = base ? validarCanales(a.canales ?? (a.maxChannelCount >= 4 ? '3-4' : undefined)) : null;\n",
      },
    ],
    esperados: ["cue_e4_leer_valida_y_descarta", "cue_e4_restaurar_permiso_master_y_canales"],
  },
  {
    id: "M3a",
    que: "restaurar el cue ENCENDIDO (fijarCue A y B al restaurar)",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    if (d.desfaseMs !== null) motor.fijarDesfaseCue(d.desfaseMs);\n",
        reemplazo: "    if (d.desfaseMs !== null) motor.fijarDesfaseCue(d.desfaseMs);\n    motor.fijarCue('A', true); motor.fijarCue('B', true);\n",
      },
    ],
    esperados: ["cr1_restaura_sin_abrir_nada", "cr3_id_cambiado_restaura_por_nombre_y_actualiza_el_id", "cr6_sin_permiso_no_restaura_hasta_el_boton", "cr8_master_con_12_confirma_y_34_no", "cr11_usar_recargar_y_quitar_ida_y_vuelta", "cr12_cue_encendido_y_volumen_no_se_restauran"],
  },
  {
    id: "M3b",
    que: "guardar el cue encendido (activo dentro de actual)",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  return JSON.stringify({ v: VERSION_CUE, actual: normalizarActual(g?.actual), salidas: normalizarSalidas(g?.salidas) });\n",
        reemplazo: "  return JSON.stringify({ v: VERSION_CUE, actual: normalizarActual(g?.actual) && { ...normalizarActual(g?.actual), activo: g?.actual?.activo ?? { A: false, B: false } }, salidas: normalizarSalidas(g?.salidas) });\n",
      },
    ],
    esperados: ["cue_e4_serializa_solo_el_esquema", "cr12_cue_encendido_y_volumen_no_se_restauran"],
  },
  {
    id: "M4",
    que: "quitar los try/catch del almacén",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  return {\n    leer(clave) {\n      try {\n        const s = storage();\n        if (!s) return null;\n        const v = s.getItem(clave);\n        return typeof v === 'string' ? v : null;\n      } catch { return null; }\n    },\n    escribir(clave, valor) {\n      try {\n        const s = storage();\n        if (!s) return false;\n        s.setItem(clave, valor);\n        return true;\n      } catch { return false; }\n    },\n  };\n",
        reemplazo: "  return {\n    leer(clave) { const s = storage(); if (!s) return null; const v = s.getItem(clave); return typeof v === 'string' ? v : null; },\n    escribir(clave, valor) { const s = storage(); if (!s) return false; s.setItem(clave, valor); return true; },\n  };\n",
      },
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const storage = () => {\n    try {\n      const s = obtener();\n      return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;\n    } catch { return null; }\n  };\n",
        reemplazo: "  const storage = () => { const s = obtener(); return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null; };\n",
      },
    ],
    esperados: ["cue_e4_almacen_nunca_lanza"],
  },
  {
    id: "M5",
    que: "abrir:true al restaurar (al montar)",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    motor.fijarSalidaCue(d.salida.id, visible, { canales: d.canales });\n",
        reemplazo: "    motor.fijarSalidaCue(d.salida.id, visible, { canales: d.canales, abrir: true });\n",
      },
    ],
    esperados: ["cr1_restaura_sin_abrir_nada", "cr3_id_cambiado_restaura_por_nombre_y_actualiza_el_id", "cr6_sin_permiso_no_restaura_hasta_el_boton", "cr8_master_con_12_confirma_y_34_no", "cr11_usar_recargar_y_quitar_ida_y_vuelta", "cr12_cue_encendido_y_volumen_no_se_restauran"],
  },
  {
    id: "M6",
    que: "aplicar el id guardado sin emparejar ni esperar el permiso",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    if (lista.estado !== 'lista' && lista.estado !== 'vacia') return;   // sin nombres: espera al botón de permiso\n",
        reemplazo: "    { const g0 = leerGuardado(); if (g0?.actual) { restauradoRef.current = motor; motor.fijarSalidaCue(g0.actual.id, g0.actual.nombre, { canales: g0.actual.canales }); refrescarRef.current?.(); return; } }\n    if (lista.estado !== 'lista' && lista.estado !== 'vacia') return;   // sin nombres: espera al botón de permiso\n",
      },
    ],
    esperados: ["cr1_restaura_sin_abrir_nada", "cr3_id_cambiado_restaura_por_nombre_y_actualiza_el_id", "cr4_nombre_repetido_no_restaura_y_conserva", "cr5_ausente_avisa_conserva_y_se_rearma_al_volver", "cr6_sin_permiso_no_restaura_hasta_el_boton", "cr7_permiso_denegado_no_restaura", "cr8_master_con_12_confirma_y_34_no", "cr11_usar_recargar_y_quitar_ida_y_vuelta"],
  },
  {
    id: "M7",
    que: "saltarse la confirmación de esMaster con 1-2",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  const accion = decidirEleccion(salida, canales) === 'confirmar-misma-salida' ? 'confirmar' : 'restaurar';\n",
        reemplazo: "  const accion = 'restaurar';\n",
      },
    ],
    esperados: ["cue_e4_restaurar_permiso_master_y_canales", "cr8_master_con_12_confirma_y_34_no"],
  },
  {
    id: "M8",
    que: "borrar lo guardado cuando no empareja (ausente)",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "      if (d.accion === 'ausente') ponerFalta({ ...g.actual, tipo: 'guardada', visible: g.actual.nombre });   // no está: su nombre crudo es el visible\n",
        reemplazo: "      if (d.accion === 'ausente') ponerFalta({ ...g.actual, tipo: 'guardada', visible: g.actual.nombre });   // no está: su nombre crudo es el visible\n      guardar(olvidarActual);\n",
      },
    ],
    esperados: ["cr4_nombre_repetido_no_restaura_y_conserva", "cr5_ausente_avisa_conserva_y_se_rearma_al_volver", "cr5b_vuelve_solo_por_nombre_pide_usar"],
  },
  {
    id: "M9",
    que: "guardar el volumen (serializar + escribir al moverlo)",
    cambios: [
      {
        archivo: "music-client/src/dj/motor/cue.js",
        ancla: "  return JSON.stringify({ v: VERSION_CUE, actual: normalizarActual(g?.actual), salidas: normalizarSalidas(g?.salidas) });\n",
        reemplazo: "  return JSON.stringify({ v: VERSION_CUE, actual: normalizarActual(g?.actual), salidas: normalizarSalidas(g?.salidas), volumen: finito(g?.volumen) ? g.volumen : undefined });\n",
      },
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "  const cambiarVolumen = (v) => { if (motor?.fijarVolumenCue(v)) refrescar(); };\n",
        reemplazo: "  const cambiarVolumen = (v) => { if (motor?.fijarVolumenCue(v)) { guardar((g) => ({ ...g, volumen: v })); refrescar(); } };\n",
      },
    ],
    esperados: ["cue_e4_serializa_solo_el_esquema", "cr12_cue_encendido_y_volumen_no_se_restauran"],
  },
  {
    id: "M10",
    que: "no actualizar el id tras restaurar por nombre",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "    if (d.idNuevo) guardar((x) => migrarId(x, g.actual.id, d.idNuevo));\n",
        reemplazo: "",
      },
    ],
    esperados: ["cr3_id_cambiado_restaura_por_nombre_y_actualiza_el_id"],
  },
  {
    id: "M11a",
    que: "la que vuelve con el mismo id ABRE el contexto (abrir:true)",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "            m.fijarSalidaCue(v.salida.id, visible, { canales: v.canales });\n",
        reemplazo: "            m.fijarSalidaCue(v.salida.id, visible, { canales: v.canales, abrir: true });\n",
      },
    ],
    esperados: ["ce14_volvio_mismo_id_se_rearma_sin_abrir", "ce15_volvio_quita_el_error_y_se_rearma", "cr5_ausente_avisa_conserva_y_se_rearma_al_volver", "cr5b_vuelve_solo_por_nombre_pide_usar"],
  },
  {
    id: "M11b",
    que: "la que vuelve con el mismo id ENCIENDE un cue",
    cambios: [
      {
        archivo: "music-client/src/dj/CueDj.jsx",
        ancla: "            m.fijarSalidaCue(v.salida.id, visible, { canales: v.canales });\n",
        reemplazo: "            m.fijarSalidaCue(v.salida.id, visible, { canales: v.canales });\n            m.fijarCue('A', true);\n",
      },
    ],
    esperados: ["ce14_volvio_mismo_id_se_rearma_sin_abrir", "ce15_volvio_quita_el_error_y_se_rearma", "cr5_ausente_avisa_conserva_y_se_rearma_al_volver", "cr5b_vuelve_solo_por_nombre_pide_usar"],
  },
];
