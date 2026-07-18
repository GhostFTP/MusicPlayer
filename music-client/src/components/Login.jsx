import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

export default function Login() {
  const { login } = useAuth();
  // Solo login: el registro público está CERRADO (el backend rechaza /register con 403
  // salvo ALLOW_REGISTRATION=true, reservado para bootstrap). Los usuarios reales entran
  // por SSO (Cloudflare Access) o, en red local, con usuario/contraseña.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  // ¿Mostrar "Iniciar sesión con Google"? Solo si el backend dice que el auto-login por
  // Cloudflare Access está disponible (o sea, estamos detrás de CF). En localhost / acceso
  // directo de red local viene { sso:false }. Degradación segura: si /config no responde,
  // queda en false → solo el form (nunca se rompe el login por no poder decidir un botón).
  const [sso, setSso] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.authConfig()
      .then(d => { if (!cancelled) setSso(!!d?.sso); })
      .catch(() => { /* sin config → sin botón Google, solo el form */ });
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

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <MusicIcon size={28} />
          SonoraRev
        </div>

        <h2 className="login-title">Bienvenido</h2>
        <p className="login-sub">Inicia sesión para escuchar tu biblioteca</p>

        {sso && (
          <>
            {/* Vía PRINCIPAL del equipo (todos SSO). Full-page a '/': como ya estamos detrás
                de CF Access, la navegación pasa por Cloudflare y re-dispara el login de Google. */}
            <button type="button" className="login-google" onClick={() => { window.location.href = '/'; }}>
              <GoogleIcon />
              Iniciar sesión con Google
            </button>
            <div className="login-or">o</div>
          </>
        )}

        {error && <div className="login-error">{error}</div>}

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

function MusicIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  );
}
