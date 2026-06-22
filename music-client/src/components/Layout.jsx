import { useState } from 'react';
import Sidebar   from './Sidebar.jsx';
import Library   from './Library.jsx';
import Albums    from './Albums.jsx';
import Playlists from './Playlists.jsx';
import Player    from './Player.jsx';

const VIEWS = {
  library:   <Library />,
  albums:    <Albums />,
  playlists: <Playlists />,
};

export default function Layout() {
  const [view, setView] = useState('library');

  return (
    <div className="layout">
      <Sidebar view={view} setView={setView} />

      <main className="main-content">
        {VIEWS[view]}
      </main>

      <Player />

      <BottomNav view={view} setView={setView} />
    </div>
  );
}

function BottomNav({ view, setView }) {
  return (
    <nav className="bottom-nav">
      <button
        className={`bottom-nav-btn${view === 'library' ? ' active' : ''}`}
        onClick={() => setView('library')}
      >
        <LibraryIcon />
        Biblioteca
      </button>
      <button
        className={`bottom-nav-btn${view === 'albums' ? ' active' : ''}`}
        onClick={() => setView('albums')}
      >
        <AlbumIcon />
        Álbumes
      </button>
      <button
        className={`bottom-nav-btn${view === 'playlists' ? ' active' : ''}`}
        onClick={() => setView('playlists')}
      >
        <PlaylistIcon />
        Playlists
      </button>
    </nav>
  );
}

function LibraryIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
}
function AlbumIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>;
}
function PlaylistIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
}
