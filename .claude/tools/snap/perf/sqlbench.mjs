import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const cnt = db.prepare('SELECT COUNT(*) n FROM tracks').get().n;
const albums = db.prepare("SELECT COUNT(*) n FROM (SELECT 1 FROM tracks WHERE album IS NOT NULL GROUP BY album, album_artist)").get().n;
console.log({ tracks: cnt, albums });
const base = `SELECT id, title, artist, album, album_artist, genre, year, track_number, disc_number, disc_total,
 duration, cover_path, codec, bits_per_sample, sample_rate, bitrate, lossless FROM tracks WHERE 1=1`;
const S = base + ' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?) ORDER BY artist, album, track_number, title LIMIT ? OFFSET ?';
console.log('PLAN search:', db.prepare('EXPLAIN QUERY PLAN ' + S).all('%a%','%a%','%a%',10000,0).map(r=>r.detail).join(' | '));
const N = 200;
for (const q of ['', 'a', 'da', 'daf', 'met', 'zzz']) {
  const st = q ? db.prepare(S) : db.prepare(base + ' ORDER BY artist, album, track_number, title LIMIT ? OFFSET ?');
  const args = q ? [`%${q}%`,`%${q}%`,`%${q}%`,10000,0] : [10000,0];
  let rows; const t0 = performance.now();
  for (let i=0;i<N;i++) rows = st.all(...args);
  const ms = (performance.now()-t0)/N;
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  console.log(`q=${JSON.stringify(q).padEnd(6)} rows=${String(rows.length).padStart(5)} sql=${ms.toFixed(2)}ms json=${(bytes/1024).toFixed(0)}KB`);
}
const A = `SELECT album, album_artist, year, COUNT(*) AS track_count, MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS sample_track_id FROM tracks WHERE album IS NOT NULL GROUP BY album, album_artist ORDER BY album_artist, album`;
let t0=performance.now(); let r; for(let i=0;i<N;i++) r=db.prepare(A).all(); console.log(`albums sql=${((performance.now()-t0)/N).toFixed(2)}ms rows=${r.length}`);
