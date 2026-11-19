import { useEffect, useRef, useState } from 'react';
import { crearListaSalidas } from './motor/salidas.js';
import {
  nombresVisibles, decidirEleccion, textoListaSalidas, textoEstadoCue, textoAviso,
  VOLUMEN_CUE_INICIAL, DESFASE_MAX_MS, recortarDesfase, textoDesfase, crearDiferido, pistaMezcladora,
  CLAVE_CUE, crearAlmacen, leerCueGuardado, serializarCue, cueVacio, recordarActual, olvidarActual, recordarDesfase, migrarId,
  decidirRestauracion, decidirVuelta,
} from './motor/cue.js';
import ControlDj, { num } from './ControlDj.jsx';

// MODO DJ · «Audífonos (cue)» (sub-paso e3a): elegir la salida de audífonos y sus canales. Sub-paso e3b: el
// volumen y el desfase del cue (los botones «Cue» están en cada deck, DjPage.jsx). Sub-paso e4a: recuerda la salida,
// sus canales y el desfase de cada salida entre recargas (localStorage, ver RECORDAR abajo y el esquema en cue.js).
//  · El estado del cue es del MOTOR: se lee motor.cue() en cada render (la consola se re-renderiza con los
//    avisos del motor) y la UI no guarda copia. Lo único local: la salida y los canales marcados en los
//    controles, la confirmación pendiente, el aviso de una salida que desapareció (o que volvió) y el
//    desfase mientras hay uno sin aplicar.
//  · La LISTA de salidas es de salidas.js (permiso de micrófono sólo para leer los nombres; devicechange).
//  · NADA se aplica al cambiar el selector o los canales: con el foco en un <select> o en un botón de
//    opción, las flechas y las letras (también la M y la F) cambian la opción, porque el filtro de teclas
//    de DjPage y los atajos globales ignoran los campos. Se aplica con «Usar», que después suelta el foco
//    (blur) para que las teclas vuelvan a quedar tapadas. «Usar» hace UNA llamada:
//    fijarSalidaCue(id, nombre, { canales, abrir: true }); el motor decide si rearma sólo la etapa de
//    canales (misma salida) o hace setSinkId (otra salida). La UI nunca llama a null antes de cambiar.
//  · Con '1-2' en la salida del master se pide confirmación («Usarla igual»); con '3-4', no (la DDJ-400).
//    Con '1-2' y una salida cuyo nombre contiene «DDJ», una pista sugiere 3-4 sin elegir nada (e3b).
//  · devicechange: si la salida elegida ya no está en la lista, SIEMPRE fijarSalidaCue(null) y el aviso
//    'no-conectada', aunque el contexto de cue esté abierto (no se sabe qué hace Edge al desenchufar: podría
//    caer a la salida predeterminada, que es la del master). Salvo con el cue en 'error': ahí queda el aviso
//    del motor, sin duplicar. Una desconexión NUNCA toca lo guardado.
//    LA QUE FALTÓ VUELVE (decidirVuelta, con elegirGuardada; e4a reemplaza a buscarVuelta): sólo si el motor sigue
//    sin otra salida (o en el 'error' de ésa, que se limpia con fijarSalidaCue(null)); el aviso viejo se quita solo.
//      · MISMO id → se rearma sola: fijarSalidaCue SIN abrir (el contexto lo abre el próximo Cue o «Cargar») y con
//        los cues apagados, «Volvió "X". Cue listo (apagado).» Con '1-2' y la salida del master → la confirmación.
//      · sólo el nombre crudo (único) → preseleccionada y «"X" volvió: pulsa "Usar"…», como en e3b.
//      · ambigua → nada.
//    Un error de otro tipo con la salida siempre en la lista no se toca.
//  · RECORDAR (e4a). Clave CLAVE_CUE, por cue.js (crearAlmacen: ningún acceso a localStorage lanza; sin storage la
//    página es la de e3b). Se ESCRIBE: la salida (id, nombre CRUDO, canales) sólo cuando «Usar» termina con ok;
//    el desfase de la salida en uso al aplicarse; el id nuevo tras restaurar por nombre. «Quitar» (cualquiera de los
//    dos botones) olvida la salida y conserva los desfases. Nunca el cue encendido ni el volumen (siempre 0,50).
//    Se RESTAURA una vez por motor (StrictMode crea, cierra y recrea el motor: se restaura sobre el VIVO), con la
//    lista leída (sin permiso de micrófono no hay nombres: queda el botón y se restaura al pulsarlo), y sólo si el
//    motor sigue sin salida (decidirRestauracion):
//      · 'restaurar' → preselecciona, fijarSalidaCue SIN abrir + fijarDesfaseCue: cero contextos y cero setSinkId
//        al montar (sin gesto el contexto quedaría 'suspended' y abrirCue fallaría a los 2 s). El primer «Cargar»
//        lo abre (motor.abrirSalidaCue, DjPage.jsx), o el primer Cue.
//      · 'confirmar' ('1-2' en la salida del master) → la confirmación de siempre; no se aplica nada.
//      · 'ambigua' / 'ausente' → un aviso y lo guardado intacto; la ausente queda esperando su vuelta (arriba).
//  · VOLUMEN: fijarVolumenCue(v) al instante (el motor aplica v² con rampa: no corta). Doble clic: 0,50.
//  · DESFASE (cada aplicación resincroniza y corta el cue un instante): con el ratón se aplica AL SOLTAR (el
//    patrón del seek del deck); flechas sobre el control y botones ±1: diferido de DEBOUNCE_DESFASE_MS, una
//    sola aplicación por ráfaga; doble clic: 0 al instante. El valor en pantalla es local mientras haya algo
//    sin aplicar; el diferido se cancela al desmontar.
//  · Volumen y desfase usan ControlDj con la clase base 'dj-cue-control' (no 'dj-control': ésos son los
//    cuatro de la Mezcla). Se ven con una salida elegida y sin 'error'.

