import { createRemoteJWKSet, jwtVerify } from 'jose';

// Configuración inyectada desde Dokploy. Si falta cualquiera de las dos, el
// auto-login por Cloudflare Access queda DESACTIVADO (fail-safe): verifyCfAccess
// devuelve null y la app solo acepta el login tradicional por contraseña.
const TEAM_DOMAIN = (process.env.CF_ACCESS_TEAM_DOMAIN ?? '').replace(/\/+$/, '');
const AUD         = process.env.CF_ACCESS_AUD ?? '';
const ENABLED     = Boolean(TEAM_DOMAIN && AUD);

// JWKS de Cloudflare: las llaves públicas con las que firma el JWT que mete en
// la cabecera Cf-Access-Jwt-Assertion. createRemoteJWKSet cachea las llaves y
// solo las vuelve a pedir cuando aparece un `kid` desconocido.
const JWKS = ENABLED
  ? createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`))
  : null;

if (!ENABLED) {
  console.warn('[cf-access] CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD sin definir: auto-login por Cloudflare Access DESACTIVADO (solo login por contraseña).');
}

/**
 * Valida la identidad que Cloudflare Access inyecta en la petición.
 *
 * Verifica la FIRMA del JWT (Cf-Access-Jwt-Assertion) contra las llaves públicas
 * de Cloudflare, además del emisor (iss) y la audiencia (aud) de la aplicación.
 * Así nadie puede falsificar la identidad mandando solo la cabecera del email:
 * únicamente Cloudflare puede firmar un JWT válido. Esto importa porque el
 * contenedor es alcanzable directo por la red local (sin pasar por Cloudflare).
 *
 * El email se toma del propio JWT (fuente de verdad), no de la cabecera de texto.
 *
 * @returns {Promise<{ email: string } | null>} email verificado, o null si no
 *          hay identidad CF válida (la petición cae al login tradicional).
 */
export async function verifyCfAccess(req) {
  if (!ENABLED) return null;

  const token = req.headers['cf-access-jwt-assertion'];
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer:   TEAM_DOMAIN,
      audience: AUD,
    });

    const email = payload.email;
    if (typeof email !== 'string' || !email) return null;
    return { email: email.toLowerCase() };
  } catch {
    // Firma inválida, token expirado o aud/iss incorrectos → sin identidad.
    return null;
  }
}

export const cfAccessEnabled = ENABLED;
