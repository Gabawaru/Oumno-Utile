# Sécurité de Repère

Ce que l'application défend, comment, et ce qu'elle ne défend pas. Écrit pour être
relu et contesté : une défense qu'on ne peut pas vérifier n'en est pas une.

## Le principe

**Le navigateur n'est jamais cru sur parole.** Il parle directement à Supabase avec
une clé publique que n'importe qui peut lire dans le code source — c'est son usage
prévu. Toute la protection tient dans les politiques de sécurité au niveau des
lignes, évaluées par la base à chaque requête. Masquer un bouton ne protège rien ;
seule la base décide.

## Ce qui est en place

### Cloisonnement des données

| Donnée | Qui peut la lire |
|---|---|
| Profil et planning **public** | tout le monde, avec ou sans compte |
| Profil et planning **privé** | son propriétaire, et les comptes explicitement autorisés |
| **Vrai nom** | son propriétaire, et les seuls partages portant `voit_nom_reel` |
| Jetons d'invitation | personne — pas même leur créateur ; seule une fonction les consomme |
| Adresses des abonnés | le propriétaire du profil, et le cron |
| Mot de passe | personne : empreinte bcrypt, jamais stockée en clair |

Le vrai nom vit dans sa propre table `ciel_identites`. Les politiques portent sur
des **lignes**, pas sur des colonnes : le loger dans `ciel_profiles` l'aurait rendu
lisible par quiconque peut lire le profil. Cette séparation n'est pas cosmétique.

**Vérifié par bascule de rôle réelle**, pas par lecture du code : un visiteur
anonyme et un tiers connecté lisent 0 ligne d'un planning privé ; un invité en lit
1 et n'y écrit rien ; un invité sans droit au vrai nom lit 0 identité ; un invité
ne peut pas s'auto-accorder ce droit. Le retrait prend effet immédiatement.

### Surface d'API

Une seule fonction est appelable sans être connecté : `nom_disponible()`, qui doit
l'être puisqu'elle sert pendant l'inscription. Toutes les autres exigent une
session et revérifient `auth.uid()` en interne.

`prive.ciel_visible()` — le rouage interne des politiques — vit dans un schéma non
exposé par PostgREST. Tant qu'il était dans `public`, il était appelable en
`/rest/v1/rpc/` et permettait de sonder la visibilité d'un profil.

> **Piège rencontré deux fois, à ne pas refaire.** Une fonction nouvellement créée
> ou recréée repart avec `EXECUTE` ouvert. Et **`REVOKE ... FROM PUBLIC` ne suffit
> pas** : Supabase accorde `EXECUTE` à `anon` *explicitement*, par privilège par
> défaut sur le schéma `public`. Révoquer PUBLIC laisse cette concession intacte.
> Il faut nommer `anon`.
>
> Le remède est un bloc **rejouable**, à passer après chaque migration — il remet
> la matrice exacte quelles que soient les fonctions créées entre-temps :
>
> ```sql
> do $$
> declare f record; ouvertes text[] := array['nom_disponible'];
> begin
>   for f in select p.oid::regprocedure sig, p.proname nom from pg_proc p
>            join pg_namespace n on n.oid = p.pronamespace
>            where n.nspname = 'public' and p.prosecdef
>   loop
>     execute format('revoke all on function %s from public, anon, authenticated', f.sig);
>     if f.nom = any(ouvertes) then
>       execute format('grant execute on function %s to anon, authenticated', f.sig);
>     elsif f.nom <> 'ciel_nouveau_compte' then
>       execute format('grant execute on function %s to authenticated', f.sig);
>     end if;
>   end loop;
> end $$;
> ```
>
> Et `alter default privileges in schema public revoke execute on functions from
> anon;` pour que la prochaine ne reparte pas ouverte.

### Injection de code (XSS)

Trois barrières, chacune suffisante seule :

