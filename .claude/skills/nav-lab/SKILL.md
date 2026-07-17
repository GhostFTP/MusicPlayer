---
name: nav-lab
description: Estándar de la navegación core de SonoraRev (la escalera única de prioridad dismissTop, la integración con la History API por guardia único, la relación con el gesto swipe-atrás, el Modelo 1 "atrás = Esc", y qué es navegación y qué no). Úsala SIEMPRE antes de tocar o auditar el botón atrás del navegador, la cadena de Esc, el gesto swipe-atrás o cualquier cambio de profundidad de vista (Player.jsx, Layout.jsx).
---

# Nav Lab — estándar de navegación de SonoraRev

Fuente de verdad de **cómo se retrocede** en la app: la cadena de Esc, el atrás
del navegador y el gesto swipe-atrás de móvil. Antes de opinar o tocar,
**inspeccioná los archivos reales** — este mapa dice dónde vive cada cosa y qué
NO se puede romper. Los números de línea son orientativos (el código se mueve);
las funciones, banderas y el orden de la escalera son el ancla.

## Premisa (el contrato, no el botón)

El frente no es "el botón atrás". Es **el modelo de profundidad de navegación de
la app y su única fuente de verdad**. SonoraRev **no usa react-router**: la
navegación es estado interno (`view`/`detailOpen` en Layout, `expanded`/
`showLyrics`/`showInfo` en Player). Para el navegador, toda la app es **una sola
entrada de historial** — por eso el atrás nativo, sin integración, saca al
usuario de la app en vez de retroceder adentro. Este lab define la integración y,
sobre todo, **la única escalera de prioridad que todos los disparadores del
"atrás" respetan**.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/components/Player.jsx` | **El corazón.** La escalera `dismissTop()` (hoy el cuerpo del handler de Esc, ~177-193) y el hook de History API (guardia + `popstate`) viven acá — es el ÚNICO componente que ve la profundidad completa (tiene las 5 banderas en sus deps). `prevViewRef` (~168) = el "atrás" de Novedades. |
| `music-client/src/components/Layout.jsx` | `view`/`navTarget`/`detailOpen` + `navigate()` (~63-66). El **gesto swipe-atrás** de móvil (~130-168): ANGOSTO, solo detalle→lista. |
| `music-client/src/components/InfoPanel.jsx` | El Info maneja su **propio** Esc (~264, cierre animado). Es el escalón más alto de la escalera. |
| Vistas (`Artists.jsx`, `Albums.jsx`, `Genres.jsx`, `Years.jsx`, `Playlists.jsx`) | Consumen la señal `{ reset:true }` (target de `navigate(view)`) para salir del detalle y volver a su lista. NO tienen lógica de "atrás" propia. |
| `music-client/src/context/PlayerContext.jsx` | **NO es de este lab.** Acá viven MediaSession (~218-289) y la cola. La navegación **no lo toca** — ver §Aislamiento. |

## La escalera única — `dismissTop()`

Hay **UNA sola escalera de prioridad**, de lo más "encima" a lo más profundo. Es
el cuerpo histórico del handler de Esc, extraído a una función pura que devuelve
`true` si cerró una capa y `false` si no había nada:

| # | Capa | Bandera | Acción de cierre |
|---|---|---|---|
| 1 | **Info** | `showInfo` | el `InfoPanel` cierra por su cuenta (Esc propio, `InfoPanel.jsx`) — la escalera lo respeta y no baja |
| 2 | **Letra** | `showLyrics` | `setShowLyrics(false)` |
| 3 | **Novedades** | `view === 'changelog'` | `navigate(prevViewRef.current)` (vuelve a la vista anterior) |
| 4 | **Expandido** | `expanded` | `setExpanded(false)` |
| 5 | **Detalle** | `detailOpen` | `navigate(view)` → señal `{ reset:true }` (cada vista la consume) |
| 6 | **Lista** | — | nada: es el nivel más externo |

**El detalle va AL FINAL a propósito:** si el expandido (z 200, `fixed inset 0`)
está montado ENCIMA de un detalle, el atrás debe cerrar primero lo VISIBLE (el
expandido); el detalle solo se cierra cuando no hay overlay ni expandido.

### REGLA DURA #1 — una escalera, sus disparadores, cero lógica duplicada

- `dismissTop()` es **la única** fuente de prioridad. La corren **COMPLETA dos
  disparadores**: el **Esc** y el **`popstate`** (atrás del navegador).
- El **gesto swipe-atrás** de móvil (`Layout.jsx`) es un **tercer disparador
  deliberadamente ANGOSTO**: ataca **solo el escalón 5 (detalle)**, vía el mismo
  primitivo `navigate(view)` que usa ese escalón. **NO llama a `dismissTop()`** —
  hacerlo lo ensancharía (empezaría a cerrar expandido/Letra) y **eso es una
  regresión** (ver REGLA DURA #2). Cero lógica duplicada porque usa el mismo
  primitivo; alcance acotado a propósito.
- **Capa nueva de navegación → se agrega SOLO en `dismissTop()`.** Esc y popstate
  la respetan gratis. El swipe **no** la hereda (sigue angosto), por diseño.

### REGLA DURA #2 — el swipe se queda angosto

El swipe hoy solo actúa en **detalle→lista** (guard `detailOpenRef`, mobile-only
`max-width:700px`). Esto es intencional: cuando expandido/Letra/Info están
abiertos, **cubren `.main-content`** y sus propios gestos (swipe-down) manejan el
cierre — el swipe-atrás horizontal ni debe entrar. Si un cambio hace que el swipe
empiece a cerrar capas que hoy no toca, **es regresión**, no mejora. Cualquier
ensanche del swipe es **decisión explícita del usuario**, nunca efecto colateral
de "unificar".

## Integración con la History API — guardia único (Modelo 1)

Patrón **guardia único**, el más chico y a prueba de loops. Todo el hook vive en
`Player.jsx`, al lado de la escalera:

1. **Armado:** un efecto observa `anyLayerOpen` (OR de las 5 banderas). En la
   transición **0 → >0** hace `history.pushState(marker, '')`. Un `armedRef`
   evita duplicar el guardia si ya hay uno. **No hay que tocar ningún sitio de
   apertura** — se detecta reactivamente.
2. **`popstate` (atrás):** corre `dismissTop()`. Si cerró algo **y queda** otra
   capa abierta, **re-arma** (`pushState`) para atrapar el próximo atrás. Si no
   quedaba nada, **no re-arma** → el siguiente atrás sale de la app.
3. **Modelo 1 — "atrás = Esc":** el atrás solo deshace la profundidad
   dentro-de-vista + Novedades. En la **lista pelada, el atrás SALE de la app**
   (no hay historial de vistas: cambiar de pestaña Biblioteca↔Álbumes NO crea
   entrada). Si algún día se quiere "atrás en la lista va a la pestaña anterior",
   eso es **Modelo 2 (historial de vistas)** — otra feature, se decide aparte.

### ⛔ REGLA DURA #3 — la MÁS importante del contrato (anti-loop)

> **Dentro de `popstate`, SOLO se permite: (a) `setState` vía `dismissTop()`, y
> (b) como mucho UN `pushState` silencioso de re-armado. NUNCA, JAMÁS, llamar
> `history.back()` (ni `history.go(-1)`) dentro de `popstate`.**

Por qué es inviolable: `pushState` **no** dispara `popstate`, así que el
re-armado no genera ciclo. Pero `history.back()` **SÍ** dispara otro `popstate` →
que vuelve a llamar `history.back()` → **loop**. Ese es exactamente el bug de "el
atrás no hace nada" / "hay que apretarlo 5 veces". Si ves un `history.back()`
dentro del handler de `popstate`, **es el bug**, no una optimización. La única
salida del guardia hacia afuera de la app es **dejar** que el `popstate` llegue
sin re-armar (paso 2, rama "no quedaba nada"), no forzarla con `back()`.

## El QUIRK conocido (documentado, NO "arreglado")

**Síntoma:** si el usuario cierra TODO a mano (Esc/botón/swipe) y **después**
aprieta atrás estando ya en la lista pelada, el **primer** atrás se "absorbe" (no
cierra nada visible) y el **segundo** sale de la app.

**Por qué pasa:** el guardia se consume **solo por `popstate`**. Un cierre por UI
mutó el estado pero **no** consumió la entrada de historial → queda un guardia
colgado. El primer atrás lo consume (dismissTop no encuentra nada → no re-arma),
el segundo sale. Si cerrás **CON** el atrás (que es el punto del fix), nunca sobra
un atrás — el quirk solo aparece en ese orden puntual (cerrar a mano, después
atrás).

### ⛔ NO lo "arregles" desarmando el guardia en el cierre por UI

Es tentador: "cuando `anyLayerOpen` pasa a 0 por UI, desarmá el guardia". **Para
desarmar una entrada de historial hace falta `history.back()`** — que dispara
`popstate` (REGLA DURA #3). Para distinguir "este popstate es mi desarme" del
"este es el atrás del usuario" necesitás un flag async con timing → que es
**exactamente** el patrón que reintroduce el loop. **El quirk es el precio
aceptado del diseño sin loop.** Un atrás absorbido de vez en cuando es infinita-
mente preferible a un atrás que no responde. Vive con el quirk.

## Qué NO es navegación (no crea entrada de historial)

- **Toasts** (notificaciones).
- **Controles de reproducción**: play/pausa, next/prev, shuffle, repeat, volumen,
  seek (atajos de teclado en `PlayerContext.jsx` incluidos).
- **Cambio de pestaña/vista** vía bottom-nav o sidebar (Biblioteca↔Álbumes↔…):
  bajo Modelo 1 **no** está en la escalera → no arma guardia.
- **Búsqueda dentro de una playlist** (`Playlists.jsx`, Esc limpia el query): es
  un filtro dentro de la vista, no una capa.
- **Menús transitorios** (`AddToPlaylistMenu`, `EmojiPicker`): tienen su propio
  Esc; hoy **fuera** del guardia (decisión v1). Si se quiere que el atrás cierre
  primero un menú abierto, hay que subir su open-state a `anyLayerOpen` — pactar.

## Fuera de scope / limitaciones conocidas (v1)

1. **Botón ADELANTE:** ignorado. El re-armado (`pushState`) pisa la entrada de
   "adelante", así que no rehace la navegación. Habilitarlo requiere el patrón
   invasivo (abajo).
2. **F5 / recargar:** la navegación es 100% estado y el guardia **no serializa**
   qué detalle/capa estaba abierta. Recargar **resetea al arranque en frío**
   (`view='library'`, sin detalle, reproductor vacío). Es un estado **limpio y
   coherente** — no persiste "qué suena" ni posición (lo único en `localStorage`
   es token/loginMethod, `lastSeenVersion` y `lyricsOffset`/`lyricsHidden` por
   trackId; nada de playback ni de navegación). Restaurar el detalle exacto sería
   codificar el estado en la URL = **deep-linking real, otra feature**.
3. **El patrón invasivo (si algún día se quiere ADELANTE):** "history como única
   fuente" — `pushState` al abrir, y **todos** los cierres (cada "←", swipe-down,
   Esc, Info/Letra/expandido) ruteados por `history.back()`, con `popstate` como
   único ejecutor. Da adelante/atrás perfecto y sin quirk, pero toca ~15 sitios de
   cierre → blast radius grande. **No es v1.** Y aun ahí, REGLA DURA #3 sigue: el
   único que llama `back()` es la UI de cierre, **nunca** el propio `popstate`.

## Aislamiento de MediaSession (importante para producción)

La escalera y el historial viven en **`Player.jsx`**. **MediaSession vive en
`PlayerContext.jsx:218-289`** (metadata, `playbackState`, `setActionHandler`,
`setPositionState`), junto con la cola. **Son archivos distintos: cero solape.**
MediaSession salió en v1.5.0 y está en producción **sin prueba física en el
carro** — el fix de navegación **no debe tocar `PlayerContext.jsx`**. Si un cambio
de "atrás" pretende entrar a ese archivo, **parar y pactar**: se aísla la variable
igual que con la cola (carro primero).

## reduced-motion

El único movimiento del sistema de navegación es el **chevron del swipe-atrás**
(`nav-back-chevron`, `Layout.jsx`): el fundido al SOLTAR se anula en
`prefers-reduced-motion` (`main.css`, regla `.nav-back-chevron { transition: none
!important }`); el seguimiento del dedo durante el drag NO se suprime (interacción
directa). El resto del "atrás" (Esc, popstate) es lógica, sin animación propia —
la animación la pone cada capa al cerrarse (la del InfoPanel, la del expandido,
etc.), y ya respeta reduced-motion en su propio bloque.

## Checklist QA de navegación

1. **Escalera por Esc (no-op del refactor):** con capas apiladas, Esc cierra
   **una por atrás** en el orden exacto Info → Letra → Novedades → expandido →
   detalle → lista. Idéntico a antes del refactor.
2. **Atrás del navegador = Esc:** el atrás cierra las MISMAS capas en el MISMO
   orden que Esc. Nunca dos sistemas distintos.
3. **Expandido + Letra abiertos:** primer atrás cierra Letra, segundo cierra
   expandido (uno por vez, por prioridad).
4. **Lista pelada:** atrás SALE de la app (Modelo 1). No queda atrapado.
5. **No-loop (REGLA DURA #3):** apretar atrás repetido nunca "no hace nada"
   estando con capas abiertas; cada atrás cierra exactamente una. Grep de
   `history.back(` dentro de cualquier handler de `popstate` = **hallazgo
   crítico**.
6. **Quirk acotado:** cerrar todo a mano y después atrás en la lista → un atrás
   absorbido, el siguiente sale. NO debe existir código que intente eliminarlo
   con `history.back()` fuera de `popstate` (reintroduce el loop).
7. **Swipe angosto (REGLA DURA #2):** el swipe-atrás sigue cerrando SOLO
   detalle→lista; NO cierra expandido/Letra/Info; mobile-only; nunca arranca
   sobre un control.
8. **F5 en un detalle:** vuelve a Biblioteca con reproductor vacío (estado limpio,
   no "a medias").
9. **Cosas que NO arman guardia:** toasts, play/pausa, cambio de pestaña,
   búsqueda in-vista → el atrás siguiente no queda "absorbido" por ellas.
10. **Aislamiento:** el diff del fix NO toca `PlayerContext.jsx` (MediaSession) ni
    ensancha el gesto de `Layout.jsx` sin decisión explícita.
