// Botón de volver de los DETALLES (álbum, artista, género, año, playlist) — Frente 3, F3a.
// Pastilla: flecha de 22px + texto, fondo sutil, área táctil de 44px de alto. Vuelve con el
// historial (Modelo 2: el detalle es una entrada de ruta), igual que antes; el gesto de deslizar
// para volver (Layout) no pasa por acá y no cambia. Las cinco vistas comparten este componente
// para que el botón sea el mismo en todas.
export default function BackButton({ label }) {
  return (
    <button type="button" className="back-btn" onClick={() => window.history.back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
