---
name: car-lab
description: Estándar del uso EN EL AUTO de SonoraRev — tres frentes web-only (MediaSession para controles del volante/CarPlay/AA, Modo Auto de conducción, y responsivo extremo para head units/DAPs/teléfonos montados). Contrato de MediaSession, reglas de seguridad vial, regímenes responsivos y checklist QA. Úsala SIEMPRE antes de tocar o auditar cualquier cosa del auto (MediaSession en PlayerContext, capa Modo Auto, media queries de landscape/short-height).
---

# Car Lab — estándar del uso en el auto de SonoraRev

Fuente de verdad del frente "reproductor en el auto". **CarPlay y Android Auto NO
renderizan web**: no vamos por app nativa. Vamos por tres cosas que sí funcionan
hoy desde la web. Gran parte de este sistema **está por construirse** — la skill
es el **contrato a construir**, no un mapa de código existente. Lo que ya existe
lleva `archivo:línea`; lo que falta va marcado **⚠️ A CONSTRUIR**. No cites de
memoria: **verificá contra el código real** antes de opinar o tocar.

## Los tres frentes (y su orden)

| # | Frente | Qué es | Riesgo |
|---|---|---|---|
| **A** | **MediaSession** | metadata + carátula + controles del volante en la pantalla del carro vía Bluetooth / CarPlay / AA "Now Playing" | bajo (aislado, testeable con Bluetooth) |
| **C** | **Responsivo extremo** | landscape corto y head units aftermarket (Chrome), DAPs, teléfonos montados | medio (beneficia a TODA la app) |
| **B** | **Modo Auto** | layout de conducción dentro de SonoraRev (capa que suprime) | medio (encima de A y C) |

**Orden de ejecución pactado: A → C → B.** A es aislado y se prueba con Bluetooth
el mismo día; C beneficia a todo, no solo al auto; B va encima de lo anterior.

**Dirección visual del Modo Auto: B "Ruta" fluida** (elegida). Un solo esqueleto
que **colapsa a "Faro"** (minimalismo) en pantallas cortas y **se expande a
"Copiloto"** (dashboard) en ultrawide. Ver §Frente B.

## Archivos del sistema (dónde vive / vivirá cada cosa)

| Archivo | Rol |
|---|---|
| `music-client/src/context/PlayerContext.jsx` | Dueño del `<audio>` (`new Audio()`, `getAudio()` ~:29) y de la reproducción. **⚠️ A CONSTRUIR aquí:** MediaSession (metadata + handlers + `setPositionState`), el estado `trackMeta` enriquecido, y la lectura de `token` (vía `useAuth()`) para re-emitir artwork. **Invariante: NO expone el `<audio>`** (se mantiene) |
| `music-client/src/utils/trackMeta.js` | **⚠️ A CONSTRUIR (nuevo):** helper puro `resolveTrackMeta(track)` que centraliza el fallback `api.track(id)` hoy disperso en Player.jsx |
| `music-client/src/components/Player.jsx` | Consume el contexto. **⚠️ A CONSTRUIR:** el toggle de Modo Auto; y adelgazar — borrar el estado `quality` (~:163-175) y los re-fetch de `goArtist`/`goAlbum` (~:610-632) a favor de `trackMeta` del contexto |
| `music-client/src/components/CarMode.jsx` | **⚠️ A CONSTRUIR (nuevo):** la capa Modo Auto (dirección B fluida). `fixed inset:0`, suprime el resto |
| `music-client/src/styles/main.css` | z-index canónico (`:root` ~:34), regímenes responsivos. **⚠️ A CONSTRUIR:** `--z-car`, las media queries de los 4 regímenes, los estilos `.car-*` |
| `music-client/index.html` | `viewport-fit=cover` **ya está** (:5); manifest PWA linkeado (:10). `apple-mobile-web-app-status-bar-style=black` **opaco a propósito** (:14-18) |

## Frente A — MediaSession (contrato)

**Vive en PlayerContext, NO en Player.jsx.** El contexto es el dueño del audio y
del ciclo de reproducción; MediaSession es una proyección de ese estado al SO.

### Helper de metadata compartido