1. **Assainissement à la frontière** — `assainirProgramme()` contraint tout ce qui
   vient de la base avant le moindre gabarit HTML : identifiants sur
   `[A-Za-z0-9._-]{1,48}`, couleurs prises dans une liste fermée, libellés bornés
   en longueur et purgés des caractères de contrôle, heures et périodes ramenées
   dans leurs bornes. C'est nécessaire parce qu'un propriétaire peut écrire ce
   qu'il veut dans son propre planning — et que ce planning est **rendu chez les
   gens qui le consultent**.
2. **Échappement au point d'insertion** — `esc()` sur toute interpolation, y
   compris dans les attributs. Deux failles avaient été trouvées ici et
   reproduites avant correction : un `onload=` attaquant sortait de l'attribut
   `style` via la couleur d'une matière, et un `javascript:` passait dans le lien
   d'un événement.
3. **`Content-Security-Policy: script-src 'self'`** — aucun script inline ne
   s'exécute, aucune URL `javascript:` ne fonctionne, même si 1 et 2 échouent.
   Vérifié : une injection de `<script>` est bloquée par le navigateur.

Les liens saisis passent par `lienSur()`, qui n'accepte que `http:` et `https:`
après analyse par `URL` — pas par comparaison de chaîne, sinon `JaVaScRiPt:` et
`java\tscript:` passeraient.

### En-têtes HTTP

Posés dans `vercel.json`, sur toutes les routes :

| En-tête | Ce qu'il empêche |
|---|---|
| `Content-Security-Policy` | scripts injectés, `javascript:`, exfiltration vers un tiers |
| `Strict-Transport-Security` | rétrogradation vers HTTP, interception |
| `X-Content-Type-Options: nosniff` | un fichier interprété comme du script |
| `frame-ancestors 'none'` + `X-Frame-Options` | clickjacking |
| `Referrer-Policy: no-referrer` | fuite d'URL vers les sites tiers |
| `Cross-Origin-Opener-Policy` | prise de contrôle de la fenêtre ouvrante |
| `Permissions-Policy` | accès caméra, micro, position, capteurs |

`connect-src` n'autorise que ce domaine et le projet Supabase : même en cas
d'injection réussie, les données n'ont nulle part où partir.

### Comptes et sessions

- Mots de passe hachés en bcrypt par Supabase Auth, 8 caractères au minimum.
- Jetons de session à durée limitée, renouvelés automatiquement, effacés à la
  déconnexion.
- Jetons d'invitation : 122 bits d'aléa, 30 jours, 25 usages, 20 liens actifs par
  compte au plus. Ni devinables, ni moissonnables, ni infinis.
- Limitation de débit sur l'authentification : assurée par Supabase.
- Suppression de compte en cascade, sans copie résiduelle.

### Vie privée

Aucun cookie, aucune mesure d'audience, aucun traceur. Les polices sont servies
depuis le domaine : les charger chez Google transmettait l'adresse IP de chaque
visiteur à un tiers hors UE, sans base légale.

## La couche sociale

Toutes les règles ci-dessous sont appliquées par la base. L'interface les reflète ;
elle ne les décide pas.

### S'abonner, lire, proposer

- **S'abonner** — `s_abonner()` lit `public` sur le profil visé et décide seule :
  acceptation immédiate chez un compte public, mise en attente chez un compte privé.
  Le navigateur ne choisit pas. Plafond de 50 demandes en attente par compte.
- **Lire un planning privé** exige un abonnement à l'état `accepte`. Une demande en
  attente ne donne rien — ni le planning, ni même la ligne du profil.
- **Proposer un moment** — `proposer_creneau()` vérifie la joignabilité de l'hôte
  avant d'insérer, exige un motif quand l'expéditeur n'a pas le droit d'écrire, et
  plafonne à 2 propositions en attente dans ce cas (10 entre gens qui se parlent
  déjà). Masquer le bouton n'aurait rien empêché : l'API est ouverte à qui sait
  l'appeler.

### Publications et commentaires

`prive.lit_post(auteur, portee)` est la règle unique, appliquée par les politiques
de `ciel_posts`, `ciel_commentaires` et `ciel_jaime` :

- une publication **publique** suit la visibilité du profil — donc invisible si le
  profil est privé, même marquée « tout le monde » ;
- une publication **réservée** exige un abonnement accepté ;
- un **blocage** coupe dans les deux sens, quelle que soit la portée.

