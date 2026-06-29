import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

// Decodifica el payload del JWT (parte central) para sacar { id, username }.
function decodeUser(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser]   = useState(() => {
    const t = localStorage.getItem('token');
    return t ? decodeUser(t) : null;
  });
  // Mientras comprobamos si Cloudflare Access ya nos identifica no mostramos el
  // formulario de login (evita el parpadeo). Solo comprobamos si aún no hay token.
  const [checking, setChecking] = useState(() => !localStorage.getItem('token'));
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

  // Auto-login vía Cloudflare Access al cargar: si ya hay token, nada que hacer;
  // si no, intentamos canjear la identidad CF por un token de la app. Si falla
  // (red local sin Cloudflare), caemos al formulario de login tradicional.
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    api.cfLogin()
      .then(data => { if (!cancelled && data?.token) applyToken(data.token, 'sso'); })
      .catch(() => { /* sin identidad CF → login por contraseña */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuth: !!token, checking, loginMethod }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
