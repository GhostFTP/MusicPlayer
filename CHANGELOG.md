# Changelog

Novedades destacables de **SonoraRev**. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

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
