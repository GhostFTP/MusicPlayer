---
name: actions-lab
description: Estándar de las ACCIONES sobre ítems de SonoraRev (qué se puede hacer con una pista/álbum/artista y desde dónde) — sistema de cola en PlayerContext (addToQueue/playAfterCurrent), menú contextual global "Lista seca", y el menú "+" existente. Úsala SIEMPRE antes de tocar o auditar la cola del reproductor, el menú contextual o cualquier acción sobre ítems (PlayerContext.jsx, ContextMenu, AddToPlaylistMenu.jsx).
---

# Actions Lab — estándar de las acciones sobre ítems

Fuente de verdad del frente "**acciones**": *qué se puede hacer con una pista / álbum /
artista, y desde dónde*. **No cites de memoria: verificá contra el código real.**

Este lab existe porque el contrato es **transversal**: ninguna vista es dueña. Lo consumen
Biblioteca, Álbumes, Artistas, Géneros, Años y Playlists — y `artist-lab` / `playlist-lab`
van a apoyarse en él.

## 🔒 BLOQUEO ACTIVO (2026-07-15) — leer antes de tocar `PlayerContext.jsx`

**El sistema de cola NO se implementa hasta que el usuario confirme la prueba física de
MediaSession en el Mazda 3 / Maverick.**

Razón (del usuario, no re-litigar): MediaSession salió en **v1.5.0**, está en producción y
**sin prueba física en los carros**. Vive en el **mismo archivo** que la cola
(`PlayerContext.jsx:218-291`). Si la cola mete un bug sutil de reproducción y se mergea, un
fallo en el carro sería **indistinguible** entre las dos causas. **Se aísla la variable:
carro primero.**

- ✅ Se puede hacer YA: este lab (markdown), el diseño, el diagnóstico.
- 🔒 Espera luz verde explícita: **cualquier** edición de `PlayerContext.jsx`.
- Si te piden "solo una función chiquita en PlayerContext" → **NO**. Preguntá primero.

## PREMISA (decidida, no re-litigar)

**UN componente `ContextMenu` reutilizable que recibe `{tipo, item}` y arma sus acciones
según el tipo.** No un menú por vista. Provider + hook, un solo menú montado.

- **Dirección visual: C — "Lista seca"** (elegida sobre "Hermano del +" y "Ficha del ítem").
  Ver §Dirección visual.
- **Desktop-only en la fase 1** (`onContextMenu`). **El long-press en móvil se DIFIERE** —
  ver §Long-press.
- **Las acciones que no aplican se OCULTAN, no se deshabilitan.** Ver §Reglas duras #4.
- **Ordenar/curar la biblioteca no es tarea de este lab.**

## Los archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/context/PlayerContext.jsx` | **El corazón. 🔒 BLOQUEADO** (ver arriba). Dueño de la cola y del `<audio>`, que nunca se expone |
| `music-client/src/components/ContextMenu.jsx` | *(no existe aún)* El menú único + su provider |
| `music-client/src/components/AddToPlaylistMenu.jsx` | El "+" que YA existe. Widget cerrado (botón+popover), no reusable tal cual |
| `music-client/src/components/Layout.jsx` | Dueño de `navigate(view, target)` (`:63-66`) y del `viewProps` que reciben las vistas (`:73`) |
| `music-client/src/components/TrackTable.jsx` | Fila de pista compartida (Álbum / Género / AlbumDetail) |
| `music-client/src/components/Library.jsx` | Fila de pista **copia inline** (`:226-262`) |
| `music-client/src/components/Playlists.jsx` | Fila de pista **copia inline** (`:306-340`) |
| `music-client/src/styles/main.css` | Tokens `:root`, capas z-index, estilos `.ptp-*` (la receta glass a calcar) |
| `music-server/` | **NO SE TOCA.** Este frente es 100% frontend |

## Datos reales (medidos contra el código, 2026-07-15 — no estimados)

### La cola HOY: no existe como feature

