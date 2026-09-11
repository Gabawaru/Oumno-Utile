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
- **La pente devant toi** — une montagne qu'on construit en ne travaillant pas sera
  toujours plus dure à franchir qu'une plaine encore plate. Ce n'est pas une image :
  c'est `reste ÷ jours restants`, et chaque jour sans rien poser redresse la pente
  du lendemain. Le terrain est donc calculé, jamais dessiné d'avance — son
  inclinaison est le rythme qu'il faudrait tenir, comparé à celui qu'on tient
  vraiment. Un tracé en pointillés montre ce qu'était la pente il y a une semaine.
  Un bonhomme s'y tient : il **randonne** quand le terrain est plat, **grimpe**
  quand ça monte, sort le **piolet** quand c'est raide, et **reste immobile, la main
  au menton**, tant que rien n'a été posé — à regarder la montagne grandir.
  La raideur est comprimée en racine pour le dessin : devoir tenir 4 h par jour
  quand on en tient dix minutes donne ×26, et un mur vertical ne montre plus rien.
- **Les fiches** — l'application gardait d'une étape : faite ou non, les heures
  posées, une note si c'était un devoir. Rien de ce qu'on y avait compris. Chaque
  étape porte maintenant sa fiche : du texte, des photos d'une page manuscrite.
  Elle vit là où le planning a rangé l'étape, donc on la retrouve en révisant sans
  se souvenir où on l'avait mise. Une pastille signale les étapes qui en ont une.
- **Le minuteur** — chaque tâche de la journée porte une icône de minuteur. Elle
  ouvre un écran dédié : le temps qui court, une pause, et un **pomodoro
  facultatif** (25 min de travail, 5 de pause) qui annonce la fin d'une phase mais
  ne coupe jamais tout seul. À l'arrêt, l'application ne demande pas le temps passé
  — elle le connaît — mais **ce que ça a fait avancer** : c'est justement l'écart
  entre les deux qu'elle apprend. Puis elle pose la question que rien ne permettait
  jusque-là : on repart dessus, ou on décale ?
  Le minuteur ne vit pas en mémoire mais dans le navigateur, en horodatages : un
  téléphone qui verrouille son écran gèle l'onglet, et un compteur qui s'incrémente
  à la seconde perdrait tout.
- **Le facteur de réalité** — temps réel divisé par temps indicatif. Au-dessus de 1,
  une matière coûte plus cher que ce que le CNED annonce ; au-dessous, moins. C'est
  le seul chiffre qui dise si le plan parle de toi ou d'un élève moyen, et il nourrit
  désormais le planificateur : une étape à 1,4× occupe 1,4× plus de place. Une courbe
  par matière montre l'évolution séance après séance — un facteur qui descend, c'est
  qu'on apprend.
- **Prévision par matière** — un tableau : ce qui reste, ce que ça coûtera vraiment,
  la fin prévue face à l'échéance de la matière (pas celle de l'examen), et le rythme
  hebdomadaire qu'il faudrait tenir. Au-delà de dix-huit mois la date cesse d'être une
  prévision : on écrit « au-delà » et on donne l'effort à fournir, qui est le seul
  chiffre sur lequel on peut agir.
- **Le retard, nommé sur le diagramme** — la vue d'ensemble garde sa forme. Le vide
  disait déjà qu'il manque quelque chose ; une pastille dit maintenant depuis combien
  de jours l'échéance est passée, et la légende explique les deux signes.
- **Heures posées, pas étapes cochées** — le travail se valide à la tranche. Cocher
  une heure de la journée sur une étape de six crédite une heure, pas six : la table
  `avance` retient ce qui a été fait, quel jour, et le planificateur ne replanifie
  que le reste. Une étape se termine toute seule quand ses heures sont posées.
- **Projection de fin** — sous la courbe, deux chiffres et rien de mélangé : la date
  à laquelle le rythme des quatre dernières semaines mène, face à l'examen ; et la
  moyenne où mènent les notes, avec sa fourchette. Le seul pont entre les deux est
  la part du programme qui ne sera pas traitée, dite en heures et en pourcentage —
  rien ici ne dit combien une heure de travail vaut de points, et l'inventer donnerait
  un chiffre précis et faux.
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
- **Notifications poussées** — le téléphone sonne même application fermée, pour
  un message, une demande d'abonnement, un moment proposé ou sa réponse, et pour
  les personnes qu'on surveille. **Jamais pour les publications du fil** : c'est
  précisément la notification qu'on désactive, et elle emporte les autres avec
  elle. Cinq nouvelles d'un coup font un seul message, pas cinq. Rien n'est
  demandé à l'ouverture — une permission qui tombe sans qu'on l'ait sollicitée se
  refuse par réflexe, et un refus ne se reprend pas. Sur iPhone il faut d'abord
  poser Repère sur l'écran d'accueil : l'application le dit, avec le lien.
