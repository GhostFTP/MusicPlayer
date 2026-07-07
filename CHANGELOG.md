# Changelog

Novedades destacables de **SonoraRev**. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

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