| Hecho | Evidencia | Consecuencia |
|---|---|---|
| **No hay enqueue de ninguna forma** | único camino: `play(tracks, startIndex)`, `PlayerContext.jsx:159-164` | hay que **escribirlo**, no reusarlo |
| `play()` **reemplaza** la cola entera | `queueRef.current = tracks` (`:160`) | y resetea `playedRef` e `historyRef` (`:161-162`) |
| **La cola es un `useRef`, NO estado** | `queueRef` (`:20`), expuesto como `queue: queueRef.current` (`:299`) | **mutar el ref no re-renderiza nada** |
| `queueIndex` también sale de un ref | `const queueIndex = idxRef.current` (`:293`) | no reactivo |
| **Nadie consume `queue` ni `queueIndex`** | grep en todo `music-client/src`: cero hits fuera del contexto | la cola es **invisible**: no hay UI |
| `playedRef` / `historyRef` guardan **índices**, no ids | `:28-29`, `:78`, `:93` | de ahí sale el problema del remapeo (abajo) |

### ⚠️ El remapeo: por qué "añadir al final" y "reproducir a continuación" NO son lo mismo

- **Añadir al final** (`[...queue, track]`): **seguro**. Los índices ya guardados en
  `playedRef`/`historyRef` siguen apuntando a la misma pista. Sin remapeo.
- **Reproducir a continuación** (insertar en `idx+1`): **ROMPE** shuffle y "anterior". Todos
  los índices `>= inserción` se corren en uno → `playedRef` cree que sonaron pistas que no
  sonaron, y `prev()` en shuffle (`:179-181`) salta a la equivocada. **Exige remapear
  explícitamente `playedRef`, `historyRef` e `idxRef`.** No es opcional.
- **Cola vacía / nada suena**: encolar sobre la nada es invisible → tiene que **arrancar la
  reproducción**, o la acción no hace nada observable.

### Las otras acciones: existen, pero soldadas

| Acción | Estado real | Bloqueo |
|---|---|---|
| **Añadir a playlist** | existe: `addTo()` (`AddToPlaylistMenu.jsx:44`), `createAndAdd()` (`:59`) | viven **dentro** del widget, no se exportan; el menú se posiciona `absolute` sobre `.ptp` (`main.css:1236,1258-1261`) y un menú contextual necesita **`fixed`** en coords del cursor |
| **Ir a artista / álbum** | existe: `navigate(view, target)`, `Layout.jsx:63-66` | **las vistas NO lo reciben**: `viewProps` (`:73`) es solo `{target, clearTarget, setDetailOpen}` → hay que ampliarlo |
| **Ver info** | existe: `<InfoPanel>` acepta cualquier `track` (`InfoPanel.jsx:227`) | pero `showInfo` es **estado local de `Player.jsx:122`** y siempre recibe `track={trackMeta ?? currentTrack}` (`:663`) → **solo la pista que suena**. Para una fila arbitraria hay que subirlo fuera de Player |
| **Añadir álbum a playlist** | `api.addToPlaylist(id, trackId)` es **de a UNA pista** | N pistas = N requests → **fuera de scope fase 1** (deuda) |

### Las superficies: 3 copias de fila, 2 de tarjeta

| Superficie | Dónde | Copia |
|---|---|---|
| Biblioteca | `Library.jsx:226-262` | **inline propia** (tiene el riel de orden) |
| Álbum / Género / AlbumDetail | `TrackTable.jsx:36-72` | el componente **compartido** |
| Detalle de playlist | `Playlists.jsx:306-340` | **inline propia** (tiene "quitar") |
| Grilla de álbumes (Artistas + Años) | `AlbumGrid.jsx:19-35` | el componente **compartido** |
| Grilla de álbumes (Álbumes) | `Albums.jsx:131` | **inline propia** |
| Retratos de artista | `Artists.jsx:217` | — |
| Tarjetas de género | `Genres.jsx:112` | — |
| **Cola del reproductor** | **NO EXISTE** | no hay componente ni vista |

