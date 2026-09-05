"""
Client HTTP CNED — effectue les requêtes avec la session authentifiée.
"""

import requests
from bs4 import BeautifulSoup
from .auth import get_session, clear_session, login

BASE_URL = "https://espaceinscrit.cned.fr"


class CNEDClient:
    def __init__(self, username: str | None = None, password: str | None = None):
        self._username = username
        self._password = password
        self._session = self._build_session()

    def _build_session(self) -> requests.Session:
        cookies = get_session(self._username, self._password)
        s = requests.Session()
        s.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "fr-FR,fr;q=0.9",
        })
        for c in cookies:
            s.cookies.set(c["name"], c["value"], domain=c.get("domain", ""))
        return s

    def _get(self, path: str, **kwargs) -> requests.Response:
        url = f"{BASE_URL}{path}" if path.startswith("/") else path
        r = self._session.get(url, timeout=20, **kwargs)
        # Si on est redirigé vers ADFS, la session a expiré
        if "sts.cned.fr" in r.url:
            clear_session()
            if self._username and self._password:
                login(self._username, self._password)
                self._session = self._build_session()
                r = self._session.get(url, timeout=20, **kwargs)
            else:
                raise RuntimeError("Session expirée. Reconnectez-vous.")
        r.raise_for_status()
        return r

    # ------------------------------------------------------------------ #
    #  Méthodes publiques                                                  #
    # ------------------------------------------------------------------ #

    def get_home(self) -> dict:
        """Récupère la page d'accueil et retourne les infos de base."""
        r = self._get("/")
        soup = BeautifulSoup(r.text, "html.parser")
        title = soup.find("h1") or soup.find("title")
        welcome = soup.find(class_=lambda c: c and "bienvenue" in c.lower()) if soup else None
        return {
            "url": r.url,
            "titre": title.get_text(strip=True) if title else "",
            "bienvenue": welcome.get_text(strip=True) if welcome else "",
            "connecte": "sts.cned.fr" not in r.url,
        }

    def get_courses(self) -> list[dict]:
        """Liste les formations/cours disponibles."""
        r = self._get("/mes-cours")
        soup = BeautifulSoup(r.text, "html.parser")
        courses = []
        # Sélecteurs génériques — à affiner selon le HTML réel
        for item in soup.select(".formation, .cours, .module, article, .card"):
            titre_el = item.find(["h2", "h3", "h4", ".titre", ".title"])
            lien_el = item.find("a", href=True)
            if titre_el:
                courses.append({
                    "titre": titre_el.get_text(strip=True),
                    "lien": lien_el["href"] if lien_el else "",
                })
        return courses

    def get_assignments(self) -> list[dict]:
        """Liste les devoirs à rendre."""
        r = self._get("/mes-devoirs")
        soup = BeautifulSoup(r.text, "html.parser")
        devoirs = []
        for item in soup.select(".devoir, .assignment, .travail, article, .card"):
            titre_el = item.find(["h2", "h3", "h4", ".titre"])
            date_el = item.find(class_=lambda c: c and "date" in c.lower() if c else False)
            statut_el = item.find(class_=lambda c: c and "statut" in c.lower() if c else False)
            if titre_el:
                devoirs.append({
                    "titre": titre_el.get_text(strip=True),
                    "date_limite": date_el.get_text(strip=True) if date_el else "",
                    "statut": statut_el.get_text(strip=True) if statut_el else "",
                })
        return devoirs

    def get_messages(self) -> list[dict]:
        """Liste les messages/notifications."""
        r = self._get("/mes-messages")
        soup = BeautifulSoup(r.text, "html.parser")
        messages = []
        for item in soup.select(".message, .notification, .msg, article"):
            sujet_el = item.find(["h3", "h4", ".sujet", ".subject"])
            date_el = item.find(class_=lambda c: c and "date" in c.lower() if c else False)
            if sujet_el:
                messages.append({
                    "sujet": sujet_el.get_text(strip=True),
                    "date": date_el.get_text(strip=True) if date_el else "",
                })
        return messages

    def get_profile(self) -> dict:
        """Récupère les informations du profil."""
        r = self._get("/mon-profil")
        soup = BeautifulSoup(r.text, "html.parser")
        infos = {}
        for label in soup.select("label, .label, dt"):
            val = label.find_next_sibling(["span", "dd", "input"])
            if label.get_text(strip=True) and val:
                infos[label.get_text(strip=True)] = val.get_text(strip=True)
        return infos

    def get_page_raw(self, path: str) -> str:
        """Récupère le texte brut d'une page CNED (chemin relatif ou URL complète)."""
        r = self._get(path)
        soup = BeautifulSoup(r.text, "html.parser")
        # Supprimer scripts et styles
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        main = soup.find("main") or soup.find(id="content") or soup.body
        return main.get_text(separator="\n", strip=True) if main else r.text
