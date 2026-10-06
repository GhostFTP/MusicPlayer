---
name: perf-lab
description: Estándar del trabajo de RENDIMIENTO y fluidez del web player de SonoraRev — reglas duras de cada sub-paso, protocolo de medición (build de producción, audio sintético, CPU 1x/4x, software/GPU, 3 corridas con mediana y rango, baseline en la misma sesión), inventario de los scripts de .claude/tools/snap/perf/, trampas ya aprendidas, checkpoint estándar y formato de entrega (reporte corto + archivo .md). Úsala SIEMPRE antes de medir, diagnosticar u optimizar la velocidad o la fluidez del web player.
---

# Perf Lab — rendimiento y fluidez del web player

Fuente de verdad del **método**. Lo volátil (estado del plan, números de la última sesión, qué
sub-paso sigue) **no vive acá**: está en el doc del Project "perf-web-frente1". Si un número de
acá contradice una medición nueva, manda la medición.

## 1. Reglas duras (no romper)

1. **Antes de tocar nada:** `git status --untracked-files=all` (sin eso una carpeta nueva no
   muestra sus archivos) y `git log --oneline -4`. Rama, commits y árbol deben
   coincidir con lo que dice el prompt. Si no coinciden → **detenerse y avisar**.
2. **Nunca commit ni push.** Oscar commitea.
3. **Backend (`music-server/`) no se toca.** Si algo lo necesita, se anota y se pregunta.
4. **CHANGELOG.md y CLAUDE.md no se tocan** salvo pedido explícito.
5. **Ni `contain:strict` ni `will-change` generalizado** sin OK. `will-change` sólo en el elemento
   animado y justificado con una medición.
6. **La apariencia es decisión de Oscar.** Si algo no queda idéntico (diff de píxeles con
   animaciones congeladas): **restaurar** el estado anterior, reportar con recortes ampliados
   (antes | después | diff) y **2 alternativas**. Nunca dejarlo a medias.
7. **Un sub-paso a la vez.** Al cerrar: **detenerse** y esperar el OK.
8. **Árbol sucio y otros worktrees:** no mezclar cambios ajenos. Existe al menos un worktree
   aparte (`C:/Dev/MusicPlayer-1.21.1`, frente de videos): no se toca ni se borra.
9. **Filas/tarjetas memoizadas y `PlayerContext`:** no tocarlos salvo que el sub-paso lo pida.

## 2. Etiquetas

Toda afirmación va como **[MEDIDO]** (corrí algo y vi el número), **[LEÍDO]** (lo vi en el
código) o **[NO MEDÍ]**. Mejor un "no lo medí" que una suposición vendida como hecho.

## 3. Protocolo de medición

- **Puertos de la sesión: 3100 (backend), 4173 (nuevo), 4174 (baseline).** El `:3000` NO se usa:
  en esta máquina corren otros proyectos de Oscar en puertos comunes (CLASSIFY, Next.js, en
  `:3000`). Ver §5 "Servidores".
- **Backend local:** `PORT=3100 npm start` en `music-server`.
- **Build de producción**, nunca dev: `npm run build` en `music-client` + `npx vite preview
  --config <scratchpad>/vite-preview-<build>.config.mjs --port <4173|4174> --strictPort`. El
  `server.proxy` de `vite.config.js` apunta fijo a `:3000` y **no se edita**: el config temporal
  (en el scratchpad, sin importar `vite`) es un objeto plano
  `{ root: '<ruta de music-client del build>', preview: { proxy: { '/api': 'http://localhost:3100',
  '/stream': 'http://localhost:3100' } } }`.
- **Baseline en la MISMA sesión:** `git worktree add --detach <scratchpad>/<nombre> <commit>`,
  copiar `music-client/node_modules`, build y servirlo en `:4174` con su propio config temporal
  (`root` = el `music-client` del worktree). Se comparan los dos en la misma corrida, nunca
  contra números viejos.
