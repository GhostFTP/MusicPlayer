import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

export default function Login() {
  const { login, choice, paused, chooseGoogle, choosePassword, forgetChoice, authError } = useAuth();
  // Solo login: no hay registro público y la ruta ya ni existe (ver api/auth.js). Las
  // cuentas las crea un administrador, por /api/admin/users o por el CLI. Los usuarios
  // reales entran por SSO (Cloudflare Access) o con usuario/contraseña.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  // ¿Hay Google (Cloudflare Access) delante? null = todavía no se sabe. En localhost / red
  // local viene { sso:false }. Degradación segura: si /config falla o no responde (el cliente
  // corta a los 10 s), queda en false → solo el form, sin /cf: nunca se rompe el login por no
  // poder decidir un botón.
  const [sso, setSso] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.authConfig()
      .then(d => { if (!cancelled) setSso(!!d?.sso); })
      .catch(() => { if (!cancelled) setSso(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Navega a /sso (AuthContext): el error, si lo hay, vuelve por `authError` del contexto.
  function handleGoogle() {
    setError('');
    chooseGoogle();
  }
  const shownError = error || authError;

  // Qué se muestra (1.37.0, elección Google / usuario):
  //   sso pendiente           → solo la cabecera de la tarjeta (sin spinner ni form que luego salte)
  //   sin Google delante      → el form, como siempre; no se guarda ninguna elección
  //   Google, sin elección    → las dos opciones
  //   Google, elección google → «Continuar con Google» (salió a propósito o CF falló) + otra cuenta
  //   Google, elección password → el form + otra cuenta
  const mode = sso === null ? 'pending'
    : !sso ? 'form'
    : choice === 'google' ? 'google'
    : choice === 'password' ? 'password'
    : 'choose';

  const subtitle = {
    pending:  'Inicia sesión para escuchar tu biblioteca',
    form:     'Inicia sesión para escuchar tu biblioteca',
    choose:   '¿Cómo quieres entrar?',
    google:   paused ? 'Cerraste sesión. Vuelve a entrar cuando quieras.' : 'Entra con tu cuenta de Google',
    password: 'Entra con tu usuario y contraseña',
  }[mode];

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img
            src="/icons/logo-56.v4.png"
            srcSet="/icons/logo-56.v4.png 1x, /icons/logo-112.v4.png 2x"
            width="56" height="56" alt="" decoding="async" draggable={false}
          />
          SonoraRev
        </div>

        <h2 className="login-title">Bienvenido</h2>
        <p className="login-sub">{subtitle}</p>

        {shownError && <div className="login-error">{shownError}</div>}

        {(mode === 'choose' || mode === 'google') && (
          // Vía PRINCIPAL del equipo. Navega a /sso, que pasa por Cloudflare Access (chooseGoogle).
          <button type="button" className="login-google" onClick={handleGoogle}>
            <GoogleIcon />
            {mode === 'google' ? 'Continuar con Google' : 'Entrar con Google'}
          </button>
        )}

        {mode === 'choose' && (
          <button type="button" className="login-option" onClick={() => { setError(''); choosePassword(); }}>
            Entrar con usuario y contraseña
          </button>
        )}

        {(mode === 'form' || mode === 'password') && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Usuario</label>
              <input
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="ghost" autoFocus required
              />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
              />
            </div>
            <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Cargando…' : 'Entrar'}
            </button>
          </form>
        )}

        {(mode === 'google' || mode === 'password') && (
          <button type="button" className="login-switch" onClick={() => { setError(''); forgetChoice(); }}>
            Entrar con otra cuenta
          </button>
        )}
      </div>
    </div>
  );
}

// Ícono "G" oficial de Google (4 colores de marca). Excepción deliberada al set de tokens:
// es el mark de "Sign in with Google", por reconocibilidad de la vía principal del equipo.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
