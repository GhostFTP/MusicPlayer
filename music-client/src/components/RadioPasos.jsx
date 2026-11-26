// «Anterior» y «Siguiente» del reproductor (barra de escritorio, expandido y mini-barra del teléfono) cuando
// estás en una radio (1.45.2). Fuera de una radio, y para quien transmite, son los botones de siempre: el mismo
// markup y el mismo next()/prev() del motor.
//
// En una radio, como oyente, cambiar de canción en tu reproductor no sirve: el corrector del oyente te devuelve a
// la de la radio a los DESAJUSTE_MS (RadioContext.jsx). Así que:
//   · quien MODERA una radio con órdenes: «Siguiente» manda la orden 'siguiente' a la radio (la MISMA de
//     «Siguiente canción de la radio» en Radio.jsx: ordenar('siguiente'), con su aviso de siempre); «Anterior»
//     no aplica a la radio → bloqueado, «La radio no tiene anterior»;
//   · quien solo ESCUCHA (o modera una radio sin órdenes): los dos bloqueados, «Estás en la radio de <nombre>».
// Play y pausa no se tocan (te silencian a ti, como hoy).
//
// POR QUÉ UN COMPONENTE APARTE y no useRadio() en Player.jsx: el valor de la radio cambia cada ~2 s mientras hay
// una (la lista de oyentes de cada lectura), y Player.jsx es grande. Así solo se re-renderizan estos botones.
//
// ACCESIBLE: el botón bloqueado usa aria-disabled (no disabled) para que siga recibiendo el foco y el lector lo
// encuentre; el motivo va como descripción (aria-describedby a un span oculto) y, a la vista, como título (title)
// o como el tooltip de la barra (`envolver`, que en la barra es su BarTip). Foco visible: .radio-paso.
// El NOMBRE sigue siendo «Anterior»/«Siguiente» también cuando manda la orden: «Siguiente canción de la radio» va
// como descripción y tooltip, para no repetir el nombre del botón de Radio.jsx (dos botones con el mismo nombre
// confunden al lector, y getByRole de las suites los distingue por nombre).
import { useId } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import { pasosDeLaBarra, TXT_SIGUIENTE_RADIO } from '../utils/radioSync.js';

/**
 * dir: 'prev' | 'next'. className: la clase del botón de siempre (ctrl-prev, exp-next, mini-next…).
 * label: su etiqueta de siempre («Anterior» / «Siguiente»). parar: stopPropagation en el clic (la barra y la
 * mini-barra abren el expandido al tocarlas). envolver(tip, boton): la barra lo usa para su BarTip; sin él, el
 * texto va como title.
 */
export default function BotonPaso({ dir, className, label, parar = false, envolver = null, children }) {
  const { next, prev } = usePlayer();
  const { fase, vistaMod, anfitrion, ordenando, esperaOrden, ordenar } = useRadio();
  const idMotivo = useId();
  const p = pasosDeLaBarra({ fase, modera: vistaMod?.modera, admite: vistaMod?.admite, anfitrion: anfitrion?.name });
  const modo = dir === 'next' ? p.siguiente : p.anterior;
  const motivo = dir === 'next' ? p.motivoSiguiente : p.motivoAnterior;
  const conTip = (tip, b) => (envolver ? envolver(tip, b) : b);

  if (modo === 'motor') {
    const b = (
      <button className={className} onClick={(e) => { if (parar) e.stopPropagation(); (dir === 'next' ? next : prev)(); }} aria-label={label}>
        {children}
      </button>
    );
    return conTip(label, b);
  }

  if (modo === 'radio') {
    // La orden 'siguiente' a la radio, como el botón de Radio.jsx: una en vuelo a la vez, nada durante un 429, y
    // sin el seq de la radio todavía (recién unido) no hay base para ordenar.
    const ocupado = !!ordenando?.siguiente;
    const enEspera = esperaOrden > 0;
    const sinBase = !vistaMod?.conBase;
    const b = (
      <button
        className={`${className} radio-paso radio-paso--radio`}
        data-paso="radio"
        onClick={(e) => { if (parar) e.stopPropagation(); if (!ocupado && !enEspera && !sinBase) ordenar('siguiente'); }}
        aria-label={label}
        aria-describedby={idMotivo}
        aria-busy={ocupado || undefined}
        aria-disabled={enEspera || sinBase || undefined}
        title={envolver ? undefined : TXT_SIGUIENTE_RADIO}
      >
        {children}
        <span id={idMotivo} hidden>{TXT_SIGUIENTE_RADIO}</span>
      </button>
    );
    return conTip(TXT_SIGUIENTE_RADIO, b);
  }

  // Bloqueado: enfocable, sin efecto, y dice por qué.
  const b = (
    <button
      className={`${className} radio-paso radio-paso--bloqueado`}
      data-paso="bloqueado"
      onClick={(e) => { if (parar) e.stopPropagation(); }}
      aria-label={label}
      aria-disabled="true"
      aria-describedby={idMotivo}
      title={envolver ? undefined : motivo}
    >
      {children}
      <span id={idMotivo} hidden>{motivo}</span>
    </button>
  );
  return conTip(motivo, b);
}
