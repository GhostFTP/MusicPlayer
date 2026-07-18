import { useAuth } from '../context/AuthContext.jsx';

// Método de acceso legible. 'sso' = Cloudflare Access + Google (auto-login); 'password'
// = login tradicional de red local. Si por algún motivo no hay método, no se rompe.
const METHOD_LABEL = {
  sso:      'Sesión por Google (Cloudflare Access)',
  password: 'Usuario y contraseña',
};

// Vista de Ajustes. Por ahora es solo Cuenta + cerrar sesión, pero está armada en
// secciones para crecer (tema, movimiento reducido, "acerca de"/versión) sin refactor.
// El cierre de sesión usa signOut (NO logout): ramifica por método — en SSO además
// termina la sesión de Cloudflare Access. Ver AuthContext.
export default function Settings() {
  const { user, loginMethod, signOut } = useAuth();

  return (
    <div className="settings">
      <div className="section-header">
        <h1 className="section-title">Ajustes</h1>
      </div>

      <section className="settings-section">
        <h2 className="settings-section-title">Cuenta</h2>
        <dl className="settings-grid">
          <div className="settings-row">
            <dt>Usuario</dt>
            <dd>{user?.username ?? '—'}</dd>
          </div>
          <div className="settings-row">
            <dt>Método de acceso</dt>
            <dd>{METHOD_LABEL[loginMethod] ?? '—'}</dd>
          </div>
        </dl>

        <button className="btn-logout settings-logout" onClick={signOut}>
          Cerrar sesión
        </button>
        {loginMethod === 'sso' && (
          <p className="settings-note">
            Si tu sesión de Google sigue activa, podrías volver a entrar automáticamente.
          </p>
        )}
      </section>
    </div>
  );
}
