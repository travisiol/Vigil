// Vigil Lens — content script `[F-080]`
// Pose un badge de verdict (Clean / Watch / Bundled) à côté de chaque token Solana visible,
// et un panneau flottant sur la page d'un token (verdict, radar de sortie, ouverture dans Vigil).
// Rien n'est calculé en continu : seulement les tokens affichés à l'écran, à la demande.
(() => {
  if (window.__vigilLens) return;
  window.__vigilLens = true;

  const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const IS_B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const host = location.hostname.replace(/^www\./, "");
  const LABEL = { clean: "Clean", watch: "Watch", bundled: "Bundled" };

  // --- transport : extension (service worker) ou test direct dans une page ---
  const hasExt = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  const TEST_API = window.__VIGIL_API || "https://vigil-eight-ecru.vercel.app";
  function send(msg) {
    if (hasExt) return new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
    if (msg.type === "verdicts")
      return fetch(`${TEST_API}/api/lens?a=${msg.addrs.join(",")}`).then((r) => r.json()).then((j) => j.results || {}).catch(() => ({}));
    if (msg.type === "detail")
      return Promise.all([
        fetch(`${TEST_API}/api/radar/${msg.mint}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${TEST_API}/api/scan/${msg.mint}?depth=quick`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([radar, scan]) => ({ radar, scan, base: TEST_API }));
    if (msg.type === "base") return Promise.resolve(TEST_API);
    return Promise.resolve({});
  }

  // --- où trouver l'adresse d'un token, site par site ---
  function addrFromPath(path) {
    const p = path.split("?")[0];
    let m;
    if ((m = p.match(/\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/))) return m[1]; // pump.fun
    if ((m = p.match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/))) return m[1]; // axiom (paire)
    if ((m = p.match(/\/sol\/token\/(?:[A-Za-z0-9]+_)?([1-9A-HJ-NP-Za-km-z]{32,44})/))) return m[1]; // gmgn
    if ((m = p.match(/\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/))) return m[1]; // dexscreener (paire)
    return null;
  }
  // Terminaux (Padre, Photon, BullX…) : l'adresse du token ou de la paire est dans le chemin ou dans ?address=.
  // Le serveur trie ensuite token / paire, donc une adresse qui n'est ni l'un ni l'autre est simplement ignorée.
  const TERMINALS = /(padre\.gg|tinyastro\.io|bullx\.io|bloombot\.app|nova\.trade)$/;
  function addrFromUrl(u) {
    const h = u.hostname.replace(/^www\./, "");
    const fromPath = addrFromPath(u.pathname);
    if (fromPath || !TERMINALS.test(h)) return fromPath;
    const q = u.searchParams.get("address") || u.searchParams.get("token") || u.searchParams.get("mint");
    if (q && IS_B58.test(q)) return q;
    const segs = u.pathname.split("/").filter((x) => IS_B58.test(x));
    return segs.length ? segs[segs.length - 1] : null;
  }
  function addrFromHref(href) {
    try {
      const u = new URL(href, location.href);
      const h = u.hostname.replace(/^www\./, "");
      if (!/(pump\.fun|axiom\.trade|gmgn\.ai|dexscreener\.com|birdeye\.so|solscan\.io)$/.test(h) && !TERMINALS.test(h)) return null;
      if (/solscan\.io$/.test(h)) {
        const m = u.pathname.match(/\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
        return m ? m[1] : null;
      }
      return addrFromUrl(u);
    } catch {
      return null;
    }
  }

  // --- styles (badges dans la page, isolés par le préfixe vgl-) ---
  const css = `
  .vgl-b{all:initial;display:inline-flex!important;align-items:center;gap:4px;height:18px;padding:0 7px;margin:0 0 0 6px;border-radius:999px;
    font:600 10.5px/1 Inter,system-ui,sans-serif!important;letter-spacing:.01em;vertical-align:middle;cursor:help;white-space:nowrap;
    border:1px solid rgba(255,255,255,.12);background:#0B0A0F;color:#A6A1B8;z-index:2147483000;position:relative}
  .vgl-b i{all:initial;width:6px;height:6px;border-radius:50%;background:#6E6880;display:inline-block}
  .vgl-b.vgl-clean{color:#07E7C3;border-color:rgba(7,231,195,.4);background:rgba(7,231,195,.1)}
  .vgl-b.vgl-clean i{background:#07E7C3}
  .vgl-b.vgl-watch{color:#FFB21F;border-color:rgba(255,178,31,.4);background:rgba(255,178,31,.1)}
  .vgl-b.vgl-watch i{background:#FFB21F}
  .vgl-b.vgl-bundled{color:#FF6B6B;border-color:rgba(255,69,69,.45);background:rgba(255,69,69,.12)}
  .vgl-b.vgl-bundled i{background:#FF4545}
  .vgl-b.vgl-scan i{animation:vglp 1s infinite}
  .vgl-b.vgl-abs{position:absolute!important;top:6px;right:6px;margin:0}
  @keyframes vglp{50%{opacity:.25}}
  .vgl-tip{all:initial;position:fixed;z-index:2147483647;max-width:280px;padding:10px 12px;border-radius:12px;background:#0B0A0F;border:1px solid #24212E;
    box-shadow:0 18px 40px -12px rgba(0,0,0,.8);font:500 12px/1.45 Inter,system-ui,sans-serif;color:#F5F3FA;pointer-events:none}
  .vgl-tip b{font-weight:700}.vgl-tip .m{color:#A6A1B8;display:block;margin-top:4px}`;
  const style = document.createElement("style");
  style.id = "vgl-style";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // --- verdicts : demandes groupées ---
  const state = new Map(); // adresse -> donnée de l'API
  const badges = new Map(); // adresse -> Set<HTMLElement>
  const wanted = new Set();
  let flushTimer = null;
  function want(a) {
    if (state.has(a) && !state.get(a).pending) return;
    wanted.add(a);
    if (!flushTimer) flushTimer = setTimeout(flush, 350);
  }
  async function flush() {
    flushTimer = null;
    const addrs = [...wanted].slice(0, 30);
    addrs.forEach((a) => wanted.delete(a));
    if (!addrs.length) return;
    const res = await send({ type: "verdicts", addrs });
    for (const a of addrs) {
      const d = res[a];
      if (!d) continue;
      state.set(a, d);
      (badges.get(a) || []).forEach((el) => paint(el, d));
      if (d.pending) setTimeout(() => want(a), 4500); // scan en cours : on redemande
    }
    if (panelAddr && res[panelAddr]) renderPanel(res[panelAddr]);
    if (wanted.size) flushTimer = setTimeout(flush, 350);
  }

  function paint(el, d) {
    if (!d || !d.mint) {
      el.remove();
      return;
    }
    const v = d.verdict;
    el.className = `vgl-b ${v ? "vgl-" + v : "vgl-scan"}${el.classList.contains("vgl-abs") ? " vgl-abs" : ""}`;
    el.innerHTML = `<i></i>${v ? LABEL[v] : "Scanning"}`;
    el.dataset.reason = d.reason || "";
  }

  function makeBadge(addr) {
    const el = document.createElement("span");
    el.className = "vgl-b vgl-scan";
    el.innerHTML = "<i></i>Vigil";
    el.dataset.vglAddr = addr;
    el.addEventListener("mouseenter", () => showTip(el));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const d = state.get(addr);
      if (d?.mint) send({ type: "base" }).then((base) => window.open(`${base}/token/${d.mint}`, "_blank", "noopener"));
    });
    if (!badges.has(addr)) badges.set(addr, new Set());
    badges.get(addr).add(el);
    const d = state.get(addr);
    if (d) paint(el, d);
    else want(addr);
    return el;
  }

  // --- infobulle au survol ---
  let tip = null;
  function showTip(el) {
    const d = state.get(el.dataset.vglAddr);
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "vgl-tip";
      document.documentElement.appendChild(tip);
    }
    const v = d?.verdict;
    tip.innerHTML = v
      ? `<b style="color:${v === "clean" ? "#07E7C3" : v === "watch" ? "#FFB21F" : "#FF6B6B"}">Vigil · ${LABEL[v]}</b><span class="m">${escapeHtml(d.reason || "")}</span><span class="m">Click to open the full scan and the exit radar.</span>`
      : `<b>Vigil is scanning this token…</b><span class="m">Launch wallets, dev history, funding links.</span>`;
    const r = el.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 300, Math.max(8, r.left)) + "px";
    tip.style.top = (r.bottom + 8 > window.innerHeight - 120 ? r.top - 90 : r.bottom + 8) + "px";
    tip.style.display = "block";
  }
  function hideTip() {
    if (tip) tip.style.display = "none";
  }
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // --- parcours de la page ---
  function scanLinks(root) {
    const links = root.querySelectorAll ? root.querySelectorAll("a[href]:not([data-vgl])") : [];
    for (const a of links) {
      a.setAttribute("data-vgl", "1");
      const addr = addrFromHref(a.getAttribute("href"));
      if (!addr) continue;
      // pas de badge sur le lien de la page en cours (le panneau s'en charge), ni sur les liens d'icône vides
      if (addr === panelAddr && !a.closest("table, [role=row], li")) continue;
      if (!a.textContent.trim() && !a.querySelector("img")) continue;
      const badge = makeBadge(addr);
      const big = a.offsetHeight > 56 && a.offsetWidth > 140;
      if (big) {
        // carte entière cliquable (listes pump.fun, axiom…) : badge en haut à droite de la carte
        if (getComputedStyle(a).position === "static") a.style.position = "relative";
        badge.classList.add("vgl-abs");
        a.appendChild(badge);
      } else {
        a.insertAdjacentElement("afterend", badge);
      }
    }
  }

  // X : CA écrits en clair dans les tweets
  function scanTweets(root) {
    if (!/x\.com$|twitter\.com$/.test(host) && !window.__VIGIL_API) return; // __VIGIL_API = page de test
    const blocks = root.querySelectorAll ? root.querySelectorAll('[data-testid="tweetText"]:not([data-vgl])') : [];
    for (const b of blocks) {
      b.setAttribute("data-vgl", "1");
      const found = [...new Set((b.textContent.match(B58) || []).filter((x) => IS_B58.test(x) && /[a-z]/.test(x) && /[A-Z0-9]/.test(x)))];
      for (const addr of found.slice(0, 3)) b.appendChild(makeBadge(addr));
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanLinks(document);
      scanTweets(document);
      checkPage();
    }, 400);
  }
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });

  // --- panneau flottant sur la page d'un token ---
  let panelAddr = null;
  let panelHost = null;
  let panelRoot = null;
  let lastPath = "";
  function checkPage() {
    if (location.pathname + location.search === lastPath) return;
    lastPath = location.pathname + location.search;
    const a = /x\.com$|twitter\.com$/.test(host) ? null : addrFromUrl(new URL(location.href));
    panelAddr = a;
    if (!a) {
      if (panelHost) panelHost.style.display = "none";
      return;
    }
    ensurePanel();
    panelHost.style.display = "block";
    renderPanel(state.get(a) || null);
    want(a);
  }
  function ensurePanel() {
    if (panelHost) return;
    panelHost = document.createElement("div");
    panelHost.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
    panelRoot = panelHost.attachShadow({ mode: "open" });
    document.documentElement.appendChild(panelHost);
  }
  let detailFor = null;
  async function renderPanel(d) {
    if (!panelRoot) return;
    const v = d?.verdict;
    const col = v === "clean" ? "#07E7C3" : v === "watch" ? "#FFB21F" : v === "bundled" ? "#FF4545" : "#B57BFF";
    const collapsed = sessionStorage.getItem("vgl-min") === "1";
    panelRoot.innerHTML = `
      <style>
        :host{all:initial}
        .p{width:${collapsed ? "auto" : "300px"};font:500 12.5px/1.45 Inter,system-ui,sans-serif;color:#F5F3FA;background:rgba(11,10,15,.96);
           border:1px solid #24212E;border-left:3px solid ${col};border-radius:14px;padding:${collapsed ? "8px 12px" : "14px"};box-shadow:0 20px 50px -18px #000;backdrop-filter:blur(10px)}
        .h{display:flex;align-items:center;gap:8px}.h b{font-size:13px}.x{margin-left:auto;cursor:pointer;color:#A6A1B8;border:0;background:none;font:inherit}
        .v{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-weight:700;color:${col};background:${col}1f;border:1px solid ${col}66}
        .r{color:#A6A1B8;margin:8px 0 0}.g{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
        .g div{background:#000;border:1px solid #24212E;border-radius:9px;padding:7px 9px}.g span{display:block;color:#A6A1B8;font-size:11px}.g strong{font-size:13px}
        .ra{margin-top:10px;padding:8px 10px;border-radius:9px;background:#13111A}.ra b{color:${col}}
        a.o{display:block;margin-top:12px;text-align:center;padding:9px;border-radius:10px;color:#fff;text-decoration:none;font-weight:700;
           background:linear-gradient(135deg,#9232F1,#BC33C9 50%,#F22C7B)}
        svg{width:16px;height:14px}
      </style>
      <div class="p">
        <div class="h">
          <svg viewBox="0 0 100 84"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9232F1"/><stop offset="1" stop-color="#F22C7B"/></linearGradient></defs><path d="M0 0 L50 84 L100 0 C80 9 60 27 50 50 C40 27 20 9 0 0 Z" fill="url(#g)"/></svg>
          <b>Vigil Lens</b>
          ${v ? `<span class="v">● ${LABEL[v]}</span>` : `<span class="v">Scanning…</span>`}
          <button class="x" title="${collapsed ? "Expand" : "Minimize"}">${collapsed ? "▴" : "▾"}</button>
        </div>
        ${collapsed ? "" : `
        <p class="r">${d?.reason ? escapeHtml(d.reason) : "Reading the launch wallets, the dev's history and who funded the first buyers…"}</p>
        <div id="det"></div>
        <a class="o" id="open" href="#" target="_blank" rel="noopener">Open full scan in Vigil →</a>`}
      </div>`;
    panelRoot.querySelector(".x").onclick = () => {
      sessionStorage.setItem("vgl-min", collapsed ? "0" : "1");
      renderPanel(state.get(panelAddr) || null);
    };
    if (collapsed || !d?.mint) return;
    const base = await send({ type: "base" });
    const open = panelRoot.getElementById("open");
    if (open) open.href = `${base}/token/${d.mint}`;
    // Détail (radar de sortie + chiffres du scan) : une seule fois par token affiché
    if (detailFor === d.mint && panelRoot.__det) return fillDetail(panelRoot.__det);
    detailFor = d.mint;
    const det = await send({ type: "detail", mint: d.mint });
    panelRoot.__det = det;
    fillDetail(det);
  }
  function fillDetail(det) {
    const box = panelRoot && panelRoot.getElementById("det");
    if (!box || !det) return;
    const r = det.radar, s = det.scan;
    const pct = (x) => (x == null ? "–" : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`);
    const sig = s?.signals || {};
    box.innerHTML = `
      <div class="g">
        <div><span>Bought in first 10 s</span><strong>${pct(sig.early10s?.pct)}</strong></div>
        <div><span>Top 10 wallets</span><strong>${pct(sig.top10Pct)}</strong></div>
        <div><span>Launch wallets still hold</span><strong>${r?.stillHeldShare == null ? "–" : Math.round(r.stillHeldShare * 100) + "% of buy"}</strong></div>
        <div><span>Dev sold</span><strong>${r?.devSoldShare == null ? "–" : Math.round(r.devSoldShare * 100) + "% of bag"}</strong></div>
      </div>
      ${r?.headline ? `<div class="ra"><b>Exit radar</b> · ${escapeHtml(r.headline)}</div>` : ""}`;
  }

  scheduleScan();
})();
