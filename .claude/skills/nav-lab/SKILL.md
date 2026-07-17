---
name: nav-lab
description: Estándar de la navegación core de SonoraRev — el modelo de DOS NIVELES (rutas con URL + overlays), routing a mano sobre la History API (Modelo 2 real, deep-linking, F5 que restaura), la escalera dismissTop para overlays, el gesto swipe-atrás, y qué es navegación y qué no. Úsala SIEMPRE antes de tocar o auditar rutas/URLs, el botón atrás del navegador, la cadena de Esc, el swipe-atrás o cualquier cambio de vista/detalle (Player.jsx, Layout.jsx, App.jsx).
---

# Nav Lab — estándar de navegación de SonoraRev

Fuente de verdad de **cómo se navega y cómo se retrocede**: las rutas (URLs), el
atrás/adelante del navegador, la cadena de Esc y el swipe-atrás de móvil. Antes de
opinar o tocar, **inspeccioná los archivos reales** — este mapa dice dónde vive
cada cosa y qué NO se puede romper. Los números de línea son orientativos (el
código se mueve); las funciones, banderas, el orden de la escalera y el esquema de
rutas son el ancla.

## ⏱️ Estado actual (leer primero)

- **EN CÓDIGO hoy: nav-lab v1 (Modelo 1)** — commits `dea7f26` (skill v1), `f21e418`
  (extraer `dismissTop`), `1be9fa1` (3a: Info como capa), `6ebd4c6` (3b: guardia
  único + `popstate`). El atrás cierra capas y **sale en la lista pelada**.
- **OBJETIVO de este contrato: Modelo 2 (routing real)** — URLs por vista/detalle,
  historial de vistas, deep-linking, F5 que restaura. **Fase 1 aún NO está
  implementada.** Lo de abajo describe el TARGET y marca qué de v1 sobrevive y qué
  se rehace. No asumas que el código ya hace Modelo 2: todavía hace Modelo 1.

## Premisa (el contrato, no el botón)

El frente es **el modelo de navegación de la app y su única fuente de verdad**:
*dónde estás* (la ruta) y *qué tenés encima* (los overlays). SonoraRev **no usa
react-router** — decisión ratificada: la superficie es chica (7 vistas, 3 patrones
de detalle), ya existe un choke point único (`navigate()` en Layout), ya existe el
SPA fallback en el server, y sumar una dependencia arriesga el pendiente de
`build.target`/Chrome-87 del R4. El routing se construye **a mano sobre la History
API** — extendiendo la maquinaria que nav-lab v1 ya introdujo, no peleándola.

## 🧭 El modelo de DOS NIVELES (el corazón del contrato)

Hay dos niveles de "atrás", y no se mezclan:

| Nivel | Qué | Ejemplos | ¿URL? | El atrás… |
|---|---|---|---|---|
| **1 — Rutas** | *lugares* | vista (`/artists`) y detalle (`/artists/:artist`, `/albums/:album_artist/:album`, `/genres/:genre`, `/years/:year`, `/playlists/:id`, `/changelog`) | **Sí** (deep-linkable, F5-restaurable) | recorre el **historial de vistas** (Modelo 2) |
| **2 — Overlays** | *cosas encima*, transitorias | expandido, Letra, Info | **No** (no se deep-linkea "el expandido") | los **cierra primero** (escalera `dismissTop`) |

**El atrás, en orden:** `popstate` corre **primero la escalera de overlays**
(`dismissTop`); si cerró un overlay, para ahí. Si no había overlay, es un **pop de
ruta** → el router restaura la vista/detalle anterior desde la URL. Overlays antes
que rutas, siempre.

## La escalera de OVERLAYS — `dismissTop()` (sobrevive de v1)

La escalera ahora cubre **solo overlays**. El *detalle* y *Novedades* dejan de ser
peldaños y pasan a ser **rutas** (Nivel 1). Prioridad, de lo más "encima" a lo más
profundo:

| # | Overlay | Bandera | Acción de cierre |
|---|---|---|---|
| 1 | **Info** | `showInfo` | `infoRef.current.requestClose()` — cierre ANIMADO vía imperative handle (3a) |
| 2 | **Letra** | `showLyrics` | `setShowLyrics(false)` |
| 3 | **Expandido** | `expanded` | `setExpanded(false)` |

Cuando la escalera devuelve "no cerré nada" (no hay overlay), el `popstate` es un
**pop de ruta**: lo maneja el router (Nivel 1), no la escalera.

