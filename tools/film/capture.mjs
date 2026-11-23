// Vigil — capture d'un vrai site avec l'extension active, pour le film et les exemples `[F-088]`.
//
//   node capture.mjs login axiom          ouvre une fenêtre Chrome à part (profil dédié) sur Axiom : tu t'y connectes toi-même, puis tu fermes la fenêtre
//   node capture.mjs record axiom         rouvre ce Chrome, active Vigil, filme la vraie session (badges, survol, clic, panneau)
//   node capture.mjs record padre         pareil sur la page publique de Padre (Terminal), sans connexion
//
// Les appels de l'extension (https://vigil.test/...) sont servis par l'API Vigil locale (http://localhost:3100) : verdicts réels.
// Rien n'est cliqué à part un token pour ouvrir sa page. Aucune transaction, aucun réglage de compte.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const API = process.env.VIGIL_API || 'http://localhost:3100';
const W = 1600, H = 900, FPS = 10;

const SITES = {
  axiom: { home: 'https://axiom.trade/', board: 'https://axiom.trade/pulse', click: true, redact: [{ x: 1040, y: 0, w: 560, h: 64 }] },
  padre: { home: 'https://trade.padre.gg/', board: 'https://trade.padre.gg/', click: false, scrollTo: 560, redact: [] },
  pump: { home: 'https://pump.fun/', board: 'https://pump.fun/board', click: true, redact: [{ x: 1300, y: 0, w: 300, h: 64 }] },
};

