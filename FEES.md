# FEES — Où vont les fees de Vigil `[F-040]` `[F-041]`

> Doc Jupiter vérifiée le 23 nov. 2026 (developers.jup.ag, Swap V2). Fees des concurrents relevées le même jour (sources plus bas). À revérifier avant le lancement.

## 1. Le message (ce que l'utilisateur doit se dire : "en vrai ça va, trop cool")
> **Half the fee. 75% comes back.**
> La plupart des terminaux Solana prennent ~1 % par trade. Vigil prend **0,5 %**, et **75 % de cette fee reviennent** à ceux qui l'utilisent : **25 % aux traders** (cashback en SOL, chaque jour) et **50 % aux holders** (rachat de $VIGIL, dont la moitié brûlée).
> **Coût réel pour le trader : 0,375 %.**

Inspiré du principe de Pons (1 % par trade, dont 70 % reversés aux créateurs de tokens), **adapté à Vigil** : Pons est une plateforme de lancement de tokens, donc il reverse aux créateurs ; Vigil est un terminal de trading, donc il reverse aux traders et aux holders.

## 2. Face aux concurrents (relevé du 23 nov. 2026, chiffres publics, à revérifier)
| Terminal | Fee par trade | Ce qui revient |
|---|---|---|
| Photon | 1 % | rien (des points) |
| GMGN | 1 % (≈ 0,7 % avec parrainage) | réduction de parrainage |
| Axiom | 0,95 % | cashback 0,05 % |
| Trojan | 1 % (0,5–0,9 % avec paliers) | paliers |
| Padre | 0,5–1 % (≈ 0,4–0,65 % après cashback) | cashback en SOL |
| **Vigil** | **0,5 %** | **25 % en cashback SOL → 0,375 % réel**, + 50 % en rachat de $VIGIL |

Sur le site, on ne cite **pas** les concurrents par leur nom (les chiffres changent souvent) : on dit "most Solana terminals take about 1%".

## 3. Comment c'est prélevé (non-custodial)
Le trade est **une seule transaction** que l'utilisateur signe dans son wallet (Phantom, Solflare, Backpack). Vigil ne touche jamais aux fonds.

| Sens | Fee | Où dans la transaction |
|---|---|---|
| **Achat** (SOL → token) | 0,5 % du montant en SOL | Virement SOL vers le wallet de fees **avant** le swap ; le swap utilise les 99,5 % restants. L'utilisateur dépense exactement le montant choisi. |
| **Vente** (token → SOL) | 0,5 % du SOL **minimum garanti** | Virement SOL **après** le swap. Calculé sur le minimum, donc jamais plus de 0,5 % de ce qu'il reçoit. |

Si le trade échoue, la fee échoue avec lui (tout est dans la même transaction).

Pourquoi un virement à nous plutôt que le `platformFeeBps` de Jupiter : fees **toujours en SOL**, dans **un seul wallet**, quelle que soit la route, **visibles on-chain**. Jupiter ne prend **rien** sur `/build` ; sur `/order` (Ultra) il prendrait 20 % de nos fees → on ne l'utilise pas.

## 4. Le wallet qui reçoit
- **Un multisig Squads** (squads.so), 2 signatures sur 3, créé **par toi**. Jamais une clé privée dans le code ni chez moi.
- Je n'ai besoin que de son **adresse publique** → `web/.env.local` → `VIGIL_FEE_WALLET=...`.
- Tant qu'elle n'est pas renseignée, le trading est **bloqué**.
- L'adresse est affichée sur la page **/fees** (transparence).

## 5. La répartition (validée le 23 nov.)
| Part | Usage |
|---|---|
| **25 % — Back to you** | Cashback en SOL au trader, au prorata des fees qu'il a payées, versé chaque jour |
| **50 % — $VIGIL buyback** | Rachat de $VIGIL sur le marché, la moitié brûlée. Avant le token : mis de côté dans le multisig |
| **25 % — Operations** | Helius, Jupiter, hébergement, équipe |

