// ---------- utilitaires ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');
const nf = (n, d = 2) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sol = (n) => { const v = Number(n || 0); return nf(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 3); };
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${sol(Math.abs(n))}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const date = (t) => (t ? new Date(t * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (t) => new Date(t * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
function dur(s) {
  if (s == null) return '—';
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${nf(s / 3600, 1)} h`;
  return `${nf(s / 86400, 1)} j`;
}
// dernier token lancé par lui ou ses autres devs ; au-delà de 24 h il ne t'intéresse pas
function lastLaunch(r) {
  if (r.lastLaunchAt !== undefined) return r.lastLaunchAt;
  const times = [...(r.tokens || []), ...(r.after || []), ...(r.siblingTokens || [])].filter((t) => !t.groupBuy).map((t) => t.createdAt || 0).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}
function inactive(r) {
  const last = lastLaunch(r);
  if (!last) return null;
  const s = Date.now() / 1000 - last;
  return s > 86400 ? { last, days: Math.floor(s / 86400) } : null;
}
function ago(t) {
  if (!t) return '—';
  const s = Date.now() / 1000 - t;
  return s < 0 ? date(t) : `il y a ${dur(s)}`;
}
function usd(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `${nf(n / 1e6, 1)} M$`;
  if (n >= 1e3) return `${nf(n / 1e3, 1)} k$`;
  return `${nf(n, 0)} $`;
}
const addrHtml = (a, text) => `<span class="addr" data-copy="${esc(a)}" title="Copier ${esc(a)}">${esc(text || short(a))}</span><a class="ext" href="https://solscan.io/account/${esc(a)}" target="_blank" rel="noopener" title="Ouvrir sur Solscan">↗</a>`;
const badge = (color, text) => `<span class="badge ${color}"><i class="dot ${color}"></i>${esc(text)}</span>`;
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
  return body;
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
}
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 10, x + 14)}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
const hideTip = () => { tip.hidden = true; };

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-trace]');
  if (go) { $('#address').value = go.dataset.trace; $('#trace-form').requestSubmit(); return; }
  const a = e.target.closest('[data-copy]');
  if (a) {
    e.stopPropagation();
    const n = a.dataset.copy.split('\n').length;
    const what = a.dataset.copy.startsWith('Adresse :') ? 'Réglage copié' : /^[0-9.]+-[0-9.]+$/.test(a.dataset.copy) ? 'Plage copiée' : n > 1 ? `${n} adresses copiées` : 'Copié';
    navigator.clipboard?.writeText(a.dataset.copy).then(() => toast(what), () => toast('Copie impossible'));
  }
});

// ---------- statuts ----------
const STATUS = {
  rug: { color: 'red', label: 'Rug probable', help: 'Le dev a vendu au moins 80 % et le token est mort.' },
  exit: { color: 'amber', label: 'Dev sorti', help: 'Le dev a vendu au moins 80 %, le token vit encore.' },
  holding: { color: 'blue', label: 'Dev en position', help: 'Le dev détient encore ses tokens.' },
  moved: { color: 'purple', label: 'Tokens déplacés', help: 'Le dev a transféré ses tokens vers un autre wallet.' },
  'no-buy': { color: 'gray', label: 'Sans achat dev', help: 'Aucun achat repéré depuis les wallets du cluster.' },
  dead: { color: 'red', label: 'Mort', help: 'Market cap sous 15 000 $ : le token est mort.' },
  alive: { color: 'green', label: 'En vie', help: 'Le token a encore de la valeur.' },
};
const statusBadge = (s) => `<span title="${esc(STATUS[s]?.help || '')}">${badge(STATUS[s]?.color || 'gray', STATUS[s]?.label || s)}</span>`;

const TERMINAL = {
  exchange: (t) => ({ color: 'amber', text: `Exchange ${t.label}`, sub: 'La piste s\'arrête au hot wallet de l\'exchange.' }),
  service: (t) => ({ color: 'amber', text: t.label, sub: 'Service d\'échange : la piste s\'arrête ici.' }),
  busy: () => ({ color: 'amber', text: 'Wallet à très forte activité', sub: 'Plus de 10 000 transactions : exchange ou bot probable.' }),
  origin: () => ({ color: 'gray', text: 'Origine introuvable', sub: 'Aucun financement en SOL repéré au-dessus.' }),
  truncated: () => ({ color: 'gray', text: 'Historique trop long', sub: 'Plus de 10 000 transactions : le premier financement est hors de portée, seule son activité récente est analysée.' }),
  depth: () => ({ color: 'gray', text: 'Profondeur maximale atteinte', sub: 'Relance en mode Profonde pour remonter plus haut.' }),
  cycle: () => ({ color: 'gray', text: 'Boucle de financement', sub: 'Les wallets se financent en cercle.' }),
  mixer: () => ({ color: 'red', text: 'Mélangeur', sub: 'Wallet jetable qui mêle son SOL à d’autres : au-dessus, l’argent n’est plus le sien.' }),
};
const terminalInfo = (t) => (TERMINAL[t?.type] || TERMINAL.origin)(t || {});

const linkBadge = (l) => {
  if (!l) return '';
  if (l.type === 'deposit') return badge('amber', `Même dépôt ${l.exchange || 'exchange'}`);
  if (l.type === 'collects') return badge('purple', 'Wallet de collecte');
  return badge('purple', 'Même wallet de collecte');
};
const linkText = (l) => {
  if (l.type === 'deposit') return `Dépose sur la même adresse ${l.exchange || 'd\'exchange'} que le cluster : même compte.`;
  if (l.type === 'collects') return `Reçoit le SOL de ${plural(l.from.length, 'wallet', 'wallets')} du cluster.`;
  return 'Envoie son SOL au même wallet de collecte que le cluster.';
};
// pistes exchange assez solides pour compter comme candidats : wallet neuf, rien lancé, bon score
const leadCandidates = (r) => (r.leads || []).filter((l) => (l.type === 'fingerprint' ? l.status === 'waiting' && l.score >= 55 : l.fresh && !l.tokens && l.score >= 60));

// ---------- état ----------
// mise par trade : 0,15 SOL par défaut (la mise du user), gardée d'une visite à l'autre
const DEFAULT_BUY = 0.15;

const state = { config: null, result: null, tab: 'qualif', selected: null, sort: {}, es: null, preset: 'normal', lossCap: null, buySol: Number(localStorage.getItem('buySol')) > 0 ? Number(localStorage.getItem('buySol')) : DEFAULT_BUY };

// ---------- navigation ----------
function setView(name, crumb) {
  for (const v of ['trace', 'scan', 'list', 'wallet', 'real', 'watch', 'labels']) $(`#view-${v}`).hidden = v !== name;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  $('#crumb').innerHTML = crumb;
}

api('/api/solprice').then((j) => { state.solUsd = j.usd; }).catch(() => {});

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (state.es) { state.es.close(); state.es = null; }
  if (h === 'enquetes') { setView('list', '<span>Enquêtes</span>'); return renderList(); }
  if (h === 'recherche') return openScan();
  if (h === 'bilan') return openReal();
  if (h === 'wallet') return openWallet();
  if (h === 'surveillance') { location.hash = '#/exchange'; return; }
  if (h === 'exchange' || h.startsWith('exchange/')) { const st = h.slice('exchange/'.length); setView('watch', h === 'exchange' ? '<span>Snipe exchange</span>' : `<a href="#/exchange">Snipe exchange</a><span>Dossier</span>`); return renderExchange(h === 'exchange' ? null : st); }
  if (h === 'adresses') { setView('labels', '<span>Adresses connues</span>'); return renderLabels(); }
  if (h.startsWith('t/')) return openTrace(h.slice(2));
  setView('trace', '<span>Traque</span>');
  $('#progress').hidden = true;
  $('#result').innerHTML = '';
  $('#rpc-notice').hidden = state.config?.provider !== 'public';
  state.result = null;
}
window.addEventListener('hashchange', route);

async function refreshCount() {
  try {
    const list = await api('/api/investigations');
    const el = $('#inv-count');
    el.textContent = list.length;
    el.hidden = list.length === 0;
    return list;
  } catch { return []; }
}

// ---------- lancement d'une traque ----------
const PRESET_HINT = {
  rapide: 'Rapide : jusqu\'à 15 wallets. Filtre par montant exact sur les 300 derniers envois de la source (24 h au plus), 10 envois suivis.',
  normal: 'Normale : jusqu\'à 40 wallets. Filtre par montant exact sur 24 h (72 h si le dev vient d\'un exchange), 30 envois suivis. Longue sans clé Helius.',
  profond: 'Profonde : jusqu\'à 120 wallets. Filtre par montant exact sur 72 h, 80 envois suivis. À réserver à une connexion Helius.',
};
function setPreset(p) {
  state.preset = p;
  $$('#preset-seg button').forEach((b) => b.classList.toggle('on', b.dataset.preset === p));
  $('#preset-hint').textContent = PRESET_HINT[p];
}
$('#preset-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPreset(b.dataset.preset); });

$('#trace-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  const address = $('#address').value.trim();
  if (!address) { err.textContent = 'Colle une adresse de wallet pour commencer.'; err.hidden = false; return; }
  $('#trace-btn').disabled = true;
  try {
    const { id } = await api('/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, preset: state.preset }) });
    location.hash = `#/t/${id}`;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    $('#trace-btn').disabled = false;
  }
});

async function openTrace(id) {
  setView('trace', `<span>Traque</span><span class="sep">›</span><b>${esc(id.split('-')[0])}…</b>`);
  $('#result').innerHTML = '';
  try {
    const result = await api(`/api/investigations/${id}`);
    $('#progress').hidden = true;
    showResult(result);
  } catch {
    followJob(id);
  }
}

function followJob(id) {
  const box = $('#progress');
  const log = $('#log');
  box.hidden = false;
  log.innerHTML = '';
  $('#bar-fill').style.width = '4%';
  $('#progress-title').textContent = 'Traque en cours';
  $('#progress-sub').textContent = 'Démarrage…';
  box.querySelector('.spinner').hidden = false;
  const es = new EventSource(`/api/trace/${id}/events`);
  state.es = es;
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log') {
      const li = document.createElement('li');
      li.textContent = e.msg;
      log.appendChild(li);
      log.scrollTop = log.scrollHeight;
    } else if (e.type === 'progress') {
      $('#progress-sub').textContent = `${e.scanned} / ${e.total} wallets analysés · ${e.calls} appels RPC`;
      $('#bar-fill').style.width = `${Math.max(4, Math.round((e.scanned / Math.max(e.total, 1)) * 92))}%`;
    } else if (e.type === 'done') {
      es.close();
      state.es = null;
      refreshCount();
      api(`/api/investigations/${id}`).then((r) => { box.hidden = true; showResult(r); });
    } else if (e.type === 'error') {
      es.close();
      state.es = null;
      box.querySelector('.spinner').hidden = true;
      $('#progress-title').textContent = 'La traque a échoué';
      $('#progress-sub').textContent = e.msg;
    }
  };
  es.onerror = () => {
    if (state.es !== es) return;
    es.close();
    state.es = null;
    box.querySelector('.spinner').hidden = true;
    $('#progress-title').textContent = 'Traque introuvable';
    $('#progress-sub').textContent = 'Elle a peut-être été supprimée, ou le serveur a redémarré. Relance-la.';
  };
}

// ---------- affichage d'un résultat ----------
function showResult(result) {
  state.result = result;
  state.tab = 'qualif';
  state.selected = result.start;
  state.sort = {};
  $('#rpc-notice').hidden = true;
  $('#address').value = result.start;
  if (result.preset) setPreset(result.preset);
  renderResult();
}

function renderResult() {
  const r = state.result;
  const p = r.pattern || { type: 'unknown', title: 'Schéma non identifié', summary: '', reasons: [], confidence: 'low' };
  const sibLogic = (t) => `Lancé par ${short(t.creator)}, financé par la même source${t.viaSource ? ` (${short(t.viaSource)})` : ''}${t.fundedSol ? ` avec ${nf(t.fundedSol, 4)} SOL` : ''}${t.via?.length > 1 ? ` via ${t.via.length - 1} relais` : ''}.`;
  const all = [
    ...r.tokens.map((t) => ({ ...t, side: t.side || (t.creator === r.start ? 'self' : 'before') })),
    ...(r.after || []),
    ...(r.siblingTokens || []).map((t) => ({ ...t, side: 'sibling', logic: t.logic || sibLogic(t) })),
  ];
  const groups = [
    ['before', 'Avant', 'Les tokens lancés par ses anciens wallets.', 'Aucun ancien token trouvé.'],
    ['self', 'Cette adresse', 'Les tokens lancés par l\'adresse que tu as collée.', 'Cette adresse n\'a lancé aucun token.'],
    ['after', 'Après', 'Les tokens lancés (ou achetés en groupe) avec l\'argent qui est parti de cette adresse.', 'Aucun nouveau token pour l\'instant : son argent n\'a pas encore servi à lancer un token.'],
    ['sibling', 'Ses autres devs', 'Tokens lancés par d’autres wallets financés par la même source, avec les mêmes montants.', ''],
  ];
  const sum = tally(all.filter((t) => !t.groupBuy));
  $('#result').innerHTML = `
    <div class="res-head">
      <div class="avatar"><svg viewBox="0 0 24 24"><path d="M3 8a3 3 0 013-3h12a2 2 0 012 2v1"/><rect x="3" y="8" width="18" height="12" rx="2.5"/><circle cx="16.5" cy="14" r="1.2"/></svg></div>
      <div class="res-title">
        <h1>${addrHtml(r.start, `${r.start.slice(0, 6)}…${r.start.slice(-6)}`)}</h1>
        <p class="sub">${r.fromToken ? `Dev du token ${esc(r.fromToken.symbol || short(r.fromToken.mint))} · ` : ''}${plural(sum.n, 'token trouvé', 'tokens trouvés')} · ${plural(sum.rugs, 'rug', 'rugs')}</p>
      </div>
      <div class="res-actions">
        <a class="btn sm" href="https://pump.fun/profile/${esc(r.start)}" target="_blank" rel="noopener">Profil pump.fun ↗</a>
        <button class="btn sm" id="rerun">Relancer</button>
        ${r.id ? '<button class="btn sm del" id="del-res">Supprimer</button>' : ''}
      </div>
    </div>

    ${decisionCard(r)}
    <div id="team-note"></div>
    ${inactive(r) ? '' : `${adviceCard(r)}${nextDevCard(r)}${r.advice?.notDev ? '' : backtestCard(r)}${r.advice?.notDev ? '' : snipersCard(r)}`}

    <div class="card scheme">
      <div class="eyebrow">Son schéma</div>
      <div class="v-main">
        <svg viewBox="0 0 90 54" aria-hidden="true">${PICTO[p.type] || PICTO.unknown}</svg>
        <div><h2>${esc(p.title)}</h2>${p.type === 'serial' ? badge('red', 'À rejeter') : badge(...CONF[p.confidence])}</div>
      </div>
      ${p.summary ? `<p class="v-sum">${esc(p.summary)}</p>` : ''}
      ${p.reasons?.length ? `<details class="why"><summary>Comment on le sait</summary><ul class="v-why">${p.reasons.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </div>

    <div class="eyebrow sec">Ses tokens</div>
    ${groups.map(([side, title, help, empty]) => {
    const list = all.filter((t) => t.side === side).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if ((side === 'self' || side === 'sibling') && !list.length) return '';
    return `<div class="card tgroup">
        <div class="card-head"><div><div class="tg-title"><b>${title}</b><span class="n">${list.length}</span></div><p class="sub">${help}</p></div></div>
        ${list.length ? `<div class="tlist">${list.map(tokenRow).join('')}</div>` : `<div class="empty">${empty}</div>`}
      </div>`;
  }).join('')}

    ${flowCard(r)}
    ${(r.moneyNow || []).length ? `<div class="card">
      <div class="card-head"><div><div class="eyebrow">Où est son argent maintenant</div><p class="sub">Les wallets atteints en suivant l'argent qui ont encore du SOL.</p></div></div>
      <div class="tlist">${r.moneyNow.map((m) => `<div class="trow">
        <div class="tr-main"><div>${addrHtml(m.address)} ${badge(m.kind === 'hub' ? 'purple' : 'gray', m.kind === 'hub' ? 'Wallet central' : m.kind === 'busy' ? 'Très actif' : 'Wallet')}</div>
          <div class="tr-nums"><b>${sol(m.balanceSol)} SOL</b><button class="btn sm" data-trace="${esc(m.address)}">Tracer</button></div></div>
        ${m.route ? `<div class="route">${routeHtml(m.route)}</div>` : ''}
      </div>`).join('')}</div>
    </div>` : ''}

    <details class="more" ${state.moreOpen ? 'open' : ''}>
      <summary>Détail technique <span class="mut">circuit de l'argent, adresses, sorties, pistes exchange</span></summary>
      <div class="card" id="circuit" style="margin-top:14px"></div>
      <div class="card" id="detail-card" hidden><div class="detail wide" id="detail"></div></div>
      <div class="tabs" role="tablist" id="more-tabs"></div>
      <div id="panel"></div>
    </details>`;
  $('#rerun').onclick = () => $('#trace-form').requestSubmit();
  if ($('#buy-sol')) $('#buy-sol').onchange = (e) => { const v = Number(e.target.value); if (v > 0) { state.buySol = v; localStorage.setItem('buySol', String(v)); renderResult(); } };
  if (!inactive(r)) autoBacktest(r);
  if ($('#snip-run')) $('#snip-run').onclick = () => runSnipers(r);
  // dev pas trackable : on cherche tout seul les snipers à copier, une fois la rentabilité calculée
  if (!inactive(r) && !r.advice?.notDev && r.qualification?.rule === BT_RULE && r.snipers?.rule !== SNIP_RULE && !state.snipTried?.has(r.id)) { (state.snipTried ||= new Set()).add(r.id); runSnipers(r); }
  if (r.id) api('/api/investigations').then((list) => {
    const t = teams(list).find((g) => g.ids.has(r.id));
    const el = $('#team-note');
    if (!t || !el || state.result?.id !== r.id) return;
    const others = t.members.filter((i) => i.id !== r.id);
    el.innerHTML = `<div class="card team-card"><b>Même équipe que ${others.map((i) => `<a href="#/t/${esc(i.id)}">${esc(i.start.slice(0, 6))}…${esc(i.start.slice(-4))}</a>`).join(', ')}</b> : ${t.shared.slice(0, 2).map(teamLine).join(' · ')}. Un seul tracker les couvre, pas besoin d’en ajouter un deuxième.</div>`;
  }).catch(() => {});
  if ($('#del-res')) {
    $('#del-res').onclick = async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirmer ?'; b.classList.add('danger'); return; }
      await api(`/api/investigations/${r.id}`, { method: 'DELETE' }).catch(() => null);
      toast('Enquête supprimée');
      location.hash = '#/enquetes';
    };
  }
  const more = $('.more');
  const fill = () => { if (more.open && !more.dataset.filled) { more.dataset.filled = '1'; drawCircuit($('#circuit'), r); renderMore(); } };
  more.ontoggle = () => { state.moreOpen = more.open; fill(); };
  fill();
}

function renderMore() {
  const r = state.result;
  const tabs = [
    ['wallets', 'Adresses', r.stats.wallets],
    ['sorties', 'Sorties d\'argent', r.cashouts.length],
    ['pistes', 'Pistes exchange', (r.leads || []).length],
  ];
  if (!tabs.some(([k]) => k === state.tab)) state.tab = 'wallets';
  $('#more-tabs').innerHTML = tabs.map(([k, label, n]) => `<button class="tab ${state.tab === k ? 'on' : ''}" role="tab" aria-selected="${state.tab === k}" data-tab="${k}">${label}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  $$('#more-tabs .tab').forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; renderMore(); }; });
  const panel = $('#panel');
  panel.className = 'view';
  ({ wallets: renderWallets, sorties: renderCashouts, pistes: renderLeads })[state.tab](panel, r);
}


