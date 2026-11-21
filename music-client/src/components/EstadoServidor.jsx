import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  validarServidor, validarAdminServidor, claveDeFallo, claveDeFalloAdmin, etiquetaEstado, textoEncendido, textoHace, PIE,
  textoEventLoop, textoMemoria, textoBase, textoContadores, textoLocutor, versionPaqueteDistinta, fechaEscaneoLocal,
  TEXTO_VIDEOS, puntosGrafica, textoPico, ariaGrafica, textoDiagnostico, idDelBuild,
} from '../utils/estadoServidor.js';
import { crearSondeo } from '../utils/sondeoServidor.js';

// La tarjeta «Servidor» de Ajustes: lo que cualquiera con sesión puede saber del servidor
// (GET /api/servidor, 3b) y, SOLO si esa respuesta dijo admin:true, el bloque plegado «Ver detalle
// (admin)» (GET /api/admin/servidor, 3c). Un usuario normal no ve ni el bloque ni un pedido al detalle.
//
// EL DETALLE se pide únicamente con el bloque ABIERTO: el sondeo del detalle vive en DetalleAbierto,
// que solo existe mientras el <details> está abierto; cerrarlo lo desmonta y su sondeo se detiene.
// Mismo bucle que lo público (utils/sondeoServidor.js). Un 403 ('prohibido') esconde el bloque y deja
// lo público; un JSON con otra forma dice «Sin respuesta» solo dentro del detalle.
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
//
// memo: Settings no le pasa props, así que un re-render de Layout (cada frame del swipe-atrás)
// no llega hasta acá; y la gráfica es memo aparte, para que tampoco la redibujen los tics.
function EstadoServidor() {
  const [dato, setDato] = useState(null);             // la última respuesta VÁLIDA
  const [recibidoEn, setRecibidoEn] = useState(null); // cuándo llegó (ms)
  const [fallo, setFallo] = useState(null);           // null | 'sin_respuesta' | 'respuesta_invalida' | 'sesion'
  const [prohibido, setProhibido] = useState(false);  // el detalle contestó 403: no se vuelve a mostrar
  const alProhibido = useCallback(() => setProhibido(true), []);

  // «Copiar diagnóstico» (3d) lee lo ÚLTIMO que hay sin re-renderizar a nadie: lo público en una ref
  // que se actualiza tras cada render, y el detalle de admin en otra que solo llena DetalleAbierto
  // mientras está abierto (al cerrarse la vacía). Copiar no pide nada: arma el texto con esto.
  const publicoRef = useRef({ clave: 'cargando', dato: null, recibidoEn: null });
  const adminRef = useRef(null);                       // { dato, recibidoEn } del detalle abierto, o null
  const alDatoAdmin = useCallback((v) => { adminRef.current = v; }, []);
  const armar = useCallback(() => {
    const p = publicoRef.current;
    const a = adminRef.current;
    return textoDiagnostico({
      ahora: Date.now(),
      zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
      clave: p.clave, publico: p.dato, recibidoEn: p.recibidoEn,
      build: idDelBuild(document),
      navegador: navigator.userAgent,
      visible: document.visibilityState !== 'hidden',
      admin: a?.dato ?? null, adminEn: a?.recibidoEn ?? null,
    });
  }, []);

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
  useEffect(() => {
    publicoRef.current = { clave: cargando ? 'cargando' : clave, dato, recibidoEn };
  }, [cargando, clave, dato, recibidoEn]);

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
      <CopiarDiagnostico armar={armar} />
      {dato?.admin === true && !prohibido && <DetalleAdmin alProhibido={alProhibido} alDatoAdmin={alDatoAdmin} />}
    </section>
  );
}

export default memo(EstadoServidor);

// El bloque plegado, cerrado de inicio. Su contenido (y con él el sondeo del detalle) existe solo
// mientras está abierto.
function DetalleAdmin({ alProhibido, alDatoAdmin }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <details className="srv-admin" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary className="srv-admin-resumen">Ver detalle (admin)</summary>
      {abierto && <DetalleAbierto alProhibido={alProhibido} alDatoAdmin={alDatoAdmin} />}
    </details>
  );
}

