import { useAuth } from '../context/AuthContext.jsx';

// Método de acceso legible + su etiqueta corta para el chip. 'sso' = Cloudflare
// Access + Google (auto-login); 'password' = login tradicional de red local. Si
// por algún motivo no hay método, no se rompe (cae a '—' / sin chip).
const METHOD_LABEL = {
  sso:      'Sesión por Google (Cloudflare Access)',
  password: 'Usuario y contraseña',
};
const METHOD_CHIP = {
  sso:      'SSO',
  password: 'Local',
};

// Vista de Ajustes ("panel de control"). Hoy solo Cuenta + cerrar sesión, pero
// armada en TARJETAS (.settings-card) para crecer sin refactor: cada sección
// futura (tema, movimiento reducido, "acerca de"/versión) entra como otra tarjeta.
// El cierre usa signOut (NO logout): ramifica por método — en SSO además termina
// la sesión de Cloudflare Access. Ver AuthContext.
export default function Settings() {
  const { user, loginMethod, signOut } = useAuth();

  return (
    <div className="settings">
      {/* Header con identidad: barrita de acento + subtítulo, reusando el
          vocabulario del header de Biblioteca (.lib-heading / .lib-accent). */}
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title">Ajustes</h1>
            <p className="settings-subtitle">Cuenta y sesión</p>
          </div>
        </div>
      </div>

      <section className="settings-section">
        <h2 className="settings-section-title">Cuenta</h2>
        <dl className="settings-card">
          <div className="settings-row">
            <dt>Usuario</dt>
            <dd>{user?.username ?? '—'}</dd>
          </div>
          <div className="settings-row">
            <dt>Método de acceso</dt>
            <dd className="settings-method">
              <span>{METHOD_LABEL[loginMethod] ?? '—'}</span>
              {METHOD_CHIP[loginMethod] && (
                <span className="settings-chip">{METHOD_CHIP[loginMethod]}</span>
              )}
            </dd>
          </div>
        </dl>

        <button className="settings-logout" onClick={signOut}>
          <LogoutIcon />
          Cerrar sesión
        </button>

        {loginMethod === 'sso' && (
          <p className="settings-note">
            <span className="settings-note-dot" aria-hidden="true" />
            Si tu sesión de Google sigue activa, podrías volver a entrar automáticamente.
          </p>
        )}
      </section>

      {/* Hueco extensible: la próxima sección (Tema, Movimiento reducido,
          "Acerca de"/versión) entra como otra <section className="settings-section">
          con su <h2 className="settings-section-title"> + <dl className="settings-card">,
          sin tocar nada de lo de arriba. */}
    </div>
  );
}

// Ícono de "salida" (puerta con flecha) para el botón de cerrar sesión. Line SVG,
// mismo estilo (stroke currentColor, width 2, round) que el resto de los íconos.
function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
