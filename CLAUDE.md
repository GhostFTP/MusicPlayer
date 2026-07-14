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
- En producción en **https://sonorarev.com** (servidor X99, Dokploy, túnel Cloudflare *Healthy*).
  `main` con auto-deploy despliega directo a producción.
- Auth: Cloudflare Access + Google SSO; auto-login SSO→JWT **desplegado y funcionando**
  (commit `d7a23b6`), con login usuario/contraseña como fallback local. El usuario **ghost**
  fue descartado y los usuarios de prueba (sebas, Kister, GhostFTP, 8431) se limpiaron de la
  DB de producción; quedan solo usuarios reales por SSO.
- DB: **334 pistas FLAC** (tras limpiar 114 filas huérfanas dejadas por el bug del scanner).
  Guarda `codec`, `bits_per_sample`, `sample_rate`, `bitrate`, `lossless`, `genre`.
  **No** guarda canales ni MBIDs.
- Artistas (7): Daft Punk, NewJeans, Nujabes, Various Artists, Kali Uchis, Metallica, Treyarch Sound.
- Env vars (según `docker-compose.yml`): `NODE_ENV`, `PORT`, `MUSIC_DIR`, `JWT_SECRET`,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOW_REGISTRATION` (servicio `musicplayer`) y
  `CLOUDFLARE_TUNNEL_TOKEN` (servicio `cloudflared`). `JWT_SECRET` y `CLOUDFLARE_TUNNEL_TOKEN`
  son obligatorias: el arranque falla si faltan.

## Pendientes conocidos
- **BUG DEL SCANNER (no barre huérfanas):** cuando un archivo cambia de ruta, deja la fila
  vieja en `music.db` → pistas duplicadas. Agregar un barrido de huérfanas al scanner (borrar
  filas cuyo `file_path` ya no exista en disco). Este bug causó 114 duplicados, limpiados a mano.
- Cerrar `/register` (aún pendiente).
- Agregar 2 correos a la política de Cloudflare Access: `fakkis14@…`, `joana.michelle.riv.so@…`.
- **Fase 1.5:** agregar MBIDs + canales al scanner para habilitar MusicBrainz.
- Subagente **album-curator** + ledger.
- Integración de código con GhostFTP en fase posterior.
- **`build.target` sin fijar (project-wide, no de una feature):** `music-client/vite.config.js`
  no fija `build.target` → Vite usa el default `'modules'` = **Chrome 87**. Si algún target real
  (HiBy R4 u otro dispositivo con Chrome viejo) queda por debajo, **el bundle entero no arranca**
  (sintaxis ES2020 sin down-level) — no es problema de una feature, es de la app completa.
  Resolver con `@vitejs/plugin-legacy` + bajar el target; decisión aparte. (Pendiente del usuario:
  abrir SonoraRev en el R4 — si carga, Chrome ≥87 y el tema muere; si sale en blanco, se reabre.)

---
_Última actualización: 2026-07-13._
