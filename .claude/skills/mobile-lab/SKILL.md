---
name: mobile-lab
description: Estándar móvil de SonoraRev (breakpoints, safe-areas iOS, touch targets, gestos del expandido con su física real, quirks conocidos, reduced-motion y checklist QA móvil). Úsala SIEMPRE antes de tocar o auditar gestos, media queries o layout móvil (Player.jsx, main.css).
---

# Mobile Lab — estándar móvil de SonoraRev

Fuente de verdad de la experiencia móvil y de los gestos. Antes de opinar o
tocar, **inspeccioná los archivos reales** — este mapa dice dónde vive cada cosa
y qué NO se puede romper. Los números de línea son orientativos (el código se
mueve); las constantes y selectores son el ancla.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/components/Player.jsx` | TODA la maquinaria de gestos (Pointer Events): swipe horizontal de carátula (cambiar pista) y swipe-down de cierre del expandido. Constantes de física ~líneas 63-99; handlers de carátula ~290-360; handlers del sheet ~416-462; estilos del sheet/scrim ~465-510 |
| `music-client/src/styles/main.css` | Media queries, safe-areas, touch-action, ramas reduced-motion. Bloque móvil maestro `@media (max-width: 700px)` ~2560; desktop del expandido `@media (min-width: 701px)` ~2057; tablet 701-1024 ~2735; scrim del cierre `.exp-scrim` ~1796 |
| `music-client/index.html` | `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` (línea 5). El `viewport-fit=cover` **ya está** — es lo que habilita `env()` en iOS |
| `.claude/tools/snap/snap.mjs` | Verificación visual headless (ver §Snapshots) |

## Breakpoints y layout

- **≤700px = móvil** (bloque maestro ~main.css:2525): `body { overflow: hidden }`,
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
- **701-1024px = tablet** (~2701): sidebar 180px, volumen 56px, metadata trunca.
- **⚠️ El viewport NO es el contenedor.** Las media queries miden el **viewport**, pero la
  columna de cola de desktop roba `--queue-w` (320px) del **contenedor** sin tocarlo. Por eso
  el contenido puede quedar tan apretado como en una ventana chica y ningún `@media` de
  viewport se entera. La solución del proyecto son **dos disparadores duplicados** (no hay
  container queries): `(max-width: 1024px)` **y** `.layout--queue @ (max-width: 1344px)`, con
  **1344 = 1024 + 320**. Si cambia `--queue-w`, **hay que recalcular ese 1344 a mano**
  (documentado en `main.css:682-686`). Este fue el bug que costó varios intentos: se veía
  "roto a 960px" y el @media de 1024 no disparaba porque el viewport eran 960 + cola.
- **≤700px y ≤680px de alto** (~2686): rama compacta del expandido.
- `@media (hover: none)` (~637, ~806): acciones que en desktop aparecen al hover
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
Referencias reales: `.exp-btn` 48×48 (~2695), campanita móvil 40×40 (~2756 — por
debajo del piso, conocido).

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

Los dos gestos comparten patrón: **Pointer Events con capture**
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

- Handlers en `.exp-art-wrap` (~Player.jsx:703-710).
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

### Defensas anti-conflicto (no quitarlas)

- `touch-action: none` en `.exp-art-wrap` (~1904) y `.exp-header` móvil
  (~2595) y desktop (~2077): sin esto el navegador reclama el pan vertical y
  mata el gesto con `pointercancel`.
- `touch-action: manipulation` en la barra mini (~2585): sin delay de doble-tap.
- `draggable={false}` en el `<img>` de la carátula (~Player.jsx:712): evita el
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
   `.exp-volume { display: none }` en ≤700px (~2583) y el volumen no existe en
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

`prefers-reduced-motion` se lee en JS (`reduced`, matchMedia en ~Player.jsx:134)
y en CSS (ramas `@media (prefers-reduced-motion: reduce)` por sección).
Regla de la casa: **color sí, movimiento no**. En gestos: `sheetBack()` y
`closeSheet()` resuelven AL INSTANTE (sin animación — el momentum y el scrim
ni entran en juego); la entrada del expandido (`exp-slide-up`, solo móvil
~2589) se anula (~1894). El seguimiento del dedo durante el drag NO se suprime
(es interacción directa, no animación).

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
# backend en :3000 y Vite levantado (¡ojo el puerto!, ver abajo)
cd .claude/tools/snap && node snap.mjs                 # vista por defecto
cd .claude/tools/snap && node snap.mjs "/albums/Artista/Album"
SNAP_BASE=http://localhost:5174 node snap.mjs          # si Vite no quedó en 5173
```

Toma los **tres regímenes** de una y deja un PNG por cada uno en `shots/` (gitignorada):
**390** (contexto `isMobile`+`hasTouch`, no un viewport achicado) · **960 + cola abierta**
(el caso del breakpoint de contenedor) · **1440** (referencia, sin triggers). La cola se abre
con clic real y después se **verifica `.layout--queue` en el DOM** — el clic solo no prueba nada.

Además del PNG mide **flags de layout** en el DOM (overflow horizontal, títulos colapsados o
recortados, chips que se salen de la fila) y reporta el **régimen activo** — el `display` de
`.track-table` dice si el modo lista disparó donde debía. Todo va a `shots/report.json`.

Credenciales en `.claude/tools/snap/.env` (gitignoreado), usuario dedicado `snap@local`.

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
8. **Gesto vs scroll**: `touch-action` presente en las zonas de agarre; el
   scroll interno de paneles (Letra, Info, sheet con contenido largo) no pelea
   con los gestos.
9. **Volumen móvil**: control ausente en ≤700px; nada intenta setear
   `audio.volume` como UX principal en móvil.
10. **reduced-motion**: cierre/rebote instantáneos, sin `exp-slide-up`, colores y
    estados intactos.
11. **Desktop no roto** (Player.jsx es compartido): drag de cierre con mouse,
    swipe horizontal con mouse, cursor grab/grabbing, clicks/seek/volumen
    intactos tras cualquier cambio de gesto.
