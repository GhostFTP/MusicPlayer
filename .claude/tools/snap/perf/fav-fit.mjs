// fav-fit.mjs — ¿CABEN los íconos nuevos? Mide (1) el header del expandido móvil a 360/390 px con
// cola · letra · info · "+" · corazón · compartir (6 íconos), y (2) en la barra de escritorio a
// 1024/1280/1440, el ancho que le queda al título con el corazón al lado del "+". Corre contra
// dos builds (base y nuevo) para comparar el ancho del título.
// Uso: SNAP_BASE=http://localhost:4173 node fav-fit.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const out = {};
for (const [w, mobile] of [[360, true], [390, true], [1024, false], [1280, false], [1440, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row');
  await p.locator('.library-tracks .track-row').nth(5).click(); await p.waitForTimeout(800);
  if (mobile) {
    await p.locator('.player-bar').click(); await p.waitForTimeout(900);
    out[w] = await p.evaluate(() => {
      const head = document.querySelector('.exp-head-actions');
      const hdr = head?.parentElement;
      const kids = [...(head?.children ?? [])].map((k) => { const r = k.getBoundingClientRect(); return { c: k.className.split(' ')[0], l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; });
      const hr = hdr.getBoundingClientRect(), ar = head.getBoundingClientRect();
      const back = hdr.querySelector('button:not(.exp-head-actions *)')?.getBoundingClientRect();
      return { iconos: kids.length, header: { l: Math.round(hr.left), r: Math.round(hr.right), scrollW: hdr.scrollWidth, clientW: hdr.clientWidth },
        acciones: { l: Math.round(ar.left), r: Math.round(ar.right), scrollW: head.scrollWidth, clientW: head.clientWidth },
        volver: back ? { l: Math.round(back.left), r: Math.round(back.right) } : null,
        desborda: hdr.scrollWidth > hdr.clientWidth || head.scrollWidth > head.clientWidth || kids.some((k) => k.r > window.innerWidth),
        solapa_volver: back ? back.right > ar.left + 0.5 : null, kids, page_scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
    });
  } else {
    out[w] = await p.evaluate(() => {
      const meta = document.querySelector('.player-bar .player-meta')?.getBoundingClientRect();
      const title = document.querySelector('.player-bar .player-title');
      const track = document.querySelector('.player-bar .player-track')?.getBoundingClientRect();
      const fav = document.querySelector('.player-bar .fav-player')?.getBoundingClientRect();
      return { meta_w: Math.round(meta?.width ?? 0), track_w: Math.round(track?.width ?? 0), titulo_truncado: title ? title.scrollWidth > title.clientWidth : null, fav: fav ? Math.round(fav.width) : null };
    });
  }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
