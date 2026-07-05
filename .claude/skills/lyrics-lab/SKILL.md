---
name: lyrics-lab
description: Mapa del sistema de letras/karaoke de SonoraRev (parser LRC, reloj interpolado, fallback LRCLIB, estados del panel, reglas duras y checklist de QA). Úsala SIEMPRE antes de tocar o auditar el pipeline de letras (LyricsPanel, lrclib.js, endpoint /lyrics).
---

# Lyrics Lab — sistema de letras/karaoke de SonoraRev

Fuente de verdad del pipeline de letras. Antes de opinar o tocar, **inspeccioná
los archivos reales** — este mapa dice dónde vive cada cosa y qué NO se puede romper.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/components/LyricsPanel.jsx` | Panel/overlay de letra: `parseLrc`, `findActiveIdx`, reloj interpolado (rAF), ajuste ± por pista, auto-scroll contenido, estados vacíos |
| `music-client/src/context/PlayerContext.jsx` | Reproductor global. **NO expone el `<audio>`**; entrega `currentTime` por `timeupdate` (~4 Hz), `seek()`, y resetea `currentTime/duration` a 0 en `playIndex` |
| `music-server/src/api/tracks.js` | `GET /api/tracks/:id/lyrics`: instrumental (columna `vocals`) → `.lrc` sidecar (`lrc_path` + `SYNCED_RE`) → fallback LRCLIB → sin letra. **Nunca** responde error por falta de letra |
| `music-server/src/lyrics/lrclib.js` | Fallback remoto con matching estricto y caché en memoria |
| `music-client/src/styles/main.css` | `.lyrics-panel/-body/-line(.active/.near)/-wipe/-via` + ramas reduced-motion (~líneas 960-975 y 2000-2130) |

## Reglas duras (NO romper)

1. **Parser line-level only (no A2).** `parseLrc` solo entiende marcas de línea
   `[mm:ss.xx]` (varias por línea = línea repetida); las word-level `<mm:ss.xx>`
   (LRC A2) NO están soportadas — el barrido las simula interpolando entre marcas
   de línea. Metadatos `[ar:][ti:]…` se descartan; **`[offset:±ms]` se honra**
   (positivo RETRASA la letra, se suma a todas las marcas al parsear).
2. **El PlayerContext NO expone el `<audio>`.** El reloj del karaoke es
   interpolado: se siembra `t0 = currentTime` + `perf0 = performance.now()` en
   cada tick (~4 Hz) **y al cambiar `isPlaying`** (evita el salto al reanudar);
   `live = t0 + (now − perf0)/1000 + offset`. El rAF **conmuta la línea activa
   exacta en su marca Y pinta `--p`** (una sola CSS var por frame); el camino
   lento (estado 4 Hz) cubre pausa, reduced-motion y seeks. `playIndex` resetea
   `currentTime` a 0 al cambiar de pista — sin eso la letra nueva se evalúa con
   el tiempo de la anterior. **No "optimizar" nada de esto sin entenderlo.**
3. **Anticipación de lectura: +0.1 s** en `findActiveIdx`. No subirla (0.2 se
   sintió adelantada); el resto lo afina el usuario con el ±.
4. **Offsets por pista**: localStorage `lyricsOffset:<trackId>`, pasos ±0.1/±0.5
   redondeados a décima, offset 0 ⇒ se borra la key. El clic en una línea hace
   `seek(l.time − offset)` (inversa del ajuste).
5. **Auto-scroll contenido**: `scrollTo` sobre `.lyrics-body` (ref) con clamp.
   **NUNCA `scrollIntoView`**: escala a los scrollers exteriores y en móvil
   empuja el panel (el header "se iba"). `.lyrics-synced` lleva 44vh de aire
   inferior para centrar las últimas líneas.
6. **z-index canónico**: barra (sin z) < campanita 150 < expandido 200 <
   **Letra 250** < popovers de barra **260** (`--z-bar-popover`: menú "+" y
   tooltip del shuffle) < Info 300 < toast 400. Todo popover anclado a la barra
   que deba verse con la Letra abierta usa `var(--z-bar-popover)`, nunca un
   número a mano.
7. **`prefers-reduced-motion` SIEMPRE**: el rAF ni arranca; la línea activa se
   muestra sólida (`clip-path: none` sobre `.lyrics-wipe`), scroll `auto`, sin
   animación de entrada del panel.
8. **Datos reales**: nunca inventar letra. La remota lleva badge **"vía LRCLIB"**
   (`.lyrics-via`, familia del "vía MusicBrainz" de Info); los `.lrc` curados van
   sin badge. Fallos externos degradan en silencio.
9. **El modo inmersivo vive en `Player.jsx`** (`lyricsImmersive`); `LyricsPanel`
   es controlado (props `immersive` + `onToggleImmersive`), **sin estado local**.
   Invariante: **nunca `expanded=true` con la Letra en modo panel** (producía la
   "barra fantasma"): abrir el expandido con la Letra abierta la promueve a
   inmersivo, y "Reducir" cierra el expandido. Navegar (links de la barra, Info)
   cierra la Letra.
10. **Override «no es la letra» por pista**: localStorage `lyricsHidden:<trackId>`
    (patrón del offset; deshacer borra la key). SOLO suprime letra con
    `source: 'lrclib'` — un `.lrc` curado llega sin `source` y se muestra
    siempre, aunque la marca siga guardada. El fetch **no se evita**: se suprime
    en render (el `source` recién se conoce con la respuesta; el deshacer revela
    la letra que quedó en memoria, sin round-trip). La × vive dentro del chip del
    badge; badge y × llevan guard `!loading` — sin él, un clic durante la carga
    marcaría la pista nueva con data de la vieja.

## Estados posibles del panel (del endpoint real)

| Estado | Origen | UI |
|---|---|---|
| Instrumental local | `vocals = 'instrumental'` en DB | Empty 🎹 "Instrumental" |
| Synced local | `.lrc` con marcas (`SYNCED_RE`) | Karaoke completo, sin badge |
| Plano local | `.lrc` sin marcas | `.lyrics-plain` (texto aireado) |
| Synced vía LRCLIB | `source: 'lrclib'` (siempre synced) | Karaoke + badge "vía LRCLIB" con la × del override |
| Suprimida por el usuario | marca `lyricsHidden:<trackId>` + `source: 'lrclib'` | Empty 🎙️ "Sin letra disponible" + pastilla "Buscar en LRCLIB de nuevo" (deshacer) |
| Sin letra | nada de lo anterior | Empty 🎙️ "Sin letra disponible" |

**No existe "plano vía LRCLIB"**: el backend descarta `plainLyrics` remota
(mejor "sin letra" que el karaoke a medias). Si se quiere ese estado a futuro,
es una decisión de producto + presentación digna, no un fix.

## Matching LRCLIB (estricto, en `lrclib.js`)

- `GET lrclib.net/api/get` por artista + título + álbum + **duración**;
  User-Agent `SonoraRev/1.0` (misma cortesía que MusicBrainz en `info.js`).
- **Solo `syncedLyrics`**; y solo si la duración del resultado difiere ≤5 s de la
  pista local (>5 s = otra versión: radio edit, en vivo, la cantada…).
- **Guard instrumental**: título con `/instrumental/i` ⇒ ni se consulta;
  resultado con `instrumental: true` ⇒ descartado.
- **Caché en memoria**: 24 h positiva Y negativa (todo descarte incluido);
  fallos de red/5xx solo 10 min; timeout 4 s. Se pierde al reiniciar el server.
- **Presupuesto de espera en dos capas**: server → LRCLIB **4 s** (`lrclib.js`);
  cliente → server **7 s** (`AbortSignal.timeout` en el fetch del panel, cubre
  server/túnel colgados). El del cliente SIEMPRE por encima del del server: una
  respuesta legítima nunca se aborta. Copy de espera: "Buscando letra…".

## Checklist QA del karaoke

1. **Sync exacto**: cada línea enciende en su marca (sin jitter línea a línea);
   el wipe avanza suave ~60 fps y termina al llegar la marca siguiente (tope 4 s
   en la última).
2. **Cambio rápido de pista** (swipe / next / auto-avance): sin flash de líneas
   de la canción anterior; la letra nueva arranca desde 0.
3. **Seek** (barra y clic en línea): re-encuadre inmediato de línea y scroll;
   el clic en línea aterriza donde dice esa línea (respetando el offset).
4. **Pausa/play**: wipe congelado en pausa; al reanudar no hay salto (perf0 se
   resiembra por `isPlaying`).
5. **Instrumentales**: `vocals='instrumental'` → estado Instrumental; título con
   "instrumental" → jamás letra de LRCLIB (ni la de la versión cantada).
6. **Sin letra**: Empty sin error visible, también con LRCLIB caído o sin red;
   la espera muestra "Buscando letra…" y nunca pasa de ~4 s (LRCLIB colgado)
   ni de 7 s (server/túnel colgado).
7. **Móvil vs desktop**: en móvil el panel respeta `bottom` (mini barra + nav);
   el header con el ajuste ± nunca se escapa; últimas líneas centradas.
8. **Inmersivo vs panel**: `inset: 0` (tapa la barra) vs `bottom: var(--player-h)`;
   Esc cierra la Letra antes que el expandido; "Reducir" con el expandido montado
   detrás **lo cierra** (barra real visible, sin franja fantasma); clic en barra
   o portada con la Letra en panel **la promueve a inmersivo**.
9. **reduced-motion**: línea activa sólida de una (sin barrido), scroll
   instantáneo, sin animaciones — pero los estados y colores se conservan.
10. **Offsets**: persisten por pista, el reset limpia la key, `[offset:]` del
    archivo se aplica además del ajuste manual.
11. **Override por pista**: la × solo aparece con letra LRCLIB (jamás con `.lrc`
    local ni durante la carga); ocultar → Empty con deshacer; persiste al
    recargar; deshacer revela la letra al instante.
