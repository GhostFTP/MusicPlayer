// fin-de-cola.mjs — «siguiente» MANUAL en el último de la cola. Lo comparten queue-func.mjs (con
// canciones) y video-mix-func.mjs (con videos): es el mismo motor y las mismas comprobaciones.
//
// La regla (1.31.0): si no hay siguiente —en orden, el último con repetir ≠ «todo»; en aleatorio, el
// ciclo agotado con repetir ≠ «todo»— y lo pide la persona, NO PASA NADA: lo que suena sigue sonando
// y el reproductor sigue diciendo que suena. Antes el estado pasaba a «en pausa» con el medio
// sonando (botón en «Reproducir», MediaSession en paused). El FIN NATURAL del último no cambia: se
// detiene, y ahí «en pausa» es verdad.
//
// Comprueba, con una cola de 3 y repetir apagado, en orden y en aleatorio con el ciclo agotado:
//   · «siguiente» por el botón de la barra, el del expandido y MediaSession nexttrack (el handler que
//     registró la app, llamado a mano) a 1440, y por el botón de la mini a 390 con tap; en videos,
//     también por el botón de la pantalla completa. Después de cada uno: la pista es la misma, el
//     medio sigue avanzando, el botón central dice «Pausa» y MediaSession dice playing;
//   · con «repetir todo», «siguiente» en el último sigue dando la vuelta;
//   · el fin natural del último deja el estado en pausa, con nada sonando.
// Y MIDE (sin comprobar) qué hace «siguiente» en el último con «repetir una».
//
//   const medidas = await probarFinDeCola({ browser, token, base, ok, items, sufijo, rutas })
//     items   3 ítems de cola (canciones, o videos con kind:'video'). Tienen que durar más que la
//             prueba de cada caso (~10 s): con uno corto, su fin natural se mete en el medio. Pueden
//             repetirse (la cola los distingue por _qid, y así se comparan acá)
//     sufijo  para las claves ('canciones' | 'videos')
//     rutas   async (ctx) => { … }  las rutas de stream que necesite quien llama

const ESPERA = 700;

