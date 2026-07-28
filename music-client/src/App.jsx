import { useAuth } from './context/AuthContext.jsx';
import Login  from './components/Login.jsx';
import Layout from './components/Layout.jsx';
import { ContextMenuProvider } from './components/ContextMenu.jsx';

export default function App() {
  const { isAuth, checking } = useAuth();
  // Mientras se comprueba la identidad de Cloudflare Access, no pintamos nada
  // (evita mostrar el Login un instante antes del auto-login).
  if (checking) return null;
  // El menú contextual (actions-lab) envuelve la app logueada: es UN solo menú para todas las
  // superficies. Va acá y no dentro de Layout porque el menú es un popover `fixed` con capa
  // propia (--z-context-menu), no una celda del grid de .layout. Queda dentro de PlayerProvider
  // y ToastProvider (main.jsx), que es lo que consume.
  return isAuth
    ? <ContextMenuProvider><Layout /></ContextMenuProvider>
    : <Login />;
}
