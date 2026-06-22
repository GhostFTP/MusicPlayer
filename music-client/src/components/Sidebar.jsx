import { useAuth } from '../context/AuthContext.jsx';

const VIEWS = [
  { id: 'library',   label: 'Biblioteca', icon: <LibraryIcon /> },
  { id: 'albums',    label: 'Álbumes',    icon: <AlbumIcon /> },
  { id: 'playlists', label: 'Playlists',  icon: <PlaylistIcon /> },
];

export default function Sidebar({ view, setView }) {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <MusicIcon />
        Music Player
      </div>

      <p className="sidebar-section-title">Menú</p>
      <nav>
        <ul className="sidebar-nav">
          {VIEWS.map(v => (
            <li key={v.id}>
              <button
                className={view === v.id ? 'active' : ''}
                onClick={() => setView(v.id)}
              >
                {v.icon}
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span>{user?.username ?? 'Usuario'}</span>
          <button className="btn-logout" onClick={logout}>Salir</button>
        </div>
      </div>
    </aside>
  );
}

function MusicIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
}
function LibraryIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
}
function AlbumIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>;
}
function PlaylistIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
}
