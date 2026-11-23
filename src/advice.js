// Routes des tokens (comment on les a trouvés) et conseil de réglage pour le bot F Project.
import { pathTo } from './downstream.js';
import { buildRanges, TOL } from './census.js';

const s4 = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?');
const fr = (n, d = 2) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Les trois modes de protection du bot F Project.
export const MODES = {
  last: { name: 'Dernier Transfert', what: 'Suit le wallet quand il envoie tout son SOL vers une nouvelle adresse.' },
  exchange: { name: 'Modèle d\'Échange', what: 'Suit les envois à montant fixe. Il faut remplir les Plages de Transfert.' },
  hybrid: { name: 'Hybride', what: 'Les deux : les envois dans la plage ET le vidage du wallet.' },
};

/**
 * Route d'un token d'avant (trouvé dans le cluster) : plus court chemin dans le graphe des transferts,
 * depuis l'adresse tracée jusqu'au créateur. Chaque lien garde le sens de l'argent.
 */
export function clusterRoute(start, creator, edges, roleOf) {
  if (creator === start) return { steps: [{ address: start, role: 'start' }], links: [] };
  const adj = new Map();
  const add = (a, b, e) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, e }); };
  for (const e of edges) { add(e.from, e.to, e); add(e.to, e.from, e); }
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length && !prev.has(creator)) {
    const a = queue.shift();
    for (const { to, e } of adj.get(a) || []) if (!prev.has(to)) { prev.set(to, { from: a, e }); queue.push(to); }
  }
  if (!prev.has(creator)) return null;
  const steps = []; const links = [];
  for (let cur = creator; cur; cur = prev.get(cur)?.from) {
    steps.unshift({ address: cur, role: cur === start ? 'start' : cur === creator ? 'creator' : roleOf(cur) });
    const p = prev.get(cur);
    if (p) links.unshift({ from: p.e.from, to: p.e.to, sol: p.e.lamports / 1e9 });
  }
  return { steps, links };
}

// Route d'un token d'après : le chemin suivi vers l'aval.
export function forwardRoute(nodes, creator) {
  const path = pathTo(nodes, creator);
  if (!path.length) return null;
  return {
    steps: path.map((n, i) => ({ address: n.address, role: i === 0 ? 'start' : n.address === creator ? 'creator' : n.kind })),
    links: path.slice(1).map((n) => ({ from: n.parent, to: n.address, sol: n.inSol })),
  };
}

// Phrase simple qui explique la route.
export function routeLogic(route, side, extra = {}) {
  if (!route) return 'Lien trouvé par les sorties d\'argent communes.';
  const { steps, links } = route;
  const creator = steps[steps.length - 1].address;
  if (steps.length === 1) return 'Lancé directement par l\'adresse que tu as tracée.';
  const relays = steps.filter((s) => s.role === 'relay').length;
  const hubs = steps.filter((s) => s.role === 'hub');
  const via = relays ? ` en passant par ${pl(relays, 'wallet relais', 'wallets relais')}` : '';
  if (side === 'after') {
    const hub = hubs[hubs.length - 1];
    if (extra.groupBuy) return `${extra.buyers} wallets financés avec l'argent de l'adresse tracée l'ont acheté ensemble dès le début : ce sont ses achats groupés.`;
    return `L'argent de l'adresse tracée est parti${via}${hub ? `, puis par le wallet central ${s4(hub.address)}` : ''}, jusqu'à ${s4(creator)} qui a créé ce token.`;
  }
  const towardStart = links.every((l, i) => l.to === steps[i].address);
  const awayFromStart = links.every((l, i) => l.from === steps[i].address);
  const devs = steps.slice(1, -1).filter((s) => s.role === 'creator').map((s) => s.address);
  const parts = [relays ? pl(relays, 'wallet relais', 'wallets relais') : null, devs.length ? `${devs.length > 1 ? `${devs.length} autres de ses devs` : 'un autre de ses devs'} (${devs.map(s4).join(', ')})` : null].filter(Boolean);
  const by = parts.length ? ` en passant par ${parts.join(' et ')}` : '';
  if (towardStart) return `${s4(creator)} a créé ce token, puis son argent est arrivé sur l'adresse tracée${by} (${fr(links[links.length - 1].sol)} SOL au départ).`;
  if (awayFromStart) return `L'adresse tracée a financé ${s4(creator)}${by}, qui a créé ce token.`;
  // changement de sens : un financeur commun ou un wallet de collecte commun
  let pivot = 1;
  while (pivot < links.length && links[pivot - 1].to === steps[pivot - 1].address) pivot++;
  const p = steps[pivot - 1];
  const fromStartSide = links[pivot - 1];
  if (fromStartSide && fromStartSide.from === p.address) return `Même financeur : ${s4(p.address)} a financé l'adresse tracée et ${s4(creator)}.`;
  return `Même wallet de collecte : l'adresse tracée et ${s4(creator)} envoient leurs gains vers ${s4(p.address)}.`;
}


// Options du mode « Modèle d'Échange » sur une source (exchange ou wallet mère), règles F Project.
// Délai conseillé pour « Supprimer sans lancement » : 1,5 × le plus long délai vu entre financement et lancement, au moins 1 h.
export const noLaunchHours = (launchMaxMin) => (launchMaxMin ? Math.max(1, Math.ceil((launchMaxMin * 1.5) / 60)) : 2);

