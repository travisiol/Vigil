# RugTrace

Tracker de ruggers pump.fun. Tu colles l'adresse d'un dev (ou d'un token), l'outil te dit en haut de la page :

1. **Faut-il le tracker ?** (trackable, et rentable avec ta règle d'entrée) ;
2. **quoi mettre dans F Project** : l'adresse, le mode (Dernier Transfert, Modèle d'Échange ou Hybride), les plages, les options, avec un bouton pour tout copier ;
3. **ses prochains devs probables**, s'il en a déjà financé ;
4. **tous ses tokens** (avant, cette adresse, après, ses autres devs), chacun avec la route de l'argent qui y mène.

Pour y arriver, il remonte le financement (relais compris, jusqu'à l'exchange, le wallet mère ou le mélangeur), recense la source de chacun de ses devs, fouille les envois de cette source pour trouver ses autres devs, suit l'argent qui repart après le rug, et rejoue tes trades trade par trade. Les règles viennent de la méthode F Project.

## Règles reprises de la méthode F Project

- **Exchange** : plage de ±0,0001 SOL autour du montant exact (1,994 donne 1,9939 à 1,9941). Il faut le même exchange + le même montant chez au moins 2 devs : on suit alors l'adresse de l'exchange, jamais le wallet enfant. Sinon : « Pas encore », on garde l'exchange et le montant à surveiller.
- **Wallet mère** qui finance plusieurs devs : on suit la mère, une plage par montant (±0,01 SOL au plus, 3 % du montant pour les petits envois), 5 plages au plus.
- **Modes du bot** : *Dernier Transfert* (`last_transfer`) suit le wallet quand il se vide ; *Modèle d'Échange* (`simple`) suit les envois dans les plages ; *Hybride* fait les deux.
- **Options** (mêmes noms que l'écran Protection du bot) : *Conserver l'adresse* ON sur une source (OFF en Dernier Transfert) ; *Auto-éviction* ON avec Conserver l'adresse (garde tes 30 places libres) ; *Portefeuille vierge uniquement* seulement si ses devs étaient neufs ; *Supprimer sans lancement* ON, avec un délai tiré du plus long délai financement → lancement de ses devs ; *Supprimer après la 1re action* OFF ; *Hériter paramètres* ON, car sinon le dev ajouté reçoit les réglages par défaut du wallet et n'achète rien si l'achat auto y est coupé.
- **Même adresse réutilisée** (2 créations ou plus) : jamais un tracker.
- **Source sans label d'exchange** : pas un tracker exchange (un wallet très riche sans nom est signalé « à vérifier »).
- **Tokens cotés hors SOL** : laisser *Pump custom* activé et garder la monnaie de cotation sur le wallet.
- **Délai de snipe** (§11.7) : proposé seulement si ses ratés s'effondrent en quelques secondes et que ses bons tokens mettent plus longtemps à faire +100 %.
- **Échantillon** : F Project demande au moins 20 tokens sur 72 h pour valider un rugger ; l'outil affiche sur combien de tokens repose la rentabilité.

### Rentabilité

**5 tokens minimum** : pour juger un dev, il faut au moins 5 tokens analysés, et jusqu’à 10 (les siens et ceux de ses autres devs). En dessous, le verdict est en rouge « Pas assez de données » (X sur 5) : on passe au suivant. Dans la liste des enquêtes, ce badge remplace le verdict.

**Seuil de rentabilité** : un rugger n’est compté rentable que s’il rapporte au moins **1 SOL pour 10 lancements** (0,1 SOL par lancement rejoué, à ta mise, frais compris). Positif mais en dessous : « Pas assez », pas retenu par la chasse.

Sur ses 10 derniers tokens (les siens et ceux de ses autres devs) : achat à la clôture de la 1re bougie d'une seconde, vente à +100 % si le prix le touche, sinon perte jusqu'au plus bas atteint ensuite ; 0,038 SOL de frais par trade. Avec Helius, le prix est recalculé trade par trade depuis la courbe pump.fun (exact). Sans Helius : approximation sur des bougies d'une minute (GeckoTerminal).

Trois façons de vendre, calculées côte à côte (la meilleure est mise en avant) :
- **Tout à +100 %** : 100 % du sac à +100 %.
- **+100 / +200** : 50 % à +100 %, tout le reste à +200 %.
- **+100 / +200 / +400** (gros ruggers) : 50 % à +100 %, 50 % du reste à +200 %, tout le reste à +400 %.

Ce qui n'est pas vendu est perdu jusqu'au plus bas atteint après le dernier palier touché. Si le token migre avant, le reste est compté au prix de migration.

**Achat sur vente du dev** (Buy on Dev Sell, F Project §11.5) : l'outil repère la première vente du créateur sur chaque token et rejoue un achat juste après, avec les mêmes 3 façons de vendre (pas de vente du dev = pas d'achat, pas de frais). Il compare avec l'achat au lancement. Si le dev vend sur au moins 70 % de ses tokens et que ça rapporte plus, le réglage conseillé devient : Achat sur vente du dev ON, avec la plage de % de supply qu'il vend (marge de 20 %), et achat au lancement OFF pour ne pas acheter deux fois.

**Premiers acheteurs à copier** (à chaque traque, une fois la rentabilité calculée) : les 3 premiers acheteurs du coin tracé (souvent les wallets du rugger) sont vérifiés en plus des wallets récurrents ci-dessous. Pour chacun : entre-t-il à la fin de la 1re bougie (dans la seconde de création, ou la suivante) sur au moins 60 % de ses achats récents ? Est-il en profit sur au moins la moitié de ses tokens (son vrai résultat, frais compris) ? Le copier aurait-il rapporté (au moins 5 copies) ? S’il coche les 3, il est proposé, en plus du tracker ou à la place du dev si celui-ci n’est pas trackable.

**Copier un sniper à la place** (dev pas trackable) : sur ses 10 derniers tokens, l'outil lit les 20 premières secondes et note qui achète juste après le dev (5 premiers acheteurs ou dans les 3 s). Un wallet qui revient sur au moins 2 tokens (et 30 % d'entre eux) est soit dans son bundle (marqué « Lié au dev »), soit un sniper qui le suit. Pour les 3 meilleurs, l'outil rejoue la copie de leurs 12 derniers achats, tous tokens confondus, comme le ferait le bot : entrée à la clôture de la bougie d'une seconde de leur achat, puis tes 3 façons de vendre. Un achat sur un token de plus de 2 min est ignoré, comme avec le filtre d'âge max. S'il est rentable sur au moins 5 copies, l'outil donne le réglage copytrade : copier ses achats, une seule fois par token, âge max du token, pas de snipe dev, pas de copie des ventes, pas de protection rugger. Il prévient aussi quand le wallet achète beaucoup de tokens par heure. La recherche se lance toute seule quand le dev n'est pas trackable, sinon avec un bouton.

