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
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse
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


LOGIN_HTML = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion — Espace inscrit CNED</title>
<style>
  *{{box-sizing:border-box}}
  body{{font-family:system-ui,sans-serif;background:#f5f5f5;
        display:flex;align-items:center;justify-content:center;
        min-height:100vh;margin:0;padding:1rem}}
  .card{{background:#fff;border-radius:8px;padding:2rem;width:100%;
         max-width:480px;box-shadow:0 2px 12px rgba(0,0,0,.12)}}
  .logo{{font-size:1.6rem;font-weight:800;color:#e8003d;letter-spacing:-1px;margin-bottom:1.5rem}}
  .logo span{{color:#000}}
  h1{{font-size:1.2rem;margin:0 0 .3rem;color:#222}}
  .sub{{color:#666;font-size:.85rem;margin:0 0 1rem;line-height:1.4}}
  label{{display:block;font-size:.85rem;color:#444;margin-bottom:.3rem;font-weight:500}}
  input[type=text],input[type=password],textarea{{width:100%;padding:.7rem .9rem;
    border:1px solid #ccc;border-radius:6px;font-size:.9rem;margin-bottom:1rem;
    background:#fafafa;font-family:inherit}}
  input:focus,textarea:focus{{outline:none;border-color:#e8003d;background:#fff}}
  button{{width:100%;padding:.8rem;background:#3c3c3c;color:#fff;
          border:none;border-radius:6px;font-size:1rem;cursor:pointer;font-weight:500}}
  button:hover{{background:#222}}
  .msg{{margin-bottom:1rem;padding:.75rem 1rem;border-radius:6px;font-size:.9rem}}
  .err{{background:#fff0f0;color:#c0392b;border:1px solid #f5c6c6}}
  .ok{{background:#f0faf4;color:#1a7a3f;border:1px solid #b7e4c7}}
  .hint{{font-size:.8rem;color:#888;margin-top:-.6rem;margin-bottom:.8rem}}
  .tabs{{display:flex;gap:.5rem;margin-bottom:1.5rem;border-bottom:2px solid #eee}}
  .tab{{padding:.5rem 1rem;cursor:pointer;font-size:.9rem;color:#666;border-bottom:2px solid transparent;margin-bottom:-2px}}
  .tab.active{{color:#e8003d;border-color:#e8003d;font-weight:600}}
  .panel{{display:none}}.panel.active{{display:block}}
  .steps{{background:#f8f8f8;border-radius:6px;padding:1rem;margin-bottom:1rem;font-size:.83rem;color:#444;line-height:1.7}}
  .steps code{{background:#e8e8e8;padding:.1rem .3rem;border-radius:3px;font-family:monospace}}
  textarea{{min-height:80px;resize:vertical}}
  .sep{{text-align:center;color:#999;font-size:.85rem;margin:.5rem 0}}
</style>
</head>
<body>
<div class="card">
  <div class="logo">CNED<span>.</span></div>
  <h1>Connexion à votre espace inscrit</h1>
  {message}
  <div class="tabs">
    <div class="tab active" onclick="show('pwd')">Identifiants</div>
    <div class="tab" onclick="show('cookie')">Via navigateur</div>
  </div>

  <div id="pwd" class="panel active">
    <p class="sub">Utilisez les identifiants reçus par courrier (format PRENOM.NOM).</p>
    <form method="post" action="/login/submit">
      <input type="hidden" name="method" value="password">
      <label>Nom d'utilisateur *</label>
      <input type="text" name="username" placeholder="ex : GABRIEL.CARBUNARU"
             value="{username}" required autocomplete="username">
      <p class="hint">Format : PRENOM.NOM en majuscules</p>
      <label>Mot de passe *</label>
      <input type="password" name="password" required autocomplete="current-password">
      <button type="submit">Se connecter</button>
    </form>
  </div>

  <div id="cookie" class="panel">
    <p class="sub">Si vous utilisez FranceConnect ou une autre méthode, connectez-vous d'abord sur le vrai site, puis importez vos cookies.</p>
    <div class="steps">
      <strong>Comment copier vos cookies :</strong><br>
      1. Connectez-vous sur <a href="https://espaceinscrit.cned.fr" target="_blank">espaceinscrit.cned.fr</a><br>
      2. Appuyez sur <strong>F12</strong> pour ouvrir les outils développeur<br>
      3. Allez dans <strong>Application</strong> → <strong>Cookies</strong> → <code>espaceinscrit.cned.fr</code><br>
      4. Dans la console, tapez : <code>document.cookie</code> et copiez le résultat<br>
      <em>OU</em> dans l'onglet Réseau, copiez la valeur de l'en-tête <code>Cookie:</code> d'une requête.
    </div>
    <form method="post" action="/login/submit">
      <input type="hidden" name="method" value="cookies">
      <label>Valeur des cookies (format <code>nom=valeur; nom2=valeur2</code>)</label>
      <textarea name="cookie_str" placeholder="ex: ARRAffinity=abc123; .ASPXAUTH=xyz..." required></textarea>
      <p class="hint">Le domaine <code>espaceinscrit.cned.fr</code> est utilisé automatiquement.</p>
      <button type="submit">Importer les cookies</button>
    </form>
  </div>
</div>
<script>
function show(tab) {{
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['pwd','cookie'][i]===tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab).classList.add('active');
}}
</script>
</body>
</html>"""


async def login_get(request: Request) -> HTMLResponse:
    from .auth import _load_session
    if _load_session():
        msg = '<div class="msg ok">✅ Session active — Claude est connecté à votre espace CNED.</div>'
    else:
        msg = ""
    return HTMLResponse(LOGIN_HTML.format(message=msg, username=""))


async def login_submit(request: Request) -> HTMLResponse:
    """Soumet les identifiants ou importe les cookies selon la méthode choisie."""
    global _proxy_session
    form = await request.form()
    method = str(form.get("method", "password"))

    if method == "cookies":
        return await _login_via_cookies(form)
    return await _login_via_password(form)


async def _login_via_cookies(form) -> HTMLResponse:
    """Importe les cookies collés depuis le navigateur."""
    cookie_str = str(form.get("cookie_str", "")).strip()
    if not cookie_str:
        msg = '<div class="msg err">❌ Collez vos cookies dans le champ.</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg, username=""))
    try:
        cookies = []
        for part in cookie_str.split(";"):
            part = part.strip()
            if "=" in part:
                name, _, value = part.partition("=")
                cookies.append({
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": "espaceinscrit.cned.fr",
                    "path": "/",
                })
        if not cookies:
            raise ValueError("Format invalide — attendu : nom=valeur; nom2=valeur2")
        from .auth import _save_session
        _save_session(cookies)
        _reset_client()
        return HTMLResponse(_success_page())
    except Exception as e:
        msg = f'<div class="msg err">❌ {e}</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg, username=""))


async def _login_via_password(form) -> HTMLResponse:
    """Soumet les identifiants au flux ADFS côté serveur."""
    global _proxy_session
    username = str(form.get("username", "")).strip().upper()
    password = str(form.get("password", "")).strip()

    if not username or not password:
        msg = '<div class="msg err">❌ Nom d\'utilisateur et mot de passe requis.</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg, username=username))

    try:
        _proxy_session = _new_proxy_session()

        # Étape 1 : charger la page → redirection ADFS
        r0 = _proxy_session.get(BASE_CNED, timeout=20)
        soup0 = BeautifulSoup(r0.text, "html.parser")
        login_form = soup0.find("form", id="loginForm") or soup0.find("form")
        if not login_form:
            raise ValueError("Formulaire ADFS introuvable.")

        action = login_form.get("action", "")
        parsed = urlparse(r0.url)
        if action.startswith("/"):
            submit_url = f"{parsed.scheme}://{parsed.netloc}{action}"
        elif action.startswith("http"):
            submit_url = action
        else:
            submit_url = r0.url

        # Collecter les champs du formulaire
        data: dict[str, str] = {}
        for inp in login_form.find_all("input"):
            n = inp.get("name")
            if n:
                data[n] = inp.get("value", "")
        data["UserName"] = username
        data["Password"] = password
        data["AuthMethod"] = "FormsAuthentication"
        data["Kmsi"] = "true"

        # Étape 2 : POST identifiants
        r1 = _proxy_session.post(submit_url, data=data, timeout=30)
        soup1 = BeautifulSoup(r1.text, "html.parser")

        # Vérifier erreur ADFS
        error_el = soup1.find(id="errorText") or soup1.find(class_="errorText")
        if error_el and error_el.get_text(strip=True):
            msg = f'<div class="msg err">❌ {error_el.get_text(strip=True)}</div>'
            return HTMLResponse(LOGIN_HTML.format(message=msg, username=username))

        # Étape 3 : wresult présent → POST-back vers espaceinscrit
        wresult_form = soup1.find("form")
        if wresult_form and wresult_form.find("input", {"name": "wresult"}):
            postback: dict[str, str] = {}
            for inp in wresult_form.find_all("input"):
                n = inp.get("name")
                if n:
                    postback[n] = inp.get("value", "")
            postback_url = wresult_form.get("action", BASE_CNED)
            r2 = _proxy_session.post(postback_url, data=postback, timeout=30)
            if "sts.cned.fr" in r2.url:
                raise ValueError(
                    "Connexion refusée par ADFS. Essayez la méthode 'Via navigateur'."
                )

        # Sauvegarder les cookies
        cookies = [
            {"name": c.name, "value": c.value, "domain": c.domain, "path": c.path}
            for c in _proxy_session.cookies
        ]
        if not cookies:
            raise ValueError(
                "Aucun cookie reçu. Essayez la méthode 'Via navigateur'."
            )
        from .auth import _save_session
        _save_session(cookies)
        _reset_client()
        return HTMLResponse(_success_page())

    except ValueError as e:
        msg = f'<div class="msg err">❌ {e}</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg, username=username))
    except Exception as e:
        msg = f'<div class="msg err">❌ Erreur inattendue : {e}</div>'
        return HTMLResponse(LOGIN_HTML.format(message=msg, username=username))


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
        Route("/login",        login_get,    methods=["GET"]),
        Route("/login/submit", login_submit, methods=["POST"]),
        Mount("/", app=mcp_app),
    ]
    return Starlette(routes=routes)


if __name__ == "__main__":
    import uvicorn
    app = build_app()
    uvicorn.run(app, host="0.0.0.0", port=PORT)
