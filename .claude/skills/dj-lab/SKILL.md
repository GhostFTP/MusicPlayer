---
name: dj-lab
description: Contrato as-built del Modo DJ web de SonoraRev (/dj) — motor de dos AudioContext (master y cue a audífonos), canales 3-4 opt-in, lo que se guarda en localStorage (djCue) y lo que nunca, salidas que faltan y vuelven, teclado tapado en /dj, alcance, qué prueban dj-unit/dj-func y qué no, la matriz visual (dj-matriz: 11 estados × 10 ventanas, 7 métricas, capturas y hojas de contacto), cómo usar mutar.mjs, límites de V1 y checklist manual con la DDJ-400. Úsala SIEMPRE antes de tocar, revisar o auditar cualquier cosa de music-client/src/dj/ (DjPage.jsx, CueDj.jsx, ControlDj.jsx, motor/*.js), el CSS de /dj, o sus suites (dj-unit.mjs, dj-func.mjs, dj-matriz.mjs, mutaciones/*.mjs).
---

# DJ Lab — contrato del Modo DJ (as-built)

Fuente de verdad de **cómo es** el Modo DJ en el commit en que se escribió (`93ce180`, sub-paso h1, rama
`feat/web-dj`, worktree `C:\Dev\MusicPlayer-dj`). Cada regla cita `archivo:línea`: los números son de ese commit
y se mueven con el código; el **texto citado** es el ancla. Si una línea ya no dice lo que la regla afirma, manda el
código: se corrige la skill (ver «Cómo mantenerla»). Lo marcado **[no verificado]** no tiene una línea en el repo
que lo pruebe.

Reglas generales de trabajo, niveles de autonomía, runner y formato de reporte: `sonorarev-trabajo`. Mediciones
con hardware y prototipos: `sonorarev-dj-audio`. Esta skill no las repite.

## Archivos del sistema

| Archivo | Rol |
|---|---|
| `music-client/src/dj/DjPage.jsx` | La página `/dj`: convivencia con el reproductor normal y la radio, teclas tapadas, `ConsolaDj` (crea el motor, `cargar`, `alternarCue`), `Deck` (botón Cue y su motivo), `MezclaDj`, `BibliotecaDj`. |
| `music-client/src/dj/CueDj.jsx` | «Audífonos (cue)»: lista de salidas, «Usar»/«Quitar salida», avisos, la salida que falta y vuelve, volumen y desfase, recordar en `localStorage`. |
| `music-client/src/dj/ControlDj.jsx` | El control deslizante de la Mezcla y del cue. |
| `music-client/src/dj/motor/motor.js` | El motor: AudioContext del master (decks, mezcla) y el SEGUNDO AudioContext del cue. Nunca lanza. |
| `music-client/src/dj/motor/cue.js` | PURO (lo prueba dj-unit con node): desfase, volumen, relojes, salidas, canales, textos, estado del botón Cue, y todo lo de `djCue`. |
| `music-client/src/dj/motor/salidas.js` | La lista de salidas del navegador (permiso de micrófono sólo para leer nombres, `devicechange`). |
| `music-client/src/dj/motor/carga.js` | Bajar y decodificar una pista (`antesDeBajar`, `cargarPista`, `MAX_SEG`). |
| `music-client/src/dj/motor/mezcla.js` · `midi.js` | Crossfader/filtro · Web MIDI del DDJ-400. |
| `.claude/tools/snap/perf/dj-unit.mjs` · `dj-func.mjs` | Las dos suites del DJ (en `baseline.json`). |
| `.claude/tools/snap/perf/dj-matriz.mjs` · `dj-biblioteca-fija.mjs` · `dj-falsos.mjs` · `dj-hojas.mjs` | La matriz visual de `/dj` (en `baseline.json`), su biblioteca fija, la copia de los falsos de dj-func y las hojas de contacto (sección 9). |
| `.claude/tools/snap/perf/mutar.mjs` · `mutaciones/*.mjs` | Mutaciones de control por sub-paso. |

## 1. Motor (dos AudioContext)

1. **El master nunca recibe `setSinkId`.** Queda en la salida predeterminada (`motor.js:38`). Se crea en
   `asegurarContexto` sin `sinkId` (`motor.js:489`); el ÚNICO `setSinkId` del motor es sobre el contexto de cue
   (`motor.js:450`). dj-func lo cuenta (`sinksMaster`, cs9).
2. **El cue es un SEGUNDO AudioContext, perezoso**, creado con `sinkId: { type: 'none' }` (no abre ningún
   dispositivo) y a `TASA_DJ` (`motor.js:357`, `motor.js:361`); después `setSinkId(id)` y se espera `'running'`
   (`esperarRunning`, `motor.js:336`) con tope `ESPERA_CUE_MS = 2000` (`motor.js:99`). Si `setSinkId` falla, el
   contexto queda mudo y se cierra: nunca suena por la predeterminada (`motor.js:50`–`52`).
3. **Sin gesto del usuario nunca se abre un contexto.** Los que abren son `asegurarContexto` (`motor.js:482`, el
   master), `fijarSalidaCue(…, { abrir: true })` (`motor.js:587`), `fijarCue` (`motor.js:632`) y `abrirSalidaCue`
   (`motor.js:625`). Sólo se llaman desde clics:
   - `asegurarContexto` y `abrirSalidaCue` en `cargar` (`DjPage.jsx:229`, `DjPage.jsx:233`), que llaman los botones
     «A»/«B» y «Cargar igual» (`DjPage.jsx:510`, `DjPage.jsx:511`, `DjPage.jsx:408`);
   - `fijarCue` en `alternarCue` (`DjPage.jsx:263`), desde el botón Cue (`DjPage.jsx:385`);
   - `abrir: true` en `aplicar` (`CueDj.jsx:243`), que sólo llaman `usar` y `usarIgual` (`CueDj.jsx:257`,
     `CueDj.jsx:265`), desde «Usar» y «Usarla igual» (`CueDj.jsx:351`, `CueDj.jsx:389`).
   - Restaurar al montar y rearmar la que vuelve llaman `fijarSalidaCue` SIN `abrir` (`CueDj.jsx:217`,
     `CueDj.jsx:155`): en `'sin-salida'` no hay contexto de cue (lo cierra `fijarSalidaCue(null)`), así que no abren
     nada [leído, no hay un test que lo aísle salvo el conteo de cr1/cr5].
   - Excepción a propósito: con `?diag=1`, `window.__djCue` expone `fijarSalidaCue` y `fijarCue` para la consola
     (`DjPage.jsx:195`, `DjPage.jsx:196`).
   - El MIDI del DDJ-400 no llama a ninguno: su mapa sólo tiene volúmenes, crossfader y filtro (`midi.js:34`).
4. **Deck en pausa o terminado = sin fuente de cue** (`motor.js:55`, `motor.js:279`). Por eso la nota de V1
   (`cue.js:288`).
5. **Una sola resincronización al cambiar de salida con «Usar».** `aplicar` llama `fijarSalidaCue` y, en el mismo
   clic, `fijarDesfaseCue` con el desfase guardado de esa salida (`CueDj.jsx:243`, `CueDj.jsx:246`,
   `CueDj.jsx:251`). Como el motor ya está en `'abriendo'`, eso sólo para las fuentes; la que arranca es la de
   `abrirCue` al quedar lista (`motor.js:474`). Razonamiento en `CueDj.jsx:63`. Medido en dj-func (registro
   `cue_usar_con_cue_sonando`, fuera del conteo): 1 fuente nueva, 1 `setSinkId`, 0 contextos.
6. **Fallos del cue** (rechazo, no llega a `'running'`, `sinkchange` no pedido, `'closed'`): cue apagado, contexto
   cerrado, `'error'` con aviso, master intacto (`motor.js:56`, `fallaCue` en `motor.js:329`, oyente de
   `sinkchange` en `motor.js:375`).

## 2. Canales

1. **'3-4' es opt-in** y **nunca se deduce de `maxChannelCount`** (`cue.js:153`): una Sound Blaster reporta 6 u 8
   canales y ahí los 3-4 son centro y subwoofer.
2. `validarCanales` (`cue.js:155`): `undefined` → '1-2'; '1-2' o '3-4' → ése; lo demás → `null` (inválido).
3. `maxChannelCount` se lee SÓLO al montar la etapa '3-4' (`montarSalidaCue`, `motor.js:386`); con menos de 4 →
   fallo `'sin-canales-3-4'` (`motor.js:396`), con su aviso (`cue.js:176`).

**Nota: hoy 2.1 se cumple porque el dato no llega.** `filtrarSalidas` (`cue.js:106`–`120`) arma cada salida como
`{ id, nombre, grupo, esMaster }` (`cue.js:117`) y no copia `maxChannelCount`; ésa es la lista que la página le pasa
a `decidirRestauracion` (`salidas.js:50`, `CueDj.jsx:202`). La mutación e4a M2a (deducir '3-4' de
`salida.maxChannelCount` en `cue.js:501`) sólo ejercita esa rama con los datos falsos de dj-unit, que agregan
`maxChannelCount: 4` a mano a las salidas (`dj-unit.mjs:1600`, caso `cue_e4_restaurar_permiso_master_y_canales`,
`dj-unit.mjs:1603`). Si algún día `filtrarSalidas` copia ese campo, 2.1 necesita un caso en dj-func.

## 3. Estado y almacenamiento (`djCue`)

1. **El volumen del cue no se guarda** y arranca en 0,5 (`cue.js:31`, `cue.js:33`, `motor.js:235`).
2. **El cue arranca apagado** en los dos decks (`motor.js:234`) y tampoco se guarda.
3. **Esquema** (`cue.js:343`): clave `CLAVE_CUE = 'djCue'`, `VERSION_CUE = 1`, `TOPE_SALIDAS = 8`
   (`cue.js:353`–`355`), `{ v, actual: { id, nombre CRUDO, canales } | null, salidas: [{ id, nombre, desfaseMs,
   usada }] }`. Lo que nunca se guarda ni se lee (cue encendido, volumen, `maxChannelCount`): `cue.js:349`.
   `serializarCue` escribe sólo esos campos (`cue.js:430`); `leerCueGuardado` ignora lo ilegible o de otra versión
   sin borrarlo (`cue.js:421`). El almacén nunca lanza, ni al acceder a `window.localStorage` (`crearAlmacen`,
   `cue.js:360`).
4. **Un «Usar» que falla no pisa lo guardado**: `actual` se escribe sólo si la promesa resuelve `ok`
   (`CueDj.jsx:254`).
5. **Una desconexión nunca borra nada** (`CueDj.jsx:30`): la rama de desconexión de `revisar` llama
   `fijarSalidaCue(null)` (`CueDj.jsx:171`) y no escribe.
6. **Los avisos sólo se cierran.** El de error del motor y el de la página tienen sólo «Cerrar» (`CueDj.jsx:397`,
   `CueDj.jsx:403`), que no borra nada ni cancela el rearme. **El único botón que olvida** es «Quitar salida» de la
   fila (`CueDj.jsx:352`, y en la lista `'vacia'`), visible también en `'error'` y con la que falta
   (`hayQuitar`, `CueDj.jsx:236`); `quitar` olvida `actual` y conserva los desfases (`CueDj.jsx:276`,
   `olvidarActual` en `cue.js:441`).
7. **La guardada se empareja con `elegirGuardada`** (`cue.js:134`): por id; si no, por nombre CRUDO sólo si es
   único; con dos iguales, `'ambigua'`. Nunca por el nombre visible («Headphones (2)» depende del orden del
   navegador, `cue.js:344`).
8. Al abrir `/dj` (una vez por motor, con la lista leída y el motor sin salida): `decidirRestauracion`
   (`cue.js:495`). Ambigua o ausente → aviso y lo guardado intacto (`CueDj.jsx:203`); si no, `fijarSalidaCue`
   SIN abrir (`CueDj.jsx:217`). El primer «Cargar» abre esa salida (`DjPage.jsx:233`).
9. **Desfase al «Usar»**: el guardado de esa salida si existe y es otro; sin guardado, el actual queda (nunca 0)
   (`desfaseAlUsar`, `cue.js:480`).

## 4. Salidas

1. **Con '1-2' en la salida del master se pide confirmación** («Usarla igual»): `decidirEleccion` →
   `'confirmar-misma-salida'` (`cue.js:214`, `cue.js:217`; `esMaster` por `groupId`, `cue.js:99`); en la página,
   `CueDj.jsx:262`. Con '3-4' no se pregunta (la DDJ-400: master y audífonos en la misma salida).
2. **La que vuelve con el MISMO id se rearma sola**, sin abrir y con los cues apagados: `decidirVuelta` →
   `'rearmar'` (`cue.js:514`; página `CueDj.jsx:151`, `CueDj.jsx:155`, aviso «Cue listo (apagado)»
   `CueDj.jsx:156`). Con '1-2' y ahora del master → la confirmación.
3. **Con OTRO id y el mismo nombre crudo** se preselecciona y se pide «Usar» (`CueDj.jsx:162`).
4. **El botón Cue de cada deck** se habilita sólo con el cue en `'abriendo'` o `'lista'` (`estadoBotonCue`,
   `cue.js:278`, `cue.js:279`). Deshabilitado, su motivo se ve en una línea bajo los controles del deck
   (`DjPage.jsx:391`, unida al botón con `aria-describedby`, `DjPage.jsx:383`). El motivo lo decide
   `estadoBotonCue(cueEstado, cueFalta)` (`DjPage.jsx:345`), en este orden:
   - **Con la que falta** (la guardada ausente al abrir o la recién desconectada: CueDj sube su nombre visible con
     `alFaltar`, `CueDj.jsx:103`, y la página se lo pasa a cada deck como `cueFalta`, `DjPage.jsx:295`):
     `Cue no disponible: conecta «X» o elige otra salida.`, con X = ese nombre (`motivoCueAusente`, `cue.js:277`).
     Gana sobre `'error'` y sobre sin salida (`cue.js:280`). **Éste es el motivo que la regla exige:** con la que
     falta, mostrar cualquiera de los otros dos no la cumple.
   - En `'error'` sin la que falta: `Cue no disponible: la salida de audífonos falló. Quítala o elige otra.`
     (`MOTIVO_CUE_ERROR`, `cue.js:276`, `cue.js:281`).
   - Si no, el **genérico** (sin salida): `Para usar Cue, elige una salida de audífonos abajo, en «Audífonos (cue)».`
     (`MOTIVO_CUE_SIN_SALIDA`, `cue.js:275`, `cue.js:282`).

## 5. Teclado en `/dj`

1. **Espacio, ←, →, M y F se tapan** con un `keydown` en fase de CAPTURA (`DjPage.jsx:64`, `DjPage.jsx:112`,
   `DjPage.jsx:114`): los atajos globales miran `e.defaultPrevented` y se callan.
2. **Espacio sobre un botón NO lo activa, a propósito; Enter sí** (`DjPage.jsx:59`; Enter no está en el conjunto,
   `DjPage.jsx:64`). Lo fija dj-func ce10 (`dj-func.mjs:1410`, `dj-func.mjs:1411`). Decisión de diseño: no se cambia.
3. **Sobre un `<input type="range">` pasan Espacio y flechas** (son del control); M y F se siguen tapando
   (`DjPage.jsx:66`, `DjPage.jsx:107`, `DjPage.jsx:108`). En campos de texto y `select` no se tapa nada
   (`DjPage.jsx:109`); con Ctrl, Alt o Meta tampoco (`DjPage.jsx:105`).
4. **Con radio activa no se tapa nada** (`DjPage.jsx:102`).

## 6. Alcance

1. **No se toca `PlayerContext`.** `DjPage` sólo lo LEE (`usePlayer`: `isPlaying` y `pause`, `DjPage.jsx:69`)
   para pausar el reproductor normal al entrar. `git log main..HEAD -- music-client/src/context/PlayerContext.jsx`
   da 0 commits en `feat/web-dj`.
2. **Tope de 900 s por pista** (`MAX_SEG`, `carga.js:20`).
3. **Contexto a 44 100 Hz** (`TASA_DJ`, `motor.js:85`), el del master y el del cue (`motor.js:361`).
4. **Con radio activa** `/dj` muestra «Sal de la radio para usar el Modo DJ» y no monta la consola
   (`DjPage.jsx:133`), ni pausa nada (`DjPage.jsx:83`).

## 7. Pruebas

| Qué | Prueba | No prueba |
|---|---|---|
| `dj-unit.mjs` (node, sin navegador) | Lo puro: `mezcla.js`, `carga.js`, `motor.js` con un AudioContext falso, `midi.js` y `cue.js` (`dj-unit.mjs:1`–`10`). | Nada de DOM ni de navegador. |
| `dj-func.mjs` (Chromium headless, build de producción) | La página entera con `mediaDevices` y `setSinkId` falsos: cuenta contextos de cue, `setSinkId` y fuentes. | El sonido, el corte al resincronizar, clics (`dj-func.mjs:63`); que el audio salga por otro dispositivo y los eventos reales al desenchufar (`dj-func.mjs:51`); el getter de `window.localStorage` que lanza, dos pestañas, «sólo esta vez» de Edge (`dj-func.mjs:72`–`73`). |
| `dj-matriz.mjs` (Chromium headless, build de producción, biblioteca fija) | El LAYOUT de `/dj`: 11 estados × 10 ventanas con 7 métricas (sección 9); en `baseline.json` con 739/739 (`baseline.json:83`). | El sonido, el `setSinkId` real, Edge, el dedo real, el texto dentro de un select o un botón, solapes entre elementos que no son hermanos (sección 9). |
| `regresion.mjs` | Build + las suites del baseline contra `vite preview` (`regresion.mjs:19`, `regresion.mjs:325`). | — |

- **El flag de autoplay es de la suite, no del runner:** dj-func lanza Chromium con
  `--autoplay-policy=no-user-gesture-required` (`tablet-util.mjs:26`, en `.claude/tools/snap/perf/`). Un
  contexto sin gesto NO queda `'suspended'` ahí: «no se abrió nada» se mide **contando** (`dj-func.mjs:1586`).
- **StrictMode no se ejercita:** la app lo monta (`main.jsx:10`) pero el runner usa el build de producción
  (`vite preview`, `regresion.mjs:325`), sin doble montaje.
- **`mutar.mjs`** (`.claude/tools/snap/perf/`): `node mutar.mjs mutaciones/<sub-paso>.mjs [--ids A,B] [--revisar]`
  y `node mutar.mjs --restaurar [--sin-build]` (`mutar.mjs:4`, `mutar.mjs:5`). `--revisar` sólo cuenta las anclas;
  `--restaurar` vuelve a dejar los archivos de una corrida cortada (`mutar.mjs:27`). Estados y códigos:
  `mutar.mjs:31`, `mutar.mjs:37`. **No uses Ctrl+C durante dj-func:** el manejador restaura de inmediato
  (`mutar.mjs:22`) pero ese camino no está probado y el `dist` puede quedar con la mutación; si hace falta cortar,
  después `--restaurar`. Pasá `MUSIC_DB_PATH` si el worktree no tiene base.
- **`mutar.mjs --suites a,b`** corre ESAS suites en lugar de las que exporta el archivo de mutaciones; `dj-matriz` =
  build + la matriz por el runner con el baseline normal (`regresion.mjs --solo dj-matriz`, `mutar.mjs:192`). Con
  `--suites` o con `dj-matriz` el estado es genérico: DETECTADA (la vieron todas las suites corridas, aunque sea
  una) · SOLO … · SOBREVIVE · POR EXCEPCIÓN (`mutar.mjs:39`–`43`). Los controles de la matriz:
  `node mutar.mjs mutaciones/h5.mjs --suites dj-matriz` (sección 9).
- **Puertos:** el runner usa 3100 y 4173 (`regresion.mjs:45`, `regresion.mjs:46`); el 3000 es de otro proyecto y
  no se toca (`regresion.mjs:9`); 3310 y 4310 son manuales de Oscar y no se usan [no verificado: no están en el
  repo, sólo en `sonorarev-trabajo`].

## 8. Límites de V1 y pruebas manuales

**Límites conocidos:**
- El cue **no suena con el deck en pausa** (`cue.js:288`).
- **Cada cambio de desfase corta el cue un instante** (resincroniza; `CueDj.jsx:75`).
- **El desfase es manual, a oído:** el navegador reporta la misma latencia para todas las salidas (`cue.js:28`).
- **Deriva de ~2 ms/min** entre los relojes del master y del cue: [no verificado] (no hay una línea con ese
  número). Se puede medir con `window.__djCue.diag()` y `?diag=1` (`derivaMs`, `motor.js:674`, `motor.js:697`).
- Al desenchufar con un cue sonando, que no siga por la salida predeterminada depende de los eventos reales de
  Edge, que dj-func no reproduce (`dj-func.mjs:51`).

**Checklist manual en Edge con la DDJ-400** (resumen; cómo medir latencia, MIDI y salidas: `sonorarev-dj-audio`):
1. `/dj`, «Ver salidas de audio», dar el permiso de micrófono.
2. Elegir «Línea (2- DDJ-400)» con canales 3-4 y «Usar»: no pide confirmación.
3. Cargar en A y B, play en A, Cue A: se oye en los audífonos y no por el master.
4. Desfase a oído con ±1; cada cambio corta un instante.
5. Desenchufar el USB con el cue sonando: aviso, Cue deshabilitado con «conecta "X"» y **nada por los altavoces**.
6. Volver a enchufar: «Volvió… Cue listo (apagado)»; el próximo Cue suena.
7. Recargar: la salida y el desfase se restauran sin abrir nada; el primer «Cargar» la abre.
8. «Quitar salida» y recargar: no se restaura nada.

## 9. Matriz visual (`dj-matriz`)

`dj-matriz.mjs` (`.claude/tools/snap/perf/`) mide el **layout** de `/dj` en Chromium headless contra el build de
producción. No lee la base real: la biblioteca son 40 pistas fijas servidas con `ctx.route`
(`dj-biblioteca-fija.mjs:48`), y el audio, el MIDI y `mediaDevices` son una COPIA de los falsos de dj-func, con un
`setSinkId` falso (`dj-falsos.mjs:42`). Está en el baseline normal con 739/739 y la cuenta en su nota
(`baseline.json:83`).

**Cómo correrla**
- `node regresion.mjs --solo dj-matriz` (`--solo` sólo acepta nombres del baseline, `regresion.mjs:249`; el build
  corre igual salvo `--sin-build`, `regresion.mjs:313`). Con `MUSIC_DB_PATH` si el worktree no tiene base.
- **Capturas** para revisión humana: `DJ_MATRIZ_CAPTURAS=1` (`dj-matriz.mjs:147`) guarda PNG del viewport en
  `.claude/tools/snap/shots/dj-matriz/<fecha-hora>/`, sólo si `git check-ignore` confirma que la carpeta está ignorada
  (`dj-matriz.mjs:158`); por defecto un subconjunto, con `DJ_MATRIZ_CAPTURAS_TODAS=1` todo (`dj-matriz.mjs:149`). Sin
  la variable no se escribe nada. **Hojas de contacto:** `node dj-hojas.mjs <carpeta>` (una hoja por estado) y
  `node dj-hojas.mjs --comparar <limpio> <otra>` (`dj-hojas.mjs:5`, `dj-hojas.mjs:7`).
- **Controles:** `node mutar.mjs mutaciones/h5.mjs --suites dj-matriz` (sección 7).

**Ventanas** (con ratón): 900×800, 1024×768, 1280×800, 1366×768, 1440×900 y 1920×1080 sin cola
(`dj-matriz.mjs:106`); con la cola abierta cuentan 1280×800, 1366×768, 1440×900 y 1920×1080 (`dj-matriz.mjs:107`);
900×800 y 1024×768 con cola sólo se registran (`dj-matriz.mjs:108`). La tablet (820×1180 y 1180×820, dedo emulado)
sólo va al registro, con E1, E3 y E10 (`dj-matriz.mjs:451`, `dj-matriz.mjs:452`).

**Estados** (cada uno armado por la interfaz y AFIRMADO antes y después de recorrer las ventanas: si no se alcanza,
falla `<estado>_alcanzado` y no se mide nada, `dj-matriz.mjs:502`):
E1 sin salida (`dj-matriz.mjs:360`) · E2 salida lista con decks vacíos (`dj-matriz.mjs:361`) · E3 dos pistas cargadas
y Cue en A (`dj-matriz.mjs:363`) · E4 la salida guardada que falta (`dj-matriz.mjs:366`) · E5 lo mismo con un nombre de
120 caracteres (`dj-matriz.mjs:369`) · E7a la biblioteca bajada hasta el fondo (`dj-matriz.mjs:372`) · E7b búsqueda
con resultados (`dj-matriz.mjs:376`) · E7c «Nada coincide» (`dj-matriz.mjs:378`) · E8 error del motor
(`dj-matriz.mjs:380`) · E9 la confirmación «Usarla igual» sin confirmar (`dj-matriz.mjs:382`) · E10 la DDJ con 3-4,
los dos decks cargados y los dos Cue encendidos (`dj-matriz.mjs:384`).

**Las 7 métricas**, un caso por celda. Cada una exige además la medida estable (dos frames y dos medidas iguales,
`dj-matriz.mjs:281`, `dj-matriz.mjs:286`):

| Caso | Falla si | Línea |
|---|---|---|
| `sin_scroll_horizontal` | `.main-content` o el documento tienen `scrollWidth > clientWidth`. | `dj-matriz.mjs:436` |
| `nada_fuera_del_area` | un descendiente de `.dj-page` se sale del contenido de `.main-content` más de 0,5 px. | `dj-matriz.mjs:200`, `dj-matriz.mjs:437` |
| `sin_solapes` | dos HERMANOS visibles se cruzan más de 0,5 px de ancho Y de alto. No se mira dentro de un control (`dj-matriz.mjs:211`) ni a los hijos absolute/fixed (`dj-matriz.mjs:218`). | `dj-matriz.mjs:225`, `dj-matriz.mjs:441` |
| `sin_texto_cortado` | con overflow ≠ visible, el contenido pasa la caja en más de 1 px y no hay `text-overflow: ellipsis`. Con ellipsis sólo se registra; el eje que scrollea no cuenta. | `dj-matriz.mjs:237`, `dj-matriz.mjs:442` |
| `objetivos_24px` | un control visible y habilitado (no range) mide menos de 24×24 px, o los medidos no cuadran con los contados aparte. | `dj-matriz.mjs:251`, `dj-matriz.mjs:443` |
| `sin_colapsados` | un control visible por CSS tiene caja de menos de 1 px. | `dj-matriz.mjs:261`, `dj-matriz.mjs:445` |
| `decks_a_la_vista` | sin cola y con 768 px de alto o más: con el scroll arriba, un deck no entra entero en lo visible. Es la promesa de `main.css:6278`–`6280`. | `dj-matriz.mjs:447` |

**Qué NO mide:** el sonido ni el `setSinkId` real (`dj-falsos.mjs:42`); Edge ni nada que no sea Chromium
(`tablet-util.mjs:26`); el dedo real (la tablet arma con el clic de Playwright, `dj-matriz.mjs:508`); el texto
dentro de un `select` o de un botón [no verificado: lo mostró el experimento D2 de h5e, sin línea]; solapes entre
elementos que no son hermanos (sólo se comparan hijos de un mismo contenedor, `dj-matriz.mjs:218`).

**Controles** (`mutaciones/h5.mjs`), todos con `--suites dj-matriz`:
- D1, la biblioteca con 1200 px de ancho (`h5.mjs:22`): DETECTADA (scroll y fuera del área).
- D2, `nowrap` en la fila del cue (`h5.mjs:33`): **SOBREVIVE**.
- D3, el select con 900 px de mínimo (`h5.mjs:44`): DETECTADA, sólo en los estados con select.
- D4, el motivo del Cue subido 24 px (`h5.mjs:55`): DETECTADA por solapes.
- D5, el título del deck sin ellipsis (`h5.mjs:66`): DETECTADA por texto cortado, con el título largo.
- D6, los ±1 del desfase a 18 px de alto (`h5.mjs:77`): DETECTADA por objetivos.

**Por qué D2 sobrevive:** el select y los canales tienen `min-width: 0` (`main.css:6391`–`6394`, `main.css:6404`), así que con
`nowrap` se encogen en vez de desbordar. En las ventanas que cuentan, la fila entra en una línea igual. Sólo degrada
con la cola a 900 (que sólo se registra, `dj-matriz.mjs:108`) y en la tablet vertical, por debajo de 900, donde `/dj`
ya avisa «solo para escritorio» (`DjPage.jsx:130`, `main.css:6269`–`6270`): en las dos queda un select más angosto
que su texto. Eso está fuera de lo que V1 promete [no verificado: medidas de h5e, sin línea].

**Hallazgo H1, aceptado para V1:** los dos radios de «Canales» miden 13×13 px, el tamaño del navegador
(`dj-matriz.mjs:116`, `dj-matriz.mjs:117`). En la matriz van como CONOCIDO, con su evidencia exacta. Se acepta porque
V1 es sólo para escritorio con ratón (`DjPage.jsx:130`) y WCAG 2.5.8 exime los controles cuyo tamaño pone el
navegador [no verificado: criterio externo, y la aceptación es una decisión de Oscar en h5f, sin línea]. **Se reabre
si `/dj` pasa a soportar tablet o táctil.**

**CONOCIDOS y ARREGLADO** (lista en `dj-matriz.mjs:115`):
- Un caso que falla y está en la lista sale CONOCIDO y cuenta como pasado. Si la entrada trae `evidencia`, sólo cuando
  TODA la evidencia del caso está en ella; algo más hace FALLAR la celda (`dj-matriz.mjs:550`).
- Un CONOCIDO que ahora pasa sale ARREGLADO y FALLA, para obligar a quitar la entrada (`dj-matriz.mjs:551`).
- Una entrada sin caso falla (`dj-matriz.mjs:552`).
- `DJ_MATRIZ_CONOCIDOS` suma entradas sólo en una corrida, para probar el mecanismo (`dj-matriz.mjs:122`).
- Un fallo nuevo en limpio NO se tapa con un umbral: va a la lista con su id (H2…), su evidencia y su motivo, y se
  decide si se arregla, se acepta o se cambia la ventana.

**Límites de los datos:** 40 pistas fijas (`dj-biblioteca-fija.mjs:48`). La lista monta sólo las filas visibles más 8
de margen (`DjPage.jsx:492`): se miden unas 22 de las 40 por estado [no verificado: contado en h5b, sin línea]. Sólo
Chromium (`tablet-util.mjs:26`).

## Cómo mantenerla

- **Se actualiza en el MISMO commit que cambie una regla** (o una línea citada). Un sub-paso que toca
  `music-client/src/dj/` revisa esta skill antes del commit.
- Para revisar las citas: cada `archivo:línea` debe seguir conteniendo el texto que la regla describe. Lo que no
  tenga línea se marca [no verificado]; nunca se inventa.
- **Antes de commitear cambios en `music-client/src/dj/`:** correr `node .claude/tools/snap/perf/citas-dj-lab.mjs`
  (exit 0 = cada cita sigue conteniendo su texto esperado; una cita nueva o movida necesita su fila en la tabla del
  script, en el mismo commit) y revisar el diff con el agente de usuario `dj-qa` (`~/.claude/agents/dj-qa.md`; vive
  fuera del repo, así que no viaja con la rama).
- **Cualquier cambio de layout o de CSS de `/dj`** (DjPage.jsx, CueDj.jsx, ControlDj.jsx o las reglas `.dj-*` de
  main.css) corre `node regresion.mjs --solo dj-matriz` antes del commit.
- **Si la matriz da ARREGLADO**, la entrada se quita de CONOCIDOS en el MISMO commit que lo arregló. Un fallo nuevo
  en limpio va a CONOCIDOS con su evidencia, nunca a un umbral (sección 9).
- Lo volátil (qué sub-paso sigue, números de una sesión) no vive acá.