Commenter exige de pouvoir lire la publication commentée : la clause figure dans le
`with check` de la politique, pas seulement dans l'affichage. L'auteur d'une
publication peut supprimer les commentaires qui y figurent — il en répond.

Un déclencheur `BEFORE INSERT OR UPDATE` refuse une publication signée d'un autre
compte et une image qui ne vit pas dans le dossier de son auteur.

### Messages : la règle du seul mot

`envoyer_message()` refuse tout ce qui n'est pas :

1. un message vers quelqu'un dont la joignabilité vous inclut, ou
2. un message dans une conversation déjà **ouverte** — c'est-à-dire une conversation
   où l'autre a répondu, ou dont il a accepté la proposition.

Une conversation fermée n'accepte donc **rien**, sauf une proposition de moment, qui
porte un motif. C'est le modèle du compte privé : on ne peut adresser qu'une chose à
quelqu'un qui ne vous lit pas, et cette chose dit qui vous êtes. Trente messages par
cinq minutes au maximum, tous destinataires confondus.

Aucune politique `INSERT` n'existe sur `ciel_messages` : la seule écriture possible
passe par les deux fonctions. Une politique `DELETE` permet d'effacer ce qu'on a
écrit, jamais ce qu'on a reçu.

### Fichiers

Deux seaux, deux régimes.

- `avatars` est **public** : une vignette accompagne un pseudonyme, qui l'est déjà.
  C'est un choix, écrit dans la politique de confidentialité.
- `photos` ne l'est pas. Aucune adresse permanente n'existe ; chaque affichage
  réclame une adresse signée d'une heure, et la politique `SELECT` sur
  `storage.objects` ne la délivre que si une publication lisible porte ce fichier.

Le dépôt se fait en « upsert » : le service de stockage regarde d'abord si l'objet
existe, puis insère ou remplace. Il manquait donc deux politiques — une lecture sur
`avatars`, et une mise à jour sur les deux seaux. Sans elles, ce chemin échouait, et
remplacer une photo déjà posée était de toute façon impossible.

