import { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client.js';
import SearchBox from './SearchBox.jsx';
import { useListFilter } from '../utils/useListFilter.js';

// Dónde busca el buscador: el texto del punto (ya sin las marcas de formato), y la versión y la fecha
// de su entrada — así "1.28" o "2026-09" traen la entrada completa, porque coinciden todos sus puntos.
const SEARCH_FIELDS = ['texto', 'version', 'date'];

// Parser mínimo del CHANGELOG.md (sin dependencias): agrupa por versión (## ) y
// sección (### ), con items de lista (- ). Ignora el título y la intro.
function parseChangelog(md) {
  const versions = [];
  let cur = null;   // versión en curso
  let sec = null;   // sección en curso
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+)$/))) {
      cur = { version: m[1].trim(), date: m[2].trim(), sections: [] };
      versions.push(cur);
      sec = null;
    } else if (line.startsWith('## ')) {                 // versión sin fecha
      cur = { version: line.slice(3).replace(/[[\]]/g, '').trim(), date: '', sections: [] };
      versions.push(cur);
      sec = null;
    } else if (line.startsWith('### ')) {
      if (!cur) continue;
      sec = { title: line.slice(4).trim(), items: [] };
      cur.sections.push(sec);
    } else if (line.startsWith('- ')) {
      if (sec) sec.items.push(line.slice(2).trim());
    } else if (line.trim() && sec && sec.items.length) {
      // Continuación de un item envuelto en varias líneas → concatenar con un
      // espacio, para no truncarlo ni partir una negrita/código entre líneas.
      sec.items[sec.items.length - 1] += ' ' + line.trim();
    }
  }
  return versions;
}

// Formato inline: **negrita** y `código` → nodos React.
function fmt(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`')  && p.endsWith('`'))  return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}

// Clase por sección para colorear el título. Normaliza acentos, así "Añadido" → 'anadido' y
// "Técnico" → 'tecnico' (por eso las clases del CSS no llevan tilde).
function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

// Ícono por categoría. Mismo idioma que el resto de los íconos de la casa (ContextMenu): 14px,
// viewBox 24, trazo de 2 y `currentColor` — que acá es la clave: el color lo pone la clase del
// título, así que ícono y texto NO pueden desincronizarse por más categorías que se sumen.
//
// El CHANGELOG usa SEIS encabezados, no cuatro: "Nuevo" es como se llamaba "Añadido" en las
// entradas viejas (v1.4.x y anteriores) y sigue vivo en el archivo. Son la MISMA categoría, así
// que comparten ícono y color a propósito: si no, al hacer scroll la misma idea cambiaría de
// color a mitad del historial.
const ICONS = {
  anadido:   <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  corregido: <path d="M4 12.5l5 5L20 6.5" />,
  cambiado:  <><path d="M4 8h13l-3.5-3.5" /><path d="M20 16H7l3.5 3.5" /></>,
  mejorado:  <><line x1="12" y1="20" x2="12" y2="6" /><path d="M6 12l6-6 6 6" /></>,
  tecnico:   <><path d="M9 18l-6-6 6-6" /><path d="M15 6l6 6-6 6" /></>,
};
ICONS.nuevo = ICONS.anadido;   // mismo concepto, distinto nombre según la época del archivo

function SectionIcon({ kind }) {
  const glyph = ICONS[kind];
  if (!glyph) return null;     // categoría desconocida → título sin ícono, nunca un hueco raro
  return (
    <svg
      className="cl-section-icon" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}

export default function Changelog({ target, clearTarget }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState(false);

  // BUSCADOR (utils/useListFilter.js, el de las demás vistas). El hook filtra una lista PLANA, y acá
  // hay versión → sección → puntos: se aplanan los puntos (cada uno sabe de qué versión y sección es),
  // se filtran, y con los que quedan se vuelve a armar el árbol. Se filtra POR PUNTO: una sección o
  // una versión sin puntos visibles no se muestra. El texto buscable va sin `**` ni backticks (una
  // frase que cruza el borde de una negrita tiene que coincidir); lo demás queda tal cual se ve.
  const puntos = useMemo(() => (versions ?? []).flatMap((v, vi) => v.sections.flatMap((sec, si) => sec.items.map((it, k) => ({
    vi, si, k, texto: it.replace(/\*\*|`/g, ''), version: `v${v.version.replace(/^v/i, '')}`, date: v.date,
  })))), [versions]);
  const { query, setQuery, activeQuery, filtered } = useListFilter(puntos, SEARCH_FIELDS);
  const shown = useMemo(() => {
    if (!versions || filtered === puntos) return versions ?? [];
    const quedan = new Set(filtered.map((p) => `${p.vi}/${p.si}/${p.k}`));
    return versions
      .map((v, vi) => ({ ...v, sections: v.sections.map((sec, si) => ({ ...sec, items: sec.items.filter((_, k) => quedan.has(`${vi}/${si}/${k}`)) })).filter((sec) => sec.items.length) }))
      .filter((v) => v.sections.length);
  }, [versions, puntos, filtered]);

  // Tocar "Novedades" estando ya en Novedades (el `tab` de Layout.navigate) borra el buscador.
  useEffect(() => {
    if (!target?.reset) return;
    if (target.tab) setQuery('');
    clearTarget?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    api.changelog()
      .then(({ content }) => {
        const parsed = parseChangelog(content || '');
        setVersions(parsed);
        // Marcar la última versión como vista → apaga el puntito de la campana móvil.
        if (parsed[0]?.version) localStorage.setItem('lastSeenVersion', parsed[0].version);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📋</div>
        <div className="empty-title">No se pudieron cargar las novedades</div>
      </div>
    );
  }
  if (!versions) return <div className="spinner">Cargando novedades…</div>;

  return (
    <div className="changelog">
      <div className="section-header">
        <h1 className="section-title">Novedades</h1>
        {versions.length > 0 && (
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar en novedades…" label="Buscar en novedades" />
        )}
      </div>

      {versions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Sin novedades por ahora</div>
        </div>
      ) : shown.length === 0 ? (
        // Hay novedades pero ningún punto coincide: el título y el buscador siguen arriba para corregir.
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Sin resultados para «{activeQuery}»</div>
        </div>
      ) : (
        shown.map((v) => (
          <section key={v.version} className="cl-version">
            <div className="cl-version-head">
              <span className="cl-badge">v{v.version.replace(/^v/i, '')}</span>
              {v.date && <span className="cl-date">{v.date}</span>}
            </div>
            {v.sections.map((s, j) => {
              const kind = slug(s.title);
              return (
              <div key={j} className="cl-section">
                <h3 className={`cl-section-title cl-${kind}`}>
                  <SectionIcon kind={kind} />
                  {s.title}
                </h3>
                <ul className="cl-list">
                  {s.items.map((it, k) => <li key={k}>{fmt(it)}</li>)}
                </ul>
              </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
