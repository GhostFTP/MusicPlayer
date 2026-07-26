---
name: mobile-lab
description: Estándar móvil de SonoraRev (breakpoints, safe-areas iOS, touch targets, gestos del expandido con su física real, quirks conocidos, reduced-motion y checklist QA móvil). Úsala SIEMPRE antes de tocar o auditar gestos, media queries o layout móvil (Player.jsx, main.css).
---

# Mobile Lab — estándar móvil de SonoraRev

Fuente de verdad de la experiencia móvil y de los gestos. Antes de opinar o
tocar, **inspeccioná los archivos reales** — este mapa dice dónde vive cada cosa
y qué NO se puede romper.

> **Sobre las referencias:** este mapa ancla en **constantes, estados y selectores**, no en
> números de línea. Las líneas se mueven y envejecen mal: la versión previa de esta skill
> citaba `.player-expanded` en ~1791 cuando vive en ~2882, y hablaba de un "bloque móvil
> maestro" que no existe. Buscá por nombre.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/components/Player.jsx` | TODA la maquinaria de gestos (Pointer Events) y el estado del expandido. **Tres** gestos, no dos (ver §Gestos). Constantes de física agrupadas arriba del componente (`DIST_THRESH`/`VEL_THRESH`/`RUBBER_LIMIT`, `CLOSE_DIST`/`CLOSE_VEL`/`CLOSE_MIN`, `AXIS_DIST`/`AXIS_DOM`, `DRAWER_*_VH`). Handlers por prefijo: `onArt*` (carátula), `onSheet*` (cierre del expandido), `onQueueDrag*` (hoja de la cola, móvil), `onGrabber*` (drawer desktop) |
| `music-client/src/styles/main.css` | Media queries, safe-areas, touch-action, ramas reduced-motion. **No hay un bloque móvil único**: hay ~8 `@media (max-width: 700px)` repartidos por componente (barra, expandido, drawer, layout, campanita…). Buscá el selector, no el bloque |
| `music-client/index.html` | `<meta … viewport-fit=cover />` (línea 5). El `viewport-fit=cover` **ya está** — es lo que habilita `env()` en iOS |
| `.claude/tools/snap/snap.mjs` | Verificación visual headless (ver §Snapshots) |

## Arquitectura del expandido móvil (v1.9.0)

El expandido dejó de ser "una pantalla" y pasó a ser **dos zonas**: el bloque de la canción
arriba y un **drawer** abajo. Entenderlo es requisito para tocar cualquier cosa acá.

**Estado, todo en `Player.jsx`:**

| Estado | Qué es |
|---|---|
| `expanded` | el expandido está montado |
| `expPanel` | `'none' \| 'queue' \| 'lyrics'` — **qué drawer está abierto**. Es el eje del rediseño: un solo drawer, nunca dos |
| `expDrawerSize` | `'small' \| 'large'` — cuál de los **dos altos declarados** rige |
| `qSheet` / `qDragY` | fase y desplazamiento del gesto de la hoja **en móvil** (`idle \| drag \| snap \| closing`) |
| `drawerH` / `drawerDragging` | alto en vivo del grabber **en desktop**. No se mezcla con lo de arriba |
| `isMobile` | **estado, no una lectura suelta**: `matchMedia('(max-width: 700px)')` con listener, así que cruzar el breakpoint **con el drawer abierto** cambia de geometría sin recargar |

El corte es **≤700px móvil / ≥701px desktop**, en CSS y en JS (no hay ningún `max-width: 701px`
en `main.css`; el JS usa el mismo `(max-width: 700px)`).

`expBigDrawer = isMobile && expPanel !== 'none' && expDrawerSize === 'large'` es lo que cuelga
la clase `.exp-drawer-large` en `.player-expanded`.

**Geometría — una sola línea la gobierna.** Los tokens viven en el `@media (max-width:700px)`
del expandido: `--exp-header-h` 140px, **`--exp-song-h` 316px** / **`--exp-song-h-large` 172px**,
`--exp-drawer-gap` 12px. El `top` de la hoja se **calcula**:

```
top: calc(max(env(safe-area-inset-top), 20px) + --exp-header-h + --exp-song-h + --exp-drawer-gap)
```

