// INICIAR UNA RADIO ELIGIENDO QUÉ SUENA (1.46.0, R1). Lo que se decide sin tocar nada: qué fuentes se ofrecen,
// cuál va por defecto, si la elegida reemplaza tu cola, con qué opciones suena y los textos. PURO: sin React, sin
// red, sin el motor. Lo usa components/RadioInicio.jsx.
//
// El orden es el de la app del iPhone (sonorarev-ios lib/radio/elegir.ts): PRIMERO suena, DESPUÉS se crea la radio.
// Así lo primero que el anfitrión publica es lo elegido, y si la fuente viene vacía o falla, no se crea nada.

/** Las fuentes, en el orden en que se muestran. `elegir`: el rótulo del selector de las que piden un ítem. */
export const FUENTES = Object.freeze([
  Object.freeze({ id: 'actual', titulo: 'Lo que estoy escuchando' }),
  Object.freeze({ id: 'mix', titulo: 'Mix de toda la biblioteca', detalle: 'Todas tus canciones, revueltas' }),
  Object.freeze({ id: 'playlist', titulo: 'Una playlist', elegir: 'Elige una playlist' }),
  Object.freeze({ id: 'album', titulo: 'Un álbum', elegir: 'Elige un álbum' }),
  Object.freeze({ id: 'genero', titulo: 'Un género', elegir: 'Elige un género' }),
  Object.freeze({ id: 'anio', titulo: 'Un año', elegir: 'Elige un año' }),
]);
const CON_ITEM = new Set(['playlist', 'album', 'genero', 'anio']);

/** «Lo que estoy escuchando» solo si algo suena; las demás, siempre. */
export const fuentesDisponibles = (hayCancion) => FUENTES.filter((f) => f.id !== 'actual' || hayCancion === true);
/** Con algo sonando, por defecto se sigue con eso; si no, el Mix. */
export const fuentePorDefecto = (hayCancion) => (hayCancion === true ? 'actual' : 'mix');
/** ¿La fuente pide elegir un ítem (una playlist, un álbum, un género, un año)? */
export const pideItem = (id) => CON_ITEM.has(id);
/** ¿Elegir esta fuente reemplaza lo que suena y tu cola? Solo si había algo y no es «lo que estoy escuchando». */
export const reemplazaCola = ({ fuente, hayCancion }) => hayCancion === true && fuente !== 'actual';
/** Cómo suena: el Mix revuelve toda la lista (como el botón Mix); lo demás, en su orden (como «▶ Reproducir»). */
export const opcionesDePlay = (id) => (id === 'mix' ? { mezclar: true } : { enOrden: true });
/** Solo canciones de la biblioteca: un video no puede sonar en la radio (se publica como pausa por video). */
export const soloCanciones = (lista) => (Array.isArray(lista) ? lista : [])
  .filter((t) => t && typeof t === 'object' && t.kind !== 'video' && Number.isSafeInteger(t.id) && t.id > 0);

export const TEXTO_REEMPLAZA = 'Esto reemplaza lo que estás escuchando y tu cola. Al terminar la radio no vuelve.';
export const TEXTO_FALLO_CARGA = 'No se pudieron cargar las canciones, así que no se creó la radio. Intenta de nuevo.';
export const TEXTO_FALLO_LISTA = 'No se pudo cargar la lista.';
/** Lo elegido ya suena pero la radio no se pudo crear (el servidor dijo que no, o no respondió). */
export const TEXTO_FALLO_INICIAR = 'No se pudo iniciar la radio. Lo que elegiste sigue sonando solo para ti.';
const VACIA = {
  mix: 'Tu biblioteca no tiene canciones',
  playlist: 'Esa playlist no tiene canciones',
  album: 'Ese álbum no tiene canciones',
  genero: 'Ese género no tiene canciones',
  anio: 'Ese año no tiene canciones',
};
/** Por qué no se creó la radio cuando la fuente vino vacía. */
export const textoDeVacia = (id) => `${VACIA[id] ?? 'No hay canciones para empezar'}, así que no se creó la radio.`;
