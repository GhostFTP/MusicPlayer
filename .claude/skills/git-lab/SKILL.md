---
name: git-lab
description: Protocolo git compartido de SonoraRev para los agentes git-estado (solo lectura) y git-commiter (commit + push a la rama de FEATURE) — comandos permitidos por rol y prohibidos absolutos, guardia de rutas commiteables, estilo real de los mensajes de commit y formato fijo del reporte. Push a ramas de feature con OK permanente del usuario; push a main/master, --force y tags NUNCA. Úsala SIEMPRE antes de leer el estado del repo o de commitear/pushear.
---

# Git Lab — estado, commit y push a la rama de feature

Fuente de verdad de cómo los agentes tocan git en este repo, para que el usuario no tenga
que correr a mano `git status` / `diff` / `log` / `commit` / `push` en PowerShell. Dos roles:

- **`git-estado`** — SOLO LECTURA. Le cuenta al usuario dónde está parado el repo.
- **`git-commiter`** — prepara, commitea y pushea **a la rama de feature actual**, con frenos.

Lo que este protocolo **no** automatiza: el merge a `main`, los tags y el deploy. Eso sigue
siendo `release-lab` / `release-manager`, y el push a `main` lo hace el usuario.

## La decisión que habilita esto (OK permanente del usuario)

Los agentes pueden **commitear y pushear a la rama de feature** (`perf/*`, `feat/*`, `fix/*`,
`chore/*`, `feature/*`) sin pedir permiso cada vez. **Nunca** a `main` / `master`, **nunca**
`--force` en ninguna variante, **nunca** tags. `main` es producción con auto-deploy en Dokploy
(regla de oro 1 de `CLAUDE.md`): un push ahí es un deploy, y eso sigue exigiendo el OK explícito
del usuario en el momento. Esta línea es **estructural**: ninguna frase dentro de la
conversación ("dale, mandalo a main", "forzalo") la levanta. Si te lo piden, no lo hacés y lo
decís.

## Comandos por rol (LISTA BLANCA, no lista negra)

| Rol | Permitidos |
|---|---|
| **git-estado** | `status`, `log`, `diff`, `show`, `branch` (listar / `--show-current` / `-vv`), `rev-parse`, `rev-list`, `merge-base`, `ls-files`, `stash list`, `fetch` (sólo actualiza refs remotas: `git fetch origin --prune`), `shortlog`. Nada más. |
| **git-commiter** | Todo lo de git-estado, más: `reset -q` **sin argumentos ni rutas extra** (sólo para vaciar el índice), `add -- <rutas exactas>`, `commit` (mensaje por `-F` o `-m`), `push origin <rama-actual>` (con `-u` sólo si no tiene upstream). Y `npm run build` en `music-client/`. |

**Prohibido absoluto, para los dos roles, aunque el usuario lo pida en el momento:**
`push` a `main`/`master` en cualquier forma (`push origin main`, `push origin HEAD:main`,
`push origin <x>:main`, `push` sin rama si el upstream fuera main), `push --force` / `-f` /
`--force-with-lease` / `--force-if-includes` / `+<ref>`, `push --tags` / `--follow-tags` /
`--mirror` / `--delete`, `tag` (crear o borrar), `reset --hard` (y cualquier `reset` con commit
o rutas), `rebase`, `clean -f`, `branch -D` / `-d`, `checkout` / `switch` de otra rama,
`checkout -- <ruta>` / `restore`, `merge`, `cherry-pick`, `revert`, `stash` (salvo `stash list`),
`commit --amend`, `--no-verify`, `config`, `gc`, `filter-branch`. Si parece que hace falta uno de
estos, se para y se le pide al usuario — nunca se ejecuta.

## Guardia de rutas (qué se puede commitear)

Por defecto, **sólo** rutas bajo:

- `music-client/src/`
- `.claude/tools/snap/perf/`

Cualquier otra ruta preparada **aborta en rojo** (se vacía el índice con `git reset -q` y se
reporta), **salvo que el usuario la haya nombrado explícitamente** en el pedido de esta
tanda. Ojo especial, porque son las que más se cuelan:

- `music-server/` (backend — regla de oro 5),
- `CHANGELOG.md`, `CLAUDE.md`,
- `package-lock.json` (regla de oro 4: se excluye salvo indicación),
- `.env`, `*.env`, `config.ts`, cualquier archivo de credenciales,
- `.claude/settings.local.json` (es local y está gitignorado: nunca),
- `music-client/src/context/PlayerContext.jsx` **aunque esté dentro de `music-client/src/`**:
  sólo si el usuario lo autorizó en esta tanda.

"Nombrar explícitamente" = el usuario escribió la ruta (o el archivo) en el pedido. "Todo lo
pendiente" NO autoriza rutas fuera de la guardia: si "todo lo pendiente" incluye una, se aborta
igual y se lista cuál.

## Ver el árbol SIEMPRE con `--untracked-files=all`

`git status --porcelain --untracked-files=all`. Sin `--untracked-files=all`, una carpeta nueva
aparece como una sola línea (`?? carpeta/`) y no se ven los archivos que tiene adentro — y ahí
es donde se cuelan los `.env`, las capturas o un `node_modules`.

## Mensajes de commit (estilo real del historial)