y `.player-expanded.exp-drawer-large { --exp-song-h: var(--exp-song-h-large) }` hace **todo** el
intercambio de tamaño. Por eso el alto del bloque y el borde de la hoja **no pueden**
desincronizarse: salen del mismo token.

> ⚠️ **El token `--exp-compact-h` ya no existe.** v1.9.0 lo renombró a `--exp-song-h` porque
> ahora tiene dos valores y el nombre viejo describía sólo uno. Si ves ese nombre en un doc o
> en una instrucción, está desactualizado.

**La cola es UNA sola entrada.** El overlay full-screen viejo (`showQueue`) se retiró de móvil:
`showQueue` **ya sólo existe en desktop** (la columna lateral). En el teléfono, tanto el botón
de la mini barra (`openQueueMobile`) como el del header del expandido (`toggleExpPanel('queue')`)
llevan **al mismo drawer**. `openQueueMobile` es un **lanzador, no un toggle**: apaga la Letra,
fija `expDrawerSize='small'`, monta el expandido y abre el panel — al abrir, el expandido tapa
la mini barra, así que no hay nada que "des-togglear". Como entra por `expPanel`, hereda gratis
la escalera `dismissTop` de nav-lab (cierra `expPanel` **antes** que `expanded`) y el guardia de
historial, sin peldaño nuevo. **Ningún `history.back()`**: todos los cierres son `setState`.

## Breakpoints y layout

- **≤700px = móvil** (repartido en varios bloques por componente): `body { overflow: hidden }`,
  grid de 3 filas `1fr / var(--mini-player-h) / var(--bottom-nav-h)`, sidebar
  oculta. La barra completa se vuelve **mini player** (64px) + **bottom nav** (60px).
  El grid de `.layout` (y `.login-page`) usa **`height: 100dvh`** con fallback
  `height: 100vh` en la línea previa (progressive enhancement): con toolbar del
  navegador (Safari iOS, Chrome Android, HiBy R4) el `100vh` medía el viewport
  GRANDE y tapaba el bottom-nav; el `dvh` (dinámico) lo corrige y el `vh` queda de
  respaldo para navegadores viejos. La fila `1fr` absorbe el cambio de alto.
- **≥701px = desktop**: expandido en dos columnas simétricas (carátula | info),
  asas de cierre con `cursor: grab/grabbing` (header, carátula **y** la columna de
  info ambiente — ver Gestos §2).
- **701-1024px = tablet**: sidebar 180px, volumen 56px, metadata trunca.
- **⚠️ El viewport NO es el contenedor.** Las media queries miden el **viewport**, pero la
  columna de cola de desktop roba `--queue-w` (320px) del **contenedor** sin tocarlo. Por eso
  el contenido puede quedar tan apretado como en una ventana chica y ningún `@media` de
  viewport se entera. La solución del proyecto son **dos disparadores duplicados** (no hay
  container queries): `(max-width: 1024px)` **y** `.layout--queue @ (max-width: 1344px)`, con
  **1344 = 1024 + 320**. Si cambia `--queue-w`, **hay que recalcular ese 1344 a mano**
  (documentado en `main.css:682-686`). Este fue el bug que costó varios intentos: se veía
  "roto a 960px" y el @media de 1024 no disparaba porque el viewport eran 960 + cola.
- **≤700px y ≤680px de alto**: rama compacta del expandido.
- `@media (hover: none)`: acciones que en desktop aparecen al hover
  quedan siempre visibles en táctil.
- Tokens: `--player-h: 80px`, `--mini-player-h: 64px`, `--bottom-nav-h: 60px`.
  z-index canónico: barra (sin z) < campanita 150 < expandido 200 < Letra 250 <
  popovers de barra 260 (`--z-bar-popover`) < Info 300 < toast 400.

## Safe-areas iOS (notch / home indicator)

`viewport-fit=cover` **está** en el meta (`index.html:5`), así que `env()` actúa en iOS.
Hoy hay **~23 usos** en `main.css` (creció fuerte en v1.9.0, que sumó los laterales —
`inset-left/right` — que el proyecto no contemplaba en ningún lado). Los principales:

