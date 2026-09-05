# Connecteur MCP CNED

Permet à Claude de se connecter à ton espace inscrit CNED et d'accéder à tes cours, devoirs et messages.

## Prérequis

```bash
pip install mcp playwright requests beautifulsoup4
playwright install chromium
```

## Configuration dans Claude Code

Ajoute ceci dans `~/.claude/settings.json` (rubrique `mcpServers`) :

```json
{
  "mcpServers": {
    "cned": {
      "command": "python",
      "args": ["-m", "cned_mcp.server"],
      "cwd": "/chemin/vers/Oumno-Utile",
      "env": {
        "CNED_USER": "ton_identifiant_cned",
        "CNED_PASS": "ton_mot_de_passe_cned"
      }
    }
  }
}
```

> Remplace `/chemin/vers/Oumno-Utile` par le chemin réel du dossier cloné.

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `cned_connexion` | Se connecte et sauvegarde la session (4h) |
| `cned_mes_cours` | Liste les formations disponibles |
| `cned_mes_devoirs` | Liste les devoirs avec dates limites |
| `cned_mes_messages` | Liste les messages reçus |
| `cned_mon_profil` | Informations du profil élève |
| `cned_page` | Lit une page quelconque de l'espace CNED |
| `cned_deconnexion` | Supprime la session locale |

## Utilisation

Une fois configuré, redémarre Claude Code et utilise simplement :

> « Montre-moi mes cours CNED »  
> « Est-ce que j'ai des devoirs à rendre ? »  
> « Lis ma page /mes-messages »
