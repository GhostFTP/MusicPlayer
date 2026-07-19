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
- **Producción va en `v1.5.0`** (tag `v1.5.0` → merge `6d0f14b`, desplegado y verificado el
  2026-07-14). El tag más reciente **es** la versión en producción: `main` con auto-deploy
  despliega directo. Para saber la versión real, **leé el tope de `CHANGELOG.md` o
  `git tag --sort=-v:refname | head -1`** — no confíes en versiones citadas en docs o memoria.
- En producción en **https://sonorarev.com** (servidor X99, Dokploy, túnel Cloudflare *Healthy*).
- Auth: Cloudflare Access + Google SSO; auto-login SSO→JWT **desplegado y funcionando**
  (commit `d7a23b6`), con login usuario/contraseña como fallback local. El usuario **ghost**
  fue descartado y los usuarios de prueba (sebas, Kister, GhostFTP, 8431) se limpiaron de la
  DB de producción; quedan solo usuarios reales por SSO.
- DB: **334 pistas FLAC** (tras limpiar 114 filas huérfanas dejadas por el viejo bug del
  scanner, ya corregido — ver abajo). Guarda `codec`, `bits_per_sample`, `sample_rate`,
  `bitrate`, `lossless`, `genre` y —nuevo, ver "Trabajo hecho sin pushear"— `disc_number`/
  `disc_total` (se pueblan al re-escanear). **No** guarda canales ni MBIDs.
- **Scanner: el barrido de huérfanas YA EXISTE** (commit `d5eabe0`, `scanner/index.js:181-216`),
  activo por defecto, con dos guards: aborta si el walk halló 0 archivos (mount caído) y
  aborta si borraría >50% de la tabla Y >10 filas (mount parcial); `--force-prune` fuerza,
  `--no-prune` desactiva. **No volver a listarlo como pendiente.** El scanner **solo corre a
  mano** (`npm run scan`): ni al arrancar, ni por endpoint, ni por cron.
- Artistas (7): Daft Punk, NewJeans, Nujabes, Various Artists, Kali Uchis, Metallica, Treyarch Sound.
- **Frente "auto" (car-lab):** hardware real = **4 carros** — **Mazda 3 2021** (Mazda Connect) y
  **Maverick 2022** (SYNC 4) por **CarPlay/AA**, los dos prioritarios; **RAV4 2016** y
  **Kangoo 2007** por **Bluetooth AVRCP**. Orden pactado **A → C → B**:
  **A) MediaSession ✅ EN PRODUCCIÓN (v1.5.0)** — cubre los 4 carros sin trabajo nuevo, falta
  solo la prueba física; **C) responsivo de teléfono** ← el frente activo; **B) Modo Auto**.
  El contrato completo vive en `.claude/skills/car-lab/SKILL.md` — no duplicar acá.
