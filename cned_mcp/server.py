"""
Serveur MCP CNED — streamable-http sur /mcp, proxy de connexion sur /login.

Le flux /login proxie le vrai parcours CNED :
  1. Affiche le formulaire ADFS de sts.cned.fr
  2. Soumet les identifiants côté serveur, capture les cookies
  3. Si ADFS retourne la page avec le bouton "Accéder", l'affiche
  4. Quand l'utilisateur clique "Accéder", le serveur finalise la session
"""

import os
import json
import logging
import re
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse
from starlette.routing import Route, Mount
from mcp.server.mcpserver import MCPServer

logging.basicConfig(level=logging.WARNING)

PORT = int(os.environ.get("PORT", "8000"))
USERNAME = os.environ.get("CNED_USER", "")
PASSWORD = os.environ.get("CNED_PASS", "")

BASE_CNED = "https://espaceinscrit.cned.fr"
ADFS_HOST = "https://sts.cned.fr"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

mcp = MCPServer("cned")
_client = None
# Session requests partagée pour le proxy (garde les cookies entre étapes)
_proxy_session: requests.Session | None = None


def _new_proxy_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def _get_client():
    global _client
    if _client is None:
        from .client import CNEDClient
        _client = CNEDClient()
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
def cned_mes_cours() -> str:
    """Liste les formations et cours disponibles dans l'espace inscrit CNED."""
    result = _get_client().get_courses()
    return _json(result) if result else "Aucun cours trouvé."


@mcp.tool()
def cned_mes_devoirs() -> str:
    """Liste les devoirs à rendre avec leurs dates limites et statuts."""
    result = _get_client().get_assignments()
    return _json(result) if result else "Aucun devoir trouvé."


@mcp.tool()
def cned_mes_messages() -> str:
    """Liste les messages et notifications reçus sur l'espace CNED."""
    result = _get_client().get_messages()
    return _json(result) if result else "Aucun message trouvé."


@mcp.tool()
def cned_mon_profil() -> str:
    """Récupère les informations du profil de l'élève CNED."""
    return _json(_get_client().get_profile())


@mcp.tool()
def cned_page(chemin: str) -> str:
    """Lit le contenu texte d'une page CNED (ex: /mes-cours, /mes-devoirs)."""
    return _get_client().get_page_raw(chemin)


@mcp.tool()
def cned_statut() -> str:
    """Vérifie si une session CNED est active."""
    from .auth import _load_session
    session = _load_session()
    if session:
        return f"Session active ({len(session)} cookies). Utilisez /login pour renouveler."
    return "Aucune session active. Connectez-vous sur /login."


@mcp.tool()
def cned_deconnexion() -> str:
    """Supprime la session CNED enregistrée."""
    from .auth import clear_session
    clear_session()
    _reset_client()
    return "Session supprimée."


# ------------------------------------------------------------------ #
#  Proxy de connexion                                                 #
# ------------------------------------------------------------------ #

def _rewrite_html(html: str, base_url: str) -> str:
    """Adapte le HTML ADFS pour qu'il fonctionne via notre proxy."""
    soup = BeautifulSoup(html, "html.parser")

    # Supprimer les scripts qui pourraient gêner (auto-submit JS)
    for script in soup.find_all("script"):
        script.decompose()

    # Modifier l'action du formulaire pour pointer vers notre proxy
    for form in soup.find_all("form"):
        action = form.get("action", "")
        if not action or action == "#":
            form["action"] = "/login/submit"
        elif action.startswith("/adfs"):
            form["action"] = "/login/submit"
        form["method"] = "post"

    # Ajouter un style simple si la page est trop brute
    head = soup.find("head")
    if head:
        style = soup.new_tag("style")
        style.string = """
        body { font-family: system-ui, sans-serif; }
        #loginForm { max-width: 400px; margin: 40px auto; padding: 2rem;
                     background: #fff; border-radius: 12px;
                     box-shadow: 0 4px 20px rgba(0,0,0,.1); }
        """
        head.append(style)

    return str(soup)


async def login_get(request: Request) -> HTMLResponse:
    """Étape 1 : afficher le formulaire ADFS proxié."""
    global _proxy_session
    _proxy_session = _new_proxy_session()
    try:
        r = _proxy_session.get(BASE_CNED, timeout=20)
        html = _rewrite_html(r.text, r.url)
        return HTMLResponse(html)
    except Exception as e:
        return HTMLResponse(f"<p>Erreur lors du chargement : {e}</p>", status_code=500)


