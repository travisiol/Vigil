// Vigil Lens — service worker.
// Regroupe les demandes de verdict de tous les onglets, les envoie à l'API Vigil par lots de 30, garde les réponses un moment.
// Aucune donnée personnelle n'est envoyée : seulement les adresses de tokens visibles à l'écran.

const DEFAULT_API = "https://vigil-eight-ecru.vercel.app";
const KNOWN_TTL = 60_000; // verdict connu : gardé 1 min
const PENDING_TTL = 4_000; // scan en cours : on redemande au bout de 4 s

const cache = new Map(); // adresse -> { data, at }

async function apiBase() {
  const { api } = await chrome.storage.local.get("api");
  return (api || DEFAULT_API).replace(/\/+$/, "");
}

async function verdicts(addrs) {
  const now = Date.now();
  const out = {};
  const todo = [];
  for (const a of addrs) {
    const c = cache.get(a);
    if (c && now - c.at < (c.data.pending ? PENDING_TTL : KNOWN_TTL)) out[a] = c.data;
    else todo.push(a);
  }
  const base = await apiBase();
  for (let i = 0; i < todo.length; i += 30) {
    const chunk = todo.slice(i, i + 30);
    try {
      const r = await fetch(`${base}/api/lens?a=${chunk.join(",")}`);
      const j = await r.json();
      for (const a of chunk) {
        const d = j.results?.[a];
        if (d) {
          cache.set(a, { data: d, at: Date.now() });
          out[a] = d;
        }
      }
    } catch {
      // réseau coupé : on renverra la demande au prochain passage
    }
  }
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return out;
}

// Détail d'un token (carte au survol, panneau) : radar de sortie + scan rapide, à la demande
async function detail(mint) {
  const base = await apiBase();
  const [radar, scan] = await Promise.all([
    fetch(`${base}/api/radar/${mint}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${base}/api/scan/${mint}?depth=quick`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { radar, scan, base };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "verdicts") verdicts(msg.addrs || []).then(reply);
  else if (msg?.type === "detail") detail(msg.mint).then(reply);
  else if (msg?.type === "base") apiBase().then(reply);
  else return false;
  return true; // réponse asynchrone
});
