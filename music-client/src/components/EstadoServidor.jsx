import { memo, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { validarServidor, claveDeFallo, etiquetaEstado, textoEncendido, textoHace, PIE } from '../utils/estadoServidor.js';
import { crearSondeo } from '../utils/sondeoServidor.js';

// La tarjeta «Servidor» de Ajustes (sub-paso 3b): lo que cualquiera con sesión puede saber del
// servidor (GET /api/servidor). El detalle de admin es 3c: `admin` se guarda pero no se usa todavía.
//
// ESTADO LOCAL Y NADA MÁS. No toca contextos (ni PlayerContext ni Layout): el sondeo vive acá, y
// como Layout monta solo la vista actual, salir de Ajustes desmonta esto y corta el sondeo.
// El bucle (cada 30 s, pausa con la pestaña oculta, una lectura en vuelo, el 401 que corta) está en
// utils/sondeoServidor.js; los textos y la validación, en utils/estadoServidor.js.
//
// RE-RENDERS: la tarjeta cambia solo cuando llega una respuesta (cada 30 s). «Actualizado hace N s»
// es un hijo memoizado con SU intervalo de 1 s: su tic no re-renderiza la tarjeta.
//
// ACCESIBILIDAD: role="status" + aria-live="polite" SOLO en el texto del estado, que cambia poco.
// «hace N s» nunca va en una región viva: hablaría cada segundo. Nada mueve el foco.
export default function EstadoServidor() {
  const [dato, setDato] = useState(null);             // la última respuesta VÁLIDA
  const [recibidoEn, setRecibidoEn] = useState(null); // cuándo llegó (ms)
  const [fallo, setFallo] = useState(null);           // null | 'sin_respuesta' | 'respuesta_invalida' | 'sesion'

  useEffect(() => {
    const sondeo = crearSondeo({
      leer: () => api.servidor(),
      validar: validarServidor,
      clasificar: claveDeFallo,
      alDato: (d, t) => { setDato(d); setRecibidoEn(t); setFallo(null); },
      alFallo: (clave) => setFallo(clave),
      documento: document,
    });
    return () => sondeo.detener();
  }, []);

  const cargando = !dato && !fallo;
  // 'sesion' (401) se muestra como «Sin respuesta»: la app ya está pidiendo volver a entrar.
  const clave = fallo ? (fallo === 'sesion' ? 'sin_respuesta' : fallo) : dato?.estado;
  const etq = cargando
    ? { texto: 'Consultando el servidor…', icono: 'puntos', tono: 'gris' }
    : etiquetaEstado(clave) ?? etiquetaEstado('sin_respuesta');
  const viejo = Boolean(fallo && dato);   // hay un dato, pero no es de ahora: va atenuado

  return (
    <section className="settings-section srv" aria-labelledby="srv-titulo">
      <h2 className="settings-section-title" id="srv-titulo">Servidor</h2>
      <dl className="settings-card">
        <div className="settings-row">
          <dt>Estado</dt>
          <dd className="srv-estado-celda">
            <span className={`srv-estado srv-estado--${etq.tono}`} role="status" aria-live="polite">
              <IconoEstado nombre={etq.icono} />
              <span className="srv-estado-texto">{etq.texto}</span>
            </span>
            {etq.ayuda && <span className="srv-ayuda">{etq.ayuda}</span>}
          </dd>
        </div>
        <div className="settings-row">
          <dt>Versión</dt>
          <dd className={viejo ? 'srv-viejo' : undefined}>{dato?.version ?? '—'}</dd>
        </div>
        <div className="settings-row">
          <dt>Encendido</dt>
          <dd className={viejo ? 'srv-viejo' : undefined}>{dato ? textoEncendido(dato.uptime_s) ?? '—' : '—'}</dd>
        </div>
      </dl>
      <p className="srv-pie">
        {recibidoEn !== null && <Hace desde={recibidoEn} prefijo={fallo ? 'Último dato' : 'Actualizado'} />}
        <span className="srv-pie-nota">{PIE}</span>
      </p>
    </section>
  );
}

// «Actualizado hace 12 s» / «Último dato hace 3 min». Su propio intervalo de 1 s, solo con la
// pestaña visible; memo: la tarjeta no se re-renderiza por su tic, ni este por los de la tarjeta.
const Hace = memo(function Hace({ desde, prefijo }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    let id = null;
    const parar = () => { if (id !== null) { clearInterval(id); id = null; } };
    const seguir = () => {
      parar();
      if (document.visibilityState === 'hidden') return;
      setAhora(Date.now());
      id = setInterval(() => setAhora(Date.now()), 1000);
    };
    seguir();
    document.addEventListener('visibilitychange', seguir);
    return () => { parar(); document.removeEventListener('visibilitychange', seguir); };
  }, [desde]);
  return <span className="srv-hace">{prefijo} {textoHace((ahora - desde) / 1000)}</span>;
});

// Iconos de estado: line SVG como el resto (stroke currentColor, 2, round), siempre aria-hidden —
// el texto de al lado es el que dice el estado; el icono y el tono solo lo refuerzan.
function IconoEstado({ nombre }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'srv-icono', 'data-icono': nombre };
  switch (nombre) {
    case 'check':
      return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>;
    case 'reloj':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
    case 'triangulo':
      return <svg {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'sin-senal':
      return <svg {...p}><line x1="2" y1="2" x2="22" y2="22" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.9a10 10 0 0 1 5.2-2.8" /><path d="M19 12.9a10 10 0 0 0-2.2-1.6" /><line x1="12" y1="20" x2="12.01" y2="20" /></svg>;
    default:   // 'puntos': todavía no se sabe
      return <svg {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
  }
}
