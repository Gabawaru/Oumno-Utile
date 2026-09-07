# Repère — application web

Un planificateur de travail personnel : il répartit les heures, garde les pauses,
rattrape le retard le soir plutôt que de le laisser filer, et dit à qui l'on veut
quand on est réellement libre.

## Ce que fait l'application

- **Comptes** — chacun crée le sien (adresse + mot de passe). Une seule inscription
  par adresse, **nom affiché unique**, mot de passe oublié par courriel, conditions et
  politique de confidentialité acceptées à l'inscription et datées en base.
- **Programme au choix** — le référentiel BTS CIEL du CNED n'est qu'un modèle. On peut
  aussi partir d'une trame de révisions ou d'une page blanche et déclarer ses propres
  matières et étapes. Le moteur ne connaît que des étapes avec un volume d'heures et
  une période.
- **Pseudonyme, et vrai nom sur autorisation** — le pseudonyme est public et unique ;
  le vrai nom est facultatif, rangé dans une table à part, et montré aux seules
  personnes pour lesquelles on coche ce droit.
- **Qui voit quoi** — privé par défaut. On autorise des comptes un par un, on envoie un
  **lien d'invitation** (30 jours, 25 usages, 20 liens actifs au plus), ou on ouvre le
  planning à tous. Toujours en lecture seule. Ces règles sont posées dans la base, pas
  seulement dans l'interface — voir [`SECURITE.md`](SECURITE.md).
- **Consultation libre** — les plannings publics s'ouvrent sans compte, en lecture seule,
  via `?profil=identifiant`. La page d'accueil liste ce qui est ouvert à la consultation.
- **Horloge de Paris** — avance, retard et échéances se calculent sur `Europe/Paris`,
  quel que soit le fuseau du visiteur.