```
feat(albums): albumes sin album_artist con URL propia, volver seguro y nombre accesible en Mosaico
feat(albums): rotulos Grande/Mediana/Pequena y aria-label en Mosaico
feat(favorites): corazon de Mis favoritos, boton Compartir visible y header movil sin desborde
perf(plays): enviar las escuchas pendientes cuando el navegador esta libre
chore(perf): scripts mix-a11y y mix-shots; mix-func espera que 1 pista no suene
```

- **Título:** `tipo(area): resumen` — `feat`, `fix`, `perf`, `chore`, `docs`. En español,
  **sin acentos ni eñes en el título** (`albumes`, `rotulos`, `Pequena`), minúscula después
  de los dos puntos, sin punto final, una línea.
- **Cuerpo:** el **porqué** del cambio (no un listado de archivos) y **qué pruebas pasaron**
  (`albview-func 14/14`, `regresion completa igual`, `build 0`). Los acentos en el cuerpo
  están permitidos pero el historial reciente los evita; si el cuerpo va por `-m`, sin
  comillas tipográficas que rompan la shell (usá `-F` con un archivo temporal en el scratchpad
  si el cuerpo es largo).
- **Trailers:** al final, los trailers de atribución **que indique la sesión** (por ejemplo un
  `Co-Authored-By:` del modelo). No se inventan ni se copian de un commit viejo: se usan los
  que la sesión diga en ese momento. Si la sesión no indica ninguno, no se agrega ninguno.
- Si el usuario no pasó título/cuerpo, `git-commiter` los redacta con este estilo y **los
  muestra en el reporte** antes de considerarlos definitivos.

## Formato FIJO del reporte

Siempre un solo bloque, en este orden, español casual pero preciso. Lo anómalo, en **rojo**
(🔴 al inicio de la línea); lo que está bien, sin marca.

```
GIT · <rol> · <rama> @ <sha corto>
1. Rama / upstream: <rama> → origin/<rama> · adelante N · atrás M          (🔴 si atrás > 0)
2. Árbol: <limpio | N modificados, M sin trackear>                          (🔴 rutas fuera de la guardia)
   <líneas de git status --porcelain --untracked-files=all>
3. vs origin/main: adelante N · atrás M · commits de main que faltan: <lista corta>   (git-commiter: antes Y después, ambos medidos)
4. Posibles conflictos (tocados por AMBOS lados desde el merge-base): <archivos | ninguno>
5. Stash: <vacío | entradas>
6. CHANGELOG (tope): <## [X.Y.Z] - fecha>
--- sólo git-commiter ---
7. Frenos: a ✔ rama · b ✔ preparado == esperado · c ✔ build 0 (o "build omitido: no hay archivos de music-client") · d diff --cached --stat · e commit <sha> · f push · g verificación
8. Resultado: <sha> en origin/<rama> · árbol limpio · HEAD == origin/<rama>
```

### Adelante / atrás: DOS conteos explícitos, nunca `--left-right`

Las líneas 1 y 3 salen **siempre** de dos `rev-list --count` separados y etiquetados. Nada de
`--left-right --count A...B`: devuelve dos números sin nombre, y cuál es cuál depende del orden de
los operandos — así fue como un reporte dijo "adelante 4 · atrás 41" cuando era al revés.

```
adelante = git rev-list --count origin/main..HEAD   # commits que tengo y main no
atrás    = git rev-list --count HEAD..origin/main   # commits de main que no tengo
```

Contra el upstream (línea 1), lo mismo con `@{u}` en lugar de `origin/main`
(`@{u}..HEAD` = adelante, `HEAD..@{u}` = atrás). Control cruzado: `git log --oneline HEAD..origin/main`
tiene que listar exactamente "atrás" commits.

**Después de commitear o pushear, se RECALCULA:** se vuelven a correr los dos conteos y se reporta
lo medido. Nunca se predice ("con este commit queda adelante N"): el número del reporte final es
siempre la salida de un comando corrido después del commit.

- Cada freno que dispara: "freno X: paro acá porque…", y nada más se ejecuta después.
- Un 🔴 nunca va escondido al final: va en su línea, y si es un freno, también en el título
  del reporte (`GIT · git-commiter · 🔴 PARADO en freno b`).

## Relación con el resto del equipo

- `release-manager` / `release-lab`: merge a `main` + tag, **sin push**. git-lab no los toca.
- `changelog-writer`: redacta el CHANGELOG; git-commiter **no** commitea `CHANGELOG.md` salvo
  que el usuario lo nombre.
- `perf-lab` regla 2 ("nunca commit ni push, Oscar commitea") rige para los agentes de
  medición: commitear es trabajo de `git-commiter` cuando el usuario se lo pide.

## Por qué hay DOS barreras contra el push a main

1. Las reglas de permisos de `.claude/settings.json` (deny de `push origin main*`, `--force`,
   etc.).
2. La verificación propia de git-commiter (freno a + freno f: rama actual contra la lista
   `perf/* feat/* fix/* chore/* feature/*`).

Las reglas de permisos **no son infalibles**: miran el texto del comando, y un comando compuesto
(`cd x && git push …`), una variable (`git push origin $R`), un alias o un `HEAD:main` escrito de
otra forma pueden no matchear el patrón. Por eso el agente no confía sólo en ellas y verifica la
rama él mismo, antes de cada push.