const CANALES = ['1-2', '3-4'];
const CON_BOTON = new Set(['inactivo', 'denegado', 'sin-microfono', 'error']);
const TEXTO_AYUDA = 'Canales 1-2: audífonos o una tarjeta de sonido aparte. Canales 3-4: la salida de audífonos de una mezcladora DJ, como la DDJ-400.';
const TEXTO_OJO = 'Ojo: en una tarjeta de sonido de varios canales (por ejemplo una Sound Blaster), los canales 3-4 son el centro y el subwoofer, no unos audífonos.';
const TEXTO_DESFASE = '+ = los audífonos suenan más tarde que el master. Cada cambio corta el cue un instante.';
export const DEBOUNCE_DESFASE_MS = 150;
const CUE_VACIO = Object.freeze({ salida: null, nombre: '', canales: '1-2', estado: 'sin-salida', aviso: null,
  activo: Object.freeze({ A: false, B: false }), volumen: VOLUMEN_CUE_INICIAL, desfaseMs: 0 });

// e4a: lo guardado. window.localStorage se lee DENTRO del almacén (puede lanzar). Cada escritura relee lo guardado y
// cambia sólo lo suyo; si lo que había no se podía leer (otra versión, roto), una acción del usuario lo reemplaza.
const ALMACEN = crearAlmacen(() => window.localStorage);
const leerGuardado = () => leerCueGuardado(ALMACEN.leer(CLAVE_CUE));
const guardar = (cambio) => { ALMACEN.escribir(CLAVE_CUE, serializarCue(cambio(leerGuardado() ?? cueVacio()))); };

