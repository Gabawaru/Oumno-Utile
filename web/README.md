# Pilote CIEL 2A — application web

Planning du BTS CIEL 2<sup>e</sup> année : consultation publique, édition réservée,
lettre d'information automatique.

## Ce que fait l'application

- **Consultation libre** — n'importe qui ouvre l'URL et voit l'avancement, le calendrier,
  le diagramme de Gantt, la courbe de progression et le journal. Aucun compte requis.
- **Édition réservée** — un code personnel ouvre le mode édition : cocher les étapes,
  ajouter des événements, saisir les notes.
- **Horloge de Paris** — tous les calculs (retard, avance, échéances) utilisent
  `Europe/Paris`, quel que soit le fuseau du visiteur.
- **Lettre d'information** — inscription ouverte à tous ; un courriel quotidien part
  s'il y a du nouveau, et rappelle le 1<sup>er</sup> de chaque mois de rafraîchir le scan
  de l'espace CNED.

## Architecture

Pas de framework ni de dépendance npm : des fichiers statiques et des fonctions
serverless Node qui parlent à Supabase et Resend via `fetch`.

```
web/
├── index.html      interface complète (autonome)
├── api/
│   ├── _lib.js     accès Supabase, session propriétaire, envoi de courriel
│   ├── state.js    GET public · POST réservé
│   ├── login.js    ouverture / fermeture de session
│   ├── subscribe.js inscription publique · désinscription réservée
│   └── cron.js     tâche quotidienne (récapitulatif + rappel de scan)
└── vercel.json     planification du cron
```

## Variables d'environnement

À renseigner dans Vercel → Settings → Environment Variables.

| Variable | Rôle | Obligatoire |
|---|---|---|
| `SUPABASE_URL` | URL du projet Supabase | oui |
| `SUPABASE_KEY` | clé **anon** — lecture du planning et inscription à la lettre | oui |
| `SUPABASE_SERVICE_KEY` | clé **service_role** — seule habilitée à écrire. Sans elle le site reste consultable mais rien ne peut être modifié | oui pour éditer |
| `OWNER_PASSCODE` | code qui ouvre le mode édition | oui |
| `AUTH_SECRET` | secret de signature du cookie de session (chaîne aléatoire longue) | oui |
| `RESEND_API_KEY` | clé [Resend](https://resend.com) pour l'envoi de courriel | non — sans elle, le cron ne fait rien |
| `MAIL_FROM` | expéditeur, ex. `Pilote CIEL <planning@mondomaine.fr>` | non |
| `PUBLIC_URL` | URL publique, reprise en pied de courriel | non |
| `CRON_SECRET` | posé par Vercel ; protège `/api/cron` des appels extérieurs | auto |

## Base de données

Projet Supabase dédié **« CNED link »** (`hnmeefndnckqkdjjbgwe`, région `eu-west-3`,
Paris). Tables `ciel_state`, `ciel_journal`, `ciel_subs`.

Le dépôt étant public, la clé `anon` est traitée comme connue de tous. Les droits sont
répartis en conséquence.

| Rôle | Peut | Ne peut pas |
|---|---|---|
| `anon` | lire le planning et le journal, insérer une adresse d'abonné | écrire le planning, lire la liste des abonnés |
| `service_role` | tout | — |

Aucune policy `select` n'existe sur `ciel_subs` : les adresses ne sont pas
moissonnables, même en connaissant la clé publique. Les écritures passent par les
routes serveur, qui vérifient le cookie propriétaire puis utilisent
`SUPABASE_SERVICE_KEY`. Aucune clé n'atteint le navigateur.

## Développement local

```sh
cd web
python3 -m http.server 8000   # sert index.html ; les routes /api ne répondent pas
```

Le dépôt déclare le serveur MCP Supabase dans `.mcp.json` à la racine : ouvrir le
projet avec Claude Code donne directement accès à la base (`/mcp` pour
s'authentifier).

Pour exercer les routes, `vercel dev` avec les variables ci-dessus renseignées
dans un fichier `.env.local`.
