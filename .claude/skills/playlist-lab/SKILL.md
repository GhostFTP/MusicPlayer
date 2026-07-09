---
name: playlist-lab
description: Estándar del sistema de playlists de SonoraRev (vista Mosaico Prisma, detalle con hero "Prisma Sólido" + Riel Prisma de orden, sistema de hue por emoji, endpoints REST, reglas duras de orden/scope/hue y checklist QA). Úsala SIEMPRE antes de tocar o auditar cualquier cosa de playlists (Playlists.jsx, emojiHue.js, estilos .pl-*, endpoints de playlists).
---

# Playlist Lab — estándar del sistema de playlists de SonoraRev

Fuente de verdad de la experiencia de playlists: la lista (**Mosaico Prisma**), el
detalle (hero **Prisma Sólido** + **Riel Prisma** de orden + tabla de pistas), el
color por playlist (`--h`) y el contrato con el backend. Antes de opinar o tocar,
**inspeccioná los archivos reales** — este mapa dice dónde vive cada cosa y qué NO
se puede romper. Los números de línea son orientativos (el código se mueve); los
selectores, nombres de función y campos son el ancla.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/components/Playlists.jsx` | TODA la vista. Componente `Playlists` (estados ~10-19), Mosaico/lista (~268-320), detalle (~104-265: hero ~116-160, Riel Prisma ~170-198, tabla bespoke ~199-260). Helpers a nivel módulo: `SORT_MODES` (~325), `sortTracks()` (~335), `fmt()` (~358), `fmtTotal()` (~366). Acciones: `create/remove/open/startRename/saveRename/removeTrack/cycleSort` (~36-94). `sortedTracks` memo (~98) |
| `music-client/src/components/PlaylistCover.jsx` | Portada "collage" reutilizable: recibe `ids` (0..4 track-ids con carátula) + `emoji` de fallback + `lazy`; decide el layout por cantidad (5 casos). Se monta en el medallón del Mosaico y en `.pl-hero-cover`. **NO calcula `--h`** (lo hereda del contenedor) |
| `music-client/src/utils/emojiHue.js` | Deriva `--h` (0-359) del emoji, puro y determinista |
| `music-client/src/styles/main.css` | Estilos `.pl-*`: Mosaico (`.playlist-list`/`.playlist-item`/`.playlist-medallion`), hero (`.pl-hero`/`.pl-hero-cover`/`.pl-kicker`), botones Prisma Sólido (`.pl-detail-actions .btn-primary`/`.mix-btn`/`.pl-del-action` ~1104-1176), Riel (`.pl-sortbar`/`.pl-sort-seg`/`.pl-sort-arrow` ~1180+), portada collage (`.pl-cover*` ~620), tabla compartida `.track-table` (`table-layout:fixed` en móvil) |
| `music-client/src/api/client.js` | Wrappers fetch: `api.playlists()`, `createPlaylist(name, emoji)`, `playlistTracks(id)`, `updatePlaylist(id,{name,emoji})`, `deletePlaylist(id)`, `removeFromPlaylist(plId, trackId)`, `addToPlaylist(...)` (el "+" vive en la Biblioteca) |
| `music-server/src/api/playlists.js` | Endpoints REST (**backend — NO tocar salvo decisión explícita del usuario**) |
| `music-server/src/db/database.js` | Schema `playlists` (~47) y `playlist_tracks` (~55) |

Componentes reutilizados: `EmojiPicker.jsx` (elige emoji al crear/renombrar),
`ShuffleButton.jsx` (`.mix-btn` — global), `QualityChip.jsx` (badge de calidad).

## Contrato con el backend (endpoints reales)

Todo pasa por `authMiddleware` y está **acotado a `req.user.id`** (cada usuario ve
solo sus playlists). Los que devuelven pistas mandan **solo datos reales de la DB**.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/playlists` | Lista del usuario con `track_count` (LEFT JOIN + COUNT) y `sample_covers` (para la portada collage: **string JSON** con array de hasta 4 `track_id` **con carátula**, por `position` — subquery `json_group_array` + `LIMIT 4`, filtra `cover_path IS NOT NULL`; 0 filas → `"[]"`). Campos: `id, name, emoji, user_id, created_at, track_count, sample_covers`. `ORDER BY created_at, id` |
| POST | `/api/playlists` | Crea. `name` obligatorio (400 si falta), `emoji` opcional |
| GET | `/api/playlists/:id/tracks` | Pistas de la playlist. Campos: `id, title, artist, album, duration, cover_path, codec, bits_per_sample, sample_rate, bitrate, lossless, position`. **`ORDER BY pt.position`** |
| POST | `/api/playlists/:id/tracks` | Agrega `track_id`. `position = MAX(position)+1`. `INSERT OR IGNORE` (PK compuesta): si ya estaba → `{ already: true }`, si no → `{ position }` |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Quita una pista (204) |
| PATCH | `/api/playlists/:id` | Renombra y/o cambia emoji (campos opcionales; 400 si no viene ninguno) |
| DELETE | `/api/playlists/:id` | Borra la playlist (204) |

