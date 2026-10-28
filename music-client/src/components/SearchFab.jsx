// Botón flotante (solo móvil) para ir a Buscar. Gemelo de SettingsFab: en desktop la entrada vive en el
// sidebar. Va en el clúster top-right, a la IZQUIERDA de Ajustes (que está a la izquierda de la campanita);
// el BottomNav no cambia: ya lleva 7 destinos y no hay lugar para un octavo.
// `hidden`: el Player lo oculta cuando el expandido/letra/info/cola están abiertos (mismo criterio que los
// otros dos). En la propia vista Buscar no se renderiza (no apuntar a uno mismo): ahí la caja ya está a la vista.
export default function SearchFab({ navigate, view, hidden }) {
  if (hidden || view === 'search') return null;

  return (
    <button
      className="search-fab"
      onClick={() => navigate('search')}
      title="Buscar"
      aria-label="Buscar"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </button>
  );
}
