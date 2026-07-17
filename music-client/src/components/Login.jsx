import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  // Solo login: el registro público está CERRADO (el backend rechaza /register con 403
  // salvo ALLOW_REGISTRATION=true, reservado para bootstrap). Los usuarios reales entran
  // por SSO (Cloudflare Access) o, en red local, con usuario/contraseña.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

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

function MusicIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  );
}