**Esto es la deuda de `artist-lab:255-258` cobrando intereses:** un menú "global" hay que
cablearlo en **cinco** lugares en vez de dos. No unificar es una decisión ya tomada por el
usuario (*"un frente, una cosa"*) — **no la re-litigues**, solo sabé que el cableado se paga.

## Acciones por tipo (contrato)

| Tipo | Acciones |
|---|---|
| **Pista** | Reproducir · Reproducir a continuación 🔒 · Añadir a la cola 🔒 · Añadir a playlist ▸ · Ir al artista · Ir al álbum · Ver info |
| **Pista en playlist** | lo anterior **+** Quitar de esta playlist |
| **Álbum** | Reproducir · Añadir a la cola 🔒 · Ir al artista |
| **Artista** | Reproducir todo · Añadir a la cola 🔒 · Ver artista |
| **Fila de cola** | *fuera de scope* — la superficie no existe |

🔒 = depende del sistema de cola (bloqueado hasta la prueba física del carro).

**Camino B (contingencia, NO recomendado):** de las 7 acciones sobre pista, **solo 2 tocan
`PlayerContext`**. Las otras 5 no. Si la prueba física se demora semanas, el menú podría
salir sin las acciones de cola. **Coste:** el usuario aprende un menú al que después le
crecen dos ítems. **Es decisión del usuario, no del ingeniero** — está anotado para que sea
una elección, no un descubrimiento.

## Dirección visual — C, "Lista seca"

Elegida por el usuario sobre "Hermano del +" (clon literal de `.ptp-menu` → se lee como *el
menú de playlists* y confunde dos cosas distintas) y "Ficha del ítem" (cabecera con
carátula → redundante: la fila que clicaste ya la muestra al lado).

- **Sin cabecera.** Ancho ~200px, radio **12px**. Solo acciones.
- **Iconos 14px monocromo**, alineados; el texto manda.
- **Color de identidad por acción en HOVER**, reusando la familia ya establecida (`ui-polish`):
  **teal** (`--teal`) para playlist · **ámbar** (`--amber`) para info · **morado**
  (`--accent`) para navegar. En reposo todo es `--text` / `--text-muted`.
- **Receta glass calcada de `.ptp-menu`** (`main.css:1258-1279`) — es coherencia, no copiar:
  `rgba(24,24,24,.82)` + `blur(16px) saturate(1.3)`, borde `rgba(255,255,255,.1)`, sombra
  `0 20px 50px rgba(0,0,0,.6)`.
- **Entrada**: reusar el patrón `ptp-menu-in` (`:1279`) con su **rama de reduced-motion**
  (`:1504`). Nada de easings nuevos: `cubic-bezier(.34,1.42,.5,1)` para el pop.
- **Cierre**: mismo patrón que el "+" (`AddToPlaylistMenu.jsx:30-42`) — `mousedown` fuera +
  Escape. El menú **no** necesita cierre animado (es efímero; los overlays sí lo necesitan).

## z-index

Jerarquía canónica **verificada en el código**: campanita **150** (`main.css:3484`) <
expandido **200** (`:2621`) < Letra **250** (`:3006`) < popovers **`--z-bar-popover: 260`**
(`:34`) < Info **300** (`:3210`) < toast **400** (`:3739`).

- **El menú contextual va en 260**, con los popovers, con **token propio**:
  `--z-context-menu: 260`.
- **⚠️ NO reusar `--z-bar-popover`.** Hoy coinciden en 260, pero son cosas distintas: atarlas
  al mismo token hace que mover una mueva la otra sin querer.
- Queda **encima** de Letra y del expandido, **debajo** de Info. Correcto para fase 1: el
  menú se abre sobre superficies de biblioteca, **nunca sobre el InfoPanel**.
- **`position: fixed`** en coordenadas del cursor (el `absolute` del "+" no sirve acá).
  Reposicionar si se sale del viewport (borde derecho / inferior).