/**
 * Options de protection quand on suit une source (mère ou exchange), dans l'ordre et avec les noms de l'écran du bot.
 * Hériter paramètres reste ACTIVÉ : sans ça, le dev ajouté par la protection reçoit les réglages par défaut du wallet
 * (souvent achat auto coupé) et le bot n'achète rien. L'Auto-éviction évite que les 30 places se remplissent.
 */
export const sourceOptions = (relayed, fresh, { rotation = false, launchMaxMin = null } = {}) => {
  const h = noLaunchHours(launchMaxMin);
  return [
    { key: 'keepAddress', on: true, why: 'Garde la source dans le bot après chaque envoi : c’est elle qui financera le prochain dev. Désactivé, le bot remplace la source par le premier dev financé et tu la perds.' },
    { key: 'autoEviction', on: true, why: 'Retire tout seul les vieux wallets ajoutés qui n’ont pas de position ouverte : tes 30 places restent libres.' },
    { key: 'freshWalletOnly', on: !!fresh, why: fresh ? 'Ses devs sont toujours des wallets neufs : on ignore les envois vers des wallets déjà utilisés.' : 'À laisser désactivé : certains de ses devs avaient déjà servi avant.' },
    { key: 'removeIfNoLaunch', on: true, hours: h, why: `Retire un wallet financé qui ne lance rien au bout de ${h} h${launchMaxMin ? ` (ses devs lancent au plus tard ${launchMaxMin < 90 ? `${launchMaxMin} min` : `${Math.round(launchMaxMin / 6) / 10} h`} après avoir reçu le SOL)` : ''}.` },
    { key: 'removeAfterFirstAction', on: false, why: 'Certains devs relancent depuis la même adresse : on les garde après leur premier token.' },
    { key: 'inheritSettings', on: true, why: rotation ? 'Quand sa mère change d’adresse, la nouvelle doit garder les plages et le mode Hybride.' : relayed ? 'Ses devs passent par des relais : chaque relais ajouté doit garder le réglage pour aller jusqu’au dev.' : 'Le dev ajouté par la protection doit avoir ton montant d’achat et tes prises de profit. Désactivé, il reçoit les réglages par défaut de ton wallet (achat auto coupé chez toi) et le bot ne t’achète rien.', warn: 'Attention (F Project) : avec Conserver l’adresse et Hériter paramètres activés ensemble, chaque wallet ajouté garde aussi ses adresses, et tes 30 places peuvent se remplir en quelques minutes. Garde Auto-éviction et Supprimer sans lancement activés. Autre solution conseillée par F Project : mettre ton montant et tes prises de profit dans les réglages par défaut de ton wallet, puis désactiver Hériter paramètres.' },
  ];
};

// Options du mode « Dernier Transfert » : on remplace l'ancien wallet par le nouveau, qui garde le même réglage.
export const lastTransferOptions = () => [
  { key: 'removeAfterFirstAction', on: false, why: 'Le nouveau wallet doit rester suivi jusqu’à son lancement.' },
  { key: 'keepAddress', on: false, why: 'Désactivé : l’ancien wallet ne servira plus, le bot le remplace par le nouveau.' },
  { key: 'inheritSettings', on: true, why: 'Activé : le nouveau wallet garde ce réglage, et le bot continue de le suivre au cycle suivant.' },
  { key: 'freshWalletOnly', on: true, why: 'Activé : ses relais et ses devs sont toujours des wallets neufs, ça évite de suivre un envoi vers un exchange ou un ami.' },
];

/**
 * Conseil final : quelle adresse mettre dans le bot, avec quel mode et quelles plages.
 * Règle de base : on ne donne qu'une adresse qui va encore servir.
 * - durable : exchange au même montant, wallet mère réutilisé d'un cycle à l'autre (méthode F Project) ;
 * - immédiate : le wallet où son argent est posé en ce moment (à mettre tout de suite) ;
 * - sinon on le dit : trop tard pour ce cycle, déposé sur un exchange, ou passé dans un mélangeur.
 */
const ago = (sec) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 172800 ? `${fr(sec / 3600, 1)} h` : `${fr(sec / 86400, 1)} jours`);

// au-delà de 24 h sans aucun lancement (ni lui ni ses autres devs), le dev ne t'intéresse pas
export const INACTIVE_AFTER = 86400;
export function lastLaunchOf(r) {
  if (r.lastLaunchAt !== undefined) return r.lastLaunchAt;
  const times = [...(r.tokens || []), ...(r.after || []), ...(r.siblingTokens || [])].filter((t) => !t.groupBuy).map((t) => t.createdAt || 0).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}

/**
 * Clés d'équipe d'une enquête : les sources qu'elle partage avec d'autres ruggers.
 * Wallet mère : son adresse suffit. Exchange : adresse + montant exact (tout le monde retire de Binance).
 * Deux enquêtes qui partagent une clé = même équipe, un seul tracker les couvre.
 */
