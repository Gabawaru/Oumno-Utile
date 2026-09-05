"""
Client HTTP CNED — effectue les requêtes avec la session authentifiée.
"""

import requests
from bs4 import BeautifulSoup
from .auth import get_session, clear_session, login

BASE_URL = "https://eformation.cned.fr"


class CNEDClient:
    def __init__(self, username: str | None = None, password: str | None = None):
        self._username = username
        self._password = password
        self._session = self._build_session()
        if not self._session.cookies:
            raise RuntimeError(
                "Aucune session CNED active. Connectez-vous sur /login."
            )

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
        # Si on est redirigé vers ADFS (SAML ou WS-Fed), la session a expiré
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
        """Récupère le tableau de bord Moodle."""
        r = self._get("/my/")
        soup = BeautifulSoup(r.text, "html.parser")
        title = soup.find("h1") or soup.find("title")
        return {
            "url": r.url,
            "titre": title.get_text(strip=True) if title else "",
            "connecte": "sts.cned.fr" not in r.url and "eformation.cned.fr" in r.url,
        }

    def get_courses(self) -> list[dict]:
        """Liste les cours Moodle de l'utilisateur."""
        r = self._get("/my/courses.php")
        soup = BeautifulSoup(r.text, "html.parser")
        courses = []
        for item in soup.select(".coursebox, .course-listitem, [data-courseid]"):
            titre_el = item.find(["h3", "h4", ".coursename", ".multiline"])
            lien_el = item.find("a", href=True)
            if titre_el:
                courses.append({
                    "titre": titre_el.get_text(strip=True),
                    "lien": lien_el["href"] if lien_el else "",
                })
        # Fallback : liens de cours dans la page
        if not courses:
            for a in soup.select("a[href*='/course/view.php']"):
                txt = a.get_text(strip=True)
                if txt:
                    courses.append({"titre": txt, "lien": a["href"]})
        return courses

    def get_assignments(self) -> list[dict]:
        """Liste les devoirs via le calendrier Moodle."""
        r = self._get("/calendar/view.php?view=month")
        soup = BeautifulSoup(r.text, "html.parser")
        devoirs = []
        for item in soup.select(".event, [data-event-id]"):
            titre_el = item.find(["a", ".referevent", "h3"])
            date_el = item.find(class_=lambda c: c and "date" in c.lower() if c else False)
            if titre_el:
                devoirs.append({
                    "titre": titre_el.get_text(strip=True),
                    "date": date_el.get_text(strip=True) if date_el else "",
                })
        return devoirs

    def get_messages(self) -> list[dict]:
        """Liste les messages via la messagerie Moodle."""
        r = self._get("/message/index.php")
        soup = BeautifulSoup(r.text, "html.parser")
        messages = []
        for item in soup.select(".conversation, .message-body, [data-conversation-id]"):
            sujet_el = item.find(["a", "h5", ".fullname"])
            date_el = item.find(class_=lambda c: c and "date" in c.lower() if c else False)
            if sujet_el:
                messages.append({
                    "sujet": sujet_el.get_text(strip=True),
                    "date": date_el.get_text(strip=True) if date_el else "",
                })
        return messages

    def get_profile(self) -> dict:
        """Récupère le profil Moodle de l'utilisateur."""
        r = self._get("/user/profile.php")
        soup = BeautifulSoup(r.text, "html.parser")
        infos = {}
        for dl in soup.select("dl"):
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                k = dt.get_text(strip=True)
                v = dd.get_text(strip=True)
                if k:
                    infos[k] = v
        if not infos:
            for row in soup.select(".profile-node, .description"):
                label = row.find(class_="profilefield")
                val = row.find(class_="value")
                if label and val:
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