// ---------- backtest : aurais-tu été rentable ? ----------
const FEES = 0.038;
const MIN_SOL_PER_10 = 1; // règle du user : au moins 1 SOL pour 10 lancements
const MIN_TOKENS = 5; // règle du user : au moins 5 tokens analysés (jusqu'à 10) pour juger un dev, sinon « pas assez de données »
const enoughProfit = (pnl, n) => n >= MIN_TOKENS && pnl >= (MIN_SOL_PER_10 * n) / 10;
const notEnoughTxt = (n) => `Pas assez de données : ${n} token${n > 1 ? 's' : ''} analysé${n > 1 ? 's' : ''} sur les ${MIN_TOKENS} nécessaires`;
const minProfitTxt = (n) => `${sol((MIN_SOL_PER_10 * n) / 10)} SOL sur ${n} lancement${n > 1 ? 's' : ''}`;
const TRACKER_BUY = 0.15; // mise du user dans les analyses de wallets (côté serveur)
const BT_RULE = 'fin-1re-bougie-plus-bas-v7';
// Compteur de pertes max conseillé (F Project : 2 à 5 pour un rugger pas encore prouvé, 10 à 15 pour un rugger de confiance)
function lossCounter(r) {
  const bts = (r.qualification?.tokens || []).map((t) => t.bt).filter(Boolean);
  const proven = bts.length >= 20 && enoughProfit(btTotals(bts, state.buySol).best.pnl, bts.length);
  return proven ? 10 : 3;
}
// tes stratégies de vente : à chaque palier on vend une part de ce qui RESTE (50 % à +100 %, 50 % du reste à +200 %, tout le reste à +400 %)
const STRATS = [
  { id: 's1', short: 'Tout à +100 %', label: '100 % à +100 %' },
  { id: 's2', short: '+100 / +200', label: '50 % à +100 % · tout le reste à +200 %' },
  { id: 's3', short: '+100 / +200 / +400', label: '50 % à +100 % · 50 % du reste à +200 % · tout le reste à +400 %' },
];
// % d'un trade avec la perte plafonnée (ce qui reste se revend au mieux au plus bas, au pire à −perte max)
const capPct = (o) => (!o ? 0 : o.rest != null && state.lossCap != null ? (o.sold + o.rest * Math.max(o.exit, 1 - state.lossCap) - 1) * 100 : o.pct ?? 0);
const stratPct = (t, id) => (t.strategies?.[id] ? capPct(t.strategies[id]) : id === 's1' ? t.pct : 0);
const OUTCOME = { tp: ['green', '+100 % pris'], loss: ['red', 'Pas de +100 %'], open: ['gray', 'Aucun trade après la 1re bougie'] };
function btTotals(trades, buy) {
  const ok = trades.filter(Boolean);
  const pnl = ok.reduce((s, t) => s + (buy * stratPct(t, 's1')) / 100, 0) - ok.length * FEES;
  const avg = ok.length ? ok.reduce((s, t) => s + stratPct(t, 's1'), 0) / ok.length : 0;
  const strats = STRATS.map((st) => {
    const p = ok.map((t) => stratPct(t, st.id));
    return { ...st, pnl: p.reduce((x, v) => x + (buy * v) / 100, 0) - ok.length * FEES, avg: p.length ? p.reduce((x, v) => x + v, 0) / p.length : 0, full: ok.filter((t) => (t.strategies?.[st.id]?.hits ?? 0) === (t.strategies?.[st.id]?.of ?? -1)).length };
  });
  const best = strats.reduce((b, x) => (x.pnl > b.pnl ? x : b), strats[0]);
  return { n: ok.length, tp: ok.filter((t) => t.outcome === 'tp').length, rugs: ok.filter((t) => t.outcome === 'rug').length, pnl, avg, minBuy: avg > 0 ? FEES / (avg / 100) : null, strats, best };
}
// achat juste après la 1re vente du dev, mêmes 3 façons de vendre ; pas de vente du dev = pas d'achat
function devSellTotals(r, buy) {
  const q = r.qualification;
  const info = q?.backtest?.devSell;
  if (!info) return null;
  const rows = (q.tokens || []).map((t) => t.bt?.devSell).filter(Boolean);
  const sold = rows.filter((d) => d.sold);
  const strats = STRATS.map((st) => {
    const p = sold.map((d) => capPct(d.strategies?.[st.id]));
    return { ...st, pnl: p.reduce((x, v) => x + (buy * v) / 100, 0) - sold.length * FEES, avg: p.length ? p.reduce((x, v) => x + v, 0) / p.length : 0 };
  });
  const best = strats.reduce((b, x) => (x.pnl > b.pnl ? x : b), strats[0]);
  const launch = q.tokens.filter((t) => t.bt).length ? btTotals(q.tokens.filter((t) => t.bt).map((t) => t.bt), buy).best : null;
  const better = info.share >= 0.7 && best.pnl > 0 && (!launch || best.pnl > launch.pnl);
  return { ...info, strats, best, launch, better };
}
function devSellBlock(r, buy) {
  const d = devSellTotals(r, buy);
  if (!d) return '';
  if (!d.sold) return `<div class="devsell"><div class="ds-head"><b>Et si tu achetais quand le dev vend ?</b></div><p class="mut">Le dev n’a vendu sur aucun de ces ${d.tokens} tokens pendant leurs 2 premières heures : l’achat sur vente du dev ne se déclencherait jamais.</p></div>`;
  return `<div class="devsell ${d.better ? 'better' : ''}">
    <div class="ds-head"><b>Et si tu achetais quand le dev vend ?</b>${d.better ? ' <span class="best-tag">Mieux que l’achat au lancement</span>' : ''}</div>
    <p class="mut">Le dev a vendu sur <b>${d.sold} de ses ${d.tokens} tokens</b>${d.medianSeconds != null ? `, ${dur(d.medianSeconds)} après le lancement en médiane` : ''}${d.range ? `, entre ${nf(d.range[0], 1)} % et ${nf(d.range[1], 1)} % de la supply` : ''}. On achète juste après sa première vente, puis tes 3 façons de vendre. Ce qui n’est pas vendu est perdu jusqu’au plus bas atteint ensuite.</p>
    <div class="ds-row">${d.strats.map((st) => `<div class="ds-cell ${st.id === d.best.id && st.pnl > 0 ? 'best' : ''}"><span class="mut">${esc(st.short)}</span><b class="${netClass(st.pnl)}">${signed(st.pnl)} SOL</b><span class="mut">moy. ${st.avg > 0 ? '+' : ''}${nf(st.avg, 0)} %</span></div>`).join('')}
      ${d.launch ? `<div class="ds-cell ref"><span class="mut">Au lancement (${esc(d.launch.short)})</span><b class="${netClass(d.launch.pnl)}">${signed(d.launch.pnl)} SOL</b><span class="mut">pour comparer</span></div>` : ''}</div>
    ${d.share < 0.7 ? `<p class="mut">Il ne vend que sur ${nf(100 * d.share, 0)} % de ses tokens : pas assez régulier pour s’y fier.</p>` : ''}
  </div>`;
}
// Filtre Max MC (avec un délai de snipe d'1 s, sinon le bot l'ignore) : ses tokens qui démarrent trop haut
// retombent au plancher (~28 SOL de MC) et font les grosses pertes. On cherche le seuil qui aurait le plus rapporté.
function maxMcFilter(rows, buy) {
  const pts = rows.filter((t) => t.bt?.entryMcSol).map((t) => ({ mc: t.bt.entryMcSol, p: STRATS.map((st) => stratPct(t.bt, st.id)) }));
  if (pts.length < 5) return null;
  const pnl = (list, i) => list.reduce((x, y) => x + (buy * y.p[i]) / 100 - FEES, 0);
  const base = Math.max(...STRATS.map((_, i) => pnl(pts, i)));
  const caps = [...new Set(pts.map((x) => x.mc))].sort((a, b) => a - b);
  let best = null;
  caps.forEach((cap, k) => {
    const kept = pts.filter((x) => x.mc <= cap);
    if (kept.length < 3 || kept.length === pts.length) return;
    STRATS.forEach((st, i) => { const v = pnl(kept, i); if (!best || v > best.pnl) best = { cap: (cap + caps[k + 1]) / 2, pnl: v, strat: st, kept: kept.length, skipped: pts.length - kept.length }; });
  });
  return best && best.pnl > base + 0.01 && best.pnl > 0 ? { ...best, base, n: pts.length } : null;
}
function maxMcTip(r) {
  const q = r.qualification;
  if (!q?.tokens) return '';
  const f = maxMcFilter(q.tokens.filter((t) => t.bt), state.buySol);
  if (!f) return '';
  const usdTxt = state.solUsd ? ` ≈ <b>${usd(f.cap * state.solUsd)}</b>` : '';
  return `<p class="ad-tip"><b>Filtre conseillé :</b> délai de snipe 1 s + <b>Max MC</b>${usdTxt} (${nf(f.cap, 0)} SOL de market cap). Ses tokens qui démarrent plus haut retombent au plancher : ce sont eux qui font les plus grosses pertes. Sur ses ${f.n} derniers tokens, ça en aurait évité ${f.skipped} : <b>${signed(f.pnl)} SOL</b> en ${esc(f.strat.short)} au lieu de ${signed(f.base)} SOL. Petit échantillon : à confirmer.</p>`;
}
function backtestCard(r) {
  const q = r.qualification;
  if (!q?.backtest || q.rule !== BT_RULE) {
    return `<div class="card bt" id="bt-card"><div class="eyebrow">Aurais-tu été rentable ?</div>
      <p class="sub" id="bt-status">On rejoue tes trades sur ses derniers tokens (jusqu’à 30) : achat à la fin de la 1re bougie, vente à +100 %, sinon perte jusqu’au plus bas. Lecture des trades…</p></div>`;
  }
  const buy = state.buySol;
  const rows = q.tokens.filter((t) => t.bt);
  const a = btTotals(rows.map((t) => t.bt), buy);
  const missing = q.tokens.length - rows.length;
  const head = !a.n ? ['red', notEnoughTxt(0)] : a.n < MIN_TOKENS ? ['red', notEnoughTxt(a.n)] : enoughProfit(a.best.pnl, a.n) ? ['green', `Oui : ${signed(a.best.pnl)} SOL en ${a.best.short}`] : a.best.pnl > 0 ? ['amber', `Pas assez : ${signed(a.best.pnl)} SOL en ${a.best.short}, il faut au moins ${minProfitTxt(a.n)}`] : ['red', `Non : ${signed(a.best.pnl)} SOL même avec la meilleure stratégie`];
  const exact = rows.length && rows.every((t) => t.bt.precision === 'seconde');
  return `<div class="card bt" id="bt-card">
    <div class="card-head"><div><div class="eyebrow">Aurais-tu été rentable ?</div>
      <h2 class="ad-head"><i class="dot ${head[0]}"></i>${head[1]}</h2>
      <p class="sub">Achat à la fin de la 1re bougie (1 seconde), puis tes 3 façons de vendre. Si le prix ne touche pas ton palier, tu revends au plus bas atteint ensuite : jamais −100 %, car le prix pump.fun ne descend pas sous son plancher (environ 28 SOL de market cap). Plus ton entrée est haute, plus la perte est grande.${(() => { const l = rows.map((t) => stratPct(t.bt, 's1')).filter((p) => p < 0); return l.length ? ` Ici, une perte fait en moyenne <b>${nf(l.reduce((x, v) => x + v, 0) / l.length, 0)} %</b> (de ${nf(Math.max(...l), 0)} % à ${nf(Math.min(...l), 0)} %).` : ''; })()} Frais de 0,038 SOL par trade compris. ${exact ? 'Calcul exact, trade par trade.' : 'Sans clé Helius : approximation sur des bougies d’une minute.'}</p></div>
      <div class="bt-settings"><label class="buy">Mise par trade <span class="unit"><input id="buy-sol" type="number" min="0.01" step="0.05" value="${buy}"><i>SOL</i></span></label></div></div>
    ${a.n ? `<div class="strats">${a.strats.map((st) => `<div class="strat ${st.id === a.best.id && st.pnl > 0 ? 'best' : ''}">
      <div class="lab">${esc(st.short)}${st.id === a.best.id && st.pnl > 0 ? ' <span class="best-tag">Meilleure</span>' : ''}</div>
      <div class="val ${netClass(st.pnl)}">${signed(st.pnl)}<small>SOL</small></div>
      <div class="foot">${esc(st.label)}</div>
      <div class="foot">Gain moyen ${st.avg > 0 ? '+' : ''}${nf(st.avg, 0)} % · ${st.id === 's1' ? `+100 % touché ${st.full} fois sur ${a.n}` : `tous les paliers touchés ${st.full} fois sur ${a.n}`}</div>
    </div>`).join('')}</div>
    <div class="grid4">
      <div class="stat"><div class="lab">Trades simulés</div><div class="val">${a.n}</div><div class="foot">${missing ? `${missing} sans bougies` : 'sur ses derniers tokens'}</div></div>
      <div class="stat"><div class="lab">+100 % atteints</div><div class="val">${a.tp}<small>/ ${a.n} · ${nf(a.n ? (100 * a.tp) / a.n : 0, 0)} %</small></div>${(() => { const sec = rows.filter((t) => t.bt.outcome === 'tp').map((t) => t.bt.seconds).sort((x, y) => x - y); return sec.length ? `<div class="foot">en ${dur(sec[Math.floor(sec.length / 2)])} en médiane</div>` : ''; })()}<div class="foot">${a.n - a.tp} perdant${a.n - a.tp > 1 ? 's' : ''}${a.n - a.tp ? `, perte moyenne ${nf(rows.filter((t) => t.bt.outcome !== 'tp').reduce((s2, t) => s2 + stratPct(t.bt, 's1'), 0) / Math.max(1, a.n - a.tp), 0)} %` : ''}</div></div>
      <div class="stat"><div class="lab">Gain moyen (tout à +100 %)</div><div class="val ${netClass(a.avg)}">${a.avg > 0 ? '+' : ''}${nf(a.avg, 0)}<small>%</small></div><div class="foot">${a.minBuy ? `Mise minimum pour couvrir les frais : ${sol(a.minBuy)} SOL` : 'Négatif : aucune mise ne le rend rentable'}</div></div>
      <div class="stat"><div class="lab">Frais payés</div><div class="val">${sol(a.n * FEES)}<small>SOL</small></div><div class="foot">déjà retirés des résultats ci-dessus (mise ${sol(buy)} SOL)</div></div>
    </div>
    <div class="tlist">${rows.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).map((t) => `<div class="trow">
      <div class="tr-main">
        <div class="ca-line">${caHtml(t)}</div>
        <div class="tr-nums">${badge(...(OUTCOME[t.bt.outcome] || ['gray', t.bt.outcome]))}${t.bt.trades != null && t.bt.trades < 15 && !t.bt.early ? `<span title="Presque aucun trade : souvent un token de test du dev">${badge('gray', `Mort-né (${t.bt.trades} trades)`)}</span>` : ''}${t.side === 'sibling' || t.viaSource ? badge('purple', 'Autre dev') : ''}<span class="mut">${date(t.createdAt)}</span>
          <span class="mut" title="Market cap (SOL) : entrée → ${t.bt.outcome === 'tp' ? `+100 % touché en ${t.bt.seconds} s` : 'plus bas atteint ensuite'}">${nf(t.bt.entryMcSol, 0)} → ${nf(t.bt.outcome === 'tp' ? 2 * t.bt.entryMcSol : t.bt.lowMcSol, 0)} SOL MC${t.bt.outcome === 'tp' ? ` en ${t.bt.seconds} s` : ''}</span>
          ${STRATS.map((st) => { const v = stratPct(t.bt, st.id); return `<span class="spct ${netClass(v)}" title="${esc(st.label)}"><i>${esc(st.short)}</i> ${v > 0 ? '+' : ''}${nf(v, 0)} %</span>`; }).join('')}
          ${t.bt.migrated ? '<span class="mut" title="Le token a migré : ce qui restait est compté au prix de migration">migré</span>' : ''}</div>
      </div></div>`).join('')}</div>
    ${maxMcTip(r)}
    ${devSellBlock(r, buy)}
    ${q.backtest.delay ? `<p class="ad-tip"><b>Réglage conseillé :</b> délai de snipe de ${q.backtest.delay.delay} s avec un Min MC (vérifié après le délai). Sur ses derniers tokens, ça aurait évité ${q.backtest.delay.losersFiltered} de ses ${q.backtest.delay.losers} ratés (effondrés en moins de ${q.backtest.delay.delay} s) et gardé ${q.backtest.delay.winsKept} de ses ${q.backtest.delay.wins} tokens à +100 %.</p>` : ''}
    <p class="logic">Repère F Project : à partir d’environ 33 % de tokens qui offrent +100 %, avec des pertes contenues, le total devient positif. Ici : ${nf(a.n ? (100 * a.tp) / a.n : 0, 0)} %.</p>
    ${(() => { const ts = rows.map((t) => t.createdAt).filter(Boolean); const span = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 3600 : 0; return rows.length < 20 || span < 72 ? `<p class="logic">Échantillon mince pour F Project : ${rows.length} token${rows.length > 1 ? 's' : ''} sur ${span < 48 ? `${nf(span, 0)} h` : `${nf(span / 24, 1)} jours`}. F Project valide un rugger sur au moins 20 tokens couvrant 72 h (30 idéalement). Ta règle (5 tokens minimum) permet de le juger, mais garde un compteur de pertes serré tant qu’il n’a pas fait ses preuves.</p>` : ''; })()}` : '<div class="empty">Aucune donnée de trading trouvée pour ses tokens.</div>'}
  </div>`;
}

// Faut-il le tracker ? On croise « peut-on le suivre » et « aurait-il rapporté ».
function decisionCard(r) {
  const a = r.advice || {};
  const q = r.qualification?.rule === BT_RULE ? btTotals(r.qualification.tokens.filter((t) => t.bt).map((t) => t.bt), state.buySol) : null;
  const can = a.verdict === 'track';
  const maybe = a.verdict === 'dig';
  const ds = q ? devSellTotals(r, state.buySol) : null;
  const win = q ? enoughProfit(q.best.pnl, q.n) || (!!ds?.better && enoughProfit(ds.best.pnl, ds.sold)) : null;
  const off = inactive(r);
  let color; let title; let text;
  if (!off && q && q.n < MIN_TOKENS && !a.notDev) { color = 'red'; title = 'Pas assez de données'; text = `Seulement ${q.n} token${q.n > 1 ? 's' : ''} analysé${q.n > 1 ? 's' : ''} sur les ${MIN_TOKENS} nécessaires : impossible de savoir s’il est rentable. Passe au suivant.`; }
  else if (off) { color = 'gray'; title = 'Non, inactif'; text = `Ni lui ni ses autres devs n’ont lancé de token depuis ${off.days} jour${off.days > 1 ? 's' : ''} (dernier le ${date(off.last)}). Il ne t’intéresse pas pour l’instant : relance une traque s’il revient.`; }
  else if ((a.verdict === 'reject' || a.verdict === 'lost') && win) { color = 'amber'; title = 'Rentable, mais pas trackable'; text = 'Ses tokens auraient rapporté, mais on ne peut pas savoir à l’avance quel wallet va lancer le prochain.' + (bestSniper(r) ? ` À la place, tu peux copier ${short(bestSniper(r).c.wallet)}, qui entre juste après lui : ${signed(bestSniper(r).best.pnl)} SOL sur ses derniers achats. Réglage plus bas.` : ''); }
  else if (untrackable(r) && bestSniper(r)) { const b = bestSniper(r); color = 'amber'; title = 'Pas le dev, mais un sniper à copier'; text = `On ne peut pas suivre le dev, mais ${short(b.c.wallet)} entre juste après lui sur ${b.c.tokens} de ses ${b.c.of} tokens, et le copier aurait rapporté ${signed(b.best.pnl)} SOL (${b.best.label}). Réglage plus bas.`; }
  else if (a.notDev) { color = 'red'; title = 'Non'; text = 'Ce n’est pas un dev : cette adresse ne lance rien et n’envoie rien.'; }
  else if (a.verdict === 'reject' || a.verdict === 'lost') { color = 'red'; title = 'Non'; text = 'On ne peut pas le suivre de façon fiable.'; }
  else if (a.verdict === 'late') { color = 'amber'; title = 'Pas pour ce cycle'; text = 'Trop tard : relance une traque dès son prochain token.'; }
  else if (a.verdict === 'wait') { color = 'amber'; title = 'Pas encore'; text = 'Son montant de retrait ne se répète pas encore : à confirmer sur son prochain token.'; }
  else if (win === false) { color = 'red'; title = can ? 'Trackable, mais pas rentable' : 'Pas rentable'; text = q && q.best.pnl > 0 ? `Il aurait rapporté ${signed(q.best.pnl)} SOL sur ses ${q.n} derniers tokens : moins que ta règle d’au moins 1 SOL pour 10 lancements.` : 'Même en le suivant, tes trades auraient perdu de l’argent sur ses derniers tokens, avec chacune de tes 3 façons de vendre.'; }
  else if (can && win) { color = 'green'; title = 'Oui, track-le'; text = (ds?.better ? `Mieux : achète quand le dev vend, puis ${ds.best.label} (${signed(ds.best.pnl)} SOL). ` : `Meilleure vente : ${q.best.label} (${signed(q.best.pnl)} SOL). `) + (q.n < 5 ? `On peut le suivre et ses ${q.n} derniers tokens auraient rapporté, mais c'est encore peu pour être sûr.` : 'On peut le suivre et ses derniers tokens auraient rapporté.'); }
  else if (can) { color = 'green'; title = 'Oui, à surveiller'; text = q ? 'On peut le suivre. Pas assez de bougies pour juger la rentabilité.' : 'On peut le suivre. Rentabilité en cours de calcul.'; }
  else if (maybe) { color = 'amber'; title = 'À confirmer'; text = 'Une piste existe, mais pas encore sûre.'; }
  else { color = 'gray'; title = 'Pas de conseil'; text = ''; }
  // un premier acheteur qui coche tout : on le propose en plus du tracker
  if (!off && !untrackable(r) && bestSniper(r)) { const b = bestSniper(r); text = `${text ? `${text} ` : ''}En plus : ${short(b.c.wallet)}${b.c.coinRank ? `, ${b.c.coinRank === 1 ? '1er' : `${b.c.coinRank}e`} acheteur du coin,` : ''} est à copier (${signed(b.best.pnl)} SOL sur ses derniers achats). Réglage plus bas.`; }
  return `<div class="card decision d-${color}">
    <div class="eyebrow">Faut-il le tracker ?</div>
    <div class="dc-row"><h2 class="ad-head"><i class="dot ${color}"></i>${title}</h2>
      <div class="dc-checks">
        <span title="Un token lancé par lui ou ses autres devs dans les dernières 24 h">${off ? '✗' : lastLaunch(r) ? '✓' : '…'} Actif 24 h</span>
        <span>${can ? '✓' : maybe ? '~' : '✗'} Trackable</span>
        <span title="${q ? `Sur ${q.n} token${q.n > 1 ? 's' : ''} : F Project demande au moins 20 tokens sur 72 h pour valider` : ''}">${win === null ? '…' : win ? (q.n < 5 ? '~' : '✓') : '✗'} Rentable${q ? ` (${q.n} token${q.n > 1 ? 's' : ''})` : ''}</span>
      </div></div>
    ${text ? `<p class="sub">${esc(text)}</p>` : ''}
  </div>`;
}

// lance le backtest tout seul la première fois qu'on ouvre une enquête
// ---------- snipers à copier (dev pas trackable) ----------
const SNIP_RULE = 'snipers-v5';
const untrackable = (r) => ['lost', 'reject', 'late', 'wait'].includes(r.advice?.verdict) && !r.advice?.notDev;
const snipTotals = (c, buy) => STRATS.map((st) => {
  const p = (c.copies || []).map((x) => capPct(x.strategies?.[st.id]));
  return { ...st, pnl: p.reduce((a, v) => a + (buy * v) / 100, 0) - p.length * FEES, avg: p.length ? p.reduce((a, v) => a + v, 0) / p.length : 0 };
});
function bestSniper(r) {
  const sn = r.snipers;
  if (!sn || sn.rule !== SNIP_RULE) return null;
  const buy = state.buySol;
  return (sn.candidates || []).map((c) => { const t = snipTotals(c, buy); const best = t.reduce((b, x) => (x.pnl > b.pnl ? x : b), t[0]); return { c, t, best }; })
    .filter((x) => x.c.interesting && x.c.copies?.length >= 5 && x.best.pnl > 0).sort((a, b) => b.best.pnl - a.best.pnl)[0] || null;
}
// qui est ce wallet, en une phrase simple
function whoIs(c) {
  const share = c.of ? c.tokens / c.of : 0;
  const same = c.sameRugger?.of ? c.sameRugger.n / c.sameRugger.of : 0;
  if (c.linked) return { tag: ['purple', 'Wallet du rugger'], txt: 'Son argent vient du même réseau que le dev.' };
  if (same >= 0.5) return { tag: ['purple', 'Wallet du rugger'], txt: `${c.sameRugger.n} de ses ${c.sameRugger.of} derniers achats sont des tokens de ce rugger.` };
  if (c.perHour != null && c.perHour > 5) return { tag: ['gray', 'Bot sniper'], txt: `Achète ~${nf(c.perHour, 0)} tokens par heure sur tout pump.fun.` };
  if (share >= 0.5 && (c.perHour == null || c.perHour <= 3)) return { tag: ['purple', 'Sûrement un wallet du rugger'], txt: `En premier sur ${c.tokens} de ses ${c.of} tokens, achète peu ailleurs.` };
  if (c.tokens >= 2) return { tag: ['blue', 'Sniper qui le suit'], txt: `Juste après lui sur ${c.tokens} de ses ${c.of} tokens.` };
  return { tag: ['gray', 'Acheteur ponctuel'], txt: 'Entré tôt sur ce coin seulement.' };
}
const pct0 = (x) => `${nf(x * 100, 0)} %`;
const tokLink = (t) => `<a class="tok-link" href="${esc(axiomUrl(t))}" target="_blank" rel="noopener" title="${esc(t.mint)} — ouvrir sur Axiom">${esc(t.symbol || short(t.mint))} ↗</a>`;
// une case par wallet : verdict, ce que tu gagnerais, 4 chiffres, qui c'est, pourquoi pas
function buyerTile(c, buy, isBest, seenOn) {
  const t = snipTotals(c, buy);
  const b = t.reduce((x, y) => (y.pnl > x.pnl ? y : x), t[0]);
  const n = c.copies?.length || 0;
  const fc = c.firstCandle || { n: 0, of: 0 };
  const own = c.own || { closed: 0, wins: 0, pnlSol: 0 };
  const fcShare = fc.of ? fc.n / fc.of : null;
  const win = own.closed ? own.wins / own.closed : null;
  const who = whoIs(c);
  const why = [];
  if (n < 5) why.push(`${n} achat${n > 1 ? 's' : ''} rejouable${n > 1 ? 's' : ''} seulement`);
  if (fcShare != null && fcShare < 0.6) why.push(`1re bougie ${pct0(fcShare)} du temps`);
  if (win != null && own.closed >= 5 && win < 0.5) why.push(`gagne ${pct0(win)} du temps`);
  if (n >= 5 && b.pnl <= 0) why.push('copie perdante');
  if (c.rugCoins?.of && !c.ruggerFollower) why.push(`achète surtout des coins qui ne rug pas (${c.rugCoins.n}/${c.rugCoins.of} rug)`);
  const ok = c.interesting && n >= 5 && b.pnl > 0;
  const verdict = ok ? ['green', 'À copier'] : n < 5 ? ['gray', 'Pas assez de données'] : b.pnl > 0 ? ['amber', 'Rentable mais pas fiable'] : ['red', 'Pas rentable'];
  const you = n >= 5
    ? `<div class="bt-you"><span>Pour toi</span><b class="${netClass(b.pnl)}">${signed(b.pnl)} SOL</b><small>${n} achats copiés · ${esc(b.short)}</small></div>`
    : `<div class="bt-you"><span>Pour toi</span><b>—</b><small>${n ? `${signed(b.pnl)} SOL sur ${n} achat${n > 1 ? 's' : ''}, pas assez pour juger` : 'aucun achat rejouable'}</small></div>`;
  const stat = (v, l, cls = '') => `<div class="bt-stat"><b class="${cls}">${v}</b><span>${l}</span></div>`;
  return `<div class="btile ${ok ? 'good' : ''} ${isBest ? 'best' : ''}">
    <div class="bt-top">${c.coinRank ? `<span class="bt-rank">${c.coinRank <= 3 ? `#${c.coinRank}` : 'Bundle'}</span>` : ''}${addrHtml(c.wallet)}<span class="bt-verdict">${badge(...verdict)}</span></div>
    ${you}
    <div class="bt-stats">
      ${stat(win != null ? pct0(win) : '—', own.closed ? `gagnant (${own.wins}/${own.closed})` : 'gagnant', win == null ? '' : win >= 0.5 ? 'pos' : 'neg')}
      ${stat(fcShare != null ? pct0(fcShare) : '—', '1re bougie', fcShare == null ? '' : fcShare >= 0.6 ? 'pos' : 'neg')}
      ${stat(own.closed ? signed(own.pnlSol) : '—', 'son résultat (SOL)', netClass(own.pnlSol))}
      ${stat(c.perHour != null ? nf(c.perHour, 1) : '—', 'tokens / heure')}
    </div>
    ${c.rugCoins?.of ? `<div class="bt-rug ${c.ruggerFollower ? 'pos' : 'neg'}">${c.ruggerFollower ? '✓' : '✗'} Ses achats : <b>${c.rugCoins.n}/${c.rugCoins.of}</b> coins qui ont rug · <b>${c.sameRugger?.n || 0}</b> de ce rugger</div>` : ''}
    <div class="bt-who">${badge(...who.tag)} <span class="mut">${esc(who.txt)}</span></div>
    ${seenOn?.length ? `<div class="bt-seen"><span class="mut">Vu tôt sur :</span> ${seenOn.map(tokLink).join(' ')}</div>` : ''}
    ${!ok && why.length ? `<div class="bt-why">Pas proposé : ${esc(why.join(' · '))}</div>` : ''}
    ${n ? `<details class="by-more"><summary>Détail des 3 ventes</summary><div class="bt-strats">${t.map((st) => `<div><span class="mut">${esc(st.short)}</span> <b class="${netClass(st.pnl)}">${signed(st.pnl)}</b></div>`).join('')}</div></details>` : ''}
  </div>`;
}
function snipersCard(r) {
  const sn = r.snipers;
  if (!sn || sn.rule !== SNIP_RULE) {
    const running = state.snipRunning === r.id;
    return `<div class="card snip" id="snip-card"><div class="eyebrow">Premiers acheteurs à copier</div>
      <p class="sub">On vérifie les 3 premiers acheteurs et le bundle du coin (souvent les wallets du rugger), et les snipers qui reviennent juste après le dev sur ses tokens.</p>
      <p class="sub" id="snip-status">${running ? 'Lecture des premiers acheteurs…' : ''}</p>
      ${running ? '' : '<button class="btn sm primary" id="snip-run">Vérifier ses premiers acheteurs</button>'}</div>`;
  }
  const buy = state.buySol;
  const best = bestSniper(r);
  const all = sn.candidates || [];
  const rank = (list) => list.map((c) => ({ c, p: snipTotals(c, buy).reduce((x, y) => Math.max(x, y.pnl), -1e9), enough: (c.copies?.length || 0) >= 5 }))
    .sort((x, y) => (y.c.interesting - x.c.interesting) || (y.enough - x.enough) || (y.p - x.p)).map((x) => x.c);
  const coinBuyers = all.filter((c) => c.coinRank).sort((a, b) => (b.interesting - a.interesting) || a.coinRank - b.coinRank);
  const snipers = rank(all.filter((c) => !c.coinRank));
  // tokens du dev où ce wallet a acheté juste après lui (pour vérifier soi-même sur Axiom)
  const seenOn = (w) => (sn.perToken || []).filter((p) => p.buyers.some((b) => b.wallet === w)).map((p) => ({ mint: p.mint, symbol: p.symbol }));
  const head = !all.length
    ? 'Aucun premier acheteur exploitable : ses premiers acheteurs changent à chaque token (bundle de wallets jetables).'
    : best ? `<b class="pos">1 wallet à copier</b> sur ${all.length} vérifiés : ${short(best.c.wallet)}, ${signed(best.best.pnl)} SOL pour toi${untrackable(r) ? ', à la place du dev qu’on ne peut pas suivre' : ', en plus du tracker'}.`
      : `<b>Aucun wallet à copier</b> sur les ${all.length} vérifiés. Pour être proposé, un wallet doit acheter en 1re bougie la plupart du temps, gagner la plupart du temps, acheter surtout des coins de rugger, et être rentable pour toi.`;
  const section = (title, sub, list, withSeen) => (list.length ? `<div class="bsec"><div class="bsec-head"><b>${title}</b>${sub ? `<span class="mut">${sub}</span>` : ''}</div>
      <div class="btiles">${list.map((c) => buyerTile(c, buy, best && best.c.wallet === c.wallet, withSeen ? seenOn(c.wallet) : null)).join('')}</div></div>` : '');
  const coin = sn.coin;
  const setup = best ? `<div class="snip-setup"><div class="st-t">Le réglage pour copier ${esc(short(best.c.wallet))} dans F Project</div>
      <div class="st-v"><code class="big-addr">${esc(best.c.wallet)}</code><button class="btn sm primary" data-copy="${esc(best.c.wallet)}">Copier</button></div>
      <div class="optlist">
        <div class="optrow"><span class="opt">✓ Activé</span><b>Copier ses achats (Track Buys)</b><span class="mut">Le bot achète quand il achète, dans le même bloc.</span></div>
        <div class="optrow"><span class="opt">✓ Activé</span><b>Acheter une seule fois (Buy Only Once)</b><span class="mut">Un seul achat par token, même s’il rachète.</span></div>
        <div class="optrow"><span class="opt">✓ ${best.c.summary?.ageFilterMin || 1} min</span><b>Âge max du token</b><span class="mut">Il entre juste après la création : on ignore ses achats sur des tokens plus vieux.</span></div>
        <div class="optrow"><span class="opt off">✗ Désactivé</span><b>Snipe dev (créations de token)</b><span class="mut">Ce wallet ne lance pas de tokens, il achète.</span></div>
        <div class="optrow"><span class="opt off">✗ Désactivé</span><b>Copier ses ventes (Track Sells)</b><span class="mut">Tu vends avec ta stratégie : ${esc(best.best.label)}.</span></div>
        <div class="optrow"><span class="opt off">✗ Désactivé</span><b>Protection rugger</b><span class="mut">Inutile pour copier un acheteur.</span></div>
      </div>
      ${best.c.perHour > 3 ? `<p class="bot-warn">Il achète environ ${nf(best.c.perHour, 0)} tokens par heure : le bot copiera tout ce qu’il achète, pas seulement ce dev. Les frais comptent vite.</p>` : ''}
    </div>` : '';
  return `<div class="card snip" id="snip-card">
    <div class="card-head"><div><div class="eyebrow">Premiers acheteurs à copier</div><p class="sub snip-head">${head}</p></div><button class="btn sm" id="snip-run">Relancer</button></div>
    ${section(`Les 3 premiers acheteurs et le bundle du coin${coin?.symbol ? ` ${esc(coin.symbol)}` : ''} (${coinBuyers.length} wallets)`, coin ? `Coin vérifié : <a class="tok-link" href="${esc(axiomUrl(coin))}" target="_blank" rel="noopener">${esc(coin.mint)} ↗</a> <button class="btn sm" data-copy="${esc(coin.mint)}">Copier le CA</button>` : '', coinBuyers, true)}
    ${section('Les snipers qui reviennent sur ses tokens', 'Ils achètent juste après le dev sur plusieurs de ses tokens.', snipers, true)}
    ${setup}
    <p class="logic">« Pour toi » : entrée à la fin de la bougie d’une seconde de son achat (comme le bot qui le copie), tes 3 façons de vendre, revente au plus bas si le palier n’est pas touché, ${sol(buy)} SOL par trade, frais de 0,038 SOL compris. « Gagnant » et « son résultat » : ses vrais achats et ventes récents (3 jours au plus ; pour un bot très actif, souvent une heure ou deux seulement).</p></div>`;
}
async function runSnipers(r) {
  if (!r.id || state.snipRunning === r.id) return;
  state.snipRunning = r.id;
  if ($('#snip-card')) $('#snip-card').outerHTML = snipersCard({ ...r, snipers: null });
  try {
    const { id } = await api(`/api/investigations/${r.id}/snipers`, { method: 'POST' });
    const es = new EventSource(`/api/trace/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      const st = $('#snip-status');
      if (e.type === 'log' && st) st.textContent = e.msg;
      else if (e.type === 'done') { es.close(); state.snipRunning = null; api(`/api/investigations/${r.id}`).then((fresh) => { if (state.result?.id === r.id) { state.result = fresh; renderResult(); } }); }
      else if (e.type === 'error') { es.close(); state.snipRunning = null; if (st) st.textContent = `Recherche impossible : ${e.msg}`; }
    };
    es.onerror = () => { es.close(); state.snipRunning = null; };
  } catch { state.snipRunning = null; }
}

async function autoBacktest(r) {
  if (!r.id || r.qualification?.rule === BT_RULE || state.btRunning === r.id) return;
  state.btRunning = r.id;
  try {
    const { id } = await api(`/api/investigations/${r.id}/qualify`, { method: 'POST' });
    const es = new EventSource(`/api/trace/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      const st = $('#bt-status');
      if (e.type === 'log' && st) st.textContent = e.msg;
      else if (e.type === 'done') { es.close(); state.btRunning = null; api(`/api/investigations/${r.id}`).then((fresh) => { if (state.result?.id === r.id) { state.result = fresh; renderResult(); } }); }
      else if (e.type === 'error') { es.close(); state.btRunning = null; if (st) st.textContent = `Backtest impossible : ${e.msg}`; }
    };
    es.onerror = () => { es.close(); state.btRunning = null; };
  } catch { state.btRunning = null; }
}

