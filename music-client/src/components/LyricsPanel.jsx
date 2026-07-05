import { useState, useEffect, useMemo, useRef } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

// Parsea .lrc → [{time:number|null, text}]. Soporta varias marcas por línea
// (líneas repetidas) y descarta metadatos [ar:][ti:][offset:]…
function parseLrc(lrc) {
  const stampRe = /\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g;
  const metaRe  = /^\s*\[[a-z#]+:[^\]]*\]\s*$/i;
  // Etiqueta [offset:±ms] del formato LRC: desplaza TODAS las marcas. Convención
  // estándar: un valor positivo RETRASA la letra y uno negativo la ADELANTA (ms→s).
  const offMatch = lrc.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const offset = offMatch ? parseInt(offMatch[1], 10) / 1000 : 0;
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    if (metaRe.test(raw)) continue;
    const stamps = [];
    let m; stampRe.lastIndex = 0;
    while ((m = stampRe.exec(raw)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')) + offset);
    }
    const text = raw.replace(stampRe, '').trim();
    if (stamps.length === 0) {
      if (text) out.push({ time: null, text });
    } else {
      for (const t of stamps) out.push({ time: t, text });
    }
  }
  out.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  return out;
}

// Línea activa = última cuyo timestamp ya pasó. +0.1 s de anticipación de lectura
// (bajada de 0.2 → 0.1: sumaba sensación de "adelantada"; el resto lo afina el offset).
function findActiveIdx(lines, t) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time != null && lines[i].time <= t + 0.1) idx = i;
  }
  return idx;
}

