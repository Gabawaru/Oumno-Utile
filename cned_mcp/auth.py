"""
Authentification CNED via Playwright.
Gère le flux WS-Federation/ADFS (JavaScript auto-submit inclus).
"""

import os
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext

BASE_URL = "https://espaceinscrit.cned.fr"
SESSION_FILE = Path.home() / ".cned_session.json"
SESSION_TTL = 3600 * 4  # 4 heures


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


def login(username: str, password: str, headless: bool = True) -> list[dict]:
    """
    Se connecte au CNED et retourne les cookies de session.
    Utilise Playwright pour gérer le flux ADFS complet (y compris JS).
    """
    browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")

    with sync_playwright() as p:
        launch_kwargs = {"headless": headless}
        if browsers_path:
            chromium_exe = Path(browsers_path) / "chromium" / "chrome-linux" / "chrome"
            if not chromium_exe.exists():
                # Chercher le bon chemin
                for exe in Path(browsers_path).rglob("chrome"):
                    chromium_exe = exe
                    break
            launch_kwargs["executable_path"] = str(chromium_exe)

        browser = p.chromium.launch(**launch_kwargs)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
        )
        page = context.new_page()

        # 1. Naviguer vers l'espace inscrit (redirection ADFS automatique)
        page.goto(BASE_URL, wait_until="networkidle", timeout=30000)

        # 2. Remplir et soumettre le formulaire ADFS
        page.wait_for_selector("#loginForm", timeout=15000)
        page.fill('input[name="UserName"]', username)
        page.fill('input[name="Password"]', password)
        page.click('input[type="submit"], button[type="submit"]', timeout=5000)

        # 3. Attendre la redirection vers espaceinscrit.cned.fr
        try:
            page.wait_for_url(f"{BASE_URL}/**", timeout=20000)
        except Exception:
            # Vérifier si on a un message d'erreur
            error_el = page.query_selector(".errorText, .error, #errorText")
            if error_el:
                raise ValueError(f"Erreur CNED : {error_el.inner_text().strip()}")
            raise ValueError("La connexion a échoué — vérifiez vos identifiants.")

        # 4. Collecter les cookies
        cookies = context.cookies()
        browser.close()

    _save_session(cookies)
    return cookies


def get_session(username: str | None = None, password: str | None = None) -> list[dict]:
    """
    Retourne une session valide (depuis le cache ou en se reconnectant).
    """
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