function DetalleAbierto({ alProhibido, alDatoAdmin }) {
  const [dato, setDato] = useState(null);
  const [recibidoEn, setRecibidoEn] = useState(null);
  const [fallo, setFallo] = useState(null);

  useEffect(() => {
    const sondeo = crearSondeo({
      leer: () => api.adminServidor(),
      validar: validarAdminServidor,
      clasificar: claveDeFalloAdmin,
      // El último detalle válido también va al padre, para «Copiar diagnóstico» (sin re-render).
      alDato: (d, t) => { setDato(d); setRecibidoEn(t); setFallo(null); alDatoAdmin({ dato: d, recibidoEn: t }); },
      // 403: le quitaron el rol. El padre esconde el bloque (y al desmontarse esto, el sondeo para).
      alFallo: (clave) => { if (clave === 'prohibido') alProhibido(); else setFallo(clave); },
      documento: document,
    });
    // Cerrado (o escondido) el bloque, el diagnóstico ya no lleva nada de admin.
    return () => { sondeo.detener(); alDatoAdmin(null); };
  }, [alProhibido, alDatoAdmin]);

  const etq = fallo ? etiquetaEstado(fallo === 'sesion' ? 'sin_respuesta' : fallo) : null;
  return (
    <div className="srv-admin-cuerpo">
      {!dato && !fallo && <p className="srv-admin-aviso">Consultando el detalle…</p>}
      {etq && (
        <p className="srv-admin-aviso srv-admin-aviso--fallo">
          <span className="srv-admin-fallo"><IconoEstado nombre={etq.icono} /><span className="srv-admin-fallo-texto">{etq.texto}</span></span>
          {etq.ayuda && <span className="srv-ayuda">{etq.ayuda}</span>}
        </p>
      )}
      {dato && <DatosAdmin dato={dato} viejo={Boolean(fallo)} />}
      {recibidoEn !== null && (
        <p className="srv-pie"><Hace desde={recibidoEn} prefijo={fallo ? 'Último dato' : 'Actualizado'} /></p>
      )}
    </div>
  );
}

// Las filas y la gráfica. memo: solo cambian cuando llega un detalle nuevo (cada 30 s).
const DatosAdmin = memo(function DatosAdmin({ dato, viejo }) {
  const vp = versionPaqueteDistinta(dato);
  const fila = (dt, dd) => (
    <div className="settings-row" key={dt}>
      <dt>{dt}</dt>
      <dd className={viejo ? 'srv-viejo srv-admin-valor' : 'srv-admin-valor'}>{dd}</dd>
    </div>
  );
  return (
    <>
      <dl className="settings-card srv-admin-filas">
        {fila('Atraso del event loop', textoEventLoop(dato.event_loop))}
      </dl>
      <Grafica muestras={dato.muestras} />
      <dl className="settings-card srv-admin-filas">
        {fila('Memoria', textoMemoria(dato.memoria))}
        {fila('Base', textoBase(dato.base))}
        {fila('Pistas', String(dato.base.pistas))}
        {fila('Último escaneo', fechaEscaneoLocal(dato.base.ultimo_escaneo) ?? '—')}
        {fila('Videos', TEXTO_VIDEOS[dato.videos])}
        {fila('Locutor', textoLocutor(dato.locutor))}
        {fila('Desde el arranque', textoContadores(dato))}
        {vp && fila('Versión del paquete', vp)}
      </dl>
    </>
  );
});