// Une route : les wallets traversés, flèches dans le sens de l'argent. Les relais à la suite sont regroupés.
const ROLE = { start: 'Tracée', relay: 'relais', hub: 'central', creator: 'dev', mother: 'mère', exchange: 'exchange', busy: 'très actif', service: 'service', wallet: '' };
function routeHtml(route) {
  const { steps, links } = route;
  const parts = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.role === 'relay') {
      let j = i;
      while (j + 1 < steps.length && steps[j + 1].role === 'relay') j++;
      const n = j - i + 1;
      parts.push(`<span class="hop relay" title="${esc(steps.slice(i, j + 1).map((x) => x.address).join('\n'))}">${n > 1 ? `${n} relais` : 'relais'}</span>`);
      i = j;
    } else {
      parts.push(`<span class="hop ${st.role}" data-copy="${esc(st.address)}" title="Copier ${esc(st.address)}">${esc(short(st.address))}${ROLE[st.role] ? `<i>${ROLE[st.role]}</i>` : ''}</span>`);
    }
    if (i < steps.length - 1) {
      const l = links[i];
      const right = l && l.from === steps[i].address;
      parts.push(`<span class="arrow" title="${l ? `${nf(l.sol, 4)} SOL` : ''}">${right ? '→' : '←'}${l && l.sol >= 0.01 ? `<small>${sol(l.sol)}</small>` : ''}</span>`);
    }
  }
  return parts.join('');
}

// Le CA du token, qui s'ouvre sur Axiom (adresse de la paire si on la connaît, sinon le CA).
const axiomUrl = (t) => `https://axiom.trade/meme/${encodeURIComponent(t.market?.pair || t.mint)}`;
const caHtml = (t) => `<a class="ca" href="${esc(axiomUrl(t))}" target="_blank" rel="noopener" title="Ouvrir sur Axiom">${esc(t.mint)} ↗</a><button class="btn sm" data-copy="${esc(t.mint)}">Copier</button>`;
function tokenRow(t) {
  const st = t.groupBuy ? badge('purple', `Acheté par ${t.buyers} de ses wallets`) : t.side === 'sibling' ? `${badge('purple', 'Même source')}${t.status ? statusBadge(t.status) : ''}` : statusBadge(t.status);
  return `<div class="trow">
    <div class="tr-main">
      <div class="ca-line">${caHtml(t)}</div>
      <div class="tr-nums">${st}<span class="mut">${date(t.createdAt)}</span></div>
    </div>
    ${t.route ? `<div class="route">${routeHtml(t.route)}</div>` : ''}
    <p class="logic">${esc(t.logic || '')}</p>
  </div>`;
}

// Ce qu'il faut faire sur F Project, étape par étape.
const MODE_UI = [
  ['last', 'Dernier Transfert', 'Suit le wallet quand il envoie tout son SOL vers une nouvelle adresse.'],
  ['exchange', 'Modèle d\'Échange', 'Suit les envois à montant fixe. Il faut remplir les Plages de Transfert.'],
  ['hybrid', 'Hybride', 'Les deux : envois dans la plage ET vidage du wallet.'],
];
function adviceCard(r) {
  const a = r.advice || (r.tracker ? { verdict: r.tracker.verdict, address: r.tracker.address, mode: r.tracker.kind === 'chain' ? 'last' : 'exchange', ranges: r.tracker.minSol != null ? [r.tracker.minSol, r.tracker.maxSol] : null, reason: r.tracker.reason, warning: r.tracker.warning } : { verdict: 'reject', reason: 'Pas de conseil pour cette traque.' });
  const head = {
    track: [a.urgent ? 'Track-le tout de suite' : 'Track-le comme ça', 'green'],
    dig: ['Pas encore sûr : à confirmer', 'amber'],
    late: ['Trop tard pour ce cycle', 'amber'],
    wait: ['Pas encore : montant à surveiller', 'amber'],
    lost: ['Pas trackable par l’argent', 'red'],
    reject: ['Ne le track pas', 'red'],
  }[a.verdict] || ['Pas de conseil', 'gray'];
  // trackable mais pas rentable sur assez de tokens : on le dit ici aussi
  const bt = r.qualification?.rule === BT_RULE ? btTotals(r.qualification.tokens.filter((t) => t.bt).map((t) => t.bt), state.buySol) : null;
  const notWorth = a.verdict === 'track' && bt && bt.n >= MIN_TOKENS && !enoughProfit(bt.best.pnl, bt.n);
  if (notWorth) { head[0] = 'Trackable, mais pas rentable'; head[1] = 'amber'; }
  else if (a.verdict === 'track' && bt && bt.n < MIN_TOKENS) { head[0] = 'Trackable, mais pas assez de données'; head[1] = 'red'; }
  const ranges = !a.ranges ? [] : Array.isArray(a.ranges[0]) ? a.ranges : [a.ranges];
  const info = a.rangeInfo || [];
  const opts = (a.options || []).map((o) => (typeof o === 'string' ? { key: o, on: true, why: '' } : o));
  // mêmes noms que l'écran Protection du bot F Project
  const OPT_NAME = BOT_OPT;
  const nonSol = (r.qualification?.tokens || []).some((t) => t.bt?.quoteSol === false);
  const steps = a.address && ['track', 'dig'].includes(a.verdict) ? `
    <ol class="steps">
      <li><div class="st-t">Ajoute cette adresse dans F Project</div>
        <div class="st-v"><code class="big-addr">${esc(a.address)}</code><button class="btn sm primary" data-copy="${esc(a.address)}">Copier</button></div></li>
      <li><div class="st-t">Mode de protection</div>
        <div class="modes">${MODE_UI.map(([k, name, what]) => `<div class="mode ${a.mode === k ? 'on' : ''}" title="${esc(what)}">${a.mode === k ? '✓ ' : ''}${name}</div>`).join('')}</div>
        <div class="mut st-h">${esc(MODE_UI.find(([k]) => k === a.mode)?.[2] || '')}</div></li>
      <li><div class="st-t">Plages de Transfert${ranges.length > 1 ? ` (${ranges.length})` : ''}</div>
        ${ranges.length && a.mode !== 'last' ? `<div class="ranges">${ranges.map((rg, i) => `<div class="range"><b class="mono">${nf(rg[0], 4)} – ${nf(rg[1], 4)} SOL</b>${info[i] ? `<span class="mut">${info[i].n} dev${info[i].n > 1 ? 's' : ''}</span>` : ''}<button class="btn sm" data-copy="${esc(`${rg[0]}-${rg[1]}`)}">Copier</button></div>`).join('')}</div>` : '<div class="st-v"><span class="mut">Pas besoin avec ce mode.</span></div>'}</li>
      ${opts.length ? `<li><div class="st-t">Options de protection</div>
        <div class="optlist">${opts.map((o) => `<div class="optrow"><span class="opt ${o.on ? '' : 'off'}">${o.on ? '✓ Activé' : '✗ Désactivé'}</span><b>${esc(OPT_NAME[o.key] || o.key)}${o.hours && o.on ? ` · ${o.hours} h` : ''}</b>${o.why ? `<span class="mut">${esc(o.why)}</span>` : ''}${o.warn && o.on ? `<span class="opt-warn">${esc(o.warn)}</span>` : ''}</div>`).join('')}</div></li>` : ''}
      ${a.verdict === 'track' ? `<li><div class="st-t">Compteur de pertes max (Max Loss Counter)</div><div class="optlist"><div class="optrow"><span class="opt">✓ Activé</span><b>${lossCounter(r)} pertes d’affilée</b><span class="mut">Coupe l’achat auto sur ce rugger après ${lossCounter(r)} pertes de suite (un gain remet le compteur à zéro). F Project conseille 2 à 5 pour un rugger pas encore prouvé, 10 à 15 pour un rugger de confiance.</span></div></div></li>` : ''}
      ${(() => { const d = devSellTotals(r, state.buySol); if (!d || !d.sold) return ''; return d.better
        ? `<li><div class="st-t">Achat sur vente du dev (Buy on Dev Sell)</div><div class="optlist"><div class="optrow"><span class="opt">✓ Activé</span><b>Entre ${nf(d.range?.[0] ?? 0, 1)} % et ${nf(d.range?.[1] ?? 100, 1)} % de la supply</b><span class="mut">Il vend sur ${d.sold} de ses ${d.tokens} tokens et ça rapporte plus : ${signed(d.best.pnl)} SOL contre ${signed(d.launch?.pnl ?? 0)} SOL au lancement.</span></div><div class="optrow"><span class="opt off">✗ Désactivé</span><b>Achat au lancement (Snipe dev)</b><span class="mut">Sinon tu achètes deux fois sur le même token : au lancement puis à sa vente.</span></div></div></li>`
        : `<li><div class="st-t">Achat sur vente du dev (Buy on Dev Sell)</div><div class="optlist"><div class="optrow"><span class="opt off">✗ Désactivé</span><b>Achète au lancement</b><span class="mut">${d.share < 0.7 ? `Il ne vend que sur ${d.sold} de ses ${d.tokens} tokens.` : `Acheter quand il vend rapporte moins (${signed(d.best.pnl)} SOL) qu’au lancement (${signed(d.launch?.pnl ?? 0)} SOL).`}</span></div></div></li>`; })()}
      ${nonSol ? '<li><div class="st-t">Plateformes</div><div class="st-v"><span>Certains de ses tokens sont cotés hors SOL (USDC…) : laisse <b>Pump custom</b> activé et garde un peu de cette monnaie sur ton wallet, sinon le bot saute l’achat.</span></div></li>' : ''}
    </ol>` : '';
  return `<div class="card advice a-${a.verdict}">
    <div class="eyebrow">Ce que tu fais sur F Project</div>
    <h2 class="ad-head"><i class="dot ${head[1]}"></i>${head[0]}</h2>
    ${notWorth ? `<p class="bot-warn">Sur ses ${bt.n} derniers tokens, avec ta règle, tu aurais fait ${signed(bt.pnl)} SOL (${bt.tp} sur ${bt.n} à +100 %). Le réglage ci-dessous est bon pour le suivre, mais ne l’arme pas, ou seulement avec une petite mise.</p>` : ''}
    ${a.urgent && !notWorth ? '<p class="ad-urgent">Son argent bouge vite : colle l’adresse maintenant, dans quelques minutes elle ne servira plus.</p>' : ''}
    ${a.durable ? '<p class="ad-durable">Adresse durable : elle revient à chaque cycle, tu peux la laisser dans le bot.</p>' : ''}
    ${steps}
    ${steps ? `<div class="copyall"><button class="btn sm primary" data-copy="${esc(botText(a, ranges, opts, OPT_NAME))}">Copier tout le réglage</button><span class="mut">adresse, mode, plages et options, en texte</span></div>` : ''}
    <p class="ad-why"><b>Pourquoi :</b> ${esc(a.reason)}</p>
    ${a.also ? `<div class="also"><div class="st-t">En plus : un 2e tracker pour sa prochaine mère</div>
      <div class="st-v"><code class="big-addr">${esc(a.also.address)}</code><button class="btn sm" data-copy="${esc(a.also.address)}">Copier</button></div>
      <div class="mut">${esc(a.also.name || '')} · Modèle d’Échange · plage <b class="mono">${nf(a.also.range[0], 4)} – ${nf(a.also.range[1], 4)} SOL</b> <button class="btn sm" data-copy="${esc(`${a.also.range[0]}-${a.also.range[1]}`)}">Copier</button> · Conserver l’adresse ✓ · Hériter paramètres ✗</div>
      <p class="mut">${esc(a.also.why)}</p></div>` : ''}
    ${a.watch ? `<div class="watchbox"><span class="mut">Source à surveiller</span><b>${esc(a.watch.name || '')}</b>${addrHtml(a.watch.address)}<span class="mut">montant exact</span><b class="mono">${nf(a.watch.range[0], 4)} – ${nf(a.watch.range[1], 4)} SOL</b></div>` : ''}
    ${a.warning ? `<p class="bot-warn">${esc(a.warning)}</p>` : ''}
    ${a.tip ? `<p class="ad-tip"><b>Que faire :</b> ${esc(a.tip)}</p>` : ''}
  </div>`;
}

// Ses prochains devs probables : financés par sa source dans ses plages, rien lancé, encore leur SOL.
function nextDevCard(r) {
  const w = r.census?.waiting || [];
  if (!w.length) return '';
  const name = r.census.label || short(r.census.source);
  return `<div class="card next">
    <div class="card-head"><div><div class="eyebrow">Ses prochains devs probables</div>
      <p class="sub">${plural(w.length, 'wallet a reçu', 'wallets ont reçu')} de ${esc(name)} un montant de ses plages, n’${w.length > 1 ? 'ont' : 'a'} encore rien lancé et ${w.length > 1 ? 'ont' : 'a'} toujours le SOL. Si tu mets la source dans le bot, il les suivra tout seul.</p></div></div>
    <div class="tlist">${w.map((x) => `<div class="trow"><div class="tr-main">
      <div>${addrHtml(x.address)}${x.via?.length > 1 ? ` <span class="mut">via ${x.via.length - 1} relais</span>` : ''}</div>
      <div class="tr-nums"><span>${nf(x.amount, 4)} SOL reçus</span><span class="mut">${ago(x.at)}</span><b>${sol(x.balanceSol)} SOL dessus</b><button class="btn sm" data-trace="${esc(x.address)}">Tracer</button></div>
    </div></div>`).join('')}</div>
  </div>`;
}

// Le réglage complet, en texte, pour le garder sous la main pendant qu'on remplit le bot.
const BOT_OPT = { keepAddress: 'Conserver l’adresse', autoEviction: 'Auto-éviction', freshWalletOnly: 'Portefeuille vierge uniquement', removeIfNoLaunch: 'Supprimer sans lancement', removeAfterFirstAction: 'Supprimer après la 1re action', inheritSettings: 'Hériter paramètres', spiderScheme: 'Schéma araignée' };
function botText(a, ranges, opts, names) {
  const mode = MODE_UI.find(([k]) => k === a.mode)?.[1] || '';
  return [
    `Adresse : ${a.address}`,
    `Mode de protection : ${mode}`,
    ranges.length && a.mode !== 'last' ? `Plages de Transfert : ${ranges.map((r) => `${r[0]} – ${r[1]}`).join(' | ')}` : 'Plages de Transfert : aucune',
    ...opts.map((o) => `${names[o.key] || o.key} : ${o.on ? 'ON' : 'OFF'}${o.hours && o.on ? ` (${o.hours} h)` : ''}`),
    ...(a.also ? ['', `2e tracker : ${a.also.address}`, 'Mode de protection : Modèle d’Échange', `Plages de Transfert : ${a.also.range[0]} – ${a.also.range[1]}`, 'Conserver l’adresse : ON', 'Hériter paramètres : OFF'] : []),
    ...(() => { const d = state.result ? devSellTotals(state.result, state.buySol) : null; return d?.better ? [`Achat sur vente du dev : ON, entre ${d.range?.[0] ?? 0} % et ${d.range?.[1] ?? 100} % de la supply`, 'Achat au lancement (Snipe dev) : OFF'] : []; })(),
    ...(a.verdict === 'track' && state.result ? [`Compteur de pertes max : ${lossCounter(state.result)}`] : []),
    ...(state.result?.qualification?.backtest?.delay ? [`Délai de snipe : ${state.result.qualification.backtest.delay.delay} s (avec Min MC)`] : []),
  ].join(String.fromCharCode(10));
}

// Le gros de son argent, de wallet en wallet, jusqu'à là où il est maintenant.
const FLOW_END = {
  rest: ['green', 'Posé ici'], mixer: ['red', 'Mélangeur'], exchange: ['amber', 'Exchange'],
  split: ['amber', 'Éparpillé'], spent: ['gray', 'Dépensé'], max: ['gray', 'Bouge encore'],
};
function flowCard(r) {
  const f = r.flow;
  if (!f || f.path.length < 2) return '';
  const steps = f.path.map((p, i) => ({ address: p.address, role: i === 0 ? 'start' : p.kind === 'hub' ? 'hub' : p.kind }));
  const links = f.path.slice(1).map((p, i) => ({ from: f.path[i].address, to: p.address, sol: p.inSol }));
  const last = f.path[f.path.length - 1];
  const single = f.path.filter((p) => p.bursts === 1 && p.address !== r.start).length;
  return `<div class="card">
    <div class="card-head"><div><div class="eyebrow">Le chemin de son argent</div>
      <p class="sub">Le gros de son SOL suivi de wallet en wallet. ${plural(f.path.length - 1, 'wallet traversé', 'wallets traversés')}, dont ${single} jetable${single > 1 ? 's' : ''} (utilisé${single > 1 ? 's' : ''} une seule fois).</p></div>
      ${badge(...(FLOW_END[f.end] || ['gray', f.end]))}</div>
    <div class="route">${routeHtml({ steps, links })}</div>
    ${f.path.filter((p) => p.merged).map((p) => `<p class="bot-warn">Mélangé à d’autres fonds sur ${addrHtml(p.address)} : ${sol(p.inSol)} SOL entrés, ${sol(p.outSol)} SOL ressortis.</p>`).join('')}
    ${f.path.some((p) => p.loop) ? '<p class="logic">Aller-retour repéré : son argent est ressorti puis revenu sur le même wallet pour brouiller la piste.</p>' : ''}
    <p class="logic">Dernier wallet : ${addrHtml(last.address)} · ${sol(f.frontier?.balanceSol ?? 0)} SOL dessus${last.inAt ? ` · arrivé ${ago(last.inAt)}` : ''}</p>
  </div>`;
}

// ---------- schéma ----------
const tokenCell = (t) => `<a href="https://pump.fun/coin/${esc(t.mint)}" target="_blank" rel="noopener" class="tok-name" title="Ouvrir sur pump.fun">${esc(t.name.slice(0, 28))}</a><span class="tok-sym">${esc(t.symbol.slice(0, 12))}</span>`;
const CONF = { high: ['green', 'Confiance élevée'], medium: ['amber', 'Confiance moyenne'], low: ['gray', 'Confiance faible'] };

// Les quatre schémas types, dessinés. Celui qui est détecté est mis en avant.
const PICTO = {
  mother: '<rect x="4" y="21" width="12" height="12" rx="3" class="p-src"/><path d="M16,27H34M46,27L74,9M46,27H74M46,27L74,45" class="p-line"/><circle cx="40" cy="27" r="7" class="p-hub"/><circle cx="80" cy="9" r="5" class="p-dev"/><circle cx="80" cy="27" r="5" class="p-dev"/><circle cx="80" cy="45" r="5" class="p-dev"/>',
  chain: '<rect x="4" y="21" width="12" height="12" rx="3" class="p-src"/><path d="M16,27H28M38,27H50M60,27H72" class="p-line"/><circle cx="33" cy="27" r="5" class="p-dev"/><circle cx="55" cy="27" r="5" class="p-dev"/><circle cx="77" cy="27" r="5" class="p-dev"/>',
  exchange: '<rect x="4" y="19" width="16" height="16" rx="4" class="p-src"/><path d="M20,27L74,9M20,27H74M20,27L74,45" class="p-line dashed"/><circle cx="80" cy="9" r="5" class="p-dev"/><circle cx="80" cy="27" r="5" class="p-dev"/><circle cx="80" cy="45" r="5" class="p-dev"/>',
  unknown: '<rect x="4" y="21" width="12" height="12" rx="3" class="p-src"/><path d="M16,27H34M54,27H74" class="p-line dashed"/><circle cx="44" cy="27" r="9" class="p-hub"/><circle cx="80" cy="27" r="5" class="p-dev"/>',
  serial: '<circle cx="18" cy="27" r="7" class="p-dev"/><path d="M25,27H40" class="p-line"/><g class="p-tok"><rect x="44" y="8" width="8" height="8" rx="2"/><rect x="55" y="8" width="8" height="8" rx="2"/><rect x="66" y="8" width="8" height="8" rx="2"/><rect x="77" y="8" width="8" height="8" rx="2"/><rect x="44" y="23" width="8" height="8" rx="2"/><rect x="55" y="23" width="8" height="8" rx="2"/><rect x="66" y="23" width="8" height="8" rx="2"/><rect x="77" y="23" width="8" height="8" rx="2"/><rect x="44" y="38" width="8" height="8" rx="2"/><rect x="55" y="38" width="8" height="8" rx="2"/><rect x="66" y="38" width="8" height="8" rx="2"/><rect x="77" y="38" width="8" height="8" rx="2"/></g>',
};
const ARCHETYPES = [['mother', 'Wallet mère'], ['chain', 'Chaîne dev → dev'], ['exchange', 'Exchange'], ['serial', 'Même adresse réutilisée']];

