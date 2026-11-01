import { useState, useEffect } from 'react';
import BackButton from './BackButton.jsx';
import { limpiarCodigoEscrito, codigoPegado, normalizarCodigo, LARGO_CODIGO } from '../utils/radioSync.js';

// Vista Radio (fase 1, sub-paso 2): sólo las dos caras, sin red.
//  · /radio          → "sin radio": "Iniciar radio" (deshabilitado hasta el sub-paso 3) y el campo
//                      "Unirse con código", que navega a /radio/CODIGO.
//  · /radio/CODIGO   → placeholder con el código y Volver. Es un DETALLE como los de las otras vistas
//                      (setDetailOpen → swipe-atrás del teléfono; BackButton → history.back).
// El código sale de la ruta (routes.js ya lo normalizó). Un enlace con un código que no vale llega
// como { invalido: true } y Layout reescribe la URL a /radio: el aviso se guarda ACÁ, en estado, al
// consumir el target — no se vuelve a mirar la URL. Nada de esto toca el reproductor ni la red.

const AVISOS = {
  enlace: `Ese enlace no trae un código de radio válido. Escribe el código de ${LARGO_CODIGO} caracteres.`,
  corto: `El código tiene ${LARGO_CODIGO} caracteres.`,
  pegado: 'No hay un código en lo que pegaste.',
};

export default function Radio({ target, clearTarget, setDetailOpen, navigate }) {
  const [codigo, setCodigo] = useState(null);   // el de /radio/CODIGO; null = cara "sin radio"
  const [texto, setTexto] = useState('');       // lo escrito en el campo, ya limpio
  const [aviso, setAviso] = useState(null);     // clave de AVISOS, o null

  // Consumo del target de navegación (mismo contrato que las demás vistas): reset vuelve a la cara
  // "sin radio" (y tocar la pestaña activa además vacía el campo); { codigo } abre el detalle;
  // { invalido } deja la cara "sin radio" con el aviso. Un reset limpia el aviso: volver con
  // atrás/adelante a /radio no lo hace reaparecer.
  useEffect(() => {
    if (!target) return;
    if (target.reset) {
      setCodigo(null); setAviso(null);
      if (target.tab) setTexto('');
    } else if (target.codigo) {
      setCodigo(target.codigo); setAviso(null);
    } else if (target.invalido) {
      setCodigo(null); setAviso('enlace');
    }
    clearTarget();
  }, [target]);

  useEffect(() => { setDetailOpen(!!codigo); }, [codigo, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  const onChange = (e) => {
    setTexto(limpiarCodigoEscrito(e.target.value));
    setAviso(null);
  };
  // Pegar escribe un código válido o nada (como "Pegar código" en iOS): sin esto, pegar el mensaje
  // entero ("Escucha conmigo…") dejaría en el campo las primeras letras que caen en el alfabeto.
  const onPaste = (e) => {
    e.preventDefault();
    const c = codigoPegado(e.clipboardData?.getData('text') ?? '');
    if (c) { setTexto(c); setAviso(null); } else setAviso('pegado');
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const c = normalizarCodigo(texto);
    if (!c) { setAviso('corto'); return; }
    setAviso(null);
    navigate('radio', { codigo: c });
  };

  if (codigo) {
    return (
      <div className="radio">
        <BackButton label="Radio" view="radio" onList={() => navigate('radio')} />
        <div className="section-header">
          <div className="lib-heading">
            <span className="lib-accent" aria-hidden="true"></span>
            <div className="lib-headtext">
              <h1 className="section-title">Radio</h1>
              <p className="radio-subtitle">Unirse con código</p>
            </div>
          </div>
        </div>
        <section className="radio-card">
          <h2 className="radio-card-title">Código</h2>
          <p className="radio-codigo">{codigo}</p>
          <p className="radio-nota">Escuchar una radio desde la web llega pronto.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="radio">
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title">Radio</h1>
            <p className="radio-subtitle">Escucha en vivo con otros</p>
          </div>
        </div>
      </div>

      <section className="radio-card">
        <h2 className="radio-card-title">Tu radio</h2>
        <button type="button" className="radio-btn" disabled aria-describedby="radio-iniciar-nota">
          Iniciar radio
        </button>
        <p id="radio-iniciar-nota" className="radio-nota">Próximamente.</p>
      </section>

      <section className="radio-card">
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="radio-codigo-campo" className="radio-card-title">Unirse con código</label>
          <div className="radio-fila">
            <input
              id="radio-codigo-campo"
              className="radio-input"
              type="text"
              value={texto}
              onChange={onChange}
              onPaste={onPaste}
              placeholder="Código"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={aviso ? true : undefined}
              aria-describedby="radio-aviso"
            />
            <button type="submit" className="radio-btn">Unirse</button>
          </div>
          {/* Siempre montado (vacío sin aviso): un role="alert" que aparece de golpe no siempre se anuncia. */}
          <p id="radio-aviso" className="radio-aviso" role="alert">{aviso ? AVISOS[aviso] : ''}</p>
        </form>
      </section>
    </div>
  );
}