- `.player-expanded`: `padding-top: max(env(safe-area-inset-top), 20px)`.
- **Drawer de cola móvil**: `.exp-drawer .queue-header` / `.queue-body` (laterales e inferior),
  y el `top` de la hoja lo **calcula** sumando el inset:
  `calc(max(env(...-top), 20px) + --exp-header-h + --exp-song-h + --exp-drawer-gap)`.
- `.bottom-nav`: `padding-bottom: env(safe-area-inset-bottom, 0px)`, y el grid de `.layout`
  engorda su fila con `calc(--bottom-nav-h + env(...-bottom, 0px))`. **Ya lleva `env()`** —
  el dato viejo de que "no lo lleva" quedó obsoleto.
- `.lyrics-panel`, `.changelog-bell`, `.settings-fab`.

### Los dos mundos de `env()` (regla dura)

**En emulación —DevTools device mode y navegador headless— `env(safe-area-inset-*)` vale 0.**
Los valores reales sólo existen en hardware con notch. Por eso el patrón del proyecto es
**siempre `max(env(...), Npx)`, nunca `env()` pelado**: el piso `N` es lo que se ve en
emulación y en teléfonos sin notch, y el inset gana sólo donde de verdad hay recorte.

Consecuencias prácticas:
- Un layout que se ve bien en DevTools está validado **sólo en la rama del piso**. La rama
  con notch —donde el inset supera a `N`— **cambia el presupuesto de alto** (ver el `top`
  calculado de la hoja, arriba) y **no se puede verificar sin teléfono**.
- Al elegir el piso `N`, que funcione en **los dos** mundos: ni tan chico que el contenido
  quede pegado al borde sin notch, ni tan grande que sume al inset y desperdicie alto.
- El notch es **🔍 PRUEBA FÍSICA** por definición. No hay atajo.

## Patrones de layout (lecciones caras, no reabrir)

### 1. Alto DECLARADO, no presupuesto

Cuando dos bloques compiten por el alto en una caja con `overflow: hidden`, **perder la
pelea no es apretarse: es recortarse** (carátula cortada al medio, controles que
desaparecen). Pasó al abrir la cola en móvil: el intento M1b fue "el expandido achicado"
—que el contenido se acomode a lo que sobre— y falló. La solución (M1c) es al revés:

> El bloque de la canción tiene **alto FIJO declarado** (`--exp-song-h`) y la hoja toma
> **exactamente el resto** (`top` calculado, `bottom: 0`). Sin auto-margins y sin cuentas
> que puedan fallar, el recorte deja de ser posible **por construcción**.

Corolarios:
- Los dos tamaños de la hoja son **dos altos declarados** (`--exp-song-h` 316px /
  `--exp-song-h-large` 172px), no un cálculo. `.exp-drawer-large` redefine el token y de ahí
  cuelga **toda** la geometría → el alto del bloque y el borde de la hoja no pueden
  desincronizarse.
- Si algo no entra en el alto declarado, **se oculta** (con la hoja abierta se van calidad,
  tiempos y género). Dejarlos entrar exigiría permitir que el subtítulo envuelva, que es lo
  único que rompería el determinismo.
- Verificá la holgura del alto declarado **con el contenido más largo**, no con el promedio.

### 2. Tabla → lista bajo umbral de ancho

Cuando el ancho aprieta, las tablas de pistas **reflowean a modo lista** (`display: block`
en la tabla, `.track-row` a flex, celda de título `flex: 1; min-width: 0`, truncado con
`…`) — el mismo patrón que la fila de la cola. Rige en las 4 vistas (Álbum, Género,
Playlists, Biblioteca) **y en móvil**.

**NO compactar escondiendo columnas sobre `table-layout: fixed`.** Es lo que había antes y
es un bug: a ancho chico los anchos de las columnas ocultas **no se reclaman limpio**, así
que el Título colapsaba al ancho de la carátula, y el chip de calidad inline
(`flex-shrink: 0` + `nowrap`, sin ancestro que lo recorte) **desbordaba sobre la duración**.
El modo lista escapa de `fixed` y por eso arregla las dos cosas de una.

Trade aceptado: **en modo lista no se muestra la calidad** — se consulta desde Info.