**Filtre Max MC** : quand ses tokens qui démarrent haut font les grosses pertes (retour au plancher, environ −70 %), l'outil cherche le seuil de market cap d'entrée qui aurait le plus rapporté. Il conseille alors un délai de snipe d'1 s + Max MC (en $ au prix du SOL du moment) : sans délai, le bot ignore le Max MC sur un snipe de création. Petit échantillon : à confirmer.

**Schéma hub (mère à deux étages)** : le rugger reçoit de grosses sommes sur un hub (des centaines de SOL, souvent depuis un mélangeur), puis envoie de petits montants (ex. 7, 9, 3 SOL) à des wallets intermédiaires jetables, qui financent chacun plusieurs devs. Quand la mère trouvée est un intermédiaire jetable (150 transactions au plus), l'outil regarde qui l'a financée. Il relit ses envois des 72 dernières heures (de 0,3 à 200 SOL) et suit chaque destinataire **en éventail** : tous ses envois, pas seulement le plus gros, jusqu'aux devs. S'il trouve d'autres intermédiaires qui mènent à des devs, il conseille de tracker le **hub** : Modèle d'Échange, plages = montants vers les intermédiaires (3 au plus) et montants vers les devs (2 au plus), Héritage activé pour que chaque intermédiaire ajouté par le bot garde ces plages. Le gros transfert entrant (les 1 000 SOL) n'est jamais celui à suivre.

