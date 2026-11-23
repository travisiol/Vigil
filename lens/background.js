// Vigil Lens — service worker `[F-093]`
// Regroupe les demandes de verdict de tous les onglets, les envoie à l'API Vigil par lots de 30, garde les réponses un moment.
// Aucune donnée personnelle n'est envoyée : seulement les adresses de tokens visibles à l'écran.

const DEFAULT_API = "https://vigil-eight-ecru.vercel.app";
const KNOWN_TTL = 60_000; // verdict connu : gardé 1 min
const PENDING_TTL = 2_500; // scan en cours : on redemande au serveur au bout de 2,5 s
const IS_B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const cache = new Map(); // adresse -> { data, at }
const inflight = new Map(); // adresse -> promesse de l'appel en cours (deux onglets ne déclenchent qu'un appel)

// Serveur : le site en ligne, ou un autre réglé dans la fenêtre de l'extension (https, ou localhost pour le développement)
function safeBase(v) {
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin;
  } catch {}
  return DEFAULT_API;
}
async function apiBase() {
  const { api } = await chrome.storage.local.get("api");
  return safeBase(api || DEFAULT_API);
}
async function getJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function verdicts(list) {
  const addrs = [...new Set((list || []).filter((a) => typeof a === "string" && IS_B58.test(a)))].slice(0, 60);
  const start = Date.now();
  const out = {};
  const todo = [];
  const waits = new Set();
  for (const a of addrs) {
    const c = cache.get(a);
    if (c && start - c.at < (c.data.pending ? PENDING_TTL : KNOWN_TTL)) out[a] = c.data;
    else if (inflight.has(a)) waits.add(inflight.get(a));
    else todo.push(a);
  }
  if (todo.length) {
    const base = await apiBase();
    for (let i = 0; i < todo.length; i += 30) {
      const chunk = todo.slice(i, i + 30);
      const p = getJson(`${base}/api/lens?a=${chunk.join(",")}`, 12_000)
        .then((j) => {
          const t = Date.now();
          for (const a of chunk) if (j?.results?.[a]) cache.set(a, { data: j.results[a], at: t });
        })
        .catch(() => {}) // réseau coupé ou serveur en erreur : la page redemandera plus tard
        .finally(() => chunk.forEach((a) => inflight.delete(a)));
      chunk.forEach((a) => inflight.set(a, p));
      waits.add(p);
    }
  }
  await Promise.all(waits);
  for (const a of addrs) {
    if (out[a]) continue;
    const c = cache.get(a);
    if (c && c.at >= start) out[a] = c.data;
  }
  while (cache.size > 5000) cache.delete(cache.keys().next().value);
  return out;
}

// Détail d'un token (panneau) : radar de sortie + scan rapide, à la demande
async function detail(mint) {
  if (!IS_B58.test(mint || "")) return {};
  const base = await apiBase();
  const [radar, scan] = await Promise.all([
    getJson(`${base}/api/radar/${mint}`, 15_000).catch(() => null),
    getJson(`${base}/api/scan/${mint}?depth=quick`, 15_000).catch(() => null),
  ]);
  return { radar, scan };
}

// Ouvre le scan complet dans un nouvel onglet, juste à côté de celui du terminal
async function open(mint, tab) {
  if (!IS_B58.test(mint || "")) return;
  const base = await apiBase();
  const opts = { url: `${base}/token/${mint}` };
  if (tab) {
    opts.index = tab.index + 1;
    opts.openerTabId = tab.id;
  }
  await chrome.tabs.create(opts).catch(() => chrome.tabs.create({ url: opts.url }));
}

// Sur l'icône de l'extension : le nombre de tokens Bundled à l'écran, en rouge
function setStats(c, tab) {
  if (!tab?.id) return;
  const n = c?.bundled || 0;
  chrome.action.setBadgeText({ tabId: tab.id, text: n ? String(Math.min(n, 99)) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#FF4D4D" }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ tabId: tab.id, color: "#FFFFFF" })?.catch?.(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tab = sender.tab;
  switch (msg?.type) {
    case "verdicts":
      verdicts(msg.addrs).then(reply, () => reply({}));
      return true;
    case "detail":
      detail(msg.mint).then(reply, () => reply({}));
      return true;
    case "open":
      open(msg.mint, tab).finally(() => reply({}));
      return true;
    case "stats":
      setStats(msg.c, tab);
      reply({});
      return false;
    case "base":
      apiBase().then(reply);
      return true;
    default:
      return false;
  }
});

// Première installation : la page qui explique les trois sceaux
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const base = await apiBase();
  chrome.tabs.create({ url: `${base}/#seals` }).catch(() => {});
});
