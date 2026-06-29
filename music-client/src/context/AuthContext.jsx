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

  const applyToken = useCallback((newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(decodeUser(newToken));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    applyToken(data.token);
  }, [applyToken]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  // Auto-login vía Cloudflare Access al cargar: si ya hay token, nada que hacer;
  // si no, intentamos canjear la identidad CF por un token de la app. Si falla
  // (red local sin Cloudflare), caemos al formulario de login tradicional.
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    api.cfLogin()
      .then(data => { if (!cancelled && data?.token) applyToken(data.token); })
      .catch(() => { /* sin identidad CF → login por contraseña */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuth: !!token, checking }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
