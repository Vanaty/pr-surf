# PR.social Surf Bot

Bot de surf pour [pr.social](https://pr.social) utilisant l'extension Chrome officielle **PR.surf** (non empaquetée) via **Patchright**.

## Flow

```
Bot                                    Utilisateur
─────────────────────────────────────────────────────────
Lance Chrome + extension PR.surf
Ouvre le popup de l'extension
Clique [Pair] → reçoit code 8 chiffres
Affiche le code dans le terminal  ──→  Ouvre pr.social/tools?connect=CODE
                                        Entre le code → confirme
Détecte la liaison (poll auto)    ←──  Compte lié ✓
Clique [Start] dans le popup
Surf autonome (keep-alive)
```

## Structure du projet

```
pr-surf/
├── pyproject.toml             # Dépendances + script pr-surf
├── .env.example               # Modèle de configuration
├── chrome_profile/            # Profil Chrome persistant (session)
├── extensions/
│   └── pr-surf-ext-1.0.5/    # Extension non empaquetée
└── src/
    └── pr_surf/
        ├── __init__.py
        ├── main.py            # Point d'entrée
        ├── config.py          # Paramètres depuis .env
        ├── logger.py          # Loguru configuré
        ├── browser.py         # Contexte Patchright + --load-extension
        └── surfer.py          # Pairing → Start → Keep-alive
```

## Installation

### 1. Python ≥ 3.10 requis

### 2. Installer les dépendances

```bash
pip install -e .
```

### 3. Installer Chromium de Patchright

```bash
patchright install chromium
```

### 4. Docker

Le projet inclut un `Dockerfile` et un `docker-compose.yml` prêts à l’emploi.

#### Avec VNC / noVNC

Le conteneur lance un serveur Xvfb + VNC + noVNC, ce qui permet d’ouvrir l’interface Chrome depuis un navigateur web.

```bash
docker build -t pr-surf .
docker run --rm -it \
  -p 6080:6080 \
  -p 5900:5900 \
  -v "$PWD/chrome_profile:/app/chrome_profile" \
  -v "$PWD/extensions:/app/extensions" \
  pr-surf
```

Ou avec Docker Compose :

```bash
docker compose up --build
```

Ensuite, ouvre :

```text
http://localhost:6080/vnc.html?autoconnect=1&resize=remote&host=localhost
```

> Le conteneur lance Chromium via Xvfb, puis expose le bureau par VNC/noVNC pour que l’extension PR.surf reste visible dans un vrai contexte navigateur.

### 5. (Optionnel) Configurer `.env`

```bash
copy .env.example .env
```

```ini
# Délai accordé à l'utilisateur pour lier son compte (défaut 5 min)
PAIR_TIMEOUT_S=300

# Niveau de log
LOG_LEVEL=INFO
```

### 5. Lancer

```bash
pr-surf
# ou
python -m pr_surf.main
```

Le terminal affiche :

```
──────────────────────────────────────────────────────────
  ACTION REQUISE — Liez votre compte PR.social
──────────────────────────────────────────────────────────
  Code de connexion : 1234-5678
  Lien direct       : https://pr.social/tools?connect=12345678

  1. Ouvrez le lien ci-dessus dans votre navigateur
  2. Entrez le code  1234-5678  et confirmez.
  3. Le bot continuera automatiquement (délai max : 300 s).
──────────────────────────────────────────────────────────
```

Une fois votre compte lié, le bot clique **Start** et le surf commence.

## Configuration (`.env`)

| Variable | Défaut | Description |
|---|---|---|
| `CHROME_PROFILE_DIR` | `./chrome_profile` | Profil Chrome persistant |
| `PAIR_TIMEOUT_S` | `300` | Secondes max pour lier le compte |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |

## Notes

- La fenêtre Chrome **doit rester visible** — les extensions MV3 ne fonctionnent pas en mode headless.
- Lors du premier surf, Chrome peut afficher une boîte native de permission → cliquez **Autoriser**.
- Le profil `chrome_profile/` conserve la session Chrome entre les exécutions.
- Arrêtez avec **Ctrl-C**.
