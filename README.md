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
│   │   └── admin/             # CLI de usuarios
│   ├── scripts/               # smoke test de /api/admin/users
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
npm run users -- delete <usuario>            # borra en CASCADA; pide escribir el usuario
```

**La contraseña nunca se pasa por argumento ni por variable de entorno**: quedaría en el
historial del shell y en la salida de `ps`. O se tipea en un prompt oculto, o se usa
`--generate`, que la crea sola y la muestra **una sola vez**.

**Qué poner de usuario**, que no es cosmético: para una persona, su **email**. Así, el día
que entre por Google, el auto-provisioning de Cloudflare Access encuentra esa misma fila y
la adopta — una sola cuenta y las mismas playlists desde la app y desde el navegador. Con
un nombre corto pasa lo contrario: el SSO crea una segunda cuenta y la persona termina con
dos. Para cuentas técnicas (`app-ios`, `apple-review`), nombre corto y **nunca** un email.

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
3. Asegúrate de que el RAID esté montado en el host en `/mnt/storage` (o ajusta el bind mount del compose a tu ruta real).
4. Asigna un dominio al servicio en el puerto **3000** (Dokploy gestiona Traefik + TLS).
5. **Primer escaneo:** la base de datos arranca vacía. Abre la terminal del contenedor (Dokploy → Terminal, o `docker exec`) y ejecuta:
   ```bash
   cd /app/music-server && npm run scan
   ```
   Esto indexa `/music` y guarda rutas `/music/...` válidas en Linux. Repite el escaneo cuando añadas música nueva.

> ⚠️ **No subas la `music.db` generada en otra máquina:** guarda rutas absolutas (`C:\Musica\...` en Windows) que no existen en el servidor. Escanea siempre dentro del contenedor.
>
> ℹ️ Si tu instalación de Dokploy requiere unir el servicio a la red `dokploy-network` para que Traefik lo enrute, añádelo en la config del servicio.

## API

Todos los endpoints `/api/*` y `/stream/*` requieren autenticación con `Authorization: Bearer <token>`. Los endpoints de imagen y stream también aceptan `?token=` como query param (necesario para atributos `src` de `<img>` y `<audio>`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión → devuelve JWT |
| GET | `/api/tracks` | Listar canciones (`?search=`, `?artist=`, `?album=`) |
| GET | `/api/tracks/:id` | Detalle de una canción |
| GET | `/api/tracks/:id/cover` | Carátula |
| GET | `/api/albums` | Listar álbumes |
| GET | `/api/albums/:album/tracks` | Canciones de un álbum |
| GET | `/api/playlists` | Listar playlists del usuario |
| POST | `/api/playlists` | Crear playlist |
| GET | `/api/playlists/:id/tracks` | Canciones de una playlist |
| POST | `/api/playlists/:id/tracks` | Añadir canción a playlist |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Quitar canción de playlist |
| GET | `/api/me` | Quién soy: id, usuario, **rol** y fecha de alta |
| GET | `/api/admin/users` | Listar usuarios con sus conteos de playlists y plays *(solo admin)* |
| POST | `/api/admin/users` | Crear usuario *(solo admin)* |
| PATCH | `/api/admin/users/:id` | Cambiar rol o contraseña *(solo admin)* |
| DELETE | `/api/admin/users/:id` | Borrar usuario y, en cascada, sus playlists y sus plays *(solo admin)* |
| GET | `/api/changelog` | Notas de versión (CHANGELOG.md) |
| GET | `/stream/:id` | Stream de audio con Range Requests |

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `MUSIC_DIR` | `../music` | Raíz de la biblioteca a escanear (en Docker: `/music`) |
| `JWT_SECRET` | `change-me-in-production` | Clave secreta para firmar tokens |

```bash
JWT_SECRET=mi-clave-segura PORT=8080 node server.js
```
