# ENGINE — La technologie de Vigil `[F-046]`

> Le test : **un trader malin ne doit pas pouvoir refaire ce que fait Vigil à la main en 2 minutes** avec Solscan, Bubblemaps, RugCheck ou GMGN. Sinon Vigil n'a aucun intérêt, et $VIGIL non plus.

## 1. Ce que les traders savent déjà faire seuls (donc pas notre valeur)
| Ce qu'ils voient déjà | Où |
|---|---|
| Top holders, % du top 10 | Solscan, DexScreener, GMGN |
| Mint / freeze authority | RugCheck |
| Carte des holders | Bubblemaps |
| "Bundle %" d'un token (achats du bloc 0) | Axiom, GMGN, Photon |
| Graphique, trades | partout |

→ Ces infos restent dans Vigil (on ne peut pas faire moins), mais **ce n'est pas l'argument**.

## 2. Ce que Vigil voit et qu'ils ne voient pas

### 2.1 Les liens cachés : qui a financé qui ✅ (codé le 23 nov.)
Les rugs n'achètent plus avec un seul wallet : ils créent 5 à 30 wallets neufs, les remplissent de SOL depuis un même wallet quelques minutes avant, et achètent dans des blocs différents pour passer sous les radars "bundle %".
- Pour chaque premier acheteur et chaque gros détenteur, Vigil remonte **qui lui a envoyé ses premiers SOL**, puis **le financeur du financeur** (2 niveaux).
- Les exchanges et gros hubs sont détectés et **ignorés** (sinon tout le monde serait "lié" via Binance).
- Résultat affiché : *"7 wallets funded by the same wallet took 34%"*, *"the dev's funding wallet also funded 5 buyers"*, *"fresh wallets, made just before launch"*.
- Fichiers : `web/lib/server/funding.ts`, utilisé par `scan.ts`.

### 2.2 Bots snipers ≠ bundle du dev ✅ (codé le 23 nov.)
60 % pris dans les 10 premières secondes peut venir de bots indépendants (vieux wallets à plus de 1 000 transactions qui snipent tout) ou du dev déguisé. Ce n'est pas le même risque. Vigil les sépare : *"9 wallets took 60% in the first 10 s (7 of them sniper bots)"*.

