---
name: compat-lab
description: Compatibilidad iOS/Android del web player de SonoraRev medida desde el navegador (arnés compat-matrix.mjs con Chromium + Pixel 7 y WebKit + iPhone/iPad emulados). Dice qué prueba y qué NO prueba cada perfil, trae el checklist de trampas de iOS y Android y los pasos para lo que sólo se ve en un teléfono real. Úsala antes de afirmar que algo "funciona en iPhone/Android" o de tocar toque, video, audio, safe-areas o inputs.
---

# Compat Lab — compatibilidad iOS/Android desde el navegador

Sirve para contestar con evidencia "¿esto anda en el teléfono?" sin tener el teléfono en la mano, y
para saber **dónde termina** esa evidencia. La regla de la casa: una medición emulada se etiqueta
como emulada, y lo que la emulación no puede ver se manda a probar en un dispositivo real con pasos
exactos. Nunca se escribe "funciona en iOS" por haber pasado en WebKit de Playwright.

Lo táctil y el layout móvil (breakpoints, safe-areas, gestos, long-press) ya están contados en
[`mobile-lab`](../mobile-lab/SKILL.md): esto **no lo repite**, lo mide en más motores. El protocolo
de servidores, base de copia y fixtures es el de la regresión (`perf-lab`, `regresion.mjs`).

## El arnés

`.claude/tools/snap/perf/compat-matrix.mjs` corre los mismos escenarios en cada perfil y saca una
línea por perfil: `compat-<perfil>: N/N` (código de salida 0 / 1 / 2 = no corrió).

```
SNAP_BASE=http://localhost:4173 VIDEO_DIR=<fixtures del backend> \
  node compat-matrix.mjs [--perfil pixel7,iphone15,ipad,desktop-webkit,firefox] [--escenario a,b,c,d,e,f,g,h]
```

- Necesita lo mismo que cualquier script de snap: backend en `:3100` con la **copia** de la base y un
  build servido en `:4173` (o el que diga `SNAP_BASE`). Para comparar contra otro build se corre otra
  vez con `SNAP_BASE` apuntando a ése; no hay `SNAP_REF`.
- Playwright va fijado en una versión exacta (`.claude/tools/snap/package.json`). WebKit y Firefox se
  instalan una vez: `npx playwright install webkit firefox`.
- Ningún navegador se lanza con `--autoplay-policy`.
- No está en `baseline.json`: por ahora sólo reporta.
- No escribe en la base. El escenario `g` suma dos videos sintéticos a `VIDEO_DIR` (sólo si es una
  carpeta de fixtures) y los borra siempre; sin `VIDEO_DIR` no corre ni se cuenta.

Piezas: `compat/util.mjs` (perfiles y primitivas de toque) y `compat/escenarios.mjs` (un módulo por
escenario: `{ id, titulo, aplica?, run }`). Sumar un escenario es agregar un objeto a `ESCENARIOS`.

## Perfiles: qué es cada uno y qué NO es

| Perfil | Qué es de verdad | Sirve para | NO es |
|---|---|---|---|
| `pixel7` | Chromium de escritorio + descriptor de Pixel 7 (412×839, touch). Toque y pulsación larga **reales** por CDP (`Input.dispatchTouchEvent`): Chromium reconoce el long-press y manda `contextmenu`, como Android | Layout del teléfono, el camino `pointercancel` + `contextmenu` de Android, gestos con dedo sintético | Chrome de Android: sin teclado en pantalla, sin barra de URL que se esconde, sin políticas de batería ni de autoplay de Android |
| `iphone15` | WebKit de Playwright **para Windows** + descriptor de iPhone 15 (393×659, touch) | Motor de render y de JS de la familia de Safari: CSS que WebKit no entiende, `font-size` de inputs, atributos de `<video>` | Safari de iOS: ver "Lo que no se puede probar así" |
| `ipad` | El mismo WebKit + iPad gen 7 (810×1080, touch) | El caso **touch con más de 700 px**: ahí el layout es el de escritorio pero no hay ratón | iPadOS real |
| `desktop-webkit` | WebKit 1440×900 sin touch | Aproximación a Safari de Mac | Safari de macOS (no es el mismo build ni tiene sus codecs) |
| `firefox` (opcional) | Firefox de Playwright 1440×900 | Tercer motor de escritorio | — |