- **Audio:** los FLAC no están en la máquina local (`/stream` da 404). Se intercepta `/stream/*`
  con un **WAV silencioso de 15 min** (8 kHz mono) **con soporte de Range** (sin 206 el seek falla).
- **Matriz:** CPU **1x y 4x** (4x ≈ teléfono) × **software y GPU** (`--enable-gpu
  --use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu-rasterization`).
- **Ventanas de 5 s, 3 corridas por escenario → mediana y rango.** Rangos que se solapan =
  **ruido**, no conclusión.
- **Métricas:** `TaskDuration` de CDP (hilo ocupado) · long tasks · frames/s del hilo principal
  (`ProxyMain::BeginMainFrame` en un trace) · re-renders por **identidad de `__reactProps$`** en
  el DOM · commits de React (hook de devtools, funciona en prod) · requests (en DevTools: Preserve
  log apagado, Disable cache encendido, chip All) · nodos DOM · tecla→tabla · keydown→input pintado.
- **Escala:** la DB local tiene ~680 pistas y producción ~1200+. Para listas, medir también con
  biblioteca sintética (1200 y 3000) interceptando `/api/tracks` y multiplicando con ids únicos.
- **Visual:** capturas deterministas (tiempo y animaciones congeladas en la misma fase) + diff de
  píxeles. Antes de comparar, medir el **piso de ruido** (dos tandas del mismo build).

## 4. Scripts (`.claude/tools/snap/perf/`)

Todos se corren con `SNAP_BASE=http://localhost:<puerto>` desde esa carpeta. Login: ver §5.

| Script | Qué hace · cómo se corre |
|---|---|
| `regresion.mjs` + `baseline.json` | **La regresión completa en un comando.** Build, levanta SU backend (3100) y SU preview (4173), corre los scripts de `baseline.json` en orden y da PASA / FALLA(claves) / NO CORRIÓ por fila, con código 0/1/2. Apaga sólo sus propios procesos (`taskkill /T /F` sobre sus hijos: aplica el espíritu de §5 —nunca por puerto ni por nombre— pero sin el `.ps1`, porque los PIDs son hijos directos del runner). Trabaja sobre una COPIA temporal de la base (nunca escribe en la original; `MUSIC_DB_PATH` elige el origen) y crea ahí la segunda cuenta de `albview-func` con el CLI del backend. El baseline se cambia sólo a mano y en un commit. `node regresion.mjs [--solo a,b] [--sin-build] [--baseline <ruta>]` (~7 min; reporte `AAAA-MM-DD-HHmm-regresion[-parcial].md`) |
| `perf.mjs` | Diagnóstico general: Biblioteca/Álbumes/detalle 5 s sonando, re-renders por tick, búsqueda, navegación, scroll. `CPU=1\|4 node perf.mjs` |
| `rows.mjs` | Filas/tarjetas re-renderizadas por **acción** (siguiente, pausa/play, carga) + commits. `CPU=1 node rows.mjs` |
| `anim-solo.mjs` | Costo de cada animación de la barra **sola** (las otras apagadas por CSS): mediana/rango + frames/s. `CPU GPU ONLY EXTRA_CSS EXTRA_JS` |
| `paint.mjs` | Experimento de pintado con CSS inyectado (variantes, GPU vs software); `--behavior` revisa content-visibility. `CPU GPU` |
| `paint-isolation.mjs` | Variante corta: Biblioteca sonando normal / barra en capa propia / `contain:strict` (sólo medición). `CPU` |
| `search.mjs` | Búsqueda: tecla→tabla, requests, LT, commits, identidad de nodos y latencia del input. `CPU SCALE=1200\|3000` |
| `shots.mjs` | Capturas deterministas de barra, expandido y glifo en `shots/sub3/<OUT>`. `OUT=nombre [EXTRA_CSS EXTRA_JS]` |
| `shotdiff.mjs` | Diff píxel a píxel entre dos carpetas de `shots/sub3`. `node shotdiff.mjs antes despues [tol=16]` |
| `func.mjs` | Funcional del player: barra, seek, MediaSession, cola, letra, expandido (15 chequeos). |
| `func2.mjs` | Funcional de filas/tarjetas: clic, menú, long-press móvil, arrastres, álbum/género (18). |
| `func-search.mjs` | Funcional de la búsqueda local: resultados, orden, vacío, acentos, cola filtrada (13). |
| `sqlbench.mjs` | Benchmark de la SQL de búsqueda/álbumes sobre la DB en sólo lectura. `node sqlbench.mjs <ruta music.db>` |

