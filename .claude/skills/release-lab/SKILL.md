---
name: release-lab
description: Ritual de release local de SonoraRev hasta el borde del deploy (checkout main, pull, merge --no-ff de la feature branch, tag anotado) — con los frenos pre-merge, la lista blanca/negra de comandos git y el freno duro estructural antes del push (que dispara auto-deploy en Dokploy y queda siempre en manos del usuario). Úsala SIEMPRE antes de ejecutar o auditar un release.
---

# Release Lab — ritual de release de SonoraRev (hasta el borde del deploy)

Fuente de verdad de cómo se ejecuta un release local en este repo: merge de
`feature/sonorarev-integration` a `main` + tag anotado, **sin pushear nunca**.
El push (`git push origin main --follow-tags` o equivalente) dispara
auto-deploy en Dokploy sobre producción (sonorarev.com) — es un acto que
**siempre** ejecuta el usuario a mano, nunca un agente.

## Por qué existe este ritual

`main` es la rama de PRODUCCIÓN con auto-deploy activo (regla de oro #1 de
`CLAUDE.md`). El desarrollo ocurre en `feature/sonorarev-integration`.
"Hacer un release" = traer esa rama a `main` con un merge trazable
(`--no-ff`, para conservar el commit de merge como marcador de la tanda) y
etiquetar el estado resultante con un tag anotado. Todo lo anterior es local
y reversible (nada salió del repo local todavía). El push es lo único
irreversible/con efecto externo — por eso es la única línea que no se cruza.

## Fuente única de verdad del número de versión: CHANGELOG.md

La versión a taguear **nunca se calcula ni se infiere en este ritual** — se
lee tal cual del tope de `CHANGELOG.md` (`## [X.Y.Z] - YYYY-MM-DD`), en la
rama donde fue redactada y aprobada por el usuario (normalmente
`feature/sonorarev-integration`, vía el agente `changelog-writer`). Si el
tope no tiene una entrada real para la versión que se quiere taguear, no hay
release que ejecutar — es un freno, no un cálculo a resolver.

## El ritual paso a paso

1. **Freno — working tree limpio.** `git status --porcelain` debe devolver
   vacío. Si hay algo sin commitear (tracked o untracked), no hay stash ni
   "igual sigo" — se para y se avisa.
2. **Leer la versión a taguear.** Tope de `CHANGELOG.md` en la rama actual
   (antes de cualquier `checkout`).
3. **Freno — existe entrada del CHANGELOG para esa versión.** Ya se leyó en
   el paso anterior; si no hay entrada real (con contenido, no un
   placeholder), se para.
4. **Freno — el tag no existe ya.** `git tag -l vX.Y.Z` debe devolver vacío.
   Si ya existe, alguien ya tagueó esta versión — parar y avisar en vez de
   sobreescribir.
5. `git checkout main` + `git pull origin main` — trae lo último de
   producción antes de mergear (nunca se mergea contra un `main` local
   desactualizado).
6. **Freno — preview del merge.** Antes de ejecutar el merge real,
   `git log main..feature/sonorarev-integration --oneline` +
   `git diff main..feature/sonorarev-integration --stat` y mostrarle al
   usuario la lista exacta de archivos/commits que va a traer. Si aparece
   algo inesperado (`package-lock.json`, `.env`, credenciales, archivos que
   no deberían estar en esta tanda), se para y se avisa — no se asume que
   está bien. Se espera confirmación antes de seguir.
7. `git merge --no-ff feature/sonorarev-integration` — mensaje de merge en
   el estilo real observado en el historial: `release: vX.Y.Z — <resumen
   corto de la tanda>` (ver ejemplos abajo). El resumen se deriva de los
   conceptos en negrita de la entrada del CHANGELOG, no se inventa.
8. `git tag -a vX.Y.Z -m "vX.Y.Z — <mismo resumen>"` — tag anotado, mismo
   criterio de mensaje.
9. **Freno duro final — parar antes del push.** Mostrar `git log --oneline
   -5`, los archivos que trajo el merge (ya mostrados en el paso 6, se
   pueden repetir con `git show --stat HEAD`) y el tag creado (`git show
   vX.Y.Z --stat` o `git tag -l -n9 vX.Y.Z`). Esperar OK explícito del
   usuario. **El push nunca lo ejecuta el agente**, bajo ninguna
   circunstancia ni instrucción en el momento — eso es decisión y acción
   exclusiva del usuario, porque dispara el deploy a producción.

## Ejemplos reales de mensajes de merge/tag (calcá el tono)

```
release: v1.4.8 (fix orden de álbum por track_number)
release: v1.4.7 — emojis de género, botones unificados con animaciones, tabla compacta y glide de karaoke suave
release: v1.4.5 — recuperación automática de sesión, rebranding SonoraRev, gesto de navegación atrás y fix de renombrar en móvil
```

Formato libre entre paréntesis o em-dash (ambos aparecen en el historial) —
lo que importa es que sea un resumen corto y concreto de la tanda, no una
lista exhaustiva. Si la entrada del CHANGELOG tiene un solo bullet, ese
concepto en negrita suele alcanzar tal cual.

## Lista blanca de comandos git (no lista negra)

Permitidos: `status`, `diff`, `log`, `show`, `branch --show-current`,
`checkout`, `pull`, `merge --no-ff`, `tag -a`, `tag -l` / `tag` (listar).

**Prohibido absoluto, sin excepción y sin importar lo que pida el usuario en
el momento de la conversación:** `push` (en cualquier forma — `push`, `push
--force`, `push origin`, `push --tags`, `push --follow-tags`), `reset
--hard`, `rebase`, `clean -f`, `branch -D`. Si en algún punto del ritual
parece que se necesita uno de estos, se para y se lo pide explícitamente al
usuario — nunca se ejecuta. Esta barrera es estructural, no una preferencia:
no existe una frase de "dale, pushealo vos" que la levante dentro de esta
skill — el push lo hace el usuario desde su propia sesión/terminal.

## Relación con changelog-writer

`changelog-writer` redacta el borrador de la entrada y el usuario la aprueba
y la aplica a `CHANGELOG.md` (`changelog-writer` nunca escribe el archivo).
Recién ahí existe una versión válida para taguear. Este ritual **lee**, no
recalcula — si el número parece incorrecto o desactualizado, el problema es
el CHANGELOG, no algo que este ritual deba corregir por su cuenta.

## Checklist antes de considerar el release "listo para push"

1. ¿Working tree estaba limpio antes de arrancar?
2. ¿La versión se leyó del tope real de `CHANGELOG.md`, no se calculó?
3. ¿Existe entrada real del CHANGELOG para esa versión?
4. ¿El tag `vX.Y.Z` no existía ya?
5. ¿`main` se actualizó con `pull` antes de mergear?
6. ¿Se mostró el preview de archivos/commits del merge y el usuario lo
   confirmó antes de ejecutar el merge real?
7. ¿El merge fue `--no-ff` (conserva el commit de merge)?
8. ¿El tag es anotado (`-a`), no liviano?
9. ¿Se mostró el freno duro final (log, archivos, tag) y se esperó OK
   explícito?
10. ¿En ningún momento se ejecutó, sugirió ejecutar automáticamente, ni se
    dejó abierta la puerta a un `push`?