**El toque, por perfil** (cada resultado lo dice en el campo `toque`):

- `tap` es `page.touchscreen.tap` donde hay touch: para el motor es un toque de verdad (touch →
  pointer → click) y cuenta como gesto del usuario.
- La pulsación larga es **real en `pixel7`** (CDP) y **sintética en WebKit**: Playwright no puede
  sostener un dedo en WebKit, así que se despachan `PointerEvent` (`pointerdown` · esperar ·
  `pointerup` · `click`). Eso ejercita el camino del **timer** de `useLongPress` —que es el de iOS,
  donde no hay `contextmenu`— pero no es un dedo: no aparece el callout ni la selección de texto.

**Límites del WebKit de Windows que ya se midieron** (no son fallas del producto):

- No reproduce un `<audio>` servido por `route()`: `NotSupportedError` con WAV, AAC y MP3. El
  `<video>` que sale del backend sí reproduce. Por eso en los perfiles WebKit "suena" **no es
  medible** y el arnés lo anota aparte (`NO MEDIBLE … no se cuenta`): la cola y el estado sí se miden.
- **No exige gesto para reproducir**: `play()` desde un script arranca igual en los tres motores
  emulados. La política de autoplay de iOS y de Android no se puede comprobar acá.
- `env(safe-area-inset-*)` vale `0px` en todos los perfiles.

## Etiquetas (obligatorias en cualquier reporte)

| Etiqueta | Cuándo |
|---|---|
| `[MEDIDO-pixel7-emulado]` | salió del perfil `pixel7` |
| `[MEDIDO-webkit-emulado]` | salió de `iphone15`, `ipad` o `desktop-webkit` (decir cuál) |
| `[LEÍDO]` | se dedujo del código, con archivo:línea |
| `[REQUIERE DISPOSITIVO REAL]` | la emulación no lo puede ver; va con el paso para probarlo |

Una fila que falla se repite 3 veces antes de concluir, y se clasifica: **producto** (también falla
con otro método en el mismo motor, o se explica leyendo el código), **arnés** (el toque cayó en otro
elemento, un selector, un tiempo) o **emulación** (el motor emulado no puede hacerlo: se demuestra
con una página mínima fuera de la app).

## Checklist de trampas

**iOS / Safari**

- [ ] **Zoom al enfocar**: un `input`, `select` o `textarea` con `font-size` computado menor de 16 px
      hace que Safari agrande la página al enfocarlo, y no vuelve sola. Escenario `b`.
- [ ] **`playsinline`** en todo `<video>`: sin él, iPhone abre el video en su reproductor a pantalla
      completa. Escenario `c`.
- [ ] **Autoplay**: `play()` sólo dentro de un gesto. Lo que arranca solo (siguiente de la cola,
      reanudar al volver) depende de que el elemento ya haya sonado por un gesto. `[REQUIERE DISPOSITIVO REAL]`
- [ ] **`audio.volume` es de sólo lectura** en iOS (siempre 1): un slider de volumen no hace nada;
      el volumen es el del teléfono. `muted` sí funciona.
- [ ] **No existe `contextmenu`**: el menú sólo puede salir de un timer propio (`useLongPress`), y
      hay que apagar el callout (`-webkit-touch-callout: none`) y la selección (`user-select: none`)
      en lo que tenga pulsación larga. Ver `mobile-lab` → "Long-press".
- [ ] **`100vh` incluye la barra de Safari**: usar `dvh`/`svh` o el alto medido; lo fijo abajo se
      mueve cuando la barra aparece y desaparece. `[REQUIERE DISPOSITIVO REAL]`
- [ ] **`backdrop-filter` necesita `-webkit-backdrop-filter`**.
- [ ] **Rebote (overscroll)**: `overscroll-behavior` recién existe desde Safari 16; el rebote de la
      página puede arrastrar lo fijo.
- [ ] **Safe-areas**: `viewport-fit=cover` + `env(safe-area-inset-*)` en lo que toca los bordes.
      Escenario `d` comprueba que estén **escritas**; que alcancen se ve sólo en el teléfono.
- [ ] **Sesión de audio**: pantalla bloqueada, llamada entrante, otro audio, el interruptor de
      silencio. `[REQUIERE DISPOSITIVO REAL]`
- [ ] **Media Session**: carátula, título y los botones de la pantalla de bloqueo. `[REQUIERE DISPOSITIVO REAL]`

