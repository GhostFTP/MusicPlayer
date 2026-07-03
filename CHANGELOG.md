# Changelog

Novedades destacables de **SonoraRev**. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

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