export default function CueDj({ motor, refrescar }) {
  const motorRef = useRef(motor);
  motorRef.current = motor;
  const refrescarRef = useRef(refrescar);
  refrescarRef.current = refrescar;
  const listaRef = useRef(null);
  const [lista, setLista] = useState({ estado: 'inactivo', salidas: [], error: null });
  const [elegido, setElegido] = useState('');
  const [canales, setCanales] = useState('1-2');
  const [confirmar, setConfirmar] = useState(null);   // { id, nombre, canales, cruda } esperando «Usarla igual»
  const [avisoUi, setAvisoUi] = useState(null);       // la elegida desapareció (devicechange) o la guardada no está (e4a)
  const [volvio, setVolvio] = useState(null);         // e3b: la que faltaba volvió («pulsa "Usar"» o «Cue listo»)
  // e3b/e4a: { id, nombre CRUDO, canales, tipo: 'ui' | 'motor' | 'guardada' } de la que faltó (o la guardada ausente).
  const faltaRef = useRef(null);
  const ultimasRef = useRef([]);                      // e4a: la lista anterior (para el nombre crudo de la que falta)
  const restauradoRef = useRef(null);                 // e4a: el motor sobre el que ya se intentó restaurar

  // Desfase (e3b): el valor sin aplicar (null = el del motor), su espejo para el pointerup y el diferido.
  const [desfaseLocal, setDesfaseLocal] = useState(null);
  const desfaseRef = useRef(null);
  const arrastrandoRef = useRef(false);
  const soltarRef = useRef(null);                     // quita los oyentes de window del arrastre en curso
  const aplicarDesfaseRef = useRef(null);
  aplicarDesfaseRef.current = (d) => {
    desfaseRef.current = null;
    setDesfaseLocal(null);
    const m = motorRef.current;
    if (!m?.fijarDesfaseCue(d)) return;
    // e4a: el desfase queda guardado para la salida en uso (por id, con su nombre crudo de la lista).
    const id = m.cue().salida;
    if (id) {
      const nombre = listaRef.current?.estado().salidas.find((s) => s.id === id)?.nombre ?? '';
      guardar((g) => recordarDesfase(g, { id, nombre }, d));
    }
    refrescarRef.current?.();
  };
  const diferidoRef = useRef(null);
  if (!diferidoRef.current) diferidoRef.current = crearDiferido((d) => aplicarDesfaseRef.current(d), DEBOUNCE_DESFASE_MS);
  useEffect(() => () => { diferidoRef.current?.cancelar(); soltarRef.current?.(); }, []);

  useEffect(() => {
    // Tras cada enumeración: ¿sigue la salida que tiene el motor? ¿volvió la que faltaba? (ver la cabecera)
    const revisar = (e) => {
      if (e.estado !== 'lista' && e.estado !== 'vacia') return;
      const m = motorRef.current;
      if (!m || m.cerrado) return;
      const c = m.cue();
      const f = faltaRef.current;
      if (f) {
        const v = decidirVuelta(f, e.salidas);
        if (v.accion !== 'nada') {
          faltaRef.current = null;
          // Sólo si nadie eligió otra cosa mientras tanto: el 'error' del motor con esa salida, o el motor sin salida.
          const vigente = f.tipo === 'motor' ? c.estado === 'error' && c.salida === f.id : c.estado === 'sin-salida' && !c.salida;
          if (!vigente) return;
          if (f.tipo === 'motor') m.fijarSalidaCue(null);
          const visible = nombresVisibles(e.salidas)[e.salidas.indexOf(v.salida)];
          setConfirmar(null);
          setAvisoUi(null);
          setElegido(v.salida.id);
          if (v.accion === 'rearmar') {
            // Mismo id: se rearma SIN abrir (ni setSinkId ni contexto) y con los cues apagados (el null de la
            // desconexión, o el fallo, ya los apagó). El contexto lo abre el próximo Cue o «Cargar».
            setCanales(v.canales);
            m.fijarSalidaCue(v.salida.id, visible, { canales: v.canales });
            setVolvio(textoAviso('volvio-lista', visible));
          } else if (v.accion === 'confirmar') {
            setCanales(v.canales);
            setVolvio(null);
            setConfirmar({ id: v.salida.id, nombre: visible, canales: v.canales, cruda: v.salida.nombre });
          } else {
            setVolvio(textoAviso('volvio', visible));
          }
          return;
        }
      }
      if (!c.salida || e.salidas.some((s) => s.id === c.salida)) return;
      // El nombre CRUDO de la que falta sale de la lista anterior (el del motor es el visible).
      const nombre = ultimasRef.current.find((s) => s.id === c.salida)?.nombre ?? c.nombre;
      if (c.estado === 'error') { faltaRef.current = { id: c.salida, nombre, canales: c.canales, tipo: 'motor' }; return; }
      m.fijarSalidaCue(null);
      faltaRef.current = { id: c.salida, nombre, canales: c.canales, tipo: 'ui' };
      setConfirmar(null);
      setVolvio(null);
      setAvisoUi(textoAviso('no-conectada', c.nombre));
    };
    const l = crearListaSalidas({
      alCambiar: () => {
        const e = l.estado();
        setLista(e);
        revisar(e);
        if (e.estado === 'lista' || e.estado === 'vacia') ultimasRef.current = e.salidas;
      },
    });
    listaRef.current = l;
    setLista(l.estado());
    l.autoListar();
    return () => {
      l.cerrar();
      if (listaRef.current === l) listaRef.current = null;
    };
  }, []);

  // e4a: restaurar lo guardado, UNA vez por motor y sobre el vivo (StrictMode cierra el primero), con la lista leída.
  useEffect(() => {
    if (!motor || motor.cerrado || restauradoRef.current === motor) return;
    if (lista.estado !== 'lista' && lista.estado !== 'vacia') return;   // sin nombres: espera al botón de permiso
    restauradoRef.current = motor;
    const ahora = motor.cue();
    if (ahora.salida || ahora.estado !== 'sin-salida') return;          // ya hay otra cosa elegida: no se pisa
    const g = leerGuardado();
    const d = decidirRestauracion({ guardado: g, estadoLista: lista.estado, salidas: lista.salidas });
    if (d.accion === 'ambigua' || d.accion === 'ausente') {
      setAvisoUi(textoAviso(d.accion === 'ambigua' ? 'guardada-ambigua' : 'guardada-ausente', d.nombre));
      if (d.accion === 'ausente') faltaRef.current = { ...g.actual, tipo: 'guardada' };
      return;
    }
    if (d.accion !== 'restaurar' && d.accion !== 'confirmar') return;
    const visible = nombresVisibles(lista.salidas)[lista.salidas.indexOf(d.salida)];
    setElegido(d.salida.id);
    setCanales(d.canales);
    if (d.accion === 'confirmar') {
      setConfirmar({ id: d.salida.id, nombre: visible, canales: d.canales, cruda: d.salida.nombre });
      return;
    }
    // SIN abrir: ni contexto ni setSinkId hasta el primer «Cargar» o Cue. Cues apagados y volumen 0,50 (los del motor nuevo).
    motor.fijarSalidaCue(d.salida.id, visible, { canales: d.canales });
    if (d.desfaseMs !== null) motor.fijarDesfaseCue(d.desfaseMs);
    if (d.idNuevo) guardar((x) => migrarId(x, g.actual.id, d.idNuevo));
    refrescarRef.current?.();
  }, [motor, lista]);

  const c = motor?.cue() ?? CUE_VACIO;
  const conContexto = !!motor?.contextoCue();
  const visibles = nombresVisibles(lista.salidas);
  const sel = lista.salidas.some((s) => s.id === elegido) ? elegido : '';
  const textoLista = textoListaSalidas(lista.estado, lista.error);
  const textoEstado = textoEstadoCue(c.estado, c.nombre, c.canales, conContexto, c.activo);
  const pista = pistaMezcladora(lista.salidas.find((s) => s.id === sel)?.nombre, canales);
  const desfaseVista = desfaseLocal ?? c.desfaseMs;

  const olvidarFalta = () => { faltaRef.current = null; setVolvio(null); };
  // `cruda`: el nombre de filtrarSalidas (el que se guarda); `nombre`: el visible (el del motor y los avisos).
  const aplicar = (id, nombre, can, cruda) => {
    setConfirmar(null);
    setAvisoUi(null);
    olvidarFalta();
    const pedido = motor?.fijarSalidaCue(id, nombre, { canales: can, abrir: true });   // dentro del clic: abre el contexto
    // e4a: se recuerda SÓLO si terminó bien (un «Usar» que falla no pisa la salida buena guardada).
    pedido?.then((r) => { if (r?.ok) guardar((g) => recordarActual(g, { id, nombre: cruda, canales: can })); });
    refrescar();
  };
  const usar = (e) => {
    e.currentTarget.blur();
    const i = lista.salidas.findIndex((s) => s.id === sel);
    if (i < 0 || !motor) return;
    const s = lista.salidas[i];
    if (decidirEleccion(s, canales) === 'confirmar-misma-salida') { setConfirmar({ id: s.id, nombre: visibles[i], canales, cruda: s.nombre }); return; }
    aplicar(s.id, visibles[i], canales, s.nombre);
  };
  const usarIgual = (e) => {
    e.currentTarget.blur();
    if (confirmar) aplicar(confirmar.id, confirmar.nombre, confirmar.canales, confirmar.cruda);
  };
  const quitar = (e) => {
    e.currentTarget.blur();
    setConfirmar(null);
    setAvisoUi(null);
    olvidarFalta();
    motor?.fijarSalidaCue(null);
    guardar(olvidarActual);   // e4a: olvida la salida; los desfases quedan
    refrescar();
  };

  // ── Volumen y desfase (e3b) ──
  const cambiarVolumen = (v) => { if (motor?.fijarVolumenCue(v)) refrescar(); };
  const ponerDesfase = (v) => {
    const d = recortarDesfase(v);
    if (d === null) return null;
    desfaseRef.current = d;
    setDesfaseLocal(d);
    return d;
  };
  // onChange del control: arrastrando con el ratón sólo se mueve el número (se aplica al soltar); con el
  // teclado (flechas, Inicio, Fin…), diferido.
  const cambiarDesfase = (v) => {
    const d = ponerDesfase(v);
    if (d !== null && !arrastrandoRef.current) diferidoRef.current.pedir(d);
  };
  // El fin del arrastre se escucha en window: el puntero puede soltarse fuera del control.
  const apretarDesfase = () => {
    soltarRef.current?.();
    diferidoRef.current.cancelar();
    arrastrandoRef.current = true;
    const fin = () => {
      soltarRef.current?.();
      if (!arrastrandoRef.current) return;
      arrastrandoRef.current = false;
      const d = desfaseRef.current;
      if (d === null) return;
      if (d !== motorRef.current?.cue().desfaseMs) aplicarDesfaseRef.current(d);
      else { desfaseRef.current = null; setDesfaseLocal(null); }
    };
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
    soltarRef.current = () => {
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      soltarRef.current = null;
    };
  };
  const desfaseCero = () => { diferidoRef.current.cancelar(); aplicarDesfaseRef.current(0); };
  const pasoDesfase = (delta) => {
    const d = ponerDesfase((desfaseRef.current ?? c.desfaseMs) + delta);
    if (d !== null) diferidoRef.current.pedir(d);
  };

  const activos = `${c.activo?.A ? 'A' : ''}${c.activo?.B ? 'B' : ''}`;
  return (
    <section className="dj-cue" aria-label="Audífonos (cue)" data-estado={c.estado} data-lista={lista.estado}
      data-salida={c.salida ?? ''} data-canales={c.canales} data-contexto={conContexto ? '1' : '0'}
      data-activo={activos} data-volumen={c.volumen} data-desfase={c.desfaseMs}>
      <div className="dj-cue-cabeza">
        <h2 className="dj-cue-titulo">Audífonos (cue)</h2>
        {textoEstado && <span className="dj-cue-estado" role="status">{textoEstado}</span>}
      </div>

      {lista.estado === 'lista' ? (
        <>
          <div className="dj-cue-fila">
            <select className="dj-cue-salida" aria-label="Salida de audífonos" value={sel} onChange={(e) => setElegido(e.target.value)}>
              <option value="" disabled>Elige una salida…</option>
              {lista.salidas.map((s, i) => (
                <option key={s.id} value={s.id}>{visibles[i]}{s.esMaster ? ' · la misma del master' : ''}</option>
              ))}
            </select>
            <fieldset className="dj-cue-canales">
              <legend className="dj-cue-leyenda">Canales</legend>
              {CANALES.map((v) => (
                <label key={v} className="dj-cue-canal">
                  <input type="radio" name="dj-cue-canales" value={v} checked={canales === v} onChange={() => setCanales(v)} />
                  {v}
                </label>
              ))}
            </fieldset>
            <button type="button" className="dj-btn dj-cue-usar" disabled={!sel} onClick={usar}>Usar</button>
            {c.salida && <button type="button" className="dj-btn dj-cue-quitar" onClick={quitar}>Quitar</button>}
          </div>
          <p className="dj-cue-ayuda">{TEXTO_AYUDA}</p>
          {canales === '3-4' && <p className="dj-cue-ayuda dj-cue-ojo">{TEXTO_OJO}</p>}
          {pista && <p className="dj-cue-ayuda dj-cue-pista">{pista}</p>}
        </>
      ) : (
        <div className="dj-cue-fila">
          {textoLista && <p className="dj-cue-ayuda dj-cue-lista-texto">{textoLista}</p>}
          {CON_BOTON.has(lista.estado) && (
            <button type="button" className="dj-btn dj-cue-ver" onClick={() => listaRef.current?.pedir()}>Ver salidas de audio</button>
          )}
        </div>
      )}

      {c.salida && c.estado !== 'error' && (
        <div className="dj-cue-ajustes">
          <ControlDj base="dj-cue-control" clase="dj-cue-vol" etiqueta="Volumen" min={0} max={1} valor={c.volumen} porDefecto={VOLUMEN_CUE_INICIAL}
            texto={num(c.volumen)} onCambio={cambiarVolumen} />
          <div className="dj-cue-desfase-caja">
            <ControlDj base="dj-cue-control" clase="dj-cue-desfase" etiqueta="Desfase" min={-DESFASE_MAX_MS} max={DESFASE_MAX_MS} paso="1"
              valor={desfaseVista} porDefecto={0} texto={textoDesfase(desfaseVista)} extremos={['Antes', 'Después']}
              onCambio={cambiarDesfase} onPorDefecto={desfaseCero} entrada={{ onPointerDown: apretarDesfase }} />
            <div className="dj-cue-pasos">
              <button type="button" className="dj-btn dj-cue-paso dj-cue-menos" aria-label="Desfase −1 ms" onClick={() => pasoDesfase(-1)}>−1</button>
              <button type="button" className="dj-btn dj-cue-paso dj-cue-mas" aria-label="Desfase +1 ms" onClick={() => pasoDesfase(1)}>+1</button>
              <span className="dj-cue-ayuda-desfase">{TEXTO_DESFASE}</span>
            </div>
          </div>
        </div>
      )}

      {confirmar && (
        <div className="dj-cue-aviso dj-cue-confirmacion" role="alert">
          <p>{textoAviso('misma-salida')}</p>
          <div className="dj-deck-aviso-acciones">
            <button type="button" className="dj-btn dj-cue-confirmar" onClick={usarIgual}>Usarla igual</button>
            <button type="button" className="dj-btn dj-cue-cancelar" onClick={() => setConfirmar(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {c.estado === 'error' && c.aviso && (
        <div className="dj-cue-aviso dj-cue-aviso-motor" role="alert">
          <p>{c.aviso}</p>
          <button type="button" className="dj-btn dj-cue-quitar-error" onClick={quitar}>Quitar salida</button>
        </div>
      )}
      {avisoUi && (
        <div className="dj-cue-aviso dj-cue-aviso-ui" role="alert">
          <p>{avisoUi}</p>
          <button type="button" className="dj-btn dj-cue-cerrar" onClick={() => setAvisoUi(null)}>Cerrar</button>
        </div>
      )}
      {volvio && <p className="dj-cue-ayuda dj-cue-volvio" role="status">{volvio}</p>}
    </section>
  );
}
