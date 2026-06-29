import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

// Parsea .lrc → [{time:number|null, text}]. Soporta varias marcas por línea
// (líneas repetidas) y descarta metadatos [ar:][ti:][offset:]…
function parseLrc(lrc) {
  const stampRe = /\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g;
  const metaRe  = /^\s*\[[a-z#]+:[^\]]*\]\s*$/i;
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    if (metaRe.test(raw)) continue;
    const stamps = [];
    let m; stampRe.lastIndex = 0;
    while ((m = stampRe.exec(raw)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
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

export default function LyricsPanel({ onClose }) {
  const { currentTrack, currentTime, seek } = usePlayer();
  const [data, setData]       = useState(null);   // { instrumental, synced, lyrics }
  const [loading, setLoading] = useState(false);
  const activeRef = useRef(null);

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

  const lines  = data && !data.instrumental && data.lyrics ? parseLrc(data.lyrics) : [];
  const synced = !!data?.synced && lines.some(l => l.time != null);

  // línea activa = última cuyo timestamp ya pasó
  let activeIdx = -1;
  if (synced) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time != null && lines[i].time <= currentTime + 0.2) activeIdx = i;
    }
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

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
        {lines.map((l, i) => <p key={i}>{l.text || ' '}</p>)}
      </div>
    );
  } else {
    body = (
      <div className="lyrics-synced">
        {lines.map((l, i) => (
          <p
            key={i}
            ref={i === activeIdx ? activeRef : null}
            className={`lyrics-line${i === activeIdx ? ' active' : ''}`}
            onClick={() => l.time != null && seek(l.time)}
            title={l.time != null ? 'Saltar a esta línea' : undefined}
          >
            {l.text || '♪'}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="lyrics-panel">
      <div className="lyrics-header">
        <div className="lyrics-head-text">
          <span className="lyrics-kicker">Letra{synced ? ' · sincronizada' : ''}</span>
          {currentTrack && <span className="lyrics-song">{currentTrack.title ?? ''}</span>}
        </div>
        <button className="lyrics-close" onClick={onClose} title="Cerrar letra">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div className="lyrics-body">{body}</div>
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
