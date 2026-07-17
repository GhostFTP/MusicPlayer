# Changelog

Novedades destacables de **SonoraRev**. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

## [1.5.1] - 2026-07-16

### Corregido
- **Los álbumes de doble disco ahora se muestran separados por disco**: en
  discos dobles como *Stadium Arcadium* o *Random Access Memories (10th
  Anniversary Edition)*, la numeración aparecía mezclada (1, 1, 2, 2, 3, 3…)
  porque el disco de cada canción no se guardaba. Ahora cada álbum de más de
  un disco muestra un separador **"Disco 1" / "Disco 2"** entre los bloques de
  canciones, en el orden correcto. Los álbumes de un solo disco (la inmensa
  mayoría de tu biblioteca) no cambian — no aparece ningún separador de más.

## [1.5.0] - 2026-07-14

### Nuevo
- **Tu música en la pantalla del carro**: conectá el teléfono por **CarPlay**,
  **Android Auto** o **Bluetooth** y el carro ya sabe qué está sonando. En vez de una
  pantalla en blanco, aparece la **carátula** del disco con el **título**, el
  **artista** y el **álbum**, y se actualiza sola cada vez que cambia la canción. Lo
  mismo en la **pantalla bloqueada** del teléfono: la carátula a tamaño completo,
  aunque tengas la app en segundo plano o la pantalla apagada.
- **Los controles del volante manejan SonoraRev**: play/pausa, **anterior** y
  **siguiente**, y **adelantar/retroceder 10 segundos** responden desde el volante,
  desde la pantalla bloqueada y desde los controles del sistema — sin tocar el
  teléfono mientras manejás. "Anterior" respeta el modo aleatorio igual que en la app
  (vuelve a la canción que sonó de verdad, no a la de la lista).
- **La barra de progreso avanza en el carro y en la pantalla bloqueada**: se mueve
  junto con la canción aunque el teléfono esté bloqueado o estés en otra app, y podés
  **arrastrarla para saltar** a cualquier punto de la canción desde ahí mismo.

## [1.4.9] - 2026-07-11

### Nuevo
- **Ordená toda la Biblioteca a tu gusto**: un riel de orden arriba de la lista
  (mismo lenguaje visual que el de las playlists) te deja ordenar las canciones
  por **Título**, **Artista**, **Álbum**, **Año** o **Duración**; tocar el modo
  que ya está activo invierte la dirección (↑/↓). "Artista" no es un orden plano:
  mantiene la agrupación por artista y álbum de siempre —los discos se siguen
  leyendo de la pista 1 a la N, sin que los invitados (feat.) ni los "Various
  Artists" se desarmen— por eso sigue siendo el orden por defecto. Las canciones
  sin año, sin álbum o sin duración quedan siempre al final.

### Mejorado
- **Header de Biblioteca con identidad propia**: el título "Biblioteca" ahora
  lleva una barrita de acento morada al costado y, debajo, un resumen en chips de
  tu colección completa: cuántos **artistas**, cuántos **álbumes** y la
  **duración total**. El resumen se calcula sobre la biblioteca entera y se
  mantiene estable aunque estés filtrando con la búsqueda.
- **Contador de canciones renovado**: el contador de canciones pasó a ser un pill
  destacado, con el número en tipografía monoespaciada grande que **cuenta desde
  0 hasta el total** (animación de ~0,9 s) la primera vez que carga la lista; al
  buscar, el número salta directo al resultado filtrado con un tick sutil. Todo
  respeta "movimiento reducido".

### Corregido
- **Columnas de la tabla que se pisaban a zoom alto**: en pantallas medianas o
  con el zoom al 150% (típico en laptops), las columnas Artista y Álbum
  aplastaban la de Título hasta que la carátula y los encabezados se montaban
  unos sobre otros. Ahora, por debajo de ese ancho, la tabla se compacta igual
  que ya lo hacía en móvil (el artista pasa a mostrarse bajo el título y la
  insignia de calidad se mueve a un chip en línea) y los textos truncan con "…"
  en una sola línea.

