# Changelog

Novedades destacables de **SonoraRev**. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

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