async def login_submit(request: Request) -> HTMLResponse:
    """Étape 2 : soumettre les identifiants, afficher la suite (wresult ou erreur)."""
    global _proxy_session
    if _proxy_session is None:
        _proxy_session = _new_proxy_session()
        _proxy_session.get(BASE_CNED, timeout=20)

    form = await request.form()
    data = dict(form)

    # Construire l'URL de soumission ADFS
    try:
        # Récupérer la page de login pour avoir l'action exacte
        r0 = _proxy_session.get(BASE_CNED, timeout=20)
        soup0 = BeautifulSoup(r0.text, "html.parser")
        login_form = soup0.find("form", id="loginForm") or soup0.find("form")
        action = login_form.get("action", "") if login_form else ""
        parsed = urlparse(r0.url)
        if action.startswith("/"):
            submit_url = f"{parsed.scheme}://{parsed.netloc}{action}"
        elif action.startswith("http"):
            submit_url = action
        else:
            submit_url = r0.url

        # Ajouter les champs manquants du formulaire original
        for inp in (login_form.find_all("input") if login_form else []):
            n = inp.get("name")
            if n and n not in data:
                data[n] = inp.get("value", "")

        r = _proxy_session.post(submit_url, data=data, timeout=30, allow_redirects=True)
        soup = BeautifulSoup(r.text, "html.parser")

        # Vérifier erreur de connexion
        error_el = soup.find(id="errorText") or soup.find(class_="errorText")
        if error_el and error_el.get_text(strip=True):
            html = _rewrite_html(r.text, r.url)
            return HTMLResponse(html)

        # Étape 3 : si on a un wresult, montrer le bouton "Accéder"
        wresult_input = soup.find("input", {"name": "wresult"})
        if wresult_input:
            # Réécrire le formulaire wresult pour pointer vers /login/acceder
            for form in soup.find_all("form"):
                form["action"] = "/login/acceder"
                form["method"] = "post"
            # Supprimer les auto-submits JS
            for s in soup.find_all("script"):
                s.decompose()
            # Ajouter un vrai bouton visible si pas déjà présent
            submit_btn = soup.find("input", {"type": "submit"}) or soup.find("button", {"type": "submit"})
            if not submit_btn:
                form_el = soup.find("form")
                if form_el:
                    btn = soup.new_tag("button", type="submit")
                    btn.string = "▶ Accéder à mon espace CNED"
                    btn["style"] = (
                        "display:block;width:100%;padding:1rem;margin-top:1rem;"
                        "background:#4f46e5;color:#fff;border:none;border-radius:8px;"
                        "font-size:1.1rem;cursor:pointer;"
                    )
                    form_el.append(btn)
            return HTMLResponse(str(soup))

        # Sinon, connexion directe réussie (pas de wresult intermédiaire)
        cookies = [
            {"name": c.name, "value": c.value, "domain": c.domain, "path": c.path}
            for c in _proxy_session.cookies
        ]
        from .auth import _save_session
        _save_session(cookies)
        _reset_client()
        return HTMLResponse(_success_page())

    except Exception as e:
        return HTMLResponse(f"<p>Erreur : {e}</p>", status_code=500)


async def login_acceder(request: Request) -> HTMLResponse:
    """Étape 3 : finaliser la connexion (soumettre le wresult à espaceinscrit)."""
    global _proxy_session
    if _proxy_session is None:
        return RedirectResponse("/login")

    form = await request.form()
    data = dict(form)

    try:
        r = _proxy_session.post(BASE_CNED, data=data, timeout=30, allow_redirects=True)
        # Sauvegarder les cookies de la session finale
        cookies = [
            {"name": c.name, "value": c.value, "domain": c.domain, "path": c.path}
            for c in _proxy_session.cookies
        ]
        from .auth import _save_session
        _save_session(cookies)
        _reset_client()
        return HTMLResponse(_success_page())
    except Exception as e:
        return HTMLResponse(f"<p>Erreur lors de la validation : {e}</p>", status_code=500)


def _success_page() -> str:
    return """<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecté — CNED</title>
<style>
body{font-family:system-ui,sans-serif;background:#f0f4f8;display:flex;
     align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:12px;padding:2.5rem;max-width:380px;
      text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
.icon{font-size:3rem;margin-bottom:1rem}
h1{color:#166534;margin:0 0 .5rem}
p{color:#555;margin:.5rem 0}
</style></head>
<body><div class="card">
  <div class="icon">✅</div>
  <h1>Connecté !</h1>
  <p>La session CNED est sauvegardée.</p>
  <p>Claude peut maintenant accéder à votre espace inscrit.</p>
</div></body></html>"""


# ------------------------------------------------------------------ #
#  Application Starlette                                              #
# ------------------------------------------------------------------ #

def build_app():
    mcp_app = mcp.streamable_http_app(streamable_http_path="/mcp")
    routes = [
        Route("/login",         login_get,     methods=["GET"]),
        Route("/login/submit",  login_submit,  methods=["POST"]),
        Route("/login/acceder", login_acceder, methods=["POST"]),
        Mount("/", app=mcp_app),
    ]
    return Starlette(routes=routes)


if __name__ == "__main__":
    import uvicorn
    app = build_app()
    uvicorn.run(app, host="0.0.0.0", port=PORT)
