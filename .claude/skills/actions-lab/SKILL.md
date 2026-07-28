---
name: actions-lab
description: Estándar de las ACCIONES sobre ítems de SonoraRev (qué se puede hacer con una pista/álbum/artista/fila de cola, y desde dónde) — el menú contextual único con sus DOS presentaciones (popover-lista en desktop, grid de tiles táctil en móvil), el motor de cola de PlayerContext (addToQueue/playAfterCurrent/removeFromQueue por _qid) y el menú "+" que sobrevive en la barra. Úsala SIEMPRE antes de tocar o auditar la cola, el menú contextual o cualquier acción sobre ítems (PlayerContext.jsx, ContextMenu.jsx, useLongPress.js, AddToPlaylistMenu.jsx).
---

# Actions Lab — estándar de las acciones sobre ítems

Fuente de verdad del frente "**acciones**": *qué se puede hacer con una pista / álbum /
artista / fila de cola, y desde dónde*. **No cites de memoria: verificá contra el código real.**

> **Sobre las referencias:** este mapa ancla en **nombres** (funciones, estados, selectores,
> constantes), no en números de línea. La versión anterior de esta skill era un documento de
> PLAN previo a la implementación —decía que `ContextMenu.jsx` "no existe aún" y que el
> long-press estaba diferido— y envejeció entera. Buscá por nombre.

El contrato es **transversal**: ninguna vista es dueña. Lo consumen Biblioteca, Álbumes,
Artistas, Géneros, Años, Playlists y la cola.

## Estado: CONSTRUIDO

El menú contextual **existe y está completo** en sus dos presentaciones, y el motor de cola
también. Lo que falta está en §Deudas — y es cableado de superficies, no diseño.

| Pieza | Estado |
|---|---|
| Motor de cola por `_qid` (`addToQueue` / `playAfterCurrent` / `forcedNext`) | ✅ v1.8.0 |
| Vista de cola (columna desktop + hoja móvil) | ✅ v1.8.0 / v1.9.0 |
| Menú contextual desktop (popover-lista) + tipos `track`/`album`/`artist`/`queue-track` | ✅ |
| Botón "⋯" por fila (disparador visible) | ✅ |
| Agregar a playlist desde el menú | ✅ |
| `removeFromQueue` ("quitar de la cola") | ✅ |
| Long-press en móvil + presentación táctil (grid de tiles) | ✅ |

**⚠️ MediaSession vive en `PlayerContext.jsx`** (efectos propios, buscá `mediaSession`). Los
cambios de cola **NO tocan esos efectos**: interactúan por interfaces limpias (`currentTrack` +
los callbacks `next`/`prev`/`seek`). Si un cambio pretende entrar ahí, **parar y avisar** —
bandera roja. Verificación de regresión sin carro: el **lockscreen del teléfono** (misma
superficie que CarPlay).

## Los archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/context/PlayerContext.jsx` | **El corazón.** Dueño de la cola y del `<audio>`, que nunca se expone. De acá salen `play` / `addToQueue` / `playAfterCurrent` / `removeFromQueue` |
| `music-client/src/components/ContextMenu.jsx` | **El menú único + su provider.** Arma las acciones según el `type`, resuelve posición (flip/clamp) y cierres. Exporta `ContextMenuProvider`, `useContextMenu()` y `ContextMenuButton` (el "⋯") |
| `music-client/src/utils/useLongPress.js` | El disparador táctil. Física y defensas en `mobile-lab §Long-press`; acá sólo importa que entra por `via:'longpress'` |
| `music-client/src/utils/playlistActions.js` | `addTrackToPlaylist` / `createPlaylistWithTrack`: el QUÉ de "agregar a playlist", **compartido** por el menú contextual y el "+" |
| `music-client/src/components/AddToPlaylistMenu.jsx` | El "+". **Sobrevive**, pero ya no en las filas: hoy se monta 3 veces desde `Player.jsx` (barra y expandido) |
| `music-client/src/components/QueueOverlay.jsx` | La vista de cola. Sus filas son una superficie más del menú (`type: 'queue-track'`) |
| `music-client/src/components/Player.jsx` | **HOST del menú**: le presta `goArtist`/`goAlbum`/`openInfo` por `registerHost`, y corre su cierre por Esc / atrás |
| `music-client/src/styles/main.css` | Tokens `:root`, `--z-context-menu`, estilos `.ctx-*` |
| `music-server/` | **NO SE TOCA.** Este frente es 100% frontend |

## El menú: UNA lógica, DOS presentaciones