## Long-press en móvil: DIFERIDO (decidido, con razones)

**No hay ningún `onContextMenu` ni long-press en todo el proyecto** (verificado). Los gestos
vivos: swipe-derecha = atrás (`Layout.jsx:130-168`, solo ≤700px y con detalle abierto),
swipe horizontal en carátula = prev/next y swipe-down = cerrar expandido (`Player.jsx:689,
727, 743`).

Por qué se difiere (4 razones concretas, no instinto):

1. Cada fila ya tiene `onClick = play` (`TrackTable.jsx:40`) → un long-press mal calibrado
   dispara reproducción al soltar.
2. Suprimir el callout nativo de iOS exige `-webkit-touch-callout: none`, que **también mata
   copy/paste** en esa zona.
3. El swipe-atrás de Layout escucha `pointerdown` en el mismo contenedor: un long-press que
   derive 12px (`NAV_AXIS_DIST`, `Layout.jsx:20`) **se convierte en gesto de navegación**.
4. **El que decide:** sin vista de cola, la acción estrella del menú **no se puede verificar
   en móvil**. Sería pelear gestos por un menú cuya acción principal es invisible.

Cuando entre: con la maquinaria de **`mobile-lab`** y con la cola ya visible.

## Reglas duras (no romper)

1. **🔒 `PlayerContext.jsx` está BLOQUEADO** hasta que el usuario confirme MediaSession en el
   carro. No es negociable ni "es solo una función chica".
2. **⚠️ El remapeo de `playedRef`/`historyRef`/`idxRef` va SIEMPRE** que se inserte en medio
   de la cola. Sin él, shuffle y "anterior" quedan sutilmente rotos — el peor tipo de bug:
   silencioso e intermitente.
3. **UN menú, un provider.** Si aparece un segundo componente de menú, algo se hizo mal.
4. **Las acciones que no aplican se OCULTAN, no se deshabilitan.** Un menú con tres ítems
   grises es ruido. Precedente exacto: `goArtist` no se deshabilita, se vuelve **inerte**
   (`Player.jsx:598-607`).
5. **Navegar SIEMPRE por `album_artist`, NUNCA por `artist`.** Es la regla del usuario y el
   backend la respalda: `browse.js:31` filtra `album_artist IS NOT NULL`. Copiá el precedente
   de `goArtist` (`Player.jsx:598-607`): usa `albumArtist`; si falta, hace fetch de
   `api.track(id).album_artist`; si sigue faltando, **`return`** → la acción no aparece.
