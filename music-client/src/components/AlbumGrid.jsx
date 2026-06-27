import { coverUrl } from '../api/client.js';

// Grid de álbumes reutilizable (mismo diseño que la vista Álbumes).
export default function AlbumGrid({ albums, onOpen }) {
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
          <div className="album-name">{album.album}</div>
          <div className="album-artist">{album.album_artist ?? '—'}</div>
          <div className="album-count">{album.track_count} canciones</div>
        </div>
      ))}
    </div>
  );
}
