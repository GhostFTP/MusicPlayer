import { coverUrl } from '../api/client.js';

// Portada "collage" de una playlist: recibe una lista de track-ids (0..4) con
// carátula y el emoji de fallback, y decide el layout según cuántas covers haya.
// NO calcula el hue: hereda `--h` del contenedor padre (.playlist-medallion /
// .pl-hero-cover). El emoji es el fallback EXACTO del caso 0 → cero regresión.
//
//   4 → grid 2×2 (cuatro img)     1 → cover a sangre completa (full-bleed)
//   3 → 2×2 con la 4ª celda wash  0 → glifo del emoji sobre el wash --h (hoy)
//   2 → split en dos mitades
//
// `lazy` (Mosaico) pone loading="lazy" en las imgs; el hero las carga ansiosas.
export default function PlaylistCover({ ids, emoji, lazy = false }) {
  const covers = (Array.isArray(ids) ? ids : []).slice(0, 4);
  const n = covers.length;

  // Caso 0: sin carátulas → el emoji sobre el wash --h, idéntico a hoy.
  if (n === 0) return <>{emoji || '🎵'}</>;

  return (
    <div className={`pl-cover pl-cover-${n}`}>
      {covers.map(id => (
        <img
          key={id}
          className="pl-cover-cell"
          src={coverUrl(id)}
          loading={lazy ? 'lazy' : undefined}
          alt=""
        />
      ))}
      {/* Caso 3: 4ª celda = wash --h (coherente con el medallón). */}
      {n === 3 && <span className="pl-cover-cell pl-cover-empty" aria-hidden="true" />}
    </div>
  );
}
