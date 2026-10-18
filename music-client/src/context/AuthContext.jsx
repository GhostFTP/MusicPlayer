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

// Entrar con Google NAVEGANDO a /sso (1.38.0). Cloudflare Access puede proteger todo el sitio o
// sólo /sso y /api/auth/cf: en el segundo caso un fetch a /cf sin sesión de Access no puede pasar
// la barrera (redirige a Google, otro origen), pero una NAVEGACIÓN sí. /sso es index.html (el
// fallback de SPA del servidor); al cargarlo se canjea /cf y se vuelve a donde estaba el usuario.
// Las dos claves viven en sessionStorage (por pestaña, mueren al cerrarla):
//   ssoReturn = la ruta a restaurar al volver de /sso.
//   ssoFailed = '1' → /sso ya volvió sin token en esta pestaña: nada vuelve a navegar SOLO a /sso
//               (anti-bucle) hasta que el usuario toque el botón o entre bien.
const SSO_PATH   = '/sso';
const RETURN_KEY = 'ssoReturn';
const FAILED_KEY = 'ssoFailed';
const GOOGLE_ERROR = 'No se pudo entrar con Google. Prueba de nuevo o entra con otra cuenta.';

// sessionStorage puede tirar (modo privado estricto): sin él sólo se pierde el anti-bucle y el
// retorno, nunca el login.
const ss = {
  get: (k)    => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ver arriba */ } },
  del: (k)    => { try { sessionStorage.removeItem(k); } catch { /* ver arriba */ } },
};

const onSso = () => window.location.pathname === SSO_PATH;

// Sólo rutas propias: empieza por "/" (no "//", que sería otro host) y no es /sso.
function safeReturn(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return '/';
  try { return new URL(p, window.location.origin).pathname === SSO_PATH ? '/' : p; }
  catch { return '/'; }
}

// Va a /sso recordando dónde estaba. Recarga la página (y corta la música): sólo se llama por el
// botón o cuando Access pidió pasar por la barrera.
function goToSso() {
  if (!onSso()) ss.set(RETURN_KEY, window.location.pathname + window.location.search + window.location.hash);
  window.location.assign(SSO_PATH);
}