const [mode, siteKey = 'axiom', outArg] = process.argv.slice(2);
const site = SITES[siteKey];
if (!site || !['login', 'record'].includes(mode)) {
  console.log('usage: node capture.mjs login|record axiom|padre|pump [dossier]');
  process.exit(1);
}
const profile = join(HERE, 'chrome-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (mode === 'login') {
  // Chrome normal (avec fenêtre), profil dédié : la connexion reste enregistrée pour "record"
  spawn(CHROME, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H + 120}`, site.home], { detached: true, stdio: 'ignore' }).unref();
  console.log('Chrome est ouvert sur', site.home, ': connecte-toi, puis ferme la fenêtre.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = outArg || join(HERE, 'captures', `${siteKey}-${stamp}`);
mkdirSync(OUT, { recursive: true });
const content = readFileSync(join(ROOT, 'lens', 'content.js'), 'utf8');

const chrome = spawn(CHROME, [...(process.env.HEADED ? [] : ['--headless=new']), `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H + 120}`, '--hide-crash-restore-bubble', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });

let onFrame = () => {};
async function main() {
  let t;
  for (let i = 0; i < 80 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(250); }
  if (!t) throw new Error('Chrome did not start (close any Chrome window opened by "login" first)');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  const send = (method, params = {}, ms = 15000) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => { pending.delete(i); j(new Error('timeout ' + method)); }, ms); pending.set(i, { r: (v) => { clearTimeout(to); r(v); }, j: (e) => { clearTimeout(to); j(e); } }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { r, j } = pending.get(d.id); pending.delete(d.id); d.error ? j(new Error(JSON.stringify(d.error))) : r(d.result); return; }
    if (d.method === 'Page.screencastFrame') { onFrame(d.params); return; }
    if (d.method === 'Fetch.requestPaused') {
      const u = new URL(d.params.request.url);
      try {
        const r = await fetch(API + u.pathname + u.search);
        const body = Buffer.from(await r.arrayBuffer()).toString('base64');
        await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: r.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body });
      } catch { await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 502, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }).catch(() => {}); }
    }
  };
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setBypassCSP', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://vigil.test/*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__VIGIL_API='https://vigil.test';(function run(){ if(!document.documentElement||!document.body){ return document.addEventListener('DOMContentLoaded', run, { once: true }); } ${content}\n})();` });

  // --- enregistrement : flux vidéo natif de Chrome (une image à chaque rendu), horodaté ---
  const frames = []; const events = {}; const T0 = Date.now();
  const now = () => (Date.now() - T0) / 1000;
  let n = 0;
  onFrame = (p) => {
    const f = `f${String(++n).padStart(5, '0')}.jpg`;
    writeFileSync(join(OUT, f), Buffer.from(p.data, 'base64'));
    frames.push({ f, t: +now().toFixed(3) });
    send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  };
  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // le flux n'envoie rien quand rien ne bouge : on garde une image par seconde au minimum
  const keep = setInterval(() => { if (frames.length && now() - frames[frames.length - 1].t > 0.5) frames.push({ f: frames[frames.length - 1].f, t: +now().toFixed(3) }); }, 250);
  console.log('recording', site.board);
  await send('Page.navigate', { url: site.board });
  await sleep(4000);
  if (site.scrollTo) { await ev(`window.scrollTo({ top: ${site.scrollTo}, behavior: 'smooth' }), true`); await sleep(1200); }
  const badgeStats = `(() => { const b=[...document.querySelectorAll('.vgl-b')].filter(x=>{const r=x.getBoundingClientRect();return r.top>70&&r.bottom<${H}-10&&r.width>0}); const done=b.filter(x=>!x.classList.contains('vgl-scan')); return { n:b.length, done:done.length }; })()`;
  // attendre que la plupart des badges visibles aient leur verdict (60 s max)
  for (let i = 0; i < 60; i++) { const s = await ev(badgeStats); if (s.n >= 3 && s.done / s.n >= 0.8) break; await sleep(1000); }
  events.verdicts = now();
  console.log('verdicts at', events.verdicts.toFixed(1), 's, frames', frames.length);
  await sleep(2500);
  // survol d'un badge Bundled (sinon Watch, sinon le premier)
  const target = await ev(`(() => { const vis=x=>{const r=x.getBoundingClientRect();return r.top>90&&r.bottom<${H}-60&&r.left>20&&r.right<${W}-20}; const all=[...document.querySelectorAll('.vgl-b')].filter(vis); const b=all.find(x=>x.classList.contains('vgl-bundled'))||all.find(x=>x.classList.contains('vgl-watch'))||all[0]; if(!b) return null; b.setAttribute('data-vgl-target','1'); const r=b.getBoundingClientRect(); const nm=b.previousElementSibling; const nr=nm?nm.getBoundingClientRect():r; return { x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, nx:nr.left+Math.min(20,nr.width/2), ny:nr.top+nr.height/2, label:b.textContent, addr:b.dataset.vglAddr }; })()`);
  if (target) {
    let mx = W * 0.75, my = H * 0.85;
    for (let i = 1; i <= 24; i++) { const k = 1 - (1 - i / 24) ** 3; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx + (target.x - mx) * k, y: my + (target.y - my) * k }); await sleep(50); }
    events.hover = { t: now(), x: target.x, y: target.y, w: target.w, h: target.h, label: target.label, addr: target.addr };
    await sleep(300);
    events.hoverCheck = await ev(`(() => { const e=document.elementFromPoint(${target.x},${target.y}); const tip=document.querySelector('.vgl-tip'); return { under: e ? e.tagName + '.' + String(e.className).slice(0,40) : null, isBadge: !!(e && e.closest('.vgl-b')), tip: tip ? tip.style.display : 'none' }; })()`);
    console.log('hover check', JSON.stringify(events.hoverCheck));
    await sleep(3500);
    if (site.click) {
      const url0 = await ev('location.href');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.nx, y: target.ny });
      await sleep(400);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.nx, y: target.ny, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.nx, y: target.ny, button: 'left', clickCount: 1 });
      events.click = { t: now(), x: target.nx, y: target.ny };
      for (let i = 0; i < 20; i++) { await sleep(500); if ((await ev('location.href')) !== url0) break; }
      // le panneau Vigil, avec son détail
      for (let i = 0; i < 30; i++) { const p = await ev(`(() => { const h=[...document.querySelectorAll('div')].find(d=>d.style.zIndex==='2147483646'&&d.style.display!=='none'&&d.shadowRoot); if(!h) return null; const det=h.shadowRoot.getElementById('det'); const r=h.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height, detail: !!(det && det.textContent.trim()) }; })()`); if (p && p.detail) { events.panel = { t: now(), ...p }; break; } await sleep(1000); }
      await sleep(6000);
    }
  }
  events.end = now();
  clearInterval(keep);
  await send('Page.stopScreencast').catch(() => {});
  const manifest = { site: siteKey, url: site.board, w: W, h: H, fps: FPS, frames, events, redact: site.redact, capturedAt: new Date().toISOString() };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('frames', frames.length, 'events', JSON.stringify(events));
  console.log('saved to', OUT);
  ws.close();
}
main().catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; }).finally(() => { try { chrome.kill(); } catch {} });