El contexto no garantiza `album`/`album_artist`/`codec…` (faltan si la cola vino
de `/albums/:album/tracks`). Se centraliza el fallback en un util puro:

```js
// music-client/src/utils/trackMeta.js
function isComplete(t) {
  return !!(t && t.album && t.album_artist && (t.codec || t.sample_rate || t.bitrate));
}
export async function resolveTrackMeta(track) {
  if (!track) return null;
  if (isComplete(track)) return track;            // completa → cero red
  try { return { ...track, ...(await api.track(track.id)) }; }
  catch { return track; }                          // nunca lanza → degrada
}
```

- **PlayerContext es el único que lo llama**: resuelve `trackMeta` al cambiar
  `currentTrack` (con cancelación) y lo **expone en el value**.
- **Dedup obligatorio (evita el re-fetch eterno):** una pista que genuinamente no tiene
  `album` **nunca** pasa `isComplete()` → sin memo, re-pediría `api.track(id)` en CADA
  reproducción para recibir lo mismo. El contexto guarda un **memo `Map<id, resolved>`** en un
  `useRef`: antes de resolver, si `id` está en el memo → usa lo cacheado (**cero red**); si no →
  resuelve una vez y lo guarda. Acotado por las pistas distintas reproducidas en la sesión
  (≤ tamaño de la biblioteca, ~334) → **NO es un caché grande**. Se prefiere al `Set` de ids
  intentados porque **preserva el enriquecimiento en replays** (un `Set` devolvería el track
  crudo la segunda vez, perdiendo `codec/…`). Se limpia solo al recargar; si preocupa staleness
  tras un rescan, invalidar la entrada por `track.id`.
- **Player.jsx adelgaza**: borra su `quality` local y sus re-fetch; lee `trackMeta`.
  Ganancia: hoy `quality` + `goArtist` + `goAlbum` pueden disparar **3 `api.track`**
  para la misma pista → queda **1 (y 0 en replays gracias al memo)**.
- MediaSession se alimenta de `trackMeta` (título/artista salen de `currentTrack`,
  que siempre los trae; `album` de `trackMeta`).

### Metadata + artwork

`navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork })`.

- **Artwork:** `coverUrl(trackId)` (`client.js:80`) → `/api/tracks/{id}/cover?token=…`.
  URL **relativa** (el navegador la resuelve) con **token en query param**. Declarar
  varios `sizes` (`96x96`, `256x256`, `512x512`) apuntando a la MISMA imagen: el
  navegador escala; es un piadoso "como si". **⚠️ DEUDA:** endpoint multi-tamaño real
  (requiere backend → fuera de alcance hasta pactarlo).
- **Riesgo del token (rotación):** un 401 dispara `reauth()` (AuthContext:78-95):
  `logout()` (token=`null` un instante) → `cfLogin()` → `applyToken(tokenNuevo)`. El
  token nuevo cambia la URL de `coverUrl`, pero la que ya se le pasó al SO usa el token
  viejo → **404 en lockscreen/CarPlay**. **Manejo obligatorio:** PlayerContext lee
  `token` (vía `useAuth()` — válido, `AuthProvider > PlayerProvider` en main.jsx:11-12)
  y lo mete en las **deps** del efecto de metadata → re-emite con URL fresca al rotar.
  **Guard del hueco `token=null`:** mientras es null, emitir metadata **sin `artwork`**
  (no mandar `?token=null`, que también 404ea); re-emitir con artwork al llegar el nuevo.
- El `audio.src` tiene el mismo problema de token viejo: **pre-existente**, no lo
  introduce este trabajo, fuera de alcance.

### Action handlers

Todos con guard (`'mediaSession' in navigator`) y try/catch por handler (navegadores
viejos lanzan `TypeError` en acciones no soportadas). Se registran una vez (los métodos
del contexto son `useCallback` estables que leen refs).

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

**`playbackState` siempre seteado** (`'playing'`/`'paused'`): sin él, iOS desincroniza
el glifo play/pause.

### setPositionState (sin tocar el reloj del karaoke)

`setPositionState({ duration, playbackRate: 1, position })`, en el efecto que ya
reacciona a `currentTime`/`duration`.

