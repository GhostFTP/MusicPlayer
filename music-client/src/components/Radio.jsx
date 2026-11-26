import { useState, useEffect, useRef } from 'react';
import BackButton from './BackButton.jsx';
import { useToast } from './Toast.jsx';
import { avatarUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import RadioInicio from './RadioInicio.jsx';
import RadioAnfitrion from './RadioAnfitrion.jsx';
import {
  limpiarCodigoEscrito, codigoPegado, normalizarCodigo, cuentaDeOyentes, LARGO_CODIGO, textoDeEvento, TEXTOS_ORDEN,
} from '../utils/radioSync.js';

// Vista Radio. Cuatro caras:
//  · "sin radio" (/radio): «Inicia tu radio» eligiendo qué suena (1.46.0: RadioInicio.jsx; ya no hace falta tener
//    algo sonando) y el campo "Unirse con código", que navega a /radio/CODIGO.
//  · anfitrión (/radio, o /radio/TU-CÓDIGO, con la sala abierta): RadioAnfitrion.jsx (1.46.0, R2) — dos columnas en
//    escritorio y pestañas Radio / Fila / Gente en el teléfono: el código grande, lo que suena con pausar / siguiente
//    para todos, la fila de lo pedido, quién escucha (sin contarte) con "Hacer moderador" / "Quitar rol", lo que pasó
//    y "Terminar radio" con confirmación que dice a cuántas personas se les cierra. Acá quedan el estado y el foco.
//  · la ficha (/radio/OTRO-CÓDIGO): el código y "Escuchar", que llama unirse(); ese clic es el gesto
//    que habilita el audio. NO lee la sala antes: la primera lectura es la que anota al oyente. Es un
//    DETALLE como los de las otras vistas (setDetailOpen → swipe-atrás del teléfono; BackButton → history.back).
//  · oyente (/radio, o /radio/SU-CÓDIGO, adentro): quién transmite, qué suena, el aviso de la radio,
//    "Toca para escuchar" si el navegador bloqueó el play, quién más escucha y "Salir de la radio"
//    (sin confirmación: salir no rompe nada, la cola vuelve sola). Debajo, "Tu radio" bloqueada.
// La vista NO usa usePlayerTime (nada a 4 Hz): de usePlayer sólo lee currentTrack y playBlocked. El avance de la cara
// del anfitrión vive en un hijo propio de RadioAnfitrion, que es lo único que escucha el reloj.
// El estado de la sala vive en RadioContext (por encima de las vistas): salir de esta vista no la corta.
// El código de la ruta ya viene normalizado (routes.js). Un enlace con un código que no vale llega
// como { invalido: true } y Layout reescribe la URL a /radio: el aviso se guarda ACÁ, en estado.

const AVISOS = {
  enlace: `Ese enlace no trae un código de radio válido. Escribe el código de ${LARGO_CODIGO} caracteres.`,
  corto: `El código tiene ${LARGO_CODIGO} caracteres.`,
  pegado: 'No hay un código en lo que pegaste.',
};

// La línea de aviso del oyente: [texto, tono] (tono: muted | ambar | silenciada).
const AVISOS_OYENTE = {
  'sin-senal': ['El anfitrión no está transmitiendo. Sigue lo último que mandó.', 'muted'],
  'sin-respuesta': ['Sin conexión con la radio. Reintentando…', 'ambar'],
  'esperando-anfitrion': ['Esperando a que el anfitrión ponga algo.', 'muted'],
  video: ['El anfitrión está viendo un video. La música vuelve cuando ponga una canción.', 'muted'],
  'falta-cancion': ['No se encontró la canción que suena en la radio. Reintentando…', 'ambar'],
  'no-se-pudo-cargar': ['No se pudo cargar la canción. Reintentando…', 'ambar'],
};
const TEXTO_SILENCIADA = 'En pausa para ti. Dale play para volver al vivo.';
const TEXTO_BLOQUEADO = 'Tu navegador necesita un toque para empezar a sonar.';
const MAX_CARAS = 8;   // avatares de oyentes a la vista; el resto, "+N"

/** Avatar de una persona de la radio: la foto (con token), el emoji, o la inicial si no hay o falla. */
function Avatar({ persona, grande = false }) {
  const [fallo, setFallo] = useState(false);
  const a = persona?.avatar;
  const url = a?.kind === 'photo' && !fallo ? avatarUrl(a.url) : null;
  const inicial = [...(persona?.name || '?')][0].toUpperCase();
  return (
    <span className={`radio-avatar${grande ? ' radio-avatar--grande' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} onError={() => setFallo(true)} />
        : a?.kind === 'emoji' ? <span className="radio-avatar-emoji">{a.value}</span>
        : inicial}
    </span>
  );
}

const enLista = (nombres) => {
  try { return new Intl.ListFormat('es', { type: 'conjunction' }).format(nombres); } catch { return nombres.join(', '); }
};

export default function Radio({ target, clearTarget, setDetailOpen, navigate }) {
  const [codigo, setCodigo] = useState(null);   // el de /radio/CODIGO; null = /radio
  const [texto, setTexto] = useState('');       // lo escrito en el campo, ya limpio
  const [aviso, setAviso] = useState(null);     // clave de AVISOS, o null
  const [confirmando, setConfirmando] = useState(false);   // "Terminar radio" pasó a "¿Seguro?"

  const { currentTrack, playBlocked } = usePlayer();
  const {
    fase, codigo: miCodigo, oyentes, fin, error, terminar, limpiarFin,
    anfitrion, aviso: avisoRadio, silenciada, quiereSonar, unirse, salir, tocarParaEscuchar,
    moderadores, eventos, sinSoporte, nombrarModerador, quitarModerador, anuncio,
    vistaMod, ordenando, lineaOrden, esperaOrden, ordenar,
  } = useRadio();
  const [moderando, setModerando] = useState(null);   // id con un nombrar/quitar en vuelo (un clic a la vez)
  const [focoNota, setFocoNota] = useState(null);     // id cuya nota "sin soporte" toma el foco (su botón se fue)
  const [focoLista, setFocoLista] = useState(false);  // quitar a quien no escucha: su fila se va y el foco pasa a la lista
  const listaRef = useRef(null);
  const { user } = useAuth();
  const toast = useToast();
  const ultimoEvento = eventos.length ? eventos[eventos.length - 1] : null;
  const textoUltimo = ultimoEvento ? textoDeEvento(ultimoEvento, user?.id) : null;

  const h1Ref = useRef(null);
  const copiarRef = useRef(null);
  const terminarRef = useRef(null);
  const noRef = useRef(null);
  const escucharRef = useRef(null);
  const oyenteRef = useRef(null);

  // Consumo del target de navegación (mismo contrato que las demás vistas): reset vuelve a /radio
  // (y tocar la pestaña activa además vacía el campo); { codigo } abre el detalle; { invalido } deja
  // la cara "sin radio" con el aviso. Un reset limpia el aviso: volver con atrás/adelante a /radio
  // no lo hace reaparecer.
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

  // Foco al cambiar de fase: al abrir la sala, a "Copiar código"; al cerrarla (terminar o salida),
  // al título, para que el teclado no quede en un botón que ya no existe.
  const faseAntes = useRef(fase);
  useEffect(() => {
    const antes = faseAntes.current;
    faseAntes.current = fase;
    if (antes === 'creando' && fase === 'anfitrion') copiarRef.current?.focus();
    else if ((antes === 'anfitrion' || antes === 'terminando' || antes === 'oyente') && fase === 'sin-radio') h1Ref.current?.focus();
    else if (antes === 'uniendose' && fase === 'oyente') oyenteRef.current?.focus();
    else if (antes === 'uniendose' && fase === 'sin-radio') escucharRef.current?.focus();   // falló o canceló: reintentar a mano
    if (fase !== 'anfitrion' && fase !== 'terminando') setConfirmando(false);
  }, [fase]);
  // La confirmación: al abrirla el foco va a "No" (lo que no rompe nada); al cancelarla vuelve a
  // "Terminar radio".
  const confirmarAntes = useRef(confirmando);
  useEffect(() => {
    const antes = confirmarAntes.current;
    confirmarAntes.current = confirmando;
    if (!antes && confirmando) noRef.current?.focus();
    else if (antes && !confirmando && fase === 'anfitrion') terminarRef.current?.focus();
  }, [confirmando, fase]);

  const unirseBloqueado = fase !== 'sin-radio';
  const esAnfitrion = (fase === 'anfitrion' || fase === 'terminando') && (!codigo || codigo === miCodigo);
  const soyOyente = fase === 'oyente' || fase === 'uniendose';
  const esOyente = fase === 'oyente' && (!codigo || codigo === miCodigo);

  const onChange = (e) => {
    limpiarFin();
    setTexto(limpiarCodigoEscrito(e.target.value));
    setAviso(null);
  };
  // Pegar escribe un código válido o nada (como "Pegar código" en iOS): sin esto, pegar el mensaje
  // entero ("Escucha conmigo…") dejaría en el campo las primeras letras que caen en el alfabeto.
  const onPaste = (e) => {
    e.preventDefault();
    limpiarFin();
    const c = codigoPegado(e.clipboardData?.getData('text') ?? '');
    if (c) { setTexto(c); setAviso(null); } else setAviso('pegado');
  };
  const onSubmit = (e) => {
    e.preventDefault();
    if (unirseBloqueado) return;
    limpiarFin();
    const c = normalizarCodigo(texto);
    if (!c) { setAviso('corto'); return; }
    setAviso(null);
    navigate('radio', { codigo: c });
  };

  const onEscuchar = () => {
    limpiarFin();
    unirse(codigo);   // ignora un segundo clic mientras 'uniendose' (RadioContext)
  };

  // Copiar: el portapapeles con el toast de la casa (como shareAndNotify, utils/share.js). Sin
  // portapapeles (http, permiso negado) avisa en ámbar y no rompe nada.
  const copiar = async (valor, hecho) => {
    limpiarFin();
    try {
      await navigator.clipboard.writeText(valor);
      toast(hecho);
    } catch {
      toast('No se pudo copiar', { variant: 'warning' });
    }
  };
  // Nombrar o quitar. El botón es el MISMO nodo antes y después (cambia su texto), así que el foco se
  // queda en él; si la persona no lo admite, el botón se va y el foco pasa a su nota.
  const onModerar = async (persona, si) => {
    if (moderando != null) return;
    limpiarFin();
    setModerando(persona.id);
    const r = await (si ? nombrarModerador(persona.id) : quitarModerador(persona.id));
    setModerando(null);
    if (!r.ok && r.error === 'sin-soporte') setFocoNota(persona.id);
    if (r.ok && !si && persona.ausente) setFocoLista(true);
  };
  useEffect(() => {
    if (!focoLista) return;
    listaRef.current?.focus();
    setFocoLista(false);
  }, [focoLista]);
  useEffect(() => {
    if (focoNota == null) return;
    document.getElementById(`radio-persona-nota-${focoNota}`)?.focus();
    setFocoNota(null);
  }, [focoNota]);

  const onConfirmarKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();   // un Esc = una cosa: que no cierre además la cola o el expandido
    setConfirmando(false);
  };

  const estado = error || fin?.texto || '';
  const subtitulo = esAnfitrion ? 'Tu radio está en vivo' : esOyente ? 'Escuchando en vivo'
    : codigo && fase === 'uniendose' ? 'Uniéndose…' : codigo ? 'Unirse con código' : 'Escucha en vivo con otros';

  let cara;
  if (esAnfitrion) {
    cara = (
      <RadioAnfitrion
        Avatar={Avatar} miCodigo={miCodigo} oyentes={oyentes} moderadores={moderadores} sinSoporte={sinSoporte}
        eventos={eventos} yo={user?.id ?? null} fase={fase} moderando={moderando} onModerar={onModerar} copiar={copiar}
        confirmando={confirmando} setConfirmando={setConfirmando} onConfirmarKey={onConfirmarKey} terminar={terminar}
        limpiarFin={limpiarFin} copiarRef={copiarRef} terminarRef={terminarRef} noRef={noRef} listaRef={listaRef}
        ultimoEvento={ultimoEvento} textoUltimo={textoUltimo}
      />
    );
  } else if (esOyente) {
    // La línea de aviso: lo de la radio (red, carga, video, espera) gana sobre la pausa propia, y
    // ésta sobre la pista del navegador bloqueado.
    const tocar = playBlocked && quiereSonar;
    const [textoAviso, tono] = AVISOS_OYENTE[avisoRadio]
      ?? (silenciada ? [TEXTO_SILENCIADA, 'silenciada'] : tocar ? [TEXTO_BLOQUEADO, 'muted'] : ['', 'muted']);
    const caras = oyentes.slice(0, MAX_CARAS);
    const yo = user?.id != null ? Number(user.id) : null;
    const nombres = oyentes.map((o) => (o.id === yo ? 'tú' : o.name || 'alguien'));
    // W5b-1: quien modera ve sus botones (si la radio admite órdenes) o la nota (si no). Pausar o
    // reanudar según lo que ve de la radio. aria-disabled (no disabled) durante la espera de un 429:
    // el botón conserva el foco.
    const modera = vistaMod.modera;
    const pausada = vistaMod.playing === false;
    const tipoPausa = pausada ? 'reanudar' : 'pausa';
    const textoPausa = pausada ? 'Reanudar la radio' : 'Pausar la radio';
    const ocupadoPausa = !!(ordenando.pausa || ordenando.reanudar);
    const enEspera = esperaOrden > 0;
    cara = (
      <section className="radio-card radio-card--oyente">
        <p className="radio-card-title">En vivo{modera && <span className="radio-insignia radio-insignia--titulo">Modera</span>}</p>
        <div className="radio-anfitrion">
          <Avatar persona={anfitrion} grande />
          <h2 className="radio-anfitrion-nombre" ref={oyenteRef} tabIndex={-1}>
            <span className="radio-vivo" aria-hidden="true"></span>
            <span className="radio-anfitrion-texto">Escuchando a <strong>{anfitrion?.name || 'el anfitrión'}</strong></span>
          </h2>
        </div>
        <p className="radio-suena">
          {avisoRadio !== 'video' && currentTrack ? (
            <>
              <span className="radio-suena-titulo">{currentTrack.title}</span>
              {currentTrack.artist ? <span className="radio-suena-artista"> — {currentTrack.artist}</span> : null}
            </>
          ) : null}
        </p>
        {tocar && (
          <button type="button" className="radio-btn radio-btn--escuchar radio-btn--toca" onClick={tocarParaEscuchar}>
            Toca para escuchar
          </button>
        )}
        {/* Siempre montada (vacía sin aviso): una región viva que aparece de golpe no siempre se anuncia. */}
        <p className={`radio-aviso-vivo radio-aviso-vivo--${tono}`} role="status" aria-live="polite">{textoAviso}</p>
        {/* W5a: lo que pasó en la radio (eventos y aviso de rol), en su PROPIA región: así no pisa el aviso de
            arriba ni al revés. Siempre montada (vacía sin nada que anunciar). Cada anuncio es un hijo con key (su
            contador: un anuncio puede juntar varios eventos y el aviso de rol): un texto repetido monta un nodo nuevo. */}
        <p className="radio-evento" role="status" aria-live="polite">{anuncio ? <span key={anuncio.n}>{anuncio.texto}</span> : null}</p>
        {modera && (vistaMod.admite ? (
          <div className="radio-fila radio-ordenes">
            {vistaMod.conBase && (
              <button type="button" className="radio-btn radio-btn--orden" aria-label="Siguiente canción de la radio"
                aria-busy={ordenando.siguiente || undefined} aria-disabled={enEspera || undefined}
                onClick={() => { if (!ordenando.siguiente && !enEspera) ordenar('siguiente'); }}>
                Siguiente canción de la radio
              </button>
            )}
            <button type="button" className="radio-btn radio-btn--orden" aria-label={textoPausa}
              aria-busy={ocupadoPausa || undefined} aria-disabled={enEspera || undefined}
              onClick={() => { if (!ocupadoPausa && !enEspera) ordenar(tipoPausa); }}>
              {textoPausa}
            </button>
          </div>
        ) : <p className="radio-nota radio-ordenes-nota">{TEXTOS_ORDEN.sinOrdenes}</p>)}
        {/* W5b-1: cómo va la orden de quien modera, en SU región (aparte de las de arriba): siempre montada,
            vacía sin nada que decir (y para quien no modera). Un texto nuevo es un nodo nuevo (key n). */}
        <p className="radio-orden-estado" role="status" aria-live="polite">{lineaOrden ? <span key={lineaOrden.n}>{lineaOrden.texto}</span> : null}</p>
        <div className="radio-oyentes radio-oyentes--oyente">
          {caras.length > 0 && (
            <span className="radio-oyentes-caras" aria-hidden="true">
              {caras.map((o) => <Avatar key={o.id} persona={o} />)}
              {oyentes.length > MAX_CARAS && <span className="radio-avatar radio-avatar--mas">+{oyentes.length - MAX_CARAS}</span>}
            </span>
          )}
          <span aria-live="polite">{cuentaDeOyentes(oyentes.length)}</span>
          {nombres.length > 0 && <span className="radio-solo-lector">. Escuchan: {enLista(nombres)}</span>}
        </div>
        <div className="radio-terminar">
          <button type="button" className="radio-btn" onClick={() => { limpiarFin(); salir(); }}>Salir de la radio</button>
        </div>
      </section>
    );
  } else if (codigo) {
    // La ficha: "Escuchar". Bloqueada si ya estás en otra sala, como oyente o como anfitrión.
    const uniendose = fase === 'uniendose';
    const otraSala = fase !== 'sin-radio' && !uniendose;
    const notaOtra = fase === 'oyente' ? 'Ya estás escuchando otra radio. Sal de ella para unirte a esta.'
      : 'Termina tu radio para unirte a otra.';
    cara = (
      <section className="radio-card">
        <h2 className="radio-card-title">Código</h2>
        <p className="radio-codigo">{codigo}</p>
        <div className="radio-fila radio-acciones">
          <button type="button" ref={escucharRef} className="radio-btn radio-btn--escuchar" onClick={onEscuchar}
            disabled={fase !== 'sin-radio'} aria-busy={uniendose || undefined} aria-describedby="radio-escuchar-nota">
            {uniendose ? 'Uniéndose…' : 'Escuchar'}
          </button>
          {uniendose && <button type="button" className="radio-btn" onClick={salir}>Cancelar</button>}
        </div>
        <p id="radio-escuchar-nota" className="radio-nota">
          {otraSala ? notaOtra : 'Vas a escuchar lo mismo que el anfitrión, en vivo. Al salir, vuelve tu cola, en pausa.'}
        </p>
      </section>
    );
  }
  // "Tu radio": en la cara "sin radio", «Inicia tu radio» eligiendo qué suena (1.46.0, RadioInicio.jsx); debajo de la
  // del oyente, bloqueada con su nota (eso cambia con el apartado nuevo, en R3).
  let tuRadio = null;
  if (!esAnfitrion && (!codigo || esOyente)) {
    tuRadio = soyOyente ? (
      <section className="radio-card">
        <h2 className="radio-card-title">Tu radio</h2>
        <button type="button" className="radio-btn" disabled aria-describedby="radio-iniciar-nota">Iniciar radio</button>
        <p id="radio-iniciar-nota" className="radio-nota">Sal de la radio para iniciar la tuya.</p>
      </section>
    ) : <RadioInicio antes={limpiarFin} />;
  }

  return (
    <div className={`radio${esAnfitrion ? ' radio--anfitrion' : ''}`}>
      {codigo ? <BackButton label="Radio" view="radio" onList={() => navigate('radio')} /> : null}
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title" ref={h1Ref} tabIndex={-1}>Radio</h1>
            <p className="radio-subtitle">{subtitulo}</p>
          </div>
        </div>
      </div>

      {/* Por qué terminó la radio o qué falló. Siempre montado (vacío sin texto) y en el MISMO lugar en
          las tres caras: un role="alert" que aparece de golpe no siempre se anuncia. */}
      <p className={`radio-estado${error ? ' radio-estado--error' : ''}`} role="alert">{estado}</p>

      {cara}
      {tuRadio}

      {!codigo && (
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
                disabled={unirseBloqueado}
                aria-invalid={aviso ? true : undefined}
                aria-describedby={unirseBloqueado ? 'radio-unirse-nota radio-aviso' : 'radio-aviso'}
              />
              <button type="submit" className="radio-btn" disabled={unirseBloqueado}>Unirse</button>
            </div>
            {unirseBloqueado && <p id="radio-unirse-nota" className="radio-nota">{soyOyente ? 'Sal de la radio para unirte a otra.' : 'Termina tu radio para unirte a otra.'}</p>}
            {/* Siempre montado (vacío sin aviso): un role="alert" que aparece de golpe no siempre se anuncia. */}
            <p id="radio-aviso" className="radio-aviso" role="alert">{aviso ? AVISOS[aviso] : ''}</p>
          </form>
        </section>
      )}
    </div>
  );
}
