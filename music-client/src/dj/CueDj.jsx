import { useEffect, useRef, useState } from 'react';
import { crearListaSalidas } from './motor/salidas.js';
import { nombresVisibles, decidirEleccion, textoListaSalidas, textoEstadoCue, textoAviso } from './motor/cue.js';

// MODO DJ · «Audífonos (cue)» (sub-paso e3a): elegir la salida de audífonos y sus canales. Sin botones de
// cue por deck, sin volumen ni desfase en pantalla (e3b) y sin recordar la salida (e4).
//  · El estado del cue es del MOTOR: se lee motor.cue() en cada render (la consola se re-renderiza con los
//    avisos del motor) y la UI no guarda copia. Lo único local: la salida y los canales marcados en los
//    controles, la confirmación pendiente y el aviso de una salida que desapareció.
//  · La LISTA de salidas es de salidas.js (permiso de micrófono sólo para leer los nombres; devicechange).
//  · NADA se aplica al cambiar el selector o los canales: con el foco en un <select> o en un botón de
//    opción, las flechas y las letras (también la M y la F) cambian la opción, porque el filtro de teclas
//    de DjPage y los atajos globales ignoran los campos. Se aplica con «Usar», que después suelta el foco
//    (blur) para que las teclas vuelvan a quedar tapadas. «Usar» hace UNA llamada:
//    fijarSalidaCue(id, nombre, { canales, abrir: true }); el motor decide si rearma sólo la etapa de
//    canales (misma salida) o hace setSinkId (otra salida). La UI nunca llama a null antes de cambiar.
//  · Con '1-2' en la salida del master se pide confirmación («Usarla igual»); con '3-4', no (la DDJ-400).
//  · devicechange: si la salida elegida ya no está en la lista, SIEMPRE fijarSalidaCue(null) y el aviso
//    'no-conectada', aunque el contexto de cue esté abierto (no se sabe qué hace Edge al desenchufar: podría
//    caer a la salida predeterminada, que es la del master). Salvo con el cue en 'error': ahí queda el aviso
//    del motor, sin duplicar.

const CANALES = ['1-2', '3-4'];
const CON_BOTON = new Set(['inactivo', 'denegado', 'sin-microfono', 'error']);
const TEXTO_AYUDA = 'Canales 1-2: audífonos o una tarjeta de sonido aparte. Canales 3-4: la salida de audífonos de una mezcladora DJ, como la DDJ-400.';
const TEXTO_OJO = 'Ojo: en una tarjeta de sonido de varios canales (por ejemplo una Sound Blaster), los canales 3-4 son el centro y el subwoofer, no unos audífonos.';
const CUE_VACIO = Object.freeze({ salida: null, nombre: '', canales: '1-2', estado: 'sin-salida', aviso: null });

export default function CueDj({ motor, refrescar }) {
  const motorRef = useRef(motor);
  motorRef.current = motor;
  const listaRef = useRef(null);
  const [lista, setLista] = useState({ estado: 'inactivo', salidas: [], error: null });
  const [elegido, setElegido] = useState('');
  const [canales, setCanales] = useState('1-2');
  const [confirmar, setConfirmar] = useState(null);   // { id, nombre, canales } esperando «Usarla igual»
  const [avisoUi, setAvisoUi] = useState(null);       // la salida elegida desapareció (devicechange)

  useEffect(() => {
    // Tras cada enumeración: ¿sigue la salida que tiene el motor? (ver la cabecera)
    const revisar = (e) => {
      if (e.estado !== 'lista' && e.estado !== 'vacia') return;
      const m = motorRef.current;
      const c = m?.cue();
      if (!c?.salida || e.salidas.some((s) => s.id === c.salida)) return;
      if (c.estado === 'error') return;
      m.fijarSalidaCue(null);
      setConfirmar(null);
      setAvisoUi(textoAviso('no-conectada', c.nombre));
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
  const textoEstado = textoEstadoCue(c.estado, c.nombre, c.canales, conContexto);

  const aplicar = (id, nombre, can) => {
    setConfirmar(null);
    setAvisoUi(null);
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
    motor?.fijarSalidaCue(null);
    refrescar();
  };

  return (
    <section className="dj-cue" aria-label="Audífonos (cue)" data-estado={c.estado} data-lista={lista.estado}
      data-salida={c.salida ?? ''} data-canales={c.canales} data-contexto={conContexto ? '1' : '0'}>
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
        </>
      ) : (
        <div className="dj-cue-fila">
          {textoLista && <p className="dj-cue-ayuda dj-cue-lista-texto">{textoLista}</p>}
          {CON_BOTON.has(lista.estado) && (
            <button type="button" className="dj-btn dj-cue-ver" onClick={() => listaRef.current?.pedir()}>Ver salidas de audio</button>
          )}
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
    </section>
  );
}
