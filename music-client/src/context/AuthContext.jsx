import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

// Decodifica el payload del JWT (parte central) para sacar { id, username }.
function decodeUser(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

// Un JWT sin `exp`, ilegible, o con `exp` ya pasado cuenta como "no hay token":
// evita quedarse con una sesión vencida que nunca se reintenta re-emitir.
function isExpired(token) {
  const payload = decodeUser(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now();
}

// Lee el token de localStorage descartando uno vencido/inválido (limpia y
// devuelve null) para que el auto-login SSO de abajo se dispare en vez de
// quedar pegado a una sesión muerta.
function getStoredToken() {
  const t = localStorage.getItem('token');
  if (!t || isExpired(t)) {
    localStorage.removeItem('token');
    localStorage.removeItem('loginMethod');
    return null;
  }
  return t;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getStoredToken);
  const [user, setUser]   = useState(() => {
    const t = getStoredToken();
    return t ? decodeUser(t) : null;
  });
  // Mientras comprobamos si Cloudflare Access ya nos identifica no mostramos el
  // formulario de login (evita el parpadeo). Solo comprobamos si aún no hay token.
  const [checking, setChecking] = useState(() => !getStoredToken());
  // Cómo se inició la sesión: 'sso' (auto-login por Cloudflare Access) o
  // 'password' (login tradicional). Solo afecta a la presentación (p.ej. mostrar
  // el botón "Salir" únicamente en el modo password). Se persiste para que
  // sobreviva a recargas, igual que el token.
  const [loginMethod, setLoginMethod] = useState(() => localStorage.getItem('loginMethod'));

  const applyToken = useCallback((newToken, method) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('loginMethod', method);
    setToken(newToken);
    setUser(decodeUser(newToken));
    setLoginMethod(method);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    applyToken(data.token, 'password');
  }, [applyToken]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('loginMethod');
    setToken(null);
    setUser(null);
    setLoginMethod(null);
  }, []);

  // Reautentica vía Cloudflare Access: su sesión sigue viva de fondo aunque el
  // JWT propio haya vencido o sea inválido. `checking=true` mientras tanto
  // oculta <Layout/> (App.jsx) para no dejar ver datos rotos ni parpadear a
  // Login. Se usa tanto al montar (si no hay token válido, ver getStoredToken)
  // como al recibir un 401 a mitad de sesión (setUnauthorizedHandler abajo).
  // reauthInFlight dedupea llamadas concurrentes (StrictMode en dev invoca el
  // efecto de mount dos veces; varios fetches pueden recibir 401 casi juntos)
  // para no disparar dos cfLogin() en paralelo.
  const reauthInFlight = useRef(null);
  const reauth = useCallback(() => {
    if (reauthInFlight.current) return reauthInFlight.current;
    const promise = (async () => {
      setChecking(true);
      logout();
      try {
        const data = await api.cfLogin();
        if (data?.token) applyToken(data.token, 'sso');
      } catch {
        /* sin identidad CF → login por contraseña */
      } finally {
        setChecking(false);
        reauthInFlight.current = null;
      }
    })();
    reauthInFlight.current = promise;
    return promise;
  }, [logout, applyToken]);

  useEffect(() => {
    if (!token) reauth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Red de seguridad: un JWT puede vencer a mitad de sesión (la pestaña queda
  // abierta más que el TTL). Cualquier fetch que reciba un 401 dispara reauth()
  // acá mismo, sin que el usuario tenga que recargar ni usar incógnito.
  useEffect(() => {
    setUnauthorizedHandler(reauth);
    return () => setUnauthorizedHandler(null);
  }, [reauth]);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuth: !!token, checking, loginMethod }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