- **Journée normale, puis rattrapage** — la journée type va de 9 h à 16 h, pauses comprises.
  Le travail se pose d'abord là. Ce qui n'y tient pas glisse sur des heures inhabituelles
  (le soir, jusqu'à 22 h), plafonnées à 2 h 30 par jour : au-delà, l'application prévient
  plutôt que d'aligner des journées de quatorze heures.
- **Pauses non négociables** — 15 min après chaque 1 h 30 de travail, et le repas de
  12 h 15 à 13 h 15 que même le rattrapage ne touche pas. Une pause déclarée à la main
  (case « c'est une pause » à l'ajout d'un événement) bloque le créneau comme un rendez-vous.
- **Part du jour** — ce qui est prévu aujourd'hui est arrêté au premier calcul de la journée
  et ne fait que décroître à mesure qu'on valide. Terminer sa journée la libère vraiment :
  le travail des jours suivants ne vient pas la remplir aussitôt.
- **Ajout d'un événement** — la vie passe avant le planning : un événement est toujours
  accepté et le travail se décale, éventuellement sur la soirée ou sur les jours suivants.
  Un seul cas de refus, annoncé en plein écran : quand des heures ne retrouveraient de place
  nulle part, ni le jour même, ni le soir, ni ensuite. Le message nomme le jour qui bloque,
  et laisse le choix d'ajouter quand même.
- **Zone de tâche** — clique un jour : capacité, heures déjà prises, travail placé, heures
  hors horaires, créneaux libres.
- **Remettre à plus tard** — pour une étape qui ne rentre nulle part, un bouton calcule
  la première date à laquelle elle tient et y repousse son échéance.
- **Lettre d'information** — inscription ouverte à tous sur un profil ; un courriel part
  quand il y a du nouveau, et rappelle le 1er du mois de rafraîchir le scan CNED.
- **Effacement en un clic** — le bouton *Supprimer mon compte* efface compte, planning,
  journal, partages et abonnés, immédiatement et sans copie.

## Architecture

Aucune dépendance npm, aucun script chargé depuis un CDN : tout est servi depuis le
même domaine, pour qu'un blocage réseau ne laisse jamais une page blanche.

```
web/
├── index.html           page d'accueil, authentification et application
├── app.js               logique de l'application
├── supa.js              client Supabase minimal (auth + requêtes + RPC)
├── planificateur.js     moteur de répartition des heures, pauses et rattrapage
├── modeles.js           modèles de programme et programme sur mesure
├── planning.js          référentiel BTS CIEL 2A relevé sur eformation.cned.fr
├── SECURITE.md          modèle de menace, défenses, et ce qui n'est pas couvert
├── conditions.html      conditions générales
├── confidentialite.html politique de confidentialité et RGPD
├── aide.html            questions fréquentes et mentions légales
├── pages.css pages.js   feuille et interactions communes aux trois pages ci-dessus
├── polices.css polices/ IBM Plex servi depuis le même domaine
├── api/cron.js          tâche quotidienne : récapitulatif aux abonnés
└── vercel.json          planification du cron
```

`vercel.json` pose les en-têtes de sécurité, dont une politique de sécurité du
contenu en `script-src 'self'` : aucun script étranger ne s'exécute, et les données
ne peuvent partir nulle part ailleurs que vers la base.

Les polices sont servies depuis ce domaine et non par Google : charger une police
chez un tiers transmet l'adresse IP de chaque visiteur, ce qui n'a pas de base légale
ici et n'apporte rien.

Le navigateur parle directement à Supabase : ce sont les politiques de sécurité au
niveau des lignes qui décident de tout. La seule route serveur est le cron, seul
endroit qui a besoin de privilèges élevés pour lire les adresses des abonnés.

## Variables d'environnement

Nécessaires uniquement au cron (Vercel → Settings → Environment Variables).
L'application elle-même n'en a besoin d'aucune.

| Variable | Rôle | Obligatoire |
|---|---|---|
| `SUPABASE_URL` | URL du projet | pour le cron |
| `SUPABASE_SERVICE_KEY` | clé `service_role` — lit les adresses des abonnés | pour le cron |
| `RESEND_API_KEY` | clé [Resend](https://resend.com) | sans elle, aucun courriel ne part |
| `MAIL_FROM` | expéditeur, ex. `Pilote CIEL <planning@mondomaine.fr>` | non |
| `PUBLIC_URL` | reprise en pied de courriel | non |
| `CRON_SECRET` | posé par Vercel ; protège `/api/cron` | auto |

## Base de données

Projet Supabase **« CNED link »** (`hnmeefndnckqkdjjbgwe`, `eu-west-3`).
Tables `ciel_profiles`, `ciel_state`, `ciel_journal`, `ciel_subs`, `ciel_partages`,
`ciel_invitations`.

Le navigateur n'accède jamais aux jetons d'invitation ni aux noms des comptes privés :
des fonctions `security definer` font le travail et n'exposent que le nécessaire.

| Fonction | Qui | Ce qu'elle fait |
|---|---|---|
| `nom_disponible(text)` | tout le monde | dit si un nom affiché est libre, sans lire la table |
| `creer_invitation()` | connecté | tire un jeton et l'enregistre |
| `accepter_invitation(text)` | connecté | consomme un jeton et crée le partage |
| `mes_invites()` | connecté | nomme les comptes que j'ai autorisés |
| `regler_nom_reel(uuid,bool)` | connecté | accorde ou retire l'accès au vrai nom |
| `supprimer_mon_compte()` | connecté | efface tout, en cascade |

`prive.ciel_visible()`, le rouage interne des politiques, vit dans un schéma non
exposé par PostgREST. **Attention :** `CREATE OR REPLACE FUNCTION` remet les droits
à leur valeur par défaut (`EXECUTE` pour `PUBLIC`) — toute recréation doit être
suivie de son `REVOKE`, et `get_advisors` passé après chaque migration.

Le dépôt est public et la clé publiable circule dans le navigateur : c'est son usage
prévu. La protection repose entièrement sur les politiques de sécurité.

| Rôle | Peut | Ne peut pas |
|---|---|---|
| visiteur | lire les profils publics, leur planning et leur journal ; s'abonner à une lettre | écrire quoi que ce soit, lire un profil privé, lire la liste des abonnés |
| compte connecté | tout ce qui précède, plus écrire **son** planning et lire ceux qu'on lui a partagés | toucher au planning d'un autre, même partagé |

Éprouvé par bascule de rôle réelle en base : un visiteur anonyme et un tiers connecté
lisent 0 ligne d'un planning privé, l'invité en lit 1 et n'y écrit rien, et les jetons
d'invitation ne sont lisibles par personne.

Un déclencheur crée le profil et le planning vide à l'inscription, avec un identifiant
dérivé de l'adresse et dédoublonné.

## Réglages Supabase à vérifier

- **Authentication → Providers → Email** : confirmation d'adresse activée ou non, selon
  que tu veuilles une inscription immédiate ou vérifiée.
- **Authentication → URL Configuration** : ajouter l'URL du site aux redirections, sinon
  le lien de réinitialisation ne revient pas au bon endroit.
- **Adresse de contact** : `aide.html` et `confidentialite.html` la laissent en évidence.
  C'est le seul champ à remplir : l'éditeur non professionnel n'a pas à publier son
  identité (LCEN art. 6 III 2°), mais doit offrir un moyen de le joindre. Voir
  [`SECURITE.md`](SECURITE.md).
- **Authentication → Emails** : sans SMTP personnalisé, Supabase limite fortement le
  nombre de courriels. Pour un usage réel, brancher un expéditeur.

## Développement local

```sh
cd web
python3 -m http.server 8000
```

Le dépôt déclare le serveur MCP Supabase dans `.mcp.json` à la racine : ouvrir le
projet avec Claude Code donne accès à la base (`/mcp` pour s'authentifier).