function renderSchema(el, r) {
  const p = r.pattern;
  const cands = [
    ...r.wallets.filter((w) => w.candidate).map((w) => ({ address: w.address, how: w.funder ? `Financé par ${addrHtml(w.funder)}` : '—', balance: w.balanceSol, when: w.fundedAt })),
    ...leadCandidates(r).map((l) => ({ address: l.end || l.address, how: `Envoi ${esc(l.exchange)} de ${nf(l.sol, 3)} SOL ${badge('amber', 'Piste exchange')}`, balance: l.balanceSol, when: l.time })),
  ].sort((a, b) => (b.when || 0) - (a.when || 0));
  // un lanceur en série peut se cumuler avec un autre schéma
  const serial = r.wallets.some((w) => w.tokens >= 2);
  el.innerHTML = `
    <div class="archetypes">${ARCHETYPES.map(([k, label]) => {
    const on = p?.type === k;
    const also = !on && k === 'serial' && serial;
    return `<div class="arch ${on ? 'on' : also ? 'also' : ''}" ${on ? `title="${esc(p.reasons.join('\n'))}"` : ''}>
        <svg viewBox="0 0 90 54" aria-hidden="true">${PICTO[k]}</svg>
        <div class="arch-name">${label}</div>
        ${on ? (k === 'serial' ? badge('red', 'À rejeter') : badge(...CONF[p.confidence])) : also ? badge('gray', 'Aussi') : ''}
      </div>`;
  }).join('')}</div>
    ${trackerCard(r)}
    <div class="card" id="circuit"></div>
    <div class="card" id="detail-card" hidden><div class="detail wide" id="detail"></div></div>
    <div class="card">
      <div class="card-head"><div><div class="eyebrow">Candidats au prochain lancement</div></div></div>
      ${cands.length ? `<div class="table-wrap"><table><thead><tr><th>Wallet</th><th>Origine</th><th class="num">Solde</th><th class="num">Financé</th><th></th></tr></thead><tbody>
        ${cands.slice(0, 12).map((c) => `<tr><td>${addrHtml(c.address)}</td><td>${c.how}</td><td class="num">${sol(c.balance)} SOL</td><td class="num mut">${ago(c.when)}</td><td class="num"><button class="btn sm" data-trace="${esc(c.address)}">Tracer</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Aucun wallet en attente repéré pour l\'instant.</div>'}
    </div>`;
  drawCircuit($('#circuit'), r);
}

const KIND_COLOR = { exchange: 'var(--amber)', mother: 'var(--accent)', rug: 'var(--red)', dev: 'var(--blue)', candidate: 'var(--green)', plain: 'var(--dim)' };
const GLYPH = {
  bank: '<path d="M-6,-2L0,-6L6,-2M-4.5,0V5M0,0V5M4.5,0V5M-6.5,6.5H6.5"/>',
  wallet: '<rect x="-6" y="-4.5" width="12" height="9" rx="2"/><path d="M2,0H6"/>',
  hub: '<circle r="2.4"/><path d="M0,-6.5V-3.5M0,3.5V6.5M-6.5,0H-3.5M3.5,0H6.5"/>',
  clock: '<circle r="6"/><path d="M0,-3V0L2.5,1.5"/>',
  out: '<path d="M-5.5,0H5M1.5,-3.5L5,0L1.5,3.5"/>',
};
const STATUS_SQ = { rug: 'var(--red)', exit: 'var(--amber)', holding: 'var(--blue)', moved: 'var(--accent)', 'no-buy': 'var(--dim)' };

// Dispose le circuit en colonnes : source, wallets (par niveau de financement), tokens lancés, sorties.
function layoutCircuit(r) {
  const NW = 168, NH = 50, GX = 64, GY = 14, TW = 204, HEAD = 30;
  const nodes = new Map();
  const lastDev = r.pattern?.type === 'chain' ? [...r.wallets].filter((w) => !w.link).sort((a, b) => (b.fundedAt || 0) - (a.fundedAt || 0))[0]?.address : null;
  for (const w of r.wallets) {
    const kind = w.isMother ? 'mother' : w.rugs ? 'rug' : w.tokens ? 'dev' : w.candidate ? 'candidate' : 'plain';
    const sub = w.tokens ? plural(w.tokens, 'token', 'tokens') + (w.rugs ? ` · ${plural(w.rugs, 'rug', 'rugs')}` : '')
      : w.candidate ? `En attente · ${sol(w.balanceSol)} SOL` : w.link?.type === 'collects' ? 'Collecte les gains' : w.children >= 2 ? `Finance ${w.children} wallets` : w.children ? 'Relais' : 'Aucun token';
    nodes.set(w.address, {
      id: w.address, kind, icon: w.isMother ? 'hub' : w.candidate ? 'clock' : 'wallet', title: short(w.address), sub, start: w.isStart, linked: !!w.link, wallet: w, kids: [],
      watch: w.isMother || w.candidate || w.link?.type === 'collects' || w.address === lastDev,
    });
  }
  const exNode = (id, title, sub, named) => ({ id, kind: 'exchange', icon: 'bank', title, named, sub, kids: [], terminal: true });
  for (const e of r.edges) if (!nodes.has(e.from) && e.fromLabel) nodes.set(e.from, { ...exNode(e.from, e.fromLabel, 'Exchange', true), ext: true });
  let rootId = r.root;
  const t = r.terminal;
  if (t?.address && (!nodes.has(t.address) || nodes.get(t.address).ext)) {
    nodes.set(t.address, { ...exNode(t.address, t.label || short(t.address), t.type === 'exchange' ? 'Exchange' : t.type === 'busy' ? 'Forte activité' : terminalInfo(t).text, !!t.label), kind: t.type === 'depth' ? 'plain' : 'exchange' });
    rootId = t.address;
  }
  const hasParent = new Set();
  const link = (p, c, amount) => { hasParent.add(c.id); c.inSol = amount; p.kids.push(c); };
  for (const e of [...r.edges].sort((a, b) => (a.time || 0) - (b.time || 0))) {
    const p = nodes.get(e.from), c = nodes.get(e.to);
    if (p && c && !hasParent.has(e.to) && e.to !== rootId) link(p, c, e.sol);
  }
  // wallets qui ont reçu le montant exact de la source et n'ont encore rien lancé
  for (const l of leadCandidates(r).slice(0, 6)) {
    const id = l.end || l.address;
    const src = nodes.get(l.hot);
    if (!src || nodes.has(id)) continue;
    const n = { id, kind: 'candidate', icon: 'clock', title: short(id), sub: `En attente · ${sol(l.balanceSol)} SOL`, linked: true, lead: l, watch: true, kids: [] };
    nodes.set(id, n);
    link(src, n, l.sol);
  }

  let row = 0, maxDepth = 0;
  const seen = new Set();
  const place = (n, depth) => {
    seen.add(n.id);
    n.depth = depth;
    n.x = depth * (NW + GX);
    maxDepth = Math.max(maxDepth, depth);
    n.kids = n.kids.filter((k) => !seen.has(k.id));
    if (!n.kids.length) { n.y = row++ * (NH + GY); return; }
    n.kids.forEach((k) => place(k, depth + 1));
    n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2;
  };
  place(nodes.get(rootId), 0);
  for (const n of nodes.values()) if (!seen.has(n.id) && !hasParent.has(n.id)) place(n, 0);
  const placed = [...nodes.values()].filter((n) => seen.has(n.id));

  // empile les cases d'une colonne sans chevauchement, au plus près de leur hauteur idéale
  const stack = (items, gap) => { let min = 0; for (const it of [...items].sort((a, b) => a.y - b.y)) { it.y = Math.max(it.y, min); min = it.y + it.h + gap; } return min - gap; };

  // colonne des tokens : une case par wallet créateur, un carré par token
  const tokX = (maxDepth + 1) * (NW + GX);
  const PER = 16;
  const groups = placed.filter((n) => n.wallet?.tokens).map((n) => {
    const toks = r.tokens.filter((x) => x.creator === n.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const shown = toks.slice(-PER * 3);
    const h = 32 + Math.ceil(shown.length / PER) * 11 + 9;
    const g = { id: `tok:${n.id}`, of: n, toks, shown, x: tokX, h, y: n.y + NH / 2 - h / 2, net: toks.reduce((s, x) => s + x.pnlSol, 0) };
    n.group = g;
    return g;
  });
  const tokBottom = groups.length ? stack(groups, 10) : 0;

  // colonne des sorties d'argent
  const cashX = groups.length ? tokX + TW + GX : tokX;
  const byId = new Map(placed.map((n) => [n.id, n]));
  const cash = r.cashouts.slice(0, 7).map((c) => {
    const from = c.from.map((a) => byId.get(a)).filter(Boolean);
    if (!from.length) return null;
    const isEx = c.depositOf || c.kind === 'exchange' || c.kind === 'swap';
    const mid = (n) => (n.group ? n.group.y + n.group.h / 2 : n.y + NH / 2);
    return {
      id: `cash:${c.address}`, kind: isEx ? 'exchange' : 'plain', icon: 'out', cash: c, from, kids: [], x: cashX, h: NH,
      y: from.reduce((s, n) => s + mid(n), 0) / from.length - NH / 2, watch: !!c.depositOf,
      title: c.depositOf ? `Dépôt ${c.depositOf}` : c.label || short(c.address), named: !!(c.depositOf || c.label), sub: `${sol(c.sol)} SOL sortis`,
    };
  }).filter(Boolean);
  const cashBottom = cash.length ? stack(cash, GY) : 0;

  const treeBottom = Math.max(1, row) * (NH + GY) - GY;
  const right = cash.length ? cashX + NW : groups.length ? tokX + TW : maxDepth * (NW + GX) + NW;
  const rootIsSource = !!nodes.get(rootId).terminal;
  const heads = [];
  if (rootIsSource) heads.push({ x: 0, text: 'SOURCE' });
  if (maxDepth >= (rootIsSource ? 1 : 0)) heads.push({ x: rootIsSource ? NW + GX : 0, text: 'WALLETS' });
  if (groups.length) heads.push({ x: tokX, text: 'TOKENS LANCÉS' });
  if (cash.length) heads.push({ x: cashX, text: 'SORTIES D\'ARGENT' });
  return { nodes: placed, groups, cash, heads, w: right, h: Math.max(treeBottom, tokBottom, cashBottom) + HEAD, NW, NH, TW, HEAD, tokX, cashX };
}

function drawCircuit(el, r) {
  const c = layoutCircuit(r);
  const { NW, NH, TW, HEAD } = c;
  const maxSol = Math.max(0.001, ...c.nodes.map((n) => n.inSol || 0), ...c.cash.map((x) => x.cash.sol / x.from.length));
  const width = (v) => (1.4 + 5.6 * Math.sqrt(Math.min(1, v / maxSol))).toFixed(1);
  const curve = (x1, y1, x2, y2, cls, w, arrow) => `<path class="${cls}" ${w ? `stroke-width="${w}"` : ''} ${arrow ? `marker-end="url(#${arrow})"` : ''} d="M${x1},${y1 + HEAD}C${(x1 + x2) / 2},${y1 + HEAD} ${(x1 + x2) / 2},${y2 + HEAD} ${x2},${y2 + HEAD}"/>`;
  const box = (n) => `<g class="g-node ${n.start ? 'start' : ''} ${n.linked ? 'linked' : ''}" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y + HEAD})" tabindex="0" role="button" aria-label="${esc(n.title)} : ${esc(n.sub)}">
      ${n.watch ? `<rect class="watch" x="-4" y="-4" width="${NW + 8}" height="${NH + 8}" rx="15"/>` : ''}
      <rect class="box" width="${NW}" height="${NH}" rx="12"/>
      <circle cx="24" cy="${NH / 2}" r="13" fill="${KIND_COLOR[n.kind]}" fill-opacity="0.15"/>
      <g class="glyph" transform="translate(24,${NH / 2})" stroke="${KIND_COLOR[n.kind]}">${GLYPH[n.icon] || GLYPH.wallet}</g>
      <text class="t1 ${n.named ? 'name' : ''}" x="46" y="21">${esc(n.title)}</text>
      <text class="t2" x="46" y="37">${esc(n.sub)}</text>
      ${n.start ? `<g class="g-tag"><rect x="${NW - 62}" y="-9" width="54" height="16" rx="8"/><text x="${NW - 35}" y="2.5" text-anchor="middle">DÉPART</text></g>` : ''}
    </g>`;
  let edges = '', marks = '';
  for (const n of c.nodes) {
    for (const k of n.kids) {
      edges += curve(n.x + NW, n.y + NH / 2, k.x - 5, k.y + NH / 2, k.lead ? 'g-edge lead' : 'g-edge', width(k.inSol || 0), 'arr');
      if (k.inSol) edges += `<text class="g-amt" x="${k.x - 9}" y="${k.y + NH / 2 - 7 + HEAD}" text-anchor="end">${sol(k.inSol)} SOL</text>`;
    }
    marks += box(n);
  }
  for (const g of c.groups) {
    edges += curve(g.of.x + NW, g.of.y + NH / 2, g.x, g.y + g.h / 2, 'g-make');
    const hidden = g.toks.length - g.shown.length;
    marks += `<g class="g-tok" transform="translate(${g.x},${g.y + HEAD})">
      <rect class="box" width="${TW}" height="${g.h}" rx="12"/>
      <text class="t2" x="14" y="20">${plural(g.toks.length, 'token', 'tokens')}${hidden > 0 ? ` · ${g.shown.length} derniers` : ''}</text>
      <text class="t1 pnl ${g.net > 0.0005 ? 'pos' : g.net < -0.0005 ? 'neg' : ''}" x="${TW - 14}" y="20" text-anchor="end">${signed(g.net)} SOL</text>
      ${g.shown.map((tk, i) => `<a href="https://pump.fun/coin/${esc(tk.mint)}" target="_blank" rel="noopener"><rect class="sq" x="${14 + (i % 16) * 11}" y="${30 + Math.floor(i / 16) * 11}" width="9" height="9" rx="2.5" fill="${STATUS_SQ[tk.status] || 'var(--dim)'}"><title>${esc(tk.name)} · ${STATUS[tk.status]?.label || tk.status} · ${signed(tk.pnlSol)} SOL</title></rect></a>`).join('')}
    </g>`;
  }
  for (const x of c.cash) {
    for (const f of x.from) {
      const fx = f.group ? f.group.x + TW : f.x + NW, fy = f.group ? f.group.y + f.group.h / 2 : f.y + NH / 2;
      edges += curve(fx, fy, x.x - 5, x.y + NH / 2, 'g-out', width(x.cash.sol / x.from.length), 'arr-out');
    }
    marks += box(x);
  }
  const bands = [c.groups.length && [c.tokX - 12, TW + 24], c.cash.length && [c.cashX - 12, NW + 24]].filter(Boolean)
    .map(([x, w]) => `<rect class="band" x="${x}" y="${HEAD - 12}" width="${w}" height="${c.h - HEAD + 24}" rx="14"/>`).join('');
  el.innerHTML = `
    <div class="card-head">
      <div><div class="eyebrow">${esc(r.pattern?.title || 'Circuit de l\'argent')}</div></div>
      <div class="legend">
        <span><i class="dot amber"></i>Exchange</span>
        <span><i class="dot purple"></i>Wallet mère</span>
        <span><i class="dot red"></i>Rug</span>
        <span><i class="dot blue"></i>Dev en position</span>
        <span><i class="dot"></i>En attente</span>
        <span><i class="ring"></i>À surveiller</span>
        <span><i class="dash"></i>Lié sans financement direct</span>
        <span><i class="dash out"></i>Sortie d'argent</span>
      </div>
    </div>
    <div class="graph-box hero"><svg width="${c.w + 16}" height="${c.h + 16}" viewBox="-8 -4 ${c.w + 16} ${c.h + 16}">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0L8,4L0,8z" fill="#5b5577"/></marker>
        <marker id="arr-out" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0L8,4L0,8z" fill="#f5a524"/></marker>
      </defs>
      ${bands}
      ${c.heads.map((h) => `<text class="g-head" x="${h.x}" y="10">${h.text}</text>`).join('')}
      ${edges}${marks}
    </svg></div>`;
  const all = [...c.nodes, ...c.cash];
  const pick = (id) => {
    const node = all.find((n) => n.id === id);
    state.selected = id;
    $$('.g-node', el).forEach((g) => g.classList.toggle('sel', g.dataset.id === id));
    $('#detail-card').hidden = !node;
    if (!node) return;
    if (node.lead) {
      const l = node.lead;
      $('#detail').innerHTML = `<h3>${addrHtml(node.id)}</h3><div class="badges">${badge('green', 'En attente, rien lancé')}${badge('amber', 'Piste exchange')}</div>
        <dl><dt>Reçu</dt><dd>${nf(l.sol, 4)} SOL de ${esc(l.exchange)}</dd><dt>Envoyé</dt><dd>${ago(l.time)}</dd><dt>Relais</dt><dd>${l.hops}</dd><dt>Solde actuel</dt><dd>${sol(l.balanceSol)} SOL</dd></dl>
        <button class="btn sm" style="margin-top:12px" data-trace="${esc(node.id)}">Tracer ce wallet</button>`;
    } else renderDetail($('#detail'), r, node);
  };
  $$('.g-node', el).forEach((g) => {
    g.onclick = () => pick(g.dataset.id);
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g.dataset.id); } };
  });
}

function renderDetail(el, r, node) {
  if (!node) { el.innerHTML = '<div class="empty">Clique sur une case.</div>'; return; }
  if (node.cash) {
    const c = node.cash;
    const what = c.depositOf ? `Adresse de dépôt ${c.depositOf} : tout wallet qui y envoie du SOL appartient au même compte.`
      : c.kind === 'exchange' ? `Hot wallet ${c.label}.`
        : c.kind === 'busy' ? 'Wallet à très forte activité : exchange ou bot probable.'
          : 'Wallet extérieur au cluster.';
    el.innerHTML = `<h3>${addrHtml(c.address)}</h3><div class="badges">${badge(node.kind === 'exchange' ? 'amber' : 'gray', 'Sortie d\'argent')}</div>
      <p class="sub" style="margin-top:10px">${esc(what)}</p>
      <dl><dt>Total reçu</dt><dd>${sol(c.sol)} SOL</dd><dt>Transferts</dt><dd>${c.count}</dd><dt>Dernier envoi</dt><dd>${date(c.last)}</dd></dl>
      <ul>${c.from.map((a) => `<li><span>${addrHtml(a)}</span><span class="mut">envoie</span></li>`).join('')}</ul>`;
    return;
  }
  if (node.ext) {
    el.innerHTML = `<h3>${addrHtml(node.id)}</h3><div class="badges">${badge('amber', `Exchange ${node.title}`)}</div><p class="sub" style="margin-top:12px">A financé un wallet lié au cluster par ses sorties.</p>`;
    return;
  }
  if (node.terminal) {
    const info = terminalInfo(r.terminal);
    el.innerHTML = `<h3>${addrHtml(node.id)}</h3><div class="badges">${badge(info.color, info.text)}</div><p class="sub" style="margin-top:12px">${esc(info.sub)}</p>`;
    return;
  }
  const w = node.wallet;
  const toks = r.tokens.filter((t) => t.creator === w.address);
  const tags = [w.isStart && badge('gray', 'Départ'), w.isMother && badge('purple', 'Wallet mère'), w.candidate && badge('green', 'Candidat'), w.rugs > 0 && badge('red', plural(w.rugs, 'rug', 'rugs')), linkBadge(w.link)].filter(Boolean).join('');
  el.innerHTML = `
    <h3>${addrHtml(w.address)}</h3>
    ${tags ? `<div class="badges">${tags}</div>` : ''}
    ${w.link ? `<p class="sub" style="margin-top:10px">${esc(linkText(w.link))}</p>` : ''}
    <dl>
      <dt>Financé par</dt><dd>${w.funder ? `${w.funderLabel ? `${esc(w.funderLabel)} ` : ''}${addrHtml(w.funder)}` : '—'}</dd>
      <dt>Montant reçu</dt><dd>${w.funder ? `${nf(w.fundedSol, 3)} SOL` : '—'}</dd>
      <dt>Date</dt><dd>${date(w.fundedAt)}</dd>
      <dt>Solde actuel</dt><dd>${sol(w.balanceSol)} SOL</dd>
      <dt>Transactions</dt><dd>${w.txCount}${w.truncated ? ' (tronqué)' : ''}</dd>
      <dt>Wallets financés</dt><dd>${w.children}</dd>
      <dt>Dernière activité</dt><dd>${ago(w.lastTx)}</dd>
    </dl>
    ${toks.length ? `<ul>${toks.slice(0, 12).map((t) => `<li><span>${tokenCell(t)}</span>${statusBadge(t.status)}</li>`).join('')}${toks.length > 12 ? `<li class="mut">et ${toks.length - 12} autres dans l'onglet Tokens</li>` : ''}</ul>` : ''}`;
}

// ---------- tracker et qualification (méthode F Project) ----------
const TRACK_VERDICT = { track: ['green', 'À suivre'], dig: ['amber', 'À creuser'], reject: ['red', 'À rejeter'] };

// Ce qu'il faut mettre dans le tracker : l'adresse de la source, la plage de montant, les options.
function trackerCard(r) {
  const t = r.tracker;
  if (!t) return '';
  const range = t.minSol != null ? `${nf(t.minSol, 4)} – ${nf(t.maxSol, 4)}` : null;
  return `<div class="card tracker t-${t.verdict}">
    <div class="tk-head"><div class="eyebrow">Tracker</div>${badge(...TRACK_VERDICT[t.verdict])}</div>
    ${t.address ? `<div class="tk-boxes">
      <div class="tk-box"><span>${t.kind === 'mother' ? 'Wallet mère à suivre' : 'Adresse de l\'exchange à suivre'}</span><b>${esc(t.name)}</b><div>${addrHtml(t.address, `${t.address.slice(0, 8)}…${t.address.slice(-8)}`)}</div></div>
      <div class="tk-box"><span>Plage de montant</span><b class="mono">${range} SOL</b><button class="btn sm" data-copy="${esc(`${t.minSol}-${t.maxSol}`)}">Copier la plage</button></div>
      <div class="tk-box"><span>Options</span><div class="chips">${(t.options || []).map((o) => `<i>${esc(o)}</i>`).join('')}</div></div>
    </div>` : ''}
    <p class="sub">${esc(t.reason)}</p>
  </div>`;
}

const QUAL_VERDICT = {
  qualified: ['green', 'Qualifié'],
  negative: ['red', 'Négatif'],
  thin: ['amber', 'Échantillon trop mince'],
  none: ['gray', 'Aucune bougie exploitable'],
};

