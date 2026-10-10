import { useRef } from 'react';

// Campo de búsqueda de los LISTADOS (Álbumes primero; las demás vistas lo van adoptando). Es el
// .search-box de la Biblioteca más un "✕" para limpiar, y controlado: el texto vive en la vista
// (utils/useListFilter.js), así sobrevive a entrar y salir de un detalle de esa misma vista.
//
// Esc: con texto lo limpia; vacío, suelta el foco. En los dos casos el Esc SE QUEDA ACÁ
// (stopPropagation): el Esc global de Player (la escalera de overlays) escucha en window y, si le
// llegara, el mismo Esc además cerraría la cola o el expandido — un Esc, dos cosas. Durante una
// composición de IME el Esc es del IME (cancela la composición): tampoco sigue viaje, y no limpia.
export default function SearchBox({ value, onChange, placeholder, label }) {
  const inputRef = useRef(null);

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (value) onChange('');
    else e.currentTarget.blur();
  };

  return (
    <div className="search-box sbx" role="search">
      <SearchIcon />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className="sbx-clear"
          aria-label="Limpiar búsqueda"
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
    </svg>
  );
}