**Chasse aux ruggers** (page du même nom, par filtres) : tu remplis tes critères, tous optionnels : volume 24 h, market cap actuelle, plus haut atteint, market cap à la 1re bougie, % atteint depuis la 1re bougie, rug (au moins X % de chute en moins de Y s), temps entre le lancement et le rug, nombre de wallets et % de supply du bundle, migré ou pas, dev à un seul token. L'outil passe en revue les tokens pump.fun des dernières heures (3 h par défaut). Il applique d'abord les critères de marché, qui ne coûtent rien. Ensuite, il lit les trades des 30 premières minutes de chaque token restant pour les critères de courbe et de bundle. Chaque token qui colle s'affiche tout de suite. Chaque résultat montre aussi la **source du dev**, c'est-à-dire qui lui a envoyé son SOL avant le lancement, avec une pastille : vert pour un exchange dont le montant exact se répète ou une mère probable (wallet qui finance plusieurs wallets), jaune pour un exchange au montant pas encore répété, un relais à remonter ou un wallet inconnu, rouge pour un mélangeur, un service ou un dev déjà très utilisé. L'option « Source traquable seulement » écarte les rouges. C'est un premier tri en moins de 2 secondes par dev : la traque complète reste nécessaire pour le réglage F Project. Tes critères sont gardés d'une visite à l'autre, et tu peux les enregistrer en **presets** nommés (barre « Mes presets » : un clic charge, × supprime ; gardés sur cette machine). Chaque résultat montre le token (CA, lien Axiom, Copier) et un bouton « Tracer » qui retrouve le dev à partir du token. L'ancienne chasse, qui traçait chaque dev, est retirée : trop longue.

**Analyse et classement** : avec la case « Analyser chaque résultat » (cochée par défaut), la chasse trace ensuite chaque dev trouvé, l'un après l'autre (sauf source rouge), et calcule sa rentabilité. Une enquête de moins de 30 minutes sur le même dev est reprise. Les résultats sont alors **classés du meilleur au pire**, avec leur rang (#1, #2…) : à tracker et rentable (au moins 5 tokens et 1 SOL pour 10 lancements), puis à tracker mais pas assez rentable, à tracker mais pas assez de données, à creuser, pas rentable, trop tard, inactif, perdu ; à rang égal, le meilleur gain moyen par token d'abord. Chaque carte affiche la raison du verdict et, quand il le faut, ce qu'il faut faire.

**Chemin de l'argent et chaînes dev → dev** : certains devs cachent l'envoi de leur SOL au wallet suivant dans une transaction qui fait aussi un mini-achat pump.fun, pour casser la piste. La traque garde maintenant les virements directs de ces transactions (vers un compte qui garde le SOL, pas la courbe) et relève les tokens lancés par chaque wallet du chemin. Quand le dernier wallet vient de lancer son token avec l'argent de la chaîne, le verdict est « À tracker » sur ce wallet, en Dernier Transfert, au lieu de « Trop tard ». Les tokens des devs suivants entrent aussi dans le calcul de rentabilité.

**Wallet tracker** (onglet du menu) : tu colles un wallet (du bundle, un sniper…). L'outil rejoue ses 25 derniers achats comme ton bot : un seul achat par projet, entrée à la fin de la bougie d'une seconde de son achat, et 4 sorties entre +100 % et +200 % (tout à +100 %, à +150 %, à +200 %, ou 50 % à +100 % puis le reste à +200 %). Il dit si tu serais rentable, avec ta mise et frais compris, et si le wallet est bon à copier : au moins 8 achats rejouables, au moins 60 % en 1re bougie, gagnant pour lui au moins la moitié du temps, rentable pour toi. Il montre aussi son propre résultat, ses tokens par heure, la part de coins qui ont rug et ses achats rejoués (avec lien Axiom). En haut, **sa stratégie** en clair, lue sur ses vrais trades (jusqu'à 3 000 transactions, soit souvent 1 à 2 h pour un bot) : le genre de wallet (bot de scalping, trader rapide, swing, holder, haute fréquence), son entrée (part dans la seconde du lancement, market cap d'entrée), sa mise (par achat, achats par token), sa sortie (temps de détention et % des gagnants et des perdants, vente en plusieurs fois), et son résultat sur la période lue (SOL par heure, gains ÷ pertes).

Un coin compte comme « rug » s'il perd au moins 45 % en moins d'une minute (ou 35 % en une seule vente), sans avoir migré. Les premiers acheteurs vérifiés sur une enquête sont les 3 premiers plus le bundle (achats dans la seconde de création).

**Bon à copier** (règles du cerveau F Project pour le copytrade, plus ta règle de rentabilité) : on juge son **entrée**, pas son taux de gain. Il faut au moins 60 % d'entrées tôt (1re bougie), 10 tokens par heure au plus (F Project préfère 1 par heure), ne pas créer de tokens (sinon c'est un dev, à tracker en méthode 1), 8 achats rejouables, et au moins 1 SOL pour 10 achats copiés. **Un seul wallet par groupe** : deux wallets qui ont acheté en grande partie les mêmes coins sont le même groupe ; on ne garde que le plus rentable, sinon le bot achète plusieurs fois le même lancement. La liste du Wallet tracker a deux boutons déroulants, « Bons à copier » (ouvert, du plus rentable au moins rentable) et « Pas bons » (avec la raison sur chaque ligne). Un clic sur un wallet ouvre sa fiche complète.

