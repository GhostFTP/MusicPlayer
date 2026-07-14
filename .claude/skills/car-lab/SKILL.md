---
name: car-lab
description: Estándar del uso EN EL AUTO de SonoraRev. PREMISA — CarPlay/Android Auto NO renderizan web: la pantalla del carro es el "Now Playing" del sistema, alimentado por MediaSession (lo ÚNICO que se ve en el carro); el "Modo Auto" es para el TELÉFONO MONTADO en el tablero, no para la pantalla del carro. Contrato de MediaSession, reglas de seguridad vial, regímenes responsivos de teléfono y checklist QA. Úsala SIEMPRE antes de tocar o auditar cualquier cosa del auto (MediaSession en PlayerContext, capa Modo Auto, media queries de landscape/portrait).
---

# Car Lab — estándar del uso en el auto de SonoraRev

Fuente de verdad del frente "reproductor en el auto".

## PREMISA (hardware real del usuario — no re-litigar)

**Cuatro carros**, en orden de importancia. **No hay head unit Android aftermarket ni se
piensa comprar uno.**

| # | Carro | Sistema | Vía | Quién dibuja el "Now Playing" |
|---|---|---|---|---|
| **1** | **Mazda 3 2021** ← **PRIORITARIO** | Mazda Connect | **CarPlay / Android Auto** | **iOS / Google** (no Mazda) |
| **2** | **Maverick 2022** ← **PRIORITARIO** | SYNC 4 | **CarPlay / Android Auto** | **iOS / Google** (no Ford) |
| 3 | RAV4 2016 | — | Bluetooth AVRCP | **el estéreo del carro** |
| 4 | Kangoo 2007 | — | Bluetooth AVRCP | **el estéreo del carro** |

Consecuencias que definen TODO este frente:

- **CarPlay/Android Auto NO renderizan web.** La pantalla del carro solo muestra el
  **"Now Playing" del sistema, alimentado por MediaSession** — y lo mismo por
  **Bluetooth AVRCP** en los carros sin CarPlay. → **MediaSession es lo ÚNICO que se ve
  en la pantalla del carro, y aplica a los CUATRO carros** (CarPlay/AA en Mazda 3 y
  Maverick; AVRCP por Bluetooth en RAV4/Kangoo).
