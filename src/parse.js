// Réduit une transaction Solana (jsonParsed) à ce qui sert au traçage.
// Le résumé ne dépend d'aucun wallet en particulier : il se met en cache par signature.

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58].map((c, i) => [c, BigInt(i)]));

export function b58decode(str) {
  let n = 0n;
  for (const c of str) {
    const v = B58_MAP.get(c);
    if (v === undefined) return null;
    n = n * 58n + v;
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of str) { if (c === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}

export const isAddress = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;

// L'instruction "create" de pump.fun porte : 8 octets de discriminant, puis name, symbol, uri
// (chaînes Borsh : longueur u32 + UTF-8). On reconnaît l'instruction à cette structure,
// ce qui couvre create et create_v2 sans dépendre du discriminant.
function decodePumpCreate(dataB58) {
  const b = b58decode(dataB58);
  if (!b || b.length < 8 + 12) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const td = new TextDecoder('utf-8', { fatal: true });
  let off = 8;
  const out = [];
  for (let i = 0; i < 3; i++) {
    if (off + 4 > b.length) return null;
    const len = view.getUint32(off, true);
    off += 4;
    if (len > 400 || off + len > b.length) return null;
    try { out.push(td.decode(b.subarray(off, off + len))); } catch { return null; }
    off += len;
  }
  const [name, symbol, uri] = out;
  if (!name || !symbol || !/^(https?:|ipfs:|ar:)/i.test(uri)) return null;
  return { name, symbol, uri };
}

export function summarize(tx, sig) {
  const msg = tx.transaction.message;
  const meta = tx.meta || {};
  const keys = msg.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const signers = msg.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);

  const solDelta = {};
  const pre = meta.preBalances || [];
  const post = meta.postBalances || [];
  for (let i = 0; i < keys.length; i++) {
    const d = (post[i] ?? 0) - (pre[i] ?? 0);
    if (d !== 0) solDelta[keys[i]] = d;
  }

  // Variation de solde de token par (propriétaire, mint)
  const tok = new Map();
  const addTok = (list, sign) => {
    for (const t of list || []) {
      if (!t.owner || t.mint === WSOL) continue;
      const key = `${t.owner}|${t.mint}`;
      const dec = t.uiTokenAmount?.decimals ?? 6;
      const amt = Number(t.uiTokenAmount?.amount ?? 0) / 10 ** dec;
      const cur = tok.get(key) || { owner: t.owner, mint: t.mint, delta: 0, post: 0 };
      cur.delta += sign * amt;
      if (sign > 0) cur.post += amt;
      tok.set(key, cur);
    }
  };
  addTok(meta.preTokenBalances, -1);
  addTok(meta.postTokenBalances, +1);
  const tokenDelta = [...tok.values()].filter((t) => Math.abs(t.delta) > 1e-9);

  const transfers = [];
  let pump = false;
  let create = null;
  const visit = (ix, top) => {
    if (ix.programId === PUMP || ix.programId === PUMP_AMM) pump = true;
    if (ix.program === 'system' && ix.parsed?.info) {
      const { type, info } = ix.parsed;
      if (type === 'transfer' || type === 'transferWithSeed') {
        transfers.push({ from: info.source, to: info.destination, lamports: Number(info.lamports), top });
      } else if (type === 'createAccount' || type === 'createAccountWithSeed') {
        transfers.push({ from: info.source, to: info.newAccount, lamports: Number(info.lamports), top });
      }
    }
    if (!create && ix.programId === PUMP && typeof ix.data === 'string' && ix.accounts?.length) {
      const d = decodePumpCreate(ix.data);
      if (d) create = { mint: ix.accounts[0], ...d };
    }
  };
  for (const ix of msg.instructions || []) visit(ix, true);
  for (const inner of meta.innerInstructions || []) for (const ix of inner.instructions || []) visit(ix, false);

  return {
    sig,
    time: tx.blockTime ?? null,
    failed: !!meta.err,
    feePayer: keys[0],
    fee: meta.fee ?? 0,
    signers,
    solDelta,
    tokenDelta,
    transfers,
    pump,
    create,
  };
}
