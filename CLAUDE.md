# SonoraRev

Reproductor de música self-hosted ("Spotify propio") para una colección FLAC
obtenida legítimamente. Uso interno, equipo autorizado. Repo base de **GhostFTP**;
**Oscar (BASH)** tiene acceso de colaborador.

## Stack
- **Backend:** Node 22 + Express + SQLite (`node:sqlite`). Auth con bcrypt (cost 12).
- **Frontend:** React 18 + Vite.
- **Infra:** Docker + Dokploy + Traefik.
- **Scanner:** `music-server/src/scanner/` usa `music-metadata`.

## Reglas de oro (NO romper)
1. Desarrollo en **`feature/sonorarev-integration`**. `main` es la rama de **PRODUCCIÓN** con
   **auto-deploy activo en Dokploy**: se mergea a `main` con `--no-ff` cuando hay un bloque
   listo. **Mergear a `main` = despliegue automático a producción** → hacerlo solo con OK
   explícito del usuario.
2. Antes de cualquier commit: **`npm run build` debe pasar**.
3. **Siempre** mostrar el diff antes de commitear. **Nunca** push sin OK explícito del usuario.
4. Excluir de los commits salvo indicación: `package-lock.json`. (`.claude/settings.local.json` ya está en `.gitignore`.)
5. **No tocar backend ni scanner** salvo decisión explícita; la mayoría de las tareas son frontend.

## Flujo de trabajo
Incremental con aprobación: proponer → explicar el porqué → esperar visto bueno.
Comunicación casual en español. Basarse en **datos reales** (inspeccionar DB/código
antes de recomendar), no en supuestos genéricos. Conservador con producción.

## Convenciones UI / datos
- El panel de Info y los resúmenes muestran **solo datos reales de la DB**. Nunca
  inventar biografías ni traer fuentes externas no acordadas.
- Badge de calidad por tier vía `qualityTier()` en `QualityChip.jsx`: hi-res **cian** /
  lossless **verde** / lossy-high **ámbar** / lossy-low **rojo** / unknown **gris**.
  El color es el tier **nominal del formato**, **no** prueba de lossless genuino
  (eso lo da el análisis espectral en curación).
- Las animaciones respetan `prefers-reduced-motion`.

## Estado actual
- **`main` va en `v1.15.0`** (tag `v1.15.0` → merge `3721ac3`, mergeado y tagueado el
  2026-08-23). Para saber la versión real, **leé `git tag --sort=-v:refname | head -1`** o el
  tope de `CHANGELOG.md`: los dos sirven y hoy coinciden. No confíes en versiones citadas en
  docs o memoria, incluida la de este archivo.
- ⚠️ **`main` == tag NO implica `main` == producción, y este archivo lo daba por hecho.**
  Decía que el *rolling update* de Dokploy **era** el reinicio y que el auto-deploy "despliega
  directo" (verificado con v1.13.0, backend puro). **Con v1.15.0 no se cumplió**: al 2026-08-25,
  dos días después del merge, producción seguía corriendo una imagen anterior a `3721ac3` — el
  endpoint nuevo daba 404. Se destrabó y **al 2026-08-30 v1.15.0 está desplegado y verificado**.
  Lo que queda es la causa, porque va a volver a pasar.

  **CAUSA RAÍZ — Dokploy saltea el build y hace rolling update de una imagen vieja.** El log
  del deploy decía, textual:

  ```
  No build configuration changed & image found with the same Git Commit SHA.
  Build step skipped.
  ```

  O sea que el deploy **corrió y terminó en verde**, pero sin construir nada: reusó una imagen
  cacheada y solo reinició el contenedor. Por eso el síntoma es tan traicionero — Dokploy no
  reporta ningún fallo, no queda un build en rojo que mirar, y el contenedor arranca sano. El
  `/api/health` responde 200 y todo parece bien. Lo único que delata que corre código viejo es
  **pedirle al backend algo que solo existe en la versión nueva**.

  **LA SONDA, que no necesita credenciales ni `Bearer`.** Separa "ruta montada" de "ruta
  inexistente" porque `authMiddleware` responde `401` y el fallback SPA de `server.js:44`
  responde `404` seco para todo lo que empiece con `/api`:

  ```
  /api/health     -> 200 {"status":"ok"}       el origen está vivo
  /api/tracks     -> 401 {"error":"No token"}  control: una ruta que seguro existe
  /api/plays/top  -> 401 {"error":"No token"}  la ruta nueva EXISTE  -> desplegado
                  -> 404                       la ruta nueva NO existe -> NO desplegado
  /api/noexiste   -> 404                       control negativo
  ```

  **Regla: después de mergear a `main`, pegarle al endpoint nuevo antes de dar el release por
  desplegado.** Un deploy en verde no es evidencia; un `401` en la ruta nueva sí. Si da 404,
  el build se salteó y hay que **forzar un rebuild** — un Redeploy a secas no alcanza, porque
  es justo la operación que reusa la imagen.
  ⚠️ **FALTA ANOTAR cómo se forzó el rebuild el 2026-08-30** (¿toggle de "clean cache" en
  Dokploy, un commit nuevo que cambie el SHA, borrar la imagen a mano?). Es el paso que
  cierra este bucle: sin él, la próxima vez se vuelve a perder el tiempo buscándolo.
