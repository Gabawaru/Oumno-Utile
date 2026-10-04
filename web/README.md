# Repère — application web

Un planificateur de travail personnel : il répartit les heures, garde les pauses,
fait une chose à la fois, rattrape le retard plutôt que de le laisser filer, et dit
quand on est réellement libre.

Repère vit **dans le navigateur** : pas de compte, pas de serveur, pas de base de
données. Le planning reste sur l'appareil, et se sauvegarde dans un fichier.

## Ce que fait l'application

- **Local, sans compte** — tout s'enregistre dans le navigateur (`localStorage`,
  photos des fiches dans IndexedDB). Aucun serveur applicatif, aucune base, aucune
  requête sortante : la CSP l'interdit. Au premier lancement, la copie `ciel.v4`
  laissée par l'ancienne version avec comptes est reprise, et annoncée une fois.
- **Sauvegarde dans un fichier** — *Moi → Sauvegarde* écrit `repere-AAAA-MM-JJ.json`,
  photos comprises, et le recharge sur n'importe quel appareil après confirmation.
  L'écran rappelle la date de la dernière sauvegarde, en rouge au-delà d'une semaine.
- **Maintenant** — l'écran du jour s'ouvre sur la séance en cours ou la prochaine :
  l'étape, sa matière, la durée, ce qu'il en restera, le lien vers le cours, le minuteur.
- **Une étape à la fois** — le nivellement décide combien travailler chaque jour, puis
  le contenu est repris dans l'ordre des échéances, une étape jusqu'à la finir. Le
  retard passe devant, mais seulement dans la marge réelle des jours : aucune étape
  à l'heure n'est rendue en retard pour autant.
- **Le repos qui se mérite** — *Pas de repos tant que je suis en retard* : tant
  qu'une étape a dépassé son échéance, les jours de repos gardent leurs plages, mais
  elles ne servent qu'au rattrapage.
- **J'en suis là** — dans *Étapes*, un geste compte comme acquis tout ce qui précède
  l'étape choisie, rangé sans date pour ne pas fausser le rythme.
- **« Je suis bloqué »** — certaines étapes n'avancent pas sans quelqu'un : une
  question au tuteur, un corrigé pas encore sorti. L'application les reproposait
  chaque matin et les comptait en retard, ce qui n'aide en rien. Une coche dans la
  fiche, une note (*de quoi as-tu besoin ?*), et l'étape **sort de la journée**.
  Elle ne sort **pas du retard** : le travail reste à faire, le retard le compte
  toujours, et la part bloquée est dite à part. Seule l'alarme quotidienne se tait,
  parce qu'elle réclamait l'impossible. Un panneau les rassemble, avec leurs notes,
  pour la prochaine fois qu'on parle au tuteur.
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
- **Installation** — manifeste, icônes et service worker : Repère s'ajoute à l'écran
  d'accueil et s'ouvre sans réseau. `installer.html` explique la marche à suivre par
  plateforme.
- **Zones sûres** — la page est dessinée sous la barre d'état du téléphone
  (`viewport-fit=cover`) : sans marge en haut, l'en-tête s'y superposait et devenait
  illisible. Deux variables, `--haut` et `--bas`, portent les encoches ; un bandeau
  fixe garde son fond pour que rien ne défile derrière. Elles sont réglables depuis
  la console, ce qui rend l'encoche vérifiable en test — `env()` ne se simule pas.
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

## Architecture

Aucune dépendance npm, aucun script chargé depuis un CDN, aucun serveur
applicatif : des fichiers statiques, servis depuis le même domaine.

```
web/
├── index.html           l'application (une seule page)
├── app.js               interface, état, sauvegarde locale et fichier
├── planificateur.js     moteur : nivellement, séquençage, pauses, rattrapage
├── modeles.js           modèles de programme et programme sur mesure
├── planning.js          référentiel BTS CIEL 2A relevé sur eformation.cned.fr
├── photos.js            photos des fiches : JPEG redimensionné, sans métadonnées
├── SECURITE.md          modèle de menace, défenses, et ce qui n'est pas couvert
├── manifest.webmanifest sw.js  installation et fonctionnement hors réseau
├── icones/              logo de Repère, toutes tailles
├── installer.html installer.js  tutoriel d'installation par plateforme
├── confidentialite.html ce qui est enregistré, et où
├── aide.html            questions fréquentes
├── pages.css pages.js   feuille et interactions communes aux pages ci-dessus
├── polices.css polices/ IBM Plex servi depuis le même domaine
└── vercel.json          en-têtes de sécurité
```

`vercel.json` pose les en-têtes de sécurité, dont une politique de sécurité du
contenu en `script-src 'self'` et `connect-src 'self'` : aucun script étranger ne
s'exécute, et le navigateur ne peut contacter aucun autre serveur.

Les polices sont servies depuis ce domaine et non par Google : charger une police
chez un tiers transmet l'adresse IP de chaque visiteur.

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

Deux précisions, qui ne changent aucun total :

- Les **missions** de chaque SP sont celles du CNED, relevées le 4 octobre 2026 avec
  leur titre : quatre à six selon la SP. Le CNED donne à chaque mission le même temps
  indicatif (4 h dans les PDF de mission) ; le volume de la SP se partage donc à parts
  égales entre elles.
- Les **6 h, 3 h et 1 h** annoncées pour E4, E5 et E6 sont les durées *d'épreuve*
  (« Type : Écrit, Coefficient 4 »), pas du temps de travail. Elles ne sont donc pas
  comptées comme telles.

Indicatif reste indicatif : c'est une moyenne, pas un rythme personnel. *Moi → Mon
travail* rend le programme modifiable pour corriger les heures qui ne collent pas.

## Développement local

```sh
cd web
python3 -m http.server 8000
```

Toutes les données vivent dans le navigateur qui ouvre la page : `localStorage`
(clé `repere.local.v1`) et IndexedDB (`repere-photos`). Les effacer depuis les outils
de développement remet l'application à neuf.