- **Los DOS carros prioritarios van por CarPlay/AA** → misma superficie, mismo código, y
  **el "Now Playing" ni siquiera lo dibuja el fabricante** (ver §Quién dibuja el "Now
  Playing"). **El frente A ya en producción los cubre a los dos: cero trabajo nuevo por el
  Mazda 3.**
- **El "Modo Auto" es para el TELÉFONO MONTADO en el tablero**, no para la pantalla del
  carro. Su hardware objetivo son **teléfonos** (portrait o landscape) — **NO head units ni
  DAPs**. Importa sobre todo en RAV4/Kangoo, donde el teléfono montado es la única
  pantalla que puedes mirar.

Gran parte de este sistema **está por construirse** — la skill es el **contrato a
construir**, no un mapa de código existente. Lo que ya existe lleva `archivo:línea`; lo
que falta va marcado **⚠️ A CONSTRUIR**. No cites de memoria: **verificá contra el código
real** antes de opinar o tocar.

## Los frentes (y su orden)

| # | Frente | Qué es | Prioridad |
|---|---|---|---|
| **A** | **MediaSession** | **lo ÚNICO que se ve en la pantalla del carro** (CarPlay/AA/BT "Now Playing"), en los **4 carros**. Metadata + carátula + controles del volante | **la más alta** — es la experiencia del carro. **✅ EN PRODUCCIÓN (v1.5.0)** |
| **C** | **Responsivo de teléfono** | portrait cómodo y **landscape corto** del teléfono montado (ya **NO** head units ni DAPs). Beneficia a toda la app | media |
| **B** | **Modo Auto** | layout de conducción para el **teléfono montado** (capa que suprime) | media |

**Orden de ejecución pactado: A → C → B.** A es aislado, se prueba con Bluetooth/CarPlay el
mismo día, **y es lo que más importa**; C es chico ahora (solo teléfono) y beneficia a todo;
B va encima.

**Dirección visual del Modo Auto: B "Ruta" fluida** (elegida). Un esqueleto que es **cómodo
en portrait** (teléfono vertical, sobra alto) y **colapsa a "Faro"** (minimalismo) en
**landscape corto** (teléfono horizontal, poco alto). La cara "Copiloto"/ultrawide **se
descarta**: no hay hardware ultrawide en scope. Ver §Frente B.

## Archivos del sistema (dónde vive / vivirá cada cosa)

| Archivo | Rol |
|---|---|
| `music-client/src/context/PlayerContext.jsx` | Dueño del `<audio>` (`new Audio()`, `getAudio()` ~:29) y de la reproducción. **⚠️ A CONSTRUIR aquí:** MediaSession (metadata + handlers + `setPositionState`), el estado `trackMeta` enriquecido, y la lectura de `token` (vía `useAuth()`) para re-emitir artwork. **Invariante: NO expone el `<audio>`** (se mantiene) |
| `music-client/src/utils/trackMeta.js` | **⚠️ A CONSTRUIR (nuevo):** helper puro `resolveTrackMeta(track)` que centraliza el fallback `api.track(id)` hoy disperso en Player.jsx |
| `music-client/src/components/Player.jsx` | Consume el contexto. **⚠️ A CONSTRUIR:** el toggle de Modo Auto; y adelgazar — borrar el estado `quality` (~:163-175) y los re-fetch de `goArtist`/`goAlbum` (~:610-632) a favor de `trackMeta` del contexto |
| `music-client/src/components/CarMode.jsx` | **⚠️ A CONSTRUIR (nuevo):** la capa Modo Auto (dirección B fluida). `fixed inset:0`, suprime el resto |
| `music-client/src/styles/main.css` | z-index canónico (`:root` ~:34), regímenes responsivos. **⚠️ A CONSTRUIR:** `--z-car`, las media queries de los **2 regímenes** (portrait / landscape), los estilos `.car-*` |
| `music-client/index.html` | `viewport-fit=cover` **ya está** (:5); manifest PWA linkeado (:10). `apple-mobile-web-app-status-bar-style=black` **opaco a propósito** (:14-18) |
| `music-server/src/api/tracks.js` | **BACKEND (no tocar sin OK):** `GET /:id/cover` (:76-80) hace `res.sendFile(cover_path)` → **sirve la carátula embebida original tal cual, sin resize** |

## Frente A — MediaSession (contrato) — EL QUE MÁS IMPORTA

**Vive en PlayerContext, NO en Player.jsx.** El contexto es el dueño del audio y del ciclo
de reproducción; MediaSession es una proyección de ese estado al SO. Es lo que pinta el Mazda 3
y la Maverick por CarPlay/AA y los otros dos por Bluetooth → **acá se invierte de más, no de
menos**.

**✅ Estado: EN PRODUCCIÓN desde v1.5.0** (`PlayerContext.jsx`, merge `6d0f14b`). Metadata +
artwork, `playbackState`, los 8 action handlers y `setPositionState`, todos con sus guards.
Verificado en el panel Media de Chrome; **falta la prueba física en los carros**.

### Cobertura por carro (los 4, sin trabajo nuevo)

**MediaSession es una API del navegador: la app no sabe —ni necesita saber— qué carro hay del
otro lado.** El teléfono proyecta la misma metadata a CarPlay, a Android Auto o a AVRCP según
cómo esté conectado. Por eso:

| Carro | Cómo lo cubre el frente A | ¿Trabajo nuevo? |
|---|---|---|
| **Mazda 3 2021** | CarPlay/AA ← el mismo código ya desplegado | **No** |
| **Maverick 2022** | CarPlay/AA ← el mismo código ya desplegado | **No** |
| RAV4 2016 | AVRCP recibe la misma metadata | **No** |
| Kangoo 2007 | AVRCP recibe la misma metadata | **No** |

**Sumar un carro con CarPlay/AA NO abre trabajo de implementación** — abre **una prueba física
más**. Si algún día un carro se ve mal, el sospechoso es el render del SO o del estéreo, **no**
el código: antes de tocar `PlayerContext`, comparar contra el lockscreen del teléfono (ver abajo).

### Quién dibuja el "Now Playing" (define qué es un bug y qué no)

**Dato clave, no re-litigar:** en **CarPlay lo dibuja iOS**, no Mazda ni Ford. En **Android Auto
lo dibuja Google**. El fabricante del carro **no controla el render** — solo hospeda la pantalla.
Consecuencias directas para el QA:

- **Mazda 3 y Maverick se van a ver casi idénticos.** Misma superficie de iOS/Google. Una
  diferencia entre los dos NO es un bug de la app.
- **La prueba del lockscreen del iPhone EQUIVALE a la prueba de CarPlay.** Si el lockscreen se ve
  bien, CarPlay se ve bien: es el mismo render con el mismo `MediaMetadata`. Esto abarata el QA —
  no hace falta el carro para saber si la metadata está sana, solo para confirmar el enlace.
- **Mazda/Ford SÍ controlan el render en Bluetooth AVRCP** (RAV4/Kangoo) → ver abajo.

### Expectativa realista en Bluetooth AVRCP (RAV4 / Kangoo)

**Acá el estéreo del carro sí decide qué pinta, y sus límites son del hardware, NO de la app.**
Anotado para **no perseguir bugs que no existen**:

- **Muchos estéreos NO muestran carátula por AVRCP.** Que el RAV4 o el Kangoo no muestren la
  portada es **lo esperable**, no un fallo de MediaSession. No "arreglar" nada por eso.
- **Truncan títulos largos.** Un título cortado en la pantalla del carro es un límite de
  caracteres del estéreo. La app manda el string completo; el corte pasa aguas abajo.
- **Lo que SÍ debe funcionar por AVRCP:** título/artista (aunque truncados) y los controles del
  volante (play/pausa, prev/next).
- **Regla de diagnóstico:** si el lockscreen del teléfono se ve bien y el estéreo no, **el
  problema es del estéreo**. La app ya hizo su parte.

### ⚠️ RIESGO ABIERTO — ¿el Mazda 3 del usuario trae CarPlay?

CarPlay es **estándar en los trims Select / Preferred / Premium** del Mazda 3 2021. El **trim BASE
(2.0) puede NO traerlo** — pero es **activable en agencia con una actualización de software**
(**no requiere hardware nuevo**), así que el peor caso es un trámite, no un carro fuera de scope.

**Pendiente del usuario (🔍 FÍSICA, 30 segundos):** conectar un iPhone por cable y ver si aparece
el ícono de CarPlay en la pantalla. Si aparece → riesgo cerrado. Si no → agencia.

**No bloquea nada:** aunque el trim base no lo tenga, el frente A ya está desplegado y el carro
seguiría cubierto por **Bluetooth AVRCP** mientras tanto (con la expectativa realista de arriba).

### Helper de metadata compartido

El contexto no garantiza `album`/`codec…` (faltan si la cola vino de
`/albums/:album/tracks`). Se centraliza el fallback en un util puro
(`music-client/src/utils/trackMeta.js`, ya construido):

```js
// `album_artist` NO entra en isComplete a propósito (Opción A): solo lo usa la navegación
// a artista (goArtist), que conserva su fallback lazy en Player.jsx. Meterlo acá obligaría
// a que TODA pista pase por api.track solo para alimentar un botón que casi nadie pulsa.
export function isComplete(t) {
  return !!(t && t.album && (t.codec || t.sample_rate || t.bitrate));
}
export async function resolveTrackMeta(track) {
  if (!track) return null;
  if (isComplete(track)) return track;            // completa → cero red
  try { return { ...track, ...(await api.track(track.id)) }; }
  catch { return track; }                          // nunca lanza → degrada
}
```

**Opción A (la implementada), explícita:** `trackMeta` cubre el **badge de calidad** y el
**`album` de MediaSession**. `goArtist`/`goAlbum` (Player.jsx ~:610-632) **conservan su propio
`api.track` lazy** para resolver `album_artist` en el momento del clic. Es una petición **solo
cuando el usuario navega**, no en cada cambio de pista.

- **PlayerContext es el único que lo llama**: resuelve `trackMeta` al cambiar `currentTrack`
  (con cancelación) y lo **expone en el value**.
- **Dedup obligatorio (evita el re-fetch eterno):** una pista que genuinamente no tiene
  `album` **nunca** pasa `isComplete()` → sin memo, re-pediría `api.track(id)` en CADA
  reproducción para recibir lo mismo. El contexto guarda un **memo `Map<id, resolved>`** en un
  `useRef`: antes de resolver, si `id` está en el memo → usa lo cacheado (**cero red**); si no →
  resuelve una vez y lo guarda. Acotado por las pistas distintas reproducidas en la sesión
  (≤ tamaño de la biblioteca, ~334) → **NO es un caché grande**. Se prefiere al `Set` de ids
  intentados porque **preserva el enriquecimiento en replays** (un `Set` devolvería el track
  crudo la segunda vez, perdiendo `codec/…`). Se limpia solo al recargar; si preocupa staleness
  tras un rescan, invalidar la entrada por `track.id`.
- **Player.jsx adelgaza**: borra su `quality` local y lee `trackMeta`. (Los re-fetch de
  `goArtist`/`goAlbum` se quedan — ver Opción A arriba.)
- MediaSession se alimenta de `trackMeta` (título/artista salen de `currentTrack`, que siempre
  los trae; `album` de `trackMeta`).
- **⚠️ DEUDA CONOCIDA — `trackMeta` pegado en una pista SIN specs.** El efecto que resuelve
  `trackMeta` solo hace `setTrackMeta(currentTrack)` sync **si la pista trae specs de audio**
  (`codec||sample_rate||bitrate`). Una pista **sin** specs no setea nada antes del `await` →
  durante el fetch, `trackMeta` **sigue siendo el de la pista ANTERIOR**. Heredado del estado
  `quality` viejo, donde el daño era solo "el badge queda pegado un instante"; ahora `trackMeta`
  también alimenta **genre/album/albumArtist/InfoPanel**, así que se quedarían pegados **esos
  también**. **Hoy NO pasa**: ninguna ruta de cola produce pistas sin specs. **Si algún día se
  agrega una que sí** (o el scanner deja filas sin `codec`), hay que **resetear a un estado
  neutro** antes del `await` en vez de dejar el valor previo. *(MediaSession ya está a salvo por
  su lado: su efecto solo usa `trackMeta` si `trackMeta.id === currentTrack.id`.)*

### Metadata + artwork

`navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork })`.

- **Artwork:** `coverUrl(trackId)` (`client.js:80`) → `/api/tracks/{id}/cover?token=…`.
  URL **relativa** (el navegador la resuelve) con **token en query param**. El endpoint sirve
  la **carátula embebida original sin resize** (`tracks.js:76-80`) → para FLAC suele ser
  **grande (≥500-1000px)**, así que **CarPlay ya recibe una imagen grande y nítida hoy**.
  Declarar varios `sizes` (`96/256/512`) apuntando a esa MISMA imagen (el SO elige y escala) es
  buena higiene, pero **no compra calidad extra**.
- **⚠️ DEUDA (sigue siendo deuda):** un endpoint multi-tamaño real **no vale la pena** con esta
  premisa — la razón que lo justificaría (CarPlay pinta grande) **ya está cubierta** por servir
  el original. Único riesgo real: un álbum con arte **enorme** (varios MB) encarece la latencia
  de refresco del "Now Playing" por cambio de pista. Si eso aparece, la mejora barata es **un
  solo cap de dimensión** (servir ≤~1024px), NO un pipeline de 3 tamaños — y aun así es backend,
  requiere OK.
- **Riesgo del token (rotación):** un 401 dispara `reauth()` (AuthContext:78-95): `logout()`
  (token=`null` un instante) → `cfLogin()` → `applyToken(tokenNuevo)`. El token nuevo cambia la
  URL de `coverUrl`, pero la que ya se le pasó al SO usa el token viejo → **404 en
  lockscreen/CarPlay**. **Manejo obligatorio:** PlayerContext lee `token` (vía `useAuth()` —
  válido, `AuthProvider > PlayerProvider` en main.jsx:11-12) y lo mete en las **deps** del
  efecto de metadata → re-emite con URL fresca al rotar. **Guard del hueco `token=null`:**
  mientras es null, emitir metadata **sin `artwork`** (no mandar `?token=null`, que también
  404ea); re-emitir con artwork al llegar el nuevo.
- El `audio.src` tiene el mismo problema de token viejo: **pre-existente**, no lo introduce este
  trabajo, fuera de alcance.

### Action handlers

Todos con guard (`'mediaSession' in navigator`) y try/catch por handler (motores viejos lanzan
`TypeError` en acciones no soportadas). Se registran una vez (los métodos del contexto son
`useCallback` estables que leen refs).

| Acción | Se cablea a | Nota |
|---|---|---|
| `play` | `audio.play()` | + `playbackState='playing'` |
| `pause` | `audio.pause()` | + `playbackState='paused'` |
| `previoustrack` | `prev()` | respeta shuffle + historial (PlayerContext:141) |
| `nexttrack` | `next()` | ignora "repetir una" (correcto para skip manual) |
| `seekto` | `seek(details.seekTime)` | `seek()` clampa a `[0, duration]` |
| `seekbackward` | `seek(cur − (details.seekOffset ?? 10))` | `cur = getAudio().currentTime` |
| `seekforward` | `seek(cur + (details.seekOffset ?? 10))` | idem |
| `stop` | `audio.pause()` (+ reset opcional) | iOS suele ignorarlo |

**`playbackState` siempre seteado** (`'playing'`/`'paused'`): sin él, iOS/CarPlay desincroniza
el glifo play/pause.

### setPositionState (sin tocar el reloj del karaoke)

`setPositionState({ duration, playbackRate: 1, position })`, en el efecto que ya reacciona a
`currentTime`/`duration`.

- **Guards obligatorios** (si no, **lanza**): `duration` finito y `> 0`, `position ≤ duration`.
  Con `duration===0` (arranque de pista, `playIndex` resetea a 0 ~:47-48) → **omitir**.
- `playbackRate: 1` fijo (no cambiamos velocidad).
- **Aislamiento (regla dura):** `setPositionState` y el **reloj interpolado del karaoke**
  (`LyricsPanel.jsx:145-419`) son **ambos consumidores read-only** del mismo
  `currentTime`/`duration`. Ninguno escribe al audio; viven en paralelo. **No acoplarlos.**

### iOS Safari vs Chrome Android (diferencias reales)

Ambos importan: **Mazda 3 y Maverick** usan **CarPlay (iPhone) o Android Auto**; RAV4/Kangoo,
**BT AVRCP** desde cualquiera de los dos. Y como el "Now Playing" de CarPlay/AA **lo dibuja el
SO** (no el carro), esta tabla —no el fabricante— es lo que predice qué se ve en los dos carros
prioritarios.

| Aspecto | Chrome Android | iOS Safari / PWA standalone |
|---|---|---|
| metadata + artwork | notif + lockscreen + AA | lockscreen + Centro de Control + **CarPlay** |
| prev / next | ✅ | ✅ **solo si** ambos handlers seteados |
| `seekto` | ✅ | ✅ Safari 15+ |
| `seekbackward/forward` | ✅ ±10s | ⚠️ ±15s; puede **sustituir** a prev/next según handlers |
| `stop` | ✅ | ⚠️ a menudo ignorado |
| `setPositionState` | scrubber preciso | **crítico**: iOS *throttlea* el JS en background → el SO **interpola** desde el último estado. Sin él, la barra se congela |
| gesto de usuario | el primer `play()` basta | igual; **PWA standalone** = audio en background más fiable |

Regla práctica: setear **todos** los handlers + `playbackState` siempre; `setPositionState` es
lo que hace que iOS se vea bien en el carro aunque el JS esté dormido.

## Frente C — Responsivo de teléfono (regímenes + estrategia)

**Hoy NO hay ningún media query de `landscape` ni de portrait/altura de teléfono corto.** El
corte maestro es 700px; el único de altura es `@media (max-width:700px) and (max-height:680px)`
(main.css:3511). Ese es el hueco — pero ahora es un hueco **de teléfono**, no de head unit.

### Estrategia (jerarquía de responsabilidades — justificada)

- **`@media` por ORIENTACIÓN = base estructural (reflow).** El reflow real es **portrait
  (apilar) ↔ landscape (comprimir)**. No se pasa de un stack a un layout comprimido con
  `clamp()` (eso es reflow). En un teléfono, **landscape ⇒ siempre poco alto** (≤ ~430px), así
  que basta `orientation`; no hace falta un gate extra de `max-height`.
- **`clamp()` + `min()`/`max()` con `vmin`/`vh` = tamaño fluido DENTRO de cada régimen.** Type y
  espaciado escalan suave entre modelos de teléfono sin un breakpoint por resolución. El piso de
  64px se garantiza con `max(64px, …)`.
- **Container queries: NO hacen falta.** Con solo 2 regímenes por orientación, `@media` alcanza
  y sobra. (En teléfonos modernos CQ existe, pero no aporta acá.)

**Por qué NO puro breakpoints:** varios modelos con dims parecidas → un breakpoint por resolución
es frágil. **Por qué NO puro clamp/vmin:** no hace reflow portrait↔landscape. La mezcla es lo
correcto.

### Dos regímenes (por `@media orientation`)

- **Portrait** (`orientation: portrait`) → **stack vertical cómodo** (sobra alto). Cara "Ruta"
  completa.
- **Landscape** (`orientation: landscape`) → **comprimido** (poco alto): arte de fondo o mini,
  controles en 1 fila, cero apilado que pida scroll. Cara "Faro". **El caso de diseño crítico.**

### Matriz de resoluciones REALES (checklist QA)

**Teléfono montado, ambas orientaciones — 6 resoluciones** (3 portrait + 3 landscape). Nada más.

| Resolución | Orientación | Régimen | Nota |
|---|---|---|---|
| 390×844 | portrait | Portrait | iPhone montado vertical |
| 412×915 | portrait | Portrait | Android grande vertical |
| 375×667 | portrait | Portrait | iPhone SE vertical |
| 844×390 | landscape | Landscape | iPhone montado horizontal |
| 915×412 | landscape | Landscape | Android grande horizontal |
| 667×375 | landscape | Landscape (h=375, **el peor**) | iPhone SE horizontal — **el caso de diseño crítico** |

**Fuera de car-lab a propósito:**
- **HiBy R4 (360×640):** es un **DAP de mano, NO va montado en el tablero** → no es escenario
  "auto". Su portrait chico es **territorio de mobile-lab** (que ya tiene su matriz). Su única
  implicación técnica (el Chrome viejo del DAP) es un pendiente de `build.target` **a nivel
  proyecto**, anotado en `CLAUDE.md` → "Pendientes conocidos", **no** en car-lab.
- **Head units aftermarket / ultrawide de tablero** (800×480, 1024×600, 1280×720, 1280×480,
  1920×720, 1280×800): hipotéticos, sin hardware — CarPlay/AA cubren la pantalla del carro.

## Frente B — Modo Auto (la capa)

**Dirección B "Ruta" fluida.** Arte + meta + **seek grande y táctil** + fila de controles +
salir. 4-5 elementos. **Cómodo en portrait**, **colapsa a "Faro"** (comprimido) en landscape.

### Reglas de seguridad vial (DURAS, no negociables)

- **Touch targets ≥ 64px** (NO 44px: manos en movimiento, vibración). Piso con `max(64px, …)`.
- **Máximo 4-5 elementos** por pantalla.
- **Cero scroll durante conducción.** Nada que requiera hojear.
- **Negro forzado + alto contraste + tipografía grande.**
- Respeta **`prefers-reduced-motion`** (color sí, movimiento no — regla de la casa).

### z-index y supresión

- Nueva var **`--z-car`** justo **debajo del toast (400)**.
- **La capa SUPRIME, no apila:** mientras Modo Auto está activo, Player.jsx **NO monta**
  expandido, LyricsPanel, InfoPanel ni ChangelogBell — `CarMode` (`fixed inset:0`) los reemplaza.
  Como no se montan, **no compiten en z**; el único sibling encima es el toast (intencional). Con
  esto la **"barra fantasma" es imposible por construcción** y la cadena de Esc es trivial
  (Esc = salir del modo).
- **Al ENTRAR:** resetear `expanded`/`showLyrics`/`showInfo` a `false` (no dejar nada montado
  detrás).
- **El toast queda encima** (querido) → la UI del car **no dispara toasts** (no exponer "añadir a
  playlist" ahí) para no distraer.

### Entrada / salida

- **Toggle explícito SIEMPRE** (botón "Modo Auto"). Salir: botón "Salir" grande + Esc.
- **Landscape NO auto-activa** (ver la biblioteca con el teléfono de lado ≠ manejar). Se puede
  **sugerir** con un hint discreto (cuando `landscape + PWA standalone`) que **requiere un tap**.
  Nunca forzar.
- **Persistir** el estado en `localStorage` (al volver a la app / reconectar sigue en el modo).

### Karaoke en Modo Auto: DEGRADAR, no bloquear

- Mostrar **solo la línea que suena ahora** (grande, centrada, alto contraste), que cambia sola en
  su marca — un *vistazo*, no una *lectura*.
- **Cero scroll, cero auto-follow, cero tap-para-seek** de línea.
- Detrás de un **toggle OFF por defecto** (el conductor lo activa, idealmente detenido).
- Reusa el reloj interpolado existente → barato.

### Wake Lock (requisito CON degradación obligatoria)

- **No existe hoy** (cero referencias en el repo). Con el teléfono montado, la pantalla se apaga.
- **API desde Chrome 84 / iOS Safari 16.4.** Un iPhone en iOS 15 o 16.0-16.3 **NO la tiene** →
  por eso **NO es un requisito duro**: es "pedir si se puede".
- **Guard OBLIGATORIO `'wakeLock' in navigator` ANTES de tocarla.** Si no existe, el Modo Auto
  **entra y funciona igual sin wake lock** — nunca lanza, nunca bloquea la entrada al modo.
- Cuando existe: `navigator.wakeLock.request('screen')` **en try/catch** (puede rechazar) al
  **entrar**; `release()` al **salir**.
- **Re-adquirir en `visibilitychange`** (solo si hay soporte): el SO suelta el lock al ir a
  background; volver al foreground con el modo activo debe re-pedirlo.
- Degradar **en silencio** siempre (no avisar al conductor de algo que no puede arreglar).

### Safe-areas (aisladas) — ojo con el notch DE LADO

El Modo Auto **audita sus propias safe-areas DENTRO de su capa** (`env(safe-area-inset-*)`), sin
tocar el resto del layout ni la premisa `status-bar-style=black` del index.html. **Nuevo con esta
premisa:** un iPhone montado en **landscape** pone el notch/cámara a la **izquierda o derecha** →
`safe-area-inset-left`/`right` pasan a ser **load-bearing** (los controles no pueden quedar bajo
el notch). En portrait mandan top/bottom como siempre.

## Reglas duras (no romper)

1. **MediaSession vive en PlayerContext**, no en Player.jsx. El `<audio>` **nunca** se expone.
2. **`setPositionState` y el reloj del karaoke no se acoplan** (ambos read-only aguas abajo).
3. **Modo Auto suprime, no apila.** Nada de montar expandido/Letra/Info bajo la capa car.
4. **Targets ≥ 64px** en Modo Auto (más alto que el piso móvil de 44px).
5. **Wake Lock solo tras guard `'wakeLock' in navigator`** (Chrome 84+ / iOS 16.4+) — degrada
   **en silencio**, nunca bloquea la entrada al modo; re-adquiere en `visibilitychange` si hay soporte.
6. **No tocar backend/scanner.** El endpoint multi-tamaño de carátula es DEUDA que **con la premisa
   actual no vale la pena** (el original ya se sirve grande); no se toca sin OK explícito.
7. **`Player.jsx` y `PlayerContext.jsx` son COMPARTIDOS** con desktop y toda la app: todo plan
   dice qué pasa en desktop y en los demás consumidores.
8. **Nada de dependencias nuevas.** MediaSession, Wake Lock, `clamp`, `env()`: todo nativo.
9. Respetar `prefers-reduced-motion` y el **z-index canónico** (barra < campanita 150 < expandido
   200 < Letra 250 < popovers 260 < Info 300 < **car (nuevo, <400)** < toast 400).

## Compatibilidad de APIs (piso real: navegador de teléfono moderno)

Con la premisa corregida el piso ya **no** es Chrome 60-80 de head unit, sino el navegador de un
**teléfono moderno** (iOS Safari / Chrome Android). Eso simplifica todo:

- **`build.target` (Vite default = Chrome 87): OK.** Los teléfonos objetivo corren Chrome/Safari
  muy por encima de 87. **`@vitejs/plugin-legacy` SALE de la conversación.** (El hallazgo previo
  del bundle que "no arranca en Chrome 60-80" **ya no aplica** — no hay Chrome 60-80 en scope.)
- **`clamp()`/`min()`/`max()` (Safari 13.1 / Chrome 79): OK**, sin fallback.
- **`dvh`/`svh` (Safari 15.4 / Chrome 108):** modernos lo tienen; se mantiene el patrón `vh`→`dvh`
  ya existente (main.css:65-66) porque es **estándar barato**, no una carga extra.

**Guards que SIGUEN siendo necesarios (por iOS, no por Chrome viejo):**

| API / feature | Guard/acción | Por qué |
|---|---|---|
| **Wake Lock** | **guard `'wakeLock' in navigator`** | iOS Safari solo desde **16.4**; iPhones en iOS 15/16.0-16.3 no la tienen |
| **`setPositionState`** | guard/try-catch | higiene + iOS Safari < 15 |
| **`env(safe-area-inset-*)`** | usar **con fallback** `env(…, 0px)` | **core, no compat**: notch/home indicator; en landscape, **left/right** load-bearing |
| action handlers nuevos (`seekto/seekbackward/seekforward`) | try/catch por handler | motor viejo puede lanzar |

**No cargar con fallbacks para hardware que no existe** (Chrome 60-80, ultrawide, container-query
polyfills): fuera.

## Entorno de QA (limitación conocida)

**No hay hardware real en este entorno** (ni carro, ni CarPlay/AA, ni teléfono físico). El QA cubre
**código + DevTools**: device mode con las **6 resoluciones reales** de la matriz en **ambas
orientaciones**, emulación táctil, `prefers-reduced-motion`, throttling; MediaSession inspeccionable
en `chrome://media-internals` y el panel Media de DevTools. Todo lo que exija hardware —**CarPlay/AA
de Mazda 3 y Maverick**, Bluetooth AVRCP de RAV4/Kangoo, controles del volante, lockscreen iOS real,
Wake Lock físico— se marca **🔍 REQUIERE PRUEBA FÍSICA** con pasos exactos: **las hace el usuario en
el carro**.

**Atajo que abarata el QA de CarPlay/AA:** como el "Now Playing" lo dibuja el SO y no el carro, el
**lockscreen del teléfono es un proxy fiel de lo que verán Mazda 3 y Maverick**. Un iPhone/Android a
mano (sin carro) ya valida la metadata; el carro solo confirma el enlace y los controles del volante.

## Checklist QA

**Frente A — MediaSession (el que más importa)**
1. `navigator.mediaSession.metadata` se setea al cambiar de pista (title/artist/album/artwork);
   `playbackState` sigue a `isPlaying`.
2. Handlers cableados: play, pause, previoustrack, nexttrack, seekto, seekbackward, seekforward,
   stop — cada uno con guard + try/catch.
3. `setPositionState` con guards (duration finito >0, position ≤ duration); omitido en el arranque
   de pista; **no** toca el reloj del karaoke.
4. **Token rotation:** al forzar un 401/reauth, la metadata se re-emite con URL fresca; en el hueco
   `token=null` no se manda `?token=null`.
5. 🔍 FÍSICA — **los 4 carros**. Hacer **primero el proxy** (lockscreen del teléfono: metadata +
   carátula + prev/next/seek + el scrubber moviéndose en background). Con eso verde:
   - **5a. Mazda 3 2021 (CarPlay/AA)** — ⭐ prueba estrella. Antes que nada: **¿aparece el ícono de
     CarPlay al conectar el iPhone?** (cierra el riesgo abierto del trim BASE). Después: carátula +
     título/artista/álbum en la pantalla y prev/next/seek desde el volante.
   - **5b. Maverick 2022 (CarPlay/AA)** — ⭐ prueba estrella. Lo mismo. **Debe verse casi idéntico al
     Mazda 3**: si difieren, es del SO, no de la app.
   - **5c. RAV4 2016 (AVRCP)** — título/artista y controles del volante. **Sin carátula = ESPERABLE**,
     no un hallazgo. Título truncado = límite del estéreo, no un hallazgo.
   - **5d. Kangoo 2007 (AVRCP)** — ídem 5c.

   **Regla de triage:** si el lockscreen se ve bien y un carro no, **el hallazgo NO es de la app**.
   Solo abrir bug contra `PlayerContext` si el **lockscreen** falla.

**Frente C — Responsivo de teléfono**
6. Las **6 resoluciones** de la matriz en ambas orientaciones: **sin scroll horizontal**, sin
   solapamientos, type legible.
7. Cruce portrait ↔ landscape: sin saltos ni elementos cortados; el reflow ocurre por
   `@media orientation`, el escalado por `clamp`.
8. `667×375` (el hostil): todo cabe sin scroll; controles en 1 fila; arte de fondo.

**Frente B — Modo Auto**
9. **Targets ≥ 64px** en todos los controles del modo; ≤ 5 elementos; cero scroll.
10. **Supresión:** con el modo activo NO hay expandido/Letra/Info/campanita montados; al entrar se
    resetearon esos estados; el toast (si aparece) queda encima.
11. **Entrada/salida:** toggle explícito entra y sale; Esc sale; el estado persiste en localStorage;
    landscape NO auto-activa (a lo sumo sugiere con tap).
12. **Wake Lock:** guard `'wakeLock' in navigator` **antes** de tocarla; con soporte se pide al
    entrar / libera al salir / re-adquiere tras `visibilitychange`; **sin soporte el modo entra
    igual** (no lanza, no bloquea la entrada).
13. **Karaoke degradado:** solo línea activa estática, sin scroll ni auto-follow ni tap-seek; OFF
    por defecto.
14. **Safe-areas del modo:** en landscape los controles no quedan bajo el notch (`safe-area-inset-left/right`);
    en portrait, top/bottom.
15. **reduced-motion:** transiciones del modo anuladas, colores/contraste intactos.
16. **Desktop/app no rotos** (Player.jsx y PlayerContext compartidos): reproducción, gestos,
    tooltips, volumen, navegación intactos con el Modo Auto inactivo.
