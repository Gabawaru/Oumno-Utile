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
| `SUPABASE_KEY` | clé Supabase — **côté serveur uniquement**, jamais préfixée `NEXT_PUBLIC_` | oui |
| `OWNER_PASSCODE` | code qui ouvre le mode édition | oui |
| `AUTH_SECRET` | secret de signature du cookie de session (chaîne aléatoire longue) | oui |
| `RESEND_API_KEY` | clé [Resend](https://resend.com) pour l'envoi de courriel | non — sans elle, le cron ne fait rien |
| `MAIL_FROM` | expéditeur, ex. `Pilote CIEL <planning@mondomaine.fr>` | non |
| `PUBLIC_URL` | URL publique, reprise en pied de courriel | non |
| `CRON_SECRET` | posé par Vercel ; protège `/api/cron` des appels extérieurs | auto |

## Base de données

Tables `ciel_state`, `ciel_journal`, `ciel_subs` dans le projet Supabase existant.
RLS activé : lecture publique du planning et du journal, inscription publique à la
lettre d'information. Les écritures passent uniquement par les routes serveur, qui
vérifient le cookie propriétaire — la clé Supabase n'atteint jamais le navigateur.

## Développement local

```sh
cd web
python3 -m http.server 8000   # sert index.html ; les routes /api ne répondent pas
```

Pour exercer les routes, `vercel dev` avec les variables ci-dessus renseignées
dans un fichier `.env.local`.
