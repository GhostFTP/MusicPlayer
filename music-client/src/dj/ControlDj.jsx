// MODO DJ · un control deslizante con su nombre, su valor y (opcional) los extremos. Salió TAL CUAL de
// DjPage.jsx (era ControlMezcla, sub-paso c) en el sub-paso e3b, para que «Audífonos (cue)» (CueDj.jsx) use
// el mismo: la Mezcla lo usa sin ninguna de las props nuevas y su DOM no cambia.
//  · El <input> es CONTROLADO (value = valor): el setter y el render van en el mismo evento.
//  · Doble clic: onCambio(porDefecto); con `onPorDefecto`, ésa en su lugar (el desfase la aplica al instante).
//  · Props nuevas (e3b, opcionales): `base` (la clase del contenedor; por defecto 'dj-control'), `paso` (el
//    step; por defecto '0.01') y `entrada` (props extra del <input>, p. ej. onPointerDown).

// Un número con dos decimales, coma decimal y signo menos tipográfico (los valores de la Mezcla y el
// volumen del cue).
export const num = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2).replace('.', ',')}`;

export default function ControlDj({ clase, etiqueta, min, max, valor, porDefecto, texto, extremos, onCambio, onPorDefecto, base = 'dj-control', paso = '0.01', entrada }) {
  return (
    <div className={`${base} ${clase}`}>
      <div className="dj-control-cabeza">
        <span className="dj-control-nombre">{etiqueta}</span>
        <output className="dj-control-valor" data-valor={valor}>{texto}</output>
      </div>
      <input
        type="range" className="dj-control-rango" min={min} max={max} step={paso} value={valor}
        aria-label={etiqueta} aria-valuetext={texto} title="Doble clic: valor por defecto"
        onChange={(e) => onCambio(Number(e.target.value))}
        onDoubleClick={() => (onPorDefecto ? onPorDefecto() : onCambio(porDefecto))}
        {...entrada}
      />
      {extremos && (
        <div className="dj-control-extremos" aria-hidden="true"><span>{extremos[0]}</span><span>{extremos[1]}</span></div>
      )}
    </div>
  );
}
