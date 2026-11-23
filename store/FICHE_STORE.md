# Vigil — publication sur le Chrome Web Store

Tout ce qu'il faut pour publier l'extension. Les textes à coller sont en anglais (public `[F-020]`). Les étapes sont en français.

## 0. Avant tout : le push (obligatoire)
L'extension parle au serveur en ligne `https://vigil-eight-ecru.vercel.app`. Aujourd'hui, ce serveur n'a pas encore l'API de l'extension : `/api/lens` répond 404, parce que les commits locaux ne sont pas poussés.

Si tu soumets avant de pousser, l'examinateur de Google ne verra aucun verdict et refusera l'extension.

1. Pousse `main` sur GitHub. Vercel déploie tout seul.
2. Vérifie que ces deux adresses répondent bien.

   Cette adresse doit afficher du JSON :
   ```
   https://vigil-eight-ecru.vercel.app/api/lens?a=27UnAC6ZgR69xXj9kLHyagCyVGyPz3W2ZMvWJfj6pump&peek=1
   ```
   Cette page doit s'afficher :
   ```
   https://vigil-eight-ecru.vercel.app/privacy
   ```
3. Dans ton Chrome, vide le champ « Vigil server » (fenêtre de l'extension → Advanced). L'extension revient alors sur le serveur en ligne : teste-la une fois comme ça.

## 1. Le compte développeur (à faire par toi)
- Va sur https://chrome.google.com/webstore/devconsole et connecte-toi avec ton compte Google.
- Paye les frais d'inscription, 5 $ une seule fois, et confirme ton adresse e-mail.

## 2. Envoyer l'extension
- Clique **New item**, puis envoie le fichier `store/vigil-lens-0.6.0-store.zip`. Le `manifest.json` est à la racine du zip, comme le store l'exige.
- Pour chaque nouvelle version, augmente `version` dans `lens/manifest.json` et refais le zip. Ne réutilise jamais un numéro déjà envoyé.

## 3. Onglet « Store listing »

**Description** (à coller) :
```
Vigil puts a small V next to every Solana token on the sites you already use. Click it, and Vigil reads that token's launch in a few seconds, then seals it:

● Clean: the launch looks spread out. No wallet in control, no dev with a rug history.
◎ Watch: nothing proves a rug, but something is off. Look twice before you buy.
⁘ Bundled: wallets that bought together, or a dev who has done this many times. Stay out.

WHAT VIGIL READS
• The first ten seconds of buys: how much of the supply the launch wallets took.
• The dev's past launches.
• Who funded the first wallets: ten wallets funded by one source are one player.
• The biggest wallet and the top 10 holders.
• The exit radar: are the launch wallets already selling?

WHERE IT WORKS
Axiom, GMGN, pump.fun, DexScreener, Padre and X. Photon and BullX in beta.

HOW IT WORKS
• Nothing runs until you click. Click the V next to a token: its seal lands in a few seconds and the token panel opens with the numbers and the exit radar.
• Hover a seal for the reason in one line. Ctrl+click opens the full scan.
• Seals Vigil already knows show up on their own.
• Want every token on screen read? Turn on automatic scan in the extension's window.
• The icon shows how many Bundled tokens are on screen.
• Turn Vigil on or off for each site. Hide Clean seals to keep only what needs attention.

READ-ONLY
Vigil never asks for a wallet, a private key or a signature, and it never trades. It only sends token addresses to Vigil's server. Facts from the chain, not financial advice.
```

**Les autres champs :**

| Champ | Valeur |
|---|---|
| Category | Tools |
| Language | English |
| Store icon (128×128) | `lens/icons/icon128.png` |
| Screenshots (1280×800) | `store/screenshots/1-seals-on-padre.png`, `2-token-panel.png`, `3-extension-window.png` : vraies captures de la vraie extension sur le vrai Padre |
| Small promo tile (440×280) | À générer avec le prompt **S2** de `PROMPTS_CHATGPT.md`, puis à ranger dans `design/` |
| Marquee (1400×560, facultatif) | Prompt **S3** de `PROMPTS_CHATGPT.md` |
| Official URL / Homepage | `https://vigil-eight-ecru.vercel.app` |
| Support URL | Ton compte X du projet, ou laisser vide |

## 4. Onglet « Privacy »

**Single purpose** :
```
Show a rug-risk seal (Clean, Watch or Bundled) for the Solana tokens displayed on trading sites, read from public on-chain data.
```

**Justification de chaque permission** :

| Permission | Texte à coller |
|---|---|
| `storage` | `Saves the user's settings (Vigil on or off for each site, automatic scan, show Clean seals), the tokens the user chose to scan, and where the user placed the token panel.` |
| Host permission `vigil-eight-ecru.vercel.app` | `Vigil's own server. It reads public Solana data about a token and returns its seal and numbers.` |
| Content scripts (Axiom, GMGN, pump.fun, DexScreener, X, Padre, Photon, BullX) | `Needed to find the Solana token addresses displayed on these sites and place the seal right after each token's name. The script only reads token addresses and links. It does not read forms, cookies, wallets or account data.` |

**Les autres réponses :**
- **Remote code** : **No, I am not using remote code**. Tout le JavaScript est dans le paquet.
- **Data usage** : coche **Website content**, car Vigil lit les adresses de tokens affichées sur la page. Ne coche aucune autre catégorie.
- Coche les trois engagements : données jamais vendues, jamais utilisées pour autre chose que le service, jamais utilisées pour évaluer un crédit.
- **Privacy policy URL** : `https://vigil-eight-ecru.vercel.app/privacy`

## 5. Onglet « Distribution »
- **Visibility** : **Public**. Ou **Unlisted** si tu veux d'abord la tester avec quelques personnes : seules les personnes qui ont le lien la voient. L'examen est le même.
- **Regions** : toutes.

Clique ensuite **Submit for review**. L'examen prend en général de quelques heures à quelques jours. Google écrit par e-mail s'il manque quelque chose.

## 6. Après la publication
- Donne-moi l'adresse de la fiche. Je branche le bouton « Add to Chrome » de la landing dessus, à la place du zip et des 4 étapes du mode développeur.
- Chaque mise à jour repasse un examen, en général plus court.
