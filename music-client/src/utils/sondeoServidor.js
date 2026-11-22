// EL SONDEO del estado del servidor en Ajustes (sub-paso 3b), PURO y sin imports: el reloj, los
// timers y el documento se inyectan. EstadoServidor.jsx lo arranca al montar y lo detiene al
// desmontar; servidor-unit.mjs lo prueba en Node con un reloj y un documento falsos.
//
// Por qué vive afuera del componente: un 401 en la app termina en logout() (AuthContext) y Ajustes
// se desmonta, así que en el navegador «el 401 corta el sondeo» no se puede observar — el
// desmontaje lo tapa. Acá la regla se prueba sola, sin depender de lo que haga la sesión.
//
// REGLAS
//   · Un pedido al arrancar y después una CADENA de timers de `cadaMs` (no un setInterval): el
//     próximo se agenda cuando termina el anterior, así nunca hay dos lecturas en vuelo.
//   · Con la pestaña oculta (documento.visibilityState === 'hidden') no se agenda nada y el timer
//     pendiente se cancela. Al volver a verse: si pasaron más de `cadaMs` desde la última
//     respuesta, pide en el acto; si no, agenda lo que falta.
//   · La respuesta pasa por `validar`; si no cuadra, o si `leer` lanza, `clasificar` dice qué
//     clave de fallo es. 'sesion' (401) CORTA el sondeo para siempre.
//   · detener(): cancela el timer, quita el listener y ninguna respuesta posterior llama a nadie.

export const CADA_MS = 30_000;

export function crearSondeo({
  leer, validar, clasificar, alDato, alFallo, documento,
  cadaMs = CADA_MS,
  ahora = () => Date.now(),
  programar = (fn, ms) => setTimeout(fn, ms),
  cancelar = (t) => clearTimeout(t),
}) {
  let timer = null;
  let enVuelo = false;
  let cortado = false;
  let vivo = true;
  let ultimaRespuesta = -Infinity;   // ninguna todavía: al volver a verse, pide en el acto

  const oculto = () => documento?.visibilityState === 'hidden';
  const quitarTimer = () => { if (timer !== null) { cancelar(timer); timer = null; } };

  function agendar(ms = cadaMs) {
    quitarTimer();
    if (!vivo || cortado || oculto()) return;
    timer = programar(() => { timer = null; pedir(); }, ms);
  }

  async function pedir() {
    if (enVuelo || cortado) return;
    enVuelo = true;
    let dato = null;
    let clave = null;
    try {
      dato = validar(await leer());
      if (!dato) clave = clasificar(null);
    } catch (e) {
      clave = clasificar(e);
    }
    enVuelo = false;
    ultimaRespuesta = ahora();
    if (!vivo) return;   // se desmontó mientras esperaba: nadie se entera
    if (dato) {
      alDato(dato, ultimaRespuesta);
    } else {
      if (clave === 'sesion') cortado = true;
      alFallo(clave);
    }
    agendar();
  }

  function alCambiarVisibilidad() {
    if (oculto()) { quitarTimer(); return; }
    if (enVuelo) return;   // cuando termine, agenda él
    const pasado = ahora() - ultimaRespuesta;
    if (pasado > cadaMs) pedir();
    else agendar(cadaMs - pasado);
  }

  documento?.addEventListener?.('visibilitychange', alCambiarVisibilidad);
  pedir();

  return {
    detener() {
      vivo = false;
      quitarTimer();
      documento?.removeEventListener?.('visibilitychange', alCambiarVisibilidad);
    },
    /** Solo para las pruebas. */
    estado: () => ({ enVuelo, cortado, timer: timer !== null, vivo }),
  };
}
