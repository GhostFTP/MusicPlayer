// El chip de la radio en la barra del reproductor (1.46.0, R3): «Tu radio» para quien transmite y «Radio de <nombre>»
// para quien escucha (o modera). Tocarlo abre el apartado Radio. Fuera de una radio no se pinta.
// R4: el texto VISIBLE es el corto (con el largo se cortaba con … en la barra); el largo, «En la radio de <nombre>»,
// sigue como nombre accesible (aria-label, que empieza distinto pero dice lo mismo y más) y como title.
//
// Se monta DOS veces y el CSS muestra una: en la barra de escritorio, al principio de las acciones (.radio-chip--barra);
// en la barra pequeña del teléfono, como una línea más debajo del artista (.radio-chip--mini), para no tapar ni mover
// los botones del borde derecho.
//
// POR QUÉ UN COMPONENTE APARTE (como RadioPasos.jsx): el valor de la radio cambia cada ~2 s mientras hay una (la lista
// de oyentes de cada lectura) y Player.jsx es grande; así solo se re-renderiza el chip.
// El clic no sigue viaje: la barra y la mini-barra abren el expandido al tocarlas.
// Si aun así no cabe, se corta con …: el title y el nombre accesible llevan el texto entero.
import { useRadio } from '../context/RadioContext.jsx';

const FASES = new Set(['anfitrion', 'terminando', 'oyente']);

/** { corto, largo } del chip, o null fuera de una radio. */
export function textosDelChip(fase, nombre) {
  if (!FASES.has(fase)) return null;
  if (fase !== 'oyente') return { corto: 'Tu radio', largo: 'Tu radio' };
  const quien = nombre || 'alguien';
  return { corto: `Radio de ${quien}`, largo: `En la radio de ${quien}` };
}

export default function RadioChip({ navigate, className = '' }) {
  const { fase, anfitrion } = useRadio();
  const t = textosDelChip(fase, anfitrion?.name);
  if (!t) return null;
  return (
    <button type="button" className={`radio-chip ${className}`} aria-label={t.largo} title={`${t.largo} · Abrir Radio`} data-radio-chip={fase === 'oyente' ? 'oyente' : 'anfitrion'}
      onClick={(e) => { e.stopPropagation(); navigate('radio'); }}>
      <span className="radio-chip-punto" aria-hidden="true"></span>
      <span className="radio-chip-texto">{t.corto}</span>
    </button>
  );
}
