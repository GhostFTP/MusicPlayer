// El chip de la radio en la barra del reproductor (1.46.0, R3): «Tu radio» para quien transmite y «En la radio de
// <nombre>» para quien escucha (o modera). Tocarlo abre el apartado Radio. Fuera de una radio no se pinta.
//
// Se monta DOS veces y el CSS muestra una: en la barra de escritorio, al principio de las acciones (.radio-chip--barra);
// en la barra pequeña del teléfono, como una línea más debajo del artista (.radio-chip--mini), para no tapar ni mover
// los botones del borde derecho.
//
// POR QUÉ UN COMPONENTE APARTE (como RadioPasos.jsx): el valor de la radio cambia cada ~2 s mientras hay una (la lista
// de oyentes de cada lectura) y Player.jsx es grande; así solo se re-renderiza el chip.
// El clic no sigue viaje: la barra y la mini-barra abren el expandido al tocarlas.
// Con poco ancho el texto se corta con …: el title lleva el texto entero (y el nombre accesible es el texto entero).
import { useRadio } from '../context/RadioContext.jsx';

const FASES = new Set(['anfitrion', 'terminando', 'oyente']);

export function textoDelChip(fase, nombre) {
  if (!FASES.has(fase)) return null;
  return fase === 'oyente' ? `En la radio de ${nombre || 'alguien'}` : 'Tu radio';
}

export default function RadioChip({ navigate, className = '' }) {
  const { fase, anfitrion } = useRadio();
  const texto = textoDelChip(fase, anfitrion?.name);
  if (!texto) return null;
  return (
    <button type="button" className={`radio-chip ${className}`} title={`${texto} · Abrir Radio`} data-radio-chip={fase === 'oyente' ? 'oyente' : 'anfitrion'}
      onClick={(e) => { e.stopPropagation(); navigate('radio'); }}>
      <span className="radio-chip-punto" aria-hidden="true"></span>
      <span className="radio-chip-texto">{texto}</span>
    </button>
  );
}