**Exemple** : 100 000 $ de volume/jour → 500 $ de fees → 125 $ rendus aux traders, 250 $ de rachat, 125 $ pour faire tourner le projet (≈ 3 750 $/mois, l'infra coûte ~100 $/mois).

## 6. Le cashback (construit le 23 nov.)
**Tout est lu sur la blockchain, rien n'est déclaratif** : n'importe qui peut vérifier.
- **Ce qu'un trader a payé** = ses virements vers le wallet de fees, dans une transaction qui passe par Jupiter (donc un vrai trade Vigil).
- **Ce qu'on lui a versé** = les virements du **wallet de cashback** vers lui, dans une transaction avec le mémo `vigil-cashback`.
- **Ce qu'on lui doit** = 25 % de ses fees − ce qu'on lui a déjà versé. En dessous de 0,0005 SOL, ça attend le versement suivant.
- Le registre local (`web/.data/ledger.json`) n'est qu'un cache : supprimé, il se reconstruit depuis la blockchain.

**Les deux wallets :**
| Wallet | Qui le contrôle | Rôle |
|---|---|---|
| **Fees** (multisig Squads) | toi (2 signatures sur 3) | reçoit 100 % des fees |
| **Cashback** (wallet simple) | toi, clé dans un fichier hors du projet | reçoit chaque jour la part cashback (25 %) depuis le multisig, et paie les traders |

**Le versement quotidien (00:00 UTC) :**
1. Depuis Squads, envoyer la part cashback du jour au wallet de cashback.
2. Lancer `npx tsx --conditions=react-server scripts/payout.mts` (dans `web/`) : il affiche **à blanc** qui reçoit combien et ce qu'il faut sur le wallet.
3. Si c'est bon : la même commande avec `--send --keypair <chemin du fichier>`. Il paie par paquets de 18, avec le mémo, et affiche les liens Solscan.
Ne pas relancer `--send` juste après un envoi qui a coupé : attendre quelques minutes que les versements soient visibles, le script les déduira tout seul.

**Ce que voit l'utilisateur :** la page **/rewards** (compte à rebours jusqu'au versement, cashback en attente, fees payées, déjà versé), une ligne "Cashback, paid daily" dans la boîte de trade, et les totaux publics sur **/fees**.

Testé : lecture des fees sur de vraies transactions Jupiter de la blockchain, lecture d'un versement simulé (avec et sans mémo, transaction échouée), synchro du registre et versement à blanc. **Pas encore testé : un vrai versement** (il faut tes wallets).

## 7. Les fees du token $VIGIL lui-même
Si $VIGIL est lancé sur pump.fun : les **creator fees** vont aussi dans le multisig et suivent la même répartition.

## 8. À faire de ton côté
- [x] Wallet de fees donné le 23 nov. : `AQKqLA27QFCpeysa5kyrKgb7BiQCyFX12hGzi3h7UCwp` (wallet simple, déjà utilisé : 623 transactions, ~33,8 SOL). Le registre ne compte qu'à partir du 23 nov. et la page /fees n'affiche jamais son solde total. Un wallet neuf dédié a été proposé ; **tu as choisi de garder celui-ci** `[F-042]`.
- [x] Clé Helius configurée dans `web/.env.local` (jamais commitée)
- [ ] Créer le wallet de cashback (`solana-keygen new -o cashback.json`, fichier gardé hors du projet) et me donner son adresse publique
- [x] Valider la répartition 50 / 25 / 25 (validée le 23 nov.)

Sources concurrents : solanatools.io/solana-trading-bot-fees · madeonsol.com/blog/trojan-bot-review · axiompedia.com/guides/fees/solana-terminal-fee-index · memeburn.com/pons-robinhood-chain-memecoin

## Rachat de $VIGIL et preuves publiques (23 nov., F-070)
- **Rachat** : `npm run buyback` (à blanc), `npm run buyback -- --send --keypair <fichier>` (pour de vrai).
  - Dû = 50 % des fees Vigil reçues − SOL déjà dépensés en rachats.
  - Le rachat passe par la même route Jupiter que les trades, avec le mémo `vigil-buyback`.
  - La moitié des $VIGIL obtenus est brûlée (mémo `vigil-burn`) ; l'autre moitié reste dans le wallet de rachat.
  - Avant le token : le script indique la somme mise de côté.
- **Tour quotidien** : `npm run daily` (à blanc) / `npm run daily -- --send --cashback-key <f> --buyback-key <f>` — cashback puis rachat chaque jour à payoutHourUtc.
- **Le jour du lancement** : remplir `VIGIL_TOKEN_MINT` et `VIGIL_BUYBACK_WALLET` (adresses publiques) dans web/.env.local. Les clés privées restent dans tes fichiers, hors du projet.
- **Preuves** : page /verify. Tout est relu sur la blockchain :
  - fees trade par trade ;
  - cashback par mémo ;
  - rachats et burns par mémo ;
  - notes des verdicts téléchargeables.

