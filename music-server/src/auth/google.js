import { OAuth2Client } from 'google-auth-library';

// Login con Google DESDE LA APP DEL TELÉFONO. La app obtiene un ID token de Google con
// su cliente OAuth de iOS y lo manda a POST /api/auth/google; esto es lo que decide si
// ese token es de verdad de Google y para nosotros.
//
// No es el login por Google de la web: ése pasa por Cloudflare Access (auth/cloudflare.js)
// y llega acá ya verificado. El teléfono no pasa por esa pantalla de Access —entra con el
// service token—, así que la identidad tiene que traerla él y verificarla este servidor.

// El ID del cliente OAuth de iOS, de Google Cloud Console. Es la AUDIENCIA que tiene que
// traer el token: sin comprobarla, un token que Google emitió para CUALQUIER otra app
// serviría para entrar acá. No es un secreto (viaja dentro de la app), pero sí es la
// única línea que dice "este token es para SonoraRev".
const CLIENT_ID = (process.env.GOOGLE_IOS_CLIENT_ID ?? '').trim();
export const googleEnabled = Boolean(CLIENT_ID);

// EL VERIFICADOR FALSO, para las pruebas locales: acepta `fake:<correo>` (verificado) o
// `fake:<correo>:unverified`, sin hablar con Google. Existe porque un token real no se
// puede fabricar sin una cuenta de Google y un teléfono.
//
// ⚠️ EN PRODUCCIÓN NO ARRANCA, y es un throw al cargar el módulo y no un warning: con el
// falso prendido, cualquiera entra como cualquiera escribiendo su correo. Un servidor que
// se niega a levantar se ve en el deploy; uno que levanta con esto prendido no se ve nunca.
const FAKE = process.env.GOOGLE_FAKE === '1';
if (FAKE && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[google] GOOGLE_FAKE=1 con NODE_ENV=production: el verificador falso deja entrar a '
    + 'cualquiera con solo escribir un correo. El servidor no arranca así.',
  );
}

if (!googleEnabled) {
  console.warn('[google] GOOGLE_IOS_CLIENT_ID sin definir: el login con Google DESACTIVADO (POST /api/auth/google responde 503).');
}
if (FAKE) {
  console.warn('[google] GOOGLE_FAKE=1: verificador FALSO de Google. Solo para pruebas locales.');
}

// Un cliente para todo el proceso: cachea las llaves públicas de Google y solo las vuelve
// a pedir cuando vencen. Se crea al primer uso, así un servidor con Google apagado no lo
// construye nunca.
let cliente = null;

async function verificarDeVerdad(idToken) {
  cliente ??= new OAuth2Client();
  // verifyIdToken comprueba la FIRMA contra las llaves de Google, el emisor
  // (accounts.google.com), el vencimiento y que `aud` sea nuestro cliente. Si algo no
  // cierra, lanza.
  const ticket = await cliente.verifyIdToken({ idToken, audience: CLIENT_ID });
  const p = ticket.getPayload() ?? {};
  return { email: p.email, email_verified: p.email_verified };
}

function verificarFalso(idToken) {
  const m = /^fake:([^:\s]+)(?::(unverified))?$/.exec(String(idToken));
  if (!m) throw new Error('token falso mal formado');
  return { email: m[1], email_verified: !m[2] };
}

/** `verifyGoogle(idToken)` → `{ email, email_verified }`, o lanza si el token no sirve.
 *  Es lo que el router recibe INYECTADO (ver crearLoginGoogle en api/auth.js). */
export const verifyGoogle = FAKE ? verificarFalso : verificarDeVerdad;
