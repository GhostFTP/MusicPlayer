# Music Player

Reproductor de música personal con streaming desde tu propio servidor. Sirve tu biblioteca local con soporte de seek, carátulas y playlists, accesible desde cualquier navegador — incluyendo móviles y DAPs como el Hiby R4.

## Características

- **Streaming con HTTP Range Requests** — seek instantáneo sin descargar el archivo completo
- **Scanner de metadatos** — extrae título, artista, álbum, año, duración y carátula automáticamente
- **Autenticación JWT** — acceso protegido con usuario y contraseña
- **Responsive** — funciona en escritorio, móvil y DAPs (probado en 480×800)
- **Un solo servidor en producción** — el backend sirve también el frontend compilado
- **Vista "Ahora reproduciendo"** — pantalla completa con carátula difuminada, dos columnas en escritorio, swipe sobre la carátula para cambiar de canción y Esc para cerrar
- **Navegación clickeable** — clic en la canción, el artista o el género de la barra te lleva a su álbum, artista o género
- **Playlists con emoji** — cada playlist puede llevar su propio emoji
- **Silenciar rápido** — un clic en la bocina silencia y otro restaura el volumen
- **Novedades in-app** — una sección muestra el CHANGELOG renderizado dentro de la app

> Las novedades de cada versión están en el [CHANGELOG](CHANGELOG.md) (y en la vista **Novedades** dentro de la app).

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 22+ · Express · SQLite (`node:sqlite`) |
| Auth | JWT · bcrypt |
| Metadatos | music-metadata |
| Frontend | Vite · React 18 |

## Estructura

```
MusicPlayer/
├── music-server/
│   ├── server.js              # punto de entrada
│   ├── src/
│   │   ├── api/               # rutas REST (auth, tracks, albums, playlists)
│   │   ├── stream/            # streaming con Range Requests
│   │   ├── scanner/           # indexa carpeta de música
│   │   ├── db/                # esquema SQLite
│   │   ├── auth/              # JWT middleware + gateo por rol
│   │   ├── users/             # reglas de usuarios (las comparten la API y el CLI)
│   │   ├── radio/             # modo radio: reglas y estado EN MEMORIA (sin tabla)
│   │   ├── locutor/           # locutor: hechos, frase y servicio (puros; sin base ni Express)
│   │   ├── ia/                # cliente de Ollama (timeout, lectura acotada, cortacircuitos)
│   │   └── admin/             # CLI de usuarios
│   ├── scripts/               # smoke tests (usuarios, cuenta, login con Google)
│   ├── music/                 # ← pon aquí tus archivos de audio
│   ├── data/                  # music.db + carátulas (auto-generado)
│   └── public/                # build del frontend (auto-generado)
└── music-client/
    ├── src/
    │   ├── components/        # Layout, Player, Library, Albums, Playlists…
    │   ├── context/           # AuthContext, PlayerContext
    │   ├── api/               # cliente fetch
    │   └── styles/            # CSS (tema oscuro, responsive)
    └── vite.config.js
```

## Instalación

Requiere **Node.js 22 o superior** (usa `node:sqlite` incorporado).

```bash
# Clonar
git clone https://github.com/GhostFTP/MusicPlayer.git
cd MusicPlayer

# Instalar dependencias del backend
cd music-server && npm install

# Instalar dependencias del frontend
cd ../music-client && npm install
```

## Uso

### Desarrollo

Dos terminales con hot-reload:

```bash
# Terminal 1 — backend en puerto 3000
cd music-server
npm run dev

# Terminal 2 — frontend en puerto 5173
cd music-client
npm run dev
```

Abre **http://localhost:5173**

---

### Producción

Un solo proceso, un solo puerto:

```bash
cd music-server
npm run build       # compila el frontend y lo copia a public/
node server.js      # sirve API + frontend desde puerto 3000
```

Abre **http://localhost:3000**

> Solo necesitas volver a ejecutar `npm run build` cuando modifiques el frontend.

---

### Escanear tu música

Copia tus archivos de audio a `music-server/music/` (o usa cualquier ruta) y ejecuta:

```bash
cd music-server

# Escanear la carpeta music/ por defecto
npm run scan

# Apuntar a otra carpeta
node src/scanner/index.js /ruta/a/tu/musica
```

Formatos soportados: `.mp3` `.flac` `.ogg` `.m4a` `.aac` `.wav` `.opus` `.wma`

El scanner extrae los tags del archivo y guarda en la base de datos: título, artista, álbum, artista de álbum, año, número de pista, duración y carátula (si está embebida). Puedes re-escanear en cualquier momento — actualiza los existentes y añade los nuevos.

