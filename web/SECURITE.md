# Sécurité de Repère

Ce que l'application défend, comment, et ce qu'elle ne défend pas. Écrit pour être
relu et contesté : une défense qu'on ne peut pas vérifier n'en est pas une.

## Le principe

**Il n'y a plus de serveur à défendre.** Depuis le 4 octobre 2026, Repère n'a ni
compte, ni base de données, ni route serveur : des fichiers statiques, et un
planning qui vit dans le navigateur de la personne qui s'en sert. La surface
d'attaque se réduit donc à trois choses :

1. **Ce que le navigateur reçoit du site** — protégé par les en-têtes HTTP et la CSP.
2. **Ce qu'on lui fait charger** — un **fichier de sauvegarde**, seule entrée non
   fiable qui reste : n'importe qui peut en fabriquer un et le faire passer pour le sien.
3. **L'appareil lui-même** — hors de portée de l'application.

## Le fichier de sauvegarde est une entrée hostile

Un fichier `repere-….json` peut venir d'ailleurs que de soi : reçu par message,
téléchargé, modifié à la main. Tout ce qu'il contient est traité comme écrit par un
attaquant.

Trois barrières, chacune suffisante seule :

1. **Assainissement au chargement** — `appliquerEtat()` ne garde que des formes
   attendues : `assainirProgramme()` contraint le programme (identifiants sur
   `[A-Za-z0-9._-]{1,48}`, couleurs prises dans une liste fermée, libellés bornés et
   purgés des caractères de contrôle) ; `normaliserCapacites()` ne garde que des
   plages au format `HH:MM` ; `normaliserRepos()` des entiers de 0 à 6 ;
   `partJour` une date ISO et un nombre fini. Les photos importées doivent être des
   `data:image/(jpeg|png|webp);base64` rangées sous une clé `idb:` — pas de SVG, qui
   est un document et non une image.
2. **Échappement au point d'insertion** — `esc()` sur toute interpolation, y compris
   dans les attributs. Les liens saisis passent par `lienSur()`, qui n'accepte que
   `http:` et `https:` après analyse par `URL` — pas par comparaison de chaîne, sinon
   `JaVaScRiPt:` et `java\tscript:` passeraient.
3. **`Content-Security-Policy`** — `script-src 'self'` : aucun script inline, aucun
   gestionnaire `onerror=`, aucune URL `javascript:` ne s'exécute, même si 1 et 2
   échouent. `connect-src 'self'` : même une injection réussie n'a nulle part où
   envoyer quoi que ce soit.

**Vérifié, et une faille trouvée.** `xss_sauvegarde.py` charge un fichier qui place
`"><b class=pwn>…<img class=pwn src=x>` dans **chaque** champ texte de l'état — titres,
liens, identifiants, plages horaires, fiches, notes, journal, clés de photos — puis
parcourt toutes les vues, et compte les nœuds injectés et les liens `javascript:`.
Lancé une fois avec la CSP de production, une fois **sans** :

| | avant correction | après |
|---|---|---|
| sans CSP | **4 nœuds injectés**, dans l'éditeur des heures de travail | aucun |
| CSP de production | balises injectées, scripts bloqués | aucun |

Cause : les plages de `capacites` étaient insérées telles quelles dans l'attribut
`value` du champ de saisie. Tant que seul le propriétaire pouvait les écrire, elles
ne traversaient aucune frontière de confiance ; le fichier de sauvegarde en a créé
une. Corrigé aux deux niveaux — filtre `HH:MM` au chargement, `esc()` à l'insertion.

Le rechargement **demande toujours confirmation** avant de remplacer le planning, et
le dit : un fichier ne s'applique jamais sans geste explicite.

## En-têtes HTTP

Posés dans `vercel.json`, sur toutes les routes :

| En-tête | Ce qu'il empêche |
|---|---|
| `Content-Security-Policy` | scripts injectés, `javascript:`, envoi de données vers un tiers |
| `Strict-Transport-Security` | rétrogradation vers HTTP, interception |
| `X-Content-Type-Options: nosniff` | un fichier interprété comme du script |
| `frame-ancestors 'none'` + `X-Frame-Options` | clickjacking |
| `Referrer-Policy: no-referrer` | fuite d'URL vers les sites tiers |
| `Cross-Origin-Opener-Policy` | prise de contrôle de la fenêtre ouvrante |
| `Permissions-Policy` | accès caméra, micro, position, capteurs |

La CSP ne nomme plus aucun domaine extérieur : `default-src 'self'`,
`connect-src 'self'`, `img-src 'self' data: blob:`. Le projet Supabase en a été retiré
en même temps que le code qui lui parlait.

## Les photos

`photos.js` redessine chaque image dans un canevas avant de la ranger : seuls les
pixels sont recopiés, et les métadonnées — position GPS, appareil, heure exacte —
tombent. Le SVG est refusé à l'entrée. Les photos restent dans IndexedDB, sur
l'appareil.

## Ce qui n'est pas défendu

Le dire est plus utile que de prétendre le contraire.

- **L'appareil.** Quiconque ouvre le navigateur ouvre le planning : il n'y a pas de
  mot de passe, puisqu'il n'y a pas de compte. Le verrouillage du téléphone est la
  seule porte.
- **Le fichier de sauvegarde, une fois créé.** Il est **en clair**, photos comprises.
  Le chiffrer avec un mot de passe serait possible (Web Crypto, AES-GCM, clé dérivée
  par PBKDF2), mais un mot de passe oublié rendrait la sauvegarde inutilisable : ce
  n'est pas fait, et la page de confidentialité le dit.
- **Un script du même domaine.** `localStorage` est lisible par tout script servi
  depuis le site. La CSP empêche d'en charger d'ailleurs ; un dépôt compromis, lui,
  passerait.
- **La perte.** Effacer les données du site efface le planning. Le seul remède est la
  sauvegarde dans un fichier ; l'écran *Sauvegarde* rappelle sa date et la signale
  en rouge au-delà d'une semaine.

## L'ancienne version

Jusqu'au 4 octobre 2026, Repère avait des comptes, un réseau social, des messages et
des notifications, sur Supabase. Les audits de cette époque — politiques d'accès au
niveau des lignes, fonctions `SECURITY DEFINER`, `public` par défaut, demandes qui
recopiaient un planning chez autrui, trois failles XSS stockées — sont dans
l'historique Git de ce fichier, avant ce commit. Le projet Supabase est en pause ;
ses données y restent, et l'application ne les lit plus.

## Comment vérifier soi-même

```sh
# Les en-têtes réellement servis
curl -sI https://<domaine>/ | grep -i -E 'content-security|strict-transport|x-frame'

# Aucune requête sortante : ouvrir les outils de développement, onglet Réseau,
# utiliser l'application — rien ne doit partir ailleurs que vers le domaine du site.
```
