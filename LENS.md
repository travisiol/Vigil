# Vigil Lens — plan (23 nov.) `[F-079]` `[F-080]`

## Le produit
Une extension Chrome (Manifest V3) qui ajoute un **badge de verdict** à côté de chaque token Solana sur les sites des traders, sans rien changer à leurs habitudes.

| Site | Où apparaît le badge |
|---|---|
| pump.fun | listes, page d'un coin |
| DexScreener | listes, page d'une paire (adresse de paire convertie en token côté serveur) |
| GMGN | listes, page token |
| Axiom | listes, page token |
| X | tweets qui contiennent un CA |

- **Badge** : Clean / Watch / Bundled (ou "Scanning…"), aux couleurs de Vigil.
- **Au survol** :
  - la raison en une phrase ;
  - le radar de sortie (ce que les initiés détiennent encore, si le dev a vendu) ;
  - la mémoire du dev (lanceur en série, ferme) ;
  - un bouton "Open in Vigil" (page token complète + achat avec fee 0,5 %).
- **Calcul à la demande** : uniquement les tokens affichés à l'écran, en lot. Aucun flux continu. C'est ce qui marche sur Vercel `[F-078]`.

## Architecture
- `projets/Vigil/lens/` : l'extension (manifest, content script, service worker, styles en Shadow DOM, popup).
- `web/app/api/lens` : API ouverte à l'extension (CORS).
  - Entrée : jusqu'à 30 adresses (mint ou paire).
  - Sortie : verdict, raison, profondeur, radar résumé, nom et logo.
  - Si le token n'est pas connu, un scan rapide est lancé et la réponse dit "pending" : l'extension redemande au bout de 4 s.
- Le site : présente Lens (installation, fonctionnement, sites couverts), la tech, les fees, les preuves (Verify, Track record). La page complète d'un token reste sur le site.

## Étapes
1. API `/api/lens` + CORS.
2. Extension : détection des adresses, badges, carte au survol, cache local.
3. Tests sur pump.fun, DexScreener, X, GMGN, Axiom.
4. Site : refonte de la landing autour de Lens.
5. Publication : Chrome Web Store (compte développeur à 5 $, à ton nom) ; installation manuelle depuis le site en attendant.
