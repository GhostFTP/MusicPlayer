import { getToken, loadPlaywright, BASE } from '../session.mjs';
const CPU = Number(process.env.CPU ?? 1);
const token = await getToken(); const { chromium } = await loadPlaywright();
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const n = 900 * 8000, W = Buffer.alloc(44 + n * 2);
W.write('RIFF', 0); W.writeUInt32LE(36 + n * 2, 4); W.write('WAVEfmt ', 8); W.writeUInt32LE(16, 16); W.writeUInt16LE(1, 20); W.writeUInt16LE(1, 22); W.writeUInt32LE(8000, 24); W.writeUInt32LE(16000, 28); W.writeUInt16LE(2, 32); W.writeUInt16LE(16, 34); W.write('data', 36); W.writeUInt32LE(n * 2, 40);
await ctx.route('**/stream/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: W }));
await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable'); if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
async function win(label) { const a = await m(); await p.waitForTimeout(5000); const z = await m(); console.log(`[x${CPU}] ${label.padEnd(34)} task ${Math.round((z.TaskDuration - a.TaskDuration) * 1000)}ms · script ${Math.round((z.ScriptDuration - a.ScriptDuration) * 1000)} · layout ${Math.round((z.LayoutDuration - a.LayoutDuration) * 1000)} · style ${Math.round((z.RecalcStyleDuration - a.RecalcStyleDuration) * 1000)}`); }
await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row');
await p.locator('.library-tracks .track-row').nth(5).click(); await p.waitForTimeout(3000);
await win('Biblioteca sonando (normal)');
for (const [label, css] of [
  ['… player-bar en capa propia', '.player-bar{will-change:transform}'],
  ['… + main-content contain:strict', '.main-content{contain:strict}'],
]) { await p.addStyleTag({ content: css }); await win(label); }
await b.close();