**Chasse aux wallets (règles du 17/11/2026)** : on cherche les wallets du rug, pas le dev. Un rug, c'est −70 % en 10 secondes ou en moins d'une minute, mesuré sur la courbe. Sur chaque rug, on prend tout le bundle (même bloc que la création) et les 4 premiers acheteurs après le dev. On garde les wallets à 3 à 30 trades par jour, puis on rejoue leurs achats des 3 jours avant le rug et de l'heure d'après (30 au plus). Un achat ne compte que s'il entre sous 10 000 $ de market cap, et on regarde s'il touche +100 % (vente de tout à +100 %). Bon à copier : au moins 5 achats tôt, au moins 1 SOL pour 10 achats copiés, pas négatif sur 30 jours, pas un dev, un seul wallet par groupe. Le réglage conseillé ajoute Max MC 10 000 $ (sur un copytrade, le filtre se base sur l'entrée du wallet copié).

**Bilan réel** (onglet du menu) : lit tes vrais achats et ventes sur la chaîne depuis ton wallet F Project (7 jours par défaut). Il compte le vrai résultat, frais compris (bribe, tip, frais du bot) : F Project affiche ses % sans ces frais. Les tokens cotés hors SOL (Pump custom) sont convertis au taux payé à l'achat. Chaque trade est rattaché à son rugger (l'enquête qui contient ce dev) et comparé à ce que l'outil avait prévu pour ce token. Il te dit quel rugger garder ou couper (au moins 3 trades et un résultat négatif), et te prévient si tes achats arrivent 3 s ou plus après la création, donc plus cher que dans les calculs.

**Équipes** : dans Enquêtes, les ruggers qui partagent la même mère, ou le même exchange au même montant exact, sont regroupés. Un seul tracker sur la source les couvre tous.

## Lire le résultat

Tu colles une adresse (wallet ou token), l'outil fait tout seul :