- **Le centre de nouveautés** — une cloche dans l'en-tête rassemble ce qui a bougé
  depuis la dernière visite : messages, demandes d'abonnement, moments proposés et
  leurs réponses, publications et disponibilités. Deux groupes, dans cet ordre :
  « ça attend ta réponse », puis « bon à savoir ». Seul le premier compte dans la
  pastille — une pastille qui ne s'éteint jamais cesse d'être lue.
- **« Me prévenir quand il est libre »** — une case à cocher par contact. Elle ne
  déclenche aucun courriel : la prochaine plage libre que la personne publie apparaît
  dans le centre de nouveautés. On coche et on décoche depuis la liste des contacts,
  et la personne surveillée n'en sait rien.
- **Photos, avec recadrage** — on cadre avant d'envoyer : la fenêtre s'ouvre sur
  l'image entière, on la déplace au doigt, on la grossit à deux doigts ou à la
  molette. Carré et masque rond pour la photo de profil ; carré, portrait ou
  paysage pour une publication. Tout tient dans un canevas, sans dépendance —
  la politique de sécurité du contenu n'en accepterait aucune.
- Le morceau retenu est redessiné et reconverti en JPEG par le navigateur avant
  l'envoi, ce qui efface au passage les métadonnées EXIF, position GPS comprise.
  Aucun filtrage sur le type déclaré : un iPhone rend ses photos en HEIC, et le
  seul test qui vaille est de tenter le décodage.
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
- **Zones sûres** — la page est dessinée sous la barre d'état du téléphone
  (`viewport-fit=cover`) : sans marge en haut, l'en-tête s'y superposait et devenait
  illisible. Deux variables, `--haut` et `--bas`, portent les encoches ; un bandeau
  fixe garde son fond pour que rien ne défile derrière. Elles sont réglables depuis
  la console, ce qui rend l'encoche vérifiable en test — `env()` ne se simule pas.
- **L'attente** — le bras du logo tourne autour de son pivot pendant le chargement.
  Sans réponse, il décroche et tombe : « Pas de réseau ici ». Un toucher relance, un
  ré-essai part tout seul avec un recul croissant, et l'événement `online` du
  navigateur reprend la main dès que la connexion revient. Quand une copie locale
  existe, elle est ouverte plutôt que l'écran d'erreur.
- **Importer son emploi du temps** — Pronote, Google Agenda et la plupart des EDT
  scolaires publient une **adresse ICS**, en lecture seule, faite pour ça. On la
  colle, on voit l'aperçu, on ajoute. Les événements importés sont privés : les
  autres voient « Occupé ». Réimporter ne double pas — un même identifiant
  d'événement remplace le précédent.
  **Jamais par un identifiant de connexion.** Un cookie de session Pronote donne
  accès aux notes, aux absences et à la messagerie de quelqu'un, souvent d'un
  mineur ; l'adresse ICS ne donne que l'agenda. Elle reste un secret — qui l'a,
  voit l'emploi du temps — donc elle n'est pas conservée : on la recolle pour
  réimporter.
- **Les demandes** — on envoie son emploi du temps à quelqu'un par son identifiant
  unique. La demande arrive repliée, annoncée par cet identifiant ; dépliée, elle
  montre ce qu'elle contient avant qu'on accepte. **Le mot de passe est redemandé
  avant l'envoi** : ce n'est pas un geste à faire sur un téléphone laissé
  déverrouillé. Une seule demande en attente à la fois vers la même personne.
- **Un identifiant unique par compte** — `ID12345678`, tiré à l'inscription, jamais
  choisi et jamais modifiable. Le pseudonyme et l'identifiant public (`@slug`) se
  changent ; celui-ci désigne quelqu'un sans ambiguïté, y compris après un
  changement de nom. Pour en avoir un autre il faut un autre compte : l'unicité est
  posée en base, et le déclencheur de validation recopie l'ancienne valeur à chaque
  écriture — comme il le fait déjà pour la date de consentement.
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
├── api/pousser.js       toutes les 30 min : envoie les notifications en attente
├── api/_push.js         Web Push écrit à la main — VAPID et chiffrement aes128gcm
├── api/vapid.js         la clé publique, que le navigateur doit connaître
├── api/agenda.js        va chercher un agenda ICS, pour le compte de l'appelant
├── api/_ics.js          gardes anti-SSRF et lecture RFC 5545
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
| `CRON_SECRET` | posé par Vercel ; protège `/api/cron` et `/api/pousser` | auto |
| `VAPID_PUBLIC` | clé publique de poussée, servie au navigateur | pour les notifications |
| `VAPID_PRIVATE` | clé privée — elle seule prouve que la poussée vient d'ici | pour les notifications |
| `VAPID_SUBJECT` | `mailto:` de contact, exigé par la RFC 8292 | pour les notifications |
| `PUSH_SECRET` | partagé avec Supabase, qui déclenche l'envoi | pour les notifications |

## D'où viennent les heures

Vérifié le 10 septembre 2026 sur `eformation.cned.fr`, section par section, sans
ouvrir aucune page d'activité.

