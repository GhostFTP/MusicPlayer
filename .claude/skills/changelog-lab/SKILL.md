---
name: changelog-lab
description: Estándar del CHANGELOG de SonoraRev (formato Keep a Changelog en español orientado a usuario, secciones Nuevo/Mejorado/Cambiado/Corregido/Técnico, qué commits NUNCA entran, heurística de clasificación por intención — no por prefijo mecánico —, versionado real observado y ejemplos citados). Úsala SIEMPRE antes de reportar el estado de una tanda o redactar una entrada nueva del CHANGELOG.
---

# Changelog Lab — estándar del CHANGELOG de SonoraRev

Fuente de verdad de cómo se escribe y versiona `CHANGELOG.md` (raíz del repo).
Antes de reportar o redactar, **leé el archivo real** — este mapa dice el
formato y las reglas; las entradas concretas del historial son el ancla del
tono, no una plantilla rígida.

## Formato de una entrada

```
## [X.Y.Z] - YYYY-MM-DD

### Nuevo
- **Concepto en negrita**: explicación orientada a usuario, en qué cambia su
  experiencia. Puede incluir un ejemplo concreto entre paréntesis.

### Mejorado
...
### Cambiado
...
### Corregido
- **Síntoma en negrita**: qué se veía roto (concreto, con ejemplo real si
  ayuda) → qué pasa ahora. Sin jerga de implementación.

### Técnico
- Detalle de implementación para referencia futura (endpoints nuevos,
  refactors, nombres de función/variable). Acá SÍ es aceptable ser técnico.
```

- Fecha: `YYYY-MM-DD`, la del día del release (no la del primer commit de la
  tanda).
- Secciones presentes **solo si tienen contenido** — no se listan vacías.
- Orden de secciones cuando coexisten: Nuevo → Mejorado → Cambiado →
  Corregido → Técnico.
- Entradas nuevas se agregan **arriba** de la anterior más reciente (orden
  descendente por versión).

## Qué gana el usuario, no qué se tocó

Cada bullet lleva **el concepto en negrita** al arranque y después una
explicación en lenguaje de usuario: qué veía antes / qué ve ahora, con un
ejemplo real cuando lo aclara (canción, álbum o vista concreta de la propia
biblioteca). Nada de nombres de función, archivo, componente o commit —
eso queda para `### Técnico` si vale la pena registrarlo.

Ejemplos reales (calcá el tono, no copies el contenido):

