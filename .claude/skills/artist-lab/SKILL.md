---
name: artist-lab
description: Estándar de la vista de Artistas de SonoraRev (foto propia por artista vía artist.jpg curado, dirección visual "Retrato", endpoint /image con guard de contención, cadena de fallback). Úsala SIEMPRE antes de tocar o auditar cualquier cosa de Artistas (Artists.jsx, endpoints de browse/artists, estilos .artist-*).
---

# Artist Lab — estándar de la vista de Artistas

Fuente de verdad del frente "Artistas". **No cites de memoria: verificá contra el código real.**

## PREMISA (decidida, no re-litigar)

**Cada artista tiene su propia FOTO curada por el usuario** — no la carátula de uno de sus
álbumes. El usuario elige la foto igual que elige la carátula 1200×1200: **la curación es
del usuario, no de una API**.

- **Origen: opción A1** — un `artist.jpg` que el usuario deja en la carpeta del artista, que
  el **endpoint resuelve al vuelo en cada request**. **Sin DB, sin scanner, sin migración.**
- **Descartada la opción B (API externa, Deezer/Last.fm):** fotos genéricas + dependencia de
  red en producción + caché + rate limit, todo para 7 artistas. Desproporcionado y contrario
  a la filosofía de curación. **MusicBrainz no sirve fotos de artista** (por eso `info.js` no
  las trae).
- **Descartada la opción A2 (scanner indexa a la DB):** el **scanner solo corre a mano**
  (`npm run scan`, `scanner/index.js:224`) — no al arrancar, sin endpoint, sin cron. Con A2,
  cambiar una foto obligaría a entrar al contenedor de producción y re-escanear. Eso mata el
  flujo de curación iterativa. **A1 = soltás el archivo y recargás.**
- **La opción C (mosaico/iniciales/color) NO es el origen: es el FALLBACK.**

## Los archivos del sistema

| Archivo | Rol |
|---|---|
| `music-server/src/api/browse.js` | **Backend (el único autorizado).** `GET /artists` (lista + `has_image`), `GET /artists/:artist` (agregados), `GET /artists/:artist/image` (la foto, con guard) |
| `music-client/src/components/Artists.jsx` | Lista + detalle en un solo componente, sin router (navega por estado, early returns) |
| `music-client/src/api/client.js` | `artistImageUrl(name)` + `coverUrl(id)` (token en query param) |
| `music-client/src/styles/main.css` | estilos `.artist-*` |
| `music-server/src/scanner/` | **NO SE TOCA.** El scanner es agnóstico de carpetas a propósito (artista/álbum salen de los tags, `scanner/index.js:136-158`) |

## Datos reales (medidos, no estimados — DB local, 2026-07-14)

**La vista muestra 7 artistas, agrupados por `album_artist` (`browse.js:32`):**
Daft Punk (122 pistas/8 álbumes), Treyarch Sound (121/5), Nujabes (69/4), Various Artists
(68/4), Kali Uchis (66/5), NewJeans (20/5), Metallica (15/2).

| Dato | Valor | Por qué importa |
|---|---|---|
| Carpeta de primer nivel == `album_artist` | **7 de 7** | A1 es viable |
| Cobertura de carátula | **100%** | el fallback nivel 2 SIEMPRE acierta |
| Imágenes en carpetas de artista | **cero** (al empezar) | el día 1 la vista se ve como hoy |
| Pistas sin `album_artist` | **3** (Red Hot Chili Peppers) | invisibles en la vista |

**⚠️ `album_artist` está LIMPIO — la "fragmentación por feats" NO afecta esta vista.** Cero
separadores (`feat`, `&`, `,`, `;`, `/`) en `album_artist`. La fragmentación existe en la
columna **`artist`** (80 valores distintos, 56 fragmentados: `Nujabes feat. Shing02`,
`Kali Uchis & KAROL G`…), pero **la vista Artistas nunca la toca**. No es un bloqueo. No hay
nada que resolver. *(Si alguien vuelve a plantear "hay 31 artistas fragmentados": es falso,
está medido.)*

