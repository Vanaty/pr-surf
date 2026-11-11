"""
main.py
───────
Point d'entrée du bot de surf PR.social.

Flow
────
1. Lance Chrome avec l'extension PR.surf chargée.
2. Affiche le code de jumelage dans le terminal.
3. Attend que l'utilisateur lie son compte sur pr.social.
4. Clique « Start » → surf autonome.
5. Reste en vie jusqu'à Ctrl-C.

Utilisation
───────────
  # Après `pip install -e .` :
  pr-surf

  # Ou directement :
  python -m pr_surf.main
"""

from __future__ import annotations

import sys

from patchright.sync_api import sync_playwright

from pr_surf import __version__
from pr_surf.browser import build_context
from pr_surf.config import settings
from pr_surf.logger import log, setup
from pr_surf.surfer import run_surf


def main() -> None:
    # ── 1. Initialiser le logging ──────────────────────────────────────────────
    setup(settings.log_level)
    log.info(f"PR.social Surf Bot v{__version__}")

    # ── 2. Lancer Chrome + extension PR.surf ──────────────────────────────────
    with sync_playwright() as pw:
        context = build_context(pw)

        try:
            # ── 3-7. Pairing + Start + Keep-alive ─────────────────────────────
            run_surf(context)

        except KeyboardInterrupt:
            log.info("Arrêt demandé par l'utilisateur.")
        except Exception as exc:
            log.exception(f"Erreur fatale : {exc}")
            sys.exit(1)
        finally:
            log.info("Fermeture du navigateur.")
            context.close()


if __name__ == "__main__":
    main()