**Un solo menú montado y un solo provider.** Las superficies sólo llaman
`openMenu(e, { type, item })`; el menú arma sus acciones según el `type`. Si aparece un segundo
componente de menú, algo se hizo mal.

**Quién ve cuál lo decide QUIÉN lo abrió, no el ancho.** `tiles` se calcula al abrir
(`payload.via === 'longpress'`) y **se congela**: la presentación no cambia a mitad de vida, y
achicar la ventana de desktop no puede cambiarle la cara al clic derecho. Es lo que garantiza
"desktop intacto" por construcción y no porque un número caiga de un lado.

| | Desktop | Móvil |
|---|---|---|
| **Disparadores** | clic derecho sobre la fila/tarjeta · botón **"⋯"** de la fila | **long-press** (500ms) |
| **Presentación** | popover-**LISTA**: icono 14px + etiqueta larga, separadores por grupo | **GRID DE TILES**: 2 columnas, icono + etiqueta corta (`short`) |
| **Ancla** | el cursor, o el borde inferior-derecho del "⋯" (`anchor:'element'`) | el punto del toque, centrado sobre el dedo y separado 16px |
| **Caja** | glass: `rgba(24,24,24,.82)` + `blur(16px) saturate(1.3)`, `min-width: 208px`, radio 12 | **sólida, sin blur**: gradiente + `#0b0b0c`, `min(300px, 100vw-24px)`, radio 20 |
| **Color de identidad** | en **`:hover`** (en reposo todo apagado) | **desde el REPOSO** (ver abajo) |
| **Scrim** | no | **sí** (`.ctx-scrim`), y no es decorativo |

El flip/clamp es **el mismo mecanismo** en los dos; lo único que cambia es el rectángulo contra
el que se recorta (`safeArea()`, que en móvil descuenta notch y cromo fijo de abajo). La caja
táctil, sus números y sus defensas están en **`mobile-lab §Long-press`** — no duplicar acá.

### ⚠️ La inversión de convención en móvil (deliberada)

`ui-polish` manda "en reposo apagado, el color al interactuar" y el popover de desktop la
respeta. **La caja táctil la invierte**: cada tile está teñido con la identidad de su acción
desde el reposo. En un teléfono **no hay hover que esperar** — o el color está desde el
principio o no está nunca — y el tile teñido se reconoce sin leer la etiqueta. Son **dos
superficies distintas**, no un sistema con dos reglas peleadas: si tocás una, no "unifiques" la
otra.

## Acciones por tipo (contrato as-built)

Los tonos son los de la casa: **morado** (`--accent`) cola y navegación · **teal** (`--teal`)
playlist · **ámbar** (`--amber`) info.

| Tipo | Acciones (en orden) | Máx. |
|---|---|---|
| **`track`** (fila de lista) | Reproducir a continuación · Agregar a la cola · Agregar a playlist ▸ · Ir al artista · Ir al álbum · Ver info | **6** |
| **`queue-track`** (fila de la cola) | Quitar de la cola · Agregar a playlist ▸ · Ir al artista · Ir al álbum · Ver info | **5** |
| **`album`** (tarjeta) | Reproducir álbum · Agregar a la cola · Ir al artista | **3** |
| **`artist`** (retrato) | Reproducir todo · Agregar a la cola · Ir al artista | **3** |

Lo que **NO** está, y por qué:

- **"Reproducir" sobre una pista**: el clic/tap izquierdo ya reproduce. Sería un ítem que
  duplica el gesto obvio.
- **`queue-track` no ofrece "agregar a la cola"** (ya está) **ni "a continuación"**: con el
  motor actual insertaría una **copia nueva** (otro `_qid`) en vez de mover ésta. Mover es
  *reorder*, frente aparte.
- **`album` no ofrece "ir al álbum"** (la tarjeta YA es el álbum: el clic izquierdo lo abre)
  **ni "ver info"**: el panel de Info es de PISTA (título, nº de pista, códec de ese archivo).
  Un info de álbum es otro panel, no esta acción.
- **"Agregar a playlist" sólo sobre UNA pista**: `api.addToPlaylist` es de a una → un álbum
  serían N requests (§Deudas).

**Las acciones que no aplican se OCULTAN, no se deshabilitan** (regla dura). Además de las
reglas por tipo, se ocultan caso a caso: "a continuación" sobre la pista que ya suena (no-op),
"quitar" sobre la fila que suena (obligaría a decidir qué reproducir después), "ir al artista"
sin `album_artist`, y cualquier acción del host que no esté registrada.

## Quién provee cada acción — se REÚNEN, no se crean