**Nota:** los conteos salen de la DB **local** (484 pistas). `CLAUDE.md` documenta 334 en
producción. La estructura (los 7 nombres) coincide; los números no.

## Contrato del backend (A1)

### Resolver la carpeta del artista — NO asumir `MUSIC_DIR/<artista>`

**Trampa real:** en local `MUSIC_DIR=C:\Musica` y los artistas cuelgan directo
(`C:\Musica\Daft Punk`). En producción `docker-compose.yml:11,23` monta `/mnt/storage:/music:ro`
con `MUSIC_DIR=/music`, pero la biblioteca vive en `/mnt/storage/Musica` → dentro del
contenedor es **`/music/Musica/<Artista>`**. **Asumir `MUSIC_DIR/<artista>` anda en local y
falla EN SILENCIO en producción.**

Por eso la carpeta se **deriva de la realidad**, con candidatos en orden:

1. `join(MUSIC_DIR, artist)` — la convención (acierta en local).
2. **Del `file_path` real de la DB** (que el scanner ya escribió): para cada pista del
   artista, `dirname(file_path)` y `dirname(dirname(file_path))`. Cubre
   `<raíz>/<Artista>/<Álbum>/pista` **y** `<raíz>/<Artista>/pista`, con cualquier prefijo.

**Filtros obligatorios sobre cada candidato:**
- **Estrictamente dentro de `MUSIC_DIR`** (ni igual a `MUSIC_DIR`, ni fuera).
- `basename(dir) === artist` — desambigua "carpeta de artista" de "carpeta de álbum", y
  descarta las pistas sueltas en la raíz (Metallica tiene 8 en carpeta y **7 sueltas**).

Primer candidato que exista y contenga una imagen, gana.

### Nombres de archivo aceptados

`artist.jpg`, `artist.jpeg`, `artist.png`, `artist.webp` — en ese orden. Case-insensitive no:
se busca el nombre exacto en minúsculas (simple y predecible).

### 🔒 Guard de contención (REGLA DURA — no negociable)

Un endpoint que toma un nombre de la URL y lo convierte en ruta de disco **es exactamente
donde vive el path traversal**. Obligatorio, en este orden:

1. **Rechazar de entrada** todo `artist` que contenga `..`, `/`, `\`, o un NUL byte → `400`.
2. **Verificar la ruta RESUELTA**: `relative(MUSIC_DIR, candidato)` no puede ser vacío, ni
   empezar con `..`, ni ser absoluto. Se aplica a **todos** los candidatos, incluidos los
   derivados del `file_path` de la DB (defensa en profundidad: un `file_path` podría apuntar
   fuera si alguna vez se escaneó otra raíz).
3. Nunca construir la ruta por concatenación de strings: `join`/`resolve` + `relative`.

**El guard NO es opcional ni "ya lo cubre el filtro de arriba".** Los dos pasos van.

### Codificación de nombres (bug silencioso en potencia)

- **Frontend → URL:** `encodeURIComponent(artist)` (patrón ya usado en `client.js:61`).
- **URL → backend:** Express decodifica `req.params.artist` solo (con `decodeURIComponent`).
- **Ya está probado en producción:** `api.artistDetail()` (`client.js:61`) hace exactamente
  este round-trip y funciona hoy con `Various Artists` (espacio). El endpoint de imagen usa
  el mismo mecanismo.
- **Riesgo NUEVO que `artistDetail` no tiene:** `artistDetail` compara **DB contra DB**
  (`album_artist = ?`), byte-idénticas por construcción. El endpoint de imagen compara contra
  el **sistema de archivos** → si el tag está en **NFD** y la carpeta en **NFC** (o al revés),
  `existsSync` falla y la foto no carga, **sin error visible**. **Hoy los 7 nombres son ASCII
  puro → riesgo cero.** Si algún día entra un artista con tilde/`∞`/`–`/`'` y su foto no
  aparece pero el archivo existe, **el sospechoso #1 es la normalización Unicode**
  (`String.prototype.normalize('NFC')`).