## [1.4.8] - 2026-07-09

### Corregido
- **Orden de las canciones dentro de un álbum**: las pistas con artista invitado
  (feat.) saltaban al final de la lista en vez de respetar su número de pista
  (por ejemplo, en Orquídeas de Kali Uchis, "Igual Que Un Ángel" aparecía muy
  abajo pese a ser la pista 3). Ahora el detalle de álbum siempre ordena por el
  número de pista del disco, sin importar los invitados. La vista de Géneros,
  que sí agrupa por artista a propósito, no cambia.


## [1.4.7] - 2026-07-08

### Mejorado
- **Emoji por género en la vista Géneros**: cada género ahora se identifica con
  un emoji propio en una ficha con color derivado (ej. 🎤 Hip Hop, 🎧
  Electronic, 🎬 Soundtrack), en vez de solo texto plano. Los géneros
  duplicados por inconsistencias de etiquetado ("R&B" / "R&B/General",
  "Soundtrack" / "Soundtracks" / "Soundtracks/General", etc.) muestran el
  mismo emoji entre sí — sin fusionar ni tocar los datos, solo normaliza qué
  ícono corresponde a cada uno.
- **Sistema de botones "Reproducir"/"Mix aleatorio" unificado**: los pares de
  acción de Géneros, Álbum, Artistas, Años y el Mix de la Biblioteca ahora
  comparten un mismo lenguaje visual — Reproducir como pill relleno
  protagonista, Mix como pill sutil secundario — igual al que ya tenía el
  detalle de playlist. En Géneros el color se deriva del emoji del género; en
  el resto usa el acento morado de siempre. Suma micro-interacciones al pasar
  el mouse y al presionar (elevación, brillo, el ícono de mezcla gira), todo
  desactivado con "movimiento reducido" (solo cambia el color).
- **Glide del karaoke más suave al hacer un seek grande**: al saltar varias
  líneas de golpe (arrastrar la barra de progreso, tocar una línea lejana), el
  desplazamiento de la letra ahora usa una curva más pareja y una duración que
  se ajusta a la distancia del salto, en vez de sentirse "brusco". Cambiar de
  canción sigue siendo instantáneo — la letra arranca limpia en la posición
  correcta, sin viajar desde donde quedó la canción anterior.

### Corregido
- **Filas de la tabla de pistas demasiado altas en escritorio**: títulos o
  álbumes largos ("Call of Duty: Black Ops – Zombies (Original Game
  Soundtrack)") hacían que la fila envolviera en varias líneas, dejando huecos
  enormes y solo unas 6 canciones visibles en pantalla. Ahora el título y el
  álbum truncan con "…" en una sola línea (como ya pasaba en móvil) y el
  espaciado se ajustó a una densidad más compacta, mostrando muchas más
  canciones de una vez sin romper el truncado ya arreglado en móvil.

## [1.4.6] - 2026-07-08

### Nuevo
- **SonoraRev instalable como app**: desde el navegador móvil (Safari en iPhone,
  Chrome en Android) ahora se puede agregar SonoraRev a la pantalla de inicio y
  abrirla como una app real, sin la barra del navegador — con su propio ícono
  (el ecualizador morado→rosa) y sin la franja del status bar. Los botones de
  la barra inferior ya no quedan pegados al borde en los iPhone con home
  indicator. Todavía sin uso sin conexión (queda para más adelante).

## [1.4.5] - 2026-07-08

### Nuevo
- **Gesto de navegación hacia atrás en móvil**: deslizando hacia la derecha en
  cualquier punto del contenido (mismo lenguaje que el "atrás" de iOS, pero
  dentro de la app) se sale del detalle actual (álbum, artista, género,
  playlist o año) y se vuelve a su lista, con un chevron flotante como guía
  visual. No interfiere con el cambio de canción por swipe en la carátula ni
  con el cierre por swipe-down del reproductor expandido, y no afecta desktop.

