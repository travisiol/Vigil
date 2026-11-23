# DESIGN — Vigil (vigil.trade · $VIGIL)

> Barre : **9/10 sur les 12 critères** du [DESIGN_PLAYBOOK](../../DESIGN_PLAYBOOK.md), règle anti-générique (§0) et "pro + caractère". Tout le texte public en anglais `[F-020]`.
> Logo validé `[F-035]` — **version finale sur fond noir pur** `[F-038]` : le V seul, en dégradé violet → rose.

## L'idée visuelle forte
**Le V qui brille dans la nuit.** Vigil veille quand le marché dort. Le dégradé violet → rose du logo devient **la lumière de veille** du site : lueurs derrière le terminal, ligne de scan, mots clés, bouton principal. Tout le reste est nuit et neutre → la lumière ne sert qu'à montrer ce qui compte.

## Direction artistique
- Ressenti visé : **vigilant, rapide, premium, un peu dangereux**
- Palette : **15 — Vigil Glow** ([PALETTES.md](../../PALETTES.md)) : **noir pur `#000000`** (comme le logo), cartes `#0B0A0F`, texte `#F5F3FA`, **dégradé `#9232F1 → #BC33C9 → #F22C7B`** = la marque ; risque : teal `#07E7C3` (Clean) · ambre `#FFB21F` (Watch) · rouge `#FF4545` (Bundled) — jamais le rose de la marque pour le danger
- Typo : **General Sans** ou Satoshi (titres, semibold, serré) · **Inter** (texte) · **JetBrains Mono** (prix, adresses, tableaux)
- Style : sombre premium, arrondis 10 px, bordures fines, **lueurs en dégradé** très maîtrisées (pas de blobs)
- Ton : direct, calme, confiant ("Always on watch.", "Bundled. Skip it.")

## Pages & sections (inchangé sur le fond)

### Landing (vigil.trade) — 5 000–6 500 px
1. **Header** : logo · Terminal · Scan · Rewards · Docs · chip CA `$VIGIL 7xKX…9fQa Copy` · X · bouton "Start trading" (dégradé)
2. **Hero** (premier écran desktop ET mobile) : "Always on watch." · 1 phrase · CTA · CA · **le terminal vivant à droite**, une **ligne de scan en dégradé** qui passe, badges Clean / Watch / Bundled
3. **Bande de chiffres live** : tokens scannés · bundles détectés · volume · $VIGIL racheté
4. **How Vigil watches** : storytelling au scroll en 3 étapes (le token arrive → Vigil le scanne → le badge tombe), avec un vrai exemple
5. **Built for speed** : 1-click buy, Quick Buy, exécution prioritaire, pas de popup
6. **Rewards** : cashback, rangs, parrainage, **cartes PnL** au V lumineux
7. **$VIGIL** : 3 cartes d'utilité + **tableau de bord live des rachats** + CA
8. **Transparency** : frais 0,5 % (moitié du marché, 75 % reversés), non-custodial, "facts, not financial advice"
9. **FAQ**, **CTA final**, footer
+ **Barre fixe mobile** : `$VIGIL · 7xKX…9fQa [Copy] [Trade]`

### App (vigil.trade/app)
Discover (colonne Scan + "Hide bundled") · Token (panneau Scan détaillé) · Portfolio (cartes PnL) · Rewards · Buybacks

## Composants clés
| Composant | Rôle | Recherche 21st.dev | Restylage |
|---|---|---|---|
| Ligne de scan | Visuel signature | `scan line`, `spotlight`, `beam` | Dégradé de marque, 3–4 s, reduced-motion respecté |
| Lueur du hero | Ambiance | `glow background`, `aurora` (très sobre) | Dégradé de marque à faible opacité derrière le terminal |
| Badge Scan | Clean / Watch / Bundled | `status badge` | Teal / ambre / rouge à 14 % de fond |
| Tableau Discover | Liste des tokens | `data table`, `token list` | JetBrains Mono, tabular-nums |
| Hero terminal live | Démo produit | `hero product demo`, `app preview` | Vraies données en lecture seule |
| Compteurs live | Chiffres | `number ticker` | General Sans, chiffres en dégradé pour les rachats |
| Storytelling scroll | How Vigil watches | `sticky scroll`, `scroll steps` | 3 étapes |
| Carte PnL | Partage | `share card` | @vercel/og, V lumineux en filigrane |
| Barre mobile | Conversion | `sticky bottom bar` | CA + Copy + Trade |
| FAQ | Questions | `accordion faq` | |

## Motion
- Signature : **la ligne de scan en dégradé** qui balaie la liste et fait tomber les badges
- Le V du logo peut "s'allumer" (dégradé qui se remplit) au chargement — 600 ms max, titre visible immédiatement
- Chiffres qui comptent, prix qui flashent, storytelling au scroll (GSAP + ScrollTrigger + Lenis)
- `prefers-reduced-motion` : plus de balayage, simple surlignage