function renderQualif(el, r) {
  const q = r.qualification;
  const pool = r.tokens.length + (r.siblingTokens?.length || 0);
  const n = Math.min(30, pool);
  const launch = (label) => `<button class="btn primary" id="qual-btn" ${n ? '' : 'disabled'}>${label}</button>`;
  const reject = r.tracker?.verdict === 'reject' ? `<div class="card notice"><i class="dot red"></i><div><strong>Rien à suivre ici pour l'instant.</strong><span>${esc(r.tracker.reason)}</span></div></div>` : '';
  const intro = `<p class="sub">Entrée du sniper estimée à 75 % de la clôture de la première bougie. Un token compte s'il a offert +100 % depuis cette entrée ; sinon la perte est le retour au plancher de la courbe. Il faut 20 tokens sur 72 h pour conclure.</p>`;
  if (!q) {
    el.innerHTML = `${reject}<div class="card">
      <div class="card-head"><div><div class="eyebrow">Qualification du rugger</div>${intro}</div>${launch('Lancer la qualification')}</div>
      <div class="empty" id="qual-state">${n ? `${plural(n, 'token', 'tokens')} à analyser, 5 par minute : environ ${Math.max(1, Math.ceil(n / 5))} min la première fois. Les bougies restent en cache.` : 'Aucun token dans cette enquête.'}</div>
    </div>`;
  } else {
    const s = q.summary;
    const rows = q.tokens.filter((t) => t.gainPct != null);
    el.innerHTML = `${reject}
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Qualification du rugger</div>${intro}</div><div class="qual-side">${badge(...QUAL_VERDICT[s.verdict])}${launch('Relancer')}</div></div>
        <div class="empty" id="qual-state" hidden></div>
      </div>
      <div class="grid4">
        <div class="stat"><div class="lab">Tokens analysés</div><div class="val">${s.analysed}<small>/ 20 requis</small></div><div class="foot">Sur ${dur(s.spanHours * 3600)} (72 h requises)${s.missing ? ` · ${s.missing} sans bougies` : ''}</div></div>
        <div class="stat"><div class="lab">Ont offert +100 %</div><div class="val">${s.hits}<small>sur ${s.analysed} · ${Math.round(s.hitRate * 100)} %</small></div><div class="foot">Repère : un tiers ou plus</div></div>
        <div class="stat"><div class="lab">Gain moyen par trade</div><div class="val ${netClass(s.avgGainPct)}">${s.avgGainPct > 0 ? '+' : ''}${nf(s.avgGainPct, 0)} %</div><div class="foot">Sortie à +100 %, sinon stop au plancher (${nf(s.avgNaturalSlPct, 0)} % en moyenne)</div></div>
        <div class="stat"><div class="lab">Achat minimum</div><div class="val">${s.minBuySol ? `${nf(s.minBuySol, 2)}<small>SOL</small>` : '—'}</div><div class="foot">${s.minBuySol ? 'Pour couvrir 0,038 SOL de frais par aller-retour' : 'Gain moyen nul ou négatif : aucun montant ne couvre les frais'}</div></div>
      </div>
      ${rows.length ? `<div class="card">
        <div class="card-head"><div><div class="eyebrow">Plus haut atteint depuis l'entrée, par token</div><p class="sub">Du plus ancien au plus récent. La ligne marque +100 %.</p></div>
          <div class="legend"><span><i class="dot"></i>A offert +100 %</span><span><i class="dot gray"></i>Non</span></div></div>
        <div class="chart" id="qual-chart"></div>
      </div>
      <div class="card"><div id="tbl-qual"></div></div>` : ''}`;
    if (rows.length) {
      drawQual($('#qual-chart'), rows);
      table($('#tbl-qual'), 'qual', [
        { id: 'name', label: 'Token', val: (t) => (t.name || '').toLowerCase(), html: (t) => tokenCell(t) },
        { id: 'createdAt', label: 'Créé le', num: true, val: (t) => t.createdAt, html: (t) => `<span class="mut">${date(t.createdAt)}</span>` },
        { id: 'firstCandleMcSol', label: 'MC 1re bougie', num: true, val: (t) => t.firstCandleMcSol, html: (t) => `${nf(t.firstCandleMcSol, 1)} SOL` },
        { id: 'entryMcSol', label: 'Entrée estimée', num: true, val: (t) => t.entryMcSol, html: (t) => `${nf(t.entryMcSol, 1)} SOL` },
        { id: 'athMcSol', label: 'Plus haut', num: true, val: (t) => t.athMcSol, html: (t) => `${nf(t.athMcSol, 1)} SOL<div class="cell-sub">après ${t.minutesToAth} min</div>` },
        { id: 'gainPct', label: 'Gain max', num: true, val: (t) => t.gainPct, html: (t) => `<span class="${t.hit ? 'pos' : 'mut'}">${t.gainPct > 0 ? '+' : ''}${nf(t.gainPct, 0)} %</span>` },
        { id: 'hit', label: '+100 %', val: (t) => (t.hit ? 1 : 0), html: (t) => (t.hit ? badge('green', 'Atteint') : badge('gray', 'Non')) },
        { id: 'naturalSlPct', label: 'Stop naturel', num: true, val: (t) => t.naturalSlPct, html: (t) => `${nf(t.naturalSlPct, 0)} %` },
      ], rows, 'createdAt');
    }
  }
  const btn = $('#qual-btn');
  if (btn) btn.onclick = async () => {
    const st = $('#qual-state');
    btn.disabled = true;
    st.hidden = false;
    st.textContent = 'Démarrage…';
    try {
      const { id } = await api(`/api/investigations/${r.id}/qualify`, { method: 'POST' });
      const es = new EventSource(`/api/trace/${id}/events`);
      state.es = es;
      es.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === 'log') st.textContent = e.msg;
        else if (e.type === 'done') { es.close(); state.es = null; api(`/api/investigations/${r.id}`).then((fresh) => { state.result = fresh; state.tab = 'qualif'; renderResult(); }); }
        else if (e.type === 'error') { es.close(); state.es = null; st.textContent = `La qualification a échoué : ${e.msg}`; btn.disabled = false; }
      };
      es.onerror = () => { if (state.es === es) { es.close(); state.es = null; st.textContent = 'Qualification interrompue. Relance-la.'; btn.disabled = false; } };
    } catch (ex) {
      st.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// Une colonne par token : gain maximal depuis l'entrée, plafonné à +300 % pour rester lisible.
function drawQual(el, rows) {
  const list = [...rows].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const W = 760, H = 220, L = 46, R = 8, T = 12, B = 8, CAP = 300;
  const y = (v) => T + (H - T - B) * (1 - Math.max(0, Math.min(CAP, v)) / CAP);
  const pw = (W - L - R) / Math.max(list.length, 10), bw = Math.max(3, Math.min(30, pw - 2));
  let marks = '';
  list.forEach((t, i) => {
    const x = L + pw * i + pw / 2 - bw / 2, top = y(t.gainPct), h = y(0) - top;
    if (h >= 0.5) {
      const r = Math.min(4, bw / 2, h);
      marks += `<path class="col ${t.hit ? 'gain' : 'flat'}" data-i="${i}" d="M${x},${y(0)}V${top + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y(0)}z"/>`;
    }
    marks += `<rect class="hit" data-i="${i}" x="${L + pw * i}" y="${T}" width="${pw}" height="${H - T - B}"/>`;
  });
  const ticks = [0, 100, 200, 300];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gain maximal depuis l'entrée, par token">
    <g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <line class="target" x1="${L}" x2="${W - R}" y1="${y(100)}" y2="${y(100)}"/>
    <g class="axis">${ticks.map((v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${`+${v} %`}</text>`).join('')}</g>${marks}</svg>`;
  el.onmousemove = (e) => {
    const hit = e.target.closest('[data-i]');
    $$('.col', el).forEach((c) => c.classList.remove('hot'));
    if (!hit) return hideTip();
    const t = list[+hit.dataset.i];
    $(`.col[data-i="${hit.dataset.i}"]`, el)?.classList.add('hot');
    showTip(`<b>${esc((t.name || '').slice(0, 30))} · ${t.gainPct > 0 ? '+' : ''}${nf(t.gainPct, 0)} %</b><span>Entrée ${nf(t.entryMcSol, 1)} SOL · plus haut ${nf(t.athMcSol, 1)} SOL après ${t.minutesToAth} min</span>`, e.clientX, e.clientY);
  };
  el.onmouseleave = () => { hideTip(); $$('.col', el).forEach((c) => c.classList.remove('hot')); };
}

// ---------- bilan ----------
function tally(tokens) {
  const bought = tokens.reduce((s, t) => s + t.boughtSol, 0);
  const sold = tokens.reduce((s, t) => s + t.soldSol, 0);
  const exits = tokens.map((t) => t.holdSeconds).filter((x) => x != null).sort((a, b) => a - b);
  return {
    n: tokens.length, bought, sold, net: sold - bought,
    wins: tokens.filter((t) => t.pnlSol > 0.0005).length, losses: tokens.filter((t) => t.pnlSol < -0.0005).length,
    rugs: tokens.filter((t) => t.status === 'rug').length, holding: tokens.filter((t) => t.status === 'holding').length,
    best: tokens.reduce((b, t) => (!b || t.pnlSol > b.pnlSol ? t : b), null), worst: tokens.reduce((b, t) => (!b || t.pnlSol < b.pnlSol ? t : b), null),
    medianExit: exits.length ? exits[Math.floor(exits.length / 2)] : null,
  };
}
const netClass = (v) => (v > 0.0005 ? 'pos' : v < -0.0005 ? 'neg' : '');
const tiles = (a) => `<div class="grid4">
    <div class="stat"><div class="lab">Tokens lancés</div><div class="val">${a.n}</div><div class="foot">${plural(a.rugs, 'rug probable', 'rugs probables')} · ${a.holding} encore en position</div></div>
    <div class="stat"><div class="lab">SOL investi par le dev</div><div class="val">${sol(a.bought)}<small>SOL</small></div><div class="foot">Achats sur ses propres tokens</div></div>
    <div class="stat"><div class="lab">SOL récupéré</div><div class="val">${sol(a.sold)}<small>SOL</small></div><div class="foot">Ventes sur ses propres tokens</div></div>
    <div class="stat"><div class="lab">Résultat net</div><div class="val ${netClass(a.net)}">${signed(a.net)}<small>SOL</small></div><div class="foot">${plural(a.wins, 'token gagnant', 'tokens gagnants')} · ${plural(a.losses, 'perdant', 'perdants')}</div></div>
  </div>`;

function renderBilan(el, r) {
  const mine = r.tokens.filter((t) => t.creator === r.start);
  const a = tally(mine);
  const all = tally(r.tokens);
  const others = r.tokens.length > mine.length;
  const perWallet = r.wallets.map((w) => ({ w, t: tally(r.tokens.filter((x) => x.creator === w.address)) })).filter((x) => x.t.n);
  const outSol = r.cashouts.reduce((s, c) => s + c.sol, 0);
  el.innerHTML = `
    <div class="card bilan-head"><div class="eyebrow">Adresse suivie</div><p class="sub">${addrHtml(r.start, `${r.start.slice(0, 6)}…${r.start.slice(-6)}`)} · ce que ce wallet a lancé, et ce que le dev y a gagné ou perdu.</p></div>
    ${mine.length ? `${tiles(a)}
    <div class="grid2">
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Gain ou perte par token</div><p class="sub">Du plus ancien au plus récent, en SOL. Au-dessus de la ligne : le dev a gagné.</p></div>
          <div class="legend"><span><i class="dot"></i>Gain</span><span><i class="dot red"></i>Perte</span></div></div>
        <div class="chart" id="pnl-chart"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">En bref</div></div></div>
        <dl class="facts">
          <dt>Meilleur coup</dt><dd>${a.best ? `${esc(a.best.name.slice(0, 22))} <span class="${netClass(a.best.pnlSol)}">${signed(a.best.pnlSol)} SOL</span>` : '—'}</dd>
          <dt>Pire coup</dt><dd>${a.worst ? `${esc(a.worst.name.slice(0, 22))} <span class="${netClass(a.worst.pnlSol)}">${signed(a.worst.pnlSol)} SOL</span>` : '—'}</dd>
          <dt>Sortie du dev (médiane)</dt><dd>${a.medianExit != null ? `${dur(a.medianExit)} après la création` : '—'}</dd>
          <dt>Gain moyen par token</dt><dd><span class="${netClass(a.net / a.n)}">${signed(a.net / a.n)} SOL</span></dd>
          <dt>Premier lancement</dt><dd>${date(Math.min(...mine.map((t) => t.createdAt || Infinity)))}</dd>
          <dt>Dernier lancement</dt><dd>${ago(Math.max(...mine.map((t) => t.createdAt || 0)))}</dd>
        </dl>
      </div>
    </div>
    <div class="card"><div class="card-head"><div><div class="eyebrow">Tokens lancés par cette adresse</div></div></div><div id="tbl-mine"></div></div>`
    : '<div class="card"><div class="empty">Cette adresse n\'a lancé aucun token pump.fun dans l\'historique lu. Le bilan du cluster est plus bas.</div></div>'}
    ${others || r.wallets.length > 1 ? `<div class="card bilan-head"><div class="eyebrow">Tout le cluster</div><p class="sub">${plural(r.wallets.length, 'wallet lié', 'wallets liés')} · ${sol(outSol)} SOL sortis vers l'extérieur.</p></div>
    ${tiles(all)}
    <div class="card"><div class="card-head"><div><div class="eyebrow">Bilan par wallet</div></div></div><div id="tbl-wallets"></div></div>` : ''}
    <p class="sub note">Le résultat compte les achats et ventes du dev sur ses propres tokens, depuis les wallets trouvés. Les wallets d'achat groupé non reliés au cluster et les frais n'y sont pas.</p>`;
  if (mine.length) {
    drawPnl($('#pnl-chart'), mine);
    table($('#tbl-mine'), 'mine', [
      { id: 'name', label: 'Token', val: (t) => t.name.toLowerCase(), html: (t) => tokenCell(t) },
      { id: 'status', label: 'Statut', val: (t) => t.status, html: (t) => statusBadge(t.status) },
      { id: 'createdAt', label: 'Créé le', num: true, val: (t) => t.createdAt, html: (t) => `<span class="mut">${date(t.createdAt)}</span>` },
      { id: 'boughtSol', label: 'Investi', num: true, val: (t) => t.boughtSol, html: (t) => `${sol(t.boughtSol)} SOL` },
      { id: 'soldSol', label: 'Récupéré', num: true, val: (t) => t.soldSol, html: (t) => `${sol(t.soldSol)} SOL` },
      { id: 'pnlSol', label: 'Gain net', num: true, val: (t) => t.pnlSol, html: (t) => `<span class="${netClass(t.pnlSol) || 'mut'}">${signed(t.pnlSol)} SOL</span>` },
      { id: 'holdSeconds', label: 'Sortie après', num: true, val: (t) => t.holdSeconds, html: (t) => dur(t.holdSeconds) },
      { id: 'mcap', label: 'Market cap', num: true, val: (t) => t.market?.marketCap ?? null, html: (t) => (t.market ? usd(t.market.marketCap) : '<span class="mut">inconnu</span>') },
    ], mine, 'createdAt');
  }
  if ($('#tbl-wallets')) {
    table($('#tbl-wallets'), 'perWallet', [
      { id: 'address', label: 'Wallet', val: (x) => x.w.address, html: (x) => `${addrHtml(x.w.address)} ${x.w.isStart ? badge('gray', 'Départ') : ''}` },
      { id: 'n', label: 'Tokens', num: true, val: (x) => x.t.n, html: (x) => x.t.n },
      { id: 'rugs', label: 'Rugs', num: true, val: (x) => x.t.rugs, html: (x) => x.t.rugs },
      { id: 'bought', label: 'Investi', num: true, val: (x) => x.t.bought, html: (x) => `${sol(x.t.bought)} SOL` },
      { id: 'sold', label: 'Récupéré', num: true, val: (x) => x.t.sold, html: (x) => `${sol(x.t.sold)} SOL` },
      { id: 'net', label: 'Résultat net', num: true, val: (x) => x.t.net, html: (x) => `<span class="${netClass(x.t.net) || 'mut'}">${signed(x.t.net)} SOL</span>` },
    ], perWallet, 'net');
  }
}

// Une colonne par token, dans l'ordre de création. Gain au-dessus de zéro, perte en dessous.
function drawPnl(el, tokens) {
  const list = [...tokens].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const W = 760, H = 240, L = 46, R = 8, T = 12, B = 14;
  const hi = Math.max(0, ...list.map((t) => t.pnlSol)), lo = Math.min(0, ...list.map((t) => t.pnlSol));
  const span = hi - lo || 1;
  const y = (v) => T + (H - T - B) * ((hi - v) / span);
  const pw = (W - L - R) / Math.max(list.length, 8);
  const bw = Math.max(3, Math.min(34, pw - 2));
  let marks = '';
  list.forEach((t, i) => {
    const cx = L + pw * i + pw / 2, x = cx - bw / 2, v = t.pnlSol;
    const h = Math.abs(y(v) - y(0));
    if (h >= 0.5) {
      const r = Math.min(4, bw / 2, h);
      marks += v >= 0
        ? `<path class="col gain" data-i="${i}" d="M${x},${y(0)}V${y(v) + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y(0)}z"/>`
        : `<path class="col loss" data-i="${i}" d="M${x},${y(0)}V${y(v) - r}a${r},${r} 0 0 0 ${r},${r}h${bw - 2 * r}a${r},${r} 0 0 0 ${r},${-r}V${y(0)}z"/>`;
    }
    marks += `<rect class="hit" data-i="${i}" x="${L + pw * i}" y="${T}" width="${pw}" height="${H - T - B}"/>`;
  });
  const tick = (v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
  const lab = (v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : signed(v)}</text>`;
  const vals = [...new Set([hi, 0, lo])];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gain ou perte du dev par token, en SOL"><g class="grid">${vals.map(tick).join('')}</g><line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><g class="axis">${vals.map(lab).join('')}</g>${marks}</svg>`;
  el.onmousemove = (e) => {
    const hit = e.target.closest('[data-i]');
    $$('.col', el).forEach((c) => c.classList.remove('hot'));
    if (!hit) return hideTip();
    const t = list[+hit.dataset.i];
    $(`.col[data-i="${hit.dataset.i}"]`, el)?.classList.add('hot');
    showTip(`<b>${esc(t.name.slice(0, 30))} · ${signed(t.pnlSol)} SOL</b><span>Investi ${sol(t.boughtSol)} · récupéré ${sol(t.soldSol)} · ${date(t.createdAt)}</span>`, e.clientX, e.clientY);
  };
  el.onmouseleave = () => { hideTip(); $$('.col', el).forEach((c) => c.classList.remove('hot')); };
}

// ---------- tableaux triables ----------
function table(el, key, cols, rows, defaultSort) {
  const st = state.sort[key] || (state.sort[key] = { col: defaultSort, dir: -1 });
  const col = cols.find((c) => c.id === st.col) || cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.val(a), y = col.val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st.dir;
  });
  el.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.id === st.col ? 'sorted' : ''}" data-col="${c.id}" aria-sort="${c.id === st.col ? (st.dir < 0 ? 'descending' : 'ascending') : 'none'}">${c.label}${c.id === st.col ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((row) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $$('th', el).forEach((th) => {
    th.onclick = () => {
      if (st.col === th.dataset.col) st.dir *= -1; else { st.col = th.dataset.col; st.dir = -1; }
      table(el, key, cols, rows, defaultSort);
    };
  });
}

// Carnet d'adresses : les adresses du rugger classées par rôle, prêtes à copier dans un tracker de wallets.
function renderWallets(el, r) {
  const W = r.wallets;
  const net = new Map();
  for (const t of r.tokens) net.set(t.creator, (net.get(t.creator) || 0) + t.pnlSol);
  const life = (w) => `Actif ${ago(w.lastTx)} · solde ${sol(w.balanceSol)} SOL`;
  const isCollector = (w) => w.link?.type === 'collects';

  const waiting = [
    ...W.filter((w) => w.candidate).map((w) => ({ address: w.address, icon: 'clock', color: KIND_COLOR.candidate, line: `${sol(w.balanceSol)} SOL en attente`, sub: `Financé ${ago(w.fundedAt)}${w.funder ? ` par ${short(w.funder)}` : ''}` })),
    ...leadCandidates(r).filter((l) => !W.some((w) => w.address === (l.end || l.address))).map((l) => ({ address: l.end || l.address, icon: 'clock', color: KIND_COLOR.candidate, line: `${sol(l.balanceSol)} SOL en attente`, sub: `A reçu ${nf(l.sol, 3)} SOL de ${esc(l.exchange)} ${ago(l.time)}` })),
  ];
  const devs = W.filter((w) => w.tokens > 0).sort((a, b) => (b.lastTx || 0) - (a.lastTx || 0)).map((w) => {
    const n = net.get(w.address) || 0;
    return {
      address: w.address, icon: 'wallet', color: w.rugs ? KIND_COLOR.rug : KIND_COLOR.dev,
      tag: `${w.isStart ? badge('gray', 'Départ') : ''}${w.isMother ? badge('purple', 'Mère') : ''}`,
      line: `${plural(w.tokens, 'token', 'tokens')} · ${plural(w.rugs, 'rug', 'rugs')} · <span class="${netClass(n)}">${signed(n)} SOL</span>`, sub: life(w),
    };
  });
  const feeders = W.filter((w) => !w.tokens && w.children > 0 && !isCollector(w)).map((w) => ({
    address: w.address, icon: w.isMother ? 'hub' : 'wallet', color: w.isMother ? KIND_COLOR.mother : KIND_COLOR.plain,
    tag: w.isStart ? badge('gray', 'Départ') : '', line: w.children >= 2 ? `Finance ${w.children} wallets` : 'Relais vers un autre wallet', sub: life(w),
  }));
  const collectors = W.filter(isCollector).map((w) => ({ address: w.address, icon: 'out', color: KIND_COLOR.exchange, line: `Reçoit les gains de ${plural(w.link.from.length, 'wallet', 'wallets')}`, sub: life(w) }));
  const deposits = r.cashouts.filter((c) => c.depositOf).map((c) => ({ address: c.address, icon: 'bank', color: KIND_COLOR.exchange, line: `Dépôt ${esc(c.depositOf)} · ${sol(c.sol)} SOL reçus`, sub: `Depuis ${plural(c.from.length, 'wallet', 'wallets')} · dernier envoi ${ago(c.last)}`, noTrace: true }));
  const others = W.filter((w) => !w.tokens && !w.children && !w.candidate && !isCollector(w)).map((w) => ({ address: w.address, icon: 'wallet', color: KIND_COLOR.plain, tag: w.isStart ? badge('gray', 'Départ') : '', line: 'Rien lancé, rien financé', sub: life(w) }));

  const groups = [
    ['À surveiller : financés, rien lancé', 'green', waiting],
    ['Wallets de dev', 'red', devs],
    ['Wallet mère et relais', 'purple', feeders],
    ['Wallets de collecte', 'amber', collectors],
    ['Adresses de dépôt sur exchange', 'amber', deposits],
    ['Autres wallets liés', 'gray', others],
  ].filter((g) => g[2].length);
  const all = [...new Set(groups.flatMap((g) => g[2].map((o) => o.address)))];
  const copyBtn = (list, label) => `<button class="btn sm" data-copy="${esc(list.join('\n'))}">${label}</button>`;
  const card = (o) => `<div class="wcard">
      <span class="wicon" style="--c:${o.color}"><svg viewBox="-9 -9 18 18" aria-hidden="true">${GLYPH[o.icon]}</svg></span>
      <div class="wmain">
        <div class="waddr">${addrHtml(o.address)} ${o.tag || ''}</div>
        <div class="wline">${o.line}</div>
        <div class="wsub">${o.sub}</div>
      </div>
      ${o.noTrace ? '' : `<button class="btn sm" data-trace="${esc(o.address)}">Tracer</button>`}
    </div>`;
  el.innerHTML = `
    <div class="card book-head">
      <div><div class="eyebrow">Carnet d'adresses du rugger</div><p class="sub">Ses adresses classées par rôle. Copie un groupe pour le coller dans ton tracker de wallets.</p></div>
      ${copyBtn(all, `Copier les ${all.length} adresses`)}
    </div>
    ${groups.map(([title, color, list]) => `<div class="card">
      <div class="card-head"><div class="group-title"><i class="dot ${color}"></i>${title}<span class="n">${list.length}</span></div>${copyBtn(list.map((o) => o.address), list.length > 1 ? `Copier les ${list.length}` : 'Copier')}</div>
      <div class="wgrid">${list.map(card).join('')}</div>
    </div>`).join('')}`;
}

function renderTokens(el, r) {
  if (!r.tokens.length) { el.innerHTML = '<div class="card"><div class="empty">Aucun token pump.fun créé par les wallets de ce cluster.</div></div>'; return; }
  el.innerHTML = `<div class="card"><div class="card-head"><div><div class="eyebrow">Tokens pump.fun créés</div><p class="sub">Achats et ventes additionnés sur tous les wallets du cluster.</p></div>
    <div class="legend">${Object.values(STATUS).map((s) => `<span title="${esc(s.help)}"><i class="dot ${s.color}"></i>${s.label}</span>`).join('')}</div></div><div id="tbl"></div></div>`;
  table($('#tbl'), 'tokens', [
    { id: 'name', label: 'Token', val: (t) => t.name.toLowerCase(), html: (t) => `${tokenCell(t)}<div class="cell-sub">${addrHtml(t.mint)}</div>` },
    { id: 'status', label: 'Statut', val: (t) => t.status, html: (t) => statusBadge(t.status) },
    { id: 'creator', label: 'Créateur', val: (t) => t.creator, html: (t) => addrHtml(t.creator) },
    { id: 'createdAt', label: 'Créé le', num: true, val: (t) => t.createdAt, html: (t) => `<span class="mut">${date(t.createdAt)}</span>` },
    { id: 'boughtSol', label: 'Achat dev', num: true, val: (t) => t.boughtSol, html: (t) => `${sol(t.boughtSol)} SOL` },
    { id: 'soldSol', label: 'Vente dev', num: true, val: (t) => t.soldSol, html: (t) => `${sol(t.soldSol)} SOL` },
    { id: 'pnlSol', label: 'Gain net', num: true, val: (t) => t.pnlSol, html: (t) => `<span class="${t.pnlSol > 0.0005 ? 'pos' : t.pnlSol < -0.0005 ? 'neg' : 'mut'}">${signed(t.pnlSol)} SOL</span>` },
    { id: 'soldPct', label: 'Vendu', num: true, val: (t) => t.soldPct, html: (t) => `${Math.round(t.soldPct * 100)} %` },
    { id: 'holdSeconds', label: 'Sortie après', num: true, val: (t) => t.holdSeconds, html: (t) => dur(t.holdSeconds) },
    { id: 'mcap', label: 'Market cap', num: true, val: (t) => t.market?.marketCap ?? null, html: (t) => (t.market ? `${usd(t.market.marketCap)}${t.market.migrated ? ' <span class="mut" title="A quitté la bonding curve">· migré</span>' : ''}` : '<span class="mut">inconnu</span>') },
  ], r.tokens, 'createdAt');
}

function renderCashouts(el, r) {
  if (!r.cashouts.length) { el.innerHTML = '<div class="card"><div class="empty">Aucune sortie de SOL vers l\'extérieur du cluster (au-dessus de 0,02 SOL).</div></div>'; return; }
  const kind = (c) => {
    if (c.kind === 'exchange') return badge('amber', `Exchange ${c.label}`);
    if (c.kind === 'swap') return badge('amber', c.label);
    if (c.depositOf) return badge('amber', `Dépôt ${c.depositOf} probable`);
    if (c.kind === 'busy') return badge('gray', 'Forte activité');
    return c.from.length > 1 ? badge('purple', 'Wallet commun') : badge('gray', 'Wallet externe');
  };
  el.innerHTML = `<div class="card"><div class="card-head"><div><div class="eyebrow">Sorties d'argent</div><p class="sub">Où part le SOL du cluster. Une adresse de dépôt d'exchange partagée par plusieurs wallets relie ces wallets au même compte.</p></div></div><div id="tbl"></div></div>`;
  table($('#tbl'), 'cash', [
    { id: 'address', label: 'Destination', val: (c) => c.address, html: (c) => addrHtml(c.address) },
    { id: 'kind', label: 'Type', val: (c) => (c.depositOf ? 'a' : c.kind), html: kind },
    { id: 'sol', label: 'Total envoyé', num: true, val: (c) => c.sol, html: (c) => `${sol(c.sol)} SOL` },
    { id: 'count', label: 'Transferts', num: true, val: (c) => c.count, html: (c) => c.count },
    { id: 'from', label: 'Depuis', num: true, val: (c) => c.from.length, html: (c) => `<span title="${esc(c.from.map(short).join(', '))}">${plural(c.from.length, 'wallet', 'wallets')}</span>` },
    { id: 'last', label: 'Dernier envoi', num: true, val: (c) => c.last, html: (c) => `<span class="mut">${date(c.last)}</span>` },
  ], r.cashouts, 'sol');
}

const SCAN_STATUS = {
  ok: 'fenêtre lue en entier',
  partial: 'fenêtre lue en partie',
  capped: 'lecture plafonnée, relance en mode plus profond pour tout lire',
  'out-of-reach': 'dépôts trop anciens pour être relus par ce RPC',
};
const FP_VERDICT = {
  reliable: ['green', 'Filtre fiable', 'La plupart des envois de ce montant mènent à un wallet qui a créé un token : les wallets en attente sont de vrais candidats.'],
  medium: ['amber', 'Filtre moyen', 'Une partie seulement des envois de ce montant mène à un créateur : à croiser avec un autre indice.'],
  weak: ['red', 'Filtre faible', 'Ce montant est trop courant chez cette source : la plupart des envois n\'ont rien à voir avec le dev.'],
  insufficient: ['gray', 'Trop peu d\'envois pour juger', 'Moins de 3 autres envois de ce montant dans la fenêtre lue.'],
};
const LEAD_STATUS = {
  waiting: (l) => badge('green', 'En attente, rien lancé'),
  created: (l) => badge('blue', `A créé ${plural(l.tokens, 'token', 'tokens')}`),
  cluster: () => badge('purple', 'Rejoint le cluster'),
  empty: () => badge('gray', 'Vide, rien lancé'),
  moved: (l) => badge('amber', `Reparti vers ${l.movedTo}`),
  busy: () => badge('gray', 'Forte activité'),
};