### Cambiado
- **Rebranding a SonoraRev**: el nombre visible de la app pasa de "Music Player" a
  **SonoraRev** (pestaña del navegador, pantalla de login, sidebar) y el favicon
  ahora es un ecualizador con degradado morado→rosa en vez del emoji genérico.

### Corregido
- **Sesión que se quedaba pegada tras horas de uso**: si el token de sesión
  vencía (7 días) mientras la pestaña seguía abierta, la biblioteca y el resto
  de las secciones se veían vacías sin ningún aviso, y la única forma de
  recuperarse era abrir una ventana de incógnito. Ahora la app se reautentica
  sola (vía Cloudflare Access) al detectar un token vencido o al recibir un
  error de sesión a mitad de uso; si de verdad falla una carga por otro motivo
  (red, servidor), se avisa en pantalla con un botón para reintentar en vez de
  mostrar una sección vacía engañosa.
- **Renombrar playlist en móvil**: el campo de texto para renombrar una playlist
  podía colapsar a un ancho casi invisible en pantallas chicas (≤360px), donde el
  emoji y los botones "Guardar"/"✕" le dejaban casi nada de espacio; ahora pasa a
  su propia línea con ancho completo y el texto siempre se ve mientras se escribe.

## [1.4.4] - 2026-07-08

### Nuevo
- **Confirmación al borrar una playlist**: la papelera del detalle ahora pide
  confirmación (Cancelar / Borrar) antes de eliminar, para no borrar una playlist
  sin querer.
- **Portada automática de playlist**: la carátula de cada playlist se arma sola con
  las primeras 4 canciones con carátula, en mosaico 2×2 — tanto en la grilla de
  playlists como en la cabecera del detalle. Si hay menos de 4 (o ninguna), se
  completa con el color y el emoji de la playlist.

### Corregido
- **Texto de los campos de escritura en móvil**: en algunos teléfonos (iOS/Android
  con el sistema en modo oscuro) el texto que escribías —por ejemplo al renombrar
  una playlist— podía verse casi invisible; ahora se lee siempre.

## [1.4.3] - 2026-07-05

### Nuevo
- **Ordená las pistas de una playlist**: un riel de vidrio en el detalle de la
  playlist —teñido con el color propio de la playlist— te deja ordenar por
  **Añadido**, **Título**, **Artista** o **Álbum**; tocar el modo ya activo
  invierte la dirección (↑/↓). Abre en "Añadido ↓" (las últimas agregadas
  arriba, estilo Spotify), y las pistas sin artista o álbum quedan al final.
- **Buscá dentro de una playlist**: un campo con lupa en el detalle filtra las
  canciones por **título o artista** mientras escribís (ignora mayúsculas y
  acentos). Convive con el orden del riel, y Reproducir/Mezcla operan sobre lo que
  ves filtrado.

### Mejorado
- **Hero del detalle de playlist rediseñado ("Prisma Sólido")**: Reproducir y
  Mezcla aleatoria pasan a ser pastillas teñidas con el color propio de la
  playlist (Reproducir relleno como acción principal, Mezcla en versión suave),
  la cabecera suma la **duración total** junto al número de canciones, y el botón
  de eliminar se reubicó lejos de la acción principal.

### Corregido
- **Títulos largos de canción en móvil**: en el detalle de playlist (y también en
  álbum y género) un título largo se cortaba pegado al borde derecho sin puntos
  suspensivos; ahora se trunca limpio con "…".

## [1.4.2] - 2026-07-05

### Nuevo
- **Tooltips "vidrio con firma" en la barra**: todos los controles (aleatorio,
  anterior/reproducir/siguiente, repetir, letra, info, volumen y el "+" de
  playlist) comparten un mismo tooltip glass con la firma de color de cada
  acción — morado, ámbar en info, morado→rosa en letra, teal en el "+", y el
  color por nivel en el volumen (**"Volumen · 72%"**, o "Silenciado"). También
  aparecen al navegar con teclado (Tab).
- **Cerrá el reproductor ampliado arrastrándolo hacia abajo con el mouse**
  (desktop): el mismo gesto que ya existía en móvil, desde el encabezado o la
  carátula (el cursor de "agarrar" lo anuncia). Esc y el botón de siempre
  siguen funcionando igual.