Chaque situation professionnelle et chaque séquence de physique porte une **durée
indicative** sur sa page de section. Le référentiel les reprend telles quelles, et
la vérification les redonne toutes :

| | CNED | `planning.js` |
|---|---|---|
| Bloc 1 — SP 6 / 7 / 8 / 9 / 10 | 41 / 23 / 26 / 22 / 26 h | identiques |
| Bloc 2 — SP 6 / 7 / 8 / 9 / 10 | 41 / 41 / 41 / 46 / 41 h | identiques |
| Bloc 3 — SP 6 / 7 / 8 / 9 | 51 / 40 / 42 / 80 h | identiques |
| Physique — séquences 13 à 21 | 10 h chacune | identiques |
| Mathématiques — modules M8 à M13 | 60 h | identiques |

Deux réserves, qui ne changent aucun total :

- Le découpage d'une SP en **« Mission 1 / 2 / 3 »** (36 / 34 / 30 %) est une
  commodité de planification, pas un découpage du CNED : lui ne donne qu'une durée
  pour la situation entière. Le partage sert à répartir le travail sur plusieurs
  jours, rien de plus.
- Les **6 h, 3 h et 1 h** annoncées pour E4, E5 et E6 sont les durées *d'épreuve*
  (« Type : Écrit, Coefficient 4 »), pas du temps de travail. Elles ne sont donc pas
  comptées comme telles.

Indicatif reste indicatif : c'est une moyenne, pas un rythme personnel. *Moi → Mon
travail* rend le programme modifiable pour corriger les heures qui ne collent pas.

## Base de données

Projet Supabase **« CNED link »** (`hnmeefndnckqkdjjbgwe`, `eu-west-3`).

Le planning : `ciel_profiles`, `ciel_state`, `ciel_journal`, `ciel_subs`,
`ciel_partages`, `ciel_invitations`, `ciel_identites`, `ciel_reservations`.

Le réseau : `ciel_posts`, `ciel_commentaires`, `ciel_jaime`, `ciel_fils`,
`ciel_messages`, `ciel_blocages`, `ciel_signalements`, `ciel_dispos`, `ciel_scores`,
`ciel_veilles`, `ciel_push`, `ciel_demandes`.

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
| `nouveautes()` | connecté | ce qui a bougé depuis la dernière visite, en six sources réunies |
| `marquer_nouveautes_vues()` | connecté | repose la date de dernière consultation |
| `supprimer_mon_compte()` | connecté | efface tout, en cascade, fichiers compris |
| `envoyer_demande(text,jsonb,…)` | connecté | adresse une demande par identifiant unique, sans jamais rendre l'uuid de la cible |
| `mes_demandes()` | connecté | les demandes reçues et envoyées, avec l'identifiant d'en face |
| `repondre_demande(uuid,bool)` | connecté | accepte ou refuse une demande reçue |
| `a_pousser()` | `service_role` seul | ce qui mérite de faire sonner un téléphone |
| `marquer_pousse(uuid,timestamptz)` | `service_role` seul | avance la borne des poussées |
| `oublier_appareil(text)` | `service_role` seul | efface un appareil que le service déclare mort |

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

## Les notifications poussées

Écrites à la main dans `api/_push.js` : signature VAPID en ES256 (RFC 8292) et
chiffrement `aes128gcm` du contenu (RFC 8291), avec `node:crypto` et rien d'autre.
Ajouter une dépendance pour signer un jeton et dériver trois clés reviendrait à
confier la boîte aux lettres de chacun à du code qu'on ne lit pas.

Le serveur ne décide rien : `a_pousser()` dit en SQL ce qui mérite d'interrompre
quelqu'un, la route chiffre et poste. Un appareil que le service déclare mort
(404 ou 410) est effacé, pas réessayé. La borne `pousse_le` n'avance que si au
moins un appareil a reçu — sinon la nouvelle serait perdue sans que personne ne
l'ait jamais vue.

**Qui bat la mesure.** Pas Vercel : son offre gratuite ne planifie qu'une fois
par jour, et une notification qui arrive le lendemain n'en est plus une. C'est
Supabase, avec `pg_cron` et `pg_net`, toutes les quinze minutes. La tâche
interroge d'abord `a_pousser()` et ne réveille la route que s'il y a
effectivement quelque chose à dire. Le secret partagé dort dans le coffre
(`vault.secrets`, entrée `push_secret`) et non dans la définition de la tâche,
que le tableau de bord affiche en clair.

```sql
-- Voir la tâche, la suspendre, la relancer
select jobid, jobname, schedule, active from cron.job where jobname = 'poussees';
select cron.unschedule('poussees');
select cron.schedule('poussees', '*/15 * * * *', $$select prive.declencher_poussees()$$);
```

Pour installer : générer une paire VAPID une fois, poser les quatre variables
dans Vercel, redéployer. `PUSH_SECRET` se lit dans le coffre Supabase.

```sh
node -e 'import("./api/_push.js").then(m=>console.log(m.nouvellesClesVapid()))'
```

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
