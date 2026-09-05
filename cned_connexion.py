"""
Connexion automatique à l'espace inscrit CNED (espaceinscrit.cned.fr).
Utilise WS-Federation / ADFS via sts.cned.fr.

Usage :
    python cned_connexion.py --username <identifiant> --password <mdp>
    ou définir les variables d'environnement CNED_USER et CNED_PASS.
"""

import argparse
import os
import sys
import re
import requests
from urllib.parse import urljoin, urlparse, parse_qs, urlencode
from bs4 import BeautifulSoup

BASE_URL = "https://espaceinscrit.cned.fr"
ADFS_HOST = "https://sts.cned.fr"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}


def _get_form_fields(html: str, form_id: str | None = None) -> dict:
    """Extrait tous les champs d'un formulaire HTML."""
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form", id=form_id) if form_id else soup.find("form")
    if not form:
        raise ValueError("Formulaire introuvable dans la page.")
    fields = {}
    for inp in form.find_all("input"):
        name = inp.get("name")
        value = inp.get("value", "")
        if name:
            fields[name] = value
    return fields


def connexion(username: str, password: str, verbose: bool = False) -> requests.Session:
    """
    Se connecte à l'espace inscrit CNED et retourne la session authentifiée.

    Raises:
        RuntimeError: si la connexion échoue.
    """
    session = requests.Session()
    session.headers.update(HEADERS)

    # 1. Charger la page d'accueil → redirection vers ADFS
    if verbose:
        print(f"[*] Accès à {BASE_URL} …")
    r = session.get(BASE_URL, timeout=30)
    r.raise_for_status()

    # La page finale devrait être sur sts.cned.fr avec le formulaire ADFS
    login_url = r.url
    if verbose:
        print(f"[*] Page de connexion : {login_url}")

    if "sts.cned.fr" not in login_url and "adfs" not in login_url:
        # Chercher un lien de connexion explicite
        soup = BeautifulSoup(r.text, "html.parser")
        login_link = soup.find("a", href=re.compile(r"login|connexion|compte", re.I))
        if login_link:
            login_url = urljoin(r.url, login_link["href"])
            r = session.get(login_url, timeout=30)
            r.raise_for_status()
            login_url = r.url

    if verbose:
        print(f"[*] URL ADFS : {login_url}")

    # 2. Remplir le formulaire ADFS (UserName + Password + AuthMethod)
    try:
        fields = _get_form_fields(r.text, form_id="loginForm")
    except ValueError:
        fields = _get_form_fields(r.text)

    fields["UserName"] = username
    fields["Password"] = password
    fields.setdefault("AuthMethod", "FormsAuthentication")
    fields.setdefault("Kmsi", "true")   # "Rester connecté"

    # Déterminer l'URL de soumission du formulaire
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form", id="loginForm") or soup.find("form")
    action = form.get("action", "")
    if action.startswith("/"):
        parsed = urlparse(login_url)
        submit_url = f"{parsed.scheme}://{parsed.netloc}{action}"
    elif action.startswith("http"):
        submit_url = action
    else:
        submit_url = login_url

    if verbose:
        print(f"[*] Soumission vers : {submit_url}")

    # 3. POST des identifiants
    r2 = session.post(submit_url, data=fields, timeout=30)
    r2.raise_for_status()

    # 4. Traiter la réponse WS-Federation (WAResult / wresult POST-back)
    final_url = r2.url
    if verbose:
        print(f"[*] URL après login : {final_url}")

    # Si on a reçu une page avec un wresult (token SAML à renvoyer)
    soup2 = BeautifulSoup(r2.text, "html.parser")
    wresult_form = soup2.find("form")
    if wresult_form and wresult_form.find("input", {"name": "wresult"}):
        postback_fields = {}
        for inp in wresult_form.find_all("input"):
            n = inp.get("name")
            v = inp.get("value", "")
            if n:
                postback_fields[n] = v
        postback_url = wresult_form.get("action", BASE_URL)
        if verbose:
            print(f"[*] Token SAML reçu, renvoi vers {postback_url} …")
        r3 = session.post(postback_url, data=postback_fields, timeout=30)
        r3.raise_for_status()
        final_url = r3.url

    # 5. Vérification : sommes-nous connectés ?
    if _est_connecte(session, verbose):
        print(f"[+] Connexion réussie ! URL : {final_url}")
        return session
    else:
        raise RuntimeError(
            "Connexion échouée — vérifiez vos identifiants ou "
            "la disponibilité du service CNED."
        )


def _est_connecte(session: requests.Session, verbose: bool = False) -> bool:
    """Vérifie si la session est bien authentifiée."""
    r = session.get(BASE_URL, timeout=20)
    # Heuristiques : absence de formulaire de login, présence d'éléments utilisateur
    is_on_login = "sts.cned.fr" in r.url or "loginForm" in r.text
    has_user_content = re.search(
        r"(déconnect|mon profil|tableau de bord|bienvenue|espace inscrit)",
        r.text,
        re.IGNORECASE,
    )
    if verbose:
        print(f"[*] Vérification : sur login={is_on_login}, contenu user={bool(has_user_content)}")
    return not is_on_login or bool(has_user_content)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Connexion à l'espace inscrit CNED"
    )
    parser.add_argument(
        "--username", "-u",
        default=os.getenv("CNED_USER"),
        help="Identifiant CNED (ou var. env. CNED_USER)",
    )
    parser.add_argument(
        "--password", "-p",
        default=os.getenv("CNED_PASS"),
        help="Mot de passe CNED (ou var. env. CNED_PASS)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Afficher les étapes détaillées",
    )
    args = parser.parse_args()

    if not args.username or not args.password:
        parser.error(
            "Identifiant et mot de passe requis. "
            "Utilisez --username / --password ou CNED_USER / CNED_PASS."
        )

    try:
        session = connexion(args.username, args.password, verbose=args.verbose)
        # Exemple : afficher les cours disponibles
        r = session.get(f"{BASE_URL}/mes-cours", timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        titre = soup.find("h1")
        if titre:
            print(f"[+] Page principale : {titre.get_text(strip=True)}")
    except RuntimeError as e:
        print(f"[-] Erreur : {e}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as e:
        print(f"[-] Erreur réseau : {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
