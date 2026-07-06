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
| `music-client/src/components/Player.jsx` | TODA la maquinaria de gestos (Pointer Events): swipe horizontal de carátula (cambiar pista) y swipe-down de cierre del expandido. Constantes de física ~líneas 61-76; handlers de carátula ~241-293; handlers del sheet ~345-397 |
| `music-client/src/styles/main.css` | Media queries, safe-areas, touch-action, ramas reduced-motion. Bloque móvil maestro `@media (max-width: 700px)` ~2525; desktop del expandido `@media (min-width: 701px)` ~2042; tablet 701-1024 ~2701 |
| `music-client/index.html` | `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` (línea 5) |

## Breakpoints y layout

- **≤700px = móvil** (bloque maestro ~main.css:2525): `body { overflow: hidden }`,
  grid de 3 filas `1fr / var(--mini-player-h) / var(--bottom-nav-h)`, sidebar
  oculta. La barra completa se vuelve **mini player** (64px) + **bottom nav** (60px).
- **≥701px = desktop**: expandido en dos columnas simétricas (carátula | info),
  asas de cierre con `cursor: grab/grabbing`.
- **701-1024px = tablet** (~2701): sidebar 180px, volumen 56px, metadata trunca.
- **≤700px y ≤680px de alto** (~2686): rama compacta del expandido.
- `@media (hover: none)` (~637, ~806): acciones que en desktop aparecen al hover
  quedan siempre visibles en táctil.
- Tokens: `--player-h: 80px`, `--mini-player-h: 64px`, `--bottom-nav-h: 60px`.
  z-index canónico: barra (sin z) < campanita 150 < expandido 200 < Letra 250 <
  popovers de barra 260 (`--z-bar-popover`) < Info 300 < toast 400.

## Safe-areas iOS (notch / home indicator)

`env(safe-area-inset-*)` se usa hoy en **exactamente 2 lugares**:

- `.player-expanded` (~1791): `padding: max(env(safe-area-inset-top), 20px) 28px
  max(env(safe-area-inset-bottom), 24px)`.
- `.changelog-bell` móvil (~2754): `top/right: calc(env(safe-area-inset-*) + 14px)`.

La mini barra y el bottom-nav **no** llevan `env()` hoy — si un cambio los toca,
verificar contra home indicator. Ojo: `env()` requiere `viewport-fit=cover` en el
meta viewport para actuar en iOS; el meta actual **no lo trae** (dato, no bug:
decidir con el usuario antes de agregarlo).

## Touch targets

Piso del proyecto: **≥44px** en controles primarios táctiles (HIG de Apple).
Referencias reales: `.exp-actions .exp-icon-btn` 44×44 (~2098), `.exp-btn` 48×48
(~2695), campanita móvil 40×40 (~2756 — por debajo del piso, conocido).

## Gestos del expandido (la física REAL, Player.jsx)

Los dos gestos comparten patrón: **Pointer Events con capture**
(`setPointerCapture` en el down), **eje fijado al primer movimiento >8px**
(zona muerta de indecisión), **velocidad suavizada** `v = v*0.7 + inst*0.3`
(px/ms), y **cancelación limpia** (`pointercancel` + `lostpointercapture` +
blur de ventana → nunca a medias). Los down excluyen controles:
`e.target.closest('button, a, input, [role="button"]')`.
Desde v1.4.2 la maquinaria es **una sola para táctil y mouse** (sin gate por
`pointerType`).

### 1. Swipe horizontal de carátula → cambiar de pista

- Handlers en `.exp-art-wrap` (~Player.jsx:587-593).
- Umbrales: `DIST_THRESH` 80px **o** flick `VEL_THRESH` 0.5 px/ms con mínimo
  `MIN_FLICK` 36px y signo coherente.
- **Rubber-band**: seguimiento 1:1 hasta `RUBBER_LIMIT` 120px, después
  resistencia progresiva factor 0.28 (`rubber()`), sin tope duro. Feedback:
  rotación ±6° y fade sutil durante el drag.
- Salida `DUR_OUT` 250ms; entrada `DUR_IN` 320ms (keyframe `exp-card-in`,
  coincide con el CSS). Vuelta si no llega: `springBack()`.

### 2. Swipe-down → cerrar el expandido