6. **Backend: NO SE TOCA.** Este frente es 100% frontend. Si creés que hace falta un endpoint,
   **pedilo** (regla de oro #5 de `CLAUDE.md`).
7. **Nada de dependencias nuevas** (ni librerías de menús ni de drag&drop).
8. **`prefers-reduced-motion` y tokens de `:root`** siempre (`ui-polish`).
9. **No re-litigar la unificación de las 3 copias de fila.** El usuario decidió *"un frente,
   una cosa"* (`artist-lab:255-258`). Se cablea en las 5, y se paga.

## Casos borde (resueltos)

- **La pista que YA suena:** "Reproducir" **se queda** (reinicia desde 0 — comportamiento
  esperado). "Reproducir a continuación" sobre la actual es un **no-op → se oculta**.
- **Various Artists:** *sí* es un artista real en la DB (uno de los 7, con 68 pistas/4
  álbumes) → "Ir al artista" **funciona** y lleva a la carpeta VA. Para una pista de un álbum
  VA, el artista real **no tiene vista** (Artistas agrupa por `album_artist`,
  `browse.js:32`). **Se navega por `album_artist` y punto** — no hay decisión que tomar.
- **Pista sin `album_artist`** (las 3 de Red Hot Chili Peppers, las 7 de Metallica sueltas):
  **no tienen vista de artista a la que ir** → la acción **se oculta**. Es
  **curación/tagging del usuario, NO código** (`CLAUDE.md` §Pendientes). No lo "arregles".
- **Cola vacía + "añadir a la cola":** arranca la reproducción (si no, no pasa nada visible).

## Deudas conocidas (anotadas a propósito)

- **"Añadir álbum/artista a playlist" no está**: `api.addToPlaylist(id, trackId)` es de a una
  pista → N requests. Fuera de fase 1. Si se quiere, es un endpoint nuevo → **OK del usuario**.
- **"Ver info" sobre una pista arbitraria** exige subir `InfoPanel`/`infoTrack` fuera de
  `Player.jsx` (hoy `showInfo` es estado local, `:122`). Es un **refactor del Player**, paso
  propio del plan.
- **La vista de cola no incluye reorder** en su primera versión: el drag&drop es un frente de
  gestos propio y colisiona con `Layout.jsx:130` y `Player.jsx:727` — el mismo motivo que
  difiere el long-press. Decidido con el usuario para que la tanda salga.
- **`build.target` sin fijar** (`CLAUDE.md` §Pendientes): afecta a la app entera, no a este
  frente, pero si el menú usa sintaxis moderna el problema no cambia de tamaño.

## Plan por pasos (acordado; un commit cada uno)

| # | Commit | Estado |
|---|---|---|
| 1 | `chore(actions-lab)`: skill + agentes | ✅ este archivo |
| 2 | `feat(player)`: `addToQueue` / `playAfterCurrent` + cola a **estado** + remapeo | 🔒 espera prueba del carro |
| 3 | `feat(ui)`: ContextMenu + provider, desktop, tipo `track`, cableado **solo en `TrackTable.jsx`** (una superficie, para validar) | tras el 2 |
| 4 | `feat(ui)`: tipos `album` y `artist`; `navigate` en `viewProps` | tras el 3 |
| 5 | `feat(ui)`: resto de superficies (Library, Playlists, Albums, Artists, Genres) | tras el 4 |
| 6 | `refactor(player)`: subir InfoPanel/`infoTrack` fuera de Player → "Ver info" sobre cualquier pista | tras el 5 |

**Troceo en releases (acordado):** **v1.6.0** = Artistas (solo, ya listo) · **v1.7.0** =
sistema de cola + vista de cola *sin reorder* · **v1.8.0** = menú contextual, apoyado en una
cola ya probada · el **reorder** después.

## Checklist QA

**Cola** (cuando se desbloquee):
1. `addToQueue` con la cola **vacía** → arranca la reproducción.
2. `addToQueue` durante reproducción → **no interrumpe** lo que suena.
3. `playAfterCurrent` → la insertada suena **inmediatamente después** de la actual.
4. **`playAfterCurrent` + shuffle**: ninguna pista ya sonada vuelve a sonar en el ciclo, y
   ninguna sin sonar se saltea. *(Es el test del remapeo. Si esto falla, el remapeo está mal.)*
5. **`playAfterCurrent` + `prev()` en shuffle** → vuelve a la realmente sonada antes.
6. `repeat: 'all'` con cola crecida → el ciclo cubre las nuevas.
7. La UI **se entera** de los cambios de cola (o sea: la cola es estado, no ref).
8. **MediaSession sigue viva**: metadata, play/pause, prev/next y scrubber en el lockscreen.

**Menú contextual:**
9. Clic derecho sobre fila → menú en el cursor; clic izquierdo normal **sigue reproduciendo**.
10. Menú cerca del **borde derecho / inferior** → se reposiciona, no se sale del viewport.
11. `mousedown` fuera y **Escape** cierran.
12. Pista **sin `album_artist`** → "Ir al artista" **no aparece** (no aparece gris).
13. Pista que **ya suena** → "Reproducir a continuación" **no aparece**.
14. Menú sobre la **Letra abierta** (250) → el menú (260) queda **encima**.
15. **`prefers-reduced-motion`** → sin animación de entrada, colores intactos.
16. Desktop y app **no rotos**; el menú "+" sigue funcionando igual.
