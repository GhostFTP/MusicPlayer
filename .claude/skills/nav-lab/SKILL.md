---
name: nav-lab
description: Estándar de la navegación core de SonoraRev — el Modelo 2 real (rutas con URL + overlays encima), routing a mano sobre la History API (deep-linking, F5 que restaura, atrás/adelante de vistas Y detalles, incluido el álbum), la escalera dismissTop (solo overlays), el guardia de overlays, y el gesto swipe-atrás. Úsala SIEMPRE antes de tocar o auditar rutas/URLs, el botón atrás del navegador, la cadena de Esc, el swipe-atrás o cualquier cambio de vista/detalle (routes.js, Layout.jsx, Player.jsx y las 5 vistas con detalle).
---

# Nav Lab — estándar de navegación de SonoraRev

Fuente de verdad de **cómo se navega y cómo se retrocede**: las rutas (URLs), el
atrás/adelante del navegador, la cadena de Esc y el swipe-atrás de móvil. Antes de
opinar o tocar, **inspeccioná los archivos reales** — este mapa dice dónde vive
cada cosa y qué NO se puede romper. Los números de línea son orientativos (el
código se mueve); las funciones, banderas, el orden de la escalera y el esquema de
rutas son el ancla.

## ⏱️ Estado actual (leer primero)

- **EN CÓDIGO hoy (rama `feature/sonorarev-integration`): Modelo 2 completo (routing
  real).** Commits, en orden:
  - `2d7267a` **F1.1** — módulo PURO `music-client/src/utils/routes.js`
    (`stateToPath` / `pathToState`, con `encodeURIComponent` + NFC).
  - `0ed4b8c` — `pathToState` coerce `year`/`id` a **número** (la DB es INTEGER).
  - `123f92f` **F1.2** — deep-link / F5 al montar: `Layout` lee `location.pathname`.
  - `9005557` **F1.3a** — URL-sync + atrás Modelo 2 a nivel **vista**.
  - `a40befc` **F1.3b** — el **detalle es RUTA** en las 5 vistas (el álbum anidado quedó
    como capa con guardia, revertido en F1.4).
  - `6c3ceaf` **F1.4** — el **álbum anidado pasa a RUTA** (reusa `/albums/:aa/:a`); se
    retira la capa (`nestedOpen`/`clearNested`) y se borra `AlbumDetail.jsx`.
- **NO desplegado.** `origin/main` sigue en **v1.5.0 (Modelo 1)**: en producción todavía
  corre el Modelo 1 hasta que se mergee. Esta tanda es el candidato a **v1.7.0**.