### Schema (database.js)

- `playlists`: `id` PK AUTOINCREMENT, `name` NOT NULL, `emoji` TEXT (opcional,
  agregado por migración ~86), `user_id`, `created_at` DEFAULT `datetime('now')`.
- `playlist_tracks`: `playlist_id` + `track_id` (**PRIMARY KEY compuesta**),
  `position` INTEGER NOT NULL. Ambas FKs con **`ON DELETE CASCADE`** (borrar la
  playlist o la pista limpia sus filas solo). **No hay columna `added_at`.**

### `position` = orden de agregado (proxy de fecha)

`position` se asigna **`MAX(position)+1`** al agregar y **NUNCA se reordena** (no
hay ningún `UPDATE position` en todo el backend). Por eso `position` ES el orden
cronológico de agregado, y es el proxy que usa el modo "Añadido" del Riel. No
existe drag-and-drop de reordenar ni fecha de agregado explícita: si algún día se
quiere reordenar manual, es una feature de backend nueva (pactar con el usuario).

## Sistema de hue (`--h`) — la identidad Prisma

`emojiHue(emoji)` = `(emoji.codePointAt(0) * 2654435761 >>> 0) % 360` (multiplicativo
de Knuth → buen spread angular, los emojis "de música" no se agrupan). **Puro,
determinista, cero backend**: se calcula en cliente del emoji ya guardado. Default
`'🎵'`.

Se inyecta como CSS var `--h` en tres lugares, y por ser el mismo emoji da el
**mismo color** en los tres (coherencia Mosaico → hero → Riel):

- **Mosaico**: `.playlist-item` con `style={{ '--h': emojiHue(pl.emoji), '--i': idx }}`
  (`--i` escalona la animación de entrada).
- **Detalle**: `.pl-hero` y `.pl-sortbar`, ambos con `'--h': emojiHue(playlist.emoji)`.

Regla de oro del hue: **concentrar el color en piezas chicas saturadas** (medallón,
botón Reproducir, segmento activo del Riel, kicker) y **aflojar los fondos** para
no apilar dos washes planos del mismo hue. Por eso `.pl-hero` va con alpha bajo
(`.45`) y se apaga al 78% antes de que empiece el `.pl-sortbar` de abajo. Lenguaje
compartido con el segmento activo del Riel: wash `hsl(var(--h) 55% 55% / .16)` +
aro `inset … hsl(var(--h) 60% 60% / .35)`.

## Portada de la playlist — collage 2×2 (`PlaylistCover`)

La portada (medallón del Mosaico y `.pl-hero-cover` del detalle) ya **no es
solo-emoji**: se arma como **collage 2×2** con las carátulas de las primeras 4
pistas, vía `PlaylistCover.jsx`. El **emoji sigue guardado** y cumple dos roles:
**fuente del `--h`** (sin cambios) y **fallback** de portada.

- **De dónde salen las 4 covers**:
  - **Mosaico**: del campo `sample_covers` de `GET /api/playlists` (string JSON de
    hasta 4 `track_id` con carátula) → `parseCovers()` en `Playlists.jsx`
    (`JSON.parse` con try/catch → `[]`). Cada id se sirve con `coverUrl(id)`.
  - **Hero**: derivado en cliente de **`selected.tracks`** (las primeras 4 con
    `cover_path != null`), **NUNCA de `sortedTracks`** → la portada es **estable**
    ante el Riel y el buscador (regla dura: la portada no cambia al reordenar/filtrar).
    Derivación por lectura (`.filter().slice().map()`), sin mutar `selected.tracks`.
- **5 casos** (los decide `PlaylistCover` por cantidad de ids): 4 → grid 2×2 ·
  3 → 2×2 con la 4ª celda wash `--h` · 2 → split · 1 → full-bleed ·
  **0 → emoji** sobre el wash `--h` (idéntico a antes, cero regresión).
- **`--h` intacto**: `PlaylistCover` **no** calcula el hue; lo hereda del contenedor
  (`.playlist-item`/`.pl-hero`). El wash/aro `--h` queda como marco del collage y
  relleno de las celdas vacías → el sistema Prisma no se rompe.
- **Degradación**: si el server no manda `sample_covers` (build viejo), el Mosaico
  cae al caso 0 (emoji), como antes. Imgs del Mosaico con `loading="lazy"`.

## Orden de pistas — el Riel Prisma (`sortTracks`)

