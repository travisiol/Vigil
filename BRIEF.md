# BRIEF — Projet 01 : Vigil (vigil.trade · $VIGIL) — "Always on watch."

## Idée d'origine
ID-001 dans [idees/IDEES.md](../../idees/IDEES.md) — **8,3/10** · piste P-16 · inspiré de Foam ([analyse](../../analyses/foam/ANALYSE.md)), ton projet préféré `[F-018]`

## En une phrase
> **Le terminal de trading memecoin Solana qui voit à travers chaque token avant que tu cliques : achat en 1 clic, ultra rapide, et un scan anti-rug sur chaque ligne.**

## Le problème
1. Trader des memecoins, c'est **aller vite** : les terminaux actuels sont rapides, mais **aveugles** sur le risque.
2. Avant d'acheter, un trader sérieux ouvre 4 outils : le graphique, les holders, le dev, les premiers acheteurs. Il perd du temps et rate l'entrée.
3. 92 % des lancements pump.fun sont morts au bout de 2 h, et beaucoup sont **bundlés** (quelques wallets prennent 50–80 % du supply à la création — on l'a vu sur Minelius, Lares…).

## La réponse (ce qui nous rend différents de Foam, Axiom, Photon…)
**Le "scan" intégré** : sur chaque token, en direct et sans quitter le terminal :
- % du supply pris dans les **10 premières secondes** et par le plus gros wallet
- part encore détenue par les **initiés**
- **ventes groupées** (plusieurs wallets qui vendent dans le même bloc)
- **historique du dev** (lancements, migrations, vitesse de sortie)
- liquidité réelle vs market cap
→ un **badge clair** sur chaque ligne : *Sain* · *À surveiller* · *Bundlé* — avec le détail en survol.

## La cible
Les traders actifs de memecoins Solana (débutants qui veulent éviter les rugs + degens qui veulent aller plus vite que les autres).

## Fonctionnalités (MVP)
1. **Discover** : tendances, nouvelles paires, migrations du moment, filtres (dont "cacher les bundlés")
2. **Page token** : graphique, achat/vente en 1 clic (montants rapides), slippage, **panneau Scan**
3. **Quick Buy** depuis la liste (comme Foam), exécution prioritaire (Jito / frais de priorité auto)
4. **Portfolio** + **cartes PnL partageables** générées automatiquement (image de partage dynamique)
5. **Rewards actifs dès le jour 1** : cashback sur les frais, rangs, parrainage
6. ~~Bot Telegram~~ — abandonné `[F-062]` : Vigil reste un terminal web
6 bis. **Bulletin de notes public des verdicts** : chaque verdict noté 15 min après, jamais modifié (page Track record)
7. **Tableau de bord public** : frais collectés · token racheté · token brûlé

Phase 2 : suivi de wallets / KOL, alertes, copy-trade, multichaîne (comme Foam).

## Modèle économique
- **Frais de trading affichés en clair** (0,5 % par trade, moitié du marché, dont 75 % reversés aux traders et aux holders — voir FEES.md).
- Les frais financent : **rachat du token** + rewards + opérations (répartition publique).

## Le token
- Lancé **après** une bêta avec de vrais utilisateurs et une audience `[F-012]`.
- Utilités : **rachat avec les frais** · **paliers holders** (frais réduits puis très réduits, boost de cashback) · accès anticipé aux features.
- Lancement **protégé** : supply de l'équipe bloqué publiquement, pas de bundle.

## Pages
- **Landing** (barre du [playbook](../../DESIGN_PLAYBOOK.md)) : titre ≤ 6 mots, l'app vivante dans le hero avec le scan en action, chiffres live, CA, barre fixe mobile
- **App** : Discover · Token · Portfolio · Rewards · Tableau de bord des rachats
- **Docs** : comment marche le scan, frais, sécurité (non-custodial)

## Tech Solana
| Brique | Usage |
|---|---|
| Jupiter Swap API | Exécution + frais d'intégrateur (revenus) |
| Helius (RPC, WebSocket, transactions parsées, DAS) | Données live, calcul du scan (premiers acheteurs, holders, ventes groupées) |
| DexScreener / flux pump.fun | Tendances, nouvelles paires, migrations |
| Jito | Exécution prioritaire, protection MEV |
| Privy ou Wallet Adapter | Connexion (Phantom, Solflare, Backpack, e-mail) — non-custodial |
| @vercel/og | Cartes PnL et images de partage dynamiques |
| Next.js + Tailwind + composants 21st.dev | Front |

## Risques
- **Marché très concurrentiel** (Axiom, Photon, GMGN, BullX, Foam) → notre angle doit rester net : *rapide + voit les rugs*.
- **Coût d'infra** (RPC, indexation) → commencer sur les tokens pump.fun / PumpSwap.
- **Sécurité** : non-custodial obligatoire, pas de clé privée stockée.
- Le scan donne des **faits**, jamais un "conseil d'achat".

## Noms proposés
> Refaits le 23 nov. selon tes règles : en anglais `[F-020]`, le nom appelle un logo évident comme Runner `[F-021]`, domaine en .trade `[F-022]`. (Sift / Vigil / Scryer abandonnés : pas d'image évidente.)

| Nom | Sens (produit + image) | Logo / mascotte | Ambiance | Domaine (RDAP, 23 nov.) |
|---|---|---|---|---|
| **Ferret** ⭐ | **"To ferret out"** = débusquer ce qui est caché. Le furet fouille les terriers… et trouve le rug avant toi. Ticker $FERRET | Silhouette de furet qui sort la tête d'un trou, museau en avant | Malin, rapide, un peu espiègle | `ferret.trade` ✅ libre (et ferret.fun ✅) |
| **Hound** | **"To hound"** = traquer, et le **limier** qui flaire les rugs. Ticker $HOUND | Tête de limier (bloodhound), oreilles tombantes, truffe en avant | Détective, sérieux, tenace | `hound.trade` ✅ libre (et hound.fun ✅) |
| **Mongoose** | La **mangouste** est l'animal qui chasse les **serpents** — et les "snakes" sont les arnaqueurs dans le jargon crypto. Ticker $MONGOOSE | Mangouste dressée face à un serpent | Combatif, protecteur, memeable | `mongoose.trade` ✅ libre (et mongoose.fun ✅) |

**Écarté :** *Meerkat* (la sentinelle du désert, idée parfaite) — mais **Meerkat Finance** a été un rug très connu sur BSC en 2021 : impossible pour un terminal anti-rug.

À vérifier avant de valider : handle X libre, pas d'autre projet crypto du même nom.

## Directions artistiques proposées
Aperçu visuel : [da-preview.html](da-preview.html)

| DA | Palette | Typo | Visuel signature | Va bien avec |
|---|---|---|---|---|
| **A — Rayon X** | Noir bleuté + **cyan "rayon X"** réservé au scan ; vert/rouge réservés au PnL | Space Grotesk + Inter + JetBrains Mono | Une **ligne de scan** passe sur chaque token et révèle ce qui est caché (holders, bundle, dev) | **Ferret** (le furet qui fouille dans le noir) |
| **B — Ambre de veille** | Graphite chaud + **ambre** (alerte, chaleur de la savane) | Bricolage Grotesque + Geist + Geist Mono | Un **balayage radar** ambre qui "veille" sur la liste | **Mongoose** (savane, chasseur de serpents) |
| **C — Papier de cotation** | **Thème clair** crème + encre noire + **rouge-orange** signal (contre-courant) | Instrument Serif + Geist + Geist Mono | Un **ruban de cotation** qui imprime les trades en direct | **Hound** (le limier détective, style éditorial vintage) |

## Décisions
- Nom retenu : ~~Ferret~~ → **abandonné, "le furet fait pas pro"** `[F-029]`. Nouveaux noms à symbole pro (tous libres en .trade + handle X, sans homonyme crypto notable, vérifiés le 23 nov.) :
  | Nom | Idée | Symbole | Domaine · X |
  |---|---|---|---|
  | **Vigil** ⭐ | "Always on watch" : veille sur chaque token | Un **V** en 2 lames + un point = un œil qui veille | vigil.trade · @vigiltrade |
  | **Sieve** | "Only clean tokens get through" : filtre les rugs | 3 barres arrondies qui rétrécissent = un filtre | sieve.trade · @sievetrade |
  | **Probe** | "We probe every token" : on sonde chaque token | Un **P** dont la boucle est un anneau sondé par une ligne | probe.trade · @probetrade |
  → **Vigil retenu de fait** (logo n°4 choisi, style Foam : lames blanches sur violet `#3C057A`) `[F-033]` — [design/logo-vigil-4-crop.png](design/logo-vigil-4-crop.png)
  Écartés : Kelvin ($KEL à 3,7 M$ sur Ethereum), Reticle (@ReticleTrade existe), Torch, Ember, Lantern, Xray (domaines ou projets déjà pris).
- **Logo validé** `[F-035]` : le V seul en dégradé violet → rose sur fond nuit ([design/logo-vigil-final-v1.png](design/logo-vigil-final-v1.png))
- **DA retenue : Vigil Glow** (palette 15, tirée du logo) — voir [DESIGN.md](DESIGN.md)
- Historique DA : ~~A — Rayon X~~ → **rejetée, "fade, trop générique"** `[F-025]`. Nouvelles directions à générer dans ChatGPT : **Heat Vision** (thermique), **Rug Patrol** (affiches WANTED, BD pop), **Burrow** (furet mineur) → [PROMPTS_CHATGPT.md](PROMPTS_CHATGPT.md). **En cours : Heat Vision** — logo v1 "pas assez pro" `[F-027]` → version **Heat Vision Pro** (palette 14, symbole géométrique + mascotte v1 gardée pour le marketing)
