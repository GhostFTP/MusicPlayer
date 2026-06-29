import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { qualityFull, qualityTier, shortCodec } from './QualityChip.jsx';

// Duración legible a partir de segundos: "1 h 12 min", "3 min 45 s", "48 s".
function fmtDuration(sec) {
  if (!sec || isNaN(sec)) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${String(ss).padStart(2, '0')} s`;
  return `${ss} s`;
}

// kHz sin decimales innecesarios: 44100 → "44.1", 48000 → "48".
function khz(sr) {
  if (!sr) return null;
  const k = sr / 1000;
  return Number.isInteger(k) ? `${k}` : k.toFixed(1);
}

// Resumen de calidad del álbum a partir de sus pistas (campos ya en la DB):
// "Todo el álbum en FLAC 16/44.1", "12/14 pistas lossless", etc.
function albumQualitySummary(tracks) {
  if (!tracks?.length) return null;
  const n = tracks.length;
  const ll = tracks.filter(t => t.lossless).length;
  if (ll === n) {
    const codecs = new Set(tracks.map(t => shortCodec(t.codec) ?? t.codec));
    const bitsSet = new Set(tracks.map(t => t.bits_per_sample));
    const srSet = new Set(tracks.map(t => t.sample_rate));
    if (codecs.size === 1 && bitsSet.size === 1 && srSet.size === 1) {
      const c = [...codecs][0];
      const b = [...bitsSet][0];
      const s = [...srSet][0];
      const spec = b && s ? ` ${b}/${khz(s)}` : '';
      return `Todo el álbum en ${c}${spec}`;
    }
    return `Álbum lossless (${n} pistas)`;
  }
  if (ll > 0) return `${ll}/${n} pistas lossless`;
  return `Álbum con pérdida (${n} pistas)`;
}

// Filas clave/valor; se omiten limpio las que no tienen valor (sin "undefined").
function InfoRows({ rows }) {
  const visible = rows.filter(([, v]) => v != null && v !== '');
  if (!visible.length) return null;
  return (
    <dl className="info-grid">
      {visible.map(([k, v]) => (
        <div className="info-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

// Sección completa (título + filas); no se pinta si no hay ninguna fila visible.
function InfoSection({ title, rows }) {
  if (!rows.some(([, v]) => v != null && v !== '')) return null;
  return (
    <section className="info-section">
      <h4 className="info-section-title">{title}</h4>
      <InfoRows rows={rows} />
    </section>
  );
}

// Panel de información de la pista. SOLO usa datos que ya están en la DB
// (no biografías ni fuentes externas). Pensado para crecer luego con MusicBrainz.
export default function InfoPanel({ track, onClose }) {
  const [album, setAlbum] = useState(null);   // { count, total, summary }

  // Agregados del álbum (nº de pistas, duración y calidad) desde el endpoint
  // existente /api/tracks?album=… (trae los campos de calidad por pista).
  // Se filtra por álbum + album_artist para no mezclar álbumes homónimos de
  // artistas distintos (inflaría el conteo). album_artist sólo se incluye si existe.
  useEffect(() => {
    if (!track?.album) { setAlbum(null); return; }
    let cancelled = false;
    const params = { album: track.album, limit: 500 };
    if (track.album_artist) params.album_artist = track.album_artist;
    api.tracks(params)
      .then(tracks => {
        if (cancelled) return;
        const total = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
        setAlbum({ count: tracks.length, total, summary: albumQualitySummary(tracks) });
      })
      .catch(() => { if (!cancelled) setAlbum(null); });
    return () => { cancelled = true; };
  }, [track?.album, track?.album_artist]);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!track) return null;

  const tier = qualityTier(track);
  const full = qualityFull(track);

  const trackRows = [
    ['Nº de pista', track.track_number != null ? String(track.track_number) : null],
    ['Duración',    fmtDuration(track.duration)],
  ];
  const albumRows = [
    ['Título',   track.album],
    ['Artista',  track.album_artist || track.artist],
    ['Año',      track.year != null ? String(track.year) : null],
    ['Género',   track.genre],
    ['Pistas',   album?.count ? String(album.count) : null],
    ['Duración', album ? fmtDuration(album.total) : null],
  ];
  const qualityRows = [
    ['Códec',             shortCodec(track.codec) ?? track.codec],
    ['Profundidad',       track.bits_per_sample ? `${track.bits_per_sample}-bit` : null],
    ['Frecuencia',        track.sample_rate ? `${khz(track.sample_rate)} kHz` : null],
    ['Bitrate',           track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : null],
    ['Sin pérdida',       track.lossless == null ? null : (track.lossless ? 'Sí' : 'No')],
    ['Calidad del álbum', album?.summary ?? null],
  ];
  const hasQuality = full || qualityRows.some(([, v]) => v != null && v !== '');

  return (
    <div className="info-overlay" onClick={onClose}>
      <div
        className="info-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Información de la pista"
      >
        <div className="info-header">
          <div className="info-head-text">
            <span className="info-kicker">Información</span>
            <span className="info-title">{track.title ?? '—'}</span>
          </div>
          <button className="info-close" onClick={onClose} title="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="info-body">
          <InfoSection title="Pista actual" rows={trackRows} />
          <InfoSection title="Álbum" rows={albumRows} />

          {hasQuality && (
            <section className="info-section">
              <h4 className="info-section-title">Calidad</h4>
              {full && (
                <div className="info-quality">
                  <span className={`quality-chip q-${tier.id}`}>{full}</span>
                  <span className="info-quality-note">{tier.name}</span>
                </div>
              )}
              <InfoRows rows={qualityRows} />
            </section>
          )}

          {/* Espacio reservado para datos de MusicBrainz (bio / discografía /
              relaciones). Aún no implementado: cuando se importen los MBID se
              añade aquí otra <InfoSection> sin tocar el resto del panel. */}
        </div>
      </div>
    </div>
  );
}