### Mejorado
- **El karaoke fluye con la música**: la letra sincronizada ahora se desplaza de
  forma continua al ritmo de la canción en vez de saltar línea por línea, y la
  línea que canta crece con suavidad mientras las demás se escalonan en capas de
  profundidad. En el celular el desplazamiento es más liviano (para no exigir la
  GPU de gama baja) y con "movimiento reducido" todo queda quieto: solo el color
  marca la línea activa.
- **Cerrar deslizando ahora se siente como un sheet nativo** (celular y
  desktop): el panel sigue al dedo o al mouse sin el saltito del arranque, al
  soltar con impulso continúa la velocidad del gesto, y mientras baja se
  "despega" con esquinas redondeadas, sombra y un oscurecido detrás que se va
  aclarando. En desktop toda la franja superior es ahora zona real de agarre
  (antes el arrastre casi no tenía de dónde agarrarse), y reintentar el gesto
  justo después de un rebote ya no lo congela.
- **Cerrar deslizando es aún más fácil de agarrar**: se ampliaron las zonas con
  las que arrastrás el reproductor ampliado hacia abajo para cerrarlo — la
  franja superior y un contorno alrededor de la carátula en el celular, y
  también la columna de información en la computadora — así ya no hay que
  "apuntar". Además, los botones de Letra, Información y ＋ del ampliado y los de
  la Letra tienen un área táctil más cómoda, y en el celular la app aprovecha
  todo el alto de la pantalla (la barra inferior ya no queda tapada por la del
  navegador).
- **Slider de volumen "riel que respira"** (desktop): al pasar el mouse el riel
  se engrosa con un glow del color del nivel y el punto entra con un rebote
  sutil; al arrastrar crece, hermanado con el del reproductor ampliado.
- **La portada se aprecia más de fondo**: menos difuminado en el reproductor
  ampliado (28→8 px; 6 en móvil) y en el panel de Info (32→6 px; 5 en
  móvil). La legibilidad del texto la sigue garantizando el oscurecido, que no
  cambió.
- **En móvil, el control de volumen desaparece del reproductor ampliado**: el
  volumen lo mandan los botones físicos del teléfono (iOS ignora el volumen
  web), así que un slider que a veces no responde es peor que ninguno.
- **Esc también sale del detalle**: estando dentro de un álbum, artista, género,
  playlist o año (sin ningún panel abierto), Esc te devuelve a la lista donde
  estabas — lo mismo que volver a tocar la pestaña activa. Si tenés el
  reproductor ampliado abierto encima, Esc lo cierra primero.

### Corregido
- **En escritorio, usar la barra con la Letra abierta ya no la manda a pantalla
  completa.** Antes, con la Letra abierta, un clic en la barra o en la portada
  (para reproducir/pausar o navegar) saltaba a pantalla completa aunque solo
  quisieras usar la barra. Ahora en escritorio la barra se usa sin sobresaltos;
  en el celular la Letra sigue pasando a pantalla completa como siempre.
- **Se acabó el desplazamiento horizontal en la biblioteca (celular).** Las
  listas y el detalle de álbum ya no piden "arrastrar de lado" para ver toda la
  info. El detalle de un álbum abierto desde la pestaña Álbumes ahora es idéntico
  al del resto de la app (misma carátula, badge de calidad, botón de mezcla), y
  los títulos largos se recortan con puntos suspensivos en vez de ensanchar la
  fila.

### Técnico
- Sistema `.bar-tip` reemplaza los `title=` nativos de la barra manteniendo (y
  agregando donde faltaba) `aria-label` en todos los botones; visible con
  `:has(:focus-visible)`; oculto con `visibility` para no pagar el blur en
  reposo; con `prefers-reduced-motion` queda solo el fade.
- `volumeFillStyle()` → `volumeVars()`: el color por nivel viaja en CSS vars
  (`--vol-pct` / `--vol-color`) y alimenta relleno, glow y tooltip sin duplicar
  la interpolación teal→ámbar→rojo.