- En producción en **https://sonorarev.com** (servidor X99, Dokploy, túnel Cloudflare *Healthy*).
- Auth: Cloudflare Access + Google SSO; auto-login SSO→JWT **desplegado y funcionando**
  (commit `d7a23b6`), con login usuario/contraseña como fallback local. **Registro cerrado**
  (solo por invitación, v1.6.1) y **botón "entrar con Google"** en el login (v1.6.2, usa el
  endpoint público `GET /api/auth/config`). Vista **Ajustes** con **cerrar sesión** (en desktop
  y móvil, v1.6.1). El usuario **ghost** fue descartado y los usuarios de prueba se limpiaron
  de la DB de producción; quedan solo usuarios reales por SSO.
- DB: **~653 pistas FLAC**. Guarda `codec`, `bits_per_sample`, `sample_rate`, `bitrate`,
  `lossless`, `genre` y `disc_number`/`disc_total` (discos dobles, v1.6.0; se pueblan al
  re-escanear). **No** guarda canales ni MBIDs. El viejo bug de filas huérfanas del scanner
  ya está corregido (barrido de huérfanas activo, ver abajo).
- **Scanner: el barrido de huérfanas YA EXISTE** (commit `d5eabe0`, `scanner/index.js:181-216`),
  activo por defecto, con dos guards: aborta si el walk halló 0 archivos (mount caído) y
  aborta si borraría >50% de la tabla Y >10 filas (mount parcial); `--force-prune` fuerza,
  `--no-prune` desactiva. **No volver a listarlo como pendiente.** El scanner **solo corre a
  mano** (`npm run scan`): ni al arrancar, ni por endpoint, ni por cron.
- Artistas (lista base curada): Daft Punk, NewJeans, Nujabes, Various Artists, Kali Uchis,
  Metallica, Treyarch Sound. Foto propia por artista vía `GET /image` (`has_image`) + identidad
  MusicBrainz vía `artistInfo`/`artistDetail` (v1.6.0, `artist-lab`). La lista creció al sumar
  música — reverificar el conteo real contra la DB.
- **Frente "auto" (car-lab):** hardware real = **4 carros** — **Mazda 3 2021** (Mazda Connect) y
  **Maverick 2022** (SYNC 4) por **CarPlay/AA**, los dos prioritarios; **RAV4 2016** y
  **Kangoo 2007** por **Bluetooth AVRCP**. Orden pactado **A → C → B**:
  **A) MediaSession ✅ EN PRODUCCIÓN (v1.5.0)** — cubre los 4 carros sin trabajo nuevo, falta
  solo la prueba física; **C) responsivo de teléfono** ← el frente activo; **B) Modo Auto**.
  El contrato completo vive en `.claude/skills/car-lab/SKILL.md` — no duplicar acá.
- **Navegación: Modelo 2 (v1.7.0)** — cada vista y cada detalle (artista/álbum/género/año/
  playlist) tiene su propia URL; deep-linking, F5 restaura, atrás/adelante del navegador.
  Routing **a mano** sobre la History API (sin react-router). Contrato as-built:
  `.claude/skills/nav-lab/SKILL.md`.
- **Cola de reproducción (v1.8.0 → v1.9.0)** — la cola es **estado** en `PlayerContext` con motor
  por `_qid` (no un ref), con `addToQueue`/`playAfterCurrent` + `forcedNext`. En desktop se abre
  como **columna lateral** montada en `.layout` (`showQueue` → `.layout--queue`), y el **expandido
  desktop** se rediseñó alrededor de un **drawer único** (`expPanel`: cola o letra) con grabber
  arrastrable que ajusta el **tamaño** del panel. v1.8.1 arregló la cola en el teléfono (no tapa
  el mini player, respeta la barra de estado, toque y espaciado).
- **Cola móvil = hoja arrastrable (v1.9.0)** — en el teléfono la cola dejó de ser un overlay
  full-screen: es una **hoja anclada abajo que convive con la canción**, sube desde abajo y se
  **arrastra** para agrandarla o cerrarla, con **dos alturas** (al estirar, el bloque de la
  canción pasa a su composición compacta y le cede el alto). Es la **contraparte móvil del
  drawer de desktop**: misma vía (`expPanel`), así que hereda la escalera `dismissTop` de
  nav-lab sin peldaño nuevo. Y es **una sola cola**: la mini barra ya no abre el overlay viejo
  sino que promueve al expandido y abre ahí el mismo drawer → `showQueue` **ya sólo existe en
  desktop**. Contrato del motor: `.claude/skills/actions-lab/SKILL.md`; gestos:
  `.claude/skills/mobile-lab/SKILL.md` — no duplicar acá. **Las dos skills se reescribieron
  as-built en v1.10.0** y ya no van atrasadas.
- **Listas de canciones que se adaptan al ancho (v1.9.0)** — cuando falta ancho, la tabla de
  pistas **reflowea a modo lista** (carátula + título/artista, sin columnas) en las **cuatro
  vistas** (Álbum, Género, Playlists, Biblioteca) y también en **móvil**. Dispara **por CSS**,
  con dos triggers duplicados en `main.css` (no hay container queries): `(max-width:1024px)` y
  `.layout--queue @ (max-width:1344px)` — la cola roba `--queue-w` (320px) **sin** cambiar el
  viewport, y `1344 = 1024 + 320`; ⚠️ **si cambia `--queue-w` hay que recalcular ese 1344**. En
  modo lista **no se muestra la calidad** (el chip inline desbordaba sobre la duración): se
  consulta desde **Info**. Es el trade del patrón, no un olvido.