## 5. Trampas ya aprendidas

- **`!important` en CSS inyectado impide componer** la animación (`compositeFailed 0x40000`,
  *affects important property*): un prototipo así mide de más. Usar mayor especificidad.
- Chromium headless **rasteriza por software** (SwiftShader) por defecto: comparar con los flags
  de GPU antes de culpar al pintado.
- La fila "sin cambios" **varía mucho entre corridas** → siempre baseline en la misma sesión y
  mediana/rango.
- El motivo de que una animación no se componga está en el trace: eventos `Animation` con
  `compositeFailed` y `unsupportedProperties` (unirlos por `id` con el evento que trae el nombre).
- Una **variable CSS heredada que cambia en cada tick** alcanza al elemento animado y fuerza
  frames en el hilo principal aunque no la use; un elemento cuyo **tamaño** cambia, también.
- **Servidores: se apaga SÓLO lo que lanzó esta sesión.** En Q1 un apagado "por puerto" mató el
  Next.js de CLASSIFY en `:3000`. Reglas:
  1. **Nunca** matar por puerto genérico ni por nombre de proceso (`node`, `next`, `vite`).
  2. **Antes de levantar:** `curl` a 3100/4173/4174 debe dar `000` (libres). Si alguno responde,
     NO se toca: se avisa y se para. Anotar también qué responde `:3000` (`curl -s -o /dev/null
     -w '%{http_code}' localhost:3000/`) para compararlo al cerrar.
  3. **Al levantar:** cuando cada puerto responda 200, guardar en `<scratchpad>/session-pids.txt`
     el PID que escucha (`puerto pid`). Como el puerto estaba libre antes, ese PID es de la sesión.
  4. **Al cerrar:** matar sólo los PIDs de ese archivo, y sólo si (a) siguen escuchando en SU
     puerto y (b) son de este proyecto: línea de comandos de `vite preview` con el config de la
     sesión o ruta dentro de `MusicPlayer`, o (para el backend, cuya línea es sólo
     `node … server.js`) un padre `npm … start`. Cualquier otro proceso: no se toca y se avisa.
  5. **Después:** 3100/4173/4174 en `000` y `:3000` respondiendo **lo mismo que al empezar**.
  `TaskStop` no mata los hijos de node, por eso hace falta el `.ps1`. Desde Git Bash no pasar el
  comando inline a `powershell -Command` (bash expande `$_`): escribirlo con heredoc `<<'EOF'` y
  correrlo con `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`. Esqueleto del cierre:
  ```powershell
  $pids = '<ruta del scratchpad>\session-pids.txt'   # la escribe el paso 3
  Get-Content $pids | ForEach-Object {
    $port, $procId = $_ -split ' '
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $c -or $c.OwningProcess -ne [int]$procId) { "puerto $port ya no es de la sesión: no toco"; return }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
    $gpa = Get-CimInstance Win32_Process -Filter "ProcessId=$($par.ParentProcessId)"
    $chain = "$($p.CommandLine) | $($par.CommandLine) | $($gpa.CommandLine)"
    if ($chain -like '*MusicPlayer*' -or $chain -like '*vite-preview-*config*' -or $chain -like '*npm-cli.js*start*') {
      "apago $procId (:$port)"; Stop-Process -Id $procId -Force
    } else { "NO toco $procId (:$port): $($p.CommandLine)" }
  }
  ```
  Las tareas de fondo quedan como "failed, exit 127": es el efecto de matarlas, no un error de
  arranque.