## États
- **Vide** : "All quiet. Vigil is watching."
- **Loading** : skeletons + lueur qui pulse doucement
- **Erreur** : "Vigil lost the signal. Retry."

## Check avant de montrer
- [ ] Ne ressemble pas à un template, ni à Foam
- [ ] Respecte GOUT.md, FEEDBACK.md et le playbook (auto-noté 9/10 sur les 12 critères)
- [ ] "Si on retire le logo, on reconnaît encore Vigil ?" (la lumière en dégradé sur la nuit)
- [ ] Tout le texte public en anglais

## Build — landing v1 (23 nov.)
- Fichier : [site/index.html](site/index.html) · page privée : https://claude.ai/artifact/9egcL2u2EE6mTyQPVtvXrw
- Composants 21st.dev récupérés (2/2 du jour) et adaptés en JS vanilla : **Beams Background** (faisceaux de lumière en canvas, recolorés au dégradé Vigil) et **Streaming Data Rows** (tableau live : lignes qui arrivent, valeurs qui glissent, pastilles de statut à glyphe).
- Visuel signature : la **ligne de scan en dégradé** balaie le terminal et fait passer chaque token de "Scanning" à Clean / Watch / Bundled.
- Polices : **Sora** pour les titres (General Sans n'est pas sur Google Fonts, seule source autorisée sur les pages hébergées), Inter, JetBrains Mono.
- Captures de contrôle : design/site-v2-desktop-hero.png, design/site-v2-mobile-top.png.
- Reste à faire : vraies données, page app, OG image, vrai CA.

## Build — landing v2 « démo 21st.dev » (23 nov.)
- Fichier : [site/index.html](site/index.html) (v1 gardée dans [site/v1.html](site/v1.html)) · même page privée : https://claude.ai/artifact/9egcL2u2EE6mTyQPVtvXrw (version `1795433119-e5c7`).
- Plan 21st.dev payant : composants récupérés et réécrits en vanilla, restylés Vigil Glow : **Beams Background**, **Streaming Data Rows**, **Border Beam** (lumière qui tourne autour du terminal), **Animated Beam** (schéma : 6 sources → le V → verdict), **Spotlight** (halo qui suit la souris sur les cartes), **Holographic Foil Card** (carte PnL qui s'incline, reflet violet/rose).
- Moteur : GSAP + ScrollTrigger (titre qui sort du flou mot par mot, apparitions au scroll, section « Every venue flows into one verdict » épinglée : les 3 étapes avancent avec le scroll), Lenis (scroll fluide), barre de progression en dégradé en haut.
- Sections : hero + terminal live · bandeau des venues · chiffres animés · schéma épinglé · bento (scan panel, buy 1 clic, alertes live, prix live, non-custodial) · carte PnL holo · flywheel $VIGIL (Trade → Fee → Buy → Burn, point qui tourne) · FAQ · CTA final.
- Garde-fous : toutes les données marquées « Sample », `prefers-reduced-motion` respecté, contenu lisible sans JS, mobile avec barre CA collante.
- Corrigé après contrôle : courbe de la carte PnL qui coupait le texte, reflet holo trop bleu/vert (hors palette), arc du flywheel devant le point au lieu de derrière, titre du schéma mal coupé.
- Captures : design/site-v2b-desktop-hero.png, design/site-v2b-desktop-full.png, design/site-v2b-mobile-full.png.

## Build — app v0.1 (23 nov.) — le vrai produit `[F-040]`
- Code : [web/](web/) (Next.js 16, TypeScript). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md). Fees : [FEES.md](FEES.md).
- Pages : `/` landing v2 · `/app` Discover (tokens live DexScreener, colonne Scan, "Hide bundled", Quick Buy, ligne de scan à chaque rafraîchissement, bordure lumineuse) · `/token/[mint]` (graphique, chiffres, panneau Scan détaillé avec jauges animées, boîte Buy/Sell) · `/portfolio` · `/fees` (circuit des fees + wallet public) · `/docs`.
- Même DA que la landing : noir, dégradé du logo pour la marque, teal / ambre / rouge réservés au risque, Sora / Inter / JetBrains Mono.
- Testé : données live (41 tokens), scan réel (lancement, dev, autorités, liquidité), transaction d'achat et de vente construite et inspectée (fee 0,8 % au bon endroit), garde-fous (trading bloqué sans wallet de fees, relais refusé pour une transaction qui ne paie pas Vigil).
- Pas encore testé : un vrai trade signé dans un wallet (à faire par toi avec un petit montant), les holders (il faut une clé RPC).