- **Menú contextual de acciones (v1.10.0)** — **un** solo `ContextMenu.jsx` + provider montado en
  `App.jsx`: las superficies sólo llaman `openMenu(e, {type, item})` y el menú arma sus acciones
  según el tipo. Se pinta de **dos formas, y lo decide QUIÉN lo abrió, no el ancho** (`tiles` se
  congela al abrir → achicar la ventana no le cambia la cara al clic derecho):
  · **desktop** = popover-**lista** glass, disparado por **clic derecho** y por el botón **"⋯"**
  de cada fila, que **reemplazó al "+"** en `.col-actions` y está **siempre visible** (el "+"
  sobrevive en la barra y el expandido, que es donde se renombran/borran playlists);
  · **móvil** = **grid de tiles 2×N** flotante **anclado al toque**, disparado por **long-press**
  (`utils/useLongPress.js`, 500ms / 10px de tolerancia, gate por ancho ≤700). Los tiles van
  **teñidos con su identidad desde el reposo** (morado cola/nav · teal playlist · ámbar info):
  **invierte a propósito** la convención de `ui-polish` ("apagado hasta el hover") porque en el
  teléfono no hay hover que esperar — desktop conserva la suya. **Sin blur** (capas sólidas) y con
  **scrim que SÍ intercepta**: sin él, el toque de "cerrar afuera" seguía viaje y reproducía la
  fila de abajo.
  **Acciones (máx. 6, sobre pista):** a continuación · a la cola · agregar a playlist ▸ · ir al
  artista · ir al álbum · ver info. Por tipo: fila de cola **5** (quitar, en vez de encolar),
  álbum y artista **3**. Las que no aplican **se ocultan, no se deshabilitan**. Navegar
  **siempre** por `album_artist`. La cola y la navegación no se implementan acá, se **reúnen**:
  salen de `PlayerContext` y del host (`Player.jsx` vía `registerHost`).
  **Motor:** se sumó **`removeFromQueue(qid)`** — toma un **`_qid`**, no un índice; se niega
  sobre la que suena, y limpia `playedRef`/`historyRef`/`forcedNext` (+ su espejo `upNextIds`)
  recomputando `idxRef` por `findIndex`. Es el caso canónico de por qué la cola se keyea por
  `_qid`. **No toca MediaSession.**
  **Ya no falta cablear nada** — lo que v1.10.0 dejó pendiente se cerró en v1.10.1 (abajo).
  Contrato completo: `.claude/skills/actions-lab/SKILL.md`; lo táctil:
  `.claude/skills/mobile-lab/SKILL.md` — no duplicar acá.
- **El menú llega a todas las superficies (v1.10.1)** — `Genres.jsx` y `Playlists.jsx` ya llaman
  `openMenu`, y tienen **long-press** las tarjetas de **álbum** (`AlbumGrid.jsx`, `Albums.jsx`),
  los **retratos** de artista (`Artists.jsx`) y las tarjetas de **género** (`Genres.jsx`). El
  long-press entra por una **puerta explícita**: `via: 'longpress'` en el payload — sin esa marca
  `openMenu` sigue descartando el móvil por `matchMedia`, así que el gate no se aflojó, se le
  abrió una puerta con nombre. En playlists el **"✕" de cada fila lo absorbió el "⋯"** (quitar
  pasó a ser la primera acción del menú); no fue sólo consistencia: con la lista reflowada, en el
  teléfono el "✕" quedaba fuera de la fila y no había otra vía. **Única línea de backend** de toda
  la serie: `GET /api/playlists/:id/tracks` trae ahora **`t.album_artist`** en el SELECT
  (`music-server/src/api/playlists.js:50`) — sin eso, "ir al artista" desde una playlist no tenía
  por dónde navegar.
