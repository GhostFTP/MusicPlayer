import { useEffect } from 'react';
import { useFavorites, loadFavorites } from '../utils/favorites.js';
import { useToast } from './Toast.jsx';

// Corazón de "Mis favoritos" (utils/favorites.js) para la pista que suena. Vive en la barra de
// escritorio y en el reproductor expandido; NO en las filas (ver la propuesta en el reporte).
// Optimista: se llena al instante; si el servidor falla, vuelve atrás y avisa con un toast ámbar.
// `className` elige la piel: 'fav-player' (barra) o 'exp-icon-btn fav-exp' (expandido).
export default function FavButton({ trackId, className }) {
  const { isFavorite, toggle } = useFavorites();
  const toast = useToast();
  // Empezó a sonar una pista: hace falta saber si es favorita para pintar el corazón. La carga es
  // una sola por cuenta (las siguientes pistas no piden nada).
  useEffect(() => { if (trackId != null) loadFavorites(); }, [trackId]);
  const on = trackId != null && isFavorite(trackId);
  const label = on ? 'Quitar de favoritos' : 'Agregar a favoritos';
  return (
    <button
      type="button"
      className={`${className}${on ? ' fav-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={className.includes('fav-player') ? undefined : label}
      disabled={trackId == null}
      onClick={(e) => {
        e.stopPropagation();   // en la barra, un clic suelto abre el expandido
        toggle(trackId, (msg) => toast(msg, { variant: 'warning' }));
      }}
    >
      <HeartIcon filled={on} />
    </button>
  );
}

export function HeartIcon({ filled, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8.1 3.6 4.8 6.9 4.5c2-.2 3.6.9 5.1 2.7 1.5-1.8 3.1-2.9 5.1-2.7 3.3.3 5.2 3.6 4.1 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" />
    </svg>
  );
}
