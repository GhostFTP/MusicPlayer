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
- **Producción va en `v1.8.1`** (tag `v1.8.1` → merge `0746c01`, desplegado el 2026-07-22). El
  tag más reciente **es** la versión en producción: `main` con auto-deploy
  despliega directo. Para saber la versión real, **leé el tope de `CHANGELOG.md` o
  `git tag --sort=-v:refname | head -1`** — no confíes en versiones citadas en docs o memoria.
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
- **Cola de reproducción (v1.8.0/v1.8.1)** — la cola es **estado** en `PlayerContext` con motor
  por `_qid` (no un ref), con `addToQueue`/`playAfterCurrent` + `forcedNext`. En desktop se abre
  como **columna lateral** montada en `.layout`; en móvil, como overlay del player. El **expandido
  desktop** se rediseñó alrededor de un **drawer único** (`expPanel`: cola o letra) con grabber
  arrastrable que ajusta el **tamaño** del panel. v1.8.1 arregló la cola en el teléfono (no tapa
  el mini player, respeta la barra de estado, toque y espaciado). Contrato:
  `.claude/skills/actions-lab/SKILL.md` — no duplicar acá.
- Env vars (según `docker-compose.yml`): `NODE_ENV`, `PORT`, `MUSIC_DIR`, `JWT_SECRET`,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOW_REGISTRATION` (servicio `musicplayer`) y
  `CLOUDFLARE_TUNNEL_TOKEN` (servicio `cloudflared`). `JWT_SECRET` y `CLOUDFLARE_TUNNEL_TOKEN`
  son obligatorias: el arranque falla si faltan.

## Estado de ramas — nada sin mergear

**No hay features pendientes de desplegar**: todo lo desarrollado ya salió en producción —
Artistas Retrato/Prisma + discos dobles (v1.6.0), Ajustes/cerrar sesión + registro cerrado
(v1.6.1), botón Google (v1.6.2), routing Modelo 2 (v1.7.0) y cola de reproducción + rediseño
del expandido desktop (v1.8.0, con los arreglos móviles de v1.8.1).
`feature/sonorarev-integration` arranca limpio para lo próximo — lo único que tiene fuera de
`main` es este mismo commit de docs, que entra en la próxima tanda. Ojo: la feature branch
**no se pushea** (queda muy por delante de `origin/feature/sonorarev-integration`); lo que
viaja a `origin` es `main` + tags. La versión real siempre sale del tope de `CHANGELOG.md` o
`git tag --sort=-v:refname | head -1`.

## Pendientes conocidos
- Agregar 2 correos a la política de Cloudflare Access: `fakkis14@…`, `joana.michelle.riv.so@…`.
- **Fase 1.5:** agregar MBIDs + canales al scanner para habilitar MusicBrainz.
- Subagente **album-curator** + ledger.
- Integración de código con GhostFTP en fase posterior.
- **CURACIÓN DE BIBLIOTECA (tareas del usuario, NO código — no "arreglarlas" desde el repo):**
  - **Red Hot Chili Peppers no aparece en la vista Artistas**: sus 3 pistas están sueltas en
    la raíz de la biblioteca y **sin tag `ALBUMARTIST`**. La vista filtra
    `album_artist IS NOT NULL` (`browse.js:31`) y el scanner no cae a `artist`
    (`scanner/index.js:140`) → invisibles. Hay una carpeta `Red Hot Chili Peppers` vacía.
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
_Última actualización: 2026-07-22 (v1.8.0 + v1.8.1 DESPLEGADOS y tagueados — cola de reproducción y expandido desktop en producción; CLAUDE.md al día: producción = v1.8.1, nada sin mergear)._