## Touch targets

Piso del proyecto: **≥44px** en controles primarios táctiles (HIG de Apple).
Referencias reales: `.exp-btn` 48×48, campanita móvil 40×40 (por debajo del piso, conocido).

Los botones del **expandido** y de la **Letra** cumplen el piso con dos técnicas:
- **Hit-area transparente vía `::before`** (no infla el glifo ni el footprint
  visual, clave donde el ancho escasea): `.exp-icon-btn` (Letra/Info) mantiene su
  círculo de 40px pero el `::before { inset: -2px }` lleva el área táctil a 44
  (48 en desktop, donde el círculo ya es 44); el "+" del expandido `.ptp-exp
  .ptp-btn` mantiene 30px de círculo con `::before { inset: -7px }` → 44 táctiles.
  El `pointerdown` sobre el `::before` tiene `target=botón`, así que el guard
  `closest('button')` del gesto de cierre lo sigue excluyendo (no arranca swipe).
- **Caja a 44 directa** donde hay aire: `.lyrics-close` / `.lyrics-toggle` pasaron
  de 36×36 a **44×44** (glifos siguen a 20px; el título del header trunca).

## Gestos del expandido (la física REAL, Player.jsx)

Hoy hay **tres** gestos en móvil (carátula, cierre del expandido, hoja de la cola) más el
grabber del drawer en desktop. Todos comparten patrón: **Pointer Events con capture**
(`setPointerCapture` en el down), **eje por distancia + dominancia**
(`AXIS_DIST` 12px y `AXIS_DOM` 1.3×: gana el primer eje que alcanza 12px con
dominancia 1.3× sobre el perpendicular; mientras nadie gana se **re-evalúa en
cada move**, sin candados terminales — el jerk lateral de un click de mouse es
transitorio y pierde), **re-base al fijar el eje** (el offset renderizado
arranca en 0, sin salto; los UMBRALES del up se siguen midiendo desde el origen
del down → mismos px físicos), **velocidad suavizada** `v = v*0.7 + inst*0.3`
(px/ms, re-anclada al punto del fijado), y **cancelación limpia**
(`pointercancel` + `lostpointercapture` + blur de ventana → nunca a medias).
Los down excluyen controles:
`e.target.closest('button, a, input, [role="button"]')`, y cancelan los timers
de return pendientes (`sheetReturnTimer`/`artReturnTimer`) — un reintento
rápido tras un rebote no se congela.
Desde v1.4.2 la maquinaria es **una sola para táctil y mouse** (sin gate por
`pointerType`).

### 1. Swipe horizontal de carátula → cambiar de pista

- Handlers en `.exp-art-wrap`.
- Umbrales: `DIST_THRESH` 80px **o** flick `VEL_THRESH` 0.5 px/ms con mínimo
  `MIN_FLICK` 36px y signo coherente.
- **Rubber-band**: seguimiento 1:1 hasta `RUBBER_LIMIT` 120px, después
  resistencia progresiva factor 0.28 (`rubber()`), sin tope duro. Feedback:
  rotación ±6° y fade sutil durante el drag.
- Salida `DUR_OUT` 250ms; entrada `DUR_IN` 320ms (keyframe `exp-card-in`,
  coincide con el CSS). Vuelta si no llega: `springBack()`.

### 2. Swipe-down → cerrar el expandido

