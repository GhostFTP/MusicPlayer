import { useEffect, useRef, useState } from 'react';
import { crearListaSalidas } from './motor/salidas.js';
import {
  nombresVisibles, decidirEleccion, textoListaSalidas, textoEstadoCue, textoAviso,
  VOLUMEN_CUE_INICIAL, DESFASE_MAX_MS, recortarDesfase, textoDesfase, crearDiferido, buscarVuelta, pistaMezcladora,
} from './motor/cue.js';
import ControlDj, { num } from './ControlDj.jsx';

// MODO DJ · «Audífonos (cue)» (sub-paso e3a): elegir la salida de audífonos y sus canales. Sub-paso e3b: el
// volumen y el desfase del cue (los botones «Cue» están en cada deck, DjPage.jsx). Sin recordar la salida (e4).
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
//    del motor, sin duplicar. e3b: si esa salida que FALTÓ vuelve (mismo id o mismo nombre visible), el aviso
//    viejo (el de la página o el 'error' del motor, que se limpia con fijarSalidaCue(null)) se quita solo, la
//    salida queda preseleccionada y sale «"X" volvió: pulsa "Usar"…». NUNCA se vuelve a armar el cue (e4).
//    Un error de otro tipo con la salida siempre en la lista no se toca.
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

export default function CueDj({ motor, refrescar }) {
  const motorRef = useRef(motor);
  motorRef.current = motor;
  const refrescarRef = useRef(refrescar);
  refrescarRef.current = refrescar;
  const listaRef = useRef(null);
  const [lista, setLista] = useState({ estado: 'inactivo', salidas: [], error: null });
  const [elegido, setElegido] = useState('');
  const [canales, setCanales] = useState('1-2');
  const [confirmar, setConfirmar] = useState(null);   // { id, nombre, canales } esperando «Usarla igual»
  const [avisoUi, setAvisoUi] = useState(null);       // la salida elegida desapareció (devicechange)
  const avisoUiRef = useRef(null);
  avisoUiRef.current = avisoUi;
  const [volvio, setVolvio] = useState(null);         // e3b: la que faltaba volvió («pulsa "Usar"»)
  const faltaRef = useRef(null);                      // e3b: { id, nombre, tipo: 'ui' | 'motor', aviso } de la que faltó

  // Desfase (e3b): el valor sin aplicar (null = el del motor), su espejo para el pointerup y el diferido.
  const [desfaseLocal, setDesfaseLocal] = useState(null);
  const desfaseRef = useRef(null);
  const arrastrandoRef = useRef(false);
  const soltarRef = useRef(null);                     // quita los oyentes de window del arrastre en curso
  const aplicarDesfaseRef = useRef(null);
  aplicarDesfaseRef.current = (d) => {
    desfaseRef.current = null;
    setDesfaseLocal(null);
    if (motorRef.current?.fijarDesfaseCue(d)) refrescarRef.current?.();
  };
  const diferidoRef = useRef(null);
  if (!diferidoRef.current) diferidoRef.current = crearDiferido((d) => aplicarDesfaseRef.current(d), DEBOUNCE_DESFASE_MS);
  useEffect(() => () => { diferidoRef.current?.cancelar(); soltarRef.current?.(); }, []);

  useEffect(() => {
    // Tras cada enumeración: ¿sigue la salida que tiene el motor? ¿volvió la que faltaba? (ver la cabecera)
    const revisar = (e) => {
      if (e.estado !== 'lista' && e.estado !== 'vacia') return;
      const m = motorRef.current;
      const c = m?.cue();
      const f = faltaRef.current;
      if (f) {
        const id = buscarVuelta(f, e.salidas);
        if (id) {
          faltaRef.current = null;
          // Sólo si el aviso viejo sigue en pantalla: el 'error' del motor con esa salida, o el de la página.
          const vigente = f.tipo === 'motor' ? c?.estado === 'error' && c.salida === f.id : avisoUiRef.current === f.aviso;
          if (!vigente) return;
          if (f.tipo === 'motor') m.fijarSalidaCue(null);
          const i = e.salidas.findIndex((s) => s.id === id);
          setConfirmar(null);
          setAvisoUi(null);
          setElegido(id);
          setVolvio(textoAviso('volvio', nombresVisibles(e.salidas)[i]));
          return;
        }
      }
      if (!c?.salida || e.salidas.some((s) => s.id === c.salida)) return;
      if (c.estado === 'error') { faltaRef.current = { id: c.salida, nombre: c.nombre, tipo: 'motor', aviso: null }; return; }
      m.fijarSalidaCue(null);
      const aviso = textoAviso('no-conectada', c.nombre);
      faltaRef.current = { id: c.salida, nombre: c.nombre, tipo: 'ui', aviso };
      setConfirmar(null);
      setVolvio(null);
      setAvisoUi(aviso);
    };
    const l = crearListaSalidas({ alCambiar: () => { const e = l.estado(); setLista(e); revisar(e); } });
    listaRef.current = l;
    setLista(l.estado());
    l.autoListar();
    return () => {
      l.cerrar();
      if (listaRef.current === l) listaRef.current = null;
    };
  }, []);

  const c = motor?.cue() ?? CUE_VACIO;
  const conContexto = !!motor?.contextoCue();
  const visibles = nombresVisibles(lista.salidas);
  const sel = lista.salidas.some((s) => s.id === elegido) ? elegido : '';
  const textoLista = textoListaSalidas(lista.estado, lista.error);
  const textoEstado = textoEstadoCue(c.estado, c.nombre, c.canales, conContexto, c.activo);
  const pista = pistaMezcladora(lista.salidas.find((s) => s.id === sel)?.nombre, canales);
  const desfaseVista = desfaseLocal ?? c.desfaseMs;

  const olvidarFalta = () => { faltaRef.current = null; setVolvio(null); };
  const aplicar = (id, nombre, can) => {
    setConfirmar(null);
    setAvisoUi(null);
    olvidarFalta();
    motor?.fijarSalidaCue(id, nombre, { canales: can, abrir: true });   // dentro del clic: abre el contexto
    refrescar();
  };
  const usar = (e) => {
    e.currentTarget.blur();
    const i = lista.salidas.findIndex((s) => s.id === sel);
    if (i < 0 || !motor) return;
    const s = lista.salidas[i];
    if (decidirEleccion(s, canales) === 'confirmar-misma-salida') { setConfirmar({ id: s.id, nombre: visibles[i], canales }); return; }
    aplicar(s.id, visibles[i], canales);
  };
  const usarIgual = (e) => {
    e.currentTarget.blur();
    if (confirmar) aplicar(confirmar.id, confirmar.nombre, confirmar.canales);
  };
  const quitar = (e) => {
    e.currentTarget.blur();
    setConfirmar(null);
    setAvisoUi(null);
    olvidarFalta();
    motor?.fijarSalidaCue(null);
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
