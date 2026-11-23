// Fenêtre de l'extension : ce que Vigil voit sur la page, réglages site par site `[F-093]`
const DEFAULT_API = "https://vigil-eight-ecru.vercel.app";
const DEF = { enabled: true, off: [], showClean: true, autoScan: false };
const SITES = [
  ["pump", "pump.fun"], ["axiom", "Axiom"], ["gmgn", "GMGN"], ["dex", "DexScreener"],
  ["padre", "Padre"], ["photon", "Photon", "beta"], ["bullx", "BullX", "beta"], ["x", "X"],
];
const GLYPH = {
  clean: [".......", "..XXX..", ".XXXXX.", ".XXXXX.", ".XXXXX.", "..XXX..", "......."],
  watch: ["..XXX..", ".X...X.", "X..X..X", "X.XXX.X", "X..X..X", ".X...X.", "..XXX.."],
  bundled: ["..XX...", "..XX...", ".......", "XX...XX", "XX...XX", ".......", "......."],
};
const glyph = (k) => {
  let r = "";
  GLYPH[k].forEach((row, y) => [...row].forEach((c, x) => { if (c === "X") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg viewBox="0 0 7 7" aria-hidden="true">${r}</svg>`;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $ = (id) => document.getElementById(id);

$("ver").textContent = "v" + chrome.runtime.getManifest().version;

let settings = { ...DEF };
let page = null;

function renderSites() {
  $("sites").innerHTML = SITES.map(([k, name, beta]) => `<span class="${page?.site === k ? "on" : ""}">${esc(name)}${beta ? ` <i>${beta}</i>` : ""}</span>`).join("");
}

function renderPage() {
  const box = $("page");
  if (!page) {
    box.innerHTML = `<div class="off"><b>Vigil isn't on this page.</b>Open pump.fun, Axiom, GMGN, DexScreener, Padre or X: a small Vigil mark sits after each token's name. Click it to scan that token.</div>`;
    $("siteRow").hidden = true;
    return;
  }
  $("siteRow").hidden = false;
  $("siteLabel").textContent = `Vigil on ${page.siteName}`;
  if (!page.running) {
    box.innerHTML = `<div class="off"><b>Vigil is off on ${esc(page.siteName)}.</b>Turn it back on below.</div>`;
    return;
  }
  const s = page.stats || {};
  const reading = (s.scan || 0) + (s.none || 0);
  const read = (s.clean || 0) + (s.watch || 0) + (s.bundled || 0);
  const idle = s.idle || 0;
  let html = `<h2>On this page</h2>
    <div class="counts">
      <div class="c ok"><strong>${s.clean || 0}</strong><span>${glyph("clean")}Clean</span></div>
      <div class="c wa"><strong>${s.watch || 0}</strong><span>${glyph("watch")}Watch</span></div>
      <div class="c bad${s.bundled ? " hot" : ""}"><strong>${s.bundled || 0}</strong><span>${glyph("bundled")}Bundled</span></div>
    </div>`;
  const parts = [];
  if (read) parts.push(`${read} scanned`);
  if (reading) parts.push(`${reading} reading`);
  if (idle) parts.push(`${idle} not scanned yet: click the Vigil mark next to a token`);
  html += `<p class="note">${parts.length ? parts.join(" · ") + "." : "No token on screen yet. Scroll a list or open a token."}</p>`;
  const t = page.token;
  if (t) {
    const cls = { clean: "ok", watch: "wa", bundled: "bad" }[t.kind] || "";
    const label = { clean: "Clean", watch: "Watch", bundled: "Bundled", scan: "Scanning…", none: "No read yet" }[t.kind];
    html += `<div class="tok ${cls}"><b>${t.symbol ? "$" + esc(t.symbol) + " · " : ""}${label}</b>${t.reason ? `<p>${esc(t.reason)}</p>` : ""}</div>`;
  }
  box.innerHTML = html;
}

async function askPage() {
  try {
    // ?tab=<id> : banc de test (la fenêtre ouverte comme une page lit un autre onglet)
    const forced = +new URLSearchParams(location.search).get("tab");
    const [tab] = forced ? [{ id: forced }] : await chrome.tabs.query({ active: true, currentWindow: true });
    page = tab ? await chrome.tabs.sendMessage(tab.id, { type: "page" }) : null;
  } catch {
    page = null; // pas de Vigil sur cet onglet
  }
  renderPage();
  renderSites();
  $("site").checked = !!page && !(settings.off || []).includes(page.site);
}

chrome.storage.sync.get(DEF).then((s) => {
  settings = s;
  $("clean").checked = s.showClean !== false;
  $("auto").checked = !!s.autoScan;
  askPage();
});
setInterval(askPage, 1500);

$("site").addEventListener("change", () => {
  if (!page) return;
  const off = new Set(settings.off || []);
  if ($("site").checked) off.delete(page.site);
  else off.add(page.site);
  settings.off = [...off];
  chrome.storage.sync.set({ off: settings.off }).then(() => setTimeout(askPage, 400));
});
$("auto").addEventListener("change", () => {
  settings.autoScan = $("auto").checked;
  chrome.storage.sync.set({ autoScan: settings.autoScan }).then(() => setTimeout(askPage, 400));
});
$("clean").addEventListener("change", () => {
  settings.showClean = $("clean").checked;
  chrome.storage.sync.set({ showClean: settings.showClean });
});

// Serveur Vigil (réglage avancé) : le site en ligne par défaut
chrome.storage.local.get("api").then(({ api }) => {
  $("api").value = api || DEFAULT_API;
  $("open").href = $("api").value;
});
$("api").addEventListener("change", () => {
  let v = $("api").value.trim().replace(/\/+$/, "");
  try {
    const u = new URL(v);
    if (!(u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)))) throw 0;
    v = u.origin;
  } catch {
    v = DEFAULT_API;
  }
  $("api").value = v;
  chrome.storage.local.set({ api: v === DEFAULT_API ? null : v });
  $("open").href = v;
});
