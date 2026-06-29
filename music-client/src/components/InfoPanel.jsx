import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { qualityFull } from './QualityChip.jsx';

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

// Panel de información de la pista. SOLO usa datos que ya están en la DB
// (no biografías ni fuentes externas). Pensado para crecer luego con MusicBrainz.
export default function InfoPanel({ track, onClose }) {
  const [albumAgg, setAlbumAgg] = useState(null);   // { count, total } del álbum

  // Agregados del álbum (nº de pistas + duración total) desde el endpoint existente.
  useEffect(() => {
    if (!track?.album) { setAlbumAgg(null); return; }
    let cancelled = false;
    api.albumTracks(track.album)
      .then(tracks => {
        if (cancelled) return;
        const total = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
        setAlbumAgg({ count: tracks.length, total });
      })
      .catch(() => { if (!cancelled) setAlbumAgg(null); });
    return () => { cancelled = true; };
  }, [track?.album]);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!track) return null;

  // Cada fila se omite limpia si su campo falta (nunca se muestra vacío/undefined).
  const rows = [
    ['Álbum',               track.album],
    ['Artista',             track.album_artist || track.artist],
    ['Año',                 track.year],
    ['Género',              track.genre],
    ['Pistas del álbum',    albumAgg?.count ? String(albumAgg.count) : null],
    ['Duración del álbum',  albumAgg ? fmtDuration(albumAgg.total) : null],
  ].filter(([, v]) => v != null && v !== '');

  const quality = qualityFull(track);

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
          {rows.length > 0 && (
            <dl className="info-grid">
              {rows.map(([k, v]) => (
                <div className="info-row" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {quality && (
            <section className="info-section">
              <h4 className="info-section-title">Calidad de audio</h4>
              <div className="info-quality">
                <span className={`quality-chip${track.lossless ? ' lossless' : ''}`}>{quality}</span>
                <span className="info-quality-note">{track.lossless ? 'Sin pérdida' : 'Con pérdida'}</span>
              </div>
            </section>
          )}

          {/* Espacio reservado para datos de MusicBrainz (artista/álbum/relaciones).
              Aún no implementado: cuando se importen los MBID se añade aquí otra
              <section className="info-section"> sin tocar el resto del panel. */}
        </div>
      </div>
    </div>
  );
}
