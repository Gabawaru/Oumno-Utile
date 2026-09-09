# Repère — application web

Un planificateur de travail personnel : il répartit les heures, garde les pauses,
rattrape le retard le soir plutôt que de le laisser filer, et dit à qui l'on veut
quand on est réellement libre.

Autour de ce planning, un petit réseau : on suit des gens, on voit ce qu'ils
publient, et surtout on repère les moments où l'on est libres en même temps.

## Ce que fait l'application

- **Comptes** — chacun crée le sien (adresse + mot de passe). Une seule inscription
  par adresse, **nom affiché unique**, mot de passe oublié par courriel, conditions et
  politique de confidentialité acceptées à l'inscription et datées en base.
- **Programme au choix** — le référentiel BTS CIEL du CNED n'est qu'un modèle. On peut
  aussi partir d'une trame de révisions ou d'une page blanche et déclarer ses propres
  matières et étapes. Le moteur ne connaît que des étapes avec un volume d'heures et
  une période.
- **Une porte, pas une brochure** — à l'arrivée, un seul écran et trois chemins :
  créer un compte, se connecter, ou regarder sans compte. Chacun mène à un écran
  différent, et l'application se parcourt ensuite par une barre de cinq destinations
  en bas de l'écran — jour, planning, fil, messages, contacts.
- **Contacts** — on s'abonne à quelqu'un ; un compte public accepte tout de suite, un
  compte privé décide. On règle qui peut vous joindre (tout le monde, ses contacts, ou
  personne) et on **propose un moment** aux autres, avec un motif. L'hôte accepte ou
  refuse — ou accepte automatiquement s'il le veut. Un moment accepté devient un
  événement de son planning.
- **Le fil** — publications de texte et de photos, commentaires, « j'aime ». Chaque
  publication porte sa portée : ses contacts, ou tout le monde. Une publication
  ouverte à tous depuis un profil privé reste invisible : la visibilité du profil
  l'emporte.
- **Conversations** — messagerie entre comptes. Qui n'a pas le droit de vous écrire
  ne peut vous adresser **qu'une** chose : une proposition de moment, avec son motif.
  Répondre ou accepter ouvre la conversation. Blocage réciproque et signalement d'un
  contenu à l'éditeur.
- **Photo de profil** — redimensionnée et reconvertie par le navigateur avant l'envoi,
  ce qui efface au passage les métadonnées EXIF, position GPS comprise.
- **Fuseau horaire et région** — le profil de quelqu'un affiche l'heure qu'il est chez
  lui et l'écart avec la vôtre. « Libre à 14 h » ne veut pas dire la même chose à
  Paris et à Hanoï. La région est un texte libre, facultatif, masqué par défaut.
- **Moments communs et classement** — l'intersection de vos plages libres avec celles
  des gens que vous suivez, et un classement des heures de la semaine où l'on ne
  figure qu'après l'avoir demandé.
- **Événements publics ou privés** — par défaut un événement est privé : les autres
  voient « Occupé », sans titre ni lien. Cocher « titre visible » le partage.
- **Installation** — manifeste, icônes et service worker : Repère s'ajoute à l'écran
  d'accueil et s'ouvre sans réseau. `installer.html` explique la marche à suivre par
  plateforme.
- **Le ruban** — une bande passagère en bas de l'écran, dont le texte défile :
  « mise à jour en direct », le temps d'un déploiement. Elle vit dans la base, se
  pose en une ligne, et **s'éteint toute seule** — une fin est obligatoire, deux
  heures par défaut, pour qu'une annonce oubliée ne devienne pas un mensonge.
  Toucher la bande la masque pour la session.
- **L'attente** — le bras du logo tourne autour de son pivot pendant le chargement.
  Sans réponse, il décroche et tombe : « Pas de réseau ici ». Un toucher relance, un
  ré-essai part tout seul avec un recul croissant, et l'événement `online` du
  navigateur reprend la main dès que la connexion revient. Quand une copie locale
  existe, elle est ouverte plutôt que l'écran d'erreur.
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
├── manifest.webmanifest sw.js  installation et fonctionnement hors réseau
├── icones/              logo de Repère, toutes tailles
├── installer.html installer.js  tutoriel d'installation par plateforme
├── beta.html            état du service, et ce que « bêta » implique
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

Le planning : `ciel_profiles`, `ciel_state`, `ciel_journal`, `ciel_subs`,
`ciel_partages`, `ciel_invitations`, `ciel_identites`, `ciel_reservations`.

Le réseau : `ciel_posts`, `ciel_commentaires`, `ciel_jaime`, `ciel_fils`,
`ciel_messages`, `ciel_blocages`, `ciel_signalements`, `ciel_dispos`, `ciel_scores`.