function renderLeads(el, r) {
  const fps = r.fingerprints || [];
  const scans = r.exchangeScan || [];
  const leads = r.leads || [];
  const fpLeads = leads.filter((l) => l.type === 'fingerprint');
  const depLeads = leads.filter((l) => l.type === 'same');
  if (!r.fingerprints) {
    el.innerHTML = '<div class="card"><div class="eyebrow">Pistes exchange</div><div class="empty">Cette enquête date d\'avant cette fonction. Relance la traque pour chercher les pistes.</div></div>';
    return;
  }
  const fpCard = (f) => {
    const [color, label, help] = FP_VERDICT[f.verdict];
    const covered = f.status === 'ok' ? `${f.windowHours} h lues` : `${nf(f.coveredHours, 1)} h lues sur ${f.windowHours} h (lecture plafonnée)`;
    return `<div class="fp">
      <div class="fp-head"><div><b>${esc(f.name)}</b> envoie <b>${nf(f.sol, 4)} SOL</b> <span class="mut">· filtre de ${nf(f.sol - f.tolSol, 4)} à ${nf(f.sol + f.tolSol, 4)} SOL</span></div>${badge(color, label)}</div>
      <div class="fp-nums">
        <div><b>${f.sends}</b><span>${f.sends > 1 ? 'autres envois' : 'autre envoi'} de ce montant</span></div>
        <div><b>${f.verified}</b><span>${f.verified > 1 ? 'suivis' : 'suivi'} de wallet en wallet</span></div>
        <div><b>${f.creators}</b><span>${f.creators > 1 ? 'mènent' : 'mène'} à un créateur de token</span></div>
        <div><b>${f.verified ? `${Math.round(f.rate * 100)} %` : '—'}</b><span>de réussite du filtre</span></div>
        <div><b>${f.waiting}</b><span>en attente, rien lancé</span></div>
      </div>
      <p class="sub">${esc(help)} ${covered}, ${plural(f.txRead, 'transaction', 'transactions')} de ${addrHtml(f.source)}.${f.kind === 'busy' ? ' Source sans label d\'exchange : elle sert à retrouver des wallets frères, pas de tracker.' : ''} ${f.known ? `${plural(f.known, 'envoi', 'envois')} vers des wallets déjà dans le cluster, non comptés.` : ''}</p>
    </div>`;
  };
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><div><div class="eyebrow">Filtre par montant exact</div><p class="sub">On prend le montant exact que la source a envoyé au dev, on relit ses envois récents à 0,0001 SOL près, et on suit chacun de wallet en wallet jusqu'à trouver un créateur de token. Le taux de réussite dit si le filtre vaut quelque chose.</p></div></div>
      ${fps.length ? fps.map(fpCard).join('') : '<div class="empty">La source de ce cluster n\'est ni un exchange ni un wallet à forte activité : pas de montant à filtrer.</div>'}
      ${fpLeads.length ? '<div id="tbl-fp"></div>' : ''}
    </div>
    ${scans.length ? `<div class="card">
      <div class="card-head"><div><div class="eyebrow">Retraits après un dépôt du dev</div><p class="sub">Quand le dev renvoie ses gains sur l'exchange, on cherche dans les heures suivantes un retrait du même montant (aux frais près) vers un autre wallet.</p></div></div>
      <ul class="scan">${scans.map((x) => `<li><i class="dot ${x.status === 'ok' ? '' : 'amber'}"></i><b>${esc(x.exchange)}</b> ${addrHtml(x.hot)} · ${plural(x.deposits, 'dépôt suivi', 'dépôts suivis')} · ${plural(x.read, 'transaction lue', 'transactions lues')} sur ${x.windowHours} h · ${SCAN_STATUS[x.status] || x.status}</li>`).join('')}</ul>
      ${depLeads.length ? '<div id="tbl-dep"></div>' : '<div class="empty">Aucun retrait du même montant vers un autre wallet dans la fenêtre lue.</div>'}
    </div>` : ''}`;
  if (fpLeads.length) {
    table($('#tbl-fp'), 'fpLeads', [
      { id: 'address', label: 'Wallet financé', val: (l) => l.address, html: (l) => `${addrHtml(l.address)}${l.hops ? `<div class="cell-sub">puis ${plural(l.hops, 'relais', 'relais')} → ${addrHtml(l.end)}</div>` : ''}` },
      { id: 'status', label: 'Résultat', val: (l) => l.status, html: (l) => (LEAD_STATUS[l.status] || LEAD_STATUS.busy)(l) },
      { id: 'sol', label: 'Reçu', num: true, val: (l) => l.sol, html: (l) => `${nf(l.sol, 4)} SOL<div class="cell-sub">${esc(l.exchange)}</div>` },
      { id: 'time', label: 'Envoyé', num: true, val: (l) => l.time, html: (l) => `<span class="mut">${ago(l.time)}</span>` },
      { id: 'createDelay', label: 'Création après', num: true, val: (l) => (l.createDelay == null ? null : -l.createDelay), html: (l) => (l.createDelay == null ? '<span class="mut">—</span>' : dur(l.createDelay)) },
      { id: 'balanceSol', label: 'Solde', num: true, val: (l) => l.balanceSol, html: (l) => `${sol(l.balanceSol)} SOL` },
      { id: 'score', label: 'Intérêt', num: true, val: (l) => l.score, html: (l) => `<span class="score" title="Plus haut si le wallet attend encore et si le filtre est fiable."><i style="width:${l.score}%"></i></span>${l.score}` },
      { id: 'go', label: '', val: () => 0, html: (l) => `<button class="btn sm" data-trace="${esc(l.end || l.address)}">Tracer</button>` },
    ], fpLeads, 'score');
  }
  if (depLeads.length) {
    table($('#tbl-dep'), 'depLeads', [
      { id: 'address', label: 'Wallet', val: (l) => l.address, html: (l) => `${addrHtml(l.address)} ${l.fresh ? badge('green', 'Neuf') : badge('gray', 'Existait déjà')}${l.tokens ? ` ${badge('blue', plural(l.tokens, 'token lancé', 'tokens lancés'))}` : ''}` },
      { id: 'score', label: 'Score', num: true, val: (l) => l.score, html: (l) => `<span class="score" title="Montant, délai, wallet neuf, tokens lancés. Baisse si plusieurs retraits ont le même montant."><i style="width:${l.score}%"></i></span>${l.score}` },
      { id: 'sol', label: 'Retrait', num: true, val: (l) => l.sol, html: (l) => `${nf(l.sol, 3)} SOL<div class="cell-sub">${esc(l.exchange)} · ${date(l.time)}${l.twins > 1 ? ` · ${l.twins} retraits de ce montant` : ''}</div>` },
      { id: 'depositSol', label: 'Dépôt du dev', num: true, val: (l) => l.depositSol, html: (l) => `${nf(l.depositSol, 3)} SOL<div class="cell-sub">${l.depositParts > 1 ? `somme de ${l.depositParts} dépôts` : `depuis ${short(l.depositFrom[0])}`}</div>` },
      { id: 'delaySeconds', label: 'Délai', num: true, val: (l) => -l.delaySeconds, html: (l) => dur(l.delaySeconds) },
      { id: 'balanceSol', label: 'Solde', num: true, val: (l) => l.balanceSol, html: (l) => `${sol(l.balanceSol)} SOL` },
      { id: 'go', label: '', val: () => 0, html: (l) => `<button class="btn sm" data-trace="${esc(l.address)}">Tracer</button>` },
    ], depLeads, 'score');
  }
}

// ---------- wallet tracker ----------
// les sorties du user : entre +100 % et +200 %, un seul achat par projet
const WSTRATS = [
  { id: 's1', short: 'Tout à +100 %' },
  { id: 't150', short: 'Tout à +150 %' },
  { id: 't200', short: 'Tout à +200 %' },
  { id: 's2', short: '50 % à +100 %, reste à +200 %' },
];
let walletEs = null;
function walletTotals(c, buy) {
  const copies = c.copies || [];
  return WSTRATS.map((st) => {
    const p = copies.map((x) => capPct(x.strategies?.[st.id]));
    return { ...st, pnl: p.reduce((a, v) => a + (buy * v) / 100, 0) - p.length * FEES, avg: p.length ? p.reduce((a, v) => a + v, 0) / p.length : 0, wins: p.filter((v) => v > 0).length };
  });
}
// sa stratégie, en clair : le genre de wallet, comment il entre, mise, sort, et ce que ça lui rapporte
const secTxt = (x) => (x == null ? '?' : x < 90 ? `${Math.round(x)} s` : x < 5400 ? `${Math.round(x / 60)} min` : `${nf(x / 3600, 1)} h`);
function styleBlock(c) {
  const st = c.style;
  if (!st) return '<div class="wc-style"><p class="mut">Relance l’analyse pour voir sa stratégie.</p></div>';
  const period = c.sampled ? `${c.sampled + 1} échantillons répartis sur 7 jours (${nf(st.hours, 1)} h d’activité lues)` : st.hours == null ? '' : st.hours < 48 ? `ses ${nf(st.hours, 1)} dernières heures` : `ses ${nf(st.hours / 24, 0)} derniers jours`;
  const pct = (x) => (x == null ? '?' : `${x > 0 ? '+' : ''}${nf(x, 0)} %`);
  const summary = `Il mise environ ${sol(st.size)} SOL par achat${st.sameSecond != null ? `, ${pct0(st.sameSecond)} du temps dans la seconde du lancement` : ''}, et garde ses tokens ${secTxt(st.hold)} en médiane. Il gagne ${pct0(st.winrate)} de ses trades (${pct(st.avgWin)} en moyenne) et perd le reste (${pct(st.avgLoss)} en moyenne)${st.tradesPerHour ? `, à environ ${nf(st.tradesPerHour, 0)} trades par heure` : ''}.`;
  const how = st.profitFactor == null ? ''
    : st.profitFactor >= 1 ? `Comment il gagne : sur ${period}, ses gains font ${nf(st.profitFactor, 1)} fois ses pertes, alors qu’il ne gagne que ${pct0(st.winrate)} de ses trades${st.stakeWin && st.stakeLoss && st.stakeWin > 1.3 * st.stakeLoss ? `. Le secret : il mise ${nf(st.stakeWin / st.stakeLoss, 1)} fois plus sur ses gagnants (il rachète ce qui monte) que sur ses perdants (petite mise de départ, vite coupée)` : '. Il gagne peu par trade mais sur beaucoup de trades'}.`
      : `Sur ${period}, il perd : ses gains ne couvrent que ${pct0(st.profitFactor)} de ses pertes (meilleur coup : ${signed(st.biggestWin || 0)} SOL). S’il est gagnant sur le mois, c’est grâce à de rares gros coups ou à de meilleures périodes, pas à chaque trade.`;
  const fact = (k, v) => `<div class="ws-fact"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="wc-style">
    <div class="ws-type"><b>${esc(st.type)}</b>${st.tags.length ? ` · ${esc(st.tags.join(' · '))}` : ''}</div>
    <p>${esc(summary)}</p>
    <div class="ws-facts">
      ${fact('Entrée', `${st.sameSecond != null ? `${pct0(st.sameSecond)} dans la seconde du lancement` : '?'}${st.entryMc ? ` · MC d’entrée ~${nf(st.entryMc, 0)} SOL` : ''}`)}
      ${fact('Mise', `~${sol(st.size)} SOL par achat · ${st.buysPerToken} achat${st.buysPerToken > 1 ? 's' : ''} par token${st.stakeWin != null && st.stakeLoss ? ` · ${sol(st.stakeWin)} SOL misés en tout sur un gagnant, ${sol(st.stakeLoss)} sur un perdant` : ''}`)}
      ${fact('Sortie', `gagnants vendus en ${secTxt(st.holdWin)} (${pct(st.avgWin)}) · perdants coupés en ${secTxt(st.holdLoss)} (${pct(st.avgLoss)})${st.sellsPerToken >= 2 ? ' · vend en plusieurs fois' : ''}`)}
      ${fact('Résultat', `<span class="${netClass(st.pnlSol)}">${signed(st.pnlSol)} SOL</span> sur ${st.trades} trades${period ? ` (${period})` : ''}${st.pnlPerHour != null ? ` · ${signed(st.pnlPerHour)} SOL / heure` : ''}`)}
    </div>
    ${how ? `<p class="mut">${esc(how)}</p>` : ''}
  </div>`;
}
// Bon à copier ? Règles du Wallet tracker (le wallet, pas le dev) : touche-t-il +100 % à chaque achat,
// en entrant sous 10 000 $ de market cap ; entre 3 et 30 trades par jour ; PnL 30 jours ; au moins 1 SOL pour 10 achats copiés
function walletVerdict(c) {
  if (c.mode !== 'tracker-v2') return { good: false, why: ['ancienne analyse (anciennes règles) : clique « Relancer »'], best: { pnl: 0, short: 'Tout à +100 %' }, n: 0, old: true };
  const v = c.verdict || { good: false, why: [] };
  return { good: !!v.good, why: [...(v.why || [])], best: { pnl: c.pnl100 || 0, short: 'Tout à +100 %' }, n: c.counted || 0 };
}
const usdShort = (x) => (x == null ? '—' : x >= 1000 ? `${nf(x / 1000, 1)} k$` : `${nf(x, 0)} $`);
function walletCard(c) {
  const v = c._verdict || walletVerdict(c);
  const head = `<div class="wc-head">${addrHtml(c.wallet)} ${badge(...(v.good ? ['green', 'Bon à copier'] : v.old ? ['gray', 'À relancer'] : ['red', 'Pas bon à copier']))}<span class="mut">${c.createdAt ? `analysé ${ago(c.createdAt / 1000)}` : ''}</span>
      <button class="btn sm" data-wallet-redo="${esc(c.wallet)}">Relancer</button><button class="btn sm del" data-wallet-del="${esc(c.wallet)}">Retirer</button></div>`;
  if (v.old) return `<div class="card wtcard">${head}<p class="mut">Cette analyse a été faite avec les anciennes règles. Relance-la pour avoir le verdict à +100 %, la market cap d’entrée et le PnL sur 30 jours.</p></div>`;
  const p30 = c.pnl30 || {};
  const stat = (val, l, cls = '') => `<div class="bt-stat"><b class="${cls}">${val}</b><span>${l}</span></div>`;
  const rows = (c.copies || []).slice().sort((x, y) => y.time - x.time).map((x) => `<tr class="${x.counted ? '' : 'mut'}"><td>${tokLink({ mint: x.mint })}</td><td class="mut">${date(x.time)}</td><td>${usdShort(x.entryUsd)}${x.counted ? '' : ' (trop tard)'}</td><td>${x.hit100 ? badge('green', '+100 % touché') : badge('red', 'pas de +100 %')}</td><td class="${netClass(x.pct100)}">${x.pct100 > 0 ? '+' : ''}${nf(x.pct100, 0)} %</td></tr>`).join('');
  return `<div class="card wtcard ${v.good ? 'good' : ''}">
    ${head}
    <p class="wc-you">${c.counted ? `<b>+100 % touché sur ${c.hits} de ses ${c.counted} achats tôt</b> (entrée sous 10 000 $ de market cap). <b class="${netClass(c.pnl100)}">Pour toi en vendant tout à +100 % : ${signed(c.pnl100)} SOL</b> (${sol(TRACKER_BUY)} SOL par achat, frais compris).` : '<b>Aucun achat tôt à rejouer</b> sur la période (tokens déjà vieux ou entrés au-dessus de 10 000 $).'}</p>
    <div class="wc-stats">
      ${stat(c.counted ? pct0(c.hits / c.counted) : '—', `de ses achats tôt touchent +100 % (${c.hits || 0}/${c.counted || 0})`, c.counted ? (c.hits / c.counted >= 0.5 ? 'pos' : 'neg') : '')}
      ${stat(p30.closed ? `${signed(p30.pnlSol)} SOL` : '—', `son PnL sur ${p30.days ? `${nf(Math.min(30, p30.days), 0)} jours` : '30 jours'} (${p30.wins || 0}/${p30.closed || 0} gagnants)${p30.partial ? ', lecture partielle' : ''}`, netClass(p30.pnlSol || 0))}
      ${stat(c.buys24h == null ? '—' : Number.isFinite(c.buys24h) ? c.buys24h : '300+', 'trades sur 24 h (3 à 30)', c.buys24h == null ? '' : c.buys24h >= 3 && c.buys24h <= 30 ? 'pos' : 'neg')}
      ${stat(usdShort(c.entryMedianUsd), 'market cap d’entrée médiane')}
      ${stat(c.late || 0, 'achats entrés au-dessus de 10 000 $ (ne comptent pas)')}
    </div>
    ${styleBlock(c)}
    ${!v.good && v.why.length ? `<p class="mut wc-note">Pas bon à copier : ${esc(v.why.join(' · '))}.</p>` : ''}
    ${c.foundOn ? `<p class="mut wc-note">Trouvé sur ${tokLink(c.foundOn)} (${esc(c.foundOn.role)}).</p>` : ''}
    ${v.good ? `<div class="snip-setup"><div class="st-t">Le réglage pour le copier dans F Project</div>
      <div class="st-v"><code class="big-addr">${esc(c.wallet)}</code><button class="btn sm primary" data-copy="${esc(c.wallet)}">Copier</button></div>
      <div class="optlist">
        <div class="optrow"><span class="opt">✓ Activé</span><b>Copier ses achats (Track Buys)</b><span class="mut">Le bot achète dans le même bloc que lui.</span></div>
        <div class="optrow"><span class="opt">✓ Activé</span><b>Acheter une seule fois (Buy Only Once)</b><span class="mut">Un achat par projet, comme tu fais.</span></div>
        <div class="optrow"><span class="opt">✓ 10 000 $</span><b>Max MC</b><span class="mut">Sur un copytrade, le filtre se base sur son entrée : ses achats trop tardifs sont ignorés.</span></div>
        <div class="optrow"><span class="opt">✓ +100 %</span><b>Take profit : vendre 100 %</b><span class="mut">Ta stratégie à +100 %.</span></div>
        <div class="optrow"><span class="opt off">✗ Désactivé</span><b>Copier ses ventes (Track Sells)</b><span class="mut">Tu vends à +100 %, pas avec lui.</span></div>
      </div></div>` : ''}
    ${rows ? `<details class="by-more"><summary>Ses ${c.copies.length} achats rejoués</summary><table class="wc-table"><thead><tr><th>Token</th><th>Acheté</th><th>MC d’entrée</th><th></th><th>Pour toi</th></tr></thead><tbody>${rows}</tbody></table></details>` : ''}
  </div>`;
}
// même groupe (« ring ») : deux wallets qui ont acheté en grande partie les mêmes coins ; on n'en copie qu'un
function sameRingUi(a, b) {
  const A = new Set((a.copies || []).map((x) => x.mint)); const B = new Set((b.copies || []).map((x) => x.mint));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const m of A) if (B.has(m)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.5;
}
function walletRow(c) {
  const v = c._verdict;
  return `<details class="wl-item ${v.good ? 'good' : ''}">
    <summary>
      <span class="wl-addr">${addrHtml(c.wallet)}</span>
      <span class="wl-you ${netClass(v.best.pnl)}">${v.n ? `${signed(v.best.pnl)} SOL` : '—'}</span>
      <span class="mut">${v.n ? `pour toi à +100 % · +100 % touché sur ${c.hits}/${v.n} achats tôt` : v.old ? 'ancienne analyse' : 'aucun achat tôt rejouable'}</span>
      <span class="mut">${c.pnl30?.closed ? `30 jours : ${signed(c.pnl30.pnlSol)} SOL` : ''}${c.buys24h != null ? ` · ${Number.isFinite(c.buys24h) ? c.buys24h : '300+'} trades/24 h` : ''}${c.style?.type ? ` · ${esc(c.style.type)}` : ''}</span>
      ${v.good ? '' : `<span class="wl-why">${esc(v.why[0] || '')}</span>`}
    </summary>
    ${walletCard(c)}
  </details>`;
}
async function renderWalletList() {
  const list = await api('/api/wallet/list').catch(() => []);
  const el = $('#wallet-result');
  if (!list.length) { el.innerHTML = '<div class="card"><div class="empty">Aucun wallet analysé pour l’instant.</div></div>'; return; }
  for (const c of list) c._verdict = walletVerdict(c);
  // un seul par groupe : le plus rentable reste « bon », les autres du même groupe passent dans « pas bons »
  const kept = [];
  for (const c of list.filter((x) => x._verdict.good).sort((a, b) => b._verdict.best.pnl - a._verdict.best.pnl)) {
    const ring = kept.find((k) => sameRingUi(k, c));
    if (ring) { c._verdict.good = false; c._verdict.why.unshift(`même groupe que ${short(ring.wallet)} (mêmes coins) : n’en copie qu’un`); } else kept.push(c);
  }
  const good = kept;
  const bad = list.filter((c) => !c._verdict.good).sort((a, b) => b._verdict.best.pnl - a._verdict.best.pnl);
  const open = state.wlOpen || 'good';
  el.innerHTML = `<div class="card">
    <div class="wl-toggles">
      <button class="wl-btn good ${open === 'good' ? 'on' : ''}" data-wl="good">✓ Bons à copier <b>${good.length}</b></button>
      <button class="wl-btn bad ${open === 'bad' ? 'on' : ''}" data-wl="bad">✗ Pas bons <b>${bad.length}</b></button>
    </div>
    <div class="wl-panel" data-panel="good" ${open === 'good' ? '' : 'hidden'}>${good.length ? `<p class="mut">Du plus rentable au moins rentable pour toi. Clique un wallet pour voir sa stratégie et le réglage F Project.</p>${good.map(walletRow).join('')}` : '<div class="empty">Aucun wallet bon à copier pour l’instant. Lance une chasse aux wallets ou analyse un wallet plus haut.</div>'}</div>
    <div class="wl-panel" data-panel="bad" ${open === 'bad' ? '' : 'hidden'}>${bad.map(walletRow).join('')}</div>
  </div>`;
}
function followWallet(id) {
  if (walletEs) walletEs.close();
  $('#wallet-btn').disabled = true;
  walletEs = new EventSource(`/api/trace/${id}/events`);
  const stop = () => { walletEs?.close(); walletEs = null; $('#wallet-btn').disabled = false; };
  walletEs.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log') $('#wallet-status').textContent = e.msg;
    else if (e.type === 'done') { stop(); $('#wallet-status').textContent = ''; renderWalletList(); }
    else if (e.type === 'error') { stop(); $('#wallet-status').textContent = `Analyse impossible : ${e.msg}`; }
  };
  walletEs.onerror = () => stop();
}
async function analyseWalletUi(wallet) {
  try {
    const { id } = await api('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet }) });
    $('#wallet-status').textContent = 'Démarrage… (environ 1 à 2 minutes)';
    followWallet(id);
  } catch (err) { $('#wallet-status').textContent = err.message; }
}
function openWallet() {
  setView('wallet', '<span>Wallet tracker</span>');
  renderWalletList();
  openWalletHunt();
}
$('#wallet-form').addEventListener('submit', (e) => { e.preventDefault(); analyseWalletUi($('#wallet-addr').value.trim()); });
$('#wallet-result').addEventListener('click', async (e) => {
  const tg = e.target.closest('[data-wl]');
  if (tg) { state.wlOpen = state.wlOpen === tg.dataset.wl ? null : tg.dataset.wl; renderWalletList(); return; }
  const redo = e.target.closest('[data-wallet-redo]');
  if (redo) { analyseWalletUi(redo.dataset.walletRedo); return; }
  const del = e.target.closest('[data-wallet-del]');
  if (del) { await api(`/api/wallet/${del.dataset.walletDel}`, { method: 'DELETE' }).catch(() => {}); renderWalletList(); }
});

// ---------- chasse aux wallets ----------
let whuntEs = null;
const WREJECT = { notProfitable: 'pas assez bénéf pour toi', thin: 'trop peu d’achats tôt', tooActive: 'plus de 30 trades par jour', tooQuiet: 'moins de 3 trades par jour', dev: 'devs', ring: 'même groupe qu’un wallet retenu', error: 'en erreur' };
function renderWalletHunt(result, stats) {
  const el = $('#whunt-result');
  const st = stats || result?.stats;
  if (!st) { el.innerHTML = ''; return; }
  if (result && result.rules !== 'wallet-hunt-v2' && result.done) { el.innerHTML = '<p class="mut">La dernière chasse a été faite avec les anciennes règles. Relance-la.</p>'; return; }
  const rows = result?.rows || state.whuntRows || [];
  const rej = Object.entries(st.rejected || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${WREJECT[k] || k}`).join(', ');
  const head = `<p class="mut">${st.coinsLooked || 0} coins regardés sur ${st.coins || 0} avec du volume · ${st.rugs || 0} rugs (−70 % en quelques secondes ou en 1 min) · ${st.wallets || 0} wallets analysés pour ${st.target} voulu${st.target > 1 ? 's' : ''}${rej ? ` · écartés : ${rej}` : ''}</p>`;
  const end = result?.done ? (result.stopReason ? `<p class="bot-warn">Chasse terminée avant d’en trouver ${st.target} : ${esc(result.stopReason)}.</p>` : `<p class="mut">Chasse terminée : ${rows.length} wallet${rows.length > 1 ? 's' : ''} trouvé${rows.length > 1 ? 's' : ''}.</p>`) : '';
  const list = rows.length ? `<div class="hunt-list">${[...rows].sort((x, y) => y.pnl100 - x.pnl100).map((r) => `<div class="hunt-row good">
      <div class="hr-main"><span>${addrHtml(r.wallet)} <button class="btn sm" data-copy="${esc(r.wallet)}">Copier</button></span>
        <span class="mut">${esc(r.role)} sur ${tokLink(r.coin)}${r.type ? ` · ${esc(r.type)}` : ''}</span></div>
      <div class="hr-tags">${badge('green', 'Bon à copier')}</div>
      <div class="hr-res"><b class="${netClass(r.pnl100)}">${signed(r.pnl100)} SOL</b> <span class="mut">pour toi à +100 % · +100 % touché sur ${r.hits}/${r.counted} achats tôt${r.pnl30?.closed ? ` · 30 jours : ${signed(r.pnl30.pnlSol)} SOL` : ''}${r.buys24h != null ? ` · ${r.buys24h} trades/24 h` : ''}${r.entryMedianUsd ? ` · entrée ~${usdShort(r.entryMedianUsd)}` : ''}</span></div>
    </div>`).join('')}</div><p class="logic">Le détail de chaque wallet est dans « Bons à copier » plus bas.</p>` : (st.wallets ? '<div class="empty">Aucun wallet bon à copier pour l’instant.</div>' : '');
  el.innerHTML = head + end + list;
}
function followWalletHunt(id) {
  if (whuntEs) whuntEs.close();
  $('#whunt-btn').disabled = true;
  $('#whunt-stop').hidden = false;
  $('#whunt-result').innerHTML = '';
  whuntEs = new EventSource(`/api/trace/${id}/events`);
  const stop = () => { whuntEs?.close(); whuntEs = null; $('#whunt-btn').disabled = false; $('#whunt-stop').hidden = true; };
  let main = '';
  whuntEs.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log') { main = e.msg; $('#whunt-status').textContent = main; }
    else if (e.type === 'sub') $('#whunt-status').textContent = `${main} — ${e.msg}`;
    else if (e.type === 'hunt') { state.whuntRows = e.rows; renderWalletHunt({ rows: e.rows }, e.stats); renderWalletList(); }
    else if (e.type === 'done') { stop(); $('#whunt-status').textContent = ''; api('/api/wallethunt/last').then(({ result }) => { renderWalletHunt(result); renderWalletList(); }); }
    else if (e.type === 'error') { stop(); $('#whunt-status').textContent = `Chasse impossible : ${e.msg}`; }
  };
  whuntEs.onerror = () => stop();
}
async function openWalletHunt() {
  const { running, result } = await api('/api/wallethunt/last').catch(() => ({}));
  if (result && !whuntEs && !running) renderWalletHunt(result);
  if (running && !whuntEs) followWalletHunt(running);
}
$('#whunt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { id } = await api('/api/wallethunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: Number($('#whunt-target').value), hours: Number($('#whunt-hours').value), minVolume: Number($('#whunt-vol').value) }) });
    $('#whunt-status').textContent = 'Démarrage…';
    followWalletHunt(id);
  } catch (err) { $('#whunt-status').textContent = err.message; }
});
$('#whunt-stop').addEventListener('click', async () => {
  $('#whunt-status').textContent = 'Arrêt demandé : la chasse s’arrête après le wallet en cours…';
  await api('/api/wallethunt/stop', { method: 'POST' }).catch(() => {});
});