- **Zonas de agarre** (deliberadamente amplias — la queja era "hay que apuntar"):
  1. `.exp-header` (`onSheetPointerDown` en el JSX; en móvil franja ampliada a
     `min-height: 140px` —era 100—, en la compacta ≤680px de alto baja a 92px; en
     desktop franja full-bleed `min-height: 96px` dentro de `@media (min-width:
     701px)` — los márgenes negativos absorben el padding del overlay y el padding
     interno repone la posición exacta del botón ⌄).
  2. La **carátula** `.exp-art-wrap` (rama `dir='close'` de `onArtPointerMove`
     cuando el eje sale vertical hacia abajo). En móvil lleva `padding: 24px 0`
     (8px en la compacta) → un **halo agarrable** arriba/abajo de la imagen, con
     los mismos handlers: horizontal = cambiar pista, abajo = cerrar. La imagen no
     cambia de tamaño (ancho fijo, centrada); sólo crece la superficie tocable.
  3. **Sólo desktop**: la **columna de info ambiente** `.exp-col-info`
     (`onInfoPointerDown`, gateado a `min-width: 701px` en JS → inerte en móvil,
     donde es `display:contents`). Se estira a todo el alto de la fila con el
     contenido centrado (misma posición visual), así el espacio vacío arriba/abajo
     y los huecos entre bloques **cierran** al arrastrar hacia abajo. **No cambia
     de pista** (reusa los sheet handlers, no los de la carátula). Reusa el guard
     compartido de `onSheetPointerDown`, extendido a
     `button, a, input, [role="button"], .exp-meta, .exp-times`: excluye botones,
     sliders (seek/volumen), enlaces (título/artista/género) y el bloque de texto
     → sólo el ambiente arrastra, el texto sigue seleccionable/clickeable.
- Umbrales: `CLOSE_DIST` 120px **o** flick `CLOSE_VEL` 0.55 px/ms con mínimo
  `CLOSE_MIN` 24px — medidos desde el ORIGEN del down (el re-base solo mueve el
  offset renderizado, no el feel físico).
- Seguimiento **1:1 hacia abajo** (`setDragY(max(0, clientY − by))`, sin
  rubber). El sheet se mantiene **OPACO**; el fade honesto lo pone el scrim
  `.exp-scrim` de atrás (hermano ANTERIOR en el DOM, mismo z 200,
  `pointer-events: none`, comparte el `{expanded && …}` → nunca huérfano), que
  se aclara con el progreso (`1 − dragY/(h·0.9)`). Affordance de sheet nativo:
  radio progresivo en las esquinas superiores (`min(24, dragY·0.5)` → máximo a
  ~48px) + hairline y sombra hacia arriba (`SHEET_EDGE`).
- **Snap-back** bajo el umbral: spring `cubic-bezier(.34,1.42,.6,1)` con
  duración proporcional a lo recorrido (`DUR_BACK_MIN` 180 – `DUR_BACK_MAX`
  360ms). Los timers de vuelta viven en refs identificables
  (`sheetReturnTimer`/`artReturnTimer`, fuera de la bolsa `timers`) y cada
  pointerdown los cancela.
- **Cierre con momentum**: duración = distancia restante / velocidad del gesto,
  clamp `DUR_CLOSE_MIN` 160 – `DUR_CLOSE` 300ms, curva ease-out
  `cubic-bezier(.22,1,.36,1)` hasta `window.innerHeight`, y recién ahí se
  desmonta. Las duraciones en curso viajan por `closeDurRef`/`backDurRef`
  (las escriben `closeSheet()`/`sheetBack()`, las leen `sheetStyle()`/
  `scrimStyle()`).
- Estados del sheet: `idle | drag | return | closing`.

### 3. Arrastre de la hoja de la cola (MÓVIL) → cerrar / dos tamaños

Handlers `onQueueDrag{Down,Move,Up}`, estado propio (`qSheet`/`qDragY`), **separado del sheet
del expandido**: son dos superficies distintas y mezclarlas fue justo lo que no se hizo.

- **Dos sentidos.** Hacia abajo cierra o baja un escalón; hacia arriba estira a `large`. Al
  soltar hay **tres destinos**: `close` / `small` / `large`.
- **Dos mecanismos, y la razón importa.** La hoja está anclada abajo, así que moverla con
  `transform` arrastra las dos aristas: sirve para **bajarla** (la base sale de pantalla y el
  `overflow` la recorta), pero al **subirla** despegaría la base del borde inferior y dejaría un
  hueco. Por eso estirar es **crecer de alto con la base clavada**. En `dy = 0` las dos dan la
  misma imagen → la discontinuidad es de mecanismo, no visual. Costo: el modo alto toca layout
  por frame, igual que el grabber de desktop.
- **Umbrales derivados, no escritos.** La frontera chica↔grande es el **punto medio entre los
  dos altos reales**, leídos del CSS con `parseFloat` sobre los tokens (`g.delta`); cerrar exige
  pasarse `CLOSE_DIST` por debajo de "chica". Recalibrar las alturas **no** obliga a tocar el
  gesto, y si no se pudieran leer, estirar queda inerte y el gesto degrada al cierre simple —
  nunca a algo roto. **La velocidad manda sobre la posición**: un flick mueve un escalón.