**Android / Chrome**

- [ ] **Long-press = `pointercancel` y después `contextmenu`**: el timer propio se apaga con el
      `pointercancel`; el menú tiene que abrirse desde el `contextmenu` (y prevenirlo, o sale el del
      sistema encima). Escenario `e` en `pixel7`.
- [ ] **A 700 px o menos un `contextmenu` cuenta como pulsación larga** a propósito (por lo de
      arriba): un clic derecho en una ventana angosta abre los tiles.
- [ ] **Barra de URL que se esconde**: mismo problema de `100vh` que en iOS.
- [ ] **Autoplay y batería**: Chrome puede pausar medios en segundo plano. `[REQUIERE DISPOSITIVO REAL]`
- [ ] **Media Session** en la notificación y con auriculares. `[REQUIERE DISPOSITIVO REAL]`

**Los dos**

- [ ] **Touch con más de 700 px (tablet)**: la pulsación larga está cerrada a 700 px o menos y en una
      tablet no hay clic derecho → los menús de tarjeta no tienen puerta. Perfil `ipad`, escenario `e`.
- [ ] **Áreas táctiles**: 32 px de alto como mínimo donde hay dedo (`mobile-lab` → "Touch targets").
      El escenario `g` mide el enlace de artista de Videos.
- [ ] **Desborde horizontal** a 360, 390 y 430. Escenario `a`.

## Lo que NO se puede probar así (y cómo probarlo en un teléfono)

Con la app abierta en el teléfono (sonorarev.com, sesión iniciada):

1. **Safari de iOS real y zoom de inputs.** Tocar el buscador de Biblioteca. ¿La página se agranda?
   Si se agranda, ¿vuelve al cerrar el teclado? Repetir en Años y en Videos.
2. **Sesión de audio de iOS.** Reproducir una canción, bloquear la pantalla: ¿sigue sonando? ¿Pasa
   sola a la siguiente con la pantalla bloqueada? Con el interruptor de silencio puesto, ¿suena?
   Recibir una llamada o reproducir un audio de otra app: ¿se pausa y se puede reanudar desde la app?
3. **Pantalla de bloqueo / notificación.** Con algo sonando: ¿aparecen título, artista y carátula?
   ¿Funcionan pausa, siguiente y anterior desde ahí? En Android, lo mismo desde la notificación y
   con los botones de unos auriculares.
4. **Callout real.** Mantener el dedo sobre una fila de Años, una tarjeta de Géneros y una tarjeta
   de álbum: tiene que salir el menú de SonoraRev y **no** la lupa, "Copiar" ni "Guardar imagen". Al
   soltar no tiene que abrir el año ni reproducir nada.
5. **Barra dinámica de Safari / de Chrome.** En Biblioteca, deslizar hacia abajo y hacia arriba:
   ¿la barra del reproductor y la de pestañas quedan pegadas abajo, sin hueco ni tapadas, cuando la
   barra del navegador aparece y desaparece? Abrir el expandido y repetir.
6. **Safe-areas físicas.** En un iPhone con Dynamic Island o notch, en vertical y en horizontal: ¿el
   encabezado del expandido queda debajo de la isla? ¿La barra de pestañas respeta la línea de
   inicio (home indicator)? ¿Algún botón queda bajo el borde redondeado?
7. **La sensación del dedo.** En Videos, tocar el nombre del artista de un video que esté en la
   biblioteca: ¿entra al artista al primer intento sin reproducir el video? Tocar el título de la
   misma tarjeta: ¿reproduce? Probar con el pulgar, no con la punta del dedo.
8. **Video.** Tocar un video: tiene que reproducir **dentro de la página**, no en el reproductor de
   pantalla completa de iOS. Bloquear y desbloquear: ¿sigue o se pausa? Girar el teléfono.
9. **Reproducir sin gesto.** Recargar la página con algo en la cola y no tocar nada: no debe sonar
   solo; el botón tiene que decir "Reproducir", no "Pausa".
10. **Volumen en iPhone.** Mover el slider de volumen del expandido: en iOS no cambia nada (es del
    sistema). ¿Confunde? ¿El botón de silenciar sí silencia?
11. **Chrome de Android real.** Repetir 4, 5, 7 y 8 en un Android.

Anotar para cada punto: modelo, versión del sistema, navegador, y lo que pasó (con captura si falla).