// ---------- bilan réel ----------
let realEs = null;
const DEFAULT_WALLET = 'CR1R2ES6GzjaW743nfuGKCa4Rr5bnM7k9b4zUraSZCNC'; // son wallet F Project « Principal »
function renderReal(r) {
  const el = $('#real-result');
  if (!r) { el.innerHTML = ''; return; }
  const T = r.totals;
  const pctTxt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${nf(v, 0)} %`);
  const best = (p) => { if (!p) return null; const e = Object.entries(p).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0]; return e ? { id: e[0], v: e[1] } : null; };
  const verdictTxt = !T.trades ? 'Aucun trade fermé sur la période.'
    : T.pnlSol > 0 ? `Tu es positif : ${signed(T.pnlSol)} SOL sur ${T.trades} trades. ${T.trades < 20 ? 'Encore peu de trades pour juger : continue jusqu’à 20 au moins.' : ''}`
      : `Tu es négatif : ${signed(T.pnlSol)} SOL sur ${T.trades} trades. Regarde plus bas quels ruggers te coûtent.`;
  const devRows = r.devs.map((d) => {
    const pb = best(d.link?.predicted);
    const cut = d.trades >= 3 && d.pnlSol < 0;
    const tag = cut ? badge('red', 'À couper') : d.pnlSol > 0 ? badge('green', 'À garder') : badge('gray', 'À surveiller');
    const pred = pb ? `${pctTxt(pb.v)} prévu en ${esc(STRATS.find((s) => s.id === pb.id)?.short || '')} sur ${d.link.predictedN} tokens` : d.link ? 'pas encore de calcul' : 'pas encore tracé';
    const who = d.creator ? (d.link ? `<a href="#/t/${esc(d.link.id)}" class="mono">${esc(short(d.creator))}</a>` : `<span class="mono">${esc(short(d.creator))}</span> <button class="btn sm" data-trace="${esc(d.creator)}">Tracer</button>`) : '<span class="mut">dev inconnu</span>';
    return `<div class="hunt-row ${cut ? '' : d.pnlSol > 0 ? 'good' : ''}">
      <div class="hr-main">${who}<span class="mut">${d.link ? `rugger tracé${d.link.pattern ? ` · ${esc(d.link.pattern)}` : ''}${d.devs > 1 ? ` · ${d.devs} devs différents` : ''}` : 'dev pas encore tracé'}</span></div>
      <div class="hr-tags">${tag}</div>
      <div class="hr-res"><b class="${netClass(d.pnlSol)}">${signed(d.pnlSol)} SOL</b> <span class="mut">sur ${d.trades} trade${d.trades > 1 ? 's' : ''} (${d.wins} gagnant${d.wins > 1 ? 's' : ''}) · réel ${pctTxt(d.avgPct)} par trade · ${pred}</span></div>
    </div>`;
  }).join('');
  const tradeRows = r.trades.map((t) => {
    const pb = t.predicted ? best(t.predicted) : null;
    const gap = pb && t.pct != null ? t.pct - pb.v : null;
    return `<div class="trow"><div class="tr-main">
      <div class="ca-line">${caHtml(t)}</div>
      <div class="tr-nums"><span class="mut">${date(t.firstBuy)}</span>
        ${t.delay != null ? `<span class="mut" title="Délai entre la création du token et ton achat">acheté ${t.delay <= 0 ? 'dans la même seconde' : `${t.delay} s`} après la création</span>` : ''}
        <span class="mut">${sol(t.spent)} → ${sol(t.got)} SOL</span>
        ${t.closed ? `<span class="${netClass(t.pnlSol)}">${pctTxt(t.pct)} · ${signed(t.pnlSol)} SOL</span>` : badge('amber', 'Encore ouvert')}
        ${pb ? `<span class="mut" title="Ce que l’outil avait calculé pour ce token (meilleure de tes 3 ventes)">prévu ${pctTxt(pb.v)}${gap != null && Math.abs(gap) >= 25 ? ` · écart ${pctTxt(gap)}` : ''}</span>` : ''}
      </div></div></div>`;
  }).join('');
  const late = r.trades.filter((t) => t.delay != null && t.delay >= 3).length;
  el.innerHTML = `<div class="card">
      <div class="eyebrow">Ta période (${r.days} jours)${r.partial ? ' · lecture partielle' : ''}</div>
      <h2 class="ad-head"><i class="dot ${T.pnlSol > 0 ? 'green' : T.pnlSol < 0 ? 'red' : 'gray'}"></i>${signed(T.pnlSol)} SOL</h2>
      <p class="sub">${esc(verdictTxt)}</p>
      <p class="mut">Résultat réel : ce qui est vraiment sorti et revenu sur ton wallet, frais compris (bribe, tip, frais du bot, environ 0,03 SOL par vente). F Project affiche ses % sans ces frais, d’où un écart avec son récap. Les tokens cotés hors SOL (Pump custom) sont convertis au taux payé à l’achat.</p>
      <div class="grid4">
        <div class="stat"><div class="lab">Trades fermés</div><div class="val">${T.trades}</div><div class="foot">${T.open ? `${T.open} encore ouvert${T.open > 1 ? 's' : ''}` : 'aucun ouvert'}</div></div>
        <div class="stat"><div class="lab">Gagnants</div><div class="val">${T.wins}<small>/ ${T.trades}</small></div><div class="foot">${T.trades ? nf((100 * T.wins) / T.trades, 0) : 0} %</div></div>
        <div class="stat"><div class="lab">Gain moyen d’un gagnant</div><div class="val pos">${pctTxt(T.avgWin)}</div><div class="foot">frais compris</div></div>
        <div class="stat"><div class="lab">Perte moyenne d’un perdant</div><div class="val neg">${pctTxt(T.avgLoss)}</div><div class="foot">frais compris</div></div>
      </div>
      ${late ? `<p class="bot-warn">${late} achat${late > 1 ? 's' : ''} fait${late > 1 ? 's' : ''} 3 s ou plus après la création : tu entres plus tard que la fin de la 1re bougie, donc plus cher que dans les calculs de l’outil.</p>` : ''}
    </div>
    <div class="card"><div class="eyebrow">Par rugger</div><p class="sub">Du plus coûteux au plus rentable. « À couper » : au moins 3 trades et un résultat négatif.</p><div class="hunt-list">${devRows || '<div class="empty">Aucun trade fermé.</div>'}</div></div>
    <div class="card"><div class="eyebrow">Tes trades</div><p class="sub">« Prévu » : ce que l’outil avait calculé pour ce même token, quand il était dans une de tes enquêtes.</p><div class="tlist">${tradeRows}</div></div>`;
}
function followReal(id) {
  if (realEs) realEs.close();
  $('#real-btn').disabled = true;
  realEs = new EventSource(`/api/trace/${id}/events`);
  const stop = () => { realEs?.close(); realEs = null; $('#real-btn').disabled = false; };
  realEs.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log') $('#real-status').textContent = e.msg;
    else if (e.type === 'done') { stop(); $('#real-status').textContent = ''; api('/api/real/last').then(({ result }) => renderReal(result)); }
    else if (e.type === 'error') { stop(); $('#real-status').textContent = `Bilan impossible : ${e.msg}`; }
  };
  realEs.onerror = () => stop();
}
async function openReal() {
  setView('real', '<span>Bilan réel</span>');
  if (!$('#real-wallet').value) $('#real-wallet').value = localStorage.getItem('wallet') || DEFAULT_WALLET;
  const { running, result } = await api('/api/real/last').catch(() => ({}));
  if (result && !realEs) renderReal(result);
  if (running && !realEs) followReal(running);
}
$('#real-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const wallet = $('#real-wallet').value.trim();
  localStorage.setItem('wallet', wallet);
  try {
    const { id } = await api('/api/real', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, days: Number($('#real-days').value) }) });
    $('#real-status').textContent = 'Démarrage…';
    followReal(id);
  } catch (err) { $('#real-status').textContent = err.message; }
});

// ---------- chasse aux ruggers par filtres ----------
let fhuntEs = null;
const fval = (id) => { const v = $(`#${id}`)?.value; return v === '' || v == null ? null : Number(v); };
function readFilters() {
  return {
    hours: fval('fh-hours'), minVolume: fval('fh-vol-min'), maxVolume: fval('fh-vol-max'),
    minMcNow: fval('fh-mc-min'), maxMcNow: fval('fh-mc-max'), minAthUsd: fval('fh-ath-min'), maxAthUsd: fval('fh-ath-max'),
    maxEntryUsd: fval('fh-entry-max'), minPeakPct: fval('fh-peak'), minRugDrop: fval('fh-rug'), rugWithinSec: fval('fh-rug-sec'),
    minRugAfterSec: fval('fh-rugafter-min'), maxRugAfterSec: fval('fh-rugafter-max'),
    minBundle: fval('fh-bundle-min'), maxBundle: fval('fh-bundle-max'), minBundlePct: fval('fh-bpct-min'), maxBundlePct: fval('fh-bpct-max'),
    migrated: $('#fh-migrated').value, singleDev: $('#fh-single').checked, sourceOk: $('#fh-source').checked, analyse: $('#fh-analyse').checked, max: fval('fh-max'),
  };
}
// garde tes critères d'une visite à l'autre
function saveFilters() { localStorage.setItem('fhunt', JSON.stringify(readFilters())); }
function loadFilters() {
  try { applyFilters(JSON.parse(localStorage.getItem('fhunt') || 'null')); } catch { /* critères illisibles */ }
  renderPresets();
}
function applyFilters(f) {
  if (!f) return;
  {
    // un champ absent du preset est vidé (pas de filtre)
    const set = (id, v) => { if ($(`#${id}`)) $(`#${id}`).value = v ?? ''; };
    set('fh-hours', f.hours); set('fh-vol-min', f.minVolume); set('fh-vol-max', f.maxVolume); set('fh-mc-min', f.minMcNow); set('fh-mc-max', f.maxMcNow);
    set('fh-ath-min', f.minAthUsd); set('fh-ath-max', f.maxAthUsd); set('fh-entry-max', f.maxEntryUsd); set('fh-peak', f.minPeakPct); set('fh-rug', f.minRugDrop); set('fh-rug-sec', f.rugWithinSec);
    set('fh-rugafter-min', f.minRugAfterSec); set('fh-rugafter-max', f.maxRugAfterSec); set('fh-bundle-min', f.minBundle); set('fh-bundle-max', f.maxBundle);
    set('fh-bpct-min', f.minBundlePct); set('fh-bpct-max', f.maxBundlePct); set('fh-max', f.max);
    $('#fh-migrated').value = f.migrated || 'any';
    $('#fh-single').checked = f.singleDev !== false;
    $('#fh-source').checked = f.sourceOk === true;
    $('#fh-analyse').checked = f.analyse !== false;
    if (f.rugWithinSec == null) $('#fh-rug-sec').value = 60;
    if (f.hours == null) $('#fh-hours').value = 3;
  }
}
// presets : tes jeux de critères enregistrés (sur cette machine)
const readPresets = () => { try { return JSON.parse(localStorage.getItem('fhuntPresets') || '{}'); } catch { return {}; } };
function renderPresets() {
  const el = $('#fh-presets');
  if (!el) return;
  const p = readPresets();
  const names = Object.keys(p).sort((a, b) => a.localeCompare(b, 'fr'));
  el.innerHTML = names.length
    ? names.map((n) => `<span class="preset"><button type="button" class="preset-load" data-preset="${esc(n)}" title="Charger ce preset">${esc(n)}</button><button type="button" class="preset-del" data-preset-del="${esc(n)}" title="Supprimer ce preset">×</button></span>`).join('')
    : '<span class="mut">Aucun preset : règle tes critères, donne un nom et clique « Enregistrer ».</span>';
}
document.addEventListener('click', (e) => {
  const load = e.target.closest('[data-preset]');
  if (load) { applyFilters(readPresets()[load.dataset.preset]); saveFilters(); toast(`Preset « ${load.dataset.preset} » chargé`); return; }
  const del = e.target.closest('[data-preset-del]');
  if (del) {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Supprimer ?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '×'; } }, 3000); return; }
    const p = readPresets(); delete p[del.dataset.presetDel]; localStorage.setItem('fhuntPresets', JSON.stringify(p)); renderPresets();
  }
});
function savePreset() {
  const name = ($('#fh-preset-name').value || '').trim().slice(0, 40);
  if (!name) { toast('Donne un nom à ton preset'); $('#fh-preset-name').focus(); return; }
  const p = readPresets(); p[name] = readFilters(); localStorage.setItem('fhuntPresets', JSON.stringify(p));
  $('#fh-preset-name').value = '';
  renderPresets();
  toast(`Preset « ${name} » enregistré`);
}
// le résultat de l'analyse complète d'un token trouvé (traque du dev + rentabilité)
function fhAnalysis(r, rank) {
  const a = r.analysis;
  if (!a) return '';
  if (a.status === 'skipped') return '<div class="fh-an mut">Pas analysé : source rouge (mélangeur, service ou dev déjà très utilisé).</div>';
  if (a.status === 'waiting') return '<div class="fh-an mut">Analyse en attente…</div>';
  if (a.status === 'running') return '<div class="fh-an mut"><span class="spinner sm"></span> Analyse en cours : traque du dev et rentabilité…</div>';
  if (a.status === 'error') return `<div class="fh-an mut">Analyse impossible : ${esc(a.error || '')}</div>`;
  const v = LIST_VERDICT[a.verdict] || ['gray', a.verdict || '—'];
  const mode = MODE_UI.find(([k]) => k === a.mode)?.[1] || '';
  const strat = STRATS.find((x) => x.id === a.bestStrat);
  const prof = a.notDev ? badge('red', 'Pas un dev')
    : a.inactive ? badge('gray', 'Inactif depuis 24 h')
      : a.n < MIN_TOKENS ? badge('red', `Pas assez de données (${a.n}/${MIN_TOKENS})`)
        : enoughProfit(a.bestPnl, a.n) ? badge('green', `Rentable : ${signed(a.bestPnl)} SOL sur ${a.n} tokens`)
          : badge(a.bestPnl > 0 ? 'amber' : 'red', `${a.bestPnl > 0 ? 'Pas assez rentable' : 'Pas rentable'} : ${signed(a.bestPnl)} SOL sur ${a.n} tokens`);
  const good = a.verdict === 'track' && !a.inactive && a.n >= MIN_TOKENS && enoughProfit(a.bestPnl, a.n);
  const why = a.reason ? `<p class="fh-why">${esc(a.reason)}${a.tip && a.verdict !== 'track' ? `<br><span class="mut">À faire : ${esc(a.tip)}</span>` : ''}</p>` : '';
  return `<div class="fh-an ${good ? 'good' : ''}">${rank ? `<span class="fh-rank">#${rank}</span>` : ''}${good ? badge('green', 'À tracker') : badge(...v)}${a.urgent && a.verdict === 'track' ? badge('amber', 'À mettre maintenant') : ''}${a.exchange ? badge('gray', a.exchangeName ? `Exchange · ${a.exchangeName}` : 'Exchange') : ''}${mode && a.verdict === 'track' ? badge('gray', mode) : ''}${prof}
    <span class="mut">${a.pattern ? esc(a.pattern) : ''}${a.n >= MIN_TOKENS && strat ? ` · meilleure vente : ${esc(strat.short)}` : ''}${a.n >= MIN_TOKENS && a.avgPct > 0 ? ` · mise minimum ${nf(FEES / (a.avgPct / 100), 2)} SOL` : ''}${a.n && a.n < 20 ? ` · échantillon mince (${a.n}/20)` : ''}</span>
    ${a.id ? `<a class="btn sm" href="#/t/${esc(a.id)}">Voir l’enquête et le réglage</a>` : ''}${why}</div>`;
}
function renderFilterHunt(result, stats) {
  const el = $('#fhunt-result');
  const st = stats || result?.stats;
  if (!st) { el.innerHTML = ''; return; }
  const rows = result?.rows || state.fhuntRows || [];
  const rej = Object.entries(st.rejected || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ${k}`).join(' · ');
  const head = `<p class="mut">${(st.created || 0).toLocaleString('fr-FR')} tokens créés · ${st.market || 0} passent le volume et la market cap · ${st.curve || 0} trades lus · <b>${rows.length} trouvé${rows.length > 1 ? 's' : ''}</b>${rej ? `<br>Écartés : ${esc(rej)}` : ''}</p>`;
  const end = result?.done ? `<p class="mut">Recherche terminée${result.stopReason ? ` (${esc(result.stopReason)})` : ''}.</p>` : '';
  const analysed = rows.some((r) => r.analysis);
  // après analyse : l'ordre du serveur (du meilleur au pire) ; sinon les plus récents d'abord
  // une seule carte par équipe : les autres tokens de l'équipe sont listés dans la carte du mieux classé
  const ordered = analysed ? rows.filter((r) => !r.teamLead) : [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const teams = ordered.filter((r) => r.team?.length).length;
  let rk = 0;
  const list = rows.length ? `${analysed ? `<p class="mut">Classés du meilleur au pire : à tracker et rentable en haut, puis traquable à confirmer, à creuser, trop tard, perdu.${teams ? ` Les tokens d’une même équipe sont regroupés (${ordered.length} carte${ordered.length > 1 ? 's' : ''} pour ${rows.length} tokens) : un seul tracker les couvre.` : ''}</p>` : ''}<div class="fh-list">${ordered.map((r) => `<div class="fh-row">
      <div class="fh-tok"><b>${esc(r.symbol || r.name || '')}</b><span class="mut">${date(r.createdAt)}</span></div>
      ${fhAnalysis(r, r.analysis?.status === 'done' ? ++rk : 0)}
      ${r.team?.length ? `<div class="fh-team"><b>Même équipe (${r.team.length + 1} tokens trouvés) :</b> un seul tracker les couvre.${r.team.map((t) => `<div class="fh-team-row"><span><b>${esc(t.symbol || t.name || '')}</b> <span class="mut">${date(t.createdAt)}</span></span>${caHtml({ mint: t.mint })}${t.analysisId ? `<a class="btn sm" href="#/t/${esc(t.analysisId)}">Son enquête</a>` : ''}</div>`).join('')}</div>` : ''}
      ${r.source ? `<div class="fh-src src-${esc(r.source.color)}"><i class="dot ${esc(r.source.color)}"></i><span class="mut">Source du dev :</span> ${esc(r.source.text)}</div>` : ''}
      <div class="fh-ca">${caHtml({ mint: r.mint })}<button class="btn sm primary" data-trace="${esc(r.mint)}" title="Trace le dev qui a créé ce token">Tracer</button></div>
      <div class="fh-facts">
        <span><i>1re bougie</i><b>${usdShort(r.entryUsd)}</b></span>
        <span><i>Plus haut</i><b>${usdShort(r.athUsd)}</b></span>
        <span><i>Depuis la 1re bougie</i><b class="pos">+${nf(r.peakPct, 0)} %</b></span>
        <span><i>Rug</i><b class="neg">−${nf(r.rugDropPct, 0)} %</b>${r.rugAfterSec != null ? `<small>à ${secTxt(r.rugAfterSec)}</small>` : ''}</span>
        <span><i>Volume</i><b>${usdShort(r.volume)}</b></span>
        <span><i>MC actuelle</i><b>${usdShort(r.mcNow)}</b></span>
        <span><i>Bundle</i><b>${r.bundle ?? '—'}</b>${r.bundlePct != null ? `<small>${nf(r.bundlePct, 1)} % supply</small>` : ''}</span>
      </div>
    </div>`).join('')}</div>` : (result?.done || st.curve ? '<div class="empty">Aucun token ne colle à tes critères pour l’instant.</div>' : '');
  el.innerHTML = head + end + list;
}
function followFilterHunt(id) {
  if (fhuntEs) fhuntEs.close();
  $('#fhunt-btn').disabled = true;
  $('#fhunt-stop').hidden = false;
  $('#fhunt-result').innerHTML = '';
  fhuntEs = new EventSource(`/api/trace/${id}/events`);
  const stop = () => { fhuntEs?.close(); fhuntEs = null; $('#fhunt-btn').disabled = false; $('#fhunt-stop').hidden = true; };
  fhuntEs.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log') { state.fhMain = e.msg; $('#fhunt-status').textContent = e.msg; }
    else if (e.type === 'sub') $('#fhunt-status').textContent = `${state.fhMain || ''} — ${e.msg}`;
    else if (e.type === 'hunt') { state.fhuntRows = e.rows; renderFilterHunt({ rows: e.rows }, e.stats); }
    else if (e.type === 'done') { stop(); $('#fhunt-status').textContent = ''; api('/api/filterhunt/last').then(({ result }) => renderFilterHunt(result)); }
    else if (e.type === 'error') { stop(); $('#fhunt-status').textContent = `Recherche impossible : ${e.msg}`; }
  };
  fhuntEs.onerror = () => stop();
}
async function openFilterHunt() {
  loadFilters();
  const { running, result } = await api('/api/filterhunt/last').catch(() => ({}));
  if (result && !fhuntEs && !running) renderFilterHunt(result);
  if (running && !fhuntEs) followFilterHunt(running);
}
$('#fhunt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  saveFilters();
  try {
    const { id } = await api('/api/filterhunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readFilters()) });
    $('#fhunt-status').textContent = 'Démarrage…';
    followFilterHunt(id);
  } catch (err) { $('#fhunt-status').textContent = err.message; }
});
$('#fh-preset-save').addEventListener('click', savePreset);
$('#fh-preset-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } });
$('#fhunt-stop').addEventListener('click', async () => {
  $('#fhunt-status').textContent = 'Arrêt demandé…';
  await api('/api/filterhunt/stop', { method: 'POST' }).catch(() => {});
});

// ---------- page Chasse aux ruggers ----------
function openScan() {
  setView('scan', '<span>Chasse aux ruggers</span>');
  openFilterHunt();
}

// ---------- enquêtes ----------
const LIST_VERDICT = { track: ['green', 'À tracker'], dig: ['amber', 'À confirmer'], wait: ['amber', 'Montant à surveiller'], late: ['gray', 'Trop tard'], lost: ['red', 'Pas trackable'], reject: ['red', 'Ne pas tracker'] };
// équipes : enquêtes qui partagent une mère, ou un exchange au même montant exact → un seul tracker les couvre
function teams(list) {
  const parent = new Map(list.map((i) => [i.id, i.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const byKey = new Map();
  for (const i of list) for (const k of i.team || []) {
    if (byKey.has(k.key)) parent.set(find(i.id), find(byKey.get(k.key).id)); else byKey.set(k.key, i);
  }
  const groups = new Map();
  for (const i of list) { const r = find(i.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()].filter((g) => g.length >= 2).map((g, n) => {
    const ids = new Set(g.map((i) => i.id));
    const count = new Map();
    for (const i of g) for (const k of i.team || []) { const e = count.get(k.key) || { ...k, n: 0 }; e.n++; count.set(k.key, e); }
    const shared = [...count.values()].filter((k) => k.n >= 2).sort((x, y) => y.n - x.n);
    return { n: n + 1, members: g, ids, shared };
  });
}
const teamLine = (k) => (k.kind === 'exchange'
  ? `même retrait ${esc(k.name || 'exchange')} (${esc(short(k.address))}) à ${nf(k.amount, 4)} SOL`
  : `même wallet mère ${esc(short(k.address))}`);

async function renderList() {
  const el = $('#list-body');
  const list = await refreshCount();
  if (!list.length) { el.innerHTML = '<div class="card"><div class="empty">Aucune enquête pour l\'instant. Lance une traque depuis l\'onglet Traque.</div></div>'; return; }
  const sel = new Set();
  el.innerHTML = `
    <div class="bulk" id="bulk">
      <label class="chk"><input type="checkbox" id="sel-all"> Tout sélectionner</label>
      <span class="mut" id="sel-n"></span>
      <button class="btn sm danger" id="del-sel" disabled>Supprimer la sélection</button>
    </div>
    ${(() => { const T = teams(list); return T.length ? `<div class="card teams"><div class="eyebrow">Même équipe</div>
      <p class="sub">Ces enquêtes partagent la même source d’argent : c’est la même personne (ou la même équipe). Un seul tracker sur la source les couvre toutes, garde tes autres places pour d’autres ruggers.</p>
      ${T.map((t) => `<div class="team"><b>Équipe ${t.n}</b> · ${plural(t.members.length, 'enquête', 'enquêtes')} · ${t.shared.slice(0, 2).map(teamLine).join(' · ')}
        <div class="team-devs">${t.members.map((i) => `<a class="chip" href="#/t/${esc(i.id)}">${esc(i.start.slice(0, 6))}…${esc(i.start.slice(-4))}</a>`).join('')}</div>
        ${t.shared[0] ? `<div class="team-addr">Tracker commun : ${addrHtml(t.shared[0].address)}${t.shared[0].kind === 'exchange' ? ` · plage ${nf(t.shared[0].amount - 0.0001, 4)} – ${nf(t.shared[0].amount + 0.0001, 4)} SOL` : ''}</div>` : ''}
      </div>`).join('')}</div>` : ''; })()}
    <div class="inv-list">${list.map((i) => {
    const term = terminalInfo(i.terminal);
    const tm = teams(list).find((t) => t.ids.has(i.id));
    return `<div class="card inv" data-id="${esc(i.id)}" tabindex="0" role="link">
      <label class="chk" title="Sélectionner"><input type="checkbox" data-sel="${esc(i.id)}"></label>
      <div class="who"><b>${esc(i.start.slice(0, 6))}…${esc(i.start.slice(-6))}</b> ${tm ? badge('purple', `Équipe ${tm.n}`) : ''} ${i.pnl && i.pnl.n < MIN_TOKENS && !inactive(i) ? badge('red', `Pas assez de données (${i.pnl.n}/${MIN_TOKENS})`) : ''} ${inactive(i) ? badge('gray', `Inactif depuis ${inactive(i).days} j`) : i.pnl && i.pnl.n < MIN_TOKENS ? '' : i.verdict ? badge(...(LIST_VERDICT[i.verdict] || ['gray', i.verdict])) : ''}<div class="cell-sub">${new Date(i.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(i.pattern || `origine : ${term.text}`)}${i.mode && ['track', 'dig'].includes(i.verdict) ? ` · ${esc(MODE_UI.find(([k]) => k === i.mode)?.[1] || '')}` : ''}${i.pnl ? ` · ${signed(i.pnl.sol)} SOL sur ${i.pnl.n} tokens${i.pnl.strat ? ` (${esc(STRATS.find((x) => x.id === i.pnl.strat)?.short || '')})` : ''}` : ''}</div></div>
      <div class="nums"><span><b>${i.stats.wallets}</b> wallets</span><span><b>${i.stats.tokens}</b> tokens</span><span><b>${i.stats.rugs}</b> rugs</span></div>
      <button class="btn sm del" data-del="${esc(i.id)}">Supprimer</button>
    </div>`;
  }).join('')}</div>`;
  const sync = () => {
    $('#sel-n').textContent = sel.size ? plural(sel.size, 'sélectionnée', 'sélectionnées') : '';
    const b = $('#del-sel');
    b.disabled = !sel.size;
    b.textContent = b.dataset.armed ? `Confirmer : supprimer ${sel.size}` : 'Supprimer la sélection';
    $('#sel-all').checked = sel.size === list.length;
  };
  $$('.inv', el).forEach((card) => {
    const go = () => { location.hash = `#/t/${card.dataset.id}`; };
    card.onclick = (e) => { if (!e.target.closest('.chk, button')) go(); };
    card.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
  $$('[data-sel]', el).forEach((c) => {
    c.onchange = () => { if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); delete $('#del-sel').dataset.armed; sync(); };
  });
  $('#sel-all').onchange = (e) => {
    $$('[data-sel]', el).forEach((c) => { c.checked = e.target.checked; if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); });
    delete $('#del-sel').dataset.armed;
    sync();
  };
  // suppression en deux clics, sans fenêtre de confirmation du navigateur
  $('#del-sel').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; sync(); return; }
    b.disabled = true;
    for (const id of sel) await api(`/api/investigations/${id}`, { method: 'DELETE' }).catch(() => null);
    toast(`${plural(sel.size, 'enquête supprimée', 'enquêtes supprimées')}`);
    renderList();
  };
  $$('[data-del]', el).forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = 'Confirmer ?';
        b.classList.add('danger');
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Supprimer'; b.classList.remove('danger'); } }, 4000);
        return;
      }
      await api(`/api/investigations/${b.dataset.del}`, { method: 'DELETE' }).catch(() => null);
      toast('Enquête supprimée');
      renderList();
    };
  });
  sync();
}

