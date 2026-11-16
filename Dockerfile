FROM mcr.microsoft.com/playwright/python:v1.65.2-noble

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src \
    DISPLAY=:99 \
    CHROME_PROFILE_DIR=/app/chrome_profile \
    DEBIAN_FRONTEND=noninteractive

# Only the packages required for a virtual display + noVNC
RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        x11-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Application files
COPY requirements.txt pyproject.toml README.md ./
COPY src ./src
COPY extensions ./extensions
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m patchright install --with-deps chromium \
    && rm -rf /root/.cache /tmp/*

# Persistent Chrome profile
VOLUME ["/app/chrome_profile"]

EXPOSE 6080 5900

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]