import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { fmtTotal } from '../utils/formatTotal.js';
import { stringHue } from '../utils/emojiHue.js';
import AlbumGrid from './AlbumGrid.jsx';
import ArtistImage from './ArtistImage.jsx';
import ShuffleButton from './ShuffleButton.jsx';

const MAX_GENRE_CHIPS = 3;   // Kali Uchis tiene 5 géneros; sin tope el hero se satura

// Identidad factual del artista según MusicBrainz: "Grupo · Francia · 1993–2021".
// NO es una bio: MusicBrainz no tiene bios (su `annotation` viene null y el único campo
// parecido, `disambiguation`, lo traen 2 de 7 artistas — y en Various Artists dice "add
// compilations to this artist", una instrucción para editores de MB). Traer una bio real
// exigiría Wikipedia/Last.fm = dependencia externa nueva, descartada.
function mbIdentity(info) {
  if (!info?.found) return null;
  const parts = [];
  // "Other" se descarta: en Various Artists daría "Otro", que no dice nada.
  if (info.type === 'Person') parts.push('Persona');
  else if (info.type === 'Group') parts.push('Grupo');
  if (info.country) parts.push(regionName(info.country));
  const from = info.begin?.slice(0, 4);
  const to   = info.end?.slice(0, 4);
  if (from) parts.push(to ? `${from}–${to}` : from);
  return parts.length ? parts.join(' · ') : null;
}

// ISO 3166-1 → nombre en español, nativo (FR → "Francia"). Sin tabla propia ni dependencia.
function regionName(code) {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(code) ?? code; }
  catch { return code; }
}

// Discografía en orden cronológico ascendente: la grilla cuenta la carrera, de la primera
// a la última. El backend devuelve `ORDER BY album_artist, album` (alfabético), que en una
// discografía no dice nada: Daft Punk salía Alive 1997 → Alive 2007 → Discovery → Homework…
//
// El sort vive ACÁ y no en AlbumGrid a propósito: Años también usa ese componente, y allá
// todos los álbumes comparten año → ordenar por año sería un no-op y el desempate mandaría
// la grilla a orden alfabético, rompiendo su "agrupado por artista". Con el sort acá, Años
// no puede verse afectado.
//
// Los álbumes sin año van al final (no al principio, que es lo que haría `?? 0`).
function byYearAsc(albums) {
  return [...albums].sort((a, b) =>
    (a.year ?? Infinity) - (b.year ?? Infinity) ||
    a.album.localeCompare(b.album, 'es')
  );
}

export default function Artists({ target, clearTarget, setDetailOpen, navigate }) {
  const [artists,  setArtists]  = useState(null);
  const [sel,      setSel]      = useState(null);   // artista seleccionado
  const [detail,   setDetail]   = useState(null);   // agregados locales (stats + chips del hero)
  const [mbInfo,   setMbInfo]   = useState(null);   // identidad MusicBrainz (línea del hero)
  const [albums,   setAlbums]   = useState(null);
  const [error,    setError]    = useState(null);

  // Función nombrada (no solo inline en el efecto) para poder reusarla desde
  // el botón "Reintentar" del estado de error.
  function loadArtists() {
    setError(null);
    api.artists().then(setArtists).catch(setError);
  }

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reporta a Layout si hay un detalle abierto — lo usa el GATE del swipe-atrás de móvil (solo
  // arranca con un detalle). El cleanup de desmontaje evita que quede colgado al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!sel); }, [sel, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  async function open(a) {
    setSel(a);
    setAlbums(null);
    setAlbums(byYearAsc(await api.albums({ artist: a.artist })));
  }

  // Agregados LOCALES (duración, géneros, calidad) para las stats y los chips del hero.
  // Si falla, degrada en silencio: el hero se queda con lo que ya trae `sel`, sin error.
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    api.artistDetail(sel.artist)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sel]);

  // Identidad de MusicBrainz para la línea del hero. Va SEPARADA de los agregados locales a
  // propósito: es la única parte del hero que sale de la red, y `info.js` serializa las
  // llamadas a MB con 1s de separación y sin timeout → puede tardar. Como mejora progresiva,
  // aparece cuando llega y nunca bloquea el resto. Sin match, sin datos o con MB caído,
  // simplemente no se pinta (el endpoint ya devuelve { found:false } en vez de fallar).
  useEffect(() => {
    if (!sel) { setMbInfo(null); return; }
    let cancelled = false;
    setMbInfo(null);
    api.artistInfo(sel.artist)
      .then(i => { if (!cancelled) setMbInfo(i); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sel]);

  // Consumo del target de navegación (clic en el artista de la barra/expandido).
  // El target trae album_artist; la lista se agrupa por album_artist (alias
  // `artist`), así que el match es directo. Espera a que la lista cargue (deps).
  // Consumo único: siempre limpia; si no existe, queda en la lista.
  useEffect(() => {
    if (target?.reset) { setSel(null); setAlbums(null); clearTarget(); return; }
    if (!target?.artist || !artists) return;
    const a = artists.find(x => x.artist === target.artist);
    if (a) open(a);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, artists]);

  // ── Detalle: los álbumes de un artista ──
  if (sel) {
    const q        = detail?.quality;
    const identity = mbIdentity(mbInfo);
    const dur      = fmtTotal(detail?.total_duration);        // null si 0 → se oculta el segmento
    // Las stats van en una línea, no en chips: son del mismo tipo de dato y como chips
    // competían con los géneros y la calidad (el peor caso, Kali Uchis, daba 12 chips).
    const stats    = [
      `${sel.album_count} álbumes`,
      `${sel.track_count} pistas`,
      dur,
    ].filter(Boolean).join(' · ');

    return (
      <div>
        <button className="back-btn" onClick={() => window.history.back()}>
          ← Todos los artistas
        </button>

        {/* Hero: la foto a sangre. Esta era la ÚNICA vista con detalle sin hero — el nombre
            era un <h1> desnudo sobre la grilla de álbumes. El kicker "ARTISTA" en morado es
            lo que la separa de un detalle de álbum de un vistazo.
            `--h`: identidad Prisma por artista (kicker, aro, chips de género y glow del Mix).
            Solo tiñe el CROMO — la foto (.artist-hero-bg) queda intacta. */}
        <div className="artist-hero" style={{ '--h': stringHue(sel.artist) }}>
          <ArtistImage artist={sel} className="artist-hero-bg" />
          <div className="artist-hero-body">
            <div className="artist-hero-kicker">Artista</div>
            <h1 className="artist-hero-name">{sel.artist}</h1>
            {/* Identidad de MusicBrainz. Llega tarde o no llega: sin ella el hero se lee igual. */}
            {identity && <div className="artist-hero-meta">{identity}</div>}
            <div className="artist-hero-stats">{stats}</div>
            <div className="artist-hero-chips">
              {detail?.genres?.slice(0, MAX_GENRE_CHIPS).map(g => (
                <span key={g} className="artist-chip">{g}</span>
              ))}
              {q?.hires    > 0 && <span className="artist-chip artist-chip-q q-hires">{q.hires} hi-res</span>}
              {q?.lossless > 0 && <span className="artist-chip artist-chip-q q-lossless">{q.lossless} lossless</span>}
              {q?.lossy    > 0 && <span className="artist-chip artist-chip-q q-lossy">{q.lossy} lossy</span>}
              <ShuffleButton getTracks={() => api.tracks({ album_artist: sel.artist, limit: 10000 })} />
            </div>
          </div>
        </div>

        {albums
          ? <AlbumGrid albums={albums} onOpen={(a) => navigate('albums', { album: a.album, album_artist: a.album_artist })} secondary="year" hue={stringHue(sel.artist)} />
          : <div className="spinner">Cargando…</div>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <div className="empty-title">No se pudieron cargar los artistas</div>
        <div className="empty-sub">Intenta de nuevo en un momento.</div>
        <button className="btn-primary" onClick={loadArtists}>Reintentar</button>
      </div>
    );
  }

  if (!artists) return <div className="spinner">Cargando artistas…</div>;
  if (artists.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎤</div>
        <div className="empty-title">Sin artistas</div>
        <div className="empty-sub">Escanea tu música para empezar.</div>
      </div>
    );
  }

  // ── Lista de artistas ──
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Artistas</h1>
        <div className="detail-actions">
          <span className="section-count">{artists.length} artistas</span>
          <ShuffleButton getTracks={() => api.tracks({ limit: 10000 })} />
        </div>
      </div>
      {/* Grilla propia, NO `.album-grid`: la tarjeta ES la foto (retrato 3:4 a sangre, texto
          encima). Antes esto era literalmente la tarjeta de Álbumes con la miniatura
          redonda — y como esa miniatura era una carátula, un artista de un solo álbum se
          veía casi idéntico a su propio álbum en la otra pestaña. */}
      <div className="artist-grid">
        {artists.map((a, i) => (
          <div key={a.artist} className="artist-portrait" style={{ '--i': i, '--h': stringHue(a.artist) }} onClick={() => navigate('artists', { artist: a.artist })}>
            <ArtistImage artist={a} />
            <div className="artist-portrait-info">
              <div className="artist-portrait-name">{a.artist}</div>
              <div className="artist-portrait-count">{a.album_count} álbumes · {a.track_count} pistas</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
