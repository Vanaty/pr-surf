FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src \
    DISPLAY=:99 \
    CHROME_PROFILE_DIR=/app/chrome_profile

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 5900 6080

COPY requirements.txt ./requirements.txt
COPY pyproject.toml ./pyproject.toml
COPY README.md ./README.md
COPY src/pr_surf ./pr_surf
COPY extensions ./extensions

RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    python -m patchright install --with-deps chromium

VOLUME ["/app/chrome_profile"]

CMD ["bash", "-lc", "Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 & x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -noxdamage >/dev/null 2>&1 & websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/dev/null 2>&1 & exec python -m pr_surf.main"]