L'écriture est bornée au dossier `<uuid de l'utilisateur>/`, côté stockage comme côté
base : le déclencheur de `ciel_profiles` refuse un `avatar` qui pointerait ailleurs,
celui de `ciel_posts` en fait autant pour `image`. Sans lui, n'importe qui pourrait
faire afficher le fichier d'un autre — ou une adresse étrangère, ce que la politique
de sécurité du contenu interdit par ailleurs (`img-src` ne cite que ce domaine).

Les images sont redessinées dans un canevas avant l'envoi : format normalisé,
métadonnées EXIF perdues au passage — dont la position GPS. Ce n'est pas une mesure
de sécurité du serveur, c'est une mesure de vie privée de l'utilisateur, et elle est
plus efficace côté client qu'après coup.

### Atteindre quelqu'un sans le déshabiller

La politique de lecture de `ciel_profiles` masque **entièrement** un compte privé.
C'est juste pour le planning, et c'était une impasse pour tout le reste : une
personne qui vous suit n'apparaissait nulle part de cliquable, et un compte privé
qu'on connaît par son nom restait injoignable à jamais — aucune façon de lui
demander à le suivre.

`carte_profil(identifiant)` rend la carte d'identité minimale — pseudonyme,
identifiant, vignette, visibilité, joignabilité — plus l'état de la relation
(`lien`, `me_suit`, `peut_ecrire`). Les champs personnels — présentation, fuseau,
région — ne sortent **que** si le profil est public ou si l'abonnement est accepté.

Ce qui borne l'exposition :

- elle ne répond que sur un **identifiant exact**, jamais sur une liste ni un
  préfixe : elle ne sert pas à parcourir les comptes privés ;
- elle exige une session ;
- un blocage la fait rendre zéro ligne, dans les deux sens.

Ce qu'elle confirme — « cet identifiant est pris » — est déjà ce que révèle
`nom_disponible`, appelable sans compte parce que l'inscription en dépend. Le
gain de discrétion à s'en priver serait nul ; le coût était un réseau où personne
ne peut se joindre.

**Un piège de logique à trois valeurs y a vécu quelques minutes.** L'état de la
relation était `null` faute d'abonnement, et `false or null` vaut `null` en SQL,
pas `false` : la ligne entière disparaissait, y compris pour les comptes publics
qu'on avait le droit de voir. Chaque test est désormais ramené explicitement à un
booléen. C'est le genre de défaut qui ne lève aucune erreur et se lit comme une
absence de données.

### Le profil, écrit par son propriétaire

La politique `profiles_maj` autorise à écrire n'importe quelle colonne de sa propre
ligne. C'est trop large dès que des colonnes portent du sens : le déclencheur
`prive.ciel_profil_valide()` dit ce qu'une valeur a le droit de valoir — forme de
l'identifiant public, un changement par jour, avatar borné à son dossier, fuseau
vérifié contre `pg_timezone_names`, joignabilité dans l'énumération, et
`consentement_le` recopié depuis l'ancienne ligne pour qu'on ne puisse pas réécrire
la preuve de son propre consentement.

**L'adresse électronique ne sert plus à fabriquer l'identifiant public.** Elle le
faisait : `gabriel.carb.pro@gmail.com` donnait `gabriel-carb-pro`, publié dans l'URL
du profil, dans l'annuaire et sur chaque carte. C'était une fuite silencieuse, sans
message d'erreur ni page à ouvrir — le genre qu'on ne voit qu'en lisant le
déclencheur. L'identifiant vient désormais du pseudonyme choisi, et les comptes
existants ont été renommés.

### Surveiller quelqu'un sans le lui apprendre

La case « me prévenir quand il est libre » écrit une ligne dans `ciel_veilles`
(`qui`, `cible`). Deux questions se posaient.

**Qui peut lire la ligne ?** Seul `qui`. La cible ne sait pas qu'on la surveille, et
personne d'autre ne sait qui surveille qui : la politique de lecture est
`qui = auth.uid()`, sans exception, et il n'existe aucune fonction qui compte les
veilleurs d'un compte. C'était le choix à faire : dire à quelqu'un « trois personnes
attendent que tu sois libre » transforme une commodité en pression.

**Que donne la veille ?** Rien de plus que ce qui était déjà lisible. La veille ne
lit pas les plages libres elle-même : elle sert de filtre au-dessus de
`ciel_dispos`, dont les politiques décident déjà qui voit quoi. Surveiller un compte
privé auquel on n'est pas abonné produit zéro ligne — vérifié par bascule de rôle,
pas déduit du code. Une contrainte `qui <> cible` évite la veille sur soi-même, et la
clé primaire `(qui, cible)` rend la case idempotente.

`nouveautes()` réunit six sources sous l'identité de l'appelant, `marquer_nouveautes_vues()`
ne touche qu'une colonne de sa propre ligne de profil. Les deux sont `security definer`,
`search_path` figé, `REVOKE ... FROM PUBLIC, anon`.

**Ce que la pastille compte.** Messages, demandes d'abonnement, moments proposés et
leurs réponses — ce qui attend une réponse. Pas les publications ni les
disponibilités, qui sont montrées sans être comptées. Une pastille qui ne s'éteint
jamais cesse d'être lue, et une notification qu'on n'a plus envie d'ouvrir ne protège
plus rien.

### Ce que le réseau oblige

Héberger des publications, des images et des conversations fait de l'éditeur un
**hébergeur** au sens de l'article 6-I-2 de la LCEN. Il n'a pas d'obligation
générale de surveillance, mais il doit retirer promptement un contenu manifestement
illicite qui lui est signalé, et conserver de quoi identifier les auteurs.

En pratique : un bouton **Signaler** sur chaque publication et chaque profil, une
table `ciel_signalements` qu'aucune politique de lecture ne sert (elle se consulte
depuis la console, pas depuis l'API), un **blocage** réciproque à la main de chacun,
et une adresse de contact à publier — ce dernier point n'est plus reportable
maintenant que des tiers déposent du contenu.

**Ce que cela change par rapport à la version précédente.** La messagerie libre avait
été écartée ici même, au motif qu'elle transférait à une personne physique non
professionnelle la charge de modérer des conversations privées. Cette charge est
réelle et elle demeure ; le service l'assume désormais, à la demande de l'éditeur,
avec les contreparties ci-dessus. Le point à retenir : les messages ne sont **pas**
chiffrés de bout en bout — le serveur y a techniquement accès, et les conditions le
disent.

Éprouvé par bascule de rôle réelle : 8 vérifications sur la règle du seul mot,
9 sur la portée des publications et le blocage, 8 sur les garde-fous du profil,
en plus des 14 de la couche d'abonnement. Un visiteur sans compte lit les
publications publiques des profils publics, et rien d'autre.

## Ce qui n'est pas défendu

Le dire est plus utile que de prétendre le contraire.

- **Un lien d'invitation transmis à la mauvaise personne.** Le lien ne vérifie pas
  qui l'ouvre : c'est sa nature. Le contre-pouvoir est le retrait, immédiat.
- **Un compte dont le mot de passe fuit ailleurs.** Si quelqu'un réutilise un mot
  de passe compromis, rien ici ne le sait — sauf à activer la vérification contre
  HaveIBeenPwned (voir plus bas).
- **Un propriétaire malveillant envers ses propres invités.** Il peut écrire ce
  qu'il veut dans son planning ; les trois barrières XSS sont précisément là pour
  que cela reste sans effet.
- **Une inondation de faux comptes.** Rien n'empêche aujourd'hui un robot de créer
  des comptes en masse. Un CAPTCHA règle la question (voir plus bas).
- **Une perte de la base.** Sans sauvegarde, une erreur ou un incident efface les
  plannings de tout le monde. C'est le point le plus sérieux de cette liste.
- **Un contenu illicite entre son dépôt et son signalement.** Personne ne relit les
  publications avant qu'elles ne s'affichent, et la loi ne l'exige pas. La défense
  est le signalement, le blocage, et le fait qu'une publication ne dépasse jamais
  le cercle que son auteur a choisi.
- **Un contenu déjà vu.** Bloquer ou supprimer arrête la diffusion ; cela ne
  reprend pas ce qui a été lu ou enregistré par ceux qui y avaient accès.
- **Une image envoyée à qui de droit puis rediffusée.** L'adresse signée expire au
  bout d'une heure, mais le fichier téléchargé, lui, ne s'efface pas.
- **Le contenu des messages, vis-à-vis de l'éditeur.** Ils ne sont pas chiffrés de
  bout en bout ; l'accès au serveur donne accès aux messages. Les conditions le
  disent, plutôt que de laisser croire l'inverse.

## Anonymat de l'éditeur

Repère est édité **à titre non professionnel** : gratuit, sans publicité, sans
abonnement, sans aucune source de revenu. L'article 6 III 2° de la LCEN permet
alors de ne pas publier son identité — il suffit de l'avoir communiquée à
l'hébergeur, qui la conserve et ne la révèle qu'à l'autorité judiciaire.

Concrètement, les mentions légales publient l'identité des hébergeurs (Vercel et
Supabase) et **une adresse de contact**, rien de plus : ni état civil, ni adresse
postale, ni téléphone. Le RGPD n'en demande pas davantage — il exige un moyen de
contact pour exercer ses droits, pas une identité publique.

Ce régime tombe dès que le service devient professionnel : un paiement, une
publicité, un revenu quelconque, et l'identité complète doit être publiée.

Pour rester protégé : une **adresse dédiée** plutôt qu'une adresse personnelle,
et rien qui ressemble à une activité commerciale.

## À faire avant d'ouvrir au groupe

| Action | Où | Coût |
|---|---|---|
| Activer la vérification des mots de passe compromis | Supabase → Authentication → Password | gratuit |
| Activer un CAPTCHA à l'inscription (hCaptcha ou Turnstile) | Supabase → Authentication → Bot protection | gratuit |
| Renseigner l'URL du site dans les redirections | Supabase → Authentication → URL Configuration | gratuit |
| **Publier l'adresse de contact** — devenu obligatoire avec le contenu déposé par des tiers | `aide.html`, `confidentialite.html` | gratuit |
| **Sauvegardes de la base** | Supabase Pro | ~25 $/mois |
| Adresse de contact publiée | `aide.html`, `confidentialite.html` | gratuit |
| Pare-feu applicatif et mode anti-attaque | Vercel Pro | ~20 $/mois |

Les quatre premières lignes sont des cases à cocher et couvrent l'essentiel du
risque courant. La sauvegarde est la seule dépense que je recommande vraiment :
tout le reste se répare, des données perdues non.

## Comment vérifier soi-même

```sh
# Les en-têtes réellement servis
curl -sI https://pilote-ciel.vercel.app | grep -iE 'content-security|strict-transport|x-frame|referrer'

