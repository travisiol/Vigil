# Vigil — app web

Next.js 16 (App Router, TypeScript). Architecture : [../ARCHITECTURE.md](../ARCHITECTURE.md) · Fees : [../FEES.md](../FEES.md) · Marque : [brand.config.ts](brand.config.ts).

## Lancer en local
```
npm install
cp .env.local.example .env.local   # puis remplir (voir ci-dessous)
npm run build
npm start                          # http://localhost:3100
```

## .env.local
| Variable | Sans elle |
|---|---|
| `SOLANA_RPC_URL` (Helius, offre gratuite) | RPC public : le scan ne lit ni les holders ni (souvent) le lancement |
| `JUPITER_API_KEY` | 0,5 requête/s vers Jupiter |
| `VIGIL_FEE_WALLET` (adresse publique du multisig) | trading bloqué |
| `VIGIL_CASHBACK_WALLET` (adresse publique) | pas de cashback lu ni versé |

## Contrôle de la transaction
`npx tsx --conditions=react-server scripts/check-swap.mts <mint>` (avec `VIGIL_FEE_WALLET` défini) construit un achat et une vente **sans signer ni envoyer** et liste les instructions : on doit voir le virement de fee de 0,5 % au bon endroit.

## Cashback quotidien
`npx tsx --conditions=react-server scripts/payout.mts` → à blanc (qui reçoit combien).
`... --send --keypair <fichier hors du projet>` → verse pour de vrai. Détails : [../FEES.md §6](../FEES.md).
Test du registre : `npx tsx --conditions=react-server scripts/test-ledger.mts`.