// Sale de /sso a la ruta guardada (o "/") SIN recargar. Tiene que correr ANTES de que monte
// Layout: Layout lee la URL al montar y canonizaría /sso a "/", perdiendo la ruta.
function leaveSso() {
  const ret = safeReturn(ss.get(RETURN_KEY));
  ss.del(RETURN_KEY);
  window.history.replaceState(null, '', ret);
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

// Llegar a /sso sin nada que canjear (ya hay token, o la elección no es 'google' — p.ej. alguien
// con 'password' que escribe /sso a mano): se sale en el acto, sin tocar /cf. Corre al importar,
// antes del primer render. El único caso que se queda en /sso es el que va a llamar a /cf.
if (onSso() && (getStoredToken() || readChoice() !== 'google')) leaveSso();

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
  // En /sso siempre se llama a /cf (los demás casos ya salieron de /sso, ver leaveSso arriba).
  const [checking, setChecking] = useState(
    () => !getStoredToken() && (onSso() || wantsCf(readChoice(), localStorage.getItem(PAUSED_KEY) === '1')),
  );
  // Error del login con Google. Vive acá y no en Login: mientras `checking` App no pinta el Login
  // (se desmonta), así que un error guardado en su estado local se perdía y nunca se veía.
  const [authError, setAuthError] = useState(null);
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
    setAuthError(null);
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
  //
  // Cómo se lee un fallo de /cf (1.38.0):
  //   gate (Access redirigió a su login) → con `gate: true` y sin ssoFailed, se NAVEGA a /sso para
  //       pasar la barrera. Si no, se queda en el Login con mensaje y el botón.
  //   401 del servidor ("sin identidad", p.ej. local sin Cloudflare) → Login sin mensaje, como antes.
  //   409 (conflicto de cuenta) → el mensaje del servidor. Resto (timeout, red) → mensaje genérico.
  // `fromSso` = esta llamada es la de /sso: al terminar se sale de /sso (bien o mal) y, si falló,
  // se marca ssoFailed. Desde /sso jamás se vuelve a navegar a /sso.
  const reauthInFlight = useRef(null);
  const reauth = useCallback(({ gate = false, fromSso = false } = {}) => {
    if (reauthInFlight.current) return reauthInFlight.current;
    const promise = (async () => {
      setChecking(true);
      setAuthError(null);
      logout();
      let navigating = false;
      const fail = (message) => {
        if (fromSso) { ss.set(FAILED_KEY, '1'); leaveSso(); }
        setAuthError(message);
        return false;
      };
      try {
        const data = await api.cfLogin();
        if (!data?.token) return fail(GOOGLE_ERROR);
        ss.del(FAILED_KEY);
        if (fromSso) {
          leaveSso();
          localStorage.removeItem(PAUSED_KEY);
          setPaused(false);
        }
        applyToken(data.token, 'sso');
        return true;
      } catch (err) {
        if (err?.gate && gate && !fromSso && !ss.get(FAILED_KEY)) {
          navigating = true;   // checking sigue en true: nada de Login asomándose antes de irse
          goToSso();
          return false;
        }
        if (err?.status === 409) return fail(err.message);
        if (err?.status === 401 && !fromSso) return fail(null);
        return fail(GOOGLE_ERROR);
      } finally {
        if (!navigating) setChecking(false);
        reauthInFlight.current = null;
      }
    })();
    reauthInFlight.current = promise;
    return promise;
  }, [logout, applyToken]);

  // El auto-login (montaje y 401): puede navegar a /sso si Access lo pide.
  const reauthOrGate = useCallback(() => reauth({ gate: true }), [reauth]);

  // Elegir en el Login. Google guarda la elección, levanta la pausa y el anti-bucle (es un clic,
  // no un reintento solo) y navega a /sso, que funciona igual con Access en todo el sitio o sólo
  // en /sso y /api/auth/cf.
  const chooseGoogle = useCallback(() => {
    localStorage.setItem(CHOICE_KEY, 'google');
    localStorage.removeItem(PAUSED_KEY);
    ss.del(FAILED_KEY);
    setChoice('google');
    setPaused(false);
    setAuthError(null);
    goToSso();
  }, []);

  const choosePassword = useCallback(() => {
    localStorage.setItem(CHOICE_KEY, 'password');
    setChoice('password');
    setAuthError(null);
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
    setAuthError(null);
    logout();
    if (wasGoogle) window.location.href = '/cdn-cgi/access/logout';
  }, [choice, logout]);

  // En /sso: canjear /cf (sólo se llega acá con elección 'google' y sin token, ver leaveSso).
  // Fuera de /sso: el auto-login de siempre, que ahora puede pasar por /sso si Access lo pide.
  useEffect(() => {
    if (token) return;
    if (onSso()) reauth({ fromSso: true });
    else if (wantsCf(choice, paused)) reauthOrGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Red de seguridad: un JWT puede vencer a mitad de sesión (la pestaña queda
  // abierta más que el TTL). Con la elección 'google', cualquier fetch que reciba
  // un 401 reintenta /cf acá mismo, sin recargar; sólo si Access pide pasar por su
  // barrera (y no falló ya en esta pestaña) navega a /sso. Con 'password' (o sin
  // elección) NUNCA se va a /cf ni a /sso: se limpia la sesión y aparece el Login —
  // si no, quien entró con contraseña terminaba convertido en su cuenta de Google.
  useEffect(() => {
    setUnauthorizedHandler(choice === 'google' ? reauthOrGate : logout);
    return () => setUnauthorizedHandler(null);
  }, [choice, reauthOrGate, logout]);

  return (
    <AuthContext.Provider value={{
      token, user, login, logout, signOut, isAuth: !!token, checking, loginMethod,
      choice, paused, chooseGoogle, choosePassword, forgetChoice, authError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
