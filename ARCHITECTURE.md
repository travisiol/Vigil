# ARCHITECTURE — Vigil (vigil.trade)

Code : [web/](web/) (Next.js, App Router, TypeScript). Fees : [FEES.md](FEES.md).

## Vue d'ensemble
```
Navigateur (wallet Phantom / Solflare / Backpack — signe tout)
   │
   ▼
Next.js (vigil.trade)
   ├─ /                 landing v2 (statique)
   ├─ /app              Discover : tokens live + colonne Scan + "Hide bundled" + Quick Buy
   ├─ /token/[mint]     graphique, panneau Scan détaillé, achat / vente
   ├─ /portfolio        positions du wallet connecté
   ├─ /rewards          cashback du wallet connecté (en attente, versé, compte à rebours)
   ├─ /fees             transparence : wallet de fees, solde, répartition
   ├─ /docs             comment marche le scan, les fees, la sécurité
   └─ API (serveur, garde les clés)
        ├─ /api/trending        DexScreener (boosts + profils) → enrichi (prix, mcap, liquidité)
        ├─ /api/scan/[mint]     moteur de scan (RPC Solana + DexScreener), cache 2 min
        ├─ /api/swap            Jupiter Swap V2 /build + virement de fee → transaction non signée
        ├─ /api/send            envoie la transaction signée, attend la confirmation
        ├─ /api/portfolio       soldes du wallet + prix
        └─ /api/fees            solde et derniers mouvements du wallet de fees
```

## Le moteur de scan (MVP, données réelles)
| Signal | Source | Calcul |
|---|---|---|
| **Supply pris dans les 10 premières s** | `getSignaturesForAddress(mint)` jusqu'au début, puis `getTransaction` des tx des 10 premières s | somme des achats (hausse de solde) par wallet, hors pools |
| **Plus gros wallet / top 10** | `getTokenLargestAccounts` + propriétaires | % du supply, **hors pools** (un propriétaire géré par un programme = pool / bonding curve) |
| **Dev** | payeur de la tx de création | ce qu'il détient encore, s'il a vendu |
| **Autorités** | compte du mint | mint authority / freeze authority encore actives ? |
| **Liquidité réelle** | DexScreener | liquidité / market cap |

**Verdict** : `Bundled` si ≥ 30 % pris en 10 s ou un wallet ≥ 20 % · `Watch` si autorité active, top 10 ≥ 40 %, liquidité < 5 % du mcap, ou dev qui a vendu · sinon `Clean`. Chaque verdict donne **la raison en une phrase**. Ce sont des faits, jamais un conseil.

Limite connue : sur un token très actif, remonter au lancement avec un RPC public est trop lent → le signal "10 premières s" passe en "non mesuré". Solution : **indexeur maison** (phase 2) qui écoute chaque création pump.fun en direct (Helius webhooks / gRPC) et garde les premiers acheteurs et l'historique de chaque dev.

## Le trade
1. L'utilisateur choisit un montant → `/api/swap` appelle **Jupiter Swap V2 `GET /swap/v2/build`** (instructions brutes, routes pump.fun, PumpSwap, Raydium, Meteora…).
2. Le serveur assemble une transaction v0 : budget de calcul → setup → **virement de fee (achat)** → swap → cleanup → **virement de fee (vente)**. Il simule pour fixer la limite de calcul (×1,2).
3. Le navigateur fait signer la transaction par le wallet → `/api/send` l'envoie et attend la confirmation.
Limite : un token encore sur la bonding curve pump.fun et trop vieux n'est plus routé par Jupiter → phase 2 : achat direct sur le programme pump.fun (SDK officiel) avec le même virement de fee.

## Variables d'environnement (`web/.env.local`, jamais commité)
| Nom | Rôle |
|---|---|
| `SOLANA_RPC_URL` | RPC mainnet (Helius conseillé ; le RPC public marche mais est lent et limité) |
| `JUPITER_API_KEY` | clé du portail Jupiter (sans clé : 0,5 requête/s) |
| `VIGIL_FEE_WALLET` | adresse **publique** du multisig de fees (sans elle, le trade est bloqué) |
| `VIGIL_CASHBACK_WALLET` | adresse **publique** du wallet qui verse le cashback (sa clé n'est jamais sur le serveur) |
| `GMGN_API_KEY` | clé de l'Open API GMGN : couche rapide du scan (historique des devs, bundlers, insiders). Sans elle, le scan marche avec notre moteur seul |
| `LEDGER_PATH` | où ranger le cache du registre (par défaut `web/.data/ledger.json`) |

## Coûts (au lancement)
Helius Developer ~49 $/mois · Jupiter Developer 25 $/mois (gratuit au début) · Vercel Pro 20 $/mois. Payés par la part "opérations" des fees.

## Phase 2
Indexeur maison (lancements pump.fun en direct, historique des devs), achat direct pump.fun, alertes, cartes PnL (@vercel/og), paliers holders, bot Telegram. Hébergement : un serveur avec disque (Railway, Fly, VPS) pour garder le cache du registre ; sur Vercel il se reconstruit depuis la blockchain.