- **Reordenar la cola arrastrando (v1.11.0) — sólo escritorio** — la **tercera pata** del trípode
  que el keying por `_qid` venía habilitando (insertar, quitar, reordenar):
  **`moveInQueue(qid, toIndex)`** (`PlayerContext.jsx:311`). Permuta el array y **no toca lo que
  suena** — no llama a `playIndex` ni al `<audio>`, y MediaSession (que cuelga de
  `currentTrack`/`isPlaying`) ni se entera: reordenar cambia el **plan**, nunca la reproducción en
  curso. Lo único posicional del motor es `idxRef`, recomputado por `findIndex(_qid)`. `toIndex` es
  la posición **ya sin la pista movida** (splice-remove-then-insert). `played`/`history` **no** se
  tocan (son `_qid`; permutar el plan no reescribe lo que ya sonó); `forcedNext` **sí**: mover a
  mano una pista marcada "a continuación" **revoca el pill**, porque forcedNext gana sobre el orden
  y si no el arrastre mentiría.
  ⚠️ **Con aleatorio encendido el reorden es cosmético**: el motor elige del pool de no-sonadas y
  no mira el orden. Es **decisión tomada, no olvido** — el aviso vive en el header de la cola
  ("Aleatorio · orden de la cola") desde v1.8.0, y por eso tampoco se menciona en el CHANGELOG.
  **El gesto** (`QueueOverlay.jsx`): pointer events **a mano**, sin librerías; handlers en el `<ul>`
  con filtro por target, así las filas memoizadas no reciben ni una prop nueva (sólo un `data-qid`).
  Durante el arrastre **no se pasa por React** —transforms y marcas se escriben sobre los nodos— y
  React se entera **una sola vez, al soltar**: con estado por frame se re-renderizarían las ~650
  filas. Umbral de 6px y el click posterior se traga en fase de **captura**. Gate **desktop-only**
  con doble red: `matchMedia('(min-width: 701px)')` en el pointerdown **y** las reglas CSS dentro
  de su `@media`.
  **Autoscroll de bordes:** franja `EDGE_ZONE` 56px arriba/abajo, velocidad **cuadrática** hasta
  `EDGE_V_MAX` 1600 px/s, continua por rAF. Sin esto el reorden sólo alcanzaba **lo visible**. El
  desplazamiento se mide en **coordenadas de contenido** (puntero + lo que scrolleó la lista): los
  dos `scrollTop` se cancelan para la posición visual y **sí** suman para el índice destino, que es
  lo que permite cruzar cientos de filas. El auto-scroll a la pista actual **se abstiene** mientras
  hay arrastre — los dos mueven el mismo nodo.
  **El asentamiento al soltar:** `SNAP_MS` 170ms con `SNAP_EASE`
  `cubic-bezier(.34, 1.56, .64, 1)` (overshoot en la **curva**, no en keyframes) y `LIFT`
  `scale(1.03) rotate(-1.2deg)` compuesto en el JS —no en la clase CSS, que el transform inline
  pisaría—. Se **anima primero y se commitea al terminar** (mismo truco que `snapQueue`), y el
  destino sale de la **geometría**, no de una medición nueva. Bajo `prefers-reduced-motion` el snap
  cae directo; el autoscroll **sí** corre igual, porque es **funcional, no decorativo**.
  ⚠️ **Que no se malinterprete: no hay FLIP ni reacomodo de vecinas.** Las filas de alrededor
  **no se mueven en ningún momento**; el destino se comunica **sólo** con una línea de 2px
  (`queue-row--drop-before` / `--drop-after`) y se anima **únicamente la fila arrastrada**. El
  reacomodo animado del hueco quedó como **pendiente opcional** (ver abajo).
- **Arrastrar HACIA la cola — drag-to-enqueue (v1.12.0), desktop-only y sólo con la cola abierta** —
  la contraparte del reorden: aquél mueve DENTRO de la cola, éste trae cosas de afuera. Se arrastra
  **una canción** (fila de `TrackTable` —que cubre Álbum y Género—, `Library` y `Playlists`), **un
  álbum** (`AlbumGrid` —Artistas y Años— y `Albums`), **un artista** (`Artists`) o **un género**
  (`Genres`), y soltarlo en la columna de la cola **encola todo al final**; en `dragover` la columna
  **se ilumina** (`queue-panel--drop`) y al soltar sale un **toast con el conteo**.
  ⚠️ **El mecanismo es HTML5 DnD NATIVO, y NO los pointer events del reorden.** No es capricho: el
  gesto **cruza dos subárboles distintos del DOM** —la tabla vive en `.main-content`, la cola es la
  3ª columna del grid— y todo gesto de la casa captura el puntero, con lo cual los eventos se
  **re-targetean al capturador** (el mismo motivo está escrito en el banner de `useLongPress.js`):
  la columna no vería un solo `pointermove` y habría que hacer hit-testing a mano con
  `elementFromPoint` por frame. Además este drop **no tiene posición** (soltar en cualquier parte =
  al final), así que desaparece justo la parte donde el enfoque a mano brillaría. **Los dos
  mecanismos conviven sin verse**: un drop cruzado no genera `pointerdown` (el reorden ni se entera)
  y una fila de cola no dispara `dragstart` (no es draggable).
  **El motor NO se tocó**: `addToQueue` se **invoca** y nada más — MediaSession, `_qid`, `played`/
  `history`/`forcedNext` intactos.
  **Piezas:** `context/DragQueueContext.jsx` (provider montado en `Layout`, `dragProps(item, kind)`
  + `takeDrag()`), y el destino en `QueueOverlay` detrás de la prop **`acceptsDrop`, que pasa SÓLO
  `Layout`** — el mismo componente se monta también en el drawer del expandido y como hoja móvil, y
  ahí no hay arrastre que recibir. El drop cuelga de `.queue-panel` y **no** de `.queue-list`,
  porque con la cola vacía el `<ul>` no se renderiza y ése es justo el caso donde encolar **arranca
  la reproducción**.
  **`utils/itemTracks.js` es ahora la fuente COMPARTIDA** de `albumTracks`/`artistTracks`/
  `genreTracks`: salieron de `ContextMenu.jsx` **tal cual** (movimiento puro, sin cambiar un
  parámetro) porque desde v1.12.0 tienen dos consumidores —el menú y el drop— y copiarlas era
  garantizar que un día una encolara un conjunto distinto del que muestra la vista. Los **textos**
  de los toasts también son los del menú. **`artistTracks` filtra por `album_artist`** (regla dura):
  usa `item.artist`, que en la vista de Artistas **ya ES** `album_artist` porque el backend lo
  aliasea en `GET /browse/artists` → la regla se cumple sola.
  **Gate**, doble red como el reorden: `enabled` = `showQueue` (con la cola cerrada la fila/tarjeta
  **ni se vuelve `draggable`** — no se auto-abre nada) **y** `matchMedia('(min-width: 701px)')` en
  el `dragstart`, que hace `preventDefault()` y cancela si un resize dejó la cola abierta en móvil.
  **Detalles que no son cosméticos:** el MIME propio **`application/x-sonorarev-item`** es lo único
  con lo que el destino distingue un arrastre nuestro de una imagen o un archivo (en `dragover` el
  navegador **no** deja leer los datos, sólo `types`); y **`draggable={false}` en las `<img>`** de
  filas y tarjetas (`TrackTable`, `Library`, `Playlists`, `AlbumGrid`, `Albums`, `ArtistImage`),
  porque una imagen es arrastrable **nativamente** y agarrar por la carátula arrancaba el arrastre
  de la IMAGEN en vez del de la fila. La tarjeta de **género no lo necesita**: su "carátula" es un
  emoji, que es texto. El **ghost** lo pinta el navegador **fuera del DOM** → cero impacto en la
  escalera de z (no hizo falta token nuevo).
  **DOS destinos desde v1.12.1** (ver abajo). Contrato: `.claude/skills/actions-lab/SKILL.md`.
