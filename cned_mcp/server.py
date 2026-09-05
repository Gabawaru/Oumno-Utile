"""
Serveur MCP CNED — supporte streamable-http (Railway/cloud).

Page de connexion : https://<domaine>/login
Endpoint MCP     : https://<domaine>/mcp
"""

import os
import json
import logging
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route, Mount
from mcp.server.mcpserver import MCPServer

logging.basicConfig(level=logging.WARNING)

USERNAME = os.environ.get("CNED_USER", "")
PASSWORD = os.environ.get("CNED_PASS", "")
PORT = int(os.environ.get("PORT", "8000"))

mcp = MCPServer("cned")
_client = None


def _get_client():
    global _client
    if _client is None:
        from .client import CNEDClient
        _client = CNEDClient(USERNAME, PASSWORD)
    return _client


def _reset_client():
    global _client
    _client = None


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------ #
#  Outils MCP                                                         #
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
    _reset_client()
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
    clear_session()
    _reset_client()
    return "Session supprimée."


# ------------------------------------------------------------------ #
#  Page de connexion web                                              #
# ------------------------------------------------------------------ #

LOGIN_HTML = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion CNED</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f0f4f8;display:flex;
       align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:12px;padding:2rem;width:100%;
        max-width:360px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
  h1{margin:0 0 1.5rem;font-size:1.3rem;color:#1a1a2e;text-align:center}
  label{display:block;font-size:.85rem;color:#555;margin-bottom:.25rem}
  input{width:100%;box-sizing:border-box;padding:.65rem .8rem;
        border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:1rem}
  input:focus{outline:none;border-color:#4f46e5}
  button{width:100%;padding:.75rem;background:#4f46e5;color:#fff;
         border:none;border-radius:8px;font-size:1rem;cursor:pointer}
  button:hover{background:#4338ca}
  .msg{margin-top:1rem;padding:.75rem;border-radius:8px;font-size:.9rem;text-align:center}
  .ok{background:#dcfce7;color:#166534}
  .err{background:#fee2e2;color:#991b1b}
  .logo{text-align:center;margin-bottom:1.2rem;font-size:2rem}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🎓</div>
  <h1>Connexion à l'espace CNED</h1>
  {message}
  <form method="post" action="/login">
    <label>Adresse email CNED</label>
    <input type="email" name="username" placeholder="xyz@example.com" required autocomplete="email">
    <label>Mot de passe</label>
    <input type="password" name="password" required autocomplete="current-password">
    <button type="submit">Se connecter</button>
  </form>
</div>
</body>
</html>"""


async def login_get(request: Request) -> HTMLResponse:
    from .auth import _load_session
    if _load_session():
        msg = '<div class="msg ok">✅ Session active — vous êtes connecté au CNED.</div>'
    else:
        msg = ""
    return HTMLResponse(LOGIN_HTML.format(message=msg))


async def login_post(request: Request) -> HTMLResponse:
    form = await request.form()
    username = str(form.get("username", "")).strip()
    password = str(form.get("password", "")).strip()
    if not username or not password:
        msg = '<div class="msg err">❌ Identifiant et mot de passe requis.</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg))
    try:
        from .auth import login as do_login
        do_login(username, password)
        _reset_client()
        msg = '<div class="msg ok">✅ Connexion réussie ! Claude peut maintenant accéder à votre espace CNED.</div>'
    except ValueError as e:
        msg = f'<div class="msg err">❌ {e}</div>'
    except Exception as e:
        msg = f'<div class="msg err">❌ Erreur inattendue : {e}</div>'
    return HTMLResponse(LOGIN_HTML.format(message=msg))


# ------------------------------------------------------------------ #
#  Application Starlette combinée (login + MCP)                       #
# ------------------------------------------------------------------ #

def build_app():
    mcp_app = mcp.streamable_http_app(streamable_http_path="/mcp")

    routes = [
        Route("/login", login_get, methods=["GET"]),
        Route("/login", login_post, methods=["POST"]),
        Mount("/", app=mcp_app),
    ]
    return Starlette(routes=routes)


if __name__ == "__main__":
    import uvicorn
    app = build_app()
    uvicorn.run(app, host="0.0.0.0", port=PORT)