export default function LyricsPanel({ onClose, startImmersive = false }) {
  const { currentTrack, currentTime, duration, isPlaying, seek } = usePlayer();
  const [data, setData]       = useState(null);   // { instrumental, synced, lyrics }
  const [loading, setLoading] = useState(false);
  // Inmersivo: full-bleed (tapa la barra) vs panel (deja la barra visible). Arranca
  // en inmersivo si la letra se abrió desde el reproductor expandido.
  const [immersive, setImmersive] = useState(startImmersive);
  // Ajuste fino de sincronía por canción (segundos). Desplaza el tiempo efectivo
  // (línea activa + barrido); +: la letra va adelante. Se persiste en localStorage.
  const [offset, setOffset] = useState(0);
  const activeRef = useRef(null);
  const bodyRef   = useRef(null);   // .lyrics-body: contenedor de scroll de las líneas

  // ── Reloj interpolado (línea activa + wipe) ──────────────────────────────
  // El PlayerContext NO expone el <audio>; currentTime llega por 'timeupdate' a
  // ~4 Hz (grueso para karaoke). Interpolamos con rAF: sembramos t0/perf0 en cada
  // tick y en el frame calculamos
  //   liveTime = t0 + (now - perf0)/1000  → ~60fps entre ticks, autocorregido cada
  // ~250ms. Ese reloj conmuta la línea activa Y pinta el wipe. El rAF corre SOLO
  // con synced && isPlaying (y sin reduced-motion); al pausar se cancela, --p
  // queda congelado y la línea activa la sostiene el camino lento (estado 4 Hz).
  const t0Ref        = useRef(0);   // segundos: currentTime del último tick sembrado
  const perf0Ref     = useRef(0);   // ms: performance.now() de esa siembra
  const linesRef     = useRef([]);  // últimas líneas (leídas dentro del rAF sin recrear el loop)
  const activeIdxRef = useRef(-1);
  const durationRef  = useRef(0);
  const offsetRef    = useRef(0);   // ajuste de sync leído dentro del rAF

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  useEffect(() => {
    if (!currentTrack) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    api.lyrics(currentTrack.id)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentTrack]);

  // Cargar el ajuste de sync guardado al cambiar de pista (localStorage por trackId).
  useEffect(() => {
    if (!currentTrack) { setOffset(0); return; }
    const saved = parseFloat(localStorage.getItem('lyricsOffset:' + currentTrack.id));
    setOffset(Number.isFinite(saved) ? saved : 0);
  }, [currentTrack]);

  const lines = useMemo(
    () => (data && !data.instrumental && data.lyrics ? parseLrc(data.lyrics) : []),
    [data],
  );
  const synced = !!data?.synced && lines.some(l => l.time != null);

  // Línea activa en ESTADO, no derivada de currentTime en el render: derivada del
  // estado (~4 Hz por 'timeupdate') cada línea encendía 0–250 ms tarde según dónde
  // cayera el tick — jitter POR LÍNEA que el ajuste ± (constante) no puede
  // compensar. El rAF de abajo la conmuta con el reloj interpolado, exacta en su
  // marca; este efecto queda como camino lento (pausa, reduced-motion, seeks).
  const [activeIdx, setActiveIdx] = useState(-1);
  useEffect(() => {
    setActiveIdx(synced ? findActiveIdx(lines, currentTime + offset) : -1);
  }, [synced, lines, currentTime, offset]);

  // Valores frescos para el rAF sin recrear el loop en cada tick.
  linesRef.current     = lines;
  activeIdxRef.current = activeIdx;
  durationRef.current  = duration;
  offsetRef.current    = offset;

  useEffect(() => {
    // Centra la línea activa SOLO dentro de .lyrics-body. scrollIntoView({block:'center'})
    // desplazaba también los scrollers exteriores (documento / visual viewport):
    // en las últimas líneas, cuando el cuerpo ya no puede centrarla, escalaba
    // hacia afuera y en móvil empujaba el panel → el header "se iba".
    // scrollTo sobre el contenedor queda contenido y clampa solo.
    const node = activeRef.current;
    const cont = bodyRef.current;
    if (!node || !cont) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const top = node.offsetTop - (cont.clientHeight - node.offsetHeight) / 2;
    cont.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }, [activeIdx]);

  // Siembra del reloj: en cada tick de currentTime (~4Hz) y al pausar/reanudar.
  // Incluir isPlaying evita el salto al reanudar: sin él, perf0 quedaría viejo
  // (con toda la pausa acumulada) hasta el próximo timeupdate. Un seek también
  // pasa por acá: el elemento dispara 'timeupdate' al saltar.
  useEffect(() => {
    t0Ref.current    = currentTime;
    perf0Ref.current = performance.now();
  }, [currentTime, isPlaying]);

  // rAF del reloj: con el tiempo interpolado (a) CONMUTA la línea activa exacta en
  // su marca y (b) interpola --p (0→1) sobre ella. Solo con sync + reproduciendo +
  // sin reduced-motion. Cleanup cancela el frame (pausa, cambio de track,
  // desmontaje) → nada de loops colgados.
  useEffect(() => {
    if (!synced || !isPlaying || reduced) return;
    let raf;
    const tick = () => {
      const live = t0Ref.current + (performance.now() - perf0Ref.current) / 1000 + offsetRef.current;
      const ls   = linesRef.current;
      const idx  = findActiveIdx(ls, live);
      if (idx !== activeIdxRef.current) {
        setActiveIdx(idx);               // re-render; el ref se actualiza al pintar
      } else {
        const node = activeRef.current;
        const cur  = ls[idx];
        if (node && cur && cur.time != null) {
          const nextT = ls[idx + 1]?.time;
          // Duración de la línea: hasta la próxima marca, o un tope de 4s (acotado por
          // la duración de la pista) si es la última.
          const cap = Math.min(cur.time + 4, durationRef.current || cur.time + 4);
          const end = nextT != null ? nextT : cap;
          const den = end - cur.time;
          const p   = den > 0 ? Math.min(1, Math.max(0, (live - cur.time) / den)) : 1;
          node.style.setProperty('--p', p.toFixed(4));   // una sola CSS var por frame
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, isPlaying, reduced]);

  // Ajuste fino de sync (persistido por trackId). +0.5: adelanta; −0.5: atrasa.
  function persistOffset(v) {
    if (!currentTrack) return;
    if (v === 0) localStorage.removeItem('lyricsOffset:' + currentTrack.id);
    else         localStorage.setItem('lyricsOffset:' + currentTrack.id, String(v));
  }
  function adjustOffset(delta) {
    setOffset(o => {
      const v = Math.round((o + delta) * 10) / 10;   // 0.1 s de precisión, sin drift de float
      persistOffset(v);
      return v;
    });
  }
  function resetOffset() {
    setOffset(0);
    persistOffset(0);
  }

  const hasCover = !!currentTrack?.cover_path;

  let body;
  if (!currentTrack) {
    body = <Empty icon="♪" title="Nada en reproducción" />;
  } else if (loading) {
    body = <div className="lyrics-loading">Cargando letra…</div>;
  } else if (data?.instrumental) {
    body = <Empty icon="🎹" title="Instrumental" sub="Esta pista no tiene voz." />;
  } else if (!lines.length) {
    body = <Empty icon="🎙️" title="Sin letra disponible" sub="No hay un .lrc junto a esta canción." />;
  } else if (!synced) {
    body = (
      <div className="lyrics-plain">
        {lines.map((l, i) => <p key={i}>{l.text || ' '}</p>)}
      </div>
    );
  } else {
    body = (
      <div className="lyrics-synced">
        {lines.map((l, i) => {
          const dist = activeIdx >= 0 ? Math.abs(i - activeIdx) : null;   // distancia a la línea activa
          const isActive = i === activeIdx;
          const state = isActive ? ' active' : dist === 1 ? ' near' : '';
          const text = l.text || '♪';
          return (
            <p
              key={i}
              ref={isActive ? activeRef : null}
              className={`lyrics-line${state}`}
              onClick={() => l.time != null && seek(l.time - offset)}
              title={l.time != null ? 'Saltar a esta línea' : undefined}
            >
              {isActive ? (
                <>
                  {/* Base atenuada (define el tamaño y es la que anuncian los lectores) */}
                  <span className="lyrics-base">{text}</span>
                  {/* Copia brillante recortada por --p (barrido izq→der). Decorativa. */}
                  <span className="lyrics-wipe" aria-hidden="true">{text}</span>
                </>
              ) : text}
            </p>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`lyrics-panel${immersive ? ' immersive' : ''}`}>
      {/* Fondo: carátula actual difuminada + doble oscurecido (legibilidad sobre
          portadas claras). Solo si hay carátula; si no, queda el glass sólido. */}
      {hasCover && (
        <div
          className="lyrics-bg"
          style={{ backgroundImage: `url(${coverUrl(currentTrack.id)})` }}
          aria-hidden="true"
        />
      )}
      <div className="lyrics-header">
        <div className="lyrics-head-text">
          <span className="lyrics-kicker">
            Letra{synced ? ' · sincronizada' : ''}
            {/* Letra remota (fallback): badge sutil, en familia con el "vía
                MusicBrainz" del panel de Info, para distinguirla de los .lrc curados. */}
            {data?.source === 'lrclib' && !data?.instrumental && (
              <span className="lyrics-via" title="Letra obtenida de LRCLIB (lrclib.net)">
                <span className="lyrics-via-dot" aria-hidden="true">●</span>vía LRCLIB
              </span>
            )}
          </span>
          {currentTrack && <span className="lyrics-song">{currentTrack.title ?? ''}</span>}
        </div>
        <div className="lyrics-head-actions">
          {synced && (
            <div className="lyrics-sync" title="Ajuste de sincronía (se guarda para esta canción)">
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(-0.5)} title="Atrasar 0.5 s" aria-label="Atrasar medio segundo">−.5</button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(-0.1)} title="Atrasar 0.1 s" aria-label="Atrasar una décima">−.1</button>
              <button
                className={`lyrics-sync-val${offset !== 0 ? ' on' : ''}`}
                onClick={offset !== 0 ? resetOffset : undefined}
                title={offset !== 0 ? 'Restablecer sincronía' : 'Sincronía'}
              >
                {offset === 0 ? 'sync' : `${offset > 0 ? '+' : '−'}${Math.abs(offset).toFixed(1)} s`}
              </button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(0.1)} title="Adelantar 0.1 s" aria-label="Adelantar una décima">+.1</button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(0.5)} title="Adelantar 0.5 s" aria-label="Adelantar medio segundo">+.5</button>
            </div>
          )}
          <button
            className="lyrics-toggle"
            onClick={() => setImmersive(v => !v)}
            title={immersive ? 'Reducir' : 'Pantalla completa'}
            aria-label={immersive ? 'Reducir' : 'Pantalla completa'}
            aria-pressed={immersive}
          >
            {immersive ? <ContractIcon /> : <ExpandIcon />}
          </button>
          <button className="lyrics-close" onClick={onClose} title="Cerrar letra">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="lyrics-body" ref={bodyRef}>{body}</div>
    </div>
  );
}

function Empty({ icon, title, sub }) {
  return (
    <div className="lyrics-empty">
      <div className="lyrics-empty-icon">{icon}</div>
      <div className="lyrics-empty-title">{title}</div>
      {sub && <div className="lyrics-empty-sub">{sub}</div>}
    </div>
  );
}

// Entrar a pantalla completa (flechas hacia afuera).
function ExpandIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
// Salir de pantalla completa (flechas hacia adentro).
function ContractIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