- **El commit del tamaño no salta**: se anima hasta el destino y recién al terminar se aplica el
  tamaño limpiando el estilo inline, con la imagen idéntica en ese frame. La composición de la
  canción cambia ahí, **no** a mitad del arrastre.
- Cancelación limpia por `cancelQueueDrag()`: vuelve al tamaño en el que estaba, sin cambiarlo.
- `prefers-reduced-motion` resuelve al instante.

### Guard: carátula vs. hoja abierta (no quitarlo)

Con la hoja de la cola abierta en móvil, la rama de **cierre** del swipe de carátula queda
**inerte**:

```js
if (isMobile && expPanel !== 'none') return;   // en onArtPointerMove, antes de dir='close'
```

Sin esto, un swipe-down sobre la carátula cerraría el expandido **entero con la cola encima** —
"cierro todo de un manotazo"—, violando el orden de la escalera de nav-lab (primero lo de más
arriba: `expPanel` antes que `expanded`).

Dos sutilezas que hay que preservar si se toca:
1. **Sale sin fijar eje.** No marca un eje muerto, así que el gesto sigue vivo y puede resolverse
   como **horizontal** — cambiar de canción con la cola abierta tiene que seguir funcionando.
2. **Gateado a móvil.** En desktop el drawer es otra cosa y su comportamiento no se toca.

El asa del **header** sigue cerrando el expandido como siempre: es la superficie correcta para eso.

### Defensas anti-conflicto (no quitarlas)

- `touch-action: none` en `.exp-art-wrap` y `.exp-header` móvil
  y desktop: sin esto el navegador reclama el pan vertical y
  mata el gesto con `pointercancel`.
- `touch-action: manipulation` en la barra mini: sin delay de doble-tap.
- `draggable={false}` en el `<img>` de la carátula: evita el
  drag nativo de imagen con mouse.
- `user-select: none` en `.exp-header`: es un asa, no texto seleccionable.
- `.player-expanded`: en **desktop** `overflow-y: auto` (si no cabe, scrollea). En **móvil**
  pasó a `overflow: hidden` (v1.9.0): sin eso la hoja de la cola se va con el scroll y,
  estacionada fuera de vista, agrega scroll fantasma. `position: fixed` **no** era opción —
  `.player-expanded` recibe un `transform` durante el swipe-down y un ancestro transformado
  se vuelve el bloque contenedor de los `fixed`. Con la hoja abierta el `hidden` no puede
  morder porque rige el alto declarado (ver Patrones §1); con la hoja cerrada, en pantallas
  muy bajas el contenido se recorta en vez de scrollear — lo mitiga la rama de ≤680px de alto.

## Quirks conocidos (reglas duras)

1. **iOS: `audio.volume` es de SOLO LECTURA** desde el navegador. Por eso
   `.exp-volume { display: none }` en ≤700px y el volumen no existe en
   la barra móvil. **Regla del proyecto: NO reintentar controlar el volumen del
   SO desde el navegador móvil** — los botones físicos mandan. Jamás proponer
   "soluciones" a esto.
2. **Prefijos -webkit-**: todo `backdrop-filter` va acompañado de
   `-webkit-backdrop-filter`; los thumbs de sliders usan
   `::-webkit-slider-thumb`.
3. **GPU móvil**: los blurs de fondo bajan en ≤700px (exp-bg 10px, info-bg 8px)
   — mantener ese patrón en fondos nuevos.
4. **`body { overflow: hidden }` en móvil**: la app no scrollea el body; cada
   panel maneja su propio scroll.

## Pendientes conocidos (anotados, sin urgencia — pactar antes de tocar)

1. **Menú "+" del header del expandido vs asa de cierre (móvil)**: `.ptp-list`
   tiene `overflow-y: auto` pero cuelga de `.exp-header` con `touch-action:
   none` → con 6+ playlists la lista no scrollearía con el dedo, y arrastrar
   desde zonas no-botón del menú arrastra el sheet con el menú abierto. Fix
   pactable: `.ptp-menu { touch-action: pan-y }` + sumar `.ptp-menu` al
   `closest()` del guard del pointerdown. Hoy casi no se nota (biblioteca
   chica).
