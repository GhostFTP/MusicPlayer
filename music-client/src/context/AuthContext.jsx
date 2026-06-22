import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(atob(localStorage.getItem('token')?.split('.')[1] ?? 'e30=')); }
    catch { return null; }
  });

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    localStorage.setItem('token', data.token);
    setToken(data.token);
    try { setUser(JSON.parse(atob(data.token.split('.')[1]))); } catch { /* ok */ }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuth: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