- Env vars (según `docker-compose.yml`): `NODE_ENV`, `PORT`, `MUSIC_DIR`, `JWT_SECRET`,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOW_REGISTRATION` (servicio `musicplayer`) y
  `CLOUDFLARE_TUNNEL_TOKEN` (servicio `cloudflared`). `JWT_SECRET` y `CLOUDFLARE_TUNNEL_TOKEN`
  son obligatorias: el arranque falla si faltan.

## Trabajo hecho SIN pushear (mapa real de ramas — 2026-07-16)

`origin/main` sigue en **v1.5.0** (`6d0f14b`) — nada de lo de abajo está desplegado. El mapa
REAL (no el recordado), para que una sesión futura no lo redescubra:

- **`feature/sonorarev-integration`** (rama de desarrollo, ~54 commits ahead de su origin):
  - **Artistas — "Retrato" + "Prisma Retrato"** (frente grande, hecho): foto propia por
    artista (`/image` al vuelo, `has_image`), dirección Retrato (3:4, hero con chips), hero
    redistribuido (identidad MusicBrainz + `total_duration`), tarjeta "Cronología", y el
    lenguaje de color **Prisma Retrato** (hue por artista vía `stringHue` con BITS ALTOS,
    hero teñido con L fija, hue hover-only en la lista). Lab `artist-lab`.
  - **disc_number (discos dobles)** — hecho, ver sub-sección abajo.
  - **actions-lab** (equipo skill+engineer+qa): contrato de la cola + menú contextual, **sin
    código aún** (bloqueo activo sobre `PlayerContext` hasta la prueba física de MediaSession).
  - **nav-lab (routing Modelo 2) — HECHO (commits F1.1–F1.4: `2d7267a`…`443cdd1`).** URLs por
    vista y por detalle, atrás/adelante del navegador, deep-linking, F5 que restaura; TODO
    detalle es ruta —incluido el álbum abierto desde un artista/año (`/albums/:aa/:a`)—. El
    Modelo 1 (guardia único) quedó retirado; `AlbumDetail.jsx` borrado. Contrato as-built en
    `.claude/skills/nav-lab/SKILL.md`. **Candidato a v1.7.0.**
- **`main`**: 3 commits ahead de `origin/main` = los **duplicados** del fix de disc_number
  (patch IDÉNTICO a los de feature, distinto SHA — confirmado por `range-diff`). Llegaron por
  un descuido de branch en otra sesión. **No es trabajo extra**: al mergear `feature` esos
  cambios entran por ahí sin chocar (git ve el mismo patch en ambos lados). Recomendación:
  `git branch -f main origin/main` para no arrastrar duplicados — decisión del usuario (es
  producción; no se toca sin OK).

### Fix de disc_number (discos dobles) — full-stack, completo

Los FLAC dobles (Stadium Arcadium, RAM 10th Anniversary) traían DISCNUMBER/DISCTOTAL pero el
scanner no los leía y la DB no tenía columnas → quedaban como disco único con `track_number`
repetido. **Tocó scanner + backend (decisión tomada en otra sesión):**
- **scanner** (`e7896c3`): columnas `disc_number`/`disc_total` vía `ADDED_COLUMNS`; lee
  `common.disk?.no/of` y las incluye en el upsert.
- **api** (`d971ef5`): `ORDER BY COALESCE(disc_number,1), track_number, title` en
  `/albums/:album/tracks` y en `/tracks` con filtro de álbum (los de un disco = disco 1).
- **frontend** (`c325d5a`): separador "Disco N" en `TrackTable` para álbumes de +1 disco.
- **OJO:** las columnas se pueblan solo al **re-escanear** (`npm run scan`); las filas viejas
  quedan `disc_number` NULL → `COALESCE` las trata como disco 1 (inofensivo). Para que los
  dobles se separen en prod, hace falta rescan tras el deploy.

## Pendientes conocidos
- Cerrar `/register` (aún pendiente).
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
  - (Medido contra la DB local el 2026-07-14, que tiene 484 pistas — **no** las 334 de
    producción. Los conteos de arriba son de prod; estos son locales.)
- **`build.target` sin fijar (project-wide, no de una feature):** `music-client/vite.config.js`
  no fija `build.target` → Vite usa el default `'modules'` = **Chrome 87**. Si algún target real
  (HiBy R4 u otro dispositivo con Chrome viejo) queda por debajo, **el bundle entero no arranca**
  (sintaxis ES2020 sin down-level) — no es problema de una feature, es de la app completa.
  Resolver con `@vitejs/plugin-legacy` + bajar el target; decisión aparte. (Pendiente del usuario:
  abrir SonoraRev en el R4 — si carga, Chrome ≥87 y el tema muere; si sale en blanco, se reabre.)

---
_Última actualización: 2026-07-19 (routing Modelo 2 F1.1–F1.4 HECHO — candidato a v1.7.0; contrato nav-lab as-built). NOTA: el conteo "commits ahead" del mapa de ramas quedó viejo — reverificar tras un `git fetch`._