- **La barra del reproductor, 2º destino del drop (v1.12.1)** — soltar sobre `.player-bar` encola
  igual que soltar en la columna. La diferencia entre las dos zonas es de **DISPONIBILIDAD, no de
  conducta**: la columna existe sólo con la cola abierta y **la barra está siempre**, así que
  encolar arrastrando **ya no obliga a abrir la cola**. Ésa es toda la razón de ser de esta zona.
  **El drop es UNO SOLO**: se extrajo a **`useQueueDropTarget()`** (en `DragQueueContext.jsx`,
  junto al resto del contrato), que devuelve `{ dropOver, dropHandlers }`; cada zona sólo aporta su
  nodo y su clase (`queue-panel--drop` / `player-bar--drop`). `DROP_SETS` y el guard del MIME viven
  ahí. `QueueOverlay` pasó de ~70 líneas de drop propio a **una**. Si cambia un texto o entra un
  kind nuevo, cambia en las dos zonas o en ninguna. El parámetro `active` deja que la columna **no**
  acepte sin romper el orden de hooks.
  ⚠️ **CAMBIÓ EL GATE DEL ORIGEN, y es consecuencia directa de lo anterior.** `dragProps` colgaba de
  `enabled = showQueue`: con la cola cerrada **nada era arrastrable**, así que una barra que acepta
  drops con la cola cerrada no habría recibido nunca nada. Hoy `enabled` es **el ancho**, resuelto
  con un `matchMedia` **reactivo** (`useIsDesktop` en el provider — `draggable` es un atributo del
  DOM, así que al cruzar el breakpoint por resize hay que re-renderizar para quitarlo), y `Layout`
  **ya no le pasa `enabled`**. No es un permiso que se aflojó: la premisa que lo justificaba —"sin
  cola abierta no hay dónde soltar"— dejó de ser cierta.
  **TRADE ACEPTADO por el usuario:** como las filas ahora son **siempre** arrastrables en desktop,
  **se perdió seleccionar el título de una fila arrastrando** — el navegador prioriza el arrastre
  del elemento. Antes sólo pasaba con la cola abierta. Revertirlo es volver `enabled` a `showQueue`,
  y ahí la barra sólo serviría con la cola abierta, que es casi no servir.
  **Los controles de la barra no se tocan, por construcción:** `dragover` sólo hace
  `preventDefault()` —el permiso que la API exige— y prende un booleano; lo único que encola es el
  `drop`, al soltar. Pasar por encima no puede activar play/seek/volumen porque no se emite ningún
  evento de puntero, y el `openNowPlaying` de la barra tampoco corre (un `drop` no sintetiza un
  `click`, y el navegador ya suprime el click posterior a un arrastre).
  **El resalte es distinto al de la columna a propósito:** aquélla se tiñe entera porque es una
  lista; la barra está llena de información y controles, y teñirle el fondo taparía la canción que
  suena y sugeriría que algo va a pasarle al play. Va un **filo de 2px en el borde superior** (más
  un tinte apenas morado), en `box-shadow` y no en `border-top` para no correr un píxel del
  contenido al encenderse.
- **Carátulas diferidas (v1.12.3)** — `loading="lazy"` en las cinco superficies de alta
  cardinalidad: `Library.jsx:253`, `TrackTable.jsx:84`, `Playlists.jsx:350`, `Albums.jsx:151` y
  `AlbumGrid.jsx:53`. Biblioteca montaba **una `<img>` por pista** sin paginar ni virtualizar
  (`limit: 10000` + `.map()` sin `slice`): 1979 requests / 22s, casi todo en *Pending* con 0 B —
  **cola de conexiones, no peso**. Funciona porque el layout **no** depende de la carga
  (`.track-art` es 40×40 fijo, `.album-cover` usa `aspect-ratio: 1`); sin dimensiones la
  página colapsaría, todo quedaría "en viewport" y se bajaría igual. **No hay
  virtualización** en ninguna vista, y sigue sin haberla.