- **Zonas de agarre**: `.exp-header` (~549-554; en móvil franja ampliada a
  `min-height: 100px`, ~css:2561) y la **carátula** (rama `dir='close'` de
  `onArtPointerMove` cuando el eje sale vertical hacia abajo).
- Umbrales: `CLOSE_DIST` 120px **o** flick `CLOSE_VEL` 0.55 px/ms con mínimo
  `CLOSE_MIN` 24px.
- Seguimiento **1:1 hacia abajo** (`setDragY(max(0, dy))`, sin rubber), fade
  `1 − min(0.5, dragY/900)` sobre el overlay `.player-expanded` (`sheetStyle()`).
- **Snap-back** bajo el umbral: spring `.36s cubic-bezier(.34,1.42,.6,1)`.
  **Cierre**: `DUR_CLOSE` 300ms `cubic-bezier(.4,0,.6,1)` hasta
  `window.innerHeight`, y recién ahí se desmonta.
- Estados del sheet: `idle | drag | return | closing`.

### Defensas anti-conflicto (no quitarlas)

- `touch-action: none` en `.exp-art-wrap` (~1889) y `.exp-header` móvil (~2561):
  sin esto el navegador reclama el pan vertical y mata el gesto con
  `pointercancel`.
- `touch-action: manipulation` en la barra mini (~2550): sin delay de doble-tap.
- `draggable={false}` en el `<img>` de la carátula (~Player.jsx:596): evita el
  drag nativo de imagen con mouse.
- `user-select: none` en `.exp-header`: es un asa, no texto seleccionable.
- `.player-expanded` tiene `overflow-y: auto` (~1792): si el contenido no cabe,
  el sheet scrollea — cualquier cambio de gesto debe convivir con eso.

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

## Reduced-motion

`prefers-reduced-motion` se lee en JS (`reduced`, matchMedia en ~Player.jsx:111)
y en CSS (ramas `@media (prefers-reduced-motion: reduce)` por sección).
Regla de la casa: **color sí, movimiento no**. En gestos: `sheetBack()` y
`closeSheet()` resuelven AL INSTANTE (sin animación); la entrada del expandido
(`exp-slide-up`, solo móvil ~2555) se anula (~1879). El seguimiento del dedo
durante el drag NO se suprime (es interacción directa, no animación).

## Entorno de QA (limitación conocida)

**No hay dispositivos reales en este entorno.** El QA móvil cubre **código +
DevTools** (device mode, emulación táctil, throttling, emulate
prefers-reduced-motion). Todo lo que exija hardware real (haptics, safe-areas
reales, Safari iOS de verdad, performance táctil) se marca **🔍 REQUIERE PRUEBA
FÍSICA** con pasos exactos — las hace Oscar en sus dispositivos.

## Checklist QA móvil

1. **Viewports de referencia** (DevTools): 390×844 (iPhone), 360×800 (Android
   chico), 768×1024 (tablet → rama 701-1024). Sin scroll horizontal en ninguno.
2. **Cruce del breakpoint 700/701**: sin saltos raros ni elementos duplicados
   (mini barra vs barra completa, volumen que aparece/desaparece).
3. **Safe-areas**: header del expandido bajo el notch, campanita bajo el notch,
   mini barra/bottom-nav vs home indicator (sabiendo que hoy no llevan `env()`).
4. **Touch targets ≥44px** en controles primarios del flujo de reproducción.
5. **Swipe horizontal**: cambia pista a 80px o flick 0.5; rubber después de
   120px; snap-back si no llega; NUNCA arranca sobre un botón.
6. **Swipe-down**: sigue el dedo 1:1; cierra a 120px o flick 0.55; snap-back con
   spring bajo el umbral; funciona desde header (franja 100px) Y carátula.
7. **Gesto vs scroll**: `touch-action` presente en las zonas de agarre; el
   scroll interno de paneles (Letra, Info, sheet con contenido largo) no pelea
   con los gestos.
8. **Volumen móvil**: control ausente en ≤700px; nada intenta setear
   `audio.volume` como UX principal en móvil.
9. **reduced-motion**: cierre/rebote instantáneos, sin `exp-slide-up`, colores y
   estados intactos.
10. **Desktop no roto** (Player.jsx es compartido): drag de cierre con mouse,
    swipe horizontal con mouse, cursor grab/grabbing, clicks/seek/volumen
    intactos tras cualquier cambio de gesto.
