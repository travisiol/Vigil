/**
 * Logos des tokens servis par Vigil, avec cache.
 * Avant : chaque navigateur allait chercher chaque logo sur les relais IPFS publics, qui répondaient 429 (trop de requêtes) :
 * 13 logos sur 20 manquants dans New pairs. Maintenant : le serveur va chercher chaque logo UNE fois (relais essayés tour à tour,
 * un relais qui répond 429 est mis de côté 60 s), le garde en mémoire, et le navigateur le garde 1 jour.
 */
export const dynamic = "force-dynamic";

type Img = { body: ArrayBuffer; type: string };
const cache = new Map<string, Img>();
const failed = new Map<string, number>(); // logo introuvable : on ne réessaie pas avant 10 min
const inflight = new Map<string, Promise<Img | null | "busy">>();
const hostBlockedUntil = new Map<string, number>();
let cacheBytes = 0;
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_IMG = 2 * 1024 * 1024;
let running = 0;
const waiting: (() => void)[] = [];
const CONCURRENCY = 6;

function candidates(src: string): string[] {
  const m = src.match(/cdn-cgi\/image\/[^/]*\/(https?:\/\/.+)$/);
  const original = m ? m[1] : src;
  const cid = original.match(/\/ipfs\/([^/?#]+)/)?.[1];
  // IPFS : d'abord la passerelle de pump.fun et Filebase (les passerelles publiques répondent 429 en permanence)
  const out = cid
    ? [`https://pump.mypinata.cloud/ipfs/${cid}`, `https://ipfs.filebase.io/ipfs/${cid}`, src, original, `https://ipfs.io/ipfs/${cid}`, `https://dweb.link/ipfs/${cid}`]
    : [src, original];
  return [...new Set(out)];
}

/** Seulement des adresses web publiques (pas d'IP, pas de réseau local). */
function allowed(u: string): URL | null {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    const h = url.hostname;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":")) return null;
    return url;
  } catch {
    return null;
  }
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function fetchOne(u: string): Promise<Img | null | "busy"> {
  const url = allowed(u);
  if (!url) return null;
  if ((hostBlockedUntil.get(url.hostname) ?? 0) > Date.now()) return "busy";
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: "image/*" }, redirect: "follow" }).catch(() => null);
  if (!r) return null;
  if (r.status === 429) {
    hostBlockedUntil.set(url.hostname, Date.now() + 60_000);
    return "busy";
  }
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !type.startsWith("image/")) return null;
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX_IMG) return null;
  const body = await r.arrayBuffer().catch(() => null);
  if (!body || body.byteLength > MAX_IMG) return null;
  return { body, type };
}

async function load(src: string): Promise<Img | null | "busy"> {
  let busy = false;
  for (const c of candidates(src)) {
    const got = await slot(() => fetchOne(c));
    if (got === "busy") busy = true;
    else if (got) return got;
  }
  return busy ? "busy" : null;
}

function remember(key: string, img: Img) {
  cache.set(key, img);
  cacheBytes += img.body.byteLength;
  while (cacheBytes > MAX_BYTES && cache.size) {
    const first = cache.keys().next().value as string;
    cacheBytes -= cache.get(first)!.body.byteLength;
    cache.delete(first);
  }
}

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get("u") ?? "";
  if (!allowed(src)) return new Response(null, { status: 400 });
  let img = cache.get(src);
  if (img) {
    cache.delete(src); // LRU : remis en fin de file
    cache.set(src, img);
  } else {
    if ((failed.get(src) ?? 0) > Date.now()) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=600" } });
    let p = inflight.get(src);
    if (!p) {
      p = load(src).finally(() => inflight.delete(src));
      inflight.set(src, p);
    }
    const got = await p;
    if (!got || got === "busy") {
      // Introuvable : on ne réessaie pas avant 10 min. Passerelles saturées : on réessaie dans 15 s.
      failed.set(src, Date.now() + (got === "busy" ? 15_000 : 600_000));
      if (failed.size > 5000) failed.delete(failed.keys().next().value as string);
      return new Response(null, { status: 404, headers: { "cache-control": got === "busy" ? "no-store" : "public, max-age=600" } });
    }
    img = got;
    remember(src, img);
  }
  return new Response(img.body, { headers: { "content-type": img.type, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff" } });
}