- Para esperar a que levanten: `curl` hasta 200 en `localhost:3100/api/auth/config` (público) y
  en `localhost:<4173|4174>/api/auth/config` (prueba también el proxy); ~2 s, con tope de 30 s.
- Al cerrar: apagar los servidores de la sesión (arriba) y `git worktree remove --force` +
  `git worktree prune` de los temporales.
- El parámetro de búsqueda del servidor es **`search`**, no `q`. Su `LIKE` ignora mayúsculas
  sólo en ASCII y no ignora acentos; la Biblioteca filtra local (`utils/searchText.js`).
- **Capturas:** nunca reportar un PNG sin pegar `ls -la`/`dir` con su tamaño.
- Los scripts importan `../session.mjs` (ruta relativa). `snap@local` usa una contraseña local
  en `.claude/tools/snap/.env` (ignorado); si da 401, se resetea sólo con OK de Oscar.
- `func.mjs` y `shots.mjs` usan un WAV de **120 s** a propósito (sus seeks y "2:00" dependen de
  eso); los de costo usan 15 min para que el audio no termine a 4x.
- **Tiempo del player:** el estado vive en `PlayerContext` y el tiempo en `PlayerTimeContext`.
  `usePlayerTime()` sólo donde se pinta el tiempo: `Player`, `LyricsPanel` y la barra de
  progreso de la cola (`QueueOverlay` → `NowPlayingProgress`). MediaSession lee el estado dentro
  del provider.
- Filas memoizadas: cualquier closure creada en el `.map()` rompe el `memo`; las funciones se
  pasan estables y la fila las llama con sus datos.
- `drag_album_a_cola` falla en `func2.mjs` desde antes de este frente (álbum con `album_artist`
  vacío; `utils/itemTracks.js`). Es el único fallo tolerado.

## 6. Checkpoint estándar (al cerrar cada sub-paso)

0. **`node regresion.mjs`** (§4): build + regresión completa contra `baseline.json`, código 0. Es el
   reemplazo de correr los scripts a mano y contar; su tabla va al reporte tal cual.
1. `npm run build` en exit 0 (el runner lo incluye; con `--sin-build`, a mano).
2. `git status` + `git diff --stat`: archivos tocados = los permitidos por el prompt.
3. Scripts nuevos sin trackear, listados.
4. Servidores de la sesión apagados (sólo los PIDs de `session-pids.txt`, §5): 3100/4173/4174 en
   `000` y `:3000` respondiendo igual que al empezar. Worktrees temporales borrados.

## 7. Formato de entrega

- **Veredicto primero**, luego tablas compactas, **[NO MEDÍ] al final**. Corto.
- El reporte **completo** se escribe SIEMPRE en
  `.claude/tools/snap/shots/reports/AAAA-MM-DD-<tema>.md` (carpeta ignorada por git; verificar
  con `git check-ignore -v` antes de escribir y, si no lo estuviera, avisar en vez de crearla).
- En el chat va **sólo el resumen + la ruta del archivo**: Oscar sube el archivo en vez de copiar
  de la terminal. Si el resumen es largo, partirlo en 2 mensajes.
- Excepción: un agente **sin `Write`** (p. ej. `perf-qa`) entrega en el chat; el hilo principal
  guarda el `.md` si hace falta.

## 8. Plantilla del prompt corto

Con esto basta; el resto lo pone esta skill:

```
FRENTE 1 · SUB-PASO N — <título>.
Rama/commit esperado: <rama> con <commits>.
Objetivo y meta: <qué y con qué número, p. ej. "tecla→tabla < 100 ms a 1x">.
Aprobado: <qué se puede cambiar, archivos esperados>.
Prohibido en esta tanda: <lo que NO se toca además de las reglas duras>.
Medir: <escenarios y métricas; baseline = commit X>.
```