- **`/` en el nombre (`AC/DC`):** `encodeURIComponent` lo vuelve `%2F`; Express lo decodifica
  bien, pero **algunos proxies normalizan `%2F` a `/` antes de enrutar** y romperían la ruta.
  Sin casos hoy. Si aparece, se resuelve con query param en vez de path param.

## Dirección visual: "Retrato" (elegida)

**El problema que resuelve:** hoy Artistas **es la tarjeta de Álbumes menos una línea** —
mismo `.album-grid`, mismo `.album-card`, misma tipografía, mismo hover; solo cambia
`border-radius:50%` (`main.css:868-873`, **4 líneas de CSS propio**). Y como esa miniatura
*es* una carátula recortada, un artista de un solo álbum se ve casi idéntico a su propio
álbum en la otra pestaña.

- **Lista:** se muere el círculo y se muere la grilla cuadrada. Tarjetas **verticales 3:4**,
  foto a sangre hasta el borde, degradado oscuro abajo, nombre encima de la foto, contadores
  muted debajo. **Retrato vs cuadrado = imposible de confundir con Álbumes, por estructura.**
- **Detalle:** **hero a sangre** con la foto (hoy el detalle **no tiene ninguna imagen**:
  es un `<h1>` desnudo sobre la grilla, `Artists.jsx:57-73` — la única vista con detalle sin
  hero). Nombre grande superpuesto + **chips de géneros y calidad**, y la misma foto
  **desenfocada y oscurecida** como fondo de la grilla de álbumes.
- **Injerto de la dirección "Roster":** los chips salen de **`api.artistDetail()`**
  (`client.js:61` → `browse.js:40-74`), que **ya devuelve `genres` y `quality`
  {hires, lossless, lossy} y hoy `Artists.jsx` IGNORA** (solo lo usa el InfoPanel). **Dato
  gratis, cero backend nuevo.**
- **Descartada la dirección "Duotono"** (hue por artista tipo `emojiHue`): **el duotono
  destruye la foto curada**, que es justo el punto del frente.

Respetar `ui-polish`: tokens de `:root` (nada de colores mágicos), radios de card ~10px,
easings ya existentes (`cubic-bezier(.34,1.42,.5,1)` para el pop), y **rama de
`prefers-reduced-motion` para toda animación nueva** (se conserva el color, se quita el
movimiento).

## Cadena de fallback (3 niveles — regla dura)

1. **Foto del artista** (`artist.jpg` curado) → si `has_image`.
2. **Carátula** (`coverUrl(sample_track_id)`) — lo de hoy. **Cobertura 100% → SIEMPRE acierta.**
3. **Iniciales / `♪`** — teórico hoy (nivel 2 nunca falla), pero se implementa igual.

**Consecuencia de diseño, y el mayor argumento a favor de A1:** el día 1, sin ninguna foto
subida, **la vista se ve como hoy y no se rompe nada**. Va mejorando artista por artista, al
ritmo de la curación del usuario.

## Casos borde (resueltos)

- **Various Artists / Treyarch Sound (compilados, no personas):** el caso **se disuelve**. El
  sistema no sabe ni le importa si es una persona: el usuario suelta el key art de Black Ops
  en `Treyarch Sound/artist.jpg` y listo. Si no quiere elegir nada, el fallback les deja la
  carátula de hoy. **Decisión de curación, no problema de arquitectura.**
- **Artista sin foto:** cadena de fallback. Nada se rompe.
- **Metallica (8 pistas en carpeta, 7 sueltas en la raíz):** los candidatos derivados de las
  8 dan la carpeta correcta; las 7 sueltas producen candidatos que el filtro descarta.
- **Red Hot Chili Peppers (3 pistas sin `album_artist`):** **no aparecen en la vista** —
  `browse.js:31` filtra `album_artist IS NOT NULL`, y el scanner no tiene fallback a `artist`
  (`scanner/index.js:140`). Es **curación/tagging del usuario, NO código.** No tocar.