1. **Avant** : il remonte les wallets qui ont financé l'adresse (les relais ne comptent pas dans la profondeur), puis tous les wallets liés, et relève leurs tokens.
2. **Recensement des sources** : pour chaque dev trouvé, il remonte les relais jusqu'à la vraie source (exchange ou wallet mère) et compte combien de devs chaque source a financés, avec quels montants.
3. **Ses autres devs et ses prochains devs** : il relit les envois de cette source (7 jours pour un wallet mère, 72 h pour un exchange, 24 h sans Helius), garde ceux qui tombent dans les plages et suit chacun (relais et mouvements cachés compris). Ceux qui ont lancé un token sont ses autres devs ; ceux qui ont reçu le bon montant, n'ont encore rien lancé et ont gardé le SOL sont ses **prochains devs probables**. Si un seul dev est connu, il fouille quand même les envois de sa source à son montant.
4. **Après** : il suit l'argent qui sort de l'adresse, dans l'ordre du temps, jusqu'à là où il est maintenant (relais, allers-retours de mélange, mouvements cachés par un programme, services de paiement).
5. **Conseil** : la seule adresse qui servira encore dans F Project, avec le mode, les plages et les options.
6. **Rentabilité** : tes trades rejoués trade par trade sur ses 10 derniers tokens (les siens et ceux de ses autres devs).

### Le conseil F Project, dans l'ordre de priorité

1. **Exchange + même montant exact chez au moins 2 devs** : tracker = l'adresse de l'exchange, mode *Modèle d'Échange*, une plage à ±0,0001 SOL par montant répété.
2. **Wallet mère** qui a financé au moins 2 devs (directement ou via des relais) : tracker = la mère, mode *Modèle d'Échange*, une plage par montant utilisé (3 % du montant, ±0,01 SOL au plus ; 5 plages au plus, les plus utilisées d'abord). Si la mère change d'adresse (l'ancienne lui a tout envoyé) : mode *Hybride*. Si la mère a elle-même été retirée d'un exchange avec un montant exact qui se répète, et qu'elle a financé au moins 3 devs : la mère reste le tracker principal et l'exchange est donné en **2e tracker** (Modèle d'Échange, sa plage, héritage désactivé) pour attraper la prochaine mère. Si la mère lance aussi des tokens elle-même, on te le dit (copytrade en plus). Les envois de la mère sont lus même quand ils sont dans une transaction pump.fun (virements directs uniquement, pas les achats).
3. **Chaîne dev → dev** encore en cours : tracker = le dernier dev, mode *Dernier Transfert*.
4. **Argent posé quelque part en ce moment** : tracker = ce wallet, *Dernier Transfert*, tout de suite.
5. **Mémoire de tes enquêtes** : si son exchange n'a pas encore répété le montant dans ses envois récents, mais qu'une autre de tes enquêtes a déjà vu ce même exchange envoyer ce même montant exact à un dev, le schéma est confirmé : tracker = l'exchange, plage à ±0,0001.
6. Sinon, pas d'adresse morte : *Pas encore* (exchange, montant pas encore répété : on te donne l'exchange et le montant à surveiller), *Trop tard pour ce cycle*, *Pas trackable par l'argent* (mélangeur, service de paiement qui change de wallet) ou *Ne le track pas* (adresse qui relance elle-même : copytrade plutôt). Une adresse qui n'a jamais signé de transaction réussie (elle reçoit juste des miettes de tokens, ou son compte est fermé) sort en *Pas un dev* : vérifie que tu as collé le créateur, ou colle directement le CA. Et avant tout : si ni lui ni ses autres devs (même mère, même exchange) n'ont lancé de token depuis **24 h**, la réponse est *Non, inactif* : pas de réglage bot ni de backtest, et l'enquête affiche *Inactif depuis X j* dans la liste. Le calcul se refait à chaque ouverture, donc une vieille enquête devient inactive toute seule.

Options affichées avec leur raison et les noms exacts du bot : *Conserver l'adresse*, *Auto-éviction*, *Portefeuille vierge uniquement*, *Supprimer sans lancement* (avec le nombre d'heures), *Supprimer après la 1re action*, *Hériter paramètres*. *Délai de funding* et *Schéma araignée* ne sont pas encore gérés : laisse-les désactivés. Si certains de ses tokens sont cotés hors SOL (USDC…), l'outil rappelle de laisser *Pump custom* activé et d'avoir cette monnaie sur ton wallet.

