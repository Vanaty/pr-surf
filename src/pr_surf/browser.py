"""
browser.py
──────────
Construit un contexte Patchright (Playwright furtif) avec l'extension
PR.surf non empaquetée chargée depuis le dossier ./extensions/.

Points clés
───────────
- ``launch_persistent_context`` est **obligatoire** pour charger des
  extensions Chrome dans Playwright / Patchright.
- headless=False car les extensions MV3 ne fonctionnent pas en mode
  headless standard (un service worker invisible ne tourne pas).
- Le profil persistant conserve la session et les préférences Chrome
  d'une exécution à l'autre.
"""

from __future__ import annotations

from patchright.sync_api import BrowserContext, Playwright

from pr_surf.config import settings
from pr_surf.logger import log


def build_context(pw: Playwright) -> BrowserContext:
    """
    Lance un contexte Chromium persistant avec l'extension PR.surf.

    Returns
    -------
    BrowserContext
        Contexte prêt à l'emploi.

    Raises
    ------
    FileNotFoundError
        Si le dossier de l'extension est introuvable.
    """
    ext_path = settings.extension_dir
    if not ext_path.is_dir():
        raise FileNotFoundError(
            f"Dossier de l'extension introuvable : {ext_path}\n"
            f"Vérifiez que extensions/pr-surf-ext-1.0.5/ existe dans le projet."
        )

    profile = str(settings.chrome_profile_dir)
    log.info(f"Profil Chrome        : {profile}")
    log.info(f"Extension PR.surf    : {ext_path}")

    context = pw.chromium.launch_persistent_context(
        user_data_dir=profile,
        headless=False,          # obligatoire avec les extensions MV3
        no_viewport=True,        # utilise la taille réelle de la fenêtre
        args=[
            # Charge l'extension non empaquetée
            f"--load-extension={ext_path}",
            f"--disable-extensions-except={ext_path}",
            # Ergonomie
            "--start-maximized",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-popup-blocking",
        ],
        permissions=["notifications"],
    )

    log.info("Contexte navigateur lancé.")
    return context