El menú no implementa nada: junta funciones que ya existen. Son **las mismas** que usan la
barra y el expandido, no copias.

| Acción | Origen | Nota |
|---|---|---|
| Reproducir álbum/artista | `play(tracks, 0)` de **PlayerContext** | las pistas se cargan con los MISMOS parámetros que la vista (`albumTracks` / `artistTracks`) → el orden que se encola es el que se ve |
| Reproducir a continuación | `playAfterCurrent(item)` de **PlayerContext** | |
| Agregar a la cola | `addToQueue(item \| tracks)` de **PlayerContext** | acepta una o muchas |
| Quitar de la cola | `removeFromQueue(_qid)` de **PlayerContext** | ver abajo |
| Agregar a playlist | `utils/playlistActions.js` | el mismo módulo que usa el "+" |
| Ir al artista / al álbum / Ver info | **el HOST** (`Player.jsx`) vía `registerHost({ goArtist, goAlbum, openInfo })` | dependen del estado de Player (cerrar overlays antes de navegar, abrir Info sobre una pista arbitraria) |

`registerHost` guarda los handlers en un **ref**: refrescarlos en cada render del host no
re-renderiza el menú.

### `removeFromQueue(qid)` — toca el motor, respetando `_qid`

Recibe un **`_qid`**, no un índice ni un `track.id`. Se niega a quitar la que suena
(`qid === curQid` → return) y, al filtrar la cola, limpia **todas** las estructuras que podrían
quedar apuntando a un fantasma:

- `playedRef.delete(qid)` → el ciclo de shuffle no cuenta una pista que ya no está.
- `historyRef` se filtra → `prev()` no vuelve a un fantasma.
- si estaba en `forcedNextRef`, sale de ahí **y** del espejo reactivo `upNextIds` (el pill
  "a continuación").
- `idxRef` se **recomputa** con `findIndex(_qid === curQid)`.

Es el ejemplo canónico de la regla `_qid`: **quitar no remapea nada**.

## El motor de cola: `_qid`, no índices (regla dura, no re-litigar)

Cada entrada de cola lleva un **`_qid` estable** (contador `uidRef`), y
`playedRef`/`historyRef`/`forcedNextRef` se llevan **por `_qid`**. Así insertar/quitar/reordenar
nunca corrompe played/history (son posición-independientes) y los **duplicados** funcionan (la
misma pista dos veces = dos `_qid` distintos). `idxRef` se recomputa con
`findIndex(current._qid)` tras cada mutación — un solo lugar, no per-estructura.

- Se descartó remapear índices: la fragilidad mordía justo en "quitar de la cola".
- Se descartó keyear por `track.id`: **se rompe con duplicados** (no distingue instancias).
- El `_qid` es **identidad interna**: no viaja a la API ni se muestra.
- **Cola vacía / nada suena**: encolar sobre la nada **arranca la reproducción**.

## Superficies: qué está cableado y qué no

| Superficie | Clic derecho | Botón "⋯" | Long-press |
|---|---|---|---|
| `TrackTable.jsx` (Álbum / Género / AlbumDetail) | ✅ `track` | ✅ | ✅ |
| `Library.jsx` (fila inline propia) | ✅ `track` | ✅ | ✅ |
| `QueueOverlay.jsx` (filas de la cola) | ✅ `queue-track` | — | ✅ |
| `AlbumGrid.jsx` (Artistas + Años) | ✅ `album` | — | ❌ |
| `Albums.jsx` (grilla inline propia) | ✅ `album` | — | ❌ |
| `Artists.jsx` (retratos) | ✅ `artist` | — | ❌ |
| `Genres.jsx` (tarjetas) | ❌ | — | ❌ |
| `Playlists.jsx` (detalle, fila inline propia) | ❌ | ❌ | ❌ |

Dos lecturas importantes de esta tabla:

1. **Las tarjetas de álbum/artista NO tienen long-press.** Es deliberado: el menú se abre en
   móvil sólo por la puerta explícita `via:'longpress'`, así que el `contextmenu` que Android
   dispara ahí sigue cayendo en el **menú nativo**, como siempre, en vez de abrir este popover
   en superficies que no se probaron. Montar el hook ahí es trabajo pendiente, no un bug.
2. **`Playlists.jsx` y `Genres.jsx` siguen sin cablear.** Playlists tiene además su propia
   acción de fila ("quitar de esta playlist") que habría que integrar como un tipo nuevo
   (`playlist-track`) en vez de sumarle un botón suelto.