### REGLA DURA #1 — una escalera de overlays, cero lógica duplicada

`dismissTop()` es la única fuente de prioridad de los overlays. La corren el **Esc**
y el **`popstate`** (que primero prueba overlays, después ruta). Overlay nuevo → se
agrega SOLO en `dismissTop()`. **El Info es una capa más, no una excepción:** su
cierre animado se dispara con `requestClose` expuesto por `useImperativeHandle`
(`InfoPanel.jsx`, `forwardRef`), NO con un Esc propio del panel (3a lo unificó).

### REGLA DURA #2 — el swipe-atrás se queda angosto

El swipe de móvil (`Layout.jsx`, guard `detailOpenRef`, `max-width:700px`) ataca
**solo detalle→lista** (que en Modelo 2 es un **pop de ruta**), vía el mismo
primitivo que usa esa transición. **NO llama a `dismissTop()`** — ensancharlo para
que cierre expandido/Letra es **regresión**. Cualquier ensanche es decisión
explícita del usuario, nunca efecto colateral.

### ⛔ REGLA DURA #3 — anti-loop (sigue vigente, en los DOS niveles)

> **Ningún handler de `popstate` —ni el de overlays ni el de rutas— puede llamar
> `history.back()` / `history.go(-1)` adentro. `popstate` solo hace `setState` y,
> como mucho, `pushState`.**