- **Modos** (`SORT_MODES`): `added` (usa `position`), `title`, `artist`, `album`.
  Los tres de texto son **nullable**; `position` es numérico.
- **Default**: `added` / `desc` (últimas agregadas arriba, estilo Spotify).
  `open()` **resetea** a `added`/`desc` en cada playlist.
- **`cycleSort(key)`**: tocar el modo YA activo **voltea** la dirección; cambiar de
  modo arranca en su **dirección natural** (texto → `asc` A-Z; `added` → `desc`).
- **`sortTracks(tracks, mode, dir)`** (regla dura, no romper):
  - Ordena una **COPIA** (`[...tracks]`) — **jamás muta `selected.tracks`**.
  - `null`/`''` en title/artist/album van **SIEMPRE al final**, en asc y en desc
    (el chequeo de vacío devuelve `+1`/`-1` ANTES de aplicar el signo → el toggle
    no los sube). No invertir esto.
  - Texto: `localeCompare(…, { sensitivity: 'base', numeric: true })` (acentos/ñ +
    orden numérico natural). `added`: resta numérica `(a.position ?? 0) - (b.position ?? 0)`.
- **`sortedTracks`** (`useMemo` sobre `[selected, sortMode, sortDir]`) es el ÚNICO
  array que se renderiza Y el que se pasa a `play()`. Ver regla dura de `play()`.

## Hero del detalle — "Prisma Sólido"

- **Reproducir** = pill relleno teñido `hsl(var(--h) 55% 42%)`, texto blanco, glow
  hue, `min-height:44px`. Domina. **Mix** (`ShuffleButton` → `.mix-btn`) = pill
  ghost mismo hue, subordinado. **Papelera** con `margin-left:auto`, hover rojo,
  lejos de la principal.
- **Todo scopeado** a `.pl-detail-actions .btn-primary` / `.mix-btn` (overrides
  contextuales). Las clases GLOBALES `.btn-primary`/`.mix-btn` quedan intactas.
- **Meta con duración total**: `fmtTotal()` suma `track.duration` de las pistas
  (dato ya cargado, derivado en cliente — **no es dato nuevo de DB**) y devuelve
  `null` si el total es 0 → el hero muestra solo "N canciones" (nunca "0 min").

## Reglas duras (NO romper)

1. **No mutar `selected.tracks`.** Cualquier orden/derivación copia primero
   (`[...tracks]`). El estado es la fuente; ordenar es una vista.
2. **`play()` recibe el array ORDENADO** (`sortedTracks`), no el del render sin
   ordenar. El `.map()`, cada `play(sortedTracks, i)` de fila y el `play(sortedTracks, 0)`
   de Reproducir usan el MISMO array → el índice de reproducción coincide con la
   fila visible. Si ordenás para mostrar pero reproducís otro array, suena la pista
   equivocada: es el bug clásico de esta vista.
3. **Nulls al final** en `sortTracks`, en ambas direcciones (ver arriba).
4. **Scope de estilos a `.pl-*`.** NUNCA tocar `.btn-primary`/`.mix-btn` globales:
   los comparten Albums/Artists/Genres/AlbumDetail/Years. Todo override va
   contextual bajo `.pl-detail-actions` (o clases nuevas `.pl-*`). No tocar
   `.pl-sortbar` sin motivo (Riel Prisma, aprobado).
5. **Solo datos reales de la DB** (regla del CLAUDE.md). Nada de inventar campos:
   el payload de tracks es fijo (ver contrato). Lo derivable en cliente (duración
   total, hue) está OK; datos nuevos (added_at explícito, reordenar) son backend.
6. **`--h` coherente**: mismo emoji → mismo color en Mosaico, hero y Riel. No
   apilar washes; concentrar el hue en piezas chicas.
7. **reduced-motion: color sí, movimiento no.** Flip de la flecha del Riel, lift de
   los pills, entrada del Mosaico → se anulan; el color/estado se conserva.
8. **Backend y scanner fuera de ámbito** salvo decisión explícita del usuario.

## Quirks / notas conocidas