---

## Administración de usuarios

No hay alta pública: los usuarios los crea un administrador. Hay dos vías y las dos
usan las **mismas reglas** (`music-server/src/users/service.js`), así que dan el mismo
resultado.

### Desde la web o la app — `/api/admin/users`

Los cuatro endpoints están detrás de sesión **y** de rol `admin`; a un usuario normal
le responden `403`. Están en la tabla de la [API](#api).

**El correo, desde la 1.19.0.** Es con lo que el login por Google encuentra una cuenta, y
un admin lo pone, lo cambia o lo quita con `PATCH /api/admin/users/:id`:

```jsonc
{ "email": "persona@gmail.com" }   // lo pone o lo cambia
{ "email": null }                  // lo quita: la cuenta deja de entrar con Google
```

- Se guarda **en minúsculas y sin espacios**; tiene que tener forma de correo (una `@`,
  algo antes, un dominio con punto, 254 caracteres como mucho). Si no, `400`.
- No puede ser el correo de **otra** cuenta (`409`, con su nombre) ni el **nombre** de
  otra cuenta (`409`): esa otra se ligaría a Google por su nombre, y con las dos puertas
  abiertas Google no sabría a cuál entrar.
- Mandar el que ya tiene es un no-op: `200`, sin escribir nada.
- **Cada cambio deja una línea en el log del servidor**, con quién lo hizo, en qué cuenta
  y el correo de antes y el de después. Un correo equivocado le da a otra persona las
  playlists, el historial y hasta el rol de alguien, y sin esa línea no queda rastro.
- ⚠️ **Cambiar o quitar un correo no cierra ninguna sesión**: el correo no viaja en el
  token. Y a quien usa el reproductor web, su próximo login por Cloudflare con el correo
  viejo le **crea una cuenta nueva vacía** (Cloudflare sí da de alta), salvo que su nombre
  sea ese mismo correo.

**El alta con correo** (`POST /api/admin/users` con `email`) hace **opcional la
contraseña**: sin ella, la cuenta entra solo con Google hasta que alguien le ponga una.
Sin correo, la contraseña sigue siendo obligatoria.

**Ver la contraseña de alguien, desde la 1.23.0** (`GET /api/admin/users/:id/password`).
Contesta `{ "password": "…" }`, o `{ "disponible": false }` si no hay copia: una cuenta que
entra solo con Google, una contraseña puesta antes de la 1.23.0, o un servidor sin
`PASSWORD_VIEW_KEY`. Un admin ve la de cualquier usuario normal y la suya, **nunca la de
otro admin** (`403`). La copia se guarda **cifrada** con una llave que vive fuera de la base,
cada consulta deja su línea en el log (sin la contraseña) y la respuesta no se cachea.

### Cada quien, con lo suyo — `PATCH /api/me`

Lo único de la API de cuentas que **no** pide ser admin. Cambia **una** de las dos cosas
por petición —el nombre o la contraseña, no las dos a la vez— y devuelve `{ me, token }`.

```jsonc
{ "username": "nuevo-nombre" }
{ "currentPassword": "la de ahora", "newPassword": "la nueva" }
```

- La contraseña **exige la actual**: sin eso, una sesión abierta en un teléfono prestado
  alcanzaría para dejar a su dueño fuera de su propia cuenta. Si no coincide, `401`.
- El **correo no se toca acá**: uno no puede cambiarse el suyo. Lo pone un admin (arriba, o
  con `set-email` desde el CLI) y lo escriben los inicios de sesión que traen una identidad
  verificada —Cloudflare Access y Google desde la app— para vincular una cuenta existente.

### Entrar con Google desde la app — `POST /api/auth/google`

La app del teléfono obtiene un **ID token** de Google con su cliente OAuth de iOS y lo
manda acá; el servidor lo verifica y devuelve el JWT de siempre.

```jsonc
// POST /api/auth/google
{ "idToken": "<el ID token de Google>" }
// 200
{ "token": "<JWT>", "me": { /* lo mismo que GET /api/me */ } }
```

- Se verifica con `google-auth-library`: la firma, el emisor, el vencimiento y que la
  **audiencia** sea `GOOGLE_IOS_CLIENT_ID`. Sin esa variable la ruta responde `503`.
- Tiene que venir con **`email_verified`**; si no, `401`.
- **No crea cuentas**, a diferencia de Cloudflare Access: ahí la política de Access ya
  decidió quién entra, y acá no filtra nadie antes. Entra quien ya tiene cuenta con ese
  correo —o la tenía con el correo como nombre, y en ese caso se vincula—; el resto recibe
  `403`. Si el correo coincide con el **nombre** de otra cuenta que tiene otro correo,
  `409`, igual que Cloudflare.
- **10 intentos por IP cada 15 minutos**; del 11º en adelante, `429` con `Retry-After`. La
  IP sale de `CF-Connecting-IP`.
- Prueba: `npm run smoke:google` levanta sus propios servidores sobre una base temporal,
  con un verificador falso (`GOOGLE_FAKE=1`, que no arranca en producción).
- El `token` que devuelve es **por comodidad, no una revocación**: el anterior sigue
  siendo válido, porque el servidor decide siempre por el id y nunca por el nombre. Sirve
  para que el cliente no muestre el nombre viejo durante los siete días que dura la sesión.

### El avatar

Cada cuenta tiene **una** de dos cosas, nunca las dos: un **emoji** o una **foto**. Poner
una quita la otra. Sin ninguna, el cliente dibuja la inicial del nombre.

`GET /api/me` y la lista de admin lo devuelven ya resuelto, para que ningún cliente tenga
que decidirlo por su cuenta:

```jsonc
"avatar": { "kind": "emoji", "value": "🎵" }
"avatar": { "kind": "photo", "url": "/api/users/7/avatar?v=1789688211000", "updatedAt": "..." }
"avatar": null
```

- **El emoji** tiene que ser **uno solo** y del teclado de emojis. Valen los compuestos
  (tono de piel, familias con ZWJ); no valen letras ni dígitos. ⚠️ **Las banderas de país
  quedan fuera**: son dos indicadores regionales y ninguno cuenta como pictográfico.
- **La foto** se manda con `PUT /api/me/avatar` y el cuerpo **es la imagen** —no hay
  formulario multipart—, con `Content-Type: image/jpeg`, `image/png` o `image/webp`.
  Cualquier otro tipo es `415`, más de 6 MB es `413`, y algo que no se pueda decodificar
  es `400`. Se guarda recortada cuadrada a 256×256 JPEG, **sin metadatos** (las fotos de
  teléfono traen GPS en el EXIF y este archivo lo puede pedir cualquiera con sesión).
- **La URL lleva `?v=`** con la versión, así que cambiar la foto cambia la URL y nadie
  tiene que invalidar nada. Se sirve con `Cache-Control: private, max-age=86400` y un
  `ETag`, **nunca `immutable`** — eso le diría al cliente que no revalide ni al recargar,
  y una foto vieja podría quedarse pegada sin forma de echarla.
- **La foto no va en la base**: vive en `data/avatars/<id>.jpg`, dentro del mismo volumen
  persistente que `music.db` y las miniaturas.

### Desde la terminal — el CLI

Sigue haciendo falta aunque exista la API, por un motivo concreto: **la API necesita un
admin con sesión, y al primero no lo puede crear nadie desde ahí**. El CLI es la vía
para marcar ese primer administrador, y la que queda si alguien se deja afuera solo.

```bash
cd music-server

npm run users -- list                        # id, usuario, rol, alta, playlists, plays
npm run users -- create <usuario> [--admin]  # crea; --admin lo hace administrador
npm run users -- passwd <usuario>            # cambia la contraseña
npm run users -- set-role <usuario> user|admin
npm run users -- rename <usuario> <nuevo>    # cambia el NOMBRE; no toca el correo
npm run users -- set-email <usuario> <correo> # pone o cambia el CORREO con el que entra por Google
npm run users -- set-email <usuario> -       # le quita el correo
npm run users -- avatar <usuario> --emoji 🎵 # pone un emoji de avatar
npm run users -- avatar <usuario> --clear    # quita el avatar (emoji o foto)
npm run users -- delete <usuario>            # borra en CASCADA; pide escribir el usuario
```

**La contraseña nunca se pasa por argumento ni por variable de entorno**: quedaría en el
historial del shell y en la salida de `ps`. O se tipea en un prompt oculto, o se usa
`--generate`, que la crea sola y la muestra **una sola vez**.

**Qué poner de usuario**: para una persona, su **email**. Así, el día que entre por Google,
el auto-provisioning de Cloudflare Access encuentra esa misma fila y la adopta — una sola
cuenta y las mismas playlists desde la app y desde el navegador. Con un nombre corto, el
SSO crea una segunda cuenta y la persona termina con dos. Para cuentas técnicas
(`app-ios`, `apple-review`), nombre corto y **nunca** un email.

> Desde la **1.17.0** esto es una comodidad y ya no una trampa. La identidad de una cuenta
> es su columna `email`, no su nombre: el primer inicio de sesión con Google **adopta** la
> fila que tenga ese correo como nombre y le escribe el email de una vez. Así que
> equivocarse ya no es irreversible, y **renombrar a alguien no le parte la cuenta en
> dos** — que es lo que habría pasado antes, en silencio y con sus playlists quedándose en
> la cuenta vieja.
>
> Desde la **1.19.0** ni siquiera hace falta el truco: el correo se le pone aparte
> (`set-email`, o el alta con `email` por la API) y el nombre queda libre para ser un
> nombre. Una cuenta con el correo como nombre se sigue ligando igual en su primer login.

**Dos protecciones que no se pueden saltear**, ni por API ni por CLI: no se puede bajar de
rol ni borrar al **último administrador** —una base sin admins no se arregla desde la web—,
y borrar exige **escribir el usuario exacto**, porque se lleva por delante sus playlists y
su historial de reproducciones, y eso no se deshace.

> ⚠️ **En Windows el prompt de contraseña no funciona.** El modo raw de la consola no
> entrega teclas, así que el CLI corta con un mensaje en vez de colgarse: usá `--generate`.
> El prompt de `delete` sí anda, porque es visible. En producción da igual — se entra por
> `docker exec` a un contenedor Linux.

### En producción

Siempre por `docker exec`, **nunca desde el host**: la base vive en el volumen del
contenedor, y solo ahí se comparten el mismo montaje y los mismos locks que el servidor.

```bash
docker exec -it <contenedor> node src/admin/users.js list
```

No hace falta parar el servidor: SQLite está en WAL, que admite un escritor y varios
lectores a la vez, y lo que escribe el CLI dura milisegundos.

---

## Deploy con Dokploy

El repo incluye `Dockerfile`, `.dockerignore` y `docker-compose.yml` para desplegar en un servidor Linux con [Dokploy](https://dokploy.com) (PaaS sobre Docker). Un solo contenedor sirve API + frontend en el puerto **3000**.

**Diseño:**
- Build multi-stage: compila el frontend con Vite y lo copia a `music-server/public`; Express lo sirve junto con la API (mismo origen).
- La biblioteca de música se monta **en solo lectura** (`/mnt/storage` del host → `/music` en el contenedor, `:ro`). Nada del contenedor puede escribir tus archivos de audio.
- La base de datos SQLite y las carátulas (`music-server/data/`) persisten en un volumen nombrado entre redeploys.

**Pasos en Dokploy:**

1. Crea un servicio tipo **Compose** apuntando a este repo y a la branch a desplegar. Dokploy detecta el `docker-compose.yml` de la raíz.
2. En **Environment**, define `JWT_SECRET` con un valor fuerte (genera uno con `openssl rand -base64 48`). El compose **falla el arranque si está vacío**, para no usar nunca el default inseguro. El resto de variables (`MUSIC_DIR=/music`, `PORT`, `NODE_ENV`) ya vienen fijadas en el compose.
   - **Login con Google desde la app (opcional):** define también `GOOGLE_IOS_CLIENT_ID` con el ID del cliente OAuth de **iOS** (Google Cloud Console → APIs y servicios → Credenciales → Crear ID de cliente de OAuth → iOS, con el ID de paquete de la app, `com.sonorarev.app`). Sin ella, `POST /api/auth/google` responde `503` y el resto sigue igual. `GOOGLE_FAKE` **nunca** va en Dokploy.
3. Asegúrate de que el RAID esté montado en el host en `/mnt/storage` (o ajusta el bind mount del compose a tu ruta real).
   - **Videos (opcional):** el compose monta `/mnt/storage/Video` en `/videos` (`:ro`), fuera de `/music` para que el escáner de música no lo recorra, y fija `VIDEO_DIR`. Si esa carpeta no existe en el host, el servidor arranca igual y la lista de videos sale vacía. No hace falta escanear: se leen solos.
4. Asigna un dominio al servicio en el puerto **3000** (Dokploy gestiona Traefik + TLS).
5. **Primer escaneo:** la base de datos arranca vacía. Abre la terminal del contenedor (Dokploy → Terminal, o `docker exec`) y ejecuta:
   ```bash
   cd /app/music-server && npm run scan
   ```
   Esto indexa `/music` y guarda rutas `/music/...` válidas en Linux. Repite el escaneo cuando añadas música nueva.

> ⚠️ **No subas la `music.db` generada en otra máquina:** guarda rutas absolutas (`C:\Musica\...` en Windows) que no existen en el servidor. Escanea siempre dentro del contenedor.
>
> ℹ️ Si tu instalación de Dokploy requiere unir el servicio a la red `dokploy-network` para que Traefik lo enrute, añádelo en la config del servicio.

### Respaldo de la base

Una copia **consistente** de `music.db` en un solo archivo, **sin parar el servidor**: `VACUUM INTO` de SQLite incluye lo que todavía está en el WAL. Se hace en la terminal del contenedor (Dokploy → Terminal, o `docker exec`).

Desde la 1.25.0:

```bash
cd /app/music-server && npm run respaldar
```

Deja `data/respaldos/music-AAAA-MM-DD-HHMM.db`, comprueba `integrity_check` y que las filas coinciden, e imprime el tamaño.

Con cualquier versión (también antes de desplegar la 1.25.0), el mismo respaldo en una línea:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const f='/app/music-server/data/respaldo-'+new Date().toISOString().slice(0,10)+'.db';const d=new DatabaseSync('/app/music-server/data/music.db');d.exec(\"VACUUM INTO '\"+f+\"'\");d.close();console.log('listo: '+f)"
ls -lh /app/music-server/data/respaldo-*.db
```

**Sacarlo del servidor** (en el host, por SSH, no en la terminal del contenedor): el nombre del contenedor se ve con `docker ps --format '{{.Names}}' | grep musicplayer` (o en la pestaña del servicio en Dokploy), y después `docker cp <contenedor>:/app/music-server/data/respaldo-AAAA-MM-DD.db ./`. Guárdalo fuera del servidor.

**Plan B** si `VACUUM INTO` fallara: parar el servicio en Dokploy (Stop), copiar del volumen `music.db`, `music.db-wal` y `music.db-shm` JUNTOS (el volumen se ve con `docker volume ls | grep musicplayer-data`; los archivos están en su `_data`), y volver a arrancarlo.

## API

Todos los endpoints `/api/*` y `/stream/*` requieren autenticación con `Authorization: Bearer <token>`. Los endpoints de imagen y stream también aceptan `?token=` como query param (necesario para atributos `src` de `<img>` y `<audio>`).

Desde la 1.19.0 el token tiene que ser de una cuenta que **todavía exista**: si un admin la borra, su sesión deja de servir al momento (`401`), también en `/stream`. Es una lectura por clave primaria por petición (~5 µs medidos, contra ~1 ms que tarda una petición de catálogo).

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión → devuelve JWT |
| POST | `/api/auth/google` | Entrar con Google desde la app: `{ idToken }` → `{ token, me }`. Sin sesión. **No crea cuentas** (`403`); `503` sin `GOOGLE_IOS_CLIENT_ID`; 10 intentos por IP cada 15 min |
| GET | `/api/tracks` | Listar canciones (`?search=`, `?artist=`, `?album=`) |
| GET | `/api/tracks/:id` | Detalle de una canción |
| GET | `/api/tracks/:id/cover` | Carátula |
| GET | `/api/tracks/:id/locutor` | La frase de locutor de la canción y sus escuchas previas: `{ estado, frase, escuchas, reintentar_s? }`. Contesta siempre al instante; ver [El locutor](#el-locutor) |
| GET | `/api/albums` | Listar álbumes |
| GET | `/api/albums/:album/tracks` | Canciones de un álbum |
| GET | `/api/playlists` | Listar playlists del usuario. Desde 1.21.1, cada una trae además `video_count` (al final; `track_count` sigue contando solo canciones) |
| POST | `/api/playlists` | Crear playlist |
| GET | `/api/playlists/:id/tracks` | Canciones de una playlist |
| POST | `/api/playlists/:id/tracks` | Añadir canción a playlist |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Quitar canción de playlist |
| GET | `/api/playlists/:id/videos` | Videos de una playlist: `{ index, videos: [{ id, position, added_at, title, artist, available, duration, size, has_cover, year }] }`, por `position` |
| POST | `/api/playlists/:id/videos` | Añadir videos: `{ video_ids: [...] }` → `201 { added, already, skipped }`, o `{ video_id }` → `201 { position }` / `200 { already: true }` / `404`. Máx. 200 por envío (`413`) y 500 por playlist (`409`, no inserta ninguno); `503` si no se pudo leer `VIDEO_DIR` |
| DELETE | `/api/playlists/:id/videos/:videoId` | Quitar un video de la playlist (`204`, también si no estaba) |
| GET | `/api/me` | Quién soy: id, usuario, **correo**, **rol**, **avatar** y fecha de alta |
| PATCH | `/api/me` | Cambiar **una** cosa mía: `username`, `newPassword` (+`currentPassword`) o `emoji`. Devuelve `{ me, token }` |
| PUT | `/api/me/avatar` | Subir mi **foto**. El cuerpo *es* la imagen (JPEG/PNG/WebP, máx. 6 MB) |
| DELETE | `/api/me/avatar` | Quitarme el avatar (foto y emoji) |
| GET | `/api/users/:id/avatar` | La foto de alguien. Pide sesión, no rol |
| GET | `/api/admin/users` | Listar usuarios con sus conteos de playlists y plays *(solo admin)* |
| POST | `/api/admin/users` | Crear usuario. Con `email`, la contraseña es opcional *(solo admin)* |
| PATCH | `/api/admin/users/:id` | Cambiar rol, contraseña, **nombre**, **emoji** o **correo** (`email`; `null` lo quita) *(solo admin)* |
| GET | `/api/admin/users/:id/password` | Ver su contraseña (`{ password }` o `{ disponible: false }`); nunca la de otro admin *(solo admin)* |
| DELETE | `/api/admin/users/:id/avatar` | Quitarle el avatar a alguien *(solo admin)* |
| DELETE | `/api/admin/users/:id` | Borrar usuario y, en cascada, sus playlists y sus plays *(solo admin)* |
| GET | `/api/changelog` | Notas de versión (CHANGELOG.md) |
| GET | `/stream/:id` | Stream de audio con Range Requests |
| GET | `/api/videos` | Lista de videos: `{ videos: [{ id, title, artist, year, ext, size, mime, duration, has_cover }] }`, por artista A→Z y año del más nuevo al más viejo |
| GET | `/api/videos/:id/cover` | Portada del video (el `.jpg` de al lado); `404` si no tiene |
| GET | `/stream/video/:id` | Stream de video con Range Requests (el mismo manejo que el audio) |
| POST | `/api/radio` | Crear **mi** radio → `201 { code, serverNow, status }`. Si ya tenía una, esa termina |
| PUT | `/api/radio/:code/state` | *(solo el anfitrión)* Publicar qué suena: `{ trackId, positionMs, playing, nextTrackId?, enPausaPorVideo? }` → `{ serverNow, status, state }`. Sirve de latido |
| GET | `/api/radio/:code` | Leer la radio: `{ serverNow, code, status, state, host, listeners }`. Quien lee queda de oyente unos segundos |
| DELETE | `/api/radio/:code` | *(el anfitrión o un admin)* Terminarla → `{ serverNow, status: "ended", endedReason }` |

**Los videos** no pasan por el escáner ni por la base: el servidor lee `VIDEO_DIR` (en Docker, `/videos`; dos niveles, `<Artista>/<Título (año)>.mp4`) y guarda el índice en memoria, que se rehace solo cada minuto, así que un video subido con `scp` aparece sin reiniciar ni escanear nada. Solo se listan `.mp4`, `.m4v` y `.mov` (lo que los teléfonos reproducen sin transcodificar); el resto, los ocultos y los symlinks que salgan de la carpeta se ignoran. El `id` son los 16 primeros caracteres del sha1 de la ruta relativa: no cambia al reiniciar, y cambia si se renombra o se mueve el archivo. El artista sale de la carpeta, el año del `(AAAA)` del final del nombre y el título del nombre sin el año; la duración se lee de la pista de audio del MP4 y es `null` si no se puede. Usan la misma autenticación que `/stream` (Bearer o `?token=`).

**Los videos de una playlist** van en su propia tabla (`playlist_videos`), aparte de las canciones: `track_count` de `GET /api/playlists` sigue contando solo canciones, y desde la 1.21.1 hay un `video_count` aparte. Como un video no tiene fila en la base, cada uno se guarda con una copia de su título y su artista. `available` dice qué pasa con cada uno: `true` si está en el índice de videos (y entonces los datos son los de ahora), `false` si el índice se leyó y ese video ya no está —se borró o se renombró, y el `id` cambió—, y `null` si no se sabe porque el índice no se pudo leer (`index: "unavailable"`, por ejemplo sin `VIDEO_DIR`). `year` sale del índice (el `(AAAA)` del nombre del archivo), así que solo lo trae un video con `available: true`; si no, es `null`. Borrar la playlist se lleva sus videos. Estas rutas usan la sesión normal (Bearer), como el resto de `/api/playlists`.

**El modo radio** (1.29.0) es lo que escucha una persona —el anfitrión— publicado para que las demás lo sigan a la par. No hay WebSocket ni tabla: el anfitrión publica su estado con `PUT` (en cada cambio y cada ~10 s, de latido) y los oyentes preguntan con `GET` cada ~2 s. Las cuatro rutas piden sesión (Bearer).

- **El estado** (`state`): `{ seq, trackId, positionMs, playing, nextTrackId, enPausaPorVideo, publishedAtServerMs }`, o `null` si el anfitrión todavía no publicó. `seq` sube en cada publicación. `positionMs` es la posición **en el instante `publishedAtServerMs`**; el oyente la proyecta con `serverNow`, que viene en todas las respuestas para que cada cliente calcule su diferencia de reloj. **El servidor nunca lee un reloj del cliente.**
- **Validación al publicar:** `trackId` tiene que existir (`422` si no), `positionMs` se acota a `0..duración` de la pista, y un `nextTrackId` que no existe se publica como `null`. Con `enPausaPorVideo: true`, `playing` queda en `false` y `trackId` puede faltar. Cuerpo mal formado: `400`.
- **`status`:** `live`; `stale` tras **30 s** sin publicación del anfitrión; `ended` tras **5 min** sin publicación, tras **30 min** seguidos en pausa (3 h si la pausa es por un video) o cuando la terminan. `endedReason`: `anfitrion`, `admin`, `reemplazada`, `sin-anfitrion` o `pausa`. Una radio terminada sigue contestando `ended` **2 min** y después se borra (`404`). Publicar en una terminada: `410`.
- **Quién:** cualquier cuenta puede crear y escuchar; solo el anfitrión publica (`403` a los demás, también a un admin); termina el anfitrión o un admin. Una cuenta tiene **una** radio a la vez.
- **Qué se ve de otra persona** (`host`, `listeners`): `{ id, name, avatar }` y nada más. `avatar` tiene la forma de `GET /api/me`. Si la cuenta se llama como su correo, `name` es lo de antes de la arroba.
- **Límites:** 6 radios a la vez (`409`), 20 oyentes por radio (`409`), 20 publicaciones cada 10 s por radio y 6 creaciones por minuto por cuenta (`429` con `Retry-After`), cuerpo de 512 bytes (`413`). Un código que no existe o está mal escrito da siempre el mismo `404`.
- ⚠️ **Todo vive en memoria** (`src/radio/almacen.js`): un reinicio o un redeploy borra las radios abiertas. Las constantes están en `src/radio/reglas.js`.
- Pruebas: `npm run test:radio` (reglas y almacén, con el reloj inyectado) y `npm run smoke:radio` (por HTTP, con base temporal).

### El locutor

> **Sin desplegar (1.39.0).** Viene apagado: sin `OLLAMA_URL` el endpoint responde `apagado` y no intenta nada.

Una frase corta, de locutor de radio nocturna, para presentar cada canción: «Suena Daft Punk con Discovery, una noche tranquila para dejarse llevar.» La escribe un modelo local con [Ollama](https://ollama.com) (gratis y de código abierto; no se usa ninguna API de pago).

- **La música nunca espera a la IA.** `GET /api/tracks/:id/locutor` contesta siempre al instante. Si la frase no está, devuelve `generando` y la genera en segundo plano (una a la vez: Ollama corre con una petición a la vez); la siguiente consulta la encuentra.
- **El modelo solo habla de datos del catálogo** de la base: título, artista, álbum, año y género. Nunca recibe el número de pista ni las escuchas. Su respuesta se valida y **falla cerrado**: una frase con cifras, nombres propios, números con letra u ordinales que no estén en esos datos, en otro idioma, de más de una línea o que no mencione ni el título ni el artista se descarta (`sin-frase`).
- **El conteo de escuchas no pasa por el modelo.** Sale de una plantilla fija con las escuchas **previas** de quien pregunta: «Primera vez que la escuchas.», «Ya la habías escuchado una vez.» o «Ya la has escuchado N veces.».
- La caché es por pista y **compartida entre usuarios** (los datos no llevan nada de nadie); está en memoria y se pierde en cada deploy.

```
GET /api/tracks/:id/locutor        (Bearer, como el resto)
→ 200 { "estado": "lista", "frase": "Suena Daft Punk con Discovery, …", "escuchas": "Ya la has escuchado 3 veces." }
→ 200 { "estado": "generando", "frase": null, "escuchas": "Primera vez que la escuchas.", "reintentar_s": 10 }
→ 400 id inválido (solo dígitos) · 404 la pista no existe · 401 sin sesión
```

| `estado` | Cuándo | `frase` | `escuchas` |
|----------|--------|---------|------------|
| `lista` | hay una frase válida en caché | el texto | plantilla |
| `generando` | está en cola o en curso (incluye consultas repetidas); trae `reintentar_s` | `null` | plantilla |
| `sin-frase` | faltan título o artista, el modelo falló o su frase no validó, o el cortacircuitos está abierto | `null` | plantilla |
| `limite` | se agotó el cupo del usuario (por hora) o el tope del día | `null` | plantilla |
| `apagado` | `OLLAMA_URL` vacío o inválido | `null` | `null` |

La respuesta lleva `Cache-Control: no-store`. Una frase que no validó se recuerda 10 min (30 s si fue un fallo de red o un timeout), para no pedirle al modelo lo mismo en cada consulta.

**Contrato para el cliente:**
- Pedir la frase **AL INICIAR la pista** (o antes, para la siguiente). La app registra una escucha a la mitad de la pista (o a los 4 min): si se pide pasada la mitad, el conteo **incluye la actual** (uno de más).
- Las escuchas **offline sin sincronizar** todavía no están en el servidor, así que el conteo sale **uno de menos**.
- Con `generando`, **reintentar según `reintentar_s`**. Con `sin-frase`, `limite` o `apagado`, no insistir.
- La primera petición tras 25 min sin uso (o tras un reinicio) devuelve `generando` y puede tardar hasta 150 s (el tope de `LOCUTOR_TIMEOUT_FRIO_MS`): el modelo se carga en la GPU. Esa frase queda lista para la **siguiente** vez que suene la canción.

**Límites:** una generación a la vez, 20 pendientes como máximo (si se llena, se descarta la más vieja), 60 generaciones por usuario y hora y 1500 al día en total. El cupo se cobra solo cuando la llamada llegó a Ollama, y lo paga quien dispara la generación aunque la frase sirva para todos. Con el cortacircuitos abierto (3 fallos seguidos, 60 s) no se encola nada.

Pruebas: `npm run test:locutor-hechos`, `test:locutor-frase`, `test:locutor-ollama`, `test:locutor-servicio` (puras o con un servidor falso, sin Ollama) y `npm run smoke:locutor` (servidores reales y un Ollama falso, con base temporal).

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `MUSIC_DIR` | `../music` | Raíz de la biblioteca a escanear (en Docker: `/music`) |
| `VIDEO_DIR` | *(vacía)* | Carpeta de videos (en Docker: `/videos`, montada `:ro` desde `/mnt/storage/Video`, fuera de `MUSIC_DIR`). Vacía o inexistente = `GET /api/videos` responde una lista vacía y queda un aviso en el log |
| `JWT_SECRET` | `change-me-in-production` | Clave secreta para firmar tokens |
| `GOOGLE_IOS_CLIENT_ID` | *(vacía)* | ID del cliente OAuth de **iOS** con el que la app pide el token de Google: es la audiencia que se exige. Vacía = `POST /api/auth/google` responde `503` |
| `GOOGLE_FAKE` | *(vacía)* | **Solo pruebas locales.** Con `1`, un verificador falso acepta `fake:<correo>`. Con `NODE_ENV=production` el servidor **no arranca** |
| `OLLAMA_URL` | *(vacía)* | Dirección de Ollama (`http://host:11434`, solo `http`/`https`). **Vacía o inválida = locutor apagado**: el endpoint responde `apagado` y no hace ninguna petición |
| `LOCUTOR_MODELO` | `gemma4:12b` | Modelo de Ollama que escribe la frase |
| `LOCUTOR_KEEP_ALIVE` | `30m` | Cuánto deja Ollama el modelo cargado sin uso (`30m`, `2h`, `90s` o `-1` para siempre) |
| `LOCUTOR_TIMEOUT_MS` | `8000` | Tiempo máximo de una generación, en milisegundos |
| `LOCUTOR_TIMEOUT_FRIO_MS` | `150000` | Tiempo máximo de la carga del modelo en frío (`calentar`), en milisegundos |
| `LOCUTOR_LIMITE_USUARIO_HORA` | `60` | Generaciones que puede disparar cada usuario por hora |
| `LOCUTOR_LIMITE_DIA` | `1500` | Tope global de generaciones por día (ventana de 24 h) |
| `LOCUTOR_CACHE_MAX` | `2000` | Pistas con frase (o con intento fallido) en la caché; al llenarse sale la menos usada |
| `LOCUTOR_COLA_MAX` | `20` | Generaciones pendientes; si se llena, se descarta la más vieja |
| `LOCUTOR_CALENTAR_AL_ARRANCAR` | *(vacía)* | Solo `1` enciende el calentamiento al arrancar el servidor; cualquier otro valor lo deja apagado (el modelo se calienta con el primer encargo) |

```bash
JWT_SECRET=mi-clave-segura PORT=8080 node server.js
```

> ⚠️ Un valor numérico inválido de `LOCUTOR_*` (texto, cero, negativo o decimal) cae al default sin avisar. Estas variables **no llegan al contenedor** mientras no estén en la lista `environment:` del `docker-compose.yml` (definirlas en Dokploy no alcanza).
