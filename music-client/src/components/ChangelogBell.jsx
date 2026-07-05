import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

// Botón flotante (solo móvil) para ir a Novedades. Muestra un puntito cuando la
// última versión del CHANGELOG es más nueva que la última vista (localStorage
// 'lastSeenVersion'). La vista Novedades marca como vista al abrirse; esta campana
// re-lee la marca al salir de esa vista, así el puntito desaparece.
// `hidden`: el Player la oculta cuando el expandido/letra/info están abiertos.
export default function ChangelogBell({ navigate, view, hidden }) {
  const [latest, setLatest] = useState(null);
  const [seen, setSeen] = useState(() => localStorage.getItem('lastSeenVersion'));

  // Última versión = primer "## [x.y.z]" del CHANGELOG (viene ordenado, más nuevo primero).
  useEffect(() => {
    let cancelled = false;
    api.changelog()
      .then(d => {
        if (cancelled) return;
        const m = d?.content?.match(/^##\s+\[([^\]]+)\]/m);
        setLatest(m ? m[1].trim() : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Al salir de Novedades, re-leemos la marca que la vista dejó al abrirse.
  useEffect(() => {
    if (view !== 'changelog') setSeen(localStorage.getItem('lastSeenVersion'));
  }, [view]);

  if (hidden || view === 'changelog') return null;

  const hasNew = !!latest && latest !== seen;

  return (
    <button
      className="changelog-bell"
      onClick={() => navigate('changelog')}
      title="Novedades"
      aria-label={hasNew ? 'Novedades — hay una versión nueva' : 'Novedades'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {hasNew && <span className="changelog-bell-dot" aria-hidden="true" />}
    </button>
  );
}
