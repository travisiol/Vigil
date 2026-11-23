// Vigil Lens — content script `[F-080]` `[F-093]`
// Pose une petite marque « Scan » juste après le nom de chaque token Solana visible. Rien n'est analysé tant qu'on
// ne clique pas : le clic lit ce token-là seul, vite, et ouvre son panneau (verdict, chiffres, radar de sortie) `[F-094]`.
// Le scan automatique de tout l'écran reste une option, coupée par défaut. Rien ne tourne quand l'onglet est caché.
(() => {
  if (window.__vigilLens) return;
  window.__vigilLens = true;

  const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const IS_B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const host = location.hostname.replace(/^www\./, "");
  const SITES = [
    ["pump", /(^|\.)pump\.fun$/, "pump.fun"],
    ["axiom", /(^|\.)axiom\.trade$/, "Axiom"],
    ["gmgn", /(^|\.)gmgn\.ai$/, "GMGN"],
    ["dex", /(^|\.)dexscreener\.com$/, "DexScreener"],
    ["padre", /(^|\.)padre\.gg$/, "Padre"],
    ["photon", /tinyastro\.io$/, "Photon"],
    ["bullx", /(^|\.)bullx\.io$/, "BullX"],
    ["x", /(^|\.)(x|twitter)\.com$/, "X"],
  ];
  const SITE = SITES.find(([, re]) => re.test(host)) || ["page", null, host];
  const IS_X = SITE[0] === "x";

  const TEXT = { clean: "Clean", watch: "Watch", bundled: "Bundled", scan: "Scanning", none: "No read", idle: "Scan" };
  // Le symbole de chaque verdict, en pixels, identique à celui du site : un point seul, un point cerclé, trois points groupés `[F-092]`
  const GLYPH = {
    clean: [".......", "..XXX..", ".XXXXX.", ".XXXXX.", ".XXXXX.", "..XXX..", "......."],
    watch: ["..XXX..", ".X...X.", "X..X..X", "X.XXX.X", "X..X..X", ".X...X.", "..XXX.."],
    bundled: ["..XX...", "..XX...", ".......", "XX...XX", "XX...XX", ".......", "......."],
    scan: [".......", ".......", "..XXX..", "..XXX..", "..XXX..", ".......", "......."],
    none: [".......", ".......", ".......", ".XXXXX.", ".......", ".......", "......."],
    // pas encore lu : le V de Vigil, en pixels
    idle: ["X.....X", "X.....X", ".X...X.", ".X...X.", "..X.X..", "..X.X..", "...X..."],
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  function glyph(k) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "vgl-g");
    svg.setAttribute("viewBox", "0 0 7 7");
    svg.setAttribute("aria-hidden", "true");
    GLYPH[k].forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== "X") return;
        const r = document.createElementNS(SVG_NS, "rect");
        r.setAttribute("x", x);
        r.setAttribute("y", y);
        r.setAttribute("width", 1);
        r.setAttribute("height", 1);
        svg.appendChild(r);
      }),
    );
    return svg;
  }
  const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "");

  // --- transport : service worker de l'extension, ou appel direct dans la page de test ---
  const hasExt = typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  const TEST_API = window.__VIGIL_API || "https://vigil-eight-ecru.vercel.app";
  let dead = false;
  function send(msg) {
    if (dead) return Promise.resolve({});
    if (hasExt) {
      // extension rechargée ou mise à jour pendant que la page est ouverte : on s'arrête proprement
      if (!chrome.runtime?.id) return die(), Promise.resolve({});
      return new Promise((res) => {
        try {
          chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? {} : r || {}));
        } catch {
          die();
          res({});
        }
      });
    }
    const get = (p, ms) => fetch(TEST_API + p, { signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (msg.type === "verdicts") return get(`/api/lens?a=${msg.addrs.join(",")}${msg.peek ? "&peek=1" : ""}`, 12000).then((j) => j?.results || {});
    if (msg.type === "detail") return Promise.all([get(`/api/radar/${msg.mint}`, 15000), get(`/api/scan/${msg.mint}?depth=quick`, 15000)]).then(([radar, scan]) => ({ radar, scan }));
    if (msg.type === "open") return window.open(`${TEST_API}/token/${msg.mint}`, "_blank", "noopener"), Promise.resolve({});
    return Promise.resolve({});
  }
  const store = {
    get: (area, def) => (hasExt ? chrome.storage[area].get(def).catch(() => ({ ...def })) : Promise.resolve({ ...def })),
    set: (area, obj) => {
      if (hasExt && chrome.runtime?.id) chrome.storage[area].set(obj).catch(() => {});
    },
  };

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
  // Le serveur trie ensuite token / paire ; une adresse qui n'est ni l'un ni l'autre est simplement ignorée.
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
    if (!href || href[0] === "#" || href.startsWith("javascript:")) return null;
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

  // --- état ---
  const state = new Map(); // adresse -> { d (réponse de l'API), at, failed }
  const retry = new Map(); // adresse -> { n, t } : prochain essai pour un scan en cours ou un réseau coupé
  const wanted = new Set();
  const inflight = new Set();
  const mounts = new Set(); // { addr, anchor, badge, place }
  const visible = new Set(); // badges à l'écran (ou presque)
  const REFRESH = 150_000; // un verdict connu est relu toutes les 2 min 30 (un Watch peut devenir Bundled)
  const MAX_TRIES = 40; // ~8 min de scan sans réponse : on affiche « No read »
  let running = false;
  let autoScan = false; // réglage « Scan every token automatically » (coupé par défaut) `[F-094]`
  const chosen = new Set(); // tokens qu'on a cliqués : lus, puis relus quand ils réapparaissent (gardés entre les pages)
  let pageAddr = null; // token de la page en cours (pump.fun/coin/…, Axiom /meme/…) : lu d'office, c'est déjà un choix

  const wantsRead = (a) => autoScan || chosen.has(a) || a === pageAddr;
  function kindOf(a) {
    const s = state.get(a);
    if (s?.d?.verdict) return s.d.verdict;
    if (s?.failed) return "none";
    return wantsRead(a) ? "scan" : "idle";
  }
  function choose(a) {
    if (!a || chosen.has(a)) return;
    chosen.add(a);
    retry.delete(a);
    if (state.get(a)?.failed) state.delete(a);
    store.set("local", { chosen: [...chosen].slice(-400) });
  }

  // --- badges ---
  function paint(el) {
    const k = kindOf(el.dataset.vglAddr);
    if (el.dataset.v === k) return;
    el.dataset.v = k;
    el.className = `vgl-b vgl-${k}${el.classList.contains("vgl-abs") ? " vgl-abs" : ""}`;
    const t = document.createElement("span");
    t.className = "vgl-t";
    t.textContent = TEXT[k];
    el.replaceChildren(glyph(k), t);
    el.setAttribute("aria-label", `Vigil: ${TEXT[k]}`);
  }
  function drop(m) {
    mounts.delete(m);
    io.unobserve(m.badge);
    visible.delete(m.badge);
    m.badge.remove();
  }
  function paintAddr(a) {
    const s = state.get(a);
    for (const m of [...mounts]) {
      if (m.addr !== a) continue;
      if (s && s.d && s.d.mint === null) drop(m); // pas un token (wallet, programme…) : pas de badge
      else if (m.solo && s?.d?.mint && s.d.mint === pageMint()) drop(m); // le token de la page : le panneau suffit
      else paint(m.badge);
    }
    if (hoverEl && hoverEl.dataset.vglAddr === a) showTip(hoverEl);
  }
  function mount(addr, anchor, place, solo = false) {
    const s = state.get(addr);
    if (s && s.d && s.d.mint === null) return;
    const badge = document.createElement("span");
    badge.className = "vgl-b";
    badge.dataset.vglAddr = addr;
    badge.setAttribute("role", "button");
    paint(badge);
    const m = { addr, anchor, badge, place, solo };
    mounts.add(m);
    place(badge);
    io.observe(badge);
  }

  // Ne demander que les tokens à l'écran : les listes de 200 lignes ne coûtent que ce qu'on regarde
  const io = new IntersectionObserver(
    (entries) => {
      let any = false;
      for (const e of entries) {
        if (e.isIntersecting) {
          visible.add(e.target);
          need(e.target.dataset.vglAddr, Date.now());
          peekLater(e.target.dataset.vglAddr);
          any = true;
        } else visible.delete(e.target);
      }
      if (any) flushSoon();
    },
    { rootMargin: "300px 0px" },
  );

  function need(a, now) {
    if (!a || inflight.has(a) || !wantsRead(a)) return;
    const s = state.get(a);
    if (s && s.d && s.d.mint === null) return;
    if (s && s.failed) return;
    if (s && s.d && s.d.verdict && now - s.at < REFRESH) return;
    const r = retry.get(a);
    if (r && now < r.t) return;
    wanted.add(a);
  }
  // Lecture légère des tokens à l'écran, sans scan : écarte les wallets (pas de marque) et montre tout de suite
  // les verdicts que Vigil connaît déjà. Le vrai scan n'a lieu qu'au clic `[F-094]`
  const peeked = new Set(), peekWanted = new Set();
  let peekTimer = null;
  function peekLater(a) {
    if (!a || peeked.has(a) || state.has(a) || wantsRead(a)) return;
    peekWanted.add(a);
    if (!peekTimer) peekTimer = setTimeout(peekFlush, 250);
  }
  async function peekFlush() {
    peekTimer = null;
    if (dead || !peekWanted.size) return;
    const addrs = [...peekWanted].slice(0, 30);
    for (const a of addrs) {
      peekWanted.delete(a);
      peeked.add(a);
    }
    const res = await send({ type: "verdicts", addrs, peek: true });
    const now = Date.now();
    for (const a of addrs) {
      const d = res && res[a];
      if (!d || state.get(a)?.d?.verdict) continue;
      if (d.mint === null || d.verdict || !state.has(a)) state.set(a, { d, at: now });
      paintAddr(a);
    }
    statsSoon();
    if (peekWanted.size) peekTimer = setTimeout(peekFlush, 250);
  }
  let flushTimer = null;
  function flushSoon() {
    if (!flushTimer && wanted.size) flushTimer = setTimeout(flush, 120);
  }
  async function flush() {
    flushTimer = null;
    if (!wanted.size || dead) return;
    const addrs = [...wanted].slice(0, 30);
    for (const a of addrs) {
      wanted.delete(a);
      inflight.add(a);
    }
    const res = await send({ type: "verdicts", addrs });
    const now = Date.now();
    for (const a of addrs) {
      inflight.delete(a);
      const d = res && res[a];
      const prev = state.get(a);
      if (d && (d.mint === null || d.verdict)) {
        state.set(a, { d, at: now });
        retry.delete(a);
      } else {
        // scan en cours, ou serveur injoignable : on réessaie, de plus en plus lentement
        if (d) state.set(a, { d, at: now });
        const n = (retry.get(a)?.n || 0) + 1;
        if (n > MAX_TRIES && !prev?.d?.verdict) state.set(a, { d: d || prev?.d || null, at: now, failed: true });
        // un token cliqué est relu toutes les 1,5 s : le verdict arrive dès que le scan finit
        else retry.set(a, { n, t: now + (chosen.has(a) || a === pageAddr ? (n < 10 ? 1500 : n < 16 ? 4000 : 12000) : n < 4 ? 3000 : n < 10 ? 6000 : 15000) });
      }
      paintAddr(a);
    }
    if (panelAddr && addrs.includes(panelAddr)) renderPanel();
    if (pageAddr && addrs.includes(pageAddr)) for (const m of [...mounts]) if (m.solo && state.get(m.addr)?.d?.mint === pageMint()) drop(m);
    statsSoon();
    flushSoon();
  }

  // --- survol et clic : on teste nous-mêmes la position des badges ---
  // Les sites posent souvent un calque cliquable par-dessus leurs lignes (pump.fun, Padre…) : le badge ne reçoit
  // alors ni le survol ni le clic. On suit la souris et on vérifie qu'aucun menu du site ne recouvre le badge.
  function cardOf(el) {
    let c = el.parentElement;
    for (let i = 0; i < 16 && c && c !== document.body; i++, c = c.parentElement) {
      if (c.offsetHeight >= 48 && c.offsetHeight <= 260 && c.offsetWidth >= 200) return c;
    }
    return null;
  }
  function hitAt(x, y) {
    for (const el of visible) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2) continue;
      const top = document.elementFromPoint(Math.min(Math.max(x, r.left + 1), r.right - 1), Math.min(Math.max(y, r.top + 1), r.bottom - 1));
      if (!top) return null;
      if (top === el || el.contains(top) || top.contains(el)) return el;
      const card = cardOf(el);
      if (card && card.contains(top)) return el; // calque de la ligne elle-même
      return null; // un menu ou une fenêtre du site passe devant : on ne vole pas le clic
    }
    return null;
  }
  let tip = null, hoverEl = null, hoverQueued = false, mx = -1, my = -1;
  function showTip(el) {
    const s = state.get(el.dataset.vglAddr);
    const k = kindOf(el.dataset.vglAddr);
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "vgl-tip";
      tip.setAttribute("role", "tooltip");
    }
    if (!tip.isConnected) document.documentElement.appendChild(tip);
    const b = document.createElement("b");
    const lines = [];
    if (k === "idle") {
      b.textContent = "Vigil · Click to scan this token";
      lines.push("Reads this launch only: the first ten seconds of buys, the dev's past launches, who funded the first wallets. A few seconds.");
    } else if (k === "scan") {
      b.textContent = "Vigil is reading this token…";
      lines.push("Launch wallets, the dev's past launches, who funded the first buyers.");
    } else if (k === "none") {
      b.textContent = "Vigil · No read yet";
      lines.push("Not enough on-chain activity to judge this launch. Vigil keeps trying.");
    } else {
      b.textContent = `Vigil · ${TEXT[k]}${s.d.symbol ? ` · ${s.d.symbol}` : ""}`;
      b.className = `vgl-${k}`;
      if (s.d.reason) lines.push(s.d.reason);
      lines.push("Click for the numbers and the exit radar. Ctrl+click opens the full scan.");
    }
    tip.replaceChildren(b, ...lines.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
    tip.style.display = "block";
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    tip.style.left = Math.round(Math.min(window.innerWidth - tr.width - 8, Math.max(8, r.left))) + "px";
    tip.style.top = Math.round(r.bottom + 8 + tr.height > window.innerHeight - 8 ? r.top - tr.height - 8 : r.bottom + 8) + "px";
  }
  function hideTip() {
    if (tip) tip.style.display = "none";
  }
  function checkHover() {
    hoverQueued = false;
    const hit = running ? hitAt(mx, my) : null;
    if (hit !== hoverEl) {
      if (hoverEl) delete hoverEl.dataset.hot;
      if (hit) hit.dataset.hot = "1";
      hoverEl = hit;
      if (hit) showTip(hit);
      else hideTip();
    }
  }
  const onMove = (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!hoverQueued && visible.size) {
      hoverQueued = true;
      requestAnimationFrame(checkHover);
    }
  };
  const onScroll = () => {
    if (hoverEl) {
      delete hoverEl.dataset.hot;
      hoverEl = null;
      hideTip();
    }
  };
  // Clic sur une marque : on lit CE token et on ouvre son panneau ; la ligne du site ne reçoit pas le clic.
  // Ctrl+clic ou clic molette : le scan complet dans un nouvel onglet.
  const onPress = (e) => {
    if (!running || !visible.size || (e.button !== undefined && e.button > 1)) return;
    const el = hitAt(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "click" && e.type !== "auxclick") return;
    const a = el.dataset.vglAddr;
    const mint = state.get(a)?.d?.mint;
    if ((e.type === "auxclick" || e.ctrlKey || e.metaKey) && mint && IS_B58.test(mint)) return send({ type: "open", mint });
    choose(a);
    paintAddr(a);
    need(a, Date.now());
    flushSoon();
    openPanel(a);
    statsSoon();
  };

  // --- parcours de la page ---
  // Le nom du token dans une ligne ou une carte : on pose le badge juste après (lisible, ne cache aucun chiffre)
  function nameIn(box) {
    if (!box) return null;
    const leaf = (el) => {
      if (!el.childElementCount) return el;
      for (const x of el.querySelectorAll("*")) if (!x.childElementCount && x.textContent.trim()) return x;
      return el;
    };
    for (const sel of ["[data-coin-symbol]", "[data-coin-name]", "[data-testid*='symbol']", "[data-testid*='name']"]) {
      const el = box.querySelector(sel);
      if (el && !el.closest(".vgl-b")) return leaf(el);
    }
    for (const el of box.querySelectorAll("span, b, strong, p, div, h2, h3, h4")) {
      if (el.childElementCount || el.closest(".vgl-b")) continue;
      const t = el.textContent.trim();
      // pas un prix, un pourcentage, une durée ("12m") ni une adresse abrégée ("GXVF...pump")
      if (t.length >= 1 && t.length <= 40 && !/^[$\d.,%+\-−~<>KMB ]+$/.test(t) && !/^\d+\s?[smhdw]$/.test(t) && !/\.\.\.|…/.test(t)) return el;
    }
    return null;
  }
  const placeAfter = (name) => (badge) => {
    badge.classList.remove("vgl-abs");
    name.insertAdjacentElement("afterend", badge);
  };
  const placeCorner = (box) => (badge) => {
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    badge.classList.add("vgl-abs");
    box.appendChild(badge);
  };
  // Pose dans une carte : après le nom s'il est trouvé (relu à chaque fois, le site peut avoir redessiné la ligne)
  const placeInCard = (card) => (badge) => {
    const name = nameIn(card);
    if (name) placeAfter(name)(badge);
    else placeCorner(card)(badge);
  };
  function placeLink(a) {
    return (badge) => {
      const big = a.offsetHeight >= 40 && a.offsetWidth > 140;
      // lien réduit à l'image du token (Padre, Photon, posts pump.fun…) : badge après le nom le plus proche
      if (!big && isImgLink(a)) {
        const near = nearName(a);
        if (near) return placeAfter(near.name)(badge);
      }
      if (!big) return placeAfter(a)(badge);
      // ligne ou carte entière cliquable : après le nom du token, sinon en haut à droite
      const empty = !a.textContent.trim() && !a.querySelector("img");
      const name = nameIn(a) || (empty ? nameIn(a.parentElement) : null);
      if (name) return placeAfter(name)(badge);
      placeCorner(a)(badge);
    };
  }
  const isImgLink = (a) => !!a.querySelector("img") && a.textContent.trim().length <= 4;
  // Le nom le plus proche d'un lien-image : on remonte parent par parent (un post qui cite un token a deux noms :
  // celui de l'auteur, loin, et celui du token, tout près de l'image)
  function nearName(a) {
    let box = a.parentElement;
    for (let i = 0; i < 8 && box && box !== document.body; i++, box = box.parentElement) {
      if (box.offsetHeight > 260) break;
      for (const el of box.querySelectorAll("span, b, strong, p, div, h2, h3, h4, a")) {
        if (el.childElementCount || a.contains(el) || el.closest(".vgl-b")) continue;
        const t = el.textContent.trim();
        if (t.length >= 1 && t.length <= 40 && !/^[$\d.,%+\-−~<>KMB ]+$/.test(t) && !/^\d+\s?[smhdw]$/.test(t) && !/\.\.\.|…/.test(t)) return { name: el, box };
      }
    }
    return null;
  }
  const hasBadge = (box, addr) => !!box && !!box.querySelector(`.vgl-b[data-vgl-addr="${addr}"]`);

  function scanLinks() {
    for (const a of document.querySelectorAll("a[href]:not([data-vgl])")) {
      a.setAttribute("data-vgl", "1");
      const addr = addrFromHref(a.getAttribute("href"));
      if (!addr) continue;
      // pas de badge sur les liens vers la page en cours hors des listes (le panneau s'en charge)
      if (addr === pageAddr && !a.closest("table, [role=row], li")) continue;
      // liens vides : on ignore les petites icônes, mais on garde les liens posés sur toute une ligne (listes pump.fun)
      const empty = !a.textContent.trim() && !a.querySelector("img");
      if (empty && !(a.offsetHeight >= 40 && a.offsetWidth > 140)) continue;
      // calque vide sur tout un post (callouts pump.fun) qui contient déjà un vrai lien vers le même token : on laisse ce lien-là
      if (empty && [...(a.parentElement?.querySelectorAll("a[href]") || [])].some((o) => o !== a && (o.textContent.trim() || o.querySelector("img")) && addrFromHref(o.getAttribute("href")) === addr)) continue;
      if (hasBadge(cardOf(a), addr)) continue; // déjà un badge pour ce token dans la carte
      if (isImgLink(a) && hasBadge(nearName(a)?.box, addr)) continue;
      mount(addr, a, placeLink(a), !a.closest("table, [role=row], li"));
    }
  }
  // Terminaux dont les lignes ne sont pas des liens (Axiom Pulse…) : l'adresse du token est souvent dans l'URL de son image
  const IMG_HOSTS = /(axiom\.trade|padre\.gg|tinyastro\.io|bullx\.io|gmgn\.ai)$/;
  function scanImages() {
    if (!IMG_HOSTS.test(host) && !window.__VIGIL_API) return;
    for (const img of document.querySelectorAll("img[src]:not([data-vgl])")) {
      img.setAttribute("data-vgl", "1");
      const m = (img.getAttribute("src") || "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!m || !IS_B58.test(m[0]) || img.closest("a[data-vgl]")) continue;
      if (img.width && img.width > 120) continue; // pas les grandes images (bannières)
      const card = cardOf(img);
      if (!card || hasBadge(card, m[0])) continue;
      mount(m[0], img, placeInCard(card));
    }
  }
  // Lignes qui portent l'adresse du token dans un attribut (GMGN Trenches : data-trenches-token-address, etc.)
  const ATTRS = ["data-trenches-token-address", "data-token-address", "data-mint", "data-ca", "data-address"];
  const ATTR_SEL = ATTRS.map((x) => `[${x}]:not([data-vgl])`).join(",");
  function scanAttrRows() {
    for (const row of document.querySelectorAll(ATTR_SEL)) {
      row.setAttribute("data-vgl", "1");
      const v = ATTRS.map((x) => row.getAttribute(x)).find(Boolean) || "";
      if (!IS_B58.test(v) || row.offsetHeight < 24 || row.closest("a[data-vgl]") || hasBadge(row, v)) continue;
      // une adresse de wallet sera écartée par le serveur (ce n'est pas un token) et le badge retiré
      mount(v, row, placeInCard(row));
    }
  }
  // X : CA écrits en clair dans les tweets
  function scanTweets() {
    if (!IS_X && !window.__VIGIL_API) return;
    for (const b of document.querySelectorAll('[data-testid="tweetText"]:not([data-vgl])')) {
      b.setAttribute("data-vgl", "1");
      const found = [...new Set((b.textContent.match(B58) || []).filter((x) => IS_B58.test(x) && /[a-z]/.test(x) && /[A-Z0-9]/.test(x)))];
      for (const addr of found.slice(0, 3)) mount(addr, b, (badge) => b.appendChild(badge));
    }
  }
  // Le site a redessiné une ligne : on remet le badge ; la ligne a disparu : on oublie le badge
  function repair() {
    for (const m of [...mounts]) {
      if (!m.anchor.isConnected) drop(m);
      else if (!m.badge.isConnected) m.place(m.badge);
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer || !running) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!running) return;
      try {
        checkPage();
        scanLinks();
        scanAttrRows();
        scanImages();
        scanTweets();
        repair();
        statsSoon();
      } catch (e) {
        console.debug("[Vigil]", e);
      }
    }, 300);
  }
  const ours = (n) => n.nodeType === 1 && (n.classList.contains("vgl-b") || n.classList.contains("vgl-tip") || n.id === "vgl-panel");
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.target.nodeType === 1 && m.target.closest && m.target.closest(".vgl-b, #vgl-panel")) continue;
      if ([...m.addedNodes].every(ours) && [...m.removedNodes].every(ours)) continue;
      return scheduleScan();
    }
  });

  // --- thème du site : badges lisibles sur fond clair comme sur fond sombre ---
  function detectTheme() {
    let el = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight / 2, 400));
    // aucun fond posé par le site : c'est le fond par défaut du navigateur, blanc sauf si la page se déclare sombre
    let lum = /dark/.test(getComputedStyle(document.documentElement).colorScheme || "") ? 0 : 1;
    for (; el && el.nodeType === 1; el = el.parentElement) {
      if (el.id === "vgl-panel") continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m || (m.length > 3 && +m[3] < 0.5)) continue;
      lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
      break;
    }
    const t = lum > 0.55 ? "light" : "dark";
    if (document.documentElement.dataset.vglTheme !== t) document.documentElement.dataset.vglTheme = t;
  }

  // --- compteurs pour la fenêtre de l'extension et l'icône (nombre de Bundled à l'écran) ---
  function stats() {
    const c = { clean: 0, watch: 0, bundled: 0, scan: 0, none: 0, idle: 0 };
    const seen = new Set();
    for (const m of mounts) {
      if (seen.has(m.addr) || !m.anchor.isConnected) continue;
      seen.add(m.addr);
      c[kindOf(m.addr)]++;
    }
    return c;
  }
  let statsTimer = null, lastStats = "";
  function statsSoon() {
    if (statsTimer || !hasExt) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      const c = running ? stats() : { bundled: 0 };
      const key = JSON.stringify(c);
      if (key !== lastStats) {
        lastStats = key;
        send({ type: "stats", c });
      }
    }, 800);
  }

  // --- panneau flottant sur la page d'un token ---
  let panelAddr = null, panelHost = null, panelRoot = null, lastPath = "", panelMin = false, panelClosed = false;
  const detailCache = new Map(); // mint -> { det, at }
  const PANEL_CSS = `
    :host{all:initial}
    .p{width:300px;box-sizing:border-box;font:500 12.5px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#F3EEF9;
       background:rgba(11,10,15,.97);border:1px solid #2A1E34;border-left:3px solid var(--c);border-radius:14px;padding:14px;box-shadow:0 20px 50px -18px #000}
    .p[data-v=clean]{--c:#2EF0C8}.p[data-v=watch]{--c:#FFB21F}.p[data-v=bundled]{--c:#FF4D4D}.p[data-v=scan],.p[data-v=none]{--c:#BE80FF}
    .p.min{width:auto;padding:8px 12px}.p.min .body{display:none}
    .h{display:flex;align-items:center;gap:8px;cursor:grab;user-select:none}.h:active{cursor:grabbing}.h b{font-size:13px}
    .logo{width:16px;height:14px;flex:none}
    .v{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-weight:700;color:var(--c);
       background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
    .v svg{width:8px;height:8px;fill:currentColor;shape-rendering:crispEdges}
    .p[data-v=scan] .v svg{animation:pl 1s steps(2) infinite}@keyframes pl{50%{opacity:.25}}
    button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
    .mn{margin-left:auto;color:#9A8BAE;width:22px;height:22px;border-radius:6px}.mn:hover,.cl:hover{background:#1A1420;color:#F3EEF9}
    .cl{color:#9A8BAE;width:22px;height:22px;border-radius:6px;font-size:11px}
    .tk{display:flex;align-items:center;gap:8px;margin-top:10px;color:#9A8BAE}.tk .sym{color:#F3EEF9;font-weight:700}
    .ca{margin-left:auto;font:500 11px ui-monospace,Consolas,monospace;color:#9A8BAE;border:1px solid #2A1E34;border-radius:7px;padding:2px 7px}.ca:hover{color:#F3EEF9;border-color:#4A3460}
    .r{color:#C9BEDA;margin:8px 0 0}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
    .g div{background:#000;border:1px solid #2A1E34;border-radius:9px;padding:7px 9px}.g span{display:block;color:#9A8BAE;font-size:11px}.g strong{font-size:13px}
    .ra{margin-top:10px;padding:8px 10px;border-radius:9px;background:#151019}.ra b{color:var(--c)}.ra:empty{display:none}
    .o{display:block;width:100%;margin-top:12px;text-align:center;padding:9px;border-radius:10px;color:#fff;font-weight:700;
       background:linear-gradient(135deg,#9232F1,#BC33C9 50%,#F22C7B)}.o:disabled{opacity:.45;cursor:default}
    .ft{margin-top:8px;color:#6E6380;font-size:10.5px;text-align:center}`;
  function ensurePanel() {
    if (panelHost) {
      if (!panelHost.isConnected) document.documentElement.appendChild(panelHost);
      return;
    }
    panelHost = document.createElement("div");
    panelHost.id = "vgl-panel";
    panelHost.hidden = true;
    panelRoot = panelHost.attachShadow({ mode: "open" });
    // feuille construite : jamais bloquée par la CSP du site, contrairement à une balise <style>
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      panelRoot.adoptedStyleSheets = [sheet];
    } catch {
      const st = document.createElement("style");
      st.textContent = PANEL_CSS;
      panelRoot.appendChild(st);
    }
    const p = document.createElement("div");
    p.className = "p";
    p.innerHTML = `
      <div class="h">
        <svg class="logo" viewBox="0 0 100 84" aria-hidden="true"><defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9232F1"/><stop offset="1" stop-color="#F22C7B"/></linearGradient></defs><path d="M0 0 L50 84 L100 0 C80 9 60 27 50 50 C40 27 20 9 0 0 Z" fill="url(#vg)"/></svg>
        <b>Vigil</b><span class="v"></span>
        <button class="mn" type="button"></button><button class="cl" type="button" title="Close">✕</button>
      </div>
      <div class="body">
        <div class="tk"><span class="sym"></span><button class="ca" type="button" title="Copy the contract address"></button></div>
        <p class="r"></p>
        <div class="g"></div>
        <div class="ra"></div>
        <button class="o" type="button">Open the full scan →</button>
        <div class="ft">Read-only · facts from the chain, not financial advice</div>
      </div>`;
    panelRoot.appendChild(p);
    const $ = (s) => panelRoot.querySelector(s);
    $(".mn").addEventListener("click", () => {
      panelMin = !panelMin;
      store.set("local", { panelMin });
      renderPanel();
    });
    $(".cl").addEventListener("click", () => {
      panelClosed = true;
      renderPanel();
    });
    $(".ca").addEventListener("click", () => {
      const mint = state.get(panelAddr)?.d?.mint;
      if (!mint) return;
      navigator.clipboard?.writeText(mint).then(() => {
        $(".ca").textContent = "Copied";
        setTimeout(() => renderPanel(), 1200);
      }).catch(() => {});
    });
    $(".o").addEventListener("click", () => {
      const mint = state.get(panelAddr)?.d?.mint;
      if (mint && IS_B58.test(mint)) send({ type: "open", mint });
    });
    // le panneau se déplace (il ne doit jamais cacher le bouton d'achat d'un terminal) et garde sa place
    let drag = null;
    $(".h").addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = panelHost.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      $(".h").setPointerCapture(e.pointerId);
    });
    $(".h").addEventListener("pointermove", (e) => {
      if (!drag) return;
      placePanel(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    $(".h").addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      const r = panelHost.getBoundingClientRect();
      store.set("local", { panelPos: { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
    });
    document.documentElement.appendChild(panelHost);
    store.get("local", { panelPos: null, panelMin: false }).then(({ panelPos, panelMin: mn }) => {
      panelMin = !!mn;
      if (panelPos) placePanel(panelPos.x * window.innerWidth, panelPos.y * window.innerHeight);
      renderPanel();
    });
  }
  function placePanel(x, y) {
    const r = panelHost.getBoundingClientRect();
    const w = r.width || 300, h = r.height || 200;
    panelHost.style.left = Math.round(Math.min(Math.max(8, x), window.innerWidth - w - 8)) + "px";
    panelHost.style.top = Math.round(Math.min(Math.max(8, y), window.innerHeight - h - 8)) + "px";
    panelHost.style.right = "auto";
    panelHost.style.bottom = "auto";
  }
  const pageMint = () => (pageAddr ? state.get(pageAddr)?.d?.mint || pageAddr : null);
  function checkPage() {
    const path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    pageAddr = IS_X ? null : addrFromUrl(new URL(location.href));
    // nouvelle page : le panneau montre le token de la page (s'il y en a un)
    panelAddr = pageAddr;
    panelClosed = false;
    if (!panelAddr) {
      if (panelHost) panelHost.hidden = true;
      return;
    }
    ensurePanel();
    renderPanel();
    need(panelAddr, Date.now());
    flushSoon();
  }
  function openPanel(a) {
    panelAddr = a;
    panelClosed = false;
    ensurePanel();
    renderPanel();
  }
  function renderPanel() {
    if (!panelRoot) return;
    const s = panelAddr ? state.get(panelAddr) : null;
    // page d'un wallet, d'un programme… : ce n'est pas un token, pas de panneau
    if (!panelAddr || !running || panelClosed || (s && s.d && s.d.mint === null)) {
      panelHost.hidden = true;
      return;
    }
    panelHost.hidden = false;
    const $ = (q) => panelRoot.querySelector(q);
    const k = kindOf(panelAddr), d = s?.d;
    const p = $(".p");
    p.dataset.v = k;
    p.classList.toggle("min", panelMin);
    $(".mn").textContent = panelMin ? "▴" : "▾";
    $(".mn").title = panelMin ? "Expand" : "Minimize";
    $(".v").replaceChildren(glyph(k), document.createTextNode(k === "scan" ? "Scanning…" : TEXT[k]));
    $(".sym").textContent = d?.symbol ? `$${d.symbol}` : "";
    if ($(".ca").textContent !== "Copied") $(".ca").textContent = d?.mint ? `${short(d.mint)} ⧉` : "";
    $(".ca").hidden = !d?.mint;
    $(".r").textContent =
      k === "scan" ? "Reading the launch wallets, the dev's history and who funded the first buyers…"
      : k === "none" ? "Not enough on-chain activity to judge this launch yet."
      : d?.reason || "";
    $(".o").disabled = !d?.mint;
    if (panelMin || !d?.mint) {
      if (!d?.mint) fillDetail(null);
      return;
    }
    const c = detailCache.get(d.mint);
    fillDetail(c?.det || null);
    if (c && Date.now() - c.at < 20000) return;
    if (c?.loading) return;
    detailCache.set(d.mint, { ...(c || {}), loading: true, at: c?.at || 0 });
    const forAddr = panelAddr;
    send({ type: "detail", mint: d.mint }).then((det) => {
      detailCache.set(d.mint, { det: det && (det.radar || det.scan) ? det : c?.det || null, at: Date.now() });
      // le scan rapide renvoie déjà le verdict : on l'affiche sans attendre la prochaine relance
      const sc = det?.scan;
      if (sc?.verdict && !state.get(forAddr)?.d?.verdict) {
        const prev = state.get(forAddr)?.d || {};
        state.set(forAddr, { d: { ...prev, mint: d.mint, verdict: sc.verdict, reason: sc.reason, depth: sc.depth, pending: false, symbol: prev.symbol || sc.market?.symbol || null }, at: Date.now() });
        retry.delete(forAddr);
        paintAddr(forAddr);
        renderPanel();
        statsSoon();
      }
      if (state.get(panelAddr)?.d?.mint === d.mint) fillDetail(detailCache.get(d.mint).det);
    });
  }
  function fillDetail(det) {
    const g = panelRoot.querySelector(".g"), ra = panelRoot.querySelector(".ra");
    const num = (x) => typeof x === "number" && isFinite(x);
    const pct = (x) => (num(x) ? `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%` : "–");
    const r = det?.radar, sig = det?.scan?.signals || {};
    const launches = sig.gmgn?.devLaunches ?? sig.devMemory?.launches7d;
    const cells = [
      // Les 10 premières secondes ne sont tracées qu'au scan complet : en attendant, le plus gros wallet
      sig.early10s?.traced ? ["Bought in first 10 s", pct(sig.early10s.pct)] : ["Biggest wallet", pct(sig.topWallet?.pct)],
      ["Dev's past launches", num(launches) ? String(launches) : "–"],
      ["Top 10 wallets", pct(sig.top10Pct)],
      ["Launch wallets still hold", num(r?.stillHeldShare) ? `${Math.round(r.stillHeldShare * 100)}% of buy` : det ? "–" : "reading…"],
    ];
    g.replaceChildren(
      ...cells.map(([label, value]) => {
        const box = document.createElement("div");
        box.append(Object.assign(document.createElement("span"), { textContent: label }), Object.assign(document.createElement("strong"), { textContent: value }));
        return box;
      }),
    );
    ra.replaceChildren();
    if (r?.headline) ra.append(Object.assign(document.createElement("b"), { textContent: "Exit radar" }), ` · ${r.headline}`);
  }

  // --- horloge : relances, verdicts à rafraîchir, navigation interne, thème ---
  let tickN = 0, tickTimer = null;
  function tick() {
    if (!running || dead) return;
    if (location.pathname + location.search !== lastPath) scheduleScan();
    if (document.hidden) return;
    tickN++;
    const now = Date.now();
    for (const el of visible) need(el.dataset.vglAddr, now);
    if (panelAddr) need(panelAddr, now);
    flushSoon();
    if (tickN % 4 === 1) detectTheme();
    if (tickN % 20 === 0 && panelAddr && !panelMin) renderPanel(); // le radar de sortie bouge : relu toutes les 20 s
    if (tickN % 10 === 0) repair();
  }

  // --- marche / arrêt (réglages de la fenêtre de l'extension, site par site) ---
  function start() {
    if (running || dead) return;
    running = true;
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("mousemove", onMove, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("blur", onScroll);
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) window.addEventListener(t, onPress, true);
    tickTimer = setInterval(tick, 1000);
    detectTheme();
    lastPath = "";
    scheduleScan();
  }
  function stop() {
    if (!running) return;
    running = false;
    mo.disconnect();
    clearInterval(tickTimer);
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("blur", onScroll);
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) window.removeEventListener(t, onPress, true);
    for (const m of [...mounts]) drop(m);
    for (const el of document.querySelectorAll("[data-vgl]")) el.removeAttribute("data-vgl");
    hideTip();
    if (panelHost) panelHost.hidden = true;
    statsSoon();
  }
  function die() {
    if (dead) return;
    stop();
    dead = true;
    io.disconnect();
  }
  const DEF = { enabled: true, off: [], showClean: true, autoScan: false };
  function apply(s) {
    if (dead) return;
    document.documentElement.toggleAttribute("data-vgl-noclean", s.showClean === false);
    if (!!s.autoScan !== autoScan) {
      autoScan = !!s.autoScan;
      for (const m of mounts) paint(m.badge);
      const now = Date.now();
      for (const el of visible) need(el.dataset.vglAddr, now);
      flushSoon();
      statsSoon();
    }
    const on = s.enabled !== false && !(s.off || []).includes(SITE[0]);
    if (on) start();
    else stop();
  }
  store.get("local", { chosen: [] }).then(({ chosen: c }) => {
    for (const a of c || []) if (IS_B58.test(a)) chosen.add(a);
    store.get("sync", DEF).then(apply);
  });
  if (hasExt) {
    chrome.storage.onChanged.addListener((_c, area) => {
      if (area === "sync" && chrome.runtime?.id) store.get("sync", DEF).then(apply);
    });
    // la fenêtre de l'extension demande ce que Vigil voit sur cette page
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg?.type !== "page") return false;
      const t = panelAddr ? state.get(panelAddr) : null;
      reply({ site: SITE[0], siteName: SITE[2], running, autoScan, stats: stats(), token: t?.d?.mint ? { mint: t.d.mint, symbol: t.d.symbol, kind: kindOf(panelAddr), reason: t.d.reason } : null });
      return false;
    });
  }
})();