### La page, de haut en bas

- **Faut-il le tracker ?** : Trackable et Rentable, en une ligne.
- **Ce que tu fais sur F Project** : adresse, mode, plages (chacune copiable), options.
- **Ses prochains devs probables** (si la source en a) : wallets financés dans ses plages, rien lancé, SOL encore dessus.
- **Aurais-tu été rentable ?** : achat à la fin de la 1re bougie d'une seconde, vente à +100 % si le prix le touche, sinon perte jusqu'au plus bas. Frais de 0,038 SOL par trade. Le prix vient des tokens restant dans la courbe pump.fun, donc il est exact aussi pour les tokens cotés hors SOL. L'échantillon prend ses 10 derniers tokens, ceux de ses autres devs compris ; les tokens mort-nés (presque aucun trade) sont signalés. Si ses ratés s'effondrent en quelques secondes alors que ses bons tokens mettent plus longtemps, l'outil propose un délai de snipe avec Min MC (F Project §11.7).
- Le bouton **Copier tout le réglage** met l'adresse, le mode, les plages, les options et le délai en texte dans le presse-papier.
- **Son schéma**, **Ses tokens** (Avant / Cette adresse / Après / Ses autres devs, avec le CA qui s'ouvre sur Axiom), **Le chemin de son argent**, puis le détail technique replié.

### Lire le filtre par montant exact

Si le dev reçoit 1,15 SOL, on garde les envois de la source entre 1,1499 et 1,1501 SOL. Pour chacun, on regarde si l'argent arrive à un wallet qui a créé un token pump.fun.

- **Filtre fiable** (60 % ou plus mènent à un créateur) : les wallets « en attente, rien lancé » sont de vrais candidats au prochain rug.
- **Filtre faible** (moins de 30 %) : le montant est trop courant chez cette source, la piste ne vaut rien.
- Moins de 3 envois suivis : pas de quoi juger.
- Sur le RPC public, la lecture est plafonnée (300 transactions en mode rapide) : l'outil affiche combien d'heures il a réellement lues sur les 24.

### Retraits après un dépôt

Le retrait doit valoir le dépôt du dev, aux frais de retrait près (jusqu'à 0,03 SOL ou 1 %). La somme de plusieurs dépôts rapprochés (moins de 6 h) est aussi testée. Un retrait découpé en morceaux inégaux n'est pas retrouvé, et un dépôt de plus d'une semaine environ est hors de portée du RPC standard.

## Chasse aux ruggers

La page « Chasse aux ruggers » remplace l'ancienne recherche (formulaire New Pairs / Final Stretch et liste de tokens notés). Voir **Chasse aux ruggers** plus haut. Le code de l'ancienne recherche (src/scanner.js, /api/scan) reste en place côté serveur : la chasse s'en sert pour calculer l'avancement vers la migration.

## Lancer

```bash
node server.js
```

Puis ouvre http://localhost:4477. Aucune dépendance à installer (Node 22.5 ou plus récent).

## Aller plus vite

Sans clé, l'outil utilise le RPC public de Solana, limité à environ 1 transaction lue par seconde.
Copie `.env.example` en `.env` et mets-y une clé Helius gratuite (`HELIUS_API_KEY=`). Avec Helius :

- les transactions se lisent par paquets de 100 (une traque prend de quelques secondes à 2 minutes au lieu de 20 à 30) ;
- les envois d'un exchange se lisent sur 24 h et autour du retrait du dev, ceux d'un wallet mère sur 7 jours ;
- la rentabilité se calcule trade par trade (bougies d'une seconde, exactes) au lieu de bougies d'une minute ;
- un token très actif retrouve son dev en une fraction de seconde (lecture de son historique depuis le début).

## En ligne de commande

```bash
node cli.js <adresse ou token> normal
```

Affiche les tokens (CA, côté avant/après, statut), le schéma, la source de ses devs et le réglage F Project complet.

Tests : `npm test`.

## Fichiers utiles

- `src/tracer.js` : la traque (remontée, cluster, recensement, empreinte exchange) et ses réglages (`PRESETS`).
- `src/census.js` : sources de ses devs, plages, recherche de ses autres devs et de ses prochains devs.
- `src/downstream.js` : suivi de l'argent vers l'aval (relais, mélangeurs, mouvements cachés, services).
- `src/advice.js` : le conseil F Project (adresse, mode, plages, options) et la route de chaque token.
- `src/qualify.js` : la rentabilité, trade par trade.
- `src/labels.json` : adresses connues (exchanges, Jito). Les tiennes : page Adresses connues, ou `data/labels.local.json`.
- `data/` : cache des transactions (`cache.db`) et enquêtes enregistrées.

## Limites

- Les liens sont des indices, pas des preuves. Un wallet « relais » (4 transactions au plus) peut être pris pour un relais alors qu'il appartient à quelqu'un d'autre.
- Un retrait depuis un exchange coupe la remontée : le hot wallet est partagé par tous les clients. C'est le montant exact (±0,0001 SOL) qui fait le lien, à condition qu'il se répète chez au moins 2 devs.
- Les mélangeurs et les services de paiement qui changent de wallet cassent le suivi de l'argent : l'outil le dit (« Pas trackable par l'argent ») au lieu de donner une adresse morte.
- Un wallet très actif sans nom est traité comme un exchange au-delà de 300 SOL de solde. Un wallet mère très riche pourrait être classé exchange à tort.
- Les envois d'un gros exchange se comptent en dizaines de milliers par jour : même avec Helius, l'outil lit jusqu'à 20 000 transactions récentes plus ±6 h autour du retrait du dev, pas tout l'historique.
- Un token est compté « rug probable » quand le cluster a vendu au moins 80 % de ses tokens et que la market cap est sous 15 000 $ (ou inconnue).
- La rentabilité suppose que tu entres exactement à la clôture de la 1re bougie d'une seconde : un achat plus tard dans la seconde change le résultat.
- La liste d'adresses d'exchanges (`src/labels.json`) est à compléter : ajoute les tiennes depuis la page **Adresses connues** (enregistrées dans `data/labels.local.json`).


## Alignement avec le cerveau F Project (22/11/2026)

- Rentabilité calculée sur ses derniers tokens, jusqu'à 30 (règle `fin-1re-bougie-plus-bas-v7`). Sous 20 tokens ou sous 72 h, la page signale un échantillon mince : F Project valide un rugger sur au moins 20 tokens couvrant 72 h. Ta règle (5 tokens minimum, 1 SOL pour 10 lancements) reste celle qui décide.
- Entrée gardée à la fin de la 1re bougie d'une seconde (ta règle), et non à 75 % de la 1re bougie comme le fait F Project.
- Un exchange sans nom (wallet très actif et très riche sans étiquette) n'est plus proposé comme tracker : verdict « à creuser », à confirmer sur Solscan. La source du dev passe en jaune.
- Le réglage conseillé ajoute le Compteur de pertes max : 3 pour un rugger pas encore prouvé, 10 une fois prouvé (20 tokens ou plus, et rentable).
- Avertissement quand Conserver l'adresse et Hériter paramètres sont activés ensemble : les 30 places peuvent se remplir vite.
- La Chasse aux ruggers affiche la mise minimum pour couvrir les frais (0,038 SOL ÷ gain moyen par trade).

## Schéma araignée (22/11/2026)

Un wallet mère envoie une somme (par exemple 1 SOL) dans une toile de wallets jetables qui se renvoient des parts, souvent croisées. À la fin, une dizaine de wallets neufs envoient chacun la même petite part au dev (par exemple 10 × 0,1 SOL). C'est souvent la méthode des utilisateurs de Proxima. La traque le repère sur le dev (au moins 3 wallets différents qui lui envoient un montant proche en moins de 15 minutes, avant son lancement). Elle remonte ensuite la toile en suivant chaque fois le plus gros financeur, jusqu'au premier wallet qui n'est pas jetable (plus de 15 transactions) : la mère. Le conseil est alors de tracker la mère en Modèle d'Échange, avec une plage autour du montant qu'elle a envoyé, et l'option **Schéma araignée** activée. Si le haut de la toile est lui aussi jetable, le verdict est « à creuser ». La Chasse aux ruggers affiche aussi ce schéma comme source du dev. Vu en vrai sur « tremp » : la mère 97yr…5FBy (400 transactions) a envoyé 1,0428 SOL, l'argent a traversé 10 wallets jetables, puis 10 wallets neufs ont envoyé chacun 0,1042 SOL au dev.

## Schéma exchange, priorité n° 1 (22/11/2026)

Les devs retirés d'un exchange (Binance, Coinbase, Bybit…) sont les ruggers les plus fiables à tracker : la recherche est poussée au maximum sur eux.

- **72 h d'envois lus** dans tous les modes (Helius : tranches de 6 h lues en parallèle, pas gardées dans le cache), même pour un exchange sans nom.
- **Tous les retraits du dev** avant son lancement sont cherchés, pas seulement le plus gros.
- **Les autres hot wallets du même exchange** (liste `src/labels.json`, vérifiée sur Solscan) sont lus 24 h autour de son retrait. Si ses devs sortent de deux wallets, le conseil demande un 2e tracker avec la même plage.
- En chasse, à niveau égal, ces devs passent devant (badge « Exchange »).

### Surveillance exchange (page « Surveillance exchange »)

Chaque traque d'un dev retiré d'un exchange l'ajoute tout seul (et au démarrage, ceux des 3 derniers jours). Toutes les 3 min, le serveur relit les nouveaux envois de ces hot wallets et cherche les montants exacts (±0,0001 SOL) :

- un wallet qui reçoit le montant = **nouveau dev probable** (pas encore lancé : tu peux le mettre dans le bot pour snipe son lancement) ;
- on le suit (jusqu'à 3 wallets si l'argent repart) ; s'il lance un token, le **schéma est confirmé** et la page donne le réglage : Modèle d'Échange, adresse du hot wallet, plage ;
- un wallet déjà bien utilisé avant de recevoir le montant est un simple client, il est écarté ; sans lancement en 48 h, la piste est abandonnée.

État dans `data/exchange-watch.json`. Il faut une clé Helius.

## Snipe exchange (page dédiée, 22/11/2026)

Colle le wallet du dev ou le CA : RugTrace fait la traque (72 h) puis le dossier complet (`src/exsnipe.js`, enregistré dans `data/exdossiers/`).

1. **Financement** : tous les retraits d'exchange du dev avant son lancement (ou celui en amont s'il est passé par des relais), et le délai retrait → lancement.
2. **Même montant ailleurs** (±0,0001 SOL) : la traque sur 72 h et tous les hot wallets, tes enquêtes passées, et les devs retrouvés par son bundle.
3. **Son bundle, wallet par wallet** : à lui, à confirmer ou sniper. Indices forts (2 points) : financé par le dev ou sa source, retiré du même exchange dans les 24 h avant le lancement, revend à moins d'une minute du dev, renvoie son SOL au dev ou aux mêmes adresses, rassemble son SOL avec d'autres wallets du bundle. Indices moyens : wallet neuf (≤ 15 transactions avant), financé par le même wallet que d'autres du bundle. Sniper : plus de 200 transactions avant, ou plus de 15 tokens différents achetés. « À lui » à partir de 3 points.
4. **Ses autres tokens** : ceux que ses wallets de bundle ont achetés à leur naissance (≤ 3 s), avec le financement de leur dev.
5. **Verdict** : *Confirmé* (même montant chez ≥ 2 devs → Modèle d'Échange, plages exactes, options) ; *Auto-snipe* (montant qui change mais le même wallet de bundle achète ses tokens à leur naissance → copytrade de ce wallet, Achat unique ON) ; *Montant variable* ; *À surveiller*.

La surveillance prend aussi les montants de son bundle et ses wallets de bundle réutilisés : un achat d'un de ces wallets à la naissance d'un token = son nouveau lancement.
