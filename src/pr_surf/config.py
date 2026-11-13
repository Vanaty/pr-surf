"""
config.py
─────────
Charge, valide et expose tous les paramètres d'exécution.
Les valeurs proviennent de variables d'environnement (avec support .env).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Racine du projet : deux niveaux au-dessus de src/pr_surf/config.py
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Charge .env sans écraser les variables déjà présentes dans le shell
load_dotenv(_PROJECT_ROOT / ".env", override=False)


def _optional_path(key: str, default: Path) -> Path:
    """Retourne un Path depuis la variable *key*, avec repli sur *default*."""
    raw = os.getenv(key, "").strip()
    if raw:
        p = Path(raw)
        if not p.exists():
            raise FileNotFoundError(
                f"[config] '{key}' pointe vers un chemin inexistant : {p}"
            )
        return p
    default.mkdir(parents=True, exist_ok=True)
    return default


@dataclass(frozen=True)
class Config:
    """Configuration immuable résolue une seule fois au démarrage."""

    # Navigateur
    chrome_profile_dir: Path = field(
        default_factory=lambda: _optional_path(
            "CHROME_PROFILE_DIR",
            default=_PROJECT_ROOT / "chrome_profile",
        )
    )


    # Logging
    log_level: str = field(
        default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper()
    )

    # Chemin de l'extension non empaquetée
    extension_dir: Path = field(
        default_factory=lambda: _PROJECT_ROOT / "extensions" / "pr-surf-ext-1.0.5"
    )

    # Délai maximum (secondes) pour que l'utilisateur lie son compte
    pair_timeout_s: int = field(
        default_factory=lambda: int(os.getenv("PAIR_TIMEOUT_S", "300"))
    )

    # Proxy
    http_proxy: str = field(
        default_factory=lambda: os.getenv("HTTP_PROXY", "")
    )
    
    http_proxy_username: str|None = field(
        default_factory=lambda: os.getenv("HTTP_PROXY_USERNAME", None)
    )
    http_proxy_password: str|None = field(
        default_factory=lambda: os.getenv("HTTP_PROXY_PASSWORD", None)
    )

# Singleton — importez `settings` partout.
settings = Config()