- **Guards obligatorios** (si no, **lanza**): `duration` finito y `> 0`, `position ≤
  duration`. Con `duration===0` (arranque de pista, `playIndex` resetea a 0 ~:47-48) →
  **omitir**.
- `playbackRate: 1` fijo (no cambiamos velocidad).
- **Aislamiento (regla dura):** `setPositionState` y el **reloj interpolado del karaoke**
  (`LyricsPanel.jsx:145-419`) son **ambos consumidores read-only** del mismo
  `currentTime`/`duration`. Ninguno escribe al audio; viven en paralelo. **No acoplarlos.**

### iOS Safari vs Chrome Android (diferencias reales)

| Aspecto | Chrome Android | iOS Safari / PWA standalone |
|---|---|---|
| metadata + artwork | notif + lockscreen + AA | lockscreen + Centro de Control + **CarPlay** |
| prev / next | ✅ | ✅ **solo si** ambos handlers seteados |
| `seekto` | ✅ | ✅ Safari 15+ |
| `seekbackward/forward` | ✅ ±10s | ⚠️ ±15s; puede **sustituir** a prev/next según handlers |
| `stop` | ✅ | ⚠️ a menudo ignorado |
| `setPositionState` | scrubber preciso | **crítico**: iOS *throttlea* el JS en background → el SO **interpola** desde el último estado. Sin él, la barra se congela |
| gesto de usuario | el primer `play()` basta | igual; **PWA standalone** = audio en background más fiable |

Regla práctica: setear **todos** los handlers + `playbackState` siempre; `setPositionState`
es lo que hace que iOS se vea bien en el carro aunque el JS esté dormido.

## Frente C — Responsivo extremo (regímenes + estrategia)

**Hoy NO hay ningún media query de `landscape` ni de altura ≤ 480px.** El único corte
de altura es `@media (max-width:700px) and (max-height:680px)` (main.css:3511, compacta
el expandido). El corte maestro es 700px. Ese es el hueco.

### Estrategia (jerarquía de responsabilidades — justificada)

- **`@media` por ORIENTACIÓN + ALTURA + ASPECT-RATIO = base estructural (reflow).**
  El eje que importa en el carro **no es el ancho, es el alto y el aspect-ratio**. No se
  puede pasar de stack vertical a 2 columnas con `clamp()` (eso es reflow). Y `@media` tiene
  **soporte universal** — obligatorio porque **muchos head units aftermarket corren Chrome
  VIEJO** (Android 6-9, Chrome 60-80).
- **`clamp()` + `min()`/`max()` con `vmin`/`vh` = tamaño fluido DENTRO de cada régimen.**
  Type y espaciado escalan suave de 800px a 1920px sin un breakpoint por resolución. El
  piso de 64px se garantiza con `max(64px, …)`.
- **Container queries = SOLO mejora progresiva, NO carga estructural.** La capa car es un
  overlay aislado (candidato ideal), pero **CQ llegó en Chrome 105 (2022)** y los head units
  viejos no lo tienen. Base en `@media`; CQ opcional encima.

**Por qué NO puro breakpoints:** 11 resoluciones con aspect-ratios salvajes → explosión
combinatoria y frágil. **Por qué NO puro clamp/vmin:** no hace reflow. La mezcla es lo correcto.

### Cuatro regímenes (por `@media`, en este orden)

- **R1 Portrait** (`orientation: portrait`) → stack vertical.
- **R4 Ultrawide** (`min-aspect-ratio: 12/5` ≈ 2.4) → 3 zonas horizontales ("Copiloto").
- **R3 Landscape corto** (`max-height: 480px`) → comprimido, arte de fondo blur, controles
  en 1 fila ("Faro"). **El caso más hostil.**
- **R2 Landscape normal** (resto) → 2 columnas ("Ruta").

### Matriz de resoluciones (checklist QA)