2. **Ventana de ~280ms al abrir en móvil**: mientras corre `exp-slide-up`
   (.28s) la animación CSS le gana al `transform` inline de `sheetStyle()` →
   un grab inmediatísimo tras abrir no mueve el sheet hasta que termina la
   entrada. Fix si molesta: anular la animación al primer `setSheet('drag')`.

## Reduced-motion

`prefers-reduced-motion` se lee en JS (`reduced`, matchMedia)
y en CSS (ramas `@media (prefers-reduced-motion: reduce)` por sección).
Regla de la casa: **color sí, movimiento no**. En gestos: `sheetBack()` y
`closeSheet()` resuelven AL INSTANTE (sin animación — el momentum y el scrim
ni entran en juego); el snap y el cierre de la **hoja de la cola** también; la entrada del
expandido (`exp-slide-up`, solo móvil) se anula. El seguimiento del dedo durante el drag NO se
suprime (es interacción directa, no animación).

## Entorno de QA (limitación conocida)

**No hay dispositivos reales en este entorno.** El QA móvil cubre **código +
DevTools** (device mode, emulación táctil, throttling, emulate
prefers-reduced-motion). Todo lo que exija hardware real (haptics, safe-areas
reales, Safari iOS de verdad, performance táctil) se marca **🔍 REQUIERE PRUEBA
FÍSICA** con pasos exactos — las hace Oscar en sus dispositivos.

### Snapshots headless (`.claude/tools/snap/`)

Existe tooling propio para **mirar el layout en vez de razonarlo**. Cierra el hueco de
"razonado, no probado", que es de donde salen las vueltas.

```
# Requisitos: backend en :3000 y Vite levantado (¡ojo el puerto!, ver abajo)
cd .claude/tools/snap

node snap.mjs                              # vista por defecto (un álbum de 32 pistas)
node snap.mjs "/albums/Artista/Album"       # cualquier ruta del Modelo 2
npm run snap                                # idéntico a `node snap.mjs`
npm run snap -- "/albums/Artista/Album"     # con ruta, vía npm (ojo el `--`)

SNAP_BASE=http://localhost:5174 node snap.mjs   # si Vite no quedó en 5173
npm run setup                                   # reinstalar deps + binario de Chromium
```

**No hay flags.** La ruta es un **argumento posicional** (`process.argv[2]`); no existen
`--width` ni `--view`: los tres anchos son fijos y salen siempre los tres juntos. Lo único
configurable va por **variables de entorno**: `SNAP_BASE`, y las credenciales.

Toma los **tres regímenes** de una y deja un PNG por cada uno en `shots/` (gitignorada):
**390** (contexto `isMobile`+`hasTouch`, no un viewport achicado) · **960 + cola abierta**
(el caso del breakpoint de contenedor) · **1440** (referencia, sin triggers). La cola se abre
con clic real y después se **verifica `.layout--queue` en el DOM** — el clic solo no prueba nada.

Además del PNG mide **flags de layout** en el DOM (overflow horizontal, títulos colapsados o
recortados, chips que se salen de la fila) y reporta el **régimen activo** — el `display` de
`.track-table` dice si el modo lista disparó donde debía. Todo va a `shots/report.json`.

**Sesión:** login normal por `POST /api/auth/login`, con `SNAP_USER` / `SNAP_PASS` en
`.claude/tools/snap/.env` (gitignoreado por la regla `.env` de la raíz). El usuario dedicado es
**`snap@local`**, creado en la DB local con el registro abierto un momento y vuelto a cerrar
(`ALLOW_REGISTRATION`). Alternativa: `SNAP_TOKEN` con un JWT ya emitido — pero **tiene que ser
del backend LOCAL**; uno de producción está firmado con otro secreto y el backend lo rechaza
con 401 aunque el cliente lo acepte y renderice la app (el cliente sólo mira `exp`, no la firma).