El botón **"⋯"** vive en la celda `.col-actions` (donde antes estaba el "+") y está **siempre
visible**, sin hover: es la puerta descubrible del menú — el clic derecho es un atajo que nadie
ve. La distinción reposo/hover la hace el **color**, nunca la opacidad. En modo lista
(`mobile-lab §Patrones 2`) `.col-actions` es `display:none` y manda el clic derecho.

## El sub-selector de playlists: panel en el MISMO sitio

"Agregar a playlist" no ejecuta: cambia el contenido de la caja y la ensancha
(`.ctx-menu--wide`). **No** es un submenú lateral ni un modal, y la razón es el posicionamiento:
un flyout necesitaría su propio flip relativo al padre (y heredar el lado cuando el padre ya
volteó), y un modal sería un overlay nuevo que habría que meter en la escalera de `nav-lab`.
Así se reusa todo lo que ya funciona: mismo ancla, mismo z, mismos cierres y el mismo flip, que
se **vuelve a medir** al crecer (el efecto tiene `panel` entre sus deps).

Reusa las clases del "+" (`.ptp-list` / `.ptp-item` / `.ptp-new`) y su módulo de acciones. En
táctil el `autoFocus` del input se **apaga**: entrar al selector es casi siempre para elegir una
playlist existente, y abrir el teclado tapa justo la lista que se vino a mirar.

## Cierres — es un POPOVER EFÍMERO, no un overlay de nav-lab

- **Acá**: `pointerdown` afuera (no `mousedown`: en el teléfono ése es un evento sintetizado),
  scroll **de afuera** (el listener es de captura y excluye lo de adentro con `contains`),
  `resize` **sólo si cambió el ANCHO** (en móvil abrir el teclado dispara resize por alto y
  cerraba el menú al enfocar "nueva playlist"), `blur`, y elegir una acción.
- **Esc y el atrás del navegador los corre `Player`**, como **peldaño 0** de su escalera,
  llamando a `dismissMenu()`. No hay un segundo listener de Esc: con dos, un Esc con el menú
  abierto sobre el expandido cerraba los dos de una.
- **Escalera interna**: con el selector de playlists abierto, el primer Esc/atrás vuelve al
  grid y el segundo cierra. Cuántos pasos tiene adentro lo sabe el menú, no Player.
- **NO entra en `layerDepth`** (no empuja entrada-guardia de historial) y **NUNCA** llama
  `history.back()`.

## z-index

Token **propio**: `--z-context-menu: 260`. Hoy coincide con `--z-bar-popover: 260`, pero
**⚠️ no reusar ese token**: son cosas distintas y atarlas hace que mover una mueva la otra sin
querer. Queda encima de la Letra (250) y del expandido (200), **debajo** de Info (300). El
scrim comparte el z del menú y queda debajo por **orden del DOM** (hermano anterior), sin
inventar una capa nueva — mismo patrón que `.exp-scrim`.

## Reglas duras (no romper)

1. **MediaSession** vive en `PlayerContext.jsx`: los cambios de cola **NO tocan** esos efectos.
   Si uno pretende entrar, **parar y avisar**.
2. **`playedRef`/`historyRef`/`forcedNextRef` se llevan por `_qid`, NUNCA por índice.**
3. **UN menú, un provider.** Si aparece un segundo componente de menú, algo se hizo mal.
4. **Las acciones que no aplican se OCULTAN, no se deshabilitan.** Un menú con ítems grises es
   ruido.
5. **Navegar SIEMPRE por `album_artist`, NUNCA por el `artist` mostrado.** Rompería Various
   Artists y los feats, y el backend lo respalda: `music-server/src/api/browse.js` (⚠️ `src/api/`,
   no `src/routes/` — la ruta que citaba la versión anterior de esta skill no existe) filtra
   `WHERE album_artist IS NOT NULL AND album_artist <> ''` en `GET /browse/artists`. Sin
   `album_artist` no hay vista a la que ir → la acción **no aparece**. En la vista de Artistas el
   campo `artist` **ya ES** `album_artist`: esa misma query lo aliasea (`album_artist AS artist`),
   así que ahí la regla se cumple sola.
6. **La presentación la decide QUIÉN abrió el menú, no el ancho** — y se congela al abrir.
7. **Sin `backdrop-filter` en la caja táctil.** El "buffeo" móvil es regresión conocida; se
   resuelve con capas sólidas. El popover de desktop sí conserva su glass.
8. **Backend: NO SE TOCA.** Si creés que hace falta un endpoint, **pedilo**.
9. **Nada de dependencias nuevas** (ni librerías de menús ni de drag&drop).
10. **`prefers-reduced-motion` y tokens de `:root`** siempre.
11. **No re-litigar la unificación de las copias de fila.** El usuario decidió *"un frente, una
    cosa"*: se cablea en cada superficie, y se paga.

