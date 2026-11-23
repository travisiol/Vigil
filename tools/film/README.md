# Film Vigil sur un vrai site `[F-088]`

On ne recrée jamais Axiom (ni aucun site tiers) : on **filme le vrai site** avec l'extension active, puis on ajoute le motion design par-dessus (cartons, caméra, curseur, sous-titres, floutage du compte).

Prérequis : l'app Vigil tourne en local (`npm run start` dans `web/`, port 3100) pour que les verdicts soient réels.

## 1. Se connecter à Axiom (une seule fois, c'est toi qui le fais)

```powershell
node capture.mjs login axiom
```

Une fenêtre Chrome à part s'ouvre (profil dédié `chrome-profile/`, séparé de ton Chrome habituel). Connecte-toi à Axiom normalement, puis **ferme la fenêtre**. La connexion reste dans ce profil.

## 2. Filmer la vraie session

```powershell
node capture.mjs record axiom
```

Le script rouvre ce profil sans fenêtre, active Vigil sur Axiom Pulse, attend les verdicts, survole un badge Bundled (l'infobulle s'affiche), clique sur le token et filme le panneau Vigil sur la page du token. Il ne fait **aucune transaction** et ne touche à aucun réglage. Les images vont dans `captures/axiom-<date>/` avec un `manifest.json`.

## 3. Monter et exporter le film

Servir ce dossier : `python -m http.server 8097 --bind 127.0.0.1`, puis :

```powershell
node render.mjs "http://127.0.0.1:8097/compose.html?dir=captures/<dossier>&site=Axiom&record" "..\..\design\video\vigil-real-axiom-1080p.mp4" 30 1920 1080
```

Aperçu jouable : `http://127.0.0.1:8097/compose.html?dir=captures/<dossier>&site=Axiom`.

## Confidentialité

La zone du compte (solde, wallet) est floutée dans le film : rectangle `redact` du site dans `capture.mjs`. Vérifier sur l'aperçu avant de publier.

## Sites

- `axiom` : connexion nécessaire (Pulse et pages token).
- `padre` : page publique de Terminal (Padre), sans connexion.
- `pump` : pump.fun (peut afficher un contrôle Cloudflare au Chrome automatique : dans ce cas, ne pas le contourner).
