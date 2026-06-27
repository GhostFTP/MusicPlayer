import { useAuth } from '../context/AuthContext.jsx';

const MENU = [
  { id: 'library',   label: 'Biblioteca', icon: <LibraryIcon /> },
  { id: 'albums',    label: 'Álbumes',    icon: <AlbumIcon /> },
  { id: 'playlists', label: 'Playlists',  icon: <PlaylistIcon /> },
];

const EXPLORE = [
  { id: 'artists', label: 'Artistas', icon: <ArtistIcon /> },
  { id: 'genres',  label: 'Géneros',  icon: <GenreIcon /> },
  { id: 'years',   label: 'Años',     icon: <YearIcon /> },
];

export default function Sidebar({ view, setView }) {
  const { user, logout } = useAuth();

  const navList = (items) => (
    <ul className="sidebar-nav">
      {items.map(v => (
        <li key={v.id}>
          <button className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.icon}
            {v.label}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <MusicIcon />
        Music Player
      </div>

      <p className="sidebar-section-title">Menú</p>
      <nav>{navList(MENU)}</nav>

      <p className="sidebar-section-title">Explorar</p>
      <nav>{navList(EXPLORE)}</nav>

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
function ArtistIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function GenreIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;
}
function YearIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
