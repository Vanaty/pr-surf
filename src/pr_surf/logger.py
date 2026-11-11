"""
logger.py
─────────
Configure Loguru une seule fois pour tout le projet.
Importez `log` depuis ce module au lieu de `from loguru import logger`
directement — cela garantit un format et un niveau cohérents partout.
"""

from __future__ import annotations

import sys

from loguru import logger


def setup(level: str = "INFO") -> None:
    """Supprime le sink par défaut de Loguru et en ajoute un formaté."""
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        colorize=True,
        format=(
            "<green>{time:HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan> — "
            "<level>{message}</level>"
        ),
    )


# Alias public — `from pr_surf.logger import log`
log = logger
