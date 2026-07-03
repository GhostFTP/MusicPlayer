# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────
# Stage 1 — build: compila el frontend e instala las deps de prod
# Imagen "full" (no slim): trae el toolchain (python3/make/g++) que
# bcrypt necesita para compilar su binario nativo.
# ──────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /app

# 1a. Deps del frontend primero → mejor cache de capas (no reinstala
#     si solo cambió el código y no el package-lock).
COPY music-client/package.json music-client/package-lock.json music-client/
RUN cd music-client && npm ci

# 1b. Código del frontend + build de producción de Vite → music-client/dist
COPY music-client/ music-client/
RUN cd music-client && npm run build

# 1c. Deps de PRODUCCIÓN del server (sin devDependencies).
#     Aquí se compila bcrypt contra glibc (Debian bookworm).
COPY music-server/package.json music-server/package-lock.json music-server/
RUN cd music-server && npm ci --omit=dev

# ──────────────────────────────────────────────────────────────
# Stage 2 — runtime: imagen slim, solo lo necesario para ejecutar.
# Mismo glibc que el stage build → el binario de bcrypt es compatible.
# node:sqlite funciona sin flag en Node 22 (solo emite un warning).
# ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/music-server

# Código del server (el .dockerignore excluye node_modules, data, public, .env)
COPY music-server/ ./

# CHANGELOG.md (raíz del repo) → lo sirve GET /api/changelog para la vista Novedades.
COPY CHANGELOG.md ./

# node_modules de prod ya compilados, desde el stage build
COPY --from=build /app/music-server/node_modules ./node_modules

# Frontend compilado → public/ : Express lo sirve desde aquí (DIST = join(__dir,'public'))
COPY --from=build /app/music-client/dist ./public

# Carpeta data/ (music.db + covers/). Se monta un volumen encima en runtime;
# la creamos para que exista aunque el volumen arranque vacío.
RUN mkdir -p data

EXPOSE 3000

# Arranca Express. server.js detecta public/ → sirve API + frontend mismo origen,
# y con NODE_ENV=production desactiva CORS.
CMD ["node", "server.js"]