### 2.7 L'entonnoir : la vitesse vient du tri ✅ (codé le 23 nov.) `[F-049]`
~20 lancements par minute : on ne peut pas tout creuser, et la plupart meurent tout de suite.
1. **Morts** (moins de 1 000 $ réellement levés sur la courbe après 90 s) : ni scan, ni affichage par défaut ("12 dead hidden", un clic pour les voir).
2. **Scan rapide** pour tous les vivants dès leurs 10 premières secondes : lancement, holders, autorités, mémoire du dev. **4 à 6 s** sur le plan gratuit (mesuré le 23 nov.).
3. **Scan complet** (financements sur 2 niveaux) seulement pour les tokens qui attirent de l'argent réel (≥ 1 000 $ levés ou ≥ 3 % de courbe), ou ouverts / demandés. Le verdict rapide reste affiché pendant ce temps ("tracing funding…").
4. Les requêtes passent par 3 files de priorité : flux des nouvelles paires > scans demandés > travail de fond.
5. **Le scan se fait côté serveur, au fil de l'eau** `[F-050]` : le flux tourne en continu sur le serveur, chaque lancement vivant est scanné dès ses 10 s, et le verdict part **avec la ligne** (plus d'écran qui attend). Le spam (dev en série, ferme à devs) reçoit son verdict directement depuis la mémoire, sans dépenser de scan.
6. **Pause au survol** : la liste se fige sous la souris ("Paused · 3 new"), les verdicts continuent de se mettre à jour.
10. **On ne scanne que là où l'argent entre** : un lancement n'est scanné qu'à partir de 300 $ réellement levés (ou 1 % de courbe). En dessous, "Waiting for real buyers" : la plupart de ces tokens meurent seuls, inutile de dépenser du quota.
11. **Traçage du lancement en 2 requêtes** : la liste des signatures (1 000 par requête) puis seulement les transactions des 10 premières secondes, décodées par Helius en une fois (au lieu de remonter page par page).
9. **Deux voies côté serveur** : un scan complet prend 22–28 s ; il a sa propre voie (1 à la fois) pour ne jamais bloquer les scans rapides (2 en parallèle, 3–12 s chacun).
8. **Coût d'un scan rapide divisé par ~6** : l'API "transactions enrichies" de Helius rend 100 transactions décodées en 1 requête (au lieu d'1 requête par transaction). Et le plan gratuit **refuse les requêtes groupées** (lots JSON-RPC) : tout passe en requêtes simples régulées (8/s). Flux des nouvelles paires : 49 s → 6,5 s à froid, 1,8 s ensuite (mesuré le 23 nov.).
12. **Un token tout neuf s'affiche quand même** `[F-052]` : tant que DexScreener ne le connaît pas, nom/logo via Helius, prix/MCap/progression lus sur la courbe, graphique tiré des trades. La courbe peut être cotée dans une autre monnaie que le SOL (ex. NVDAx) : le mint de cotation est lu à l'octet 83 et converti avec son cours (vérifié à < 1 % de DexScreener).
13. **Couche rapide GMGN** (clé fournie le 23 nov., `GMGN_API_KEY` dans `web/.env.local`) : en ~0,3 s, l'historique **complet** du dev (tokens lancés depuis toujours, a-t-il tout vendu, qui l'a financé) et les étiquettes de wallets (bundlers, insiders, rat traders, snipers). Le scan rapide s'en sert et saute le traçage du lancement ; le scan complet refait tout avec notre moteur (10 premières secondes, financements sur 2 niveaux). Règles : dev ≥ 20 lancements = Bundled (≥ 5 = Watch) ; bundlers ou insiders ≥ 20 % = Bundled (≥ 10 % = Watch) ; rat traders ≥ 20 % = Watch. Plan gratuit GMGN : budget de 1 point/s (info 1 + security 1 par token), et si GMGN met en pause, le scan continue sans lui (jamais d'attente). Les données GMGN sont affichées comme telles ("data: GMGN") : on ne les fait pas passer pour les nôtres, et Vigil ne dépend pas d'elles pour fonctionner.
14. **Vitesse mesurée le 23 nov.** (ouverture d'un token jamais scanné, plan gratuit Helius + GMGN) : trades et graphique 0,5 s · en-tête 1,3 s · verdict 4,4 s · scan complet (financements) 16 s en arrière-plan. Un token déjà vu par le flux : verdict instantané.
15. **Premier regard à ~10 s pour chaque lancement** `[F-056]` : la courbe lue par le flux (toutes les 3 s) donne la part du supply achetée dans les ~10 premières secondes, sans requête de plus. Verdict immédiat (≥ 30 % = Bundled, ≥ 15 % = Watch), affiné ensuite par le scan rapide (GMGN, holders) puis complet (financements). Mesuré : 82/82 lancements jugés, médiane 10 s.
7. Pump.fun uniquement : le flux ne lit que les créations signées par l'autorité de mint de pump.fun. Certains lancements démarrent avec une courbe presque vide (0,02 à 2,4 SOL virtuels au lieu de ~30) : MCap de quelques dollars, réelle, et écartés comme "morts" après 90 s.

**Règles fortes du verdict** (lisibles, une phrase chacune) : groupe de wallets liés ≥ 20 % = Bundled · dev en série (≥ 3 lancements en 24 h) = Bundled · ferme à devs (son financeur a financé ≥ 2 autres devs) = Bundled · wallet de dev créé < 1 h avant = Watch.
Nuance retenue : un dev qui lance son **premier** token n'est pas un signal de rug ; c'est le dev **en série** qui l'est.

### 2.3 La mémoire de tous les lancements — version légère ✅, base de données 🔜 (phase 1)
**Déjà en place (en mémoire)** : chaque lancement vu est enregistré, le wallet du dev est tracé en arrière-plan (qui l'a financé, quand il a été créé). Dès les premières minutes on voit des devs qui relancent le même token 5, 8, 20 fois. Limite : la mémoire repart à zéro au redémarrage du serveur → la base Postgres de la phase 1 la rend permanente.
Un indexeur maison enregistre **chaque lancement pump.fun** (~20/minute, ~25 000/jour) : dev, financeurs, premiers acheteurs, clusters, et **ce que le token est devenu** (rug en X minutes, migration, plus haut).
Ce que ça débloque, impossible à refaire à la main :
- **Réputation des devs ET de leurs financeurs** : un rugger change de wallet à chaque fois, mais il réutilise ses financeurs. *"This funding wallet launched 41 tokens; 39 died within 1 hour."*
- **Réputation des wallets** : snipers connus, insiders récurrents, wallets qui apparaissent dans les rugs.
- **Probabilités tirées de l'historique** : *"Tokens with this pattern rugged 87% of the time within 1 hour (1 204 cases)"*. Pas un avis : une statistique vérifiable.

### 2.4 Le radar de sortie en direct 🔜 (phase 2)
Après le lancement, Vigil **surveille les wallets du cluster** : *"Bundle selling: 4 of 7 linked wallets sold in the last 30 s"*, avant que la bougie rouge apparaisse. Alerte dans le terminal et sur Telegram.

### 2.5 Le registre des comptes de protocole ✅ (début)
Les comptes qui détiennent du supply sans être des personnes : pools, bonding curves, verrous, et l'agent "Mayhem" de pump.fun (1 milliard de tokens sur 2 en mode Mayhem). Sans ce registre, un scan naïf voit "un wallet à 50 %" et crie au rug à tort (corrigé le 23 nov.).

### 2.6 La vitesse 🔜 (phase 1)
Aujourd'hui le scan est demandé à la volée (10 à 120 s selon la charge). Avec l'indexeur en flux (gRPC), le verdict est **calculé au fil de l'eau** et prêt à T+10 s pour chaque lancement, avant que l'utilisateur clique.

**Ouverture d'un token (F-058)** : graphique TradingView DexScreener chargé sans requête préalable (paire pump.fun = adresse de la bonding curve), choix figé une fois ; scans de la liste suspendus 4 s au clic (limite de 6 connexions du navigateur) ; préconnexion DexScreener. Historique des trades lu sur l'adresse de la **courbe** et non du token (85 % des transactions sur l'adresse du token sont du bruit de bots). Mesuré en local : page 0,1–0,4 s, graphique en place 0,5–1 s. Écran de transition au clic (F-059) : affiché en 18 ms, suit les vraies étapes (page, verdict, graphique) et se ferme quand le graphique est chargé.

**Backtest du 23 nov. (277 lancements, 15 min, AUDIT_2026-11-23.md §6)** :
- mémoire des devs = signal le plus fort (2 survivants sur 131) ;
- "≥ 30 % au lancement" ne prédit pas un effondrement (4 migrations sur 4) ;
- zone 15–30 % : 13/13 effondrés.

Bulletin continu : page Track record (lib/server/watch.ts). À recalibrer après 24 h de données.

## 3. Architecture cible
```
Solana ──(Helius LaserStream / gRPC : chaque transaction pump.fun, PumpSwap, Raydium, Meteora)──▶ Ingestor
Ingestor ──▶ file de messages ──▶ Workers
   • launches : création, dev, supply, curve
   • trades : achats / ventes, PnL par wallet
   • funding : premiers SOL de chaque nouveau wallet (2 niveaux), hubs
   • outcomes : rug / migration / ATH à 5 min, 1 h, 24 h
Workers ──▶ Postgres (+ TimescaleDB pour les séries) ──▶ API Vigil ──(websocket)──▶ terminal
```
- **Hébergement** : un serveur qui tourne en continu (Railway, Fly ou VPS ~20–40 $/mois), pas du serverless.
- **Tables clés** : `tokens`, `launches`, `wallets` (premier financeur, âge, score), `funding_edges`, `clusters`, `trades`, `outcomes`, `protocol_accounts`.

## 4. Coûts et limites honnêtes
> Prix et limites Helius de mémoire, **à vérifier sur helius.dev avant de payer**. Ce qui est sûr : sur le plan gratuit, on a atteint la limite de requêtes pendant les tests du 23 nov.

| Étape | Helius | Ce qu'on peut faire |
|---|---|---|
| **Aujourd'hui** (plan gratuit) | ~10 requêtes/s | Scan à la demande, 15 à 120 s par token ; impossible de scanner tous les lancements |
| **Phase 1** | Developer ~49 $/mois (≈ 50 req/s, websockets) | Scanner chaque nouveau lancement, mémoire des devs/financeurs |
| **Phase 2** | Business ~499 $/mois (LaserStream gRPC) | Flux complet en temps réel, radar de sortie, verdict à T+10 s |

Payé par la part "Operations" des fees (25 %). À 100 000 $ de volume/jour, elle rapporte ~3 750 $/mois.

## 5. Règles de fond
- **Chaque verdict donne sa raison**, vérifiable on-chain (liens Solscan). Jamais de "score IA" opaque.
- **Des faits et des statistiques, jamais un conseil.**
- **Pas de faux positifs faciles** : exchanges ignorés, protocoles exclus, snipers séparés du dev.
- **Mesurer la précision** : chaque semaine, % des tokens "Bundled" qui ont rug vs % des "Clean". Publié sur le site (c'est aussi du marketing).

## 6. Feuille de route
| Phase | Contenu | Ce que l'utilisateur voit |
|---|---|---|
| ✅ 0 (fait) | Scan à la demande : lancement, holders, autorités, liquidité, **financements sur 2 niveaux**, **snipers vs bundle**, registre protocole, **entonnoir (morts cachés, scan rapide 4–6 s, complet pour les vivants)**, **mémoire des devs en série et des fermes** | Verdict + raison, clusters, bubble map par financeur, trades tagués DEV / BUNDLE |
| 1 | Indexeur (Helius Developer) + base Postgres : chaque lancement scanné, mémoire devs/financeurs, outcomes | *"This funder launched 41 tokens, 39 died"*, verdict prêt avant le clic |
| 2 | Flux temps réel (LaserStream), radar de sortie, alertes Telegram, précision publiée | *"Bundle selling now"*, page "Vigil accuracy" |
| 3 | Probabilités par motif (backtest sur l'historique) | *"87% of similar launches rugged within 1 h"* |