- El cierre por arrastre comparte una sola maquinaria táctil/mouse (se quitó el
  gate por `pointerType`); mismos umbrales (120 px, o flick a 0.55 px/ms).

## [1.4.1] - 2026-07-05

### Nuevo
- **"No es la letra": ocultá una letra equivocada de LRCLIB.** La data comunitaria
  a veces trae la letra de otra canción (nos pasó con «Burnin'» de Daft Punk).
  Una **×** discreta en el badge "vía LRCLIB" marca esa pista como sin letra (se
  recuerda por dispositivo), y en el estado vacío queda **"Buscar en LRCLIB de
  nuevo"** para deshacer al instante. Las letras propias (.lrc curadas) nunca se
  ocultan.

### Mejorado
- **La búsqueda de letra ya no se cuelga**: el panel muestra "Buscando letra…" y
  espera como mucho ~4 s a LRCLIB (7 s si el servidor no responde) antes de
  rendirse en silencio con "Sin letra disponible". Antes podía quedarse
  "Cargando…" indefinidamente.
- **Esc también cierra Novedades**: te devuelve a la vista donde estabas
  (prioridad: Info → Letra → Novedades → reproductor ampliado).

### Corregido
- **"Barra fantasma" bajo la Letra**: con el reproductor ampliado montado detrás,
  la letra en modo panel mostraba una franja cortada del ampliado en vez de la
  barra real. Ahora tocar la barra o la portada con la Letra abierta la lleva a
  pantalla completa y "Reducir" cierra el ampliado: siempre ves la barra de
  verdad.
- **El tooltip del shuffle** quedaba tapado por el panel de Letra abierto; ahora
  aparece por encima, igual que el menú "+".

### Técnico
- Capa `--z-bar-popover: 260` para popovers anclados a la barra (menú "+",
  tooltip del shuffle): sobre la Letra (250), bajo Info (300).
- El modo inmersivo de la Letra (`lyricsImmersive`) pasa a `Player.jsx` y
  `LyricsPanel` es controlado; invariante: nunca expandido montado con la Letra
  en modo panel.
- Timeout LRCLIB del server 6 s → 4 s; el cliente aborta a los 7 s
  (`AbortSignal.timeout`). Marca de ocultado en localStorage
  `lyricsHidden:<trackId>`.

## [1.4.0] - 2026-07-05

### Nuevo
- **Campanita de Novedades en móvil**: un botón flotante te lleva a esta vista de
  Novedades, con un **puntito de aviso** cuando hay una versión nueva que aún no
  viste (se apaga al abrirla).
- **Letras automáticas vía LRCLIB**: cuando una canción no tiene letra propia
  (.lrc curado), SonoraRev la busca en [LRCLIB](https://lrclib.net) y solo trae
  **letras sincronizadas verificadas** — misma duración que tu pista (±5s) y
  nunca para versiones instrumentales — con el karaoke completo. Se distingue
  con un badge sutil **"vía LRCLIB"** y se recuerda 24h para no re-consultar.
  Si no hay match confiable o el servicio no responde, todo sigue como siempre.

### Mejorado
- **Karaoke con sincronía exacta**: la línea activa ahora se enciende justo en su
  marca de tiempo (reloj interpolado a 60fps) — se acabó el desfase "raro" que
  variaba línea a línea. Al **cambiar de canción o saltar en la barra**, la letra
  se reencuadra al instante, sin flashes de la canción anterior.
- **El header del panel de Letra ya no se escapa** al final de la canción: el
  auto-scroll queda contenido dentro del panel y las últimas líneas también se
  centran como protagonistas.
- **Líneas encimadas arregladas**: la línea activa grande respira con espacio
  proporcional a su tamaño y su glow ya no pinta sobre las vecinas.
- **Botones anterior/siguiente animados**: crecen con glow al pasar el mouse y
  se hunden con un empujoncito hacia su dirección al pulsarlos (barra,
  reproductor ampliado y mini barra móvil).
- **Tocar cualquier zona libre de la barra en móvil abre el reproductor
  ampliado** (antes había zonas que no respondían).
- **Aviso de duplicado más visible**: si la canción ya estaba en la playlist, el
  aviso ahora es ámbar con ⚠️, más grande y dura más — imposible confundirlo con
  el "Añadida" verde.

## [1.3.1] - 2026-07-04

### Corregido
- El menú **"Añadir a playlist"** de la barra quedaba oculto detrás del panel de
  Letra cuando estaba abierto; ahora aparece por encima y se puede usar mientras
  lees la letra.

## [1.3.0] - 2026-07-04

### Nuevo
- **Karaoke "Escenario"**: el panel de Letra se abre a pantalla completa con la
  carátula de la canción difuminada de fondo, la línea activa protagonista (con
  glow) y un **barrido de progreso sincronizado** que rellena la línea a medida
  que avanza. Desde el reproductor ampliado abre inmersivo; desde la barra, como
  panel con un botón para expandir.
- **Ajuste fino de sincronía** en la letra: botones −0.5 / −0.1 / +0.1 / +0.5 (y
  reset) para corregir el desfase de esa canción; se recuerda por dispositivo. Se
  respeta además la etiqueta `[offset:]` del archivo `.lrc`.
- **Avisos con toast central**: al añadir una canción a una playlist aparece un
  aviso glass en el centro de la pantalla ("Añadida a…"), que se cierra solo.
- **Vista Playlists renovada ("Mosaico Prisma")**: la lista pasa a una **grilla de
  tarjetas**, cada una con un color propio derivado de su emoji, y la playlist
  abierta estrena un **hero** a juego con ese color.

### Mejorado
- **Menú "+" en fichas**: filas más grandes con el emoji en un tile de color y el
  nombre sobre "N canciones", más un estado vacío con carácter cuando aún no hay
  playlists.
- **Cambiar el emoji al renombrar** una playlist desde su propia vista (antes solo
  se podía desde el menú "+").
- **Al añadir una canción que ya está** en la playlist, ahora se avisa ("Ya está
  en…") en vez de no hacer nada en silencio.
- Todas las animaciones nuevas respetan la preferencia de **movimiento reducido**.

### Técnico
- El endpoint de añadir a playlist informa cuando la pista ya estaba
  (`POST /api/playlists/:id/tracks` responde `{ already: true }` sin duplicar).
- `emojiHue()` (color estable derivado del emoji) se unifica en un helper
  compartido por la vista Playlists y el menú "+".

## [1.2.1] - 2026-07-03

### Mejorado
- **Panel de Información con "carátula viva"**: la portada de la pista aparece
  difuminada de fondo del panel, con iconos por sección (Pista / Artista /
  Calidad) y los datos de MusicBrainz mejor jerarquizados (tipo · país · años
  en una línea y los géneros como chips). La legibilidad está cuidada tanto con
  portadas claras como oscuras; si la pista no tiene carátula, se mantiene el
  fondo sólido de siempre.
- **Menú de playlists ("+") con color por emoji**: cada playlist toma un tinte
  estable derivado de su emoji (tile redondeado con fondo y aro sutiles), y al
  pasar el cursor aparece un borde-guía de ese color. El texto sigue igual de
  legible y todo respeta la preferencia de movimiento reducido.

## [1.2.0] - 2026-07-03

### Nuevo
- **Datos del artista desde MusicBrainz** en el panel de Información: tipo, país,
  años en activo y géneros, junto a los datos de tu biblioteca y con la etiqueta
  discreta "vía MusicBrainz". Si no hay coincidencia, se muestran solo los datos
  locales, sin errores.
- **Editar y borrar playlists desde el menú "+"**: renombrar (con cambio de
  emoji) y eliminar con confirmación, sin salir del menú.
- **Cerrar "Ahora reproduciendo" deslizando hacia abajo** en el celular, desde la
  franja superior o arrastrando la carátula; el deslizamiento horizontal sigue
  cambiando de canción.
- **Tocar la pestaña activa** (Álbumes, Artistas, Géneros…) vuelve a su lista y
  cierra el detalle abierto; en la Biblioteca, limpia el buscador.

### Mejorado
- **Panel de Información rediseñado**: estética glass, datos agrupados
  (Pista / Artista / Calidad) con el badge de calidad, submenú del artista con
  agregados de tu biblioteca, y apertura/cierre animados.
- **Panel de Letra** con estética glass: la línea activa resalta con brillo y
  color, las vecinas se atenúan en degradado y el desplazamiento acompaña suave
  al avanzar la canción.
- **El tiempo transcurrido toma color**: ámbar cuando está en pausa y rojo (con
  un pulso sutil) en los últimos 15 segundos de la canción.
- **Carátula del reproductor ampliado**: cambio de canción con deslizamiento
  estilo baraja de cartas y pulido general de animaciones (barra de progreso,
  botones, aleatorio y repetir).
- **Esc** cierra el panel que esté abierto, por prioridad: Información, luego
  Letra (esté donde esté), y por último la vista ampliada.
- Todas las animaciones respetan la preferencia del sistema de **movimiento
  reducido**.

### Técnico
- Nuevo endpoint de solo lectura `GET /api/info/artist/:name` (consulta a
  MusicBrainz con User-Agent propio, límite de 1 petición/segundo y caché en
  memoria por 24 h). `PATCH /api/playlists/:id` ahora acepta también el `emoji`.

## [1.1.1] - 2026-07-02

### Nuevo
- **Novedades dentro de la app.** Nueva sección en el menú lateral que muestra
  las notas de cada versión (este mismo historial de cambios) con su fecha y sus
  cambios, sin salir del reproductor.

### Corregido
- En la vista Novedades, los puntos que ocupaban varias líneas ya no se cortan
  ni muestran asteriscos sueltos: se ven completos y con la **negrita** y el
  `código` bien aplicados.

## [1.1.0] - 2026-07-02

### Nuevo
- **Vista "Ahora reproduciendo" en escritorio.** Se abre con un clic en la
  portada o en cualquier zona libre de la barra. Trae fondo con la carátula
  difuminada, diseño de **dos columnas** (carátula + información), **swipe sobre
  la carátula** para pasar de canción y **Esc** para cerrar (si tenés abierto el
  panel de Letra o Info, la primera vez Esc cierra ese panel).
- **Navegación desde la barra.** Al hacer clic en el nombre de la canción, el
  artista o el género vas directo a su álbum, artista o género.
- **Emojis en las playlists.** Al crear una playlist podés elegir un emoji, que
  se muestra en la lista, en el detalle y en el menú "Añadir a playlist". Las
  playlists que ya tenías aparecen con 🎵.
- **Menú "Añadir a playlist" rediseñado.** Fondo con desenfoque, bordes
  redondeados, resaltado al pasar por cada playlist y contador de canciones más
  prolijo.
- **Silenciar con un clic** en el ícono de la bocina (barra y vista ampliada);
  otro clic restaura el volumen anterior.

### Mejorado
- **Animaciones del reproductor:** transición al alternar play/pausa, giro del
  aleatorio, "pop" del repetir al cambiar de modo y realce (crecer + brillo) en
  los botones de la vista ampliada.
- **Tipografía moderna** en toda la app; los tiempos (0:46 / 2:57) usan números
  de ancho fijo para que no se muevan al avanzar la canción.
- **Vista ampliada en el celular:** carátula más grande, mejor distribución
  vertical y entrada con deslizamiento; el botón "← Ahora reproduciendo" con más
  presencia y una animación sutil.
- **Toque más responsivo** en la barra del celular: se abre sin retardo ni zonas
  muertas.
- Todas las animaciones respetan la preferencia del sistema de **movimiento
  reducido**.

### Técnico
- Nueva columna `emoji` en la tabla `playlists`. La migración corre sola y de
  forma segura al arrancar el servidor (`ALTER TABLE ... ADD COLUMN`), sin tocar
  los datos existentes.