> **Orden de las canciones dentro de un álbum**: las pistas con artista
> invitado (feat.) saltaban al final de la lista en vez de respetar su
> número de pista (por ejemplo, en Orquídeas de Kali Uchis, "Igual Que Un
> Ángel" aparecía muy abajo pese a ser la pista 3). Ahora el detalle de
> álbum siempre ordena por el número de pista del disco, sin importar los
> invitados. La vista de Géneros, que sí agrupa por artista a propósito, no
> cambia.

> **Sistema de botones "Reproducir"/"Mix aleatorio" unificado**: los pares
> de acción de Géneros, Álbum, Artistas, Años y el Mix de la Biblioteca
> ahora comparten un mismo lenguaje visual — Reproducir como pill relleno
> protagonista, Mix como pill sutil secundario — igual al que ya tenía el
> detalle de playlist. […] Suma micro-interacciones al pasar el mouse y al
> presionar […], todo desactivado con "movimiento reducido" (solo cambia el
> color).

> ### Técnico
> - Nuevo endpoint de solo lectura `GET /api/info/artist/:name` (consulta a
>   MusicBrainz con User-Agent propio, límite de 1 petición/segundo y caché
>   en memoria por 24 h).

## Clasificación por sección — es por INTENCIÓN, no por prefijo de commit

El prefijo del commit (`feat`, `fix`, `polish`...) es una pista, **no** la
regla. Hay que leer el diff/mensaje completo y preguntar qué experimenta el
usuario:

| Sección | Cuándo | Nota |
|---|---|---|
| **Nuevo** | Aparece una capacidad que **no existía** (una vista, un botón, un dato nuevo en pantalla). | `feat(...)` suele caer acá, pero no siempre. |
| **Mejorado** | Algo que ya existía se ve/siente/rinde mejor, aunque el commit sea `feat(...)`. | Ejemplo real: `feat(ui): sistema de botones unificado` y `feat(ui): emoji por género` cayeron en **Mejorado**, no en Nuevo — unifican/normalizan algo existente, no agregan una capacidad nueva. `polish(...)` casi siempre es Mejorado. |
| **Cambiado** | Comportamiento o identidad existente que cambia de forma neutral (no es mejora ni bug), ej. rebranding. | Poco frecuente. |
| **Corregido** | `fix(...)` — algo estaba roto y ahora no. | Directo. |
| **Técnico** | Cambios de infraestructura/servidor sin efecto directo visible, pero útiles de dejar registrados (endpoint nuevo, migración, refactor de bajo nivel). | Va al final, tono técnico permitido acá. |

**Si un commit es ambiguo entre dos secciones (p. ej. "Nuevo" vs "Mejorado"),
no lo decidas solo: preguntale al usuario cuál captura mejor la experiencia.**

## Commits que NUNCA entran al CHANGELOG

- `chore(claude): ...` — mantenimiento de skills/agentes, cero relevancia de
  producto.
- `docs: fecha de release ...` / `docs(changelog): vX.Y.Z` — son el propio
  trabajo de versionar, no contenido nuevo.
- `release: vX.Y.Z ...` — el commit de merge en sí; su resumen ya está hecho
  por las entradas que agrupa, no se repite como bullet.
- Commits de config/tooling puramente internos sin efecto de usuario ni
  valor de referencia técnica.

Si dudás si algo es "Técnico" o "no entra", preguntá — mejor omitir de más
que inflar el changelog con ruido interno.

## Versionado — práctica real observada (no SemVer de manual)

Este proyecto **no** sigue SemVer estricto ("todo `feat` = MINOR"). El
historial real muestra:

- **PATCH** es el default de casi todos los releases, incluso cuando traen
  bullets en "Nuevo" — mientras sea una adición dentro de un área/sistema
  que ya existe (ej. 1.4.1 sumó "ocultar letra incorrecta de LRCLIB" —
  Nuevo — pero fue PATCH porque LRCLIB ya existía desde 1.4.0).
- **MINOR** históricamente marcó la llegada de un **sistema o pilar nuevo**
  completo: 1.1.0 (vista "Ahora reproduciendo"), 1.2.0 (integración
  MusicBrainz + gestión de playlists), 1.3.0 (Karaoke "Escenario" + Mosaico
  Prisma de playlists), 1.4.0 (Campanita de Novedades + letras automáticas
  LRCLIB). Todos con múltiples features de peso, no un solo fix o ajuste.
- **MAJOR**: nunca se usó (sigue en 1.x). No hay precedente que lo justifique
  todavía.

**Regla dura: si no es obvio que la tanda introduce un pilar nuevo entero,
proponé PATCH por default y preguntá antes de saltar a MINOR.** Nunca
decidas un bump MAJOR sin confirmación explícita — no hay antecedente en
este repo.

## Rango de commits de una tanda

La tanda a redactar es lo que hay entre el **último release** y `HEAD`:

1. Buscá el último tag (`git tag` ordenado, o el más reciente `vX.Y.Z`).
2. Si no hay tag reciente, usá el último commit `release: vX.Y.Z` en
   `git log`.
3. El rango es `<referencia-encontrada>..HEAD`, filtrando los commits que
   nunca entran (arriba).
4. Cada commit restante se lee completo (`git show <sha>` o
   `git log -p <rango>`) — el resumen de una línea no alcanza para
   redactar en lenguaje de usuario ni para clasificar bien la sección.

## Checklist antes de proponer una entrada

1. ¿Cada bullet dice qué gana/ve el usuario, sin nombres de archivo/función?
2. ¿La sección de cada bullet refleja la intención real del cambio (no solo
   el prefijo del commit)?
3. ¿Quedó afuera todo `chore(claude)`, `docs: fecha de release` y el propio
   `release:`?
4. ¿La versión propuesta tiene justificación (pilar nuevo → MINOR,
   cualquier otra cosa → PATCH) y, si hay duda, se preguntó en vez de
   asumir?
5. ¿La fecha es la del día del release, no la del primer commit de la
   tanda?
6. ¿Las secciones vacías se omitieron?