export function teamKeys(r) {
  const keys = new Map();
  const a = r.advice || {};
  const mid = (rg) => { const x = Array.isArray(rg?.[0]) ? rg : rg ? [rg] : []; return x.map((v) => ((v[0] + v[1]) / 2).toFixed(4)); };
  const add = (address, kind, ranges, name = null) => {
    if (!address || address === r.start) return;
    if (kind === 'exchange') for (const m of mid(ranges)) keys.set(`${address}@${m}`, { address, kind, amount: Number(m), name });
    else keys.set(address, { address, kind: 'mother', name });
  };
  const c = r.census;
  if (c && c.kind !== 'service') {
    add(c.source, c.kind === 'exchange' ? 'exchange' : 'mother', c.ranges?.map((x) => [x.min, x.max]), c.label || null);
    for (const o of c.others || []) if (o.devs >= 2 && !o.label && o.source !== c.source) add(o.source, 'mother');
  }
  const fromCensus = a.evidence === 'census';
  if (['track', 'dig'].includes(a.verdict) && a.mode !== 'last' && !fromCensus) add(a.address, 'exchange', a.ranges, a.name || null);
  if (a.watch) add(a.watch.address, 'exchange', a.watch.range, a.watch.name || null);
  if (a.also) add(a.also.address, 'exchange', a.also.range, a.also.name || null);
  return [...keys.entries()].map(([key, v]) => ({ key, ...v }));
}

