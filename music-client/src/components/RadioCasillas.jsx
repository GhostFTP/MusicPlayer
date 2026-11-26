// El código de una radio en SEIS CASILLAS (1.46.0, R4), como en las maquetas 1-iniciar y 4-unirse.
//
// CasillasCodigo: el campo para escribirlo. Por dentro es UN solo <input> (encima de las casillas, invisible): así el
// teclado, pegar, el autocompletado, el lector de pantalla y el «Ir» del teclado del teléfono funcionan como en
// cualquier campo, y las casillas solo lo DIBUJAN. Lo que se escribe pasa por limpiarCodigoEscrito (mayúsculas solas,
// solo caracteres de código, seis como mucho) y pegar por codigoPegado (el código entero, aunque venga dentro de un
// mensaje): eso lo hace quien lo usa (Radio.jsx), igual que antes. El foco se ve en la casilla que sigue (lila).
//
// CodigoEnCasillas: el mismo dibujo, solo para leerlo (la ficha del enlace). El texto del nodo es el código entero.
import { LARGO_CODIGO } from '../utils/radioSync.js';

const POSICIONES = Array.from({ length: LARGO_CODIGO }, (_, i) => i);

export function CasillasCodigo({ id, value, onChange, onPaste, disabled = false, invalido = false, describedBy, inputRef, etiqueta }) {
  const lleno = value.length >= LARGO_CODIGO;
  return (
    <div className={`radio-casillas${disabled ? ' radio-casillas--off' : ''}${invalido ? ' radio-casillas--mal' : ''}${lleno ? ' radio-casillas--llenas' : ''}`}>
      <input
        id={id}
        ref={inputRef}
        className="radio-casillas-input"
        type="text"
        value={value}
        onChange={onChange}
        onPaste={onPaste}
        aria-label={etiqueta}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        disabled={disabled}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={describedBy}
      />
      <span className="radio-casillas-celdas" aria-hidden="true">
        {POSICIONES.map((i) => (
          <span key={i} className={`radio-casilla${value[i] ? ' radio-casilla--llena' : ''}${i === value.length ? ' radio-casilla--cursor' : ''}`}>
            {value[i] ?? ''}
          </span>
        ))}
      </span>
    </div>
  );
}

export function CodigoEnCasillas({ codigo }) {
  return (
    <p className="radio-codigo radio-codigo--casillas" aria-label={`Código ${codigo.split('').join(' ')}`}>
      {codigo.split('').map((c, i) => <span key={i} className="radio-casilla radio-casilla--llena">{c}</span>)}
    </p>
  );
}