| Resolución | Ratio | Régimen | Cobertura | Cara de B |
|---|---|---|---|---|
| 800×480 | 1.67 | R2/R3 borde | 2-col comprimido; `max(64px,…)`; type `clamp` | B→A |
| 1024×600 | 1.71 | R2 | 2-col cómodo | B |
| 1280×720 | 1.78 | R2 | 2-col holgado | B |
| 1280×480 | 2.67 | **R4** | 3 zonas, usa el ancho | C |
| 1920×720 | 2.67 | **R4** | 3 zonas, type grande | C |
| 1280×800 | 1.60 | R2 (alto) | 2-col con aire | B |
| 360×640 | 0.56 | **R1** | stack vertical (DAP HiBy R4) | B |
| 844×390 | 2.16 | **R3** | comprimido, arte de fondo | A |
| 915×412 | 2.22 | **R3** | comprimido | A |
| 667×375 | 1.78 | **R3** (h=375, el peor) | arte de fondo, 1 fila controles, seek fino no-táctil | A |

## Frente B — Modo Auto (la capa)

**Dirección B "Ruta" fluida.** Arte medio + meta + **seek grande y táctil** + fila de
controles + salir. 4-5 elementos. Es el esqueleto que colapsa a "Faro" en R3 y se expande
a "Copiloto" en R4.

### Reglas de seguridad vial (DURAS, no negociables)

- **Touch targets ≥ 64px** (NO 44px: manos en movimiento, vibración). Piso con `max(64px, …)`.
- **Máximo 4-5 elementos** por pantalla.
- **Cero scroll durante conducción.** Nada que requiera hojear.
- **Negro forzado + alto contraste + tipografía grande.**
- Respeta **`prefers-reduced-motion`** (color sí, movimiento no — regla de la casa).

### z-index y supresión

- Nueva var **`--z-car`** justo **debajo del toast (400)**.
- **La capa SUPRIME, no apila:** mientras Modo Auto está activo, Player.jsx **NO monta**
  expandido, LyricsPanel, InfoPanel ni ChangelogBell — `CarMode` (`fixed inset:0`) los
  reemplaza. Como no se montan, **no compiten en z**; el único sibling encima es el toast
  (intencional). Con esto la **"barra fantasma" es imposible por construcción** y la cadena
  de Esc es trivial (Esc = salir del modo).
- **Al ENTRAR:** resetear `expanded`/`showLyrics`/`showInfo` a `false` (no dejar nada montado
  detrás).
- **El toast queda encima** (querido) → la UI del car **no dispara toasts** (no exponer
  "añadir a playlist" ahí) para no distraer.

### Entrada / salida

- **Toggle explícito SIEMPRE** (botón "Modo Auto"). Salir: botón "Salir" grande + Esc.
- **Landscape NO auto-activa** (ver la biblioteca en horizontal ≠ manejar). Se puede
  **sugerir** con un hint discreto (cuando `landscape + alto corto + PWA standalone`) que
  **requiere un tap**. Nunca forzar.
- **Persistir** el estado en `localStorage` (al reconectar Bluetooth vuelve al modo).

### Karaoke en Modo Auto: DEGRADAR, no bloquear

- Mostrar **solo la línea que suena ahora** (grande, centrada, alto contraste), que cambia
  sola en su marca — un *vistazo*, no una *lectura*.
- **Cero scroll, cero auto-follow, cero tap-para-seek** de línea.
- Detrás de un **toggle OFF por defecto** (el conductor lo activa, idealmente detenido).
- Reusa el reloj interpolado existente → barato.

### Wake Lock (requisito CON degradación obligatoria)

- **No existe hoy** (cero referencias en el repo). En el auto la pantalla se apaga.
- **API desde Chrome 84** (y iOS Safari 16.4). Head units con Chrome viejo e iOS previos NO
  la tienen → **NO es un requisito duro**: es "pedir si se puede".
- **Guard OBLIGATORIO `'wakeLock' in navigator` ANTES de tocarla.** Si no existe, el Modo Auto
  **entra y funciona igual sin wake lock** — nunca lanza, nunca bloquea la entrada al modo.
- Cuando existe: `navigator.wakeLock.request('screen')` **en try/catch** (puede rechazar) al
  **entrar**; `release()` al **salir**.