async function renderLabels() {
  const el = $('#labels-body');
  const labels = await api('/api/labels');
  const TYPE = { exchange: ['amber', 'Exchange'], swap: ['amber', 'Service d\'échange'], infra: ['gray', 'Infrastructure'] };
  el.innerHTML = `<div class="card">
      <div class="eyebrow">Ajouter une adresse</div>
      <p class="sub">Un exchange ou un service que l’outil ne connaît pas : donne-lui un nom, il sera reconnu dès la prochaine traque.</p>
      <form id="label-form" class="scan-row" autocomplete="off" style="margin-top:12px">
        <label class="field" style="flex:2"><span>Adresse</span><input id="lb-addr" type="text" spellcheck="false" placeholder="Adresse Solana"></label>
        <label class="field"><span>Nom</span><input id="lb-name" type="text" placeholder="ex. MEXC"></label>
        <label class="field"><span>Type</span><select id="lb-type"><option value="exchange">Exchange</option><option value="service">Service</option><option value="infra">Infrastructure</option></select></label>
        <button class="btn primary" type="submit">Ajouter</button>
      </form>
      <div class="form-error" id="lb-err" hidden></div>
    </div>
    <div class="card"><div id="tbl"></div></div>`;
  $('#label-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/labels', { method: 'POST', body: JSON.stringify({ address: $('#lb-addr').value.trim(), name: $('#lb-name').value.trim(), type: $('#lb-type').value }) });
      toast('Adresse ajoutée');
      renderLabels();
    } catch (ex) { $('#lb-err').hidden = false; $('#lb-err').textContent = ex.message; }
  };
  table($('#tbl'), 'labels', [
    { id: 'name', label: 'Nom', val: (l) => l.name.toLowerCase(), html: (l) => `<span class="tok-name">${esc(l.name)}</span>` },
    { id: 'type', label: 'Type', val: (l) => l.type, html: (l) => badge(...(TYPE[l.type] || ['gray', l.type])) },
    { id: 'address', label: 'Adresse', val: (l) => l.address, html: (l) => addrHtml(l.address, l.address) },
  ], labels, 'type');
}

// ---------- snipe exchange ----------
// Une page pour les ruggers financés par un exchange : dossier complet, bundle, surveillance en continu.
const XS_STATUS = {
  confirmed: ['green', 'Confirmé', 'xs-good'],
  selfsnipe: ['purple', 'Auto-snipe', 'xs-good'],
  variable: ['amber', 'Montant variable', 'xs-mid'],
  watch: ['amber', 'À surveiller', 'xs-mid'],
  'not-exchange': ['gray', 'Pas exchange', 'xs-off'],
  watching: ['blue', 'Surveillé', 'xs-mid'],
};
const XS_BUNDLE = { mine: ['green', 'À lui'], doubt: ['amber', 'À confirmer'], sniper: ['gray', 'Sniper'] };
const XS_MATCH = { amount: ['green', 'Même montant'], exchange: ['amber', 'Même exchange'], none: ['gray', 'Autre source'] };
const XS_VIA = { dev: 'son dev', chain: 'sa chaîne (via des relais)', trace: 'la traque (72 h)', history: 'tes enquêtes', bundle: 'son bundle' };
const rangeOf = (a) => [Math.round((a - 0.0001) * 1e4) / 1e4, Math.round((a + 0.0001) * 1e4) / 1e4];
const rangeTxt = (a) => rangeOf(a).map((x) => nf(x, 4)).join(' – ');
const xsPill = (status) => { const s = XS_STATUS[status] || XS_STATUS.watching; return badge(s[0], s[1]); };
const xsState = { job: null, timer: null };

function updateWatchCount(d, seen = false) {
  const since = Number(localStorage.getItem('watchSeen') || 0);
  const n = seen ? 0 : d.watches.flatMap((w) => w.hits).filter((h) => (h.status === 'waiting' || h.status === 'created') && h.seenAt > since).length;
  const el = $('#watch-count');
  el.textContent = n;
  el.hidden = n === 0;
}

/** Alertes de la surveillance : schémas confirmés et nouveaux devs probables. */
function xsAlerts(watches, only = null) {
  const all = watches.filter((w) => !only || w.id === only).flatMap((w) => w.hits.map((h) => ({ w, h })));
  const confirmed = all.filter((x) => x.h.status === 'created').sort((a, b) => b.h.createdAt - a.h.createdAt);
  const waiting = all.filter((x) => x.h.status === 'waiting').sort((a, b) => b.h.time - a.h.time);
  const who = (w) => (only ? '' : ` · rugger <a href="#/exchange/${esc(w.start)}"><b>${esc(w.symbol || short(w.start))}</b></a>`);
  const conf = confirmed.map(({ w, h }) => `<div class="xs-alert good">
      <div class="xs-alert-top">${badge('green', h.viaReuse || h.viaBundle ? 'Son bundle a snipé' : 'Schéma confirmé')}<span class="mut">${ago(h.createdAt)}</span></div>
      <div class="xs-alert-txt">${h.viaReuse
        ? `Son wallet de bundle ${addrHtml(h.to)} a acheté ${tokLink({ mint: h.mint, symbol: h.symbol })} à sa naissance : c’est son nouveau lancement (dev ${addrHtml(h.creator)}).`
        : `${addrHtml(h.creator)} a reçu <b>${nf(h.sol, 4)} SOL</b> de ${esc(w.name)}, puis ${h.viaBundle ? 'a snipé' : 'a lancé'} ${tokLink({ mint: h.mint, symbol: h.symbol })} ${dur(h.delay)} après.`}${who(w)}</div>
      <div class="xs-actions">${h.amount ? `<button class="btn sm" data-copy="${esc(h.from)}">Copier ${esc(w.name)}</button><button class="btn sm" data-copy="${rangeOf(h.amount).join('-')}">Copier la plage ${rangeTxt(h.amount)}</button>` : ''}<button class="btn sm" data-copy="${esc(h.mint)}">Copier le CA</button><button class="btn sm" data-xs="${esc(h.creator)}">Dossier du nouveau dev</button></div>
    </div>`).join('');
  const wait = waiting.map(({ w, h }) => `<div class="xs-alert">
      <div class="xs-alert-top">${badge('amber', w.kinds?.[String(Math.round(h.amount * 1e6) / 1e6)] === 'bundle' ? 'Nouveau wallet de bundle ?' : 'Nouveau dev ?')}<span class="mut">${ago(h.time)}</span></div>
      <div class="xs-alert-txt">${addrHtml(h.cur)} vient de recevoir <b>${nf(h.sol, 4)} SOL</b> de ${esc(w.name)}${h.path.length > 1 ? ` (via ${plural(h.path.length - 1, 'relais', 'relais')})` : ''}, rien lancé pour l’instant${who(w)}.</div>
      <div class="xs-actions"><button class="btn sm" data-copy="${esc(h.cur)}">Copier le wallet</button><button class="btn sm" data-trace="${esc(h.cur)}">Tracer</button></div>
    </div>`).join('');
  if (!conf && !wait) return '';
  return `<div class="xs-alerts">${conf}${wait}</div>`;
}

async function renderExchange(start) {
  const el = $('#watch-body');
  $('#view-watch .page-head').hidden = !!start;
  if (start) return renderExDossier(start);
  let d;
  try { d = await api('/api/exsnipe'); } catch (e) { el.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`; return; }
  localStorage.setItem('watchSeen', String(Math.floor(Date.now() / 1000)));
  updateWatchCount(d.watch, true);
  const ws = d.watch.watches;
  const byStart = new Map(d.dossiers.map((x) => [x.start, { ...x }]));
  for (const w of ws) {
    const x = byStart.get(w.id) || { start: w.id, symbol: w.symbol, exchange: w.name, status: 'watching', amounts: w.amounts.map((sol) => ({ sol, kind: w.kinds?.[String(sol)] || 'dev' })), noDossier: true, createdAt: w.addedAt * 1000 };
    x.watch = w;
    byStart.set(w.id, x);
  }
  // les plus intéressants d'abord (confirmé, auto-snipe, alertes en cours), puis les plus récents
  const XS_RANK = { confirmed: 0, selfsnipe: 1, variable: 2, watch: 3, watching: 4, 'not-exchange': 5 };
  const live2 = (x) => (x.watch ? x.watch.hits.filter((h) => h.status === 'created' || h.status === 'waiting').length : 0);
  const rows = [...byStart.values()].sort((a, b) => (live2(b) > 0) - (live2(a) > 0) || (XS_RANK[a.status] ?? 4) - (XS_RANK[b.status] ?? 4) || (b.watch?.updatedAt || b.createdAt / 1000) - (a.watch?.updatedAt || a.createdAt / 1000));
  const st = d.watch;
  const live = st.lastTick ? `Dernière lecture ${ago(st.lastTick)}` : 'Première lecture en cours';
  const cards = rows.map((x) => {
    const w = x.watch;
    const hits = w ? w.hits.filter((h) => h.status === 'created' || h.status === 'waiting').length : 0;
    const stats = x.noDossier ? '<span class="mut">Pas encore de dossier</span>' : `${plural(x.devs || 1, 'dev', 'devs')} · bundle ${x.mine}/${x.bundle} à lui · ${plural(x.others, 'autre token', 'autres tokens')}`;
    return `<div class="xs-card ${(XS_STATUS[x.status] || XS_STATUS.watching)[2]}">
      <div class="xs-card-top"><div><div class="xs-sym">${esc(x.symbol || short(x.start))}</div><div class="mut xs-small">${addrHtml(x.start)}</div></div>${xsPill(x.status)}</div>
      <div class="xs-card-ex"><b>${esc(x.exchange || '?')}</b>${(x.amounts || []).map((a) => `<i class="xs-amt ${a.kind === 'bundle' ? 'b' : ''}" title="${a.kind === 'bundle' ? 'Montant de son wallet de bundle' : 'Montant de son dev'}">${nf(a.sol, 4)}</i>`).join('')}</div>
      <div class="xs-card-stats">${stats}${hits ? ` · ${badge('amber', plural(hits, 'alerte', 'alertes'))}` : ''}</div>
      <div class="xs-actions">${x.noDossier ? `<button class="btn sm primary" data-xs="${esc(x.start)}">Faire le dossier</button>` : `<a class="btn sm primary" href="#/exchange/${esc(x.start)}">Ouvrir le dossier</a>`}<button class="btn sm del" data-xs-rm="${esc(x.start)}">Retirer</button></div>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="card xs-run">
      <div class="eyebrow">Nouveau dossier</div>
      <form id="xs-form" class="search-row" autocomplete="off">
        <input id="xs-addr" type="text" spellcheck="false" placeholder="Wallet du dev ou CA du token">
        <button class="btn primary" type="submit">Lancer le dossier</button>
      </form>
      <div class="form-error" id="xs-err" hidden></div>
      <div id="xs-progress" hidden></div>
      <div class="xs-how">
        <div><b>1</b><span>Son exchange et tous ses montants exacts</span></div>
        <div><b>2</b><span>Le même montant chez d’autres devs, sur 72 h et tous les hot wallets</span></div>
        <div><b>3</b><span>Son bundle passé au crible : à lui ou sniper ?</span></div>
        <div><b>4</b><span>Ses anciens tokens retrouvés par son bundle</span></div>
        <div><b>5</b><span>Le réglage du bot, puis la surveillance toutes les 3 min</span></div>
      </div>
    </div>
    ${xsAlerts(ws)}
    <div class="xs-head"><h2>Tes ruggers exchange</h2><span class="mut">${plural(ws.length, 'rugger surveillé', 'ruggers surveillés')} · ${plural(st.hotWallets, 'hot wallet relu', 'hot wallets relus')} toutes les ${Math.round(st.everySec / 60)} min · ${live}${st.lastError ? ` · <span class="red-txt">${esc(st.lastError)}</span>` : ''}</span><button class="btn sm" id="xs-tick">Vérifier maintenant</button></div>
    ${rows.length ? `<div class="xs-grid">${cards}</div>` : '<div class="card"><div class="empty">Aucun rugger exchange pour l’instant. Colle le wallet d’un dev retiré d’un exchange : chaque traque d’un dev exchange l’ajoute aussi ici toute seule.</div></div>'}`;
  $('#xs-form').onsubmit = (e) => { e.preventDefault(); xsStart($('#xs-addr').value.trim()); };
  $('#xs-tick').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Lecture…'; try { await api('/api/exwatch/tick', { method: 'POST' }); } catch { /* affiché au prochain rendu */ } renderExchange(); };
  $$('[data-xs-rm]', el).forEach((b) => { b.onclick = async () => { await api('/api/exsnipe/remove', { method: 'POST', body: JSON.stringify({ start: b.dataset.xsRm }) }); toast('Retiré'); renderExchange(); }; });
  if (xsState.job) xsPoll();
}

async function xsStart(address) {
  const err = $('#xs-err');
  if (err) err.hidden = true;
  try {
    const { id } = await api('/api/exsnipe', { method: 'POST', body: JSON.stringify({ address }) });
    xsState.job = id;
    if (location.hash !== '#/exchange') location.hash = '#/exchange'; // la page lance le suivi en s'affichant
    else xsPoll();
  } catch (e) { if (err) { err.hidden = false; err.textContent = e.message; } else toast(e.message); }
}

async function xsPoll() {
  clearTimeout(xsState.timer);
  const box = $('#xs-progress');
  if (!xsState.job || !box) return;
  let j;
  try { j = await api(`/api/exsnipe/job/${xsState.job}`); } catch { xsState.job = null; box.hidden = true; return; }
  box.hidden = false;
  if (j.error) { box.innerHTML = `<div class="form-error">${esc(j.error)}</div>`; xsState.job = null; return; }
  if (j.done && j.start) { xsState.job = null; location.hash = `#/exchange/${j.start}`; return; }
  box.innerHTML = `<div class="xs-prog"><div class="xs-spin"></div><div><b>Dossier de ${esc(short(j.address))} en cours</b> <span class="mut">· ${dur(Math.round((Date.now() - j.startedAt) / 1000))}</span>
    <div class="xs-log">${j.logs.slice(-5).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></div>`;
  xsState.timer = setTimeout(xsPoll, 1500);
}

async function renderExDossier(start) {
  const el = $('#watch-body');
  let d;
  try { d = await api(`/api/exsnipe/d/${start}`); } catch (e) {
    el.innerHTML = `<a class="xs-back" href="#/exchange">← Snipe exchange</a><div class="card"><div class="empty">${esc(e.message)}. <button class="btn sm primary" data-xs="${esc(start)}">Faire le dossier</button></div></div>`;
    return;
  }
  const v = d.verdict || {};
  const s = XS_STATUS[v.status] || XS_STATUS.watch;
  const b = v.bot;
  const sec = (n, title, sub, body) => `<section class="card xs-sec"><div class="xs-sec-head"><span class="xs-num">${n}</span><div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>${body}</section>`;
  // le réglage du bot
  const botHtml = b ? `<div class="xs-bot">
      <div class="eyebrow">À mettre dans le bot</div>
      <div class="bot-rows">
        <div class="bot-row"><span>${b.mode.startsWith('Copytrade') ? 'Wallet à copier' : 'Adresse à suivre'}</span><div>${addrHtml(b.address, b.address)} <span class="mut">${esc(b.addressName || '')}</span> <button class="btn sm" data-copy="${esc(b.address)}">Copier</button></div></div>
        <div class="bot-row"><span>${b.mode.startsWith('Copytrade') ? 'Mode' : 'Mode de protection'}</span><b>${esc(b.mode)}</b></div>
        ${b.ranges ? `<div class="bot-row"><span>Plages de transfert</span><div class="xs-ranges">${b.ranges.map((r) => `<span class="xs-range"><b class="mono">${nf(r.min, 4)} – ${nf(r.max, 4)}</b> <span class="mut">${plural(r.devs, 'dev', 'devs')}</span><button class="btn sm" data-copy="${r.min}-${r.max}">Copier</button></span>`).join('')}</div></div>` : ''}
        ${(b.options || []).map((o) => `<div class="bot-row"><span>${esc(o.name)}</span><div><b class="${o.on ? 'on-txt' : ''}">${o.on ? 'ON' : 'OFF'}</b> <span class="mut">${esc(o.why)}</span></div></div>`).join('')}
        ${b.tp ? `<div class="bot-row"><span>Prise de profit</span><b>${esc(b.tp)}</b></div>` : ''}
        <div class="bot-row"><span>Compteur de pertes max</span><div><b>${esc(b.lossCounter)}</b> <span class="mut">${esc(b.lossWhy || '')}</span></div></div>
      </div>
      ${b.warning ? `<p class="bot-warn">${esc(b.warning)}</p>` : ''}
      ${b.otherHots?.length ? `<p class="bot-warn">Ses devs sortent aussi de ${b.otherHots.map((h) => addrHtml(h)).join(', ')} : mets un 2e tracker ${esc(d.exchange)} sur cette adresse avec les mêmes plages.</p>` : ''}
    </div>` : '';
  // 1. financement
  const fp = (d.fingerprints || [])[0];
  const read = (d.fingerprints || []).reduce((n, f) => Math.max(n, (f.bySource || []).reduce((m, x) => m + (x.read || 0), 0) || f.txRead || 0), 0);
  const hots = Math.max(1, ...(d.fingerprints || []).map((f) => (f.bySource || []).filter((x) => x.main || x.read >= 100).length));
  const s1 = `<div class="xs-kv">
      <div><span>Exchange</span><div><b>${esc(d.exchange)}</b> ${addrHtml(d.hot)}</div></div>
      <div><span>${d.upstream ? 'Retrait d’exchange en amont (passé par des relais)' : 'Retraits du dev avant son lancement'}</span><div class="xs-chips">${(d.withdrawals || []).map((w) => `<i class="xs-amt">${nf(w.sol, 4)} SOL</i>`).join('') || '—'}</div></div>
      <div><span>Délai retrait → lancement</span><div><b>${d.delay != null ? dur(d.delay) : '—'}</b></div></div>
      <div><span>Envois de l’exchange relus</span><div><b>${fp ? `${nf(Math.min(fp.windowHours || 0, fp.coveredHours ?? fp.windowHours ?? 0), 0)} h` : '—'}</b>${read ? ` <span class="mut">· ${read.toLocaleString('fr-FR')} transactions · ${plural(hots, 'hot wallet', 'hot wallets')}</span>` : ''}</div></div>
    </div>`;
  // 2. même montant
  const cl = (d.clusters || []).filter((c) => c.name === d.exchange);
  const s2 = cl.length ? `<div class="xs-list">${cl.map((c) => `<div class="xs-li">
      <div class="xs-li-main"><i class="xs-amt">${nf(c.sol, 4)} SOL</i> ${c.devs.length >= 2 ? badge('green', `${c.devs.length} devs`) : badge('gray', '1 dev')}</div>
      <div class="xs-li-sub">${c.devs.map((f) => `${addrHtml(f.dev)}${f.symbol ? ` <b>${esc(f.symbol)}</b>` : ''} <span class="mut">· vu par ${esc(XS_VIA[f.via] || f.via)}</span>`).join('<br>')}</div>
    </div>`).join('')}</div>` : '<div class="empty">Aucun montant relevé.</div>';
  // 3. bundle
  const bundle = d.bundle || [];
  const count = (k) => bundle.filter((x) => x.verdict === k).length;
  const col = d.collector ? `<div class="xs-collect"><div><b>Son wallet de collecte</b> ${addrHtml(d.collector.address)}<div class="mut xs-small">${d.collector.dev ? 'Le dev et ' : ''}${plural(d.collector.wallets, 'wallet de son bundle y renvoie', 'wallets de son bundle y renvoient')} leur SOL après le rug. S’il finance ses prochains devs, c’est un wallet mère à suivre.</div></div><button class="btn sm" data-trace="${esc(d.collector.address)}">Tracer ce wallet</button></div>` : '';
  const s3 = col + (bundle.length ? `<div class="xs-list">${bundle.map((w) => `<div class="xs-li">
      <div class="xs-li-main">${addrHtml(w.wallet)} ${badge(...XS_BUNDLE[w.verdict])} <span class="mut">${w.bundle ? 'bundle' : `${w.rank}e acheteur`}</span></div>
      <div class="xs-sigs">${w.signals.map((x) => `<span class="xs-sig ${x.weight < 0 ? 'bad' : x.ok && x.weight > 0 ? 'ok' : 'no'}">${x.weight < 0 ? '✕' : x.ok && x.weight > 0 ? '✓' : '·'} ${esc(x.text)}</span>`).join('')}</div>
    </div>`).join('')}</div>` : '<div class="empty">Pas de bundle ni de premiers acheteurs lisibles sur son token.</div>');
  // 4. autres tokens
  const others = d.others || [];
  const s4 = others.length ? `<div class="xs-list">${others.map((o) => `<div class="xs-li">
      <div class="xs-li-main">${tokLink(o)} ${badge(...XS_MATCH[o.match])} <span class="mut">${ago(o.createdAt)}</span></div>
      <div class="xs-li-sub">Dev ${addrHtml(o.creator)}${o.exchange ? ` · retiré de ${esc(o.exchange)} avec <b>${nf(o.sol, 4)} SOL</b>` : o.funding ? ` · financé par ${addrHtml(o.funding.funder)} (${nf(o.funding.sol, 3)} SOL)` : ''} · snipé par ${addrHtml(o.wallet)}</div>
    </div>`).join('')}</div>` : `<div class="empty">${(d.mine || []).length ? 'Ses wallets de bundle n’ont pas acheté d’autre token à sa naissance.' : 'Aucun wallet du bundle n’est à lui : rien à remonter par là.'}</div>`;
  // 5. surveillance
  const w = d.watch;
  const s5 = w ? `<div class="xs-kv">
      <div><span>Montants guettés</span><div class="xs-chips">${w.amounts.map((a) => `<i class="xs-amt ${w.kinds?.[String(a)] === 'bundle' ? 'b' : ''}">${nf(a, 4)}${w.kinds?.[String(a)] === 'bundle' ? ' · bundle' : ''}</i>`).join('')}</div></div>
      <div><span>Hot wallets relus</span><div><b>${w.addresses.length}</b> <span class="mut">${esc(w.name)}, toutes les 3 min</span></div></div>
      ${w.reused?.length ? `<div><span>Wallets de bundle suivis</span><div>${w.reused.map((a) => addrHtml(a)).join(', ')}</div></div>` : ''}
    </div>${xsAlerts([w], w.id) || '<div class="empty">Aucun nouveau dev pour l’instant : tu seras prévenu ici et dans la barre de gauche.</div>'}` : '<div class="empty">Pas encore surveillé.</div>';
  el.innerHTML = `<a class="xs-back" href="#/exchange">← Snipe exchange</a>
    <div class="card xs-hero ${s[2]}">
      <div class="xs-hero-top"><div><div class="eyebrow">Rugger exchange · ${esc(d.exchange || '—')}</div><h2>${esc(d.symbol || short(d.start))} ${xsPill(v.status)}</h2><div class="mut xs-small">Dev ${addrHtml(d.start, d.start)}</div></div>
        <div class="xs-actions"><button class="btn sm" data-xs="${esc(d.start)}">Relancer le dossier</button>${d.inv ? `<a class="btn sm" href="#/t/${esc(d.inv)}">Enquête complète</a>` : ''}${d.coin ? `<button class="btn sm" data-copy="${esc(d.coin.mint)}">Copier le CA</button>` : ''}</div></div>
      <h3 class="xs-verdict">${esc(v.title || '')}</h3>
      <p class="xs-summary">${esc(v.summary || '')}</p>
      ${botHtml}
    </div>
    ${d.kind === 'exchange' ? `
    ${sec(1, 'Comment il se finance', 'Tous les retraits d’exchange reçus par son dev avant de lancer.', s1)}
    ${sec(2, 'Le même montant chez d’autres devs', 'À ±0,0001 SOL, sur 72 h et tous les hot wallets de l’exchange, plus tes enquêtes passées et les devs trouvés par son bundle.', s2)}
    ${sec(3, `Son bundle : à lui ou sniper ? <span class="mut xs-count">${count('mine')} à lui · ${count('doubt')} à confirmer · ${count('sniper')} snipers</span>`, 'Chaque wallet du bloc de création et des premiers achats. Il est « à lui » avec au moins deux indices forts : financé par le dev ou le même exchange juste avant, revend avec le rug, renvoie son SOL au dev ou aux mêmes adresses.', s3)}
    ${sec(4, 'Ses autres tokens, retrouvés par son bundle', 'Les tokens que ses wallets de bundle ont achetés à leur naissance, et comment leur dev a été financé.', s4)}
    ${sec(5, 'Surveillance en continu', 'Dès qu’un wallet neuf reçoit un de ces montants, ou qu’un de ses wallets de bundle snipe un nouveau token.', s5)}` : ''}`;
}

// boutons « Faire le dossier » partout dans la page
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-xs]');
  if (!x) return;
  e.preventDefault();
  xsStart(x.dataset.xs);
});
// le compteur de la barre de gauche, et la page qui se met à jour seule
setInterval(async () => {
  try {
    const d = await api('/api/exwatch');
    if (!$('#view-watch').hidden && !xsState.job && !document.activeElement?.matches('input')) route(); else updateWatchCount(d);
  } catch { /* serveur arrêté */ }
}, 30000);
api('/api/exwatch').then((d) => updateWatchCount(d)).catch(() => {});

// ---------- démarrage ----------
(async function init() {
  setPreset('normal');
  try {
    state.config = await api('/api/config');
    const pub = state.config.provider === 'public';
    const name = { helius: 'Helius', custom: 'RPC personnalisé', public: 'RPC public' }[state.config.provider];
    $('#rpc-pill').innerHTML = `<i class="dot ${pub ? 'amber' : ''}"></i><span>${name}${pub ? ' · lent' : ''}</span>`;
    $('#rpc-side').innerHTML = `<i class="dot ${pub ? 'amber' : ''}"></i>${name}`;
    $('#rps-side').textContent = `${nf(state.config.rps, state.config.rps < 1 ? 1 : 0)} req/s`;
    $('#rpc-notice').hidden = !pub;
    if (pub) setPreset('rapide');
  } catch { /* serveur injoignable : la page reste utilisable en lecture */ }
  refreshCount();
  route();
})();