# Ce qu'un visiteur anonyme peut lire
curl -s "https://hnmeefndnckqkdjjbgwe.supabase.co/rest/v1/ciel_identites?select=*" \
  -H "apikey: sb_publishable_ciLHalsy_YvWIUbEbCnN2g_TZfT4aPU"     # doit renvoyer []
```

Dans Supabase, `get_advisors` liste les écarts après chaque changement de schéma.
Il a trouvé les deux erreurs de droits décrites plus haut : le passer après toute
migration n'est pas facultatif.

## Journal des audits

**9 septembre 2026 — centre de nouveautés et veilles.** Trois migrations, cinq
vérifications par bascule de rôle : rien n'attend sur un compte neuf ; une demande
d'abonnement reçue remonte bien comme telle ; une veille posée sur un compte dont on
ne voit pas les plages libres rend zéro ligne ; marquer comme vu n'éteint pas ce qui
attend encore une réponse. Les conseillers Supabase ne signalent rien de nouveau :
`nouveautes` et `marquer_nouveautes_vues` n'apparaissent que dans la liste attendue
des fonctions réservées aux comptes connectés. Vérifié depuis l'extérieur : 401 sans
session sur les deux.

**8 septembre 2026 — réseau social, et une fuite fermée.** L'identifiant public d'un
profil était fabriqué à partir de la partie gauche de l'adresse électronique. Il
apparaît dans l'URL du profil, dans l'annuaire et sur chaque carte : l'adresse de
chacun était donc à moitié publiée, sans que rien ne le signale. Le déclencheur a été
réécrit pour partir du pseudonyme choisi, et les comptes existants renommés.

Ajouté dans le même mouvement : publications, commentaires, mentions « j'aime »,
photos, conversations, signalement, blocage, classement volontaire, fuseau horaire,
région facultative et plages libres publiées. Vingt-cinq vérifications par bascule de
rôle, toutes passées. Deux fonctions du schéma `prive` avaient un `search_path`
mobile, signalées par les conseillers Supabase et corrigées. Reste ouvert, chez
l'hébergeur : la vérification des mots de passe compromis.

**7 septembre 2026 — couche sociale.** Six fonctions nouvellement créées se sont
retrouvées appelables sans session : le `REVOKE ... FROM PUBLIC` que je croyais
suffisant ne retire pas la concession explicite d'`anon`. Aucune n'était
exploitable — chacune vérifie `auth.uid()` — mais la défense en profondeur veut
qu'`anon` ne puisse pas les appeler du tout. Corrigé par le bloc rejouable
ci-dessus, et vérifié depuis l'extérieur : 401 sur toutes, sauf
`nom_disponible`.

**7 septembre 2026 — audit global.** Deux injections trouvées et refermées (lien
`javascript:` d'un événement, sortie d'attribut par la couleur d'une matière).
Deux erreurs de droits corrigées après passage des conseillers Supabase. Un bug
silencieux trouvé au passage : la copie locale sérialisait la *fonction* `etat`
au lieu de son résultat, et stockait la chaîne `"undefined"` — la sauvegarde de
secours annoncée dans la politique de confidentialité n'avait jamais fonctionné.
Réparée et branchée en repli quand la base ne répond pas.

Restent sans emploi après nettoyage : aucune fonction, aucun export, aucun
identifiant orphelin. Un seul champ manque encore dans les mentions légales :
l'adresse de contact.