export function adviseBot({ start, base, spider = null, fwd, after, startTokens, startBalanceSol = null, startActivity = null, flow = null, census = null, history = [], now = Math.floor(Date.now() / 1000) }) {
  // une adresse qui a créé 2 tokens ou plus n'est jamais un tracker (règle F Project)
  if (startTokens >= 2) {
    return { verdict: 'reject', reason: `Cette adresse a lancé ${startTokens} tokens elle-même : elle relance depuis la même adresse. Ce n'est pas un tracker. Pour le sniper, mets-la plutôt en copytrade.` };
  }
  // une adresse qui n'a jamais signé de transaction réussie ne lance rien et n'envoie rien : ce n'est pas un dev
  if (startActivity && startActivity.signed === 0 && !startTokens) {
    const a = startActivity;
    const what = a.txCount === 0
      ? 'Cette adresse n’a aucune transaction.'
      : `Cette adresse n’a jamais signé une transaction réussie (${a.txCount} au total${a.failed ? `, dont ${a.failed} échouées` : ''}) : elle n’a fait que recevoir${a.mainSigner ? `, surtout de la part de ${a.mainSigner.slice(0, 4)}…${a.mainSigner.slice(-4)}` : ''}.`;
    return { verdict: 'reject', notDev: true, reason: `${what} Ce n’est pas un dev : rien à tracker ici. Vérifie que tu as collé l’adresse du créateur (ou colle directement le CA du token).` };
  }
  const relayWarn = 'Ses relais renvoient l\'argent dans la seconde. Si le bot reste bloqué sur un wallet vide, relance une traque sur l\'adresse bloquée.';
  // 0 bis. schéma araignée : on suit la mère qui découpe ses envois (option « Schéma araignée » du bot)
  if (spider?.mother && spider.kind === 'oneshot') {
    return { verdict: 'dig', evidence: 'spider', address: spider.mother, reason: `Schéma araignée : ${pl(spider.legs.length, 'wallet neuf a', 'wallets neufs ont')} envoyé chacun ${fr(spider.legSol, 4)} SOL à ce dev. Mais le haut de la toile (${s4(spider.mother)}) est lui aussi un wallet jetable, sans financeur visible : pas de mère fixe à suivre pour l’instant.`, tip: 'Relance une traque sur son prochain token : si la même mère revient, on pourra la suivre.' };
  }
  if (spider?.mother && spider.kind !== 'busy') {
    const sp = spider;
    const sameCensus = census && census.source === sp.mother ? census : null;
    return {
      verdict: 'track', mode: 'exchange', address: sp.mother, durable: true, evidence: 'spider', ranges: sp.ranges, rangeInfo: sp.ranges.map(([min, max]) => ({ min, max, amount: (min + max) / 2, n: sameCensus?.devs.length || 1 })),
      options: [...sourceOptions(true, true, { launchMaxMin: census?.launchMaxMin ?? null }), { key: 'spiderScheme', on: true, why: 'Active le suivi de la mère qui découpe son SOL en petites parts vers des wallets neufs : le bot repère le wallet où toutes les parts se rejoignent, c’est le dev.' }],
      reason: `Schéma araignée : ${s4(sp.mother)}${sp.label ? ` (${sp.label})` : ` (wallet réutilisé, ${sp.motherTx} transactions)`} a envoyé ${fr(sp.momSol, 4)} SOL dans la toile. L’argent traverse ${pl(sp.depth, 'wallet jetable', 'wallets jetables')} (relais et petites parts croisées), puis ${pl(sp.legs.length, 'wallet neuf envoie', 'wallets neufs envoient')} chacun ${fr(sp.legSol, 4)} SOL à ce dev, soit ${fr(sp.total, 2)} SOL en tout.${sameCensus ? ` Cette mère a financé ${sameCensus.devs.length} de ses devs.` : ''} C’est souvent la méthode des utilisateurs de Proxima. On suit la mère, pas les pattes ni le dev jetable.`,
      warning: 'Les plages sont celles des parts envoyées par la mère : si sa somme change (par exemple 2 SOL au lieu de 1), relance une traque pour les mettre à jour.',
    };
  }
  // 0. recensement : la source qui finance plusieurs de ses devs (méthode F Project : on suit la source, pas le dev jetable)
  // un exchange confirmé passe devant… sauf face à un vrai wallet mère (≥3 devs) : la mère d'abord, l'exchange qui la finance en second tracker
  const cexTrack = base.verdict === 'track' && base.kind === 'cex';
  const motherFirst = census?.kind === 'mother' && census.devs.length >= 3;
  if (census && census.devs.length >= 2 && census.kind !== 'service' && (!cexTrack || motherFirst)) {
    const c = census;
    const name = c.label === 'Exchange sans nom' ? `un exchange sans nom (${s4(c.source)})` : c.label === 'Exchange' ? `un exchange (${s4(c.source)})` : c.label || s4(c.source);
    const deN = /^un /.test(name) ? `d'${name}` : `de ${name}`;
    const relayed = c.devs.filter((d) => d.relays?.length).length;
    const scan = c.scan;
    const newDevs = (c.siblings || []).filter((x) => !x.known).length;
    const amounts = c.ranges.map((r) => `${fr(r.amount, c.kind === 'exchange' || r.amount < 0.1 ? 4 : 2)} SOL${r.n > 1 ? ` (×${r.n})` : ''}`).join(', ');
    const covered = c.ranges.reduce((s, r) => s + r.n, 0);
    const options = sourceOptions(relayed > 0, c.freshShare >= 0.8, { rotation: !!c.rotation, launchMaxMin: c.launchMaxMin });
    const waitN = c.waiting?.length || 0;
    const scanTxt = (scan?.followed ? ` Dans ses envois récents qui tombent dans ces plages, ${scan.found} sur ${scan.followed} ont mené à un dev qui a lancé un token${newDevs ? `, dont ${newDevs} pas encore vu${newDevs > 1 ? 's' : ''}` : ''}.` : '')
      + (waitN ? ` ${waitN} wallet${waitN > 1 ? 's' : ''} financé${waitN > 1 ? 's' : ''} dans ses plages n'${waitN > 1 ? 'ont' : 'a'} encore rien lancé : ses prochains devs probables.` : '');
    if (c.kind === 'exchange') {
      if (c.ranges.length && c.label === 'Exchange sans nom') {
        return {
          verdict: 'dig', mode: 'exchange', address: c.source, evidence: 'census', ranges: c.ranges.map((r) => [r.min, r.max]), rangeInfo: c.ranges, options,
          reason: `${c.devs.length} de ses devs ont été financés ${deN} avec le même montant exact : ${amounts}.${scanTxt} Le schéma ressemble à un exchange, mais ce wallet n’a pas de nom connu.`,
          warning: 'Cet exchange n’a pas de nom connu (wallet très actif avec beaucoup de SOL). F Project ne met en tracker qu’un exchange identifié : vérifie sur Solscan qu’il porte bien l’étiquette d’un exchange avant de l’utiliser.',
          tip: 'Si Solscan confirme que c’est un exchange, suis-le avec ces plages à ±0,0001 SOL (Modèle d’Échange). Sinon, relance une traque sur son prochain token.',
        };
      }
      if (c.ranges.length) {
        return {
          verdict: 'track', mode: 'exchange', address: c.source, durable: true, evidence: 'census', ranges: c.ranges.map((r) => [r.min, r.max]), rangeInfo: c.ranges, options,
          reason: `${c.devs.length} de ses devs ont été retirés ${deN} avec le même montant exact : ${amounts}.${scanTxt} On suit l'exchange avec des plages à ±0,0001 SOL, pas le dev jetable.`,
          warning: [
            c.label === 'Exchange sans nom' ? 'Cet exchange n’a pas de nom connu (wallet très actif avec beaucoup de SOL) : vérifie sur Solscan que c’est bien un exchange avant de le mettre dans le bot.' : null,
            relayed ? `Entre l'exchange et le dev : ${relayed > 1 ? 'des relais' : 'un relais'}. Le montant reste le même à quelques lamports près, la plage le couvre.` : null,
          ].filter(Boolean).join(' ') || null,
        };
      }
      return { verdict: 'dig', mode: 'exchange', address: c.source, evidence: 'census', ranges: null, reason: `${c.devs.length} de ses devs ont été retirés ${deN}, mais avec des montants tous différents : pas de montant fixe à filtrer pour l'instant. Ne mets pas le dev jetable dans le bot.` };
    }
    // hub au-dessus de la mère : il envoie de petits montants à des intermédiaires jetables qui financent les devs
    if (c.hub) {
      const h = c.hub;
      const rr = [...h.ranges, ...h.devRanges].slice(0, 5);
      const amt = (list) => list.map((r) => `${fr(r.amount, 2)} SOL${r.n > 1 ? ` (×${r.n})` : ''}`).join(', ');
      const mids = h.mids.filter((m) => !m.direct).length;
      return {
        verdict: 'track', mode: 'exchange', address: h.address, durable: true, evidence: 'hub', ranges: rr.map((r) => [r.min, r.max]), rangeInfo: rr,
        options: sourceOptions(true, c.freshShare >= 0.8, { launchMaxMin: c.launchMaxMin }),
        reason: `${s4(h.address)} est le hub : il envoie ${amt(h.ranges)} à des wallets intermédiaires jetables (${mids} vu${mids > 1 ? 's' : ''}), qui financent chacun des devs avec ${amt(h.devRanges)}. ${h.devs} devs au total. ${name} n’est qu’un de ces intermédiaires : il ne resservira pas. On suit le hub, avec ses montants vers les intermédiaires et les montants vers les devs, et l’Héritage activé : chaque intermédiaire ajouté par le bot garde ces plages, donc ses envois aux devs sont suivis.`,
        warning: 'Le hub reçoit souvent de très grosses sommes (des centaines de SOL) : ne suis pas ce gros transfert, ce sont ses petits envois aux intermédiaires qui comptent. Surveille tes 30 places (Auto-éviction activée).',
      };
    }
    // wallet mère
    const durable = c.activity ? c.activity.reused || c.activity.partialHistory : true;
    const strong = c.devs.length >= 3 || (scan && scan.found >= 2);
    const lastAgo = c.activity?.lastAt ? now - c.activity.lastAt : null;
    const others = (c.others || []).filter((o) => o.source !== c.source && o.devs >= 2);
    const extra = (lastAgo != null ? ` Dernière activité de ${name} : il y a ${ago(lastAgo)}.` : '') + (others.length ? ` Il utilise aussi ${others.map((o) => `${o.label || s4(o.source)} (${o.devs} devs)`).join(', ')}.` : '');
    return {
      verdict: durable && strong ? 'track' : 'dig', mode: c.rotation ? 'hybrid' : 'exchange', address: c.source, durable, evidence: 'census', ranges: c.ranges.map((r) => [r.min, r.max]), rangeInfo: c.ranges, options,
      reason: `${name} est son wallet mère : il a financé ${Math.max(c.devs.length, covered)} de ses devs${relayed ? ` (${relayed} via des relais)` : ' directement'} avec ${amounts}.${covered < c.devs.length ? ` Les 5 plages couvrent ${covered} devs sur ${c.devs.length}.` : ''}${scanTxt}${extra}${durable ? '' : ' Attention : ce wallet n\'a servi qu\'une fois pour l\'instant.'}${c.rotation ? ` Son wallet mère change d’adresse : l’ancien (${s4(c.rotation.from)}) lui a tout envoyé (${fr(c.rotation.sol)} SOL). Le mode Hybride suit à la fois les envois aux devs et ce vidage vers la prochaine mère.` : ''}`,
      warning: c.ranges.length >= 5 ? 'Il varie beaucoup ses montants : 5 plages maximum dans le bot, les plus utilisées sont en premier.' : null,
      ...(cexTrack && base.address !== c.source ? { also: {
        address: base.address, name: base.name, mode: 'exchange', range: [base.minSol, base.maxSol],
        why: `Sa mère elle-même a été retirée de ${base.name || s4(base.address)} avec ${fr((base.minSol + base.maxSol) / 2, 4)} SOL, et ce montant exact revient chez d'autres wallets : quand il change de mère, ce 2e tracker attrape la nouvelle. Héritage désactivé : la nouvelle mère n'utilise pas ce montant, relance une traque dessus pour avoir ses plages.`,
      } } : {}),
      ...(c.sourceCreates >= 2 ? { tip: `${name} lance aussi lui-même des tokens (${c.sourceCreates}) depuis son adresse : tu peux le mettre en copytrade en plus.` } : {}),
    };
  }
  if (census && census.kind === 'service' && census.devs.length >= 2) {
    return {
      verdict: 'lost', evidence: 'census',
      reason: `Ses devs sortent d'un service de paiement (${s4(census.source)}) qui change de wallet toutes les quelques heures : aucune adresse fixe à mettre dans le bot.`,
      tip: 'Repère son prochain token dès qu’il sort : même montant, même nombre de relais.',
    };
  }

  // 1. durable : exchange + même montant chez plusieurs créateurs, ou wallet mère (méthode F Project)
  if (base.verdict === 'track' && base.kind === 'cex' && base.name === 'Exchange sans nom') {
    return { verdict: 'dig', mode: 'exchange', address: base.address, evidence: 'before', ranges: base.minSol != null ? [base.minSol, base.maxSol] : null, reason: base.reason, warning: 'Cet exchange n’a pas de nom connu (wallet très actif avec beaucoup de SOL). F Project ne met en tracker qu’un exchange identifié : vérifie sur Solscan qu’il porte bien l’étiquette d’un exchange avant de l’utiliser.' };
  }
  if (base.verdict === 'track' && (base.kind === 'cex' || base.kind === 'mother')) {
    return { verdict: 'track', mode: 'exchange', address: base.address, evidence: 'before', durable: true, ranges: base.minSol != null ? [base.minSol, base.maxSol] : null, reason: base.reason, warning: base.warning || null };
  }

  // 2. vers l'aval : un wallet central qui finance ses devs, seulement s'il est réutilisé d'un cycle à l'autre
  const inFwd = new Set(fwd.nodes.map((n) => n.address));
  const creates = after.filter((t) => !t.groupBuy && t.creator && t.creator !== start && inFwd.has(t.creator)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const newest = creates[0] || null;
  if (newest) {
    const path = pathTo(fwd.nodes, newest.creator);
    const inner = path.slice(1, -1);
    const hub = [...inner].reverse().find((n) => n.kind === 'hub');
    if (hub && hub.reused) {
      const viaHub = creates.filter((t) => pathTo(fwd.nodes, t.creator).some((n) => n.address === hub.address));
      const amounts = viaHub.map((t) => { const p = pathTo(fwd.nodes, t.creator); return p[p.findIndex((n) => n.address === hub.address) + 1]?.inSol; }).filter(Boolean);
      const lo = Math.min(...amounts); const hi = Math.max(...amounts);
      const empties = fwd.nodes.some((n) => n.parent === hub.address && n.kind === 'relay');
      return {
        verdict: viaHub.length >= 2 ? 'track' : 'dig', mode: empties ? 'hybrid' : 'exchange', address: hub.address, evidence: 'after', durable: true,
        ranges: buildRanges(amounts, TOL.mother).map((g) => [g.min, g.max]), options: sourceOptions(true, true),
        reason: `Son wallet central ${s4(hub.address)} revient à chaque cycle et finance ses devs (${fr(lo, 4)}${hi - lo > 0.0001 ? ` à ${fr(hi, 4)}` : ''} SOL).${empties ? ' Il se vide aussi vers des relais : mode Hybride.' : ''}${viaHub.length >= 2 ? ` ${viaHub.length} devs financés ainsi.` : ' Un seul exemple pour l\'instant : attends un 2e lancement financé de la même façon.'}`,
      };
    }
    // 3. chaîne dev → dev encore en cours : le dernier dev a encore son SOL
    const last = fwd.nodes.find((n) => n.address === newest.creator);
    const alive = flow?.path.some((p) => p.address === newest.creator) ? flow.frontier.address === newest.creator && flow.frontier.balanceSol >= 0.05 : (now - (last?.lastAt ?? 0)) < 1800;
    if (!hub && alive) {
      return {
        verdict: 'track', urgent: true, mode: 'last', address: newest.creator, ranges: null, evidence: 'after', options: lastTransferOptions(),
        reason: `Il passe son argent d'un dev au suivant. Son dernier dev, ${s4(newest.creator)} (token ${newest.symbol || '?'}), a encore son SOL : mets-le tout de suite, le bot passera au wallet suivant quand il videra tout.`,
        warning: inner.some((n) => n.kind === 'relay') ? relayWarn : null,
      };
    }
  }

  // 3 ter. tes autres enquêtes ont déjà vu ce même exchange envoyer ce même montant exact à un autre dev : schéma confirmé
  if (base.kind === 'cex' && base.verdict === 'dig' && base.minSol != null) {
    const seen = history.filter((h) => h.source === base.address && h.dev !== start && h.sol >= base.minSol - 1e-9 && h.sol <= base.maxSol + 1e-9);
    const devs = [...new Set(seen.map((h) => h.dev))];
    if (devs.length) {
      const amt = fr((base.minSol + base.maxSol) / 2, 4);
      return {
        verdict: base.name === 'Exchange sans nom' ? 'dig' : 'track', mode: 'exchange', address: base.address, durable: true, evidence: 'history', ranges: [[base.minSol, base.maxSol]], options: sourceOptions(false, true),
        reason: `Son dev a été retiré ${/^Exchange( sans nom)?$/.test(base.name) ? `d'un exchange (${s4(base.address)})` : `de ${base.name}`} avec ${amt} SOL exactement, et tes enquêtes ont déjà vu ${devs.length > 1 ? `${devs.length} autres devs` : 'un autre dev'} retiré${devs.length > 1 ? 's' : ''} de ${base.name} avec ce même montant (enquête sur ${[...new Set(seen.map((h) => s4(h.start)))].join(', ')}). Schéma exchange confirmé : on suit ${base.name} avec une plage à ±0,0001 SOL.`,
        warning: base.name === 'Exchange sans nom' ? 'Cet exchange n’a pas de nom connu (wallet très actif avec beaucoup de SOL). F Project ne met en tracker qu’un exchange identifié : vérifie sur Solscan qu’il porte bien l’étiquette d’un exchange avant de l’utiliser.' : null,
      };
    }
  }

  // 3 bis. dev retiré d'un exchange, montant pas encore répété : l'exchange reste le point de départ (règle F Project :
  // ne jamais suivre le dev jetable en Dernier Transfert, même s'il a encore son SOL). Seule exception : le chemin de
  // l'argent montre qu'il passe déjà son SOL à un nouveau dev qui lance (chaîne dev → dev en cours).
  const chainGoesOn = flow && (flow.end === 'launched' || (flow.creates || []).some((c) => c.creator !== start));
  if (base.kind === 'cex' && base.verdict === 'dig' && base.minSol != null && !chainGoesOn) {
    const amt = fr((base.minSol + base.maxSol) / 2, 4);
    const nm = base.name === 'Exchange sans nom' ? `un exchange sans nom (${s4(base.address)})` : base.name === 'Exchange' ? `un exchange (${s4(base.address)})` : base.name;
    const de = (x) => (/^un /.test(x) ? `d'${x}` : `de ${x}`);
    const sc = base.scan || {};
    const amounts = sc.amounts?.length ? sc.amounts : [(base.minSol + base.maxSol) / 2];
    const scanTxt = sc.hours
      ? ` J'ai lu ${Math.round(Math.min(sc.hours, sc.covered ?? sc.hours))} h d'envois ${de(nm)}${sc.read ? ` (${sc.read.toLocaleString('fr-FR')} transactions)` : ''}${sc.hots > 1 ? `, plus 24 h chez ${sc.hots - 1} autre${sc.hots > 2 ? 's' : ''} hot wallet${sc.hots > 2 ? 's' : ''} ${base.name}` : ''}${amounts.length > 1 ? `, en cherchant ses ${amounts.length} retraits (${amounts.map((a) => fr(a, 4)).join(', ')} SOL)` : ''}.`
      : '';
    const still = (startBalanceSol ?? 0) >= 1 ? ` Il a encore ${fr(startBalanceSol)} SOL, mais après son rug ce SOL repart en général vers un dépôt d'exchange : le suivre en Dernier Transfert ne mène pas au prochain dev.` : '';
    return {
      verdict: 'wait', evidence: 'cex', watch: { address: base.address, name: base.name, range: [base.minSol, base.maxSol] },
      reason: `Son dev a été retiré ${de(nm)} avec ${amt} SOL exactement.${scanTxt} Aucun autre wallet n'a reçu ${amounts.length > 1 ? 'un de ces montants' : 'ce montant'} et lancé un token : son schéma ne se répète pas encore. Ne mets pas son wallet jetable dans le bot.${still}`,
      tip: `Relance une traque sur son prochain token. Si un nouveau dev reçoit encore ${amounts.map((a) => fr(a, 4)).join(' ou ')} SOL ${de(nm)}, le schéma est confirmé : tu suivras cette adresse avec la plage de ce montant, à ±0,0001 SOL.`,
      warning: base.name === 'Exchange sans nom' ? 'Cet exchange n’a pas de nom connu dans l’outil : vérifie sur Solscan qu’il porte bien l’étiquette d’un exchange.' : null,
    };
  }
  // 4. où est l'argent maintenant
  if (flow) {
    const f = flow.frontier;
    const hops = flow.path.length - 1;
    const mixers = flow.path.filter((p) => p.kind === 'hub' && p.txCount >= 300 && p.bursts === 1).length;
    const since = f.inAt ? now - f.inAt : null;
    const merge = flow.path.find((p) => p.merged);
    // la chaîne continue après lui : les devs suivants, trouvés sur le chemin de l'argent
    const next = (flow.creates || []).filter((c) => c.creator !== start);
    const nextTxt = next.length ? ` Depuis ton token, la chaîne a continué : ${pl(new Set(next.map((c) => c.creator)).size, 'nouveau dev', 'nouveaux devs')} (${[...new Set(next.map((c) => c.symbol || s4(c.mint)))].slice(0, 4).join(', ')}).` : '';
    if (flow.end === 'launched' && !merge) {
      const tok = f.creates?.[f.creates.length - 1];
      return {
        verdict: 'track', urgent: true, mode: 'last', address: f.address, ranges: null, evidence: 'flow', since, options: lastTransferOptions(),
        reason: `Son dernier dev, ${s4(f.address)}, vient de lancer ${tok?.symbol || 'un token'} avec l'argent de la chaîne${since != null ? ` (il l'a reçu il y a ${ago(since)})` : ''}.${nextTxt} Mets-le tout de suite : après son rug, il enverra tout au dev suivant et le bot suivra.`,
        warning: flow.path.some((p) => p.kind === 'relay') ? relayWarn : null,
      };
    }
    if (flow.end === 'rest' && f.balanceSol >= 1 && f.address !== start && !merge && next.length) {
      return {
        verdict: 'track', urgent: true, mode: 'last', address: f.address, ranges: null, evidence: 'flow', since, options: lastTransferOptions(),
        reason: `Son argent (${fr(f.balanceSol)} SOL) est posé sur ${s4(f.address)}${since != null ? ` depuis ${ago(since)}` : ''}, après ${pl(hops, 'wallet', 'wallets')}.${nextTxt} Mets-le tout de suite : dès qu'il envoie tout vers un nouveau wallet, le bot suit.`,
        warning: flow.path.some((p) => p.kind === 'relay') ? relayWarn : null,
      };
    }
    if (flow.end === 'rest' && f.balanceSol >= 1 && f.address !== start && merge) {
      return {
        verdict: 'dig', mode: 'last', address: f.address, ranges: null, evidence: 'flow', since,
        reason: `Au bout du chemin, ${fr(f.balanceSol)} SOL sont posés sur ${s4(f.address)}${since != null ? ` depuis ${ago(since)}` : ''}. Mais en route, son argent est passé par ${s4(merge.address)} qui l'a mêlé à d'autres fonds (${fr(merge.inSol)} SOL entrés, ${fr(merge.outSol)} SOL ressortis) : ce n'est peut-être pas à lui. C'est typique d'un service de mélange partagé.`,
        tip: 'Mets-le seulement si tu acceptes le doute. Plus sûr : relance une traque sur son prochain token dès qu’il sort.',
      };
    }
    if (flow.end === 'rest' && f.balanceSol >= 1 && f.address !== start) {
      return {
        verdict: 'track', urgent: true, mode: 'last', address: f.address, ranges: null, evidence: 'flow', since, options: lastTransferOptions(),
        reason: `Son argent (${fr(f.balanceSol)} SOL) est posé sur ${s4(f.address)}${since != null ? ` depuis ${ago(since)}` : ''}, après ${pl(hops, 'wallet', 'wallets')}. Mets-le tout de suite : dès qu'il envoie tout vers un nouveau wallet, le bot suit.`,
        warning: flow.path.some((p) => p.kind === 'relay') ? relayWarn : null,
      };
    }
    if (flow.end === 'rest' && f.address === start && (startBalanceSol ?? 0) >= 1) {
      return {
        verdict: 'track', urgent: true, mode: 'last', address: start, ranges: null, evidence: 'flow', options: lastTransferOptions(),
        reason: `${base.kind === 'cex' ? `Son exchange (${base.name}) ne montre pas de montant répété : pas de tracker durable pour l'instant. À défaut, l'adresse` : 'L’adresse'} a encore son argent (${fr(startBalanceSol)} SOL). Mets-la tout de suite : dès qu'elle envoie tout vers un nouveau wallet, le bot suit.`,
      };
    }
    if (flow.end === 'mixer') {
      return {
        verdict: 'lost', evidence: 'flow',
        reason: `Son argent passe dans un mélangeur : ${pl(mixers, 'wallet jetable', 'wallets jetables')} à plusieurs centaines de transactions, utilisés une seule fois, qui mêlent son SOL à d'autres, avec des relais entre chacun (${pl(hops, 'wallet', 'wallets')} déjà traversés). On ne peut pas suivre l'argent jusqu'à son prochain dev : aucune adresse ne servira dans le bot.`,
        tip: 'Pour l\'attraper quand même : trace son prochain token dès qu\'il sort (la chaîne dev → dev se voit pendant qu\'il lance), ou cherche-le avec la Recherche de ruggers.',
      };
    }
    if (flow.end === 'service') {
      const fund = base.address && base.minSol != null ? ` Côté entrée, il avait reçu ${fr((base.minSol + base.maxSol) / 2, 4)} SOL : si un wallet neuf reçoit pile ce montant, c'est peut-être lui.` : '';
      return {
        verdict: 'lost', evidence: 'flow',
        reason: `Son argent est reparti dans un service de paiement (${s4(f.address)} : ${f.txCount >= 1000 ? `plus de ${f.txCount.toLocaleString('fr-FR')}` : f.txCount} transactions et ${fr(f.balanceSol ?? 0)} SOL, un wallet qui change régulièrement). Il s'en sert comme d'un exchange, pour retirer et pour déposer. Le prochain retrait sortira d'un autre wallet du service : aucune adresse fixe à mettre dans le bot.${fund}`,
        tip: 'Trace son prochain token dès qu’il sort : la chaîne de relais entre le service et le dev se voit tant qu’il est en train de lancer.',
      };
    }
    if (flow.end === 'exchange') {
      return {
        verdict: 'late', evidence: 'flow',
        reason: `Son argent a fini sur ${f.label && f.label !== 'Exchange' ? f.label : `un exchange ou un service très actif (${s4(f.address)})`}, après ${pl(hops, 'wallet', 'wallets')}. Il ressortira vers un nouveau wallet qu'on ne peut pas encore voir.`,
        tip: base.verdict === 'dig' ? base.reason : 'Relance une traque sur son prochain token : on cherchera alors le montant exact qu\'il retire de l\'exchange.',
      };
    }
    if (['split', 'spent', 'max'].includes(flow.end) && hops > 0) {
      return {
        verdict: 'late', evidence: 'flow',
        reason: `Trop tard pour ce cycle : son argent est passé par ${pl(hops, 'wallet', 'wallets')}${since != null ? ` (dernier mouvement il y a ${ago(since)})` : ''} et ${flow.end === 'split' ? 'a été éparpillé sur beaucoup de petits wallets' : flow.end === 'max' ? 'bouge encore, trop loin pour être suivi' : 'a été dépensé'}. Les wallets traversés étaient jetables : aucun ne resservira.`,
        tip: 'Relance une traque dès son prochain rug, pendant qu\'il est en train de lancer.',
      };
    }
  }

  if (base.verdict === 'reject') return { verdict: 'reject', reason: base.reason };
  // conseil de l'amont, seulement si l'adresse a encore de quoi bouger
  if (base.verdict === 'track' && base.kind === 'chain' && base.address === start && (startBalanceSol ?? 0) < 0.05) {
    return { verdict: 'late', reason: `${s4(start)} est déjà vide : il a fini son cycle. Relance une traque dès son prochain token.` };
  }
  return {
    verdict: base.verdict, mode: base.kind === 'chain' ? 'last' : 'exchange', address: base.address, evidence: 'before', options: base.kind === 'chain' ? lastTransferOptions() : sourceOptions(false, true),
    ranges: base.minSol != null ? [base.minSol, base.maxSol] : null, reason: base.reason, warning: base.warning || null,
  };
}
