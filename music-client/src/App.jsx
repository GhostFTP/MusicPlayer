import { useAuth } from './context/AuthContext.jsx';
import Login  from './components/Login.jsx';
import Layout from './components/Layout.jsx';
import { ContextMenuProvider } from './components/ContextMenu.jsx';
import { RadioProvider } from './context/RadioContext.jsx';

export default function App() {
  const { isAuth, checking } = useAuth();
  // Mientras se comprueba la identidad de Cloudflare Access, no pintamos nada
  // (evita mostrar el Login un instante antes del auto-login).
  if (checking) return null;
  // El menú contextual (actions-lab) envuelve la app logueada: es UN solo menú para todas las
  // superficies. Va acá y no dentro de Layout porque el menú es un popover `fixed` con capa
  // propia (--z-context-menu), no una celda del grid de .layout. Queda dentro de PlayerProvider
  // y ToastProvider (main.jsx), que es lo que consume.
  // La radio (RadioProvider) envuelve a Layout: queda por ENCIMA de las vistas (navegar no la corta)
  // y sólo existe con sesión: logout o el reauth de SSO la desmontan y cortan sus temporizadores.
  return isAuth
    ? <ContextMenuProvider><RadioProvider><Layout /></RadioProvider></ContextMenuProvider>
    : <Login />;
}