**Límites — qué NO valida:**
- **`env(safe-area-*)` = 0** (ver §Safe-areas): sólo cubre la rama del piso, nunca la del notch.
- **Gestos táctiles reales**: arrastre del grabber, flicks, física del snap.
- **`100dvh` con toolbar dinámica** de Safari/Chrome móvil: en headless el dvh es estático.

Todo eso sigue siendo **🔍 PRUEBA FÍSICA**.

**Trampa del puerto (pasó de verdad):** Vite no usa `strictPort`, así que si 5173 está
ocupado por otro proyecto se corre al 5174 **y sólo lo dice en su log**. El script tiene un
preflight que verifica `<title>SonoraRev</title>` antes de abrir el navegador; sin eso, las
capturas salían del 404 de la otra app **sin un solo error de red**.

## Checklist QA móvil

1. **Viewports de referencia** (DevTools o `snap.mjs`): 390×844 (iPhone), 360×800 (Android
   chico), 768×1024 (tablet → rama 701-1024). Sin scroll horizontal en ninguno.
2. **Cruce del breakpoint 700/701**: sin saltos raros ni elementos duplicados
   (mini barra vs barra completa, volumen que aparece/desaparece).
3. **Ancho de CONTENEDOR, no sólo de viewport**: probar **960px con la cola abierta** —
   dispara `.layout--queue @ 1344` aunque ningún @media de viewport lo haga. Que la tabla
   reflowee a lista, el título no colapse y ningún chip desborde sobre la duración.
4. **Safe-areas**: header del expandido bajo el notch, campanita bajo el notch, mini
   barra/bottom-nav vs home indicator (hoy **sí** llevan `env()`). Recordá que en emulación
   `env()` = 0: eso valida el piso, **no** el notch → 🔍 PRUEBA FÍSICA.
5. **Touch targets ≥44px** en controles primarios del flujo de reproducción
   (incluye Letra/Info y "+" del expandido —hit-area por `::before`— y
   `.lyrics-close`/`.lyrics-toggle` a 44×44).
6. **Swipe horizontal**: cambia pista a 80px o flick 0.5; rubber después de
   120px; snap-back si no llega; NUNCA arranca sobre un botón. Sigue funcionando
   en la carátula incluida su nueva banda de `padding` (halo) arriba/abajo.
7. **Swipe-down**: sigue el dedo 1:1 sin salto en el primer frame; cierra a
   120px o flick 0.55 (medidos desde el down); el cierre continúa la velocidad
   del flick (momentum, 160-300ms); snap-back con spring proporcional bajo el
   umbral; funciona desde header (franja 140px móvil / 96px desktop), carátula
   (+ halo) Y —sólo desktop— la columna de info ambiente (`.exp-col-info`, sólo
   cierra, sin cambiar pista, sin capturar texto/enlaces/sliders/botones);
   reintentar el gesto justo tras un rebote no se congela; el scrim se aclara al
   bajar y nunca intercepta eventos.
8. **Drawer de la cola (móvil)**: se abre igual desde la mini barra que desde el header del
   expandido, y **es el mismo** (no queda rastro del overlay full-screen). La canción sigue
   visible arriba. Arrastrar la hoja hacia abajo la achica o la cierra; hacia arriba la estira
   y la canción pasa a su composición compacta — **sin recortes** en ninguno de los dos
   tamaños, con el título más largo de la biblioteca. Con la hoja abierta, el swipe-down sobre
   la **carátula** NO cierra todo, pero el swipe **horizontal** sigue cambiando de canción.
   Esc / atrás cierran primero la hoja y después el expandido.
9. **Gesto vs scroll**: `touch-action` presente en las zonas de agarre; el
   scroll interno de paneles (Letra, Info, sheet con contenido largo) no pelea
   con los gestos.
10. **Volumen móvil**: control ausente en ≤700px; nada intenta setear
   `audio.volume` como UX principal en móvil.
11. **reduced-motion**: cierre/rebote instantáneos, sin `exp-slide-up`, colores y
    estados intactos.
12. **Desktop no roto** (Player.jsx es compartido): drag de cierre con mouse,
    swipe horizontal con mouse, cursor grab/grabbing, clicks/seek/volumen
    intactos tras cualquier cambio de gesto.
