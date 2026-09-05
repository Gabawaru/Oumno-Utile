"""
Serveur MCP CNED — supporte stdio (local) et SSE/HTTP (Railway/cloud).

Lancement local :
    CNED_USER=xxx CNED_PASS=yyy python -m cned_mcp.server

Lancement cloud (Railway) :
    TRANSPORT=sse PORT=8000 CNED_USER=xxx CNED_PASS=yyy python -m cned_mcp.server
"""

import os
import json
import logging
from mcp.server.mcpserver import MCPServer

logging.basicConfig(level=logging.WARNING)

USERNAME = os.environ.get("CNED_USER", "")
PASSWORD = os.environ.get("CNED_PASS", "")
TRANSPORT = os.environ.get("TRANSPORT", "stdio")
PORT = int(os.environ.get("PORT", "8000"))

mcp = MCPServer("cned")
_client = None


def _get_client():
    global _client
    if _client is None:
        from .client import CNEDClient
        _client = CNEDClient(USERNAME, PASSWORD)
    return _client


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------ #
#  Outils exposés                                                     #
# ------------------------------------------------------------------ #

@mcp.tool()
def cned_connexion(username: str = "", password: str = "") -> str:
    """Se connecte au CNED et vérifie que la session est active."""
    user = username or USERNAME
    pwd = password or PASSWORD
    if not user or not pwd:
        return "Erreur : username et password requis."
    from .auth import login
    login(user, pwd)
    return "Connexion réussie. Session sauvegardée."


@mcp.tool()
def cned_mes_cours() -> str:
    """Liste les formations et cours disponibles dans l'espace inscrit CNED."""
    result = _get_client().get_courses()
    if not result:
        return "Aucun cours trouvé (la page a peut-être une structure différente)."
    return _json(result)


@mcp.tool()
def cned_mes_devoirs() -> str:
    """Liste les devoirs à rendre avec leurs dates limites et statuts."""
    result = _get_client().get_assignments()
    if not result:
        return "Aucun devoir trouvé."
    return _json(result)


@mcp.tool()
def cned_mes_messages() -> str:
    """Liste les messages et notifications reçus sur l'espace CNED."""
    result = _get_client().get_messages()
    if not result:
        return "Aucun message trouvé."
    return _json(result)


@mcp.tool()
def cned_mon_profil() -> str:
    """Récupère les informations du profil de l'élève CNED."""
    return _json(_get_client().get_profile())


@mcp.tool()
def cned_page(chemin: str) -> str:
    """
    Lit le contenu texte d'une page de l'espace CNED.
    Exemples : /mes-cours, /mes-devoirs, /mes-messages, /mon-profil
    """
    return _get_client().get_page_raw(chemin)


@mcp.tool()
def cned_deconnexion() -> str:
    """Supprime la session CNED enregistrée localement."""
    from .auth import clear_session
    global _client
    clear_session()
    _client = None
    return "Session supprimée."


# ------------------------------------------------------------------ #
#  Point d'entrée                                                     #
# ------------------------------------------------------------------ #

if __name__ == "__main__":
    if TRANSPORT == "sse":
        mcp.run(transport="sse", host="0.0.0.0", port=PORT)
    elif TRANSPORT == "streamable-http":
        mcp.run(transport="streamable-http", host="0.0.0.0", port=PORT)
    else:
        mcp.run(transport="stdio")