Deux seaux de stockage : `avatars` (public, 1 Mo) et `photos` (privé, 3 Mo, servi par
adresse signée). L'écriture est bornée au dossier `<uuid>/` de chacun.

Le navigateur n'accède jamais aux jetons d'invitation ni aux noms des comptes privés :
des fonctions `security definer` font le travail et n'exposent que le nécessaire.

| Fonction | Qui | Ce qu'elle fait |
|---|---|---|
| `nom_disponible(text)` | tout le monde | dit si un nom affiché est libre, sans lire la table |
| `creer_invitation()` | connecté | tire un jeton et l'enregistre |
| `accepter_invitation(text)` | connecté | consomme un jeton et crée le partage |
| `mes_invites()` | connecté | nomme les comptes que j'ai autorisés |
| `regler_nom_reel(uuid,bool)` | connecté | accorde ou retire l'accès au vrai nom |
| `s_abonner(uuid)` | connecté | accepte tout de suite chez un public, met en attente chez un privé |
| `repondre_abonnement(uuid,bool)` | connecté | accepte ou refuse une demande reçue |
| `mes_abonnes()` / `mes_abonnements()` | connecté | les deux sens de la relation |
| `identifiant_disponible(text)` | connecté | dit si un identifiant public est libre |
| `carte_profil(text)` | connecté | la carte minimale d'un compte, par identifiant exact — sans quoi un compte privé serait injoignable |
| `proposer_creneau(...)` | connecté | applique la joignabilité, exige un motif d'un inconnu, dépose le message |
| `envoyer_message(uuid,text)` | connecté | seule écriture possible dans une conversation |
| `marquer_lu(uuid)` | connecté | efface la pastille des non-lus |
| `mes_fils()` | connecté | les conversations, avec le pseudonyme d'en face |
| `fil_actualite(...)` / `publications_de(...)` | tout le monde | le fil, en `security invoker` — ce sont les politiques qui filtrent |
| `classement()` | connecté | les heures de la semaine, des seuls volontaires |
| `moments_communs()` | connecté | l'intersection des plages libres |
| `supprimer_mon_compte()` | connecté | efface tout, en cascade, fichiers compris |

`prive.ciel_visible()`, le rouage interne des politiques, vit dans un schéma non
exposé par PostgREST. **Attention :** `CREATE OR REPLACE FUNCTION` remet les droits
à leur valeur par défaut (`EXECUTE` pour `PUBLIC`) — toute recréation doit être
suivie de son `REVOKE`, et `get_advisors` passé après chaque migration.

Le dépôt est public et la clé publiable circule dans le navigateur : c'est son usage
prévu. La protection repose entièrement sur les politiques de sécurité.

| Rôle | Peut | Ne peut pas |
|---|---|---|
| visiteur | lire les profils publics, leur planning, leur journal et leurs publications ouvertes à tous ; s'abonner à une lettre | écrire quoi que ce soit, lire un profil privé, une publication réservée, un message, la liste des abonnés |
| compte connecté | tout ce qui précède, plus écrire **son** planning, publier, commenter, converser selon la joignabilité d'en face | toucher au planning d'un autre, publier sous son nom, lire une conversation dont il n'est pas |

Éprouvé par bascule de rôle réelle en base : un visiteur anonyme et un tiers connecté
lisent 0 ligne d'un planning privé, l'invité en lit 1 et n'y écrit rien, et les jetons
d'invitation ne sont lisibles par personne. Côté réseau : une publication réservée
reste invisible à qui n'est pas abonné, commenter ce qu'on ne peut pas lire est
refusé, publier sous le nom d'un autre aussi, et un blocage coupe tout dans les deux
sens. Le détail est dans [`SECURITE.md`](SECURITE.md).

Un déclencheur crée le profil et le planning vide à l'inscription, avec un identifiant
dérivé de l'adresse et dédoublonné.

## Poser une annonce

Depuis la console SQL du projet. La fonction éteint l'annonce en cours avant d'en
poser une nouvelle, et vide le bandeau si on ne lui passe rien.

```sql
-- Pendant un déploiement
select prive.annoncer('Mise à jour en direct — quelques secousses possibles.');

-- Plus longtemps, et sur un autre ton : travaux (défaut), info, alerte
select prive.annoncer('Maintenance jusqu''à 18 h.', interval '3 hours', 'alerte');

-- Éteindre tout de suite
select prive.annoncer(null);
```

L'application relit l'annonce à l'ouverture, au retour dans l'onglet, et toutes
les 90 secondes tant que l'onglet est au premier plan. La table est en lecture
seule pour tout le monde, y compris sans compte, et n'accepte aucune écriture par
l'API : seule la console écrit.

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