// La gráfica del atraso en la última hora: SVG inline sin librerías. Las líneas se estiran al ancho
// de la tarjeta (preserveAspectRatio none + vector-effect non-scaling-stroke: el trazo no engorda);
// los rótulos van en HTML encima, para que el texto no se deforme. Techo, guías y pico salen de
// puntosGrafica (100 siempre; 500 solo si cabe). memo: la redibuja solo un arreglo de muestras nuevo.
const G_ANCHO = 600;
const G_ALTO = 160;
const Grafica = memo(function Grafica({ muestras }) {
  const g = puntosGrafica(muestras, { ancho: G_ANCHO, alto: G_ALTO });
  const aria = ariaGrafica(g);
  if (!g) {
    return (
      <figure className="srv-grafica">
        <figcaption className="srv-grafica-titulo">Atraso en la última hora</figcaption>
        <p className="srv-grafica-vacia" role="img" aria-label={aria}>Todavía no hay muestras</p>
      </figure>
    );
  }
  // Con una sola muestra la polilínea no dibuja nada: un trazo de largo 0 con punta redonda es un punto.
  const punto = (pts) => { const [x, y] = pts.split(',').map(Number); return `M${x} ${y}h0`; };
  return (
    <figure className="srv-grafica">
      <figcaption className="srv-grafica-titulo">Atraso en la última hora</figcaption>
      <div className="srv-grafica-lienzo">
        <svg className="srv-grafica-svg" viewBox={`0 0 ${G_ANCHO} ${G_ALTO}`} preserveAspectRatio="none" role="img" aria-label={aria}>
          {g.guias.map((x) => (
            <line key={x.valor} className={`srv-guia srv-guia--${x.valor}`} data-valor={x.valor}
                  x1="0" x2={G_ANCHO} y1={x.y} y2={x.y} vectorEffect="non-scaling-stroke" />
          ))}
          {g.unPunto ? (
            <>
              <path className="srv-linea-max" d={punto(g.max)} vectorEffect="non-scaling-stroke" />
              <path className="srv-linea-p99" d={punto(g.p99)} vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            <>
              <polyline className="srv-linea-max" points={g.max} vectorEffect="non-scaling-stroke" />
              <polyline className="srv-linea-p99" points={g.p99} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {g.guias.map((x) => (
          <span key={x.valor} className={`srv-guia-etiqueta srv-guia-etiqueta--${x.valor}`} data-valor={x.valor}
                style={{ top: `${(x.y / G_ALTO) * 100}%` }} aria-hidden="true">{x.etiqueta}</span>
        ))}
      </div>
      <div className="srv-grafica-eje" aria-hidden="true"><span>hace 60 min</span><span>ahora</span></div>
      <p className="srv-grafica-pico">{textoPico(g.pico)}</p>
    </figure>
  );
});

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

// «Copiar diagnóstico» (3d): para quien siente lag, admin o no. Copia un texto plano con lo que la
// app sabe AHORA (textoDiagnostico), también —y sobre todo— con el servidor sin respuesta. Copiar no
// pide nada a ningún endpoint: `armar` lee lo último que ya llegó.
//
// Tres caminos, en orden: navigator.clipboard.writeText; si falla o no existe (http, permiso
// negado), el textarea oculto + execCommand('copy'); si también falla, el texto queda a la vista en
// un <textarea readonly> ya seleccionado para copiarlo a mano.
// «Copiado» ~2 s en el botón; el mismo mensaje en una región role="status" HERMANA del botón (los
// hijos de un botón son presentacionales: una región viva adentro no se anunciaría). Sin rojo ni
// verde, y el foco se queda en el botón (el camino de execCommand se lo devuelve).
const COPIADO_MS = 2000;
const CopiarDiagnostico = memo(function CopiarDiagnostico({ armar }) {
  const [fase, setFase] = useState('listo');   // 'listo' | 'copiado' | 'manual'
  const [texto, setTexto] = useState('');
  const botonRef = useRef(null);
  const areaRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A mano: el textarea aparece con todo seleccionado (eso sí lleva el foco, para que copiar sea un gesto).
  useEffect(() => {
    if (fase === 'manual') { areaRef.current?.focus(); areaRef.current?.select(); }
  }, [fase, texto]);

  async function copiar() {
    const t = armar();
    const ok = await copiarAlPortapapeles(t, botonRef.current);
    clearTimeout(timer.current);
    if (ok) {
      setFase('copiado');
      timer.current = setTimeout(() => setFase('listo'), COPIADO_MS);
    } else {
      setTexto(t);
      setFase('manual');
    }
  }

  const copiado = fase === 'copiado';
  return (
    <div className="srv-copiar">
      <button type="button" ref={botonRef} className={`srv-copiar-boton${copiado ? ' srv-copiar-boton--hecho' : ''}`} onClick={copiar}>
        <IconoCopiar hecho={copiado} />
        <span className="srv-copiar-etiqueta">{copiado ? 'Copiado' : 'Copiar diagnóstico'}</span>
      </button>
      <span className="srv-solo-lector" role="status" aria-live="polite">{copiado ? 'Copiado' : ''}</span>
      {fase === 'manual' && (
        <div className="srv-copiar-manual">
          <p className="srv-copiar-aviso" id="srv-copiar-aviso">No pude copiar solo: selecciona y copia</p>
          <textarea ref={areaRef} className="srv-copiar-texto" readOnly value={texto}
                    rows={Math.min(20, texto.split('\n').length + 2)} aria-describedby="srv-copiar-aviso"
                    aria-label="Diagnóstico para copiar" />
        </div>
      )}
    </div>
  );
});

// El portapapeles: el moderno y, si no, el viejo. Devuelve true si copió.
async function copiarAlPortapapeles(texto, volverA) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* sin permiso, sin https: se prueba el camino viejo */ }
  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    ta?.remove();
    volverA?.focus();   // select() se llevó el foco al textarea oculto: vuelve al botón
  }
}

function IconoCopiar({ hecho }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'srv-icono' };
  return hecho
    ? <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>
    : <svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}
