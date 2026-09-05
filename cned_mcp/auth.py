"""
Authentification CNED via requests (flux WS-Federation/ADFS).
Gère le POST des identifiants et le renvoi du token SAML (wresult).
"""

import json
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://eformation.cned.fr"
SESSION_FILE = Path.home() / ".cned_session.json"
SESSION_TTL = 3600 * 4  # 4 heures

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
}


def _save_session(cookies: list[dict]) -> None:
    SESSION_FILE.write_text(json.dumps({"cookies": cookies, "ts": time.time()}))
    SESSION_FILE.chmod(0o600)


def _load_session() -> list[dict] | None:
    if not SESSION_FILE.exists():
        return None
    data = json.loads(SESSION_FILE.read_text())
    if time.time() - data["ts"] > SESSION_TTL:
        SESSION_FILE.unlink(missing_ok=True)
        return None
    return data["cookies"]


def login(username: str, password: str) -> list[dict]:
    """
    Se connecte au CNED via requests (ADFS/WS-Federation).
    Retourne la liste des cookies de session.
    """
    s = requests.Session()
    s.headers.update(HEADERS)

    # 1. Accès → redirection ADFS
    r = s.get(BASE_URL, timeout=30)
    r.raise_for_status()
    login_url = r.url

    # 2. Parser le formulaire de login
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form", id="loginForm") or soup.find("form")
    if not form:
        raise ValueError("Formulaire de connexion ADFS introuvable.")

    action = form.get("action", "")
    from urllib.parse import urlparse
    parsed = urlparse(login_url)
    if action.startswith("/"):
        submit_url = f"{parsed.scheme}://{parsed.netloc}{action}"
    elif action.startswith("http"):
        submit_url = action
    else:
        submit_url = login_url

    # Collecter tous les champs du formulaire
    fields: dict[str, str] = {}
    for inp in form.find_all("input"):
        name = inp.get("name")
        value = inp.get("value", "")
        if name:
            fields[name] = value

    fields["UserName"] = username
    fields["Password"] = password
    fields["AuthMethod"] = "FormsAuthentication"
    fields["Kmsi"] = "true"

    # 3. POST des identifiants
    r2 = s.post(submit_url, data=fields, timeout=30)
    r2.raise_for_status()

    # Vérifier un message d'erreur explicite
    soup2 = BeautifulSoup(r2.text, "html.parser")
    error_el = soup2.find(id="errorText") or soup2.find(class_="errorText")
    if error_el and error_el.get_text(strip=True):
        raise ValueError(f"Erreur CNED : {error_el.get_text(strip=True)}")

    # 4. Soumettre le token de retour (SAMLResponse ou wresult) côté serveur
    postback_form = soup2.find("form")
    has_token = postback_form and (
        postback_form.find("input", {"name": "SAMLResponse"})
        or postback_form.find("input", {"name": "wresult"})
    )
    if has_token:
        postback: dict[str, str] = {}
        for inp in postback_form.find_all("input"):
            n = inp.get("name")
            v = inp.get("value", "")
            if n:
                postback[n] = v
        postback_url = postback_form.get("action", BASE_URL)
        r3 = s.post(postback_url, data=postback, timeout=30)
        r3.raise_for_status()
        final_url = r3.url
    else:
        final_url = r2.url

    # 5. Vérifier qu'on est bien sur le site cible
    if "sts.cned.fr" in final_url:
        raise ValueError(
            "Connexion échouée — identifiants incorrects ou service indisponible."
        )

    # 6. Sauvegarder les cookies sous forme sérialisable
    cookies = [
        {"name": c.name, "value": c.value, "domain": c.domain, "path": c.path}
        for c in s.cookies
    ]
    _save_session(cookies)
    return cookies


def get_session(username: str | None = None, password: str | None = None) -> list[dict]:
    cached = _load_session()
    if cached:
        return cached
    if not username or not password:
        raise ValueError(
            "Session expirée. Fournissez username et password, "
            "ou définissez CNED_USER / CNED_PASS."
        )
    return login(username, password)


def clear_session() -> None:
    SESSION_FILE.unlink(missing_ok=True)
