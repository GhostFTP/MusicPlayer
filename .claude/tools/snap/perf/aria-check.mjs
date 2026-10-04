// aria-check.mjs — accesibilidad de la VENTANA de Biblioteca (Frente 1, sub-paso 10).
// Lee el árbol de accesibilidad REAL de Chrome (CDP Accessibility.getFullAXTree), no sólo el DOM. CDP
// no trae el VALOR de aria-rowcount/aria-rowindex entre las propiedades del nodo AX, así que a cada
// tabla/fila que el árbol SÍ expone se le leen los atributos de su nodo DOM (backendDOMNodeId):
//   · la tabla: rol y aria-rowcount (= filas de la lista actual + 1 de cabecera)
//   · las filas que expone: rol 'row', aria-rowindex consecutivos y = data-index + 2, sin huecos salvo
//     los de las filas fijadas, y que las espaciadoras NO aparezcan como fila.
// Posiciones: arriba, mitad, final, búsqueda "a" a mitad y "daf" arriba. Modos: tabla 1440, lista 900,
// móvil 390. Uso: SNAP_BASE=http://localhost:4173 [SCALE=3000] node aria-check.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const SCALE = Number(process.env.SCALE ?? 0);
const MODES = (process.env.MODES ?? 'tabla,lista,movil').split(',');
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let tracks = null;
if (SCALE) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
}
const VIEW = {
  tabla: { viewport: { width: 1440, height: 900 } },
  lista: { viewport: { width: 900, height: 900 } },
  movil: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const out = [];
for (const mode of MODES) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...VIEW[mode] });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  if (tracks) {
    await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
      (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
  }
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Accessibility.enable');
  await p.goto(BASE + '/');
  await p.waitForSelector('.library-tracks .track-row');
  await p.waitForTimeout(1500);

  async function check(name, where) {
    await p.evaluate((where) => {
      const sc = document.querySelector('.main-content');
      const max = sc.scrollHeight - sc.clientHeight;
      sc.scrollTop = where === 'top' ? 0 : where === 'mid' ? Math.floor(max / 2) : max;
    }, where);
    await p.waitForTimeout(600);
    const dom = await p.evaluate(() => {
      const t = document.querySelector('.library-tracks');
      const label = document.querySelector('.library-count')?.getAttribute('aria-label') ?? '';
      const rows = [...t.querySelectorAll('tbody > tr')].map((r) => ({ di: r.dataset.index != null ? Number(r.dataset.index) : null, ri: r.getAttribute('aria-rowindex'), hidden: r.getAttribute('aria-hidden') }));
      return { rowcount: t.getAttribute('aria-rowcount'), label, rows };
    });
    const total = Number((dom.label.match(/\d[\d.\s]*/) ?? ['NaN'])[0].replace(/[.\s]/g, ''));
    // Árbol de accesibilidad: la tabla y sus filas tal como las expone Chrome.
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const attrs = async (n) => { if (!n?.backendDOMNodeId) return {}; const { node } = await cdp.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId }); const a = {}; for (let k = 0; k < (node.attributes ?? []).length; k += 2) a[node.attributes[k]] = node.attributes[k + 1]; return a; };
    const tables = nodes.filter((n) => !n.ignored && ['table', 'grid', 'treegrid'].includes(n.role?.value));
    // filas bajo cada tabla (recorrido)
    const rowsUnder = (root) => { const acc = []; const st = [...(root.childIds ?? [])]; while (st.length) { const n = byId.get(st.shift()); if (!n) continue; if (!n.ignored && n.role?.value === 'row') acc.push(n); else st.push(...(n.childIds ?? [])); if (!n.ignored && n.role?.value === 'row') continue; } return acc; };
    const lib = tables.map((t) => ({ t, rows: rowsUnder(t) })).sort((a, b) => b.rows.length - a.rows.length)[0];
    const axRows = lib ? lib.rows : [];
    const axAttrs = []; for (const r of axRows) axAttrs.push(await attrs(r));
    const tableAttrs = await attrs(lib?.t);
    const headIdx = axAttrs.findIndex((a) => a['data-index'] == null);   // la fila de cabecera (si está expuesta)
    const axHeader = headIdx >= 0 ? Number(axAttrs[headIdx]['aria-rowindex']) : null;
    const axDataAttrs = axAttrs.filter((a) => a['data-index'] != null);
    const axData = axDataAttrs.map((a) => Number(a['aria-rowindex']));
    const axSpacers = axAttrs.filter((a) => a['aria-hidden'] === 'true').length;
    const domData = dom.rows.filter((r) => r.di != null);
    const spacers = dom.rows.filter((r) => r.di == null);
    // consecutivos salvo saltos a filas fijadas (la última siempre lo está)
    let gaps = 0; for (let k = 1; k < axData.length; k++) if (axData[k] !== axData[k - 1] + 1) gaps++;
    const r = {
      caso: `${mode}-${name}`,
      total,
      tablaRol: lib?.t.role?.value ?? '—',
      ariaRowcount: tableAttrs['aria-rowcount'] ?? '—',
      esperado: total + 1,
      filasDOM: domData.length,
      filasAX: axRows.length,
      cabeceraAX: axHeader ?? 'no expuesta',
      espaciadorasEnAX: axSpacers,
      primera: axData[0], ultima: axData.at(-1),
      saltos: gaps,
      domIdxOk: domData.every((x) => Number(x.ri) === x.di + 2),
      espaciadorasDOM: spacers.length,
      espaciadorasOcultas: spacers.every((x) => x.hidden === 'true'),
    };
    // cabecera: expuesta como fila 1 en modo tabla; en lista/móvil el <thead> está oculto por CSS (no se ve).
    r.ok = Number(r.ariaRowcount) === r.esperado && axDataAttrs.length === domData.length && axSpacers === 0
      && (axHeader == null || axHeader === 1) && r.domIdxOk && r.espaciadorasOcultas
      && axDataAttrs.every((a, k) => Number(a['aria-rowindex']) === Number(a['data-index']) + 2 && Number(a['data-index']) === domData[k].di)
      && r.ultima === r.esperado && r.saltos <= 1;
    out.push(r);
  }
  for (const w of ['top', 'mid', 'end']) await check(w, w);
  await p.fill('.search-box input', 'a'); await p.waitForTimeout(700);
  await check('busca-a-mid', 'mid');
  await p.fill('.search-box input', 'daf'); await p.waitForTimeout(700);
  await check('busca-daf-top', 'top');
  await ctx.close();
}
console.table(out);
console.log(`[${SCALE || 'real'}] OK ${out.filter((r) => r.ok).length}/${out.length}`);
await browser.close();