## Reglas duras (no romper)

1. **Backend: SOLO `browse.js`.** Nada de scanner, nada de DB, nada de migraciones — el
   usuario autorizó ese archivo y solo ese (regla de oro #5 de `CLAUDE.md`).
2. **El guard de contención va SIEMPRE** (rechazo de entrada + verificación de la ruta
   resuelta). No es negociable ni "ya lo cubre otra cosa".
3. **No asumir `MUSIC_DIR/<artista>`** — derivar del `file_path` real (ver arriba).
4. **La cadena de fallback nunca se salta**: la vista jamás queda sin imagen ni rota.
5. **El detalle SIEMPRE tiene hero.** Era la única vista sin uno; no se vuelve atrás.
6. **Nada de dependencias nuevas ni de red.** La foto es local, del disco del usuario.
7. **`prefers-reduced-motion`** y tokens de `:root` (`ui-polish`).
8. **No inventar datos.** Los chips salen de la DB (`artistDetail`), nunca de una fuente
   externa no pactada.

## Deudas conocidas (anotadas a propósito)

- **Lectura de disco por request:** `GET /artists` hace unos pocos `existsSync` (uno por
  candidato × 7 artistas) y `/image` uno por request. **Sin problema de permisos:** el server
  **ya lee la biblioteca en tiempo de request** — `stream.js:29,42,65` hace `statSync` +
  `createReadStream` sobre `file_path` en cada reproducción. Misma superficie, mismo proceso,
  mismo mount. **Cero permisos nuevos.** Si algún día pesa, la mejora barata es un caché en
  memoria (Map artista→ruta, invalidado por TTL), NO indexar en la DB.
- **`MUSIC_DIR` en el server:** este endpoint es **el primer sitio donde el express lee
  `process.env.MUSIC_DIR`** (hoy solo lo lee el scanner, `scanner/index.js:229`). Está
  definido en `docker-compose.yml:11` y en `.env` local (`npm start` usa
  `--env-file-if-exists=.env`, `package.json:8`). Si faltara, el endpoint degrada a 404 — no
  rompe el arranque.
- **Normalización Unicode (NFC/NFD)** y **`%2F` en nombres**: ver §Codificación.

## Checklist QA

**Backend**
1. 🔒 **Guard de contención**: `..`, `/`, `\` y NUL en `:artist` → **400**, no 404 ni un
   `sendFile`. Probar `GET /api/browse/artists/..%2F..%2Fetc%2Fpasswd/image`.
2. 🔒 **Contención de la ruta resuelta**: todo candidato (incluidos los derivados de
   `file_path`) verificado con `relative()`; ninguno igual a `MUSIC_DIR` ni fuera de él.
3. `has_image` en `GET /artists` refleja la realidad del disco (true solo si hay archivo).
4. `GET /artists/:artist/image` → **404 JSON** si no hay foto (no un 500, no un stack).
5. La resolución **no asume `MUSIC_DIR/<artista>`**: funciona con prefijo
   (`/music/Musica/<Artista>`) y sin él.
6. `Various Artists` (con espacio) resuelve — el round-trip `encodeURIComponent` → Express.
7. **Ni el scanner ni la DB fueron tocados** (`git diff` solo muestra `browse.js`).

**Frontend**
8. Cadena de fallback: con foto → foto; sin foto → carátula; sin carátula → iniciales.
9. **Sin ninguna foto subida, la vista se ve como hoy** (no se rompe nada).
10. Detalle **con hero** + chips de género y calidad (datos de `artistDetail`, no inventados).
11. La lista **no se confunde con Álbumes** (retrato 3:4, no círculo sobre grilla cuadrada).
12. `prefers-reduced-motion`: se anula el movimiento, se conserva el color.
13. Móvil: la grilla de retratos no desborda; sin scroll horizontal.
14. Desktop y el resto de la app intactos.