## Casos borde (resueltos)

- **La pista que YA suena**: "Reproducir a continuación" sería un no-op → **se oculta**.
- **La fila de cola que suena**: "Quitar" **se oculta** (y `removeFromQueue` además se niega en
  el motor — doble red).
- **Various Artists**: *sí* es un artista real en la DB → "Ir al artista" funciona y lleva a la
  carpeta VA. Para una pista de un álbum VA, el artista real no tiene vista propia. **Se navega
  por `album_artist` y punto.**
- **Pista sin `album_artist`** (las de Red Hot Chili Peppers y las de Metallica sueltas en la
  raíz): no hay vista a la que ir → la acción **se oculta**. Es **curación/tagging del usuario,
  NO código** (`CLAUDE.md` §Pendientes). No lo "arregles" desde el scanner.
- **Álbum o artista sin pistas**: el fetch devuelve vacío → **toast de aviso**. Sin eso,
  "reproducir álbum" no haría nada y parecería un bug.
- **Cola vacía + "agregar a la cola"**: arranca la reproducción.

## Deudas conocidas (anotadas a propósito)

- **`Playlists.jsx` y `Genres.jsx` sin cablear** (ver §Superficies). Playlists necesita además
  decidir si "quitar de esta playlist" entra como tipo nuevo.
- **Long-press sobre tarjetas de álbum/artista**: el hook no está montado ahí.
- **"Agregar álbum/artista a playlist"**: `api.addToPlaylist` es de a una pista → N requests.
  Si se quiere, es un endpoint nuevo → **OK del usuario**.
- **Reorder de la cola**: drag&drop es un frente de gestos propio y colisiona con el swipe-atrás
  y con los gestos del expandido. Sin él, "mover a continuación" sobre una fila de cola no se
  puede ofrecer.
- **`build.target` sin fijar** (`CLAUDE.md` §Pendientes): afecta a la app entera, no a este
  frente.

## Checklist QA

**Cola:**
1. `addToQueue` con la cola **vacía** → arranca la reproducción.
2. `addToQueue` durante reproducción → **no interrumpe** lo que suena.
3. `playAfterCurrent` → la insertada suena **inmediatamente después** de la actual.
4. **`playAfterCurrent` + shuffle**: ninguna ya sonada vuelve a sonar en el ciclo, y ninguna sin
   sonar se saltea. *(Test del keying por `_qid`.)*
5. **`playAfterCurrent` + `prev()` en shuffle** → vuelve a la realmente sonada antes.
6. **`removeFromQueue`**: quitar una pista NO altera qué suena después; quitar una que estaba
   "a continuación" la saca también del pill; sobre la que suena la acción **no aparece**.
7. `repeat: 'all'` con cola crecida → el ciclo cubre las nuevas.
8. La UI **se entera** de los cambios de cola (la cola es estado, no ref).
9. **MediaSession sigue viva**: metadata, play/pause, prev/next y scrubber en el lockscreen.

**Menú — desktop:**
10. Clic derecho sobre fila → menú en el cursor; clic izquierdo **sigue reproduciendo**.
11. El **"⋯"** abre el mismo menú colgado del botón, y su clic **no** reproduce la fila.
12. Menú cerca del **borde derecho / inferior** → se voltea y no se sale del viewport.
13. `pointerdown` fuera, scroll de la página y **Escape** cierran; scrollear **dentro** del menú
    (lista de playlists) **no** cierra.
14. Con el selector de playlists abierto, el primer Esc vuelve al grid y el segundo cierra.
15. Menú sobre la **Letra abierta** (250) → el menú (260) queda encima.

**Menú — móvil:** ver `mobile-lab §Long-press` (gesto, scrim, safe-areas, targets) y su
checklist #13. Acá sólo lo de las acciones:
16. Las acciones y su orden son **las mismas** que en desktop — sólo cambia la etiqueta (`short`).
17. La etiqueta LARGA sigue siendo la accesible (`aria-label`), aunque el tile muestre la corta.

**Transversal:**
18. Pista **sin `album_artist`** → "Ir al artista" **no aparece** (no aparece gris).
19. Pista que **ya suena** → "Reproducir a continuación" **no aparece**.
20. Álbum/artista **vacío** → toast de aviso, no silencio.
21. **`prefers-reduced-motion`** → sin animación de entrada, colores y estados intactos.
22. El menú **"+"** de la barra y del expandido sigue funcionando igual.
