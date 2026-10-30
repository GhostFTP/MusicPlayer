// recientes-vistas-carga-func.mjs — 2.ª PARTE de recientes-vistas-func.mjs: LA CARGA AL PRIMER TOQUE del chip «Recién añadidas»
// en Álbumes, Artistas, Géneros y Años. tracks:all se pide al primer toque, no al montar:
//   · el montaje hace 0 pedidos de /api/tracks y el chip nace habilitado (aunque el pedido estuviera demorado, la vista no espera);
//   · el primer toque en frío hace exactamente 1 pedido, queda aria-busy y el filtro se aplica al llegar, sólo si el chip sigue encendido;
//   · un segundo toque mientras carga cancela (y si después falla, no avisa); fallo = el mismo aviso ámbar que el Mix; 401 = sin aviso;
//   · respuesta vacía apaga el chip sin aviso; caché caliente (o lista traída por el Mix) = aplica al instante, sin pedidos;
//   · precarga opcional: ratón encima o foco de teclado calientan la caché, el dedo no; y el costo medido en frío por vista.
// Comparte helpers y oráculo con recientes-vistas-func.mjs (la 1.ª parte: el filtro). Uso: SNAP_BASE=http://localhost:4173 node recientes-vistas-carga-func.mjs
process.env.PARTE = 'carga';
await import('./recientes-vistas-func.mjs');
