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

> **Piège rencontré, à ne pas refaire :** `CREATE OR REPLACE FUNCTION` **remet les
> droits à leur valeur par défaut**, c'est-à-dire `EXECUTE` pour `PUBLIC`. Toute
> recréation doit être suivie de son `REVOKE`. C'est ainsi que six fonctions se
> sont retrouvées ouvertes aux anonymes sans que rien ne le signale.

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

Trois règles, toutes appliquées par la base :

- **S'abonner** — `s_abonner()` lit `public` sur le profil visé et décide seule :
  acceptation immédiate chez un compte public, mise en attente chez un compte privé.
  Le navigateur ne choisit pas. Plafond de 50 demandes en attente par compte.
- **Lire un planning privé** exige un abonnement à l'état `accepte`. Une demande en
  attente ne donne rien — ni le planning, ni même la ligne du profil.
- **Demander un créneau** — `demander_creneau()` vérifie la joignabilité de l'hôte
  avant d'insérer. Masquer le bouton n'aurait rien empêché : l'API est ouverte à qui
  sait l'appeler. Plafond de 10 demandes en attente vers la même personne.

Éprouvé par bascule de rôle réelle, 14 vérifications sur 14 : un abonnement en attente
lit 0 ligne du planning et 0 du profil, une demande de créneau vers un compte
« abonnés seulement » est refusée tant que l'abonnement n'est pas accepté, et un tiers
ne lit aucune réservation qui ne le concerne pas.

**Pourquoi pas de messagerie libre.** Héberger des conversations privées entre comptes
ferait de l'éditeur — personne physique, non professionnelle — le responsable de leur
modération et de leur conservation. Les messages sont donc attachés aux demandes de
créneau : un motif et un mot, bornés à 500 caractères, entre deux personnes qui se
sont déjà acceptées. C'est l'essentiel de l'usage sans la charge.

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
| Renseigner l'adresse de contact | `aide.html`, `confidentialite.html` | gratuit |
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
