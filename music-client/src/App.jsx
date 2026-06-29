import { useAuth } from './context/AuthContext.jsx';
import Login  from './components/Login.jsx';
import Layout from './components/Layout.jsx';

export default function App() {
  const { isAuth, checking } = useAuth();
  // Mientras se comprueba la identidad de Cloudflare Access, no pintamos nada
  // (evita mostrar el Login un instante antes del auto-login).
  if (checking) return null;
  return isAuth ? <Layout /> : <Login />;
}
