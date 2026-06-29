// Chip discreto y reutilizable de calidad de audio: "FLAC 16/44.1", "MP3 320"…
// Se pinta verde cuando la pista es lossless. Acepta `className` extra para
// ajustar su contexto (lista, player, player expandido).
export default function QualityChip({ track, className = '', format = 'short' }) {
  if (!track) return null;
  const label = format === 'full' ? qualityFull(track) : qualityLabel(track);
  if (!label) return null;

  const cls = [
    'quality-chip',
    track.lossless ? 'lossless' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={cls} title={qualityTooltip(track)}>
      {label}
    </span>
  );
}

export function qualityLabel(t) {
  const fmtName = shortCodec(t.codec);
  if (!fmtName && !t.sample_rate) return null;

  const khz = t.sample_rate ? t.sample_rate / 1000 : null;
  const khzStr = khz ? (Number.isInteger(khz) ? String(khz) : khz.toFixed(1)) : null;

  // Lossless: profundidad de bits / frecuencia → 16/44.1, 24/48…
  if (t.lossless && t.bits_per_sample && khzStr) {
    return `${fmtName ?? 'Lossless'} ${t.bits_per_sample}/${khzStr}`;
  }
  // Con pérdida: mostramos el bitrate en kbps.
  if (t.bitrate) {
    return `${fmtName ?? ''} ${Math.round(t.bitrate / 1000)}`.trim();
  }
  return fmtName;
}

// Cadena de calidad completa para el reproductor: "FLAC · 16-bit · 44.1 kHz · 1029 kbps".
// Cada parte se omite si su campo viene null/0, así nunca se muestra "undefined".
export function qualityFull(t) {
  if (!t) return null;
  const parts = [];
  const codec = shortCodec(t.codec) ?? t.codec;
  if (codec)             parts.push(codec);
  if (t.bits_per_sample) parts.push(`${t.bits_per_sample}-bit`);
  if (t.sample_rate) {
    const khz = t.sample_rate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
  }
  if (t.bitrate)         parts.push(`${Math.round(t.bitrate / 1000)} kbps`);
  return parts.length ? parts.join(' · ') : null;
}

// Sólo el códec, para el badge del player (FLAC, MP3…). null si no se conoce.
export function qualityCodec(t) {
  if (!t) return null;
  return shortCodec(t.codec) ?? t.codec ?? null;
}

// Detalle de calidad SIN el códec: "16-bit · 44.1 kHz · 877 kbps".
// Omite cada parte que falte; null si no queda nada (nunca "undefined").
export function qualityDetail(t) {
  if (!t) return null;
  const parts = [];
  if (t.bits_per_sample) parts.push(`${t.bits_per_sample}-bit`);
  if (t.sample_rate) {
    const khz = t.sample_rate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
  }
  if (t.bitrate)         parts.push(`${Math.round(t.bitrate / 1000)} kbps`);
  return parts.length ? parts.join(' · ') : null;
}

export function qualityTooltip(t) {
  const parts = [];
  if (t.codec)           parts.push(shortCodec(t.codec) ?? t.codec);
  if (t.bits_per_sample) parts.push(`${t.bits_per_sample} bit`);
  if (t.sample_rate)     parts.push(`${(t.sample_rate / 1000).toFixed(1)} kHz`);
  if (t.bitrate)         parts.push(`${Math.round(t.bitrate / 1000)} kbps`);
  parts.push(t.lossless ? 'sin pérdida' : 'con pérdida');
  return parts.join(' · ');
}

// Normaliza el codec/contenedor de music-metadata a una etiqueta corta.
export function shortCodec(codec) {
  if (!codec) return null;
  const c = codec.toUpperCase();
  if (c.includes('FLAC'))                          return 'FLAC';
  if (c.includes('LAYER 3') || c.includes('MP3'))  return 'MP3';
  if (c.includes('AAC') || c.includes('MPEG-4'))   return 'AAC';
  if (c.includes('OPUS'))                          return 'OPUS';
  if (c.includes('VORBIS') || c.includes('OGG'))   return 'OGG';
  if (c.includes('ALAC'))                          return 'ALAC';
  if (c.includes('PCM') || c.includes('WAVE') || c.includes('WAV')) return 'WAV';
  if (c.includes('WMA') || c.includes('WINDOWS MEDIA')) return 'WMA';
  return codec.split('/')[0].trim().toUpperCase();
}
