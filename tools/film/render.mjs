// Rend film.html en MP4 (H.264) avec Chrome headless : capture image par image via CDP, encodage WebCodecs + mp4-muxer dans la page.
// Usage : node render.mjs <url> <sortie.mp4> [fps] [largeur] [hauteur]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, out, fpsArg, wArg, hArg] = process.argv.slice(2);
const FPS = +(fpsArg || 30), W = +(wArg || 1920), H = +(hArg || 1080), BR = +(process.argv[7] || 6e6);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const profile = join(dirname(fileURLToPath(import.meta.url)), 'chrome-render');

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find((t) => t.type === 'page' && t.url.startsWith(url.split('?')[0])); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('no page target');
}

async function main() {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { r, j } = pending.get(d.id); pending.delete(d.id); d.error ? j(new Error(JSON.stringify(d.error))) : r(d.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 800)); return res.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 80; i++) { if (await evaluate('!!(window.__film && window.gsap)')) break; await sleep(250); }
  await evaluate('window.__film.ready.then(() => true)');
  await evaluate('window.dispatchEvent(new Event("resize")), true');
  const DUR = await evaluate('window.__film.duration');
  const supported = await evaluate(`VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: ${W}, height: ${H}, bitrate: ${Math.round(BR)}, framerate: ${FPS} }).then(s => s.supported)`);
  if (!supported) throw new Error('H.264 encoding not supported in this Chrome');
  await evaluate(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }).then(() => true)`);
  await evaluate(`(() => {
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: ${W}, height: ${H}, frameRate: ${FPS} }, fastStart: 'in-memory' });
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { window.__encErr = String(e); } });
    enc.configure({ codec: 'avc1.640028', width: ${W}, height: ${H}, bitrate: ${Math.round(BR)}, framerate: ${FPS}, latencyMode: 'quality' });
    window.__rec = { muxer, enc };
    window.__addFrame = async (b64, i) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/jpeg' }));
      const f = new VideoFrame(bmp, { timestamp: Math.round(i * 1e6 / ${FPS}), duration: Math.round(1e6 / ${FPS}) });
      enc.encode(f, { keyFrame: i % ${FPS * 2} === 0 }); f.close(); bmp.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      return true;
    };
    return true;
  })()`);
  const N = Math.ceil(DUR * FPS);
  console.log('duration', DUR, 'frames', N);
  for (let i = 0; i <= N; i++) {
    await evaluate(`window.__film.seek(${(i / FPS).toFixed(4)}), true`);
    await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, captureBeyondViewport: false });
    await evaluate(`window.__addFrame(${JSON.stringify(shot.data)}, ${i})`);
    if (i % 60 === 0) console.log('frame', i, '/', N);
  }
  console.log('finalizing');
  const size = await evaluate(`(async () => { await window.__rec.enc.flush(); window.__rec.muxer.finalize(); window.__mp4 = new Uint8Array(window.__rec.muxer.target.buffer); return window.__mp4.length; })()`);
  console.log('mp4 bytes', size);
  const parts = [];
  const CH = 1 << 20;
  for (let off = 0; off < size; off += CH) {
    const b64 = await evaluate(`(() => { const b = window.__mp4.subarray(${off}, ${off} + ${CH}); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); })()`);
    parts.push(Buffer.from(b64, 'base64'));
  }
  const data = Buffer.concat(parts);
  const err = await evaluate('window.__encErr || null');
  if (err) throw new Error(err);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data);
  console.log('written', out, Math.round(data.length / 1024), 'KB');
  ws.close();
}
main().catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; }).finally(() => { try { chrome.kill(); } catch {} });