export async function probarFinDeCola({ browser, token, base, ok: okDeQuienLlama, items, sufijo, rutas }) {
  const ok = (k, v, extra) => okDeQuienLlama(k, !!v, extra);
  const esVideo = items[0].kind === 'video';
  const medidas = {};

  async function abrir(w, h, mobile) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => {
      localStorage.setItem('token', t);
      window.__fdcEls = new Set();
      const op = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...a) { window.__fdcEls.add(this); return op.apply(this, a); };
      // Los handlers de MediaSession que registra la app, para poder llamar a nexttrack como lo haría el sistema.
      window.__fdcMs = {};
      const ms = navigator.mediaSession; const o = ms.setActionHandler.bind(ms);
      ms.setActionHandler = (a, h) => { window.__fdcMs[a] = h; return o(a, h); };
      window.__fdcPlayer = () => {
        const root = document.getElementById('root');
        const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
        const stack = [root[key]?.stateNode?.current ?? root[key]];
        while (stack.length) {
          const f = stack.pop();
          if (!f) continue;
          const v = f.memoizedProps?.value;
          if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
        return null;
      };
      window.__fdcEstado = () => {
        const v = window.__fdcPlayer();
        const sonando = [...window.__fdcEls].filter((e) => !e.paused && !e.ended);
        return { actual: v.currentTrack?.title ?? null, qid: v.currentTrack?._qid ?? null, idx: v.queueIndex, isPlaying: v.isPlaying, shuffle: v.shuffle, repeat: v.repeat,
          sonando: sonando.length, t: sonando[0] ? +sonando[0].currentTime.toFixed(2) : null,
          boton: document.querySelector('.player-bar .ctrl-btn.play')?.getAttribute('aria-label') ?? null, ms: navigator.mediaSession.playbackState };
      };
    }, token);
    await rutas?.(ctx);
    await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
    const p = await ctx.newPage();
    await p.goto(base + '/');
    await p.waitForSelector('.player-bar');
    return { ctx, p };
  }
  const estado = (p) => p.evaluate(() => window.__fdcEstado());
  const suena = (p) => p.waitForFunction(() => { const e = window.__fdcEstado(); return e.isPlaying && e.sonando === 1 && e.t > 0.15; }, null, { timeout: 8000 }).then(() => true, () => false);

  // Deja sonando un ítem del que NO hay siguiente: en orden, el último; en aleatorio, el que quede al
  // agotar el ciclo (se avanza por la API, que es el mismo `next` de los botones).
  async function alFinal(p, { aleatorio, repetir = 'off' }) {
    await p.evaluate(([q, sh, rep]) => {
      const v = window.__fdcPlayer();
      v.play(q, q.length - 1);
      if (v.shuffle !== sh) v.toggleShuffle();
      const orden = ['off', 'all', 'one']; const pasos = (orden.indexOf(rep) - orden.indexOf(v.repeat) + 3) % 3;
      for (let i = 0; i < pasos; i++) v.cycleRepeat();
    }, [items, aleatorio, 'off']);
    await suena(p);
    if (aleatorio) for (let i = 0; i < items.length - 1; i++) { await p.evaluate(() => window.__fdcPlayer().next()); await p.waitForTimeout(450); }
    if (repetir !== 'off') await p.evaluate((rep) => { const v = window.__fdcPlayer(); const orden = ['off', 'all', 'one']; const pasos = (orden.indexOf(rep) - orden.indexOf(v.repeat) + 3) % 3; for (let i = 0; i < pasos; i++) v.cycleRepeat(); }, repetir);
    await suena(p);
    await p.waitForTimeout(250);
    return estado(p);
  }
  // Pulsa y mide: antes, justo después y medio segundo más tarde.
  async function pulsar(p, accion) {
    const antes = await estado(p);
    await accion();
    await p.waitForTimeout(ESPERA);
    const d1 = await estado(p);
    await p.waitForTimeout(500);
    const d2 = await estado(p);
    return { antes, d1, d2 };
  }
  const nadaCambio = ({ antes, d1, d2 }) => antes.isPlaying && d1.qid === antes.qid && d1.idx === antes.idx && d1.isPlaying === true && d2.isPlaying === true
    && d1.sonando === 1 && d2.sonando === 1 && d2.t > d1.t + 0.2 && String(d1.boton).startsWith('Pausa') && d1.ms === 'playing';
  const resumen = ({ antes, d1, d2 }) => ({ pista: `${antes.actual} → ${d1.actual}`, estado: d1.isPlaying ? 'sonando' : 'en pausa', boton: d1.boton, mediaSession: d1.ms, t: [antes.t, d1.t, d2.t] });
  const abrirExpandido = async (p) => { await p.locator(esVideo ? '[data-video-slot="mini"]' : '.player-bar .player-art').click(); await p.waitForSelector('.player-expanded'); await p.waitForTimeout(600); };
  const cerrarExpandido = async (p) => { for (let i = 0; i < 3 && await p.locator('.player-expanded').isVisible().catch(() => false); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(400); } };

  // ── Escritorio 1440 ──
  {
    const { ctx, p } = await abrir(1440, 900, false);
    for (const aleatorio of [false, true]) {
      const modo = aleatorio ? 'aleatorio' : 'en_orden';
      await alFinal(p, { aleatorio });
      let r = await pulsar(p, () => p.locator('.player-bar .ctrl-next').click());
      ok(`fin_siguiente_no_hace_nada_${modo}_barra_${sufijo}`, nadaCambio(r), resumen(r));

      await alFinal(p, { aleatorio });
      await abrirExpandido(p);
      r = await pulsar(p, () => p.locator('.player-expanded .exp-next').click());
      ok(`fin_siguiente_no_hace_nada_${modo}_expandido_${sufijo}`, nadaCambio(r), resumen(r));
      await cerrarExpandido(p);

      await alFinal(p, { aleatorio });
      r = await pulsar(p, () => p.evaluate(() => window.__fdcMs.nexttrack()));
      ok(`fin_siguiente_no_hace_nada_${modo}_mediasession_${sufijo}`, nadaCambio(r), resumen(r));

      // Repetir todo: en el último, «siguiente» sigue dando la vuelta.
      const a = await alFinal(p, { aleatorio, repetir: 'all' });
      await p.locator('.player-bar .ctrl-next').click(); await p.waitForTimeout(ESPERA);
      const b = await estado(p);
      ok(`fin_repetir_todo_da_la_vuelta_${modo}_${sufijo}`, a.repeat === 'all' && b.qid !== a.qid && b.isPlaying && (aleatorio || b.idx === 0) && await suena(p), { de: a.actual, a: b.actual, idx: b.idx });
    }

    // Repetir una, en el último: sólo se mide.
    await alFinal(p, { aleatorio: false, repetir: 'one' });
    const una = await pulsar(p, () => p.locator('.player-bar .ctrl-next').click());
    medidas[`repetir_una_siguiente_en_el_ultimo_${sufijo}`] = resumen(una);

    // Pantalla completa (sólo video): el botón «Siguiente» de la capa, en el último.
    if (esVideo) {
      await alFinal(p, { aleatorio: false });
      await abrirExpandido(p);
      await p.locator('.exp-actions .exp-fullscreen').click();
      await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
      const esCapa = () => p.evaluate(() => (document.fullscreenElement?.className ?? '').split(' ').includes('player-video-layer'));
      const entro = await esCapa();
      const r = await pulsar(p, async () => { await p.mouse.move(700, 300); await p.mouse.move(720, 320); await p.waitForTimeout(150); await p.locator('.vfs button[aria-label="Siguiente"]').click(); });
      ok(`fin_siguiente_no_hace_nada_pantalla_completa_${sufijo}`, entro && nadaCambio(r) && await esCapa(), { entro, ...resumen(r) });
      await p.evaluate(() => document.exitFullscreen?.().catch(() => {})); await p.waitForTimeout(400);
      await cerrarExpandido(p);
    }

    // Fin NATURAL del último (repetir apagado, en orden): se detiene y el estado dice la verdad.
    await alFinal(p, { aleatorio: false });
    const antes = await estado(p);
    await p.evaluate(() => { const e = [...window.__fdcEls].find((x) => !x.paused); if (e.duration - e.currentTime > 1.5) e.currentTime = e.duration - 1; });
    await p.waitForFunction(() => window.__fdcEstado().sonando === 0, null, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(500);
    const fin = await estado(p);
    ok(`fin_natural_queda_en_pausa_${sufijo}`, fin.qid === antes.qid && fin.isPlaying === false && fin.sonando === 0 && String(fin.boton).startsWith('Reproducir') && fin.ms === 'paused',
      { pista: `${antes.actual} → ${fin.actual}`, estado: fin.isPlaying ? 'sonando' : 'en pausa', sonando: fin.sonando, boton: fin.boton, mediaSession: fin.ms });
    await ctx.close();
  }

  // ── Teléfono 390: el botón de la mini, con tap ──
  {
    const { ctx, p } = await abrir(390, 844, true);
    for (const aleatorio of [false, true]) {
      await alFinal(p, { aleatorio });
      const r = await pulsar(p, () => p.locator('.player-bar .mini-next').tap());
      ok(`fin_siguiente_no_hace_nada_${aleatorio ? 'aleatorio' : 'en_orden'}_mini_390_${sufijo}`, nadaCambio(r) && !(await p.locator('.player-expanded').isVisible().catch(() => false)), resumen(r));
    }
    await ctx.close();
  }
  return medidas;
}