`history.back()` dentro de `popstate` dispara otro `popstate` → **loop** ("el atrás
no hace nada" / "hay que apretarlo 5 veces"). Es el bug clásico del routing a mano.
Con react-router uno no lo ve porque la librería lo maneja; **a mano es
responsabilidad nuestra**. Grep de `history.back(` dentro de un `popstate` =
hallazgo crítico.

## 🕰️ Por qué existió el Modelo 1 y por qué se revierte (NO fue un error)

**nav-lab v1 (Modelo 1)** fijó el bug inmediato —el atrás nativo sacaba de la app—
**sin** meter routing: guardia único + `popstate` corriendo la escalera, y "en la
lista pelada el atrás SALE". Fue una decisión **consciente y correcta para su
alcance**: conservadora con producción, chica, cero backend, sin revertir la
ausencia de router. **No fue un atajo mal hecho** — fue el peldaño correcto antes de
una decisión de arquitectura.

Después el usuario pidió **deep-linking / routing real (Modelo 2)**: URLs por
vista/detalle, historial de vistas, links compartibles, F5 que restaura. Eso
**supersede** parte de v1 (ver tabla). El giro Modelo 1 → Modelo 2 es **deliberado
y deseado**, no una corrección de un error. La próxima sesión no debe "arreglar" el
Modelo 1 de v1 pensando que estaba mal: fue lo correcto hasta que se decidió routing.

## Qué SOBREVIVE de v1 y qué se REHACE

| Sobrevive (se reusa) | Se rehace (superseded) |
|---|---|
| Escalera `dismissTop` para **overlays** (Info/Letra/expandido) | El **guardia único** (3b) para detalle/changelog → lo absorbe el **historial del router** |
| **3a**: Info como capa (imperative handle, `InfoPanel` `forwardRef`/`useImperativeHandle`) | **Modelo 1** "lista pelada SALE" → **Modelo 2** "atrás va a la vista anterior; sale en la 1ª entrada" |
| REGLA DURA #2 (swipe angosto) | Rungs **detalle** (5) y **Novedades** (3) salen de la escalera → pasan a **rutas** |
| REGLA DURA #3 (anti-loop) — para cualquier `popstate` a mano | **F5 resetea a Biblioteca** → **F5 restaura** desde la URL |
| Aislamiento de MediaSession; reduced-motion | El "QUIRK del atrás absorbido" de v1 → **a re-evaluar en Fase 1** (depende de cómo los overlays empujen/no historial) |

## 🗺️ Esquema de rutas (target del routing a mano)

- `/` → Biblioteca · `/albums` · `/artists` · `/genres` · `/years` · `/playlists` · `/changelog`
- Detalles: `/artists/:artist` · `/genres/:genre` · `/years/:year` · `/playlists/:id`
- **Álbum lleva DOS identificadores** (nombre + `album_artist` para desambiguar
  homónimos): `/albums/:album_artist/:album` (dos segmentos). Viene de
  `navigate('albums', { album, album_artist })`.
- **Detalles internos hoy sin `navigate` externo** (un año, una playlist) también
  necesitan su URL → **superficie extra**, no olvidarlos.
- **Encoding (mismo cuidado que `/image`):** `encodeURIComponent(nombre)` al armar
  el link; `decodeURIComponent` + **normalizar a NFC al hacer match** (igual que
  `findArtistImage`/commit `c201836`). El round-trip de un link generado por la app
  es sin pérdida; el riesgo es solo un link tipeado a mano con otra normalización.

## Deep-linking + auth (ya conviven, con una secuencia)

- **Cloudflare Access gatea el hostname entero** (independiente del path) → un link
  compartido solo lo abre un email autorizado por la política. Es *feature*.
- Al cargar cualquier path: `AuthProvider` monta, `checking=true`, **`App.jsx`
  (`if (checking) return null`) no pinta la vista** hasta que `reauth()` (SSO→JWT)
  resuelve → recién ahí monta `<Layout/>` y el router lee la URL. **El auth resuelve
  ANTES del detalle deep-linkeado** (y el handler de 401 cubre cualquier fetch que
  se adelante).
- **localhost user/pass:** sin CF Access, se muestra `<Login/>` en **la misma URL**;
  al loguear, el router abre el path pendiente. Funciona.

## Backend — el SPA fallback YA EXISTE (routing = frontend-only)

`server.js` (~40-46): `express.static(DIST)` + `app.get('*')` que sirve
`index.html` en cualquier ruta no-`/api`/`/stream`. **F5 en `/artists/Daft Punk` NO
da 404.** El routing **no toca backend**. No re-implementar esto ni listarlo como
pendiente.

## Aislamiento de MediaSession (producción)

La navegación (escalera, router, popstate) vive en `Player.jsx` / `Layout.jsx` /
`App.jsx`. **MediaSession y la cola viven en `PlayerContext.jsx` (~218-289)** —
archivos distintos, cero solape. MediaSession está en prod (v1.5.0) **sin prueba
física en el carro**: el routing **no debe tocar `PlayerContext.jsx`**. Si un cambio
pretende entrar ahí, **parar y pactar** (carro primero).

## reduced-motion

El único movimiento propio de navegación es el **chevron del swipe-atrás**
(`nav-back-chevron`, `Layout.jsx`): su fundido se anula en `prefers-reduced-motion`
(`main.css`). El resto del atrás (Esc, popstate, cambio de ruta) es lógica; la
animación la pone cada capa/vista al montar/cerrarse y ya respeta reduced-motion.

## Fases (troceo del routing)

1. **Fase 1 — URLs + historial de vistas + F5** (núcleo): `navigate()` → `pushState(path)`;
   `popstate` → overlays primero, si no, leer `location.pathname` → vista+target; leer
   la URL al montar (F5 restaura). Gana: URL por vista/detalle, atrás/adelante de vistas
   (Modelo 2), F5 te deja donde estabas.
2. **Fase 2 — Compartir / deep-linking robusto**: NFC al match, URL de álbum con 2 params,
   ruta desconocida → fallback sensato. Gana: links que abren directo.
3. **Fase 3 (opcional) — pulido**: URL canónica, restauración de scroll, vista 404, adelante.

## Checklist QA de navegación (Modelo 2)

1. **Overlays antes que rutas:** con un overlay abierto (Info/Letra/expandido) sobre
   un detalle, el atrás cierra **el overlay primero**; recién sin overlays hace pop de ruta.
2. **Escalera de overlays por Esc:** Esc cierra Info → Letra → expandido (uno por vez);
   el Info cierra animado vía `requestClose` (imperative handle), no por Esc propio.
3. **Historial de vistas (Modelo 2):** navegar Biblioteca → Artistas → un artista y darle
   atrás recorre esas vistas hacia atrás; adelante las rehace.
4. **F5 en un detalle:** recarga y **restaura la misma vista/detalle** desde la URL (no
   Biblioteca).
5. **Deep-link:** pegar `/artists/<nombre>` abre directo en ese artista (tras el auth).
6. **Encoding:** nombres con espacio/tilde/∞/en-dash en la URL resuelven al artista/álbum
   correcto (encodeURIComponent + NFC al match); álbum usa `:album_artist/:album`.
7. **No-loop (REGLA DURA #3):** ningún `popstate` llama `history.back()`; atrás repetido
   nunca "no hace nada".
8. **Swipe angosto (REGLA DURA #2):** sigue solo detalle→lista, no cierra overlays.
9. **Aislamiento:** el diff NO toca `PlayerContext.jsx` (MediaSession) ni el server (SPA
   fallback ya existe).