- **Re-adquirir en `visibilitychange`** (solo si hay soporte): el SO suelta el lock al ir a
  background; volver al foreground con el modo activo debe re-pedirlo.
- Degradar **en silencio** siempre (no avisar al conductor de algo que no puede arreglar).

### Safe-areas (aisladas)

El Modo Auto **audita sus propias safe-areas DENTRO de su capa** (`env(safe-area-inset-*)`),
sin tocar el resto del layout ni la premisa `status-bar-style=black` del index.html. Un
overlay full-bleed las necesita; el resto de la app no cambia.

## Reglas duras (no romper)

1. **MediaSession vive en PlayerContext**, no en Player.jsx. El `<audio>` **nunca** se expone.
2. **`setPositionState` y el reloj del karaoke no se acoplan** (ambos read-only aguas abajo).
3. **Modo Auto suprime, no apila.** Nada de montar expandido/Letra/Info bajo la capa car.
4. **Targets ≥ 64px** en Modo Auto (más alto que el piso móvil de 44px).
5. **Wake Lock solo tras guard `'wakeLock' in navigator`** (Chrome 84+ / iOS 16.4+; head units
   viejos no la tienen) — degrada **en silencio**, nunca bloquea la entrada al modo; re-adquiere
   en `visibilitychange` si hay soporte.
6. **No tocar backend/scanner.** El endpoint multi-tamaño de carátula es DEUDA anotada, no
   se toca sin OK explícito.
7. **`Player.jsx` y `PlayerContext.jsx` son COMPARTIDOS** con desktop y toda la app: todo
   plan dice qué pasa en desktop y en los demás consumidores.
8. **Nada de dependencias nuevas.** MediaSession, Wake Lock, container queries, clamp: todo
   nativo.
9. Respetar `prefers-reduced-motion` y el **z-index canónico** (barra < campanita 150 <
   expandido 200 < Letra 250 < popovers 260 < Info 300 < **car (nuevo, <400)** < toast 400).

## Compatibilidad de APIs (piso real: el Chrome de los head units)

**⚠️ Hallazgo que manda sobre todo lo demás:** el build **no fija `build.target`**
(`vite.config.js` sin override) → Vite 5 usa su default `'modules'` (**Chrome 87**, Edge 88,
FF 78, Safari 14) y la app carga por `<script type="module">` (index.html:23). En Chrome 60-80
**el bundle no arranca** (sintaxis ES2020 sin down-level) → el CSS responsivo es irrelevante si
el JS no corre. Antes de prometer Chrome 60-80 hay dos caminos honestos: (a) **confirmar la
versión real** de los head units objetivo (muchos Android head units / Android Automotive corren
Chrome ≥90); o (b) si de verdad hay que soportar Chrome viejo, **`@vitejs/plugin-legacy` + bajar
`build.target`** — cambio de build/infra, decisión aparte, **fuera de car-lab**.

Asumiendo el piso efectivo **Chrome 87** (o el que confirmemos), estado de cada API del contrato:

| API / feature | Disponible desde | Estado en 87 | Acción |
|---|---|---|---|
| MediaSession metadata + play/pause/prev/next | Chrome 57 | ✅ | try/catch por handler (hygiene) |
| `setActionHandler` seekto/seekbackward/seekforward | Chrome 78 | ✅ | try/catch por handler |
| `setPositionState` | Chrome 81 | ✅ | guard/try-catch (robustez + iOS Safari viejo) |
| Wake Lock | Chrome 84 / iOS 16.4 | ✅ en 87, ❌ iOS viejo | **guard obligatorio** (ver §Wake Lock) |
| `clamp()` / `min()` / `max()` | Chrome 79 | ✅ | — |
| `env(safe-area-inset-*)` | Chrome 69 | ✅ | **línea fallback estática** antes (Chrome <69 tira la regla) |
| `dvh` / `svh` | Chrome 108 | ❌ (fuera del piso 87) | **fallback `vh` obligatorio** — patrón ya en main.css:65-66 |
| Container queries `@container` | Chrome 105 | ❌ (fuera del piso 87) | ya **excluidas** de uso estructural ✅ |
| `min-aspect-ratio` (media, legacy) | antiguo | ✅ | forma correcta (no la range syntax nueva) |
| `orientation` / `max-height` (media) | antiguo | ✅ | — |
| Pointer Events (gestos existentes) | Chrome 55 | ✅ | — |
| `localStorage` / `visibilitychange` | antiguo | ✅ | — |

