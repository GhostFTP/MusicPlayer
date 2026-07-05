import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastCtx = createContext(() => {});

// Aviso central reutilizable. Cualquier componente hace `const toast = useToast()`
// y luego `toast('mensaje', { icon, duration, variant })`. Glass, entrada
// scale+fade, se auto-cierra. Respeta prefers-reduced-motion (sin animar).
// Variantes: 'default' (confirmación, ✓ verde, ~2s) y 'warning' (aviso, ⚠️
// ámbar, más grande, ~3.5s) — claramente distinguibles entre sí.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);   // [{ id, text, icon, variant }]
  const idRef = useRef(0);

  const toast = useCallback((text, { icon, duration, variant = 'default' } = {}) => {
    const warning = variant === 'warning';
    const id = ++idRef.current;
    setToasts(list => [...list, { id, text, icon: icon ?? (warning ? '⚠️' : '✓'), variant }]);
    setTimeout(
      () => setToasts(list => list.filter(t => t.id !== id)),
      duration ?? (warning ? 3500 : 2000),
    );
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-layer" aria-live="polite" aria-atomic="true">
        {toasts.map(t => (
          <div key={t.id} className={`toast${t.variant === 'warning' ? ' warning' : ''}`} role="status">
            {t.icon && <span className="toast-icon" aria-hidden="true">{t.icon}</span>}
            <span className="toast-text">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