1. **La tabla del detalle es BESPOKE** (no usa `TrackTable.jsx`): `<table
   className="track-table">` escrita a mano en Playlists.jsx (~245+). Replica la
   estructura de celda de TrackTable (`.track-info-cell` → `.track-text` con
   `min-width:0` → `.track-title` + `.track-sub`); si se simplifica esa celda,
   mantené la envoltura `.track-text`. **Truncado del título: lo garantiza
   `table-layout: fixed`, NO solo el `min-width:0`.** Bug real ya resuelto (commit
   `106042a`, móvil): un título largo se cortaba pegado al borde derecho SIN "…"
   porque con `table-layout: auto` el min-content de un `<td>` con un flex
   `min-width:0` + texto `nowrap` adentro es **inconsistente en motores reales**
   (WebKit/Chromium del device) — el motor le da a la columna del título el ancho
   del texto completo, la tabla desborda el viewport y
   `.main-content { overflow-x: hidden }` la **clippea sin ellipsis**. El análisis
   estático NO lo reproduce (no modela ese cálculo del motor) → **no diagnostiques
   "sin ellipsis" como caché/build viejo**. Fix vigente (actualizado — pulido de
   densidad en desktop): `.track-table { table-layout: fixed }` es ahora **la
   regla base**, fuera de cualquier `@media` (antes vivía solo dentro de
   `@media max-width:700px`; ya NO hay `auto` en desktop) → los anchos los fijan los
   `th` (num 44 · artista/álbum 22%/22% · calidad 124 · time 64 · actions 46,
   título = el resto), y `.track-title`/`.track-album` truncan con ellipsis en
   **todos los tamaños** (antes el título solo truncaba en el `@media` móvil, y
   álbum no truncaba nunca en desktop → álbumes largos, ej. "Call of Duty: Black
   Ops – Zombies (Original Game Soundtrack)", wrappeaban y estiraban la fila). El
   bloque móvil ya no redeclara `table-layout`/`.track-title`; solo conserva lo que
   sigue siendo propio de móvil (ocultar columnas artista/álbum/calidad, área
   táctil de fila más alta). También bajó el padding vertical de `.track-row td`
   (9px → 6px) para una densidad tipo Spotify desktop. Es GLOBAL (las 3 vistas
   montan la misma `.track-table`): el defecto y el fix son del layout compartido,
   no de playlist.
2. **`emoji` es opcional** (nullable en DB): siempre hay fallback `'🎵'` en el
   render y en `emojiHue()`.
3. **`ON DELETE CASCADE`**: no hace falta limpiar `playlist_tracks` a mano al
   borrar una playlist o una pista; la DB lo hace.
4. **Optimistic updates**: `create/remove/saveRename/removeTrack` actualizan el
   estado local (incluido `track_count`) sin re-fetch. Cualquier acción nueva debe
   mantener el estado local y el server coherentes.

## Checklist QA de playlists

1. **Mosaico**: cada tarjeta con su `--h` por emoji; misma playlist = mismo color
   en lista, hero y Riel. Entrada escalonada (`--i`), animación respeta
   reduced-motion.
2. **CRUD**: crear (emoji + nombre), renombrar (nombre + emoji vía EmojiPicker),
   eliminar. `track_count` y el estado local quedan coherentes sin re-fetch.
3. **Hero Prisma Sólido**: kicker teñido, título, meta "N canciones · duración",
   Reproducir (pill relleno) + Mix (pill ghost) hermanados con el hue, papelera
   flotando lejos. Todo ≥44px.
4. **Duración**: `fmtTotal` suma `track.duration` real; playlist sin duraciones o
   vacía → muestra solo "N canciones" (jamás "0 min").
5. **Riel Prisma**: 4 modos, abre en "Añadido ↓"; tocar el activo voltea; cambiar
   de modo arranca en dirección natural (texto asc, Añadido desc).
6. **`sortTracks`**: pistas sin artista/álbum al final en asc Y en desc;
   acentos/ñ ordenan bien; NO muta el array original.
7. **`play()` con array ordenado**: clic en una fila reproduce ESA fila; ▶
   Reproducir arranca la primera fila visible; todo consistente tras reordenar.
8. **Scope de estilos**: abrir Álbumes/Artistas/Géneros/AlbumDetail/Años → sus
   botones `.btn-primary`/`.mix-btn` siguen intactos (los overrides `.pl-*` no se
   filtran).
9. **reduced-motion**: sin flip/lift/entrada; color y estado intactos.
10. **Móvil ≤700px** (390 / 360): Riel full-width con segmentos ≥44px y ellipsis;
    pills del hero comparten renglón y envuelven a 360px; título de la tabla
    trunca con "…"; sin scroll horizontal.
11. **Backend/contrato**: `position = MAX+1` sin reordenar; `INSERT OR IGNORE` no
    duplica (mismo track dos veces → `{already:true}`); todo acotado a `user_id`;
    borrar playlist/pista cae por `ON DELETE CASCADE`.

## Entorno de QA (limitación conocida)

**No hay dispositivos reales en este entorno.** El QA cubre **código + lo
verificable en DevTools** (device mode, emulación táctil, reduced-motion). Lo que
exija hardware real (sensación táctil, Safari iOS de verdad, HiBy R4) se marca
**🔍 REQUIERE PRUEBA FÍSICA** con pasos exactos — las hace Oscar en sus dispositivos.
