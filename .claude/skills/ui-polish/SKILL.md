---
name: ui-polish
description: Guía de diseño UI de SonoraRev (paleta, glassmorphism, radios, identidad por color, easings, prefers-reduced-motion, anti-patrones y checklist de entrega). Úsala SIEMPRE al proponer o implementar cambios visuales en el frontend (React + CSS en music-client).
---

# UI Polish — Guía de diseño de SonoraRev

Reproductor de música self-hosted, estética oscura tipo "Spotify propio". Frontend
en **React 18 + Vite**, estilos en un único `music-client/src/styles/main.css` con
**tokens CSS en `:root`**. Esta guía es la fuente de verdad visual: úsala antes de
tocar nada y **respeta los tokens existentes** (no inventes colores nuevos sin motivo).

## Paleta (tokens reales de `main.css :root`)

Superficies y texto (tema oscuro):
- `--bg #111` · `--surface #1a1a1a` · `--surface-2 #222` · `--surface-hover #2a2a2a` · `--border #2c2c2c`
- `--text #f0f0f0` · `--text-muted #888` · `--text-time #a8a8a8` (tiempos) · `--time-elapsed #b7a3f5` (transcurrido)

Identidad / acentos:
- `--accent #a78bfa` (**morado**, acento principal) · `--accent-dim #7c3aed33` (fondos activos/hover morados)
- `--teal #2dd4a7` (identidad del botón **"+" / playlist**)
- `--lyric-pink #f472b6` (nota + destello del glifo de **letra**)
- `--amber #fbbf24` / `--amber-soft` / `--amber-dim` (botón de **info**)

Calidad por tier (badge `QualityChip`, NO son prueba de lossless genuino, solo el tier nominal):
- `--q-hires #22d3ee` (cian) · `--q-lossless #5ee19a` (verde) · `--q-lossy-high #fbbf24` (ámbar) · `--q-lossy-low #fb7185` (rojo/naranja)

Geometría / layout:
- `--player-h 80px` · `--mini-player-h 64px` · `--bottom-nav-h 60px` · `--sidebar-w 220px` · `--radius 8px`
- Tipografía: **Inter** (`font-family` en `:root`). Tiempos y contadores usan `font-variant-numeric: tabular-nums` para que no "bailen".

## Glassmorphism (superficies flotantes: menús, modales, paneles)

Receta consistente en todo el proyecto (menú "+", modal de Info, panel de Letra):
```css
background: rgba(24, 24, 24, .82);              /* .72–.85 según cuánto fondo dejar ver */
backdrop-filter: blur(16px) saturate(1.3);     /* blur 16–30px; el panel de Letra usa 30 */
-webkit-backdrop-filter: blur(16px) saturate(1.3);
border: 1px solid rgba(255, 255, 255, .1);     /* borde blanco sutil, NO --border sólido */
border-radius: 14px;
box-shadow: 0 20px 50px rgba(0, 0, 0, .6);
```
- Bordes internos sutiles: `rgba(255,255,255,.06–.12)` (separadores, filas), no `--border` sólido.
- Radios por elemento: **cards ~10px, menús 12–14px, modales 16px, botones/chips 7–10px**.

## Identidad por color (botones)

Cada acción tiene su color y su glow al activarse; mantené la familia:
- **Aleatorio / repetir activos** → glow `--accent` (morado): `filter: drop-shadow(0 0 5px rgba(167,139,250,.65))`.
- **"+" / playlist** → `--teal`.
- **Letra** → glifo en morado + rosa (`--lyric-pink`), destello que late.
- **Info** → ámbar.
- **Calidad** → color por tier (chip `.quality-chip.q-<tier>`).

## Animación y easings (los que ya se usan — reutilizá, no inventes)

- **Spring sutil / bounce** (entradas, pops, rebotes): `cubic-bezier(.34, 1.42, .5, 1)`, variantes `.34,1.4,.5,1` y `.34,1.5,.6,1`.
- **Salida suave** (deslizamientos, letra): `cubic-bezier(.22, 1, .36, 1)`; carta que sale volando: `cubic-bezier(.25,.8,.4,1)`.
- **Vuelta con spring** (spring-back de gestos): `cubic-bezier(.34,1.42,.6,1)`.
- Fades cortos: `ease` / `ease-in`, 0.15–0.3s.
- Nombres de keyframes descriptivos y locales: `info-pop`, `info-pop-out`, `lyrics-in`, `exp-card-in`, `time-tick`, `time-pulse`, `emoji-pop`, `repeat-cycle`, `ptp-menu-in`.
- **Cierre animado**: los overlays no deben desaparecer secos — animá salida (fade+scale) antes de desmontar (patrón `closing` + `setTimeout(onClose, ~180)`), válido para botón, Esc y clic fuera.
- **Gestos**: Pointer Events con eje fijado por el primer movimiento, velocidad suavizada (`v = v*0.7 + inst*0.3`), guard `busy`, y **cancelación limpia** en `pointercancel` / `lostpointercapture` / `blur`.

## prefers-reduced-motion — SIEMPRE

Toda animación/transición nueva necesita su rama en `@media (prefers-reduced-motion: reduce)`:
- Desactivá `animation`/`transition` de movimiento; **conservá cambios de color** (p. ej. la cuenta regresiva mantiene el rojo, quita el pulso).
- Gestos y cierres: en reduced-motion cerrar/rebotar al instante (sin animar).
- Scroll programático: `behavior: reduce ? 'auto' : 'smooth'`.

## Datos: solo lo real

- El panel de Info y los resúmenes muestran **solo datos reales de la DB** (y las fuentes externas **explícitamente acordadas**, hoy MusicBrainz vía `/api/info/artist/:name`). **Nunca inventar** biografías ni traer fuentes no pactadas. Etiquetá el origen externo de forma sutil ("vía MusicBrainz").
- Si una fuente externa no encuentra o falla → mostrar solo lo local, **sin error visible**.

## Anti-patrones (NO hacer)

- ❌ Tocar **backend** (`music-server/`) o **scanner** sin autorización explícita del usuario. La mayoría de las tareas son **frontend**. Si un cambio visual necesita un endpoint, **pedilo/reportalo** antes.
- ❌ Incluir **`package-lock.json`** en los commits (excluir salvo indicación). `.claude/settings.local.json` ya está en `.gitignore`.
- ❌ **Push** sin OK explícito. **Merge a `main`** = deploy a producción → jamás sin OK.
- ❌ Colores/valores mágicos nuevos cuando ya hay un token. Reutilizá `:root`.
- ❌ Animaciones sin su rama de `prefers-reduced-motion`.
- ❌ Romper `tabular-nums` en tiempos/contadores (los dígitos no deben moverse).

## Checklist de entrega (cada iteración)

1. **`npm run build` pasa** (desde `music-server/`: `npm run build`). Sin errores.
2. **Mostrar el diff sin commitear** (`git --no-pager diff` / `--stat`). No commitear ni pushear salvo OK explícito.
3. **"Qué probar"**: pasos concretos en `localhost` (incluí móvil si aplica y el caso `prefers-reduced-motion`). Si tocaste backend, avisá que hay que **reiniciar el server**.
4. Comunicación **casual en español**. Proponé → explicá el porqué → esperá visto bueno (flujo incremental con aprobación).
5. Al commitear (con OK): trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
