#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-99}"
RESOLUTION="${RESOLUTION:-1920x1080x24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"

export DISPLAY=":${DISPLAY_NUM}"

echo "[entrypoint] Starting Xvfb on ${DISPLAY} (${RESOLUTION})..."
Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}" -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

# Wait until the display is ready
for i in $(seq 1 30); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    echo "[entrypoint] Xvfb is ready"
    break
  fi
  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "[entrypoint] Xvfb failed to start:" >&2
    cat /tmp/xvfb.log >&2
    exit 1
  fi
  sleep 0.2
done

echo "[entrypoint] Starting x11vnc (localhost only)..."
x11vnc \
  -display "${DISPLAY}" \
  -forever \
  -shared \
  -rfbport "${VNC_PORT}" \
  -localhost \
  -nopw \
  -xkb \
  -noxdamage \
  -ncache 10 \
  -ncache_cr \
  >/tmp/x11vnc.log 2>&1 &
X11VNC_PID=$!

echo "[entrypoint] Starting websockify + noVNC on 0.0.0.0:${NOVNC_PORT}..."
websockify \
  --web=/usr/share/novnc/ \
  0.0.0.0:"${NOVNC_PORT}" \
  localhost:"${VNC_PORT}" \
  >/tmp/websockify.log 2>&1 &
WEBSOCKIFY_PID=$!

cleanup() {
  echo "[entrypoint] Shutting down..."
  kill "${WEBSOCKIFY_PID}" "${X11VNC_PID}" "${XVFB_PID}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Give services a moment to bind
sleep 1

# Clean Chromium profile  locks (common after unclear container stop/volume reuse)
PROFILE_DIR="${CHROME_PROFILE_DIR:-/app/chrome_profile}"
if [ -d "${PROFILE_DIR}" ]; then
  echo "[entrypoint] Cleaning Chromium profile locks in ${PROFILE_DIR}..."
  rm -f "${PROFILE_DIR}/SingletonLock" \
        "${PROFILE_DIR}/SingletonSocket" \
        "${PROFILE_DIR}/SingletonCookie" \
        "${PROFILE_DIR}/lockfile" || true
fi

echo "[entrypoint] noVNC ready → http://<host>:${NOVNC_PORT}/vnc.html"
echo "[entrypoint] Launching application..."

# Replace the shell with the main process so signals are forwarded correctly
exec python -m pr_surf.main