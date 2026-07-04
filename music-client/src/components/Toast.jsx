import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastCtx = createContext(() => {});

// Aviso central reutilizable. Cualquier componente hace `const toast = useToast()`
// y luego `toast('mensaje', { icon, duration })`. Glass, entrada scale+fade, se
// auto-cierra (~2s). Respeta prefers-reduced-motion (aparece/desaparece sin animar).
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);   // [{ id, text, icon }]
  const idRef = useRef(0);

  const toast = useCallback((text, { icon = '✓', duration = 2000 } = {}) => {
    const id = ++idRef.current;
    setToasts(list => [...list, { id, text, icon }]);
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), duration);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-layer" aria-live="polite" aria-atomic="true">
        {toasts.map(t => (
          <div key={t.id} className="toast" role="status">
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