**Ya con red:** `dvh`→`vh` (main.css:65-66, 2276-2277), container queries fuera, `min-aspect-ratio`
en forma legacy. **A cuidar al construir:** Wake Lock (guard), `env()` (línea fallback en la capa
car), `setPositionState` (guard), y sobre todo **el `build.target`** si el objetivo real es Chrome <87.

## Entorno de QA (limitación conocida)

**No hay hardware real en este entorno** (ni carro, ni head unit, ni CarPlay/AA reales). El
QA cubre **código + DevTools** (device mode con las 11 resoluciones de la matriz, emulación
táctil, `prefers-reduced-motion`, throttling; MediaSession inspeccionable en
`chrome://media-internals` y el panel Media de DevTools). Todo lo que exija hardware
—controles del volante reales, CarPlay/AA de verdad, Bluetooth AVRCP, Wake Lock físico,
lockscreen iOS real— se marca **🔍 REQUIERE PRUEBA FÍSICA** con pasos exactos: **las hace el
usuario en el carro**.

## Checklist QA

**Frente A — MediaSession**
1. `navigator.mediaSession.metadata` se setea al cambiar de pista (title/artist/album/artwork);
   `playbackState` sigue a `isPlaying`.
2. Handlers cableados: play, pause, previoustrack, nexttrack, seekto, seekbackward, seekforward,
   stop — cada uno con guard + try/catch.
3. `setPositionState` con guards (duration finito >0, position ≤ duration); omitido en el
   arranque de pista; **no** toca el reloj del karaoke.
4. **Token rotation:** al forzar un 401/reauth, la metadata se re-emite con URL fresca; en el
   hueco `token=null` no se manda `?token=null`.
5. 🔍 FÍSICA: metadata + carátula + botones del volante en Bluetooth/CarPlay/AA; scrubber del
   lockscreen se mueve en background (iOS).

**Frente C — Responsivo**
6. Las 11 resoluciones de la matriz: **sin scroll horizontal**, sin solapamientos, type legible.
7. Cruce de los regímenes (portrait ↔ landscape ↔ short ↔ ultrawide): sin saltos ni elementos
   cortados; el reflow ocurre por `@media`, el escalado por `clamp`.
8. `667×375` (el hostil): todo cabe sin scroll; controles en 1 fila; arte de fondo.

**Frente B — Modo Auto**
9. **Targets ≥ 64px** en todos los controles del modo; ≤ 5 elementos; cero scroll.
10. **Supresión:** con el modo activo NO hay expandido/Letra/Info/campanita montados; al entrar
    se resetearon esos estados; el toast (si aparece) queda encima.
11. **Entrada/salida:** toggle explícito entra y sale; Esc sale; el estado persiste en
    localStorage; landscape NO auto-activa (a lo sumo sugiere con tap).
12. **Wake Lock:** guard `'wakeLock' in navigator` **antes** de tocarla; con soporte se pide al
    entrar / libera al salir / re-adquiere tras `visibilitychange`; **sin soporte el modo entra
    igual** (no lanza, no bloquea la entrada).
13. **Karaoke degradado:** solo línea activa estática, sin scroll ni auto-follow ni tap-seek;
    OFF por defecto.
14. **reduced-motion:** transiciones del modo anuladas, colores/contraste intactos.
15. **Desktop/app no rotos** (Player.jsx y PlayerContext compartidos): reproducción, gestos,
    tooltips, volumen, navegación intactos con el Modo Auto inactivo.

**Compatibilidad (transversal)**
16. **Piso Chrome real:** cada `clamp()`/`env()` de la capa car tiene fallback estático donde
    haga falta; `dvh` con fallback `vh`; nada estructural depende de container queries; y el
    `build.target` de Vite cubre el Chrome de los head units objetivo (si es <87, `plugin-legacy`
    pactado aparte). Ver §Compatibilidad de APIs.
