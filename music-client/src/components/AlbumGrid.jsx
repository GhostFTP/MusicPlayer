import { coverUrl } from '../api/client.js';

// Grid de álbumes reutilizable. Lo usan Artistas y Años.
//
// `secondary` = qué campo DESAMBIGUA en este contexto, que es distinto según la vista:
//   · Artistas ("year")   → todos los álbumes son del mismo artista; el nombre repetido en
//                           las 8 tarjetas es ruido, y el año es lo que los distingue.
//   · Años     ("artist") → todos los álbumes son del mismo año; ahí el año es el ruido.
// Default "artist" para que Años (y cualquier consumidor futuro) no cambie.
//
// NO ordena: el orden es responsabilidad de quien pasa la lista. Ordenar acá por año
// rompería Años, donde todos comparten año y el desempate mandaría la grilla a orden
// alfabético en vez del "agrupado por artista" que trae el backend.
export default function AlbumGrid({ albums, onOpen, secondary = 'artist' }) {
  const byYear = secondary === 'year';
  return (
    <div className="album-grid">
      {albums.map(album => (
        <div
          key={`${album.album}-${album.album_artist}`}
          className="album-card"
          onClick={() => onOpen(album)}
        >
          {album.sample_track_id
            ? <img className="album-cover" src={coverUrl(album.sample_track_id)} alt="" />
            : <div className="album-cover-placeholder">♫</div>
          }
          {/* En modo año el kicker va ARRIBA del título: es la cronología la que ordena la
              grilla, así que el año se lee primero. Sin año conocido, se reserva el hueco
              para que las tarjetas no queden desalineadas entre sí. */}
          {byYear && <div className="album-year">{album.year ?? '—'}</div>}
          <div className="album-name">{album.album}</div>
          {!byYear && <div className="album-artist">{album.album_artist ?? '—'}</div>}
          <div className="album-count">{album.track_count} canciones</div>
        </div>
      ))}
    </div>
  );
}
