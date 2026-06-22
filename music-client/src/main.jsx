import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider }   from './context/AuthContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import App from './App.jsx';
import './styles/main.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </AuthProvider>
  </StrictMode>
);
