# Pilote CIEL 2A — application web

Plannings de révision partagés : consultation libre, comptes personnels,
replanification automatique et lettre d'information.

## Ce que fait l'application

- **Comptes** — chacun crée le sien (adresse + mot de passe). Une seule inscription
  par adresse, mot de passe oublié par courriel. L'identité est gérée par Supabase Auth.
- **Consultation libre** — les plannings publics s'ouvrent sans compte, en lecture seule,
  via `?profil=identifiant`. La page d'accueil liste les profils publics.
- **Horloge de Paris** — avance, retard et échéances se calculent sur `Europe/Paris`,
  quel que soit le fuseau du visiteur.
- **Planification par capacité** — tu déclares tes heures de travail disponibles par jour
  de semaine. Le planning répartit les étapes dans ces heures, échéance la plus proche
  d'abord. Une étape dont l'échéance est passée repart sur les premiers créneaux libres :
  le retard se rattrape tout seul.
- **Zone de tâche** — clique un jour : capacité, heures déjà prises, travail placé, reste.
  Ajoute un événement de 14 h à 17 h : l'application dit si ça rentre, et sinon combien
  d'heures de travail n'auraient plus de place, avec un bouton pour ajouter quand même
  et décaler le reste.
- **Remettre à plus tard** — pour une étape qui ne rentre nulle part, un bouton calcule
  la première date à laquelle elle tient et y repousse son échéance.
- **Lettre d'information** — inscription ouverte à tous sur un profil ; un courriel part
  quand il y a du nouveau, et rappelle le 1er du mois de rafraîchir le scan CNED.

## Architecture

Aucune dépendance npm, aucun script chargé depuis un CDN : tout est servi depuis le
même domaine, pour qu'un blocage réseau ne laisse jamais une page blanche.

```
web/
├── index.html          écrans d'authentification et application
├── app.js              logique de l'application
├── supa.js             client Supabase minimal (auth + requêtes)
├── planning.js         référentiel BTS CIEL 2A relevé sur eformation.cned.fr
├── planificateur.js    moteur de répartition des heures
├── api/cron.js         tâche quotidienne : récapitulatif aux abonnés
└── vercel.json         planification du cron
```

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
Tables `ciel_profiles`, `ciel_state`, `ciel_journal`, `ciel_subs`.

Le dépôt est public et la clé publiable circule dans le navigateur : c'est son usage
prévu. La protection repose entièrement sur les politiques de sécurité.

| Rôle | Peut | Ne peut pas |
|---|---|---|
| visiteur | lire les profils publics, leur planning et leur journal ; s'abonner à une lettre | écrire quoi que ce soit, lire un profil privé, lire la liste des abonnés |
| compte connecté | tout ce qui précède, plus écrire **son** planning | toucher au planning d'un autre |

Un déclencheur crée le profil et le planning vide à l'inscription, avec un identifiant
dérivé de l'adresse et dédoublonné.

## Réglages Supabase à vérifier

- **Authentication → Providers → Email** : confirmation d'adresse activée ou non, selon
  que tu veuilles une inscription immédiate ou vérifiée.
- **Authentication → URL Configuration** : ajouter l'URL du site aux redirections, sinon
  le lien de réinitialisation ne revient pas au bon endroit.
- **Authentication → Emails** : sans SMTP personnalisé, Supabase limite fortement le
  nombre de courriels. Pour un usage réel, brancher un expéditeur.

## Développement local

```sh
cd web
python3 -m http.server 8000
```

Le dépôt déclare le serveur MCP Supabase dans `.mcp.json` à la racine : ouvrir le
projet avec Claude Code donne accès à la base (`/mcp` pour s'authentifier).