- **Alta por lote en playlists (v1.13.0)** — `POST /api/playlists/:id/tracks` acepta ahora
  `{ track_ids: [...] }` además del `{ track_id }` de siempre (aditivo: los clientes viejos no
  cambian ni un campo). Dedupe, tope de 2000, y transacción **a mano** con `BEGIN`/`COMMIT`
  porque `db.transaction()` **no existe** acá — es de better-sqlite3 y este backend usa
  `node:sqlite`. Devuelve contadores (`added`/`already`/`skipped`). ⚠️ **Todavía sin
  consumidor de frontend**: el endpoint está en producción y nadie lo llama.
- **Timeout de red y caché de carátulas (v1.13.1)** — `request()` (`api/client.js`)
  era un `fetch` pelado **sin timeout**: si `cfLogin()` se colgaba, la promesa nunca resolvía,
  el `finally` de `reauth()` no bajaba `checking` y **`App.jsx:10` devolvía `null` para
  siempre** → pantalla en blanco con la música sonando (el `<audio>` es un `new Audio()`
  que vive en `PlayerProvider`, **por encima** de `App`, y no se entera del desmontaje). Ahora hay
  `AbortController` a 10s que **no pisa** el `signal` del llamador (`LyricsPanel` manda el suyo).
  Y el cover pasó a `sendFile(..., { maxAge: '1y' })`: el default de `send` es `max-age=0`,
  que obliga a revalidar en **cada** uso. **Sin `immutable` a propósito** — la URL no es
  content-addressed, así que `immutable` dejaría una carátula retagueada congelada un
  año, sin salida.
- **Miniaturas de carátula (v1.14.0)** — `music-server/src/covers/thumbs.js`: JPEG de 480px
  q80 en `data/thumbs/`, generadas **bajo demanda** y servidas por `?size=thumb` sobre el endpoint
  de siempre (sin el parámetro devuelve el original, intacto). Medido sobre 1213 carátulas:
  **320 MB → 51 MB (6.2×)**, 43 kB de promedio, 11.2s en frío y **82ms** con todo
  fresco. Vencimiento por `mtime(thumb) < mtime(cover)`, así que retaguear un álbum
  regenera **sólo ese** álbum. Semáforo de 3 + single-flight por id; escribe a
  temporal con el pid en el nombre y `rename`, porque el calentador corre en **otro proceso**
  (`npm run scan`, con `--no-thumbs` para saltearlo) mientras el server sirve. Si sharp falla
  devuelve `null` y **se cae al original**: nunca un 500 por una miniatura. El calentador va
  **antes** del barrido de huérfanas a propósito — ese bloque sale por `return` en sus
  dos guards y colgarlo del final lo dejaría sin correr con `--no-prune` o con el mount
  caído. **Dos consumidores siguen en original a propósito**, con el porqué escrito al
  lado: `.exp-art` (300px CSS × DPR 3 ≈ 900px reales) y el artwork de MediaSession, que se
  le entrega al **SO** declarando 512. ⚠️ `sharp` **obligó a commitear
  `music-server/package-lock.json`** — excepción explícita a la regla de oro 4: el
  Dockerfile corre `npm ci`, que **aborta** si el lock no está sincronizado con
  `package.json`. No hizo falta tocar el Dockerfile: libvips viene precompilado y estático, y
  `--omit=dev` conserva las `optionalDependencies` (sólo `--omit=optional` las
  descartaría).
- **Registro de reproducciones (v1.15.0)** — `music-server/src/api/plays.js` y la tabla
  `plays` en `database.js`. Es una **tabla de eventos y no un contador** en `tracks`: un
  `play_count` no se puede desagregar después, y sin `played_at` no hay "lo más escuchado este
  año" ni resumen anual. **`played_at` lo pone el DISPOSITIVO**, no el servidor — la app móvil
  se usa sin señal y encola en disco, así que una semana de escucha offline llegaría toda
  junta y con la fecha del insert quedaría registrada el día que hubo wifi.
  **`client_id TEXT NOT NULL UNIQUE`** es la idempotencia del reintento: un envío cortado a la
  mitad se reintenta entero y el `INSERT OR IGNORE` no duplica; sin esto los conteos se inflan
  y nadie se entera. **`ON DELETE CASCADE` en las dos FK** porque `plays` guarda QUÉ
  escuchaste y un huérfano no tendría qué mostrar — ⚠️ el precio es que **un rescan que borre
  una pista se lleva su historial**, y si algún día tiene que sobrevivir a los rescans hay que
  **desnormalizar título y artista** dentro de `plays`. **Por lote desde el día uno**
  (`{ plays: [...] }`, tope 500): el alta de canciones en playlists nació singular y costó un
  frente entero corregirlo. Mismo `BEGIN`/`COMMIT` a mano y mismo try/catch **por fila** que
  aquel, y por el mismo motivo — `INSERT OR IGNORE` **no** cubre las FK (el `ON CONFLICT` de
  SQLite aplica a UNIQUE, NOT NULL, CHECK y PRIMARY KEY), así que una pista borrada abortaría
  el lote entero y el cliente reintentaría el mismo envío para siempre; esas caen en
  `skipped`. Agregados en `GET /api/plays/top?type=tracks|artists|albums` y
  `GET /api/plays/stats`, los dos con `since` en epoch ms y agrupando por `album_artist`, la
  regla de siempre. ⚠️ **Sin consumidor en el web**: hoy lo llama solo la app móvil.
