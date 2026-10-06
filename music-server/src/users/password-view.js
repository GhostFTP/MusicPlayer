// LA CONTRASEÑA VISIBLE PARA UN ADMIN (1.23.0): una COPIA CIFRADA de la contraseña, al lado
// del hash, para que un admin pueda volver a ver la que le puso a alguien de la familia.
//
// ⚠️ ES UNA DECISIÓN CONSCIENTE CONTRA LA REGLA DE SIEMPRE ("las contraseñas no se guardan,
// solo su hash"), tomada por Oscar para un servidor de ~12 personas que él administra. Lo que
// la hace aceptable, y no hay que aflojar ninguna de las tres:
//   · LA LLAVE NO VIVE CON LA BASE. Sale de PASSWORD_VIEW_KEY, que está SOLO en Dokploy:
//     quien se lleve music.db (un backup, el volumen) se lleva texto cifrado y nada más.
//   · EL id DE LA CUENTA VA COMO DATO AUTENTICADO (AAD). Copiar el valor de una fila a otra
//     no sirve: descifrarlo con otro id falla. Así nadie con acceso a la base puede "mover"
//     una contraseña conocida a la cuenta de otro para leerla por la API.
//   · NADA DE ESTO BLOQUEA NADA. Sin llave, con una llave rota o con cualquier falla, cifrar
//     devuelve null y la columna queda NULL: la contraseña se cambia igual. Una copia que no
//     se pudo hacer es una copia que no hay; una copia VIEJA sería peor (mostraría una
//     contraseña que ya no sirve), por eso quien llama escribe NULL y no deja lo anterior.
//
// FORMATO: "v1:<iv>:<tag>:<cifrado>", los tres en base64. AES-256-GCM con un IV de 12 bytes
// NUEVO en cada cifrado (repetir un IV con la misma llave en GCM rompe el cifrado entero) y el
// tag de 16 bytes, que es lo que hace que un valor alterado no se descifre en basura sino en
// null. "v1" es para poder cambiar de esquema sin adivinar qué hay guardado.
//
// SOLO crypto de Node, sin dependencias. Lo prueba scripts/test-password-view.mjs.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITMO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const LLAVE_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Lee la llave: base64 que decodifique a EXACTAMENTE 32 bytes. Si no, null y por qué —sin
 *  el valor—. `Buffer.from(…, 'base64')` es permisivo (ignora lo que no entiende), por eso la
 *  forma se mira antes. */
export function leerLlave(valor) {
  const s = typeof valor === 'string' ? valor.trim() : '';
  if (!s) return { llave: null, motivo: 'falta' };
  if (!BASE64.test(s) || s.length % 4 !== 0) return { llave: null, motivo: 'no es base64' };
  const llave = Buffer.from(s, 'base64');
  if (llave.length !== LLAVE_BYTES) return { llave: null, motivo: `decodifica a ${llave.length} bytes y no a ${LLAVE_BYTES}` };
  return { llave, motivo: null };
}

// Lo autenticado: el id de la cuenta, con un prefijo para que no sirva para otra cosa.
const aad = (userId) => Buffer.from(`sonorarev:password_view:${userId}`, 'utf8');
const idValido = (userId) => Number.isSafeInteger(Number(userId)) && Number(userId) > 0;

/** Un cifrador con la llave dada (base64). Exportado para las pruebas; el servidor usa el de
 *  abajo, armado con PASSWORD_VIEW_KEY. */
export function crearCifrador(valorLlave) {
  const { llave, motivo } = leerLlave(valorLlave);

  /** La contraseña cifrada para guardar en `password_view`, o null si no se puede. */
  function cifrar(userId, texto) {
    if (!llave || !idValido(userId) || typeof texto !== 'string') return null;
    try {
      const iv = randomBytes(IV_BYTES);
      const c = createCipheriv(ALGORITMO, llave, iv);
      c.setAAD(aad(Number(userId)));
      const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
      const tag = c.getAuthTag();
      return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** El texto, o null ante CUALQUIER falla: sin llave, otra llave, otro id, valor alterado o
   *  con otra forma. Nunca lanza. */
  function descifrar(userId, valor) {
    if (!llave || !idValido(userId) || typeof valor !== 'string') return null;
    const partes = valor.split(':');
    if (partes.length !== 4 || partes[0] !== VERSION) return null;
    try {
      const [, ivB64, tagB64, datosB64] = partes;
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
      const d = createDecipheriv(ALGORITMO, llave, iv, { authTagLength: TAG_BYTES });
      d.setAAD(aad(Number(userId)));
      d.setAuthTag(tag);
      // `final()` es el que verifica el tag: si algo no cuadra, lanza y sale null.
      return Buffer.concat([d.update(Buffer.from(datosB64, 'base64')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  return { disponible: llave !== null, motivo, cifrar, descifrar };
}

const porDefecto = crearCifrador(process.env.PASSWORD_VIEW_KEY);

// UN aviso al arrancar, sin el valor de la llave. El servidor arranca igual.
if (!porDefecto.disponible) {
  console.warn(
    `[usuarios] PASSWORD_VIEW_KEY ${porDefecto.motivo === 'falta' ? 'no está puesta' : `no sirve (${porDefecto.motivo})`}: `
    + 'las contraseñas nuevas no se guardan para verlas y "ver contraseña" contesta que no está disponible.',
  );
}

export const cifrarPassword = porDefecto.cifrar;
export const descifrarPassword = porDefecto.descifrar;
