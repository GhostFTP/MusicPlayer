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

// Elección de método en la pantalla de login (1.37.0). Detrás de Cloudflare Access SIEMPRE hay
// identidad de Google, así que auto-loguear por /api/auth/cf sin preguntar convertía a cualquiera
// en su cuenta de Google — también a quien entraba con usuario y contraseña. Ahora el usuario
// elige una vez y la elección se recuerda. Estas dos claves NO las borra logout(): sobreviven al
// cierre de sesión, que es justo cuando hacen falta.
//   loginChoice = 'google' | 'password' → sólo con 'google' se llama a /api/auth/cf (al montar y
//                 en un 401). Con 'password', nunca.
//   loginPaused = '1' → "salió a propósito" (cerrar sesión con Google): suprime el auto-login hasta
//                 que vuelva a tocar «Continuar con Google». Sin esto, cerrar sesión re-entraba solo.
const CHOICE_KEY = 'loginChoice';
const PAUSED_KEY = 'loginPaused';

function readChoice() {
  const c = localStorage.getItem(CHOICE_KEY);
  return c === 'google' || c === 'password' ? c : null;
}

// Migración de las sesiones de antes de 1.37.0: quien ya tenía `loginMethod` conserva su método
// como elección y no ve el selector. Corre al importar el módulo, ANTES de que getStoredToken()
// borre `loginMethod` por token vencido. Quien ya no tenía `loginMethod` (su token venció antes
// de este release y se limpió) no tiene de dónde inferirla: verá el selector una vez.
function migrateChoice() {
  if (readChoice()) return;
  const method = localStorage.getItem('loginMethod');
  if (method === 'sso')      localStorage.setItem(CHOICE_KEY, 'google');
  if (method === 'password') localStorage.setItem(CHOICE_KEY, 'password');
}
migrateChoice();

// ¿Toca intentar el auto-login por Cloudflare Access?
const wantsCf = (choice, paused) => choice === 'google' && !paused;

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
  const [choice, setChoice] = useState(readChoice);
  const [paused, setPaused] = useState(() => localStorage.getItem(PAUSED_KEY) === '1');
  // Mientras comprobamos si Cloudflare Access ya nos identifica no mostramos el
  // formulario de login (evita el parpadeo). Solo si de verdad vamos a llamar a /cf:
  // sin token Y con la elección 'google' sin pausa. En cualquier otro caso el Login
  // se pinta directo, sin pantalla en blanco.
  const [checking, setChecking] = useState(
    () => !getStoredToken() && wantsCf(readChoice(), localStorage.getItem(PAUSED_KEY) === '1'),
  );
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

  // Cierre de sesión iniciado por el USUARIO — distinto del logout() interno, que reauth()
  // usa para limpiar antes de re-loguear (por eso NO se le puede meter el redirect a
  // logout() sin romper el auto-login SSO). En password alcanza con limpiar el JWT. En SSO
  // hay que terminar ADEMÁS la sesión de Cloudflare Access: si no, reauth() (en el montaje
  // y en cada 401) vuelve a entrar. /cdn-cgi/access/logout es el endpoint del edge que corta
  // esa sesión. (La sesión de Google puede seguir viva y CF re-autenticar en silencio — eso
  // no lo controlamos; el texto de Ajustes se lo avisa al usuario.)
  // En SSO además se marca la pausa: al volver, la app NO re-entra sola aunque CF siga dejando
  // pasar; el Login ofrece «Continuar con Google» o «Entrar con otra cuenta».
  const signOut = useCallback(() => {
    logout();
    if (loginMethod === 'sso') {
      localStorage.setItem(PAUSED_KEY, '1');
      setPaused(true);
      window.location.href = '/cdn-cgi/access/logout';
    }
  }, [logout, loginMethod]);

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
        if (data?.token) { applyToken(data.token, 'sso'); return true; }
        return false;
      } catch {
        /* sin identidad CF → el Login lo ofrece de nuevo */
        return false;
      } finally {
        setChecking(false);
        reauthInFlight.current = null;
      }
    })();
    reauthInFlight.current = promise;
    return promise;
  }, [logout, applyToken]);

  // Elegir en el Login. Google guarda la elección, levanta la pausa y entra por CF en el lugar
  // (ya estamos detrás de Cloudflare: no hace falta recargar). Devuelve si entró.
  const chooseGoogle = useCallback(async () => {
    localStorage.setItem(CHOICE_KEY, 'google');
    localStorage.removeItem(PAUSED_KEY);
    setChoice('google');
    setPaused(false);
    return reauth();
  }, [reauth]);

  const choosePassword = useCallback(() => {
    localStorage.setItem(CHOICE_KEY, 'password');
    setChoice('password');
  }, []);

  // «Entrar con otra cuenta»: olvida la elección y vuelve a las dos opciones. Si era Google
  // corta también la sesión de Cloudflare Access, para poder elegir otra cuenta de Google en la
  // barrera (que igual puede re-autenticar en silencio si la sesión de Google sigue viva).
  const forgetChoice = useCallback(() => {
    const wasGoogle = choice === 'google';
    localStorage.removeItem(CHOICE_KEY);
    localStorage.removeItem(PAUSED_KEY);
    setChoice(null);
    setPaused(false);
    logout();
    if (wasGoogle) window.location.href = '/cdn-cgi/access/logout';
  }, [choice, logout]);

  useEffect(() => {
    if (!token && wantsCf(choice, paused)) reauth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Red de seguridad: un JWT puede vencer a mitad de sesión (la pestaña queda
  // abierta más que el TTL). Con la elección 'google', cualquier fetch que reciba
  // un 401 dispara reauth() acá mismo, sin recargar. Con 'password' (o sin
  // elección) NUNCA se va a /cf: se limpia la sesión y aparece el Login — si no,
  // quien entró con contraseña terminaba convertido en su cuenta de Google.
  useEffect(() => {
    setUnauthorizedHandler(choice === 'google' ? reauth : logout);
    return () => setUnauthorizedHandler(null);
  }, [choice, reauth, logout]);

  return (
    <AuthContext.Provider value={{
      token, user, login, logout, signOut, isAuth: !!token, checking, loginMethod,
      choice, paused, chooseGoogle, choosePassword, forgetChoice,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