- **El Modelo 1 (nav-lab v1) quedó RETIRADO del código de la rama** (ver "Qué se retiró
  de v1"). No lo "arregles" pensando que estaba mal: fue correcto hasta que se decidió
  routing (ver "Por qué existió el Modelo 1").

## Premisa (el contrato, no el botón)

El frente es **el modelo de navegación de la app y su única fuente de verdad**:
*dónde estás* (la ruta) y *qué tenés encima* (los overlays). SonoraRev **no usa
react-router** — decisión ratificada: la superficie es chica (8 vistas, 3 patrones
de detalle), hay un choke point único (`navigate()` en `Layout`), existe el SPA
fallback en el server, y sumar una dependencia arriesga el pendiente de
`build.target`/Chrome-87 del R4. El routing se construyó **a mano sobre la History
API**, extendiendo la maquinaria de guardia que nav-lab v1 ya había introducido.

## 🧭 El modelo de DOS NIVELES (el corazón del contrato)

Hay dos niveles de "atrás", y no se mezclan:

| Nivel | Qué | Ejemplos | ¿URL? | El atrás… |
|---|---|---|---|---|
| **1 — Rutas** | *lugares* | vista (`/artists`) y **detalle** (`/artists/:artist`, `/albums/:album_artist/:album`, `/genres/:genre`, `/years/:year`, `/playlists/:id`, `/changelog`, `/settings`) | **Sí** (deep-linkable, F5-restaurable, atrás/adelante) | recorre el **historial** del navegador → `restoreRoute` |
| **2 — Overlays** | *cosas encima*, transitorias | expandido, Letra, Info | **No** | los **cierra primero** (`dismissTop` + guardia de overlays) |

**El atrás, en orden:** el `popstate` corre **primero la escalera de overlays**
(`dismissTop`); si cerró uno, para ahí (el atrás consumió el guardia). Si no había
overlay, es un **pop de ruta** → `restoreRoute(event.state)` restaura la vista/detalle
de la entrada. **Capas antes que rutas, siempre.**

> **El álbum abierto desde un artista/año es una RUTA (F1.4).** En Artists y Years,
> `AlbumGrid onOpen` hace `navigate('albums', { album, album_artist })` → **reusa la ruta
> `/albums/:album_artist/:album`** y lo renderiza la **vista Albums**. Cerrar = pop de ruta
> (`history.back`) → cae en la entrada previa: `/artists/X` si viniste del artista (remonta
> la grilla), `/albums` si fue deep-link. NO hay tercer segmento ni capa anidada. (En F1.3b
> fue una capa con guardia; F1.4 lo revirtió a ruta para que sobreviva F5.)

## La escalera de OVERLAYS — `dismissTop()` (`Player.jsx`)

Cierra el overlay más "encima" por prioridad y devuelve `true` si cerró algo. Cubre los
overlays (lo único que **NO es ruta**). De lo más "encima" a lo más profundo:

| # | Overlay | Bandera | Acción de cierre |
|---|---|---|---|
| 1 | **Info** | `showInfo` | `infoRef.current.requestClose()` — cierre ANIMADO vía imperative handle |
| 2 | **Letra** | `showLyrics` | `setShowLyrics(false)` |
| 3 | **Expandido** | `expanded` | `setExpanded(false)` |

**Todos los detalles** (primer nivel Y el álbum) y **Novedades** son **rutas**, no
peldaños. Cuando `dismissTop()` devuelve `false` (no había overlay), el `popstate` hace
**pop de ruta** (`restoreRoute`).

## El GUARDIA de overlays (cómo el atrás cierra overlays antes que rutas)

Los overlays no tienen URL, así que para que el atrás los cierre **antes** de tocar una
ruta necesitan su propia entrada de historial:

- `Player` calcula `layerDepth = showInfo + showLyrics + expanded`.
- Cuando `layerDepth` **SUBE** (se abrió un overlay), empuja **UNA** entrada del **mismo
  path/estado** (`pushState(history.state, '', location.pathname)`). `pushState` **no**
  dispara `popstate` → sin ciclo.
- El atrás la consume cerrando el overlay (`dismissTop`), **sin mover la URL**.
- Las **rutas** las empuja `Layout.navigate` (`pushState(stateToPath(...))`); en un
  deep-link a un detalle, el **mount sintetiza el padre** (ver "Deep-linking + auth").

Esto **reemplaza el guardia único del Modelo 1** (`navArmedRef`/`openCount`/re-armado):
ahora el guardia es por-overlay (empuja al subir la profundidad) y **coexiste** con las
entradas de ruta.

### REGLA DURA #1 — una escalera de overlays, cero lógica duplicada

`dismissTop()` es la única fuente de prioridad de los overlays. La corren el **Esc** y el
**`popstate`** (que primero prueba overlays, después ruta). Overlay nuevo → se agrega SOLO en
`dismissTop()` **y** su bandera entra en `layerDepth`. **El Info es un overlay más:** su
cierre animado se dispara con `requestClose` (`InfoPanel.jsx`, `forwardRef` +
`useImperativeHandle`), NO con un Esc propio.

### REGLA DURA #2 — el swipe-atrás se queda angosto

El swipe de móvil (`Layout.jsx`, gate `detailOpenRef` en `onContentPointerDown`,
`max-width:700px`) ataca **solo detalle→lista**. En Modelo 2 **cierra con
`window.history.back()`** (pop de ruta). El gate NO cambió (sigue exigiendo un detalle
abierto) — solo cambió su acción de cierre.
**NO llama a `dismissTop()`** ni se ensancha a overlays: eso es regresión, y solo por
decisión explícita del usuario.

### ⛔ REGLA DURA #3 — anti-loop (vigente, es la más importante)

> **El handler de `popstate` NO puede llamar `history.back()` / `history.go(-1)`
> adentro. Solo hace `setState` (`dismissTop` / `restoreRoute`) y, como mucho,
> `pushState`.**

`history.back()` dentro de `popstate` dispara otro `popstate` → **loop** ("el atrás no
hace nada"). **OJO al auditar:** `window.history.back()` **sí** aparece en el código —
en los back-btns (incluido el de la vista Albums), el swipe y "borrar la playlist
abierta". **Todos son acciones de USUARIO (clicks/gesto), NO el `popstate` — y eso está
bien.** El grep de #3 verifica que **el handler de `popstate` (en `Player.jsx`) no lo
llame**: hoy `history.back` solo aparece ahí **en comentarios**. Grep de `history.back(`
DENTRO del `onPop` = hallazgo crítico.

## El QUIRK del "atrás absorbido" (guardia de overlays)

Cuando cerrás un overlay **por Esc o por su botón** (no por el atrás del navegador), la
entrada-guardia que se empujó al abrirlo **queda sin consumir**. El próximo atrás la
consume "en falso": **cierra nada visible una vez** (la URL/estado ya eran los de esa
entrada) y recién el siguiente atrás hace el pop real.

- Aplica a los **overlays guardados** (Info/Letra/expandido). Los detalles (incluido el
  álbum) son rutas, no guardia → NO tienen este quirk.
- Es **conocido y aceptado.** Se re-evaluó al implementar Fase 1 y se **mantiene**: la
  alternativa (consumir el guardia en cada cierre-no-atrás con un `history.back()`)
  reintroduce races con el cierre **asíncrono** del Info y complica el handler. El costo
  del quirk (un atrás "de más" tras cerrar a mano) es menor que ese riesgo.

## 🕰️ Por qué existió el Modelo 1 y por qué se revirtió (NO fue un error)

**nav-lab v1 (Modelo 1)** fijó el bug inmediato —el atrás nativo sacaba de la app—
**sin** meter routing: guardia único + `popstate` corriendo la escalera, y "en la
lista pelada el atrás SALE". Fue una decisión **consciente y correcta para su
alcance** (conservadora con producción, chica, cero backend). **No fue un atajo mal
hecho** — fue el peldaño correcto antes de una decisión de arquitectura. Después el
usuario pidió **deep-linking / routing real (Modelo 2)**, y el giro 1 → 2 es
**deliberado**. No "arregles" el Modelo 1 pensando que estaba mal.

## Qué se RETIRÓ de v1 y qué SOBREVIVIÓ

| Sobrevivió (se reusa) | Se retiró / rehízo |
|---|---|
| Escalera `dismissTop` (ahora **solo overlays**: Info/Letra/expandido) | **Guardia único** (`navArmedRef`/`openCount`/re-armado en popstate) → **guardia por-overlay** (`layerDepth`) que coexiste con rutas |
| El detalle unificado (hero `.detail-*` + `TrackTable`) — lo usa la vista Albums para el álbum venido de un artista | **Álbum anidado como capa** (F1.3b: `selAlbum`/`AlbumDetail`/`nestedOpen`/`clearNested`) → **ruta** `/albums/:aa/:a` (F1.4); `AlbumDetail.jsx` borrado |
| **Info como overlay** (imperative handle, `InfoPanel` `forwardRef`/`useImperativeHandle`) | **Modelo 1 "lista pelada SALE"** → **Modelo 2** "atrás recorre vistas Y detalles; sale en la 1ª entrada" |
| REGLA DURA #2 (swipe angosto) — mismo gate; solo cambió su cierre a `history.back()` | Peldaños **detalle** y **Novedades** → salieron de la escalera; ahora son **rutas** |
| REGLA DURA #3 (anti-loop) — para el `popstate` | **F5 resetea a Biblioteca** → **F5 restaura** desde la URL (`pathToState` al montar) |
| `prevViewRef` (Novedades "atrás") | **Eliminado** — el historial del router reemplaza el "atrás" de Novedades |

## Cambios de comportamiento (a propósito, no son bugs)

- **Esc ya no cierra un detalle pelado (primer nivel o álbum) ni Novedades** (son rutas;
  los cierran el atrás del navegador / swipe / back-btn). Esc **sigue** cerrando los
  overlays (Info/Letra/expandido).

## 🗺️ Esquema de rutas (as-built · `routes.js`)

- Vistas (8): `/` → Biblioteca · `/albums` · `/artists` · `/genres` · `/years` ·
  `/playlists` · `/changelog` · `/settings`.
- Detalles: `/artists/:artist` · `/genres/:genre` · `/years/:year` · `/playlists/:id`.
- **Álbum lleva DOS identificadores** (nombre + `album_artist`, desambigua homónimos):
  `/albums/:album_artist/:album`. Viene de `navigate('albums', { album, album_artist })`.
- **`year` e `id` son NÚMERO:** `pathToState` los coerce (la URL no tiene tipos, pero la
  DB es INTEGER → matchea con `===`). Segmento no numérico (`/years/abc`) → cae a la lista.
- **NO son ruta:** los overlays (Info/Letra/expandido). **Todo detalle es ruta**, incluido
  el álbum abierto desde un artista/año → reusa `/albums/:aa/:a` (lo renderiza la vista
  Albums; cerrar cae en la entrada previa: la grilla del artista o la lista de álbumes).
- **Encoding (mismo cuidado que `/image`):** `encodeURIComponent` al armar; `decodeURIComponent`
  + **NFC al hacer match** (como `findArtistImage`/`c201836`). Round-trip de un link generado
  por la app = sin pérdida.
- **Ruta desconocida → `{ view:'library' }`** (no crashea). El mount la canoniza a `/`.
- **Borde conocido:** un álbum **sin `album_artist`** no forma ruta de 2 segmentos → su
  detalle abre (por consumo de target) pero la URL se queda en `/albums` (no sobrevive F5).
  Aplica a cualquier álbum (de la lista o abierto desde un artista/año). Raro; se afina aparte.

## Deep-linking + auth (conviven, con una secuencia)

- **Cloudflare Access gatea el hostname entero** (independiente del path) → un link
  compartido solo lo abre un email autorizado. Es *feature*.
- Al cargar cualquier path: `AuthProvider` monta, `checking=true`, **`App.jsx` no pinta
  la vista** hasta que `reauth()` (SSO→JWT) resuelve → recién ahí monta `<Layout/>` y se
  lee la URL. El auth resuelve **antes** del detalle deep-linkeado.
- **localhost user/pass:** sin CF Access se muestra `<Login/>` en la misma URL; al
  loguear, se abre el path pendiente.
- **Padre sintetizado (F1.3b):** al montar sobre un **detalle** (deep-link / F5 en
  `/artists/X`), `Layout` **sintetiza la lista como entrada padre** debajo:
  `replaceState(lista)` + `pushState(detalle)`. Así **"cerrar = `history.back()`" cae en
  la lista y NO sale de la app**. Sobre una lista/vista simple, solo canoniza.

## Backend — el SPA fallback YA EXISTE (routing = frontend-only)

`server.js` (~40-46): `express.static(DIST)` + `app.get('*')` que sirve `index.html` en
cualquier ruta no-`/api`/`/stream`. **F5 en `/artists/Daft Punk` NO da 404.** El routing
**no toca backend**. No re-implementar ni listar como pendiente.

## Aislamiento de MediaSession (producción)

La navegación (escalera, guardia, `popstate`, rutas) vive en `Player.jsx` / `Layout.jsx`
/ las 5 vistas / `routes.js`. **MediaSession y la cola viven en `PlayerContext.jsx`** —
archivos distintos, cero solape. MediaSession está en prod (v1.5.0) **sin prueba física
en el carro**: el routing **no toca `PlayerContext.jsx`**. Si un cambio pretende entrar
ahí, **parar y pactar** (carro primero).

## reduced-motion

El único movimiento propio de navegación es el **chevron del swipe-atrás**
(`nav-back-chevron`, `Layout.jsx`): su fundido se anula en `prefers-reduced-motion`. El
resto del atrás (Esc, popstate, cambio de ruta) es lógica; la animación la pone cada
overlay/vista al montar/cerrarse y ya respeta reduced-motion.

## Fases (troceo del routing)

1. **Fase 1 — URLs + historial + F5 + TODO detalle como ruta: ✅ HECHA** (F1.1–F1.4). URL
   por vista y por detalle, atrás/adelante de vistas Y detalles, F5 restaura, deep-link abre
   directo, y el álbum (incluido el abierto desde un artista/año) es ruta.
2. **Fase 2 / pulido (opcional, pendiente):** restauración de scroll al hacer pop, vista
   404 propia, resolver el borde `album_artist` nulo, **evitar la doble carga al abrir un
   álbum desde el artista** (que la vista Albums arme el hero desde las pistas, sin cargar
   su lista), y —si molesta— afinar el quirk del "atrás absorbido". Nada bloquea el release.

## Checklist QA de navegación (Modelo 2 · as-built)

1. **Capas antes que rutas:** con un overlay (Info/Letra/expandido) sobre un detalle, el
   atrás cierra **el overlay primero**; recién sin overlays hace pop de ruta.
2. **Escalera por Esc:** Esc cierra Info → Letra → expandido (uno por vez); el Info cierra
   animado vía `requestClose`. Esc **NO** cierra un detalle (primer nivel o álbum) ni
   Novedades (eso es el atrás del navegador).
3. **Historial de vistas Y detalles:** Biblioteca → Artistas → un artista y atrás recorre
   detalle → lista → Biblioteca; adelante rehace. La URL muestra `/artists/<nombre>`.
4. **F5 en un detalle:** recarga y **restaura el mismo detalle** desde la URL (no Biblioteca).
5. **Deep-link:** pegar `/artists/<nombre>` (o `/years/2007`, `/playlists/:id`) abre directo
   en ese detalle (tras el auth); el back-btn "← Todos…" cae en la **lista**, no sale de la app.
6. **Álbum desde un artista (ruta):** artista → abrir un álbum de su grilla → la URL pasa a
   `/albums/AA/A` (vista Albums) → atrás → **grilla del artista** (`/artists/X`, entrada previa)
   → atrás → lista. F5 sobre el álbum → restaura el álbum (padre sintetizado = `/albums`).
7. **Encoding:** nombres con espacio/tilde/∞/en-dash resuelven al artista/álbum correcto
   (encodeURIComponent + NFC); álbum usa `:album_artist/:album`; `year`/`id` son número.
8. **No-loop (REGLA DURA #3):** el handler de `popstate` **no** llama `history.back()`
   (los `history.back()` del código son back-btns/onBack/swipe/borrar — acciones de usuario).
   Atrás repetido nunca "no hace nada" (salvo el quirk del absorbido, documentado).
9. **Swipe angosto (REGLA DURA #2):** sigue solo detalle→lista (gate `detailOpenRef`), cierra
   con `history.back()`; no cierra overlays.
10. **Aislamiento:** el diff NO toca `PlayerContext.jsx` (MediaSession) ni el server (SPA
    fallback ya existe).
