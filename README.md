# Music Player

Reproductor de música personal con streaming desde tu propio servidor.

## Stack

- **Backend:** Node.js + Express + SQLite (`node:sqlite`)
- **Streaming:** HTTP Range Requests (seek sin descarga completa)
- **Auth:** JWT + bcrypt
- **Frontend:** Vite + React (responsive, funciona en móvil y DAPs)

## Estructura

```
Music Player APP/
├── music-server/
│   ├── server.js          # punto de entrada
│   ├── src/
│   │   ├── api/           # rutas: auth, tracks, albums, playlists
│   │   ├── stream/        # streaming con Range Requests
│   │   ├── scanner/       # indexa tu carpeta de música
│   │   ├── db/            # esquema SQLite
│   │   └── auth/          # JWT middleware
│   ├── music/             # pon aquí tus archivos de audio
│   ├── data/              # music.db + carátulas (auto-generado)
│   └── public/            # build del frontend (auto-generado)
└── music-client/
    └── src/               # React app
```

## Instalación

```bash
# Backend
cd music-server
npm install

# Frontend
cd music-client
npm install
```

## Cómo correr

### Desarrollo
Dos terminales, con hot-reload:

```bash
# Terminal 1 — backend (puerto 3000)
cd music-server
npm run dev

# Terminal 2 — frontend (puerto 5173)
cd music-client
npm run dev
```

Abre **http://localhost:5173**

---

### Producción
Un solo servidor, un solo puerto:

```bash
cd music-server
npm run build   # compila el frontend y lo copia a music-server/public/
node server.js
```

Abre **http://localhost:3000**

> `npm run build` solo es necesario la primera vez o cuando modifiques el frontend.

---

### Escanear música

```bash
cd music-server

# Escanear la carpeta music/ por defecto
npm run scan

# O apuntar a cualquier otra carpeta
node src/scanner/index.js /ruta/a/tu/musica
```

El scanner extrae título, artista, álbum, año, duración y carátula de los tags de cada archivo y los guarda en la base de datos. Formatos soportados: `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.wav`, `.opus`, `.wma`.

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `JWT_SECRET` | `change-me-in-production` | Clave para firmar tokens JWT |

Ejemplo:

```bash
JWT_SECRET=mi-clave-secreta PORT=8080 node server.js
```