- **Herramienta de snapshots (`.claude/tools/snap/`)** — tooling **local** de verificación visual
  con Playwright headless, nacido en esta serie. `snap.mjs` captura una ruta del Modelo 2 en los
  **tres anchos** que importan de una corrida; `snap-ctx.mjs` abre el **menú contextual móvil**
  (390×844 con `isMobile`+`hasTouch`, el único régimen donde existe) simulando el long-press con el
  puntero —down, esperar >500ms sin moverse, up—, que entra por la misma puerta que el dedo porque
  `useLongPress` no mira `pointerType`. `session.mjs` centraliza la sesión: hace el **mismo
  `POST /api/auth/login`** que haría el formulario y siembra el JWT en `localStorage` — **no**
  fabrica tokens ni lee el secreto de firma. Requiere backend en `:3000` y Vite en `:5173` (o
  `SNAP_BASE`), con credenciales en `.claude/tools/snap/.env` (`SNAP_USER`/`SNAP_PASS`).
  **No entra al bundle ni a la imagen**: no lo importa nadie de la app y `.dockerignore` excluye
  `.claude`. Versionados los `.mjs` + `package.json`; **ignorados** `.env`, `node_modules/`,
  `shots/` y `package-lock.json`. **No reemplaza la prueba física**: en headless
  `env(safe-area-*)` vale 0 y la sensación del gesto real no se mide.
