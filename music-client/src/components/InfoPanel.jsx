import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { qualityTier, qualityCodec, qualityTierTitle, shortCodec } from './QualityChip.jsx';

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

function Chevron() {
  return (
    <svg className="info-artist-chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Bloque expandible del artista: al abrir, carga (perezoso) los agregados LOCALES
// de la DB (/api/browse/artists/:artist) y ofrece navegar a su vista.
function ArtistBlock({ artistName, artistKey, navigate }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open || data || err || !artistKey) return;
    let cancelled = false;
    api.artistDetail(artistKey)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [open, artistKey, data, err]);

  if (!artistName) return null;
  const canExpand = !!artistKey;

  const q = data?.quality;
  const qParts = q ? [
    q.hires    ? `${q.hires} hi-res`      : null,
    q.lossless ? `${q.lossless} lossless` : null,
    q.lossy    ? `${q.lossy} con pérdida` : null,
  ].filter(Boolean).join(' · ') : null;

  return (
    <section className="info-section">
      <h4 className="info-section-title">Artista</h4>
      <button
        className={`info-artist-row${open ? ' open' : ''}`}
        onClick={() => canExpand && setOpen(o => !o)}
        aria-expanded={open}
        disabled={!canExpand}
      >
        <span className="info-artist-name">{artistName}</span>
        {canExpand && <Chevron />}
      </button>

      <div className={`info-artist-sub${open ? ' open' : ''}`}>
        <div className="info-artist-sub-inner">
          {err && <p className="info-artist-empty">No se pudieron cargar los datos.</p>}
          {!err && !data && <p className="info-artist-empty">Cargando…</p>}
          {data && (
            <>
              <InfoRows rows={[
                ['Álbumes',   data.album_count ? String(data.album_count) : null],
                ['Canciones', data.track_count ? String(data.track_count) : null],
                ['Géneros',   data.genres?.length ? data.genres.join(' · ') : null],
                ['Calidad',   qParts],
              ]} />
              <button className="info-artist-go" onClick={() => navigate('artists', { artist: artistKey })}>
                Ver artista <span aria-hidden="true">→</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// Panel de información de la pista. SOLO usa datos que ya están en la DB
// (no biografías ni fuentes externas). Pensado para crecer luego con MusicBrainz.
export default function InfoPanel({ track, onClose, navigate }) {
  const [album, setAlbum] = useState(null);   // { count, total, summary }

  // Agregados del álbum (para el resumen de calidad) desde /api/tracks?album=…
  // Filtrado por álbum + album_artist para no mezclar homónimos de otros artistas.
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
  const qCodec = qualityCodec(track);

  const trackRows = [
    ['Álbum',       track.album],
    ['Año',         track.year != null ? String(track.year) : null],
    ['Género',      track.genre],
    ['Nº de pista', track.track_number != null ? String(track.track_number) : null],
    ['Duración',    fmtDuration(track.duration)],
  ];
  const qualityRows = [
    ['Códec',             shortCodec(track.codec) ?? track.codec],
    ['Profundidad',       track.bits_per_sample ? `${track.bits_per_sample}-bit` : null],
    ['Frecuencia',        track.sample_rate ? `${khz(track.sample_rate)} kHz` : null],
    ['Bitrate',           track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : null],
    ['Sin pérdida',       track.lossless == null ? null : (track.lossless ? 'Sí' : 'No')],
    ['Calidad del álbum', album?.summary ?? null],
  ];
  const hasQuality = qCodec || qualityRows.some(([, v]) => v != null && v !== '');

  const artistName = track.album_artist || track.artist || null;
  const artistKey  = track.album_artist || null;

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
          <InfoSection title="Pista" rows={trackRows} />

          <ArtistBlock artistName={artistName} artistKey={artistKey} navigate={navigate} />

          {hasQuality && (
            <section className="info-section">
              <h4 className="info-section-title">Calidad</h4>
              {qCodec && (
                <div className="info-quality">
                  <span className={`quality-chip q-${tier.id}`} title={qualityTierTitle(track)}>{qCodec}</span>
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
