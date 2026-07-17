import { useState, useEffect } from 'react';
import { artistImageUrl, coverUrl } from '../api/client.js';

// Iniciales como último recurso: hasta 2 palabras ("Daft Punk" → DP, "Nujabes" → N).
function initials(name) {
  return (name ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => [...w][0].toUpperCase()).join('');
}

// Nivel más alto disponible según lo que dice el backend, sin pedir nada todavía.
function firstLevel(a) {
  if (a.has_image) return 0;              // foto curada
  if (a.sample_track_id) return 1;        // carátula de uno de sus álbumes
  return 2;                               // iniciales
}

// Imagen de un artista con cadena de fallback: foto curada → carátula → iniciales.
//
// El salto de nivel va por `onError`, no por confianza: `has_image` se calcula en el server
// leyendo el disco, así que puede quedar desactualizado (borraste el .jpg entre la lista y
// el clic) y la carátula también puede fallar. Sin onError el navegador pintaría su ícono de
// imagen rota, que es justo lo que no queremos en una tarjeta que ES la foto.
export default function ArtistImage({ artist, className = '' }) {
  const [level, setLevel] = useState(() => firstLevel(artist));

  // La grilla reusa instancias al reordenar/filtrar: si cambia el artista, se reinicia el
  // nivel (si no, un artista sin foto heredaría el nivel degradado del anterior).
  useEffect(() => { setLevel(firstLevel(artist)); }, [artist.artist, artist.has_image, artist.sample_track_id]);

  if (level === 2) {
    return (
      <div className={`artist-img artist-img-initials ${className}`} aria-hidden="true">
        {initials(artist.artist)}
      </div>
    );
  }

  return (
    <img
      className={`artist-img ${className}`}
      src={level === 0 ? artistImageUrl(artist.artist) : coverUrl(artist.sample_track_id)}
      alt=""
      loading="lazy"
      onError={() => setLevel(l => (l === 0 && artist.sample_track_id ? 1 : 2))}
    />
  );
}