- Env vars (según `docker-compose.yml`): `NODE_ENV`, `PORT`, `MUSIC_DIR`, `JWT_SECRET`,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOW_REGISTRATION` (servicio `musicplayer`) y
  `CLOUDFLARE_TUNNEL_TOKEN` (servicio `cloudflared`). `JWT_SECRET` y `CLOUDFLARE_TUNNEL_TOKEN`
  son obligatorias: el arranque falla si faltan.

## Estado de ramas — una rama sin mergear

**`main` va en `v1.15.0`** (`3721ac3`), en sincronía con `origin/main`, y el tag está
pusheado. Lo que llegó desde el último repaso de este archivo: carátulas diferidas (v1.12.3),
alta por lote en playlists (v1.13.0), timeout de red + caché de carátulas (v1.13.1),
miniaturas (v1.14.0) y el registro de reproducciones (v1.15.0). ⚠️ **Llegó a `main` no
significa llegó a producción** — ver §Estado actual: v1.15.0 estuvo CINCO días mergeado y
tagueado sin desplegarse, con el deploy en verde, porque Dokploy salteó el build.

**Una sola rama tiene commits que NO están en `main`:**
- **`feature/user-admin-cli` — 4 commits.** El CLI de administración de usuarios
  (`music-server/src/admin/users.js`, `npm run users`): `list`, `passwd`, `create`, más su
  documentación en README y CLAUDE.md. Nunca se mergeó. Ojo: **la sección de
  administración de usuarios de este archivo vive en esa rama**, no acá — al cambiar de
  rama, CLAUDE.md cambia debajo tuyo.
`feature/plays` (`efc27e9`) **ya está en `main`** desde el merge `3721ac3`.
⚠️ **Cómo se numeró, porque el error casi sale publicado:** ese commit había renombrado la
entrada ya publicada de **`1.14.0` (miniaturas) a `1.15.0`** e insertado el registro de
reproducciones **como `1.14.0`** — pero `v1.14.0` era un tag que ya existía y apuntaba a las
miniaturas. Se invirtió **antes** de mergear (miniaturas se quedó en `1.14.0`, plays pasó a
`1.15.0`), así que hoy el CHANGELOG publicado y los tags coinciden. La regla que queda: **el
CHANGELOG de una feature branch puede pisar un número ya tagueado; comprobarlo contra
`git tag` ANTES del merge, no después.**

`feature/sonorarev-integration` está **al día con `main`** salvo este mismo commit de docs.
`feature/playlist-bulk-add` es un resto ya mergeado (su commit `f4193eb` está en `main` desde
v1.13.0).

⚠️ **Cambió el flujo de ramas.** Este archivo decía que la feature branch "no se
pushea"; hoy `feature/plays`, `feature/playlist-bulk-add` y `feature/sonorarev-integration`
**tienen upstream en `origin`**. Lo que sigue igual es que **mergear a `main` DISPARA el
deploy** — con la salvedad de v1.15.0: dispararlo no es lo mismo que completarlo.

**Este archivo va un release atrás por construcción** cuando su commit de docs viaja dentro
de la tanda siguiente. La versión real sale de `git tag --sort=-v:refname | head -1` o del
tope de `CHANGELOG.md`, que hoy coinciden.

**Deuda de QA de v1.10.0:** de los 6 commits de esa tanda que llegaron a producción, 4 (fases
A1/B/D y el botón "⋯") venían de sesiones anteriores y **no se les corrió un QA funcional
completo** antes del deploy — se verificó build, el popover de desktop y una captura del menú
móvil, no el recorrido entero (encolar/quitar con shuffle, playlist, navegación, cadena de
cierres). El subagente `actions-qa` sigue disponible para auditarlo contra el contrato.

**QA de v1.11.0 — parcial, y se sabe cuál parte falta:** el usuario **validó el arrastre en
escritorio** al cerrar la serie, y los tres commits pasaron build. Lo que **no** se ejercitó es
la interacción del reorden con el resto del motor: mover la pista marcada **"a continuación"**
(que debe hacer desaparecer el pill), reordenar **cruzando la pista actual**, reordenar con
**aleatorio** encendido (donde el efecto es cosmético a propósito), y confirmar que en el
**teléfono** el gesto sigue sin existir. Mismo subagente `actions-qa` para auditarlo.

**QA de v1.12.0 — validado a mano, fase por fase:** el usuario probó en escritorio las tres
tandas antes de commitear cada una (canción, después álbum, después artista/género), y confirmó
que el reorden de la cola **convive** con el arrastre nuevo. Lo que **no** se ejercitó: los
caminos de **error** (álbum/artista/género **sin pistas** → aviso ámbar; fetch caído), soltar
sobre la **cola vacía** (debe arrancar la reproducción), y que el drop **rechace** un arrastre
ajeno (una imagen o un archivo de afuera no debe iluminar la columna).

**QA de v1.12.1 — validado a mano en escritorio:** el usuario confirmó que soltar en la barra
encola **con la cola abierta y cerrada**, que los **controles quedaron intactos** y que el trade
de la selección de texto no molesta. Sigue **sin ejercitarse** lo mismo que en v1.12.0 (caminos de
error, cola vacía, rechazo de un arrastre ajeno) — ahora también **sobre la barra**, que comparte
el handler: lo que se audite en una zona vale para la otra, porque es el mismo hook.

## Pendientes conocidos
- Agregar 2 correos a la política de Cloudflare Access: `fakkis14@…`, `joana.michelle.riv.so@…`.
- **Reacomodo animado de las vecinas al arrastrar en la cola** (opcional): hoy el hueco no se abre
  y el destino se comunica sólo con la línea de 2px. La curva del snap (`SNAP_EASE`) ya queda
  lista para reusarse tal cual.
- **Emoji-picker de playlists — alcance sin definir (pendiente del usuario).** Estado real hoy
  (`EmojiPicker.jsx`): lista **fija de 24 emojis** (`PLAYLIST_EMOJIS`), sin búsqueda ni emoji
  libre, y cierra por clic afuera con **`mousedown`** — que **diverge del estándar de la casa**
  (`ContextMenu` usa `pointerdown` a propósito, porque en el teléfono `mousedown` es un evento
  sintetizado). No hay una deuda escrita en el código ni en las skills: **preguntar qué se quiere**
  antes de tocarlo, en vez de suponer que es "agregar más emojis".
- **Modo Auto (car-lab, fase B):** último tramo del orden pactado A → C → B. Contrato en
  `.claude/skills/car-lab/SKILL.md`. Sigue pendiente también la **prueba física** de MediaSession
  en los 4 carros.
- **Fase 1.5:** agregar MBIDs + canales al scanner para habilitar MusicBrainz.
- Subagente **album-curator** + ledger.
- Integración de código con GhostFTP en fase posterior.
- **CURACIÓN DE BIBLIOTECA (tareas del usuario, NO código — no "arreglarlas" desde el repo):**
  - **Red Hot Chili Peppers no aparece en la vista Artistas**: sus 3 pistas están sueltas en
    la raíz de la biblioteca y **sin tag `ALBUMARTIST`**. La vista filtra
    `WHERE album_artist IS NOT NULL AND album_artist <> ''` (`music-server/src/api/browse.js`,
    en `GET /browse/artists` — ojo: es `src/api/`, no `src/routes/`) y el scanner no cae a
    `artist` (`scanner/index.js:140`) → invisibles. Hay una carpeta `Red Hot Chili Peppers` vacía.
    Se resuelve **tageando**, no tocando el scanner.
  - **Metallica a medias**: 8 pistas en su carpeta y **7 sueltas en la raíz**.
  - (Medido contra la DB local el 2026-07-14, que tenía 484 pistas — **no** las ~653 de
    producción de hoy. Reverificar si RHCP/Metallica siguen vigentes tras la música nueva.)
- **`build.target` sin fijar (project-wide, no de una feature):** `music-client/vite.config.js`
  no fija `build.target` → Vite usa el default `'modules'` = **Chrome 87**. Si algún target real
  (HiBy R4 u otro dispositivo con Chrome viejo) queda por debajo, **el bundle entero no arranca**
  (sintaxis ES2020 sin down-level) — no es problema de una feature, es de la app completa.
  Resolver con `@vitejs/plugin-legacy` + bajar el target; decisión aparte. (Pendiente del usuario:
  abrir SonoraRev en el R4 — si carga, Chrome ≥87 y el tema muere; si sale en blanco, se reabre.)

---
_Última actualización: 2026-08-30 (v1.15.0 —registro de reproducciones— mergeado y tagueado el 2026-08-23 y **DESPLEGADO Y VERIFICADO el 2026-08-30**. Estuvo cinco días en `main` sin llegar a producción: Dokploy dio el deploy por bueno pero salteó el build —"image found with the same Git Commit SHA"— y solo reinició una imagen vieja. En §Estado actual quedan la causa y la sonda sin credenciales que distingue código nuevo de código viejo. Sin mergear queda solo `feature/user-admin-cli`)._
