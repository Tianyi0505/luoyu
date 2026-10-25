#!/usr/bin/env bash
#
# Container entrypoint for the Luoyu DeepSeek Harness deployment.
#
#  1. seed $DSH_HOME once (profile manifest + settings) from the image
#  2. link the plugin into the profile, so `dsh` resolves it as a bundle layer
#  3. start Xvfb, because the QQ client NapCat drives is an Electron app
#  4. bind `dsh --profile web` to this container's own IP, so the published
#     port (`ports: 3090:3080`) reaches it — dsh refuses wildcard binds, and a
#     loopback bind would not be reachable through the port publish at all
#
set -euo pipefail

SEED_HOME=${DSH_SEED_HOME:-/opt/dsh-home-seed}
PLUGIN_DIR=${LUOYU_PLUGIN_DIR:-/opt/dsh-luoyu}
DSH_HOME=${DSH_HOME:-/dsh-home}
WORKSPACE=${LUOYU_WORKSPACE_DIR:-/workspace}
INTERNAL_PORT=${DSH_WEB_PORT:-3080}
export DSH_HOME

log() { printf '[luoyu] %s\n' "$*"; }

# --- 1. persistent home -----------------------------------------------------
mkdir -p "$DSH_HOME"
if [ ! -f "$DSH_HOME/profiles/web/package.json" ]; then
  log "seeding $DSH_HOME from $SEED_HOME"
  cp -a "$SEED_HOME/profiles" "$DSH_HOME"/
  if [ -f "$SEED_HOME/settings.yaml" ]; then
    cp -a -n "$SEED_HOME/settings.yaml" "$DSH_HOME"/settings.yaml
  fi
fi

# --- 2. plugin wiring -------------------------------------------------------
mkdir -p "$DSH_HOME/profiles/web/node_modules"
ln -sfn "$PLUGIN_DIR" "$DSH_HOME/profiles/web/node_modules/dsh-luoyu"

if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ ! -s "$DSH_HOME/.credentials.yaml" ]; then
  log "warning: DEEPSEEK_API_KEY is not set and $DSH_HOME/.credentials.yaml is empty — model calls will fail"
fi

# --- 3. workspace -----------------------------------------------------------
mkdir -p "$WORKSPACE"

# A QQ client extracted into the volume (see install-qq.sh) is linked back to
# /opt/QQ, which is where NapCat and the plugin look for it.
if [ -d "$DSH_HOME/qq/opt/QQ" ]; then
  ln -sfn "$DSH_HOME/qq/opt/QQ" /opt/QQ
  log "QQ client: $DSH_HOME/qq/opt/QQ (linked to /opt/QQ)"
fi

# --- 4. display server for the QQ client ------------------------------------
if [ "${LUOYU_XVFB:-1}" != "0" ]; then
  if [ ! -S /tmp/.X11-unix/X99 ]; then
    log "starting Xvfb :99"
    Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
    for _ in $(seq 1 50); do
      [ -S /tmp/.X11-unix/X99 ] && break
      sleep 0.1
    done
  fi
  export DISPLAY=:99
fi

# --- 5. bind to the container's own interface -------------------------------
# Docker's `ports: 3090:3080` forwards to <container-ip>:3080, so the app has
# to listen there. dsh allows one concrete local address and rejects the
# wildcard ones on purpose; the published host port stays the only door in.
BIND_HOST=${DSH_BIND_HOST:-$(hostname -I | awk '{print $1}')}
if [ -z "$BIND_HOST" ]; then
  log "error: cannot detect this container's IP address"; exit 1
fi

args=(--profile web
      --host "$BIND_HOST" --port "$INTERNAL_PORT" --no-open
      --public-url "http://localhost:${LUOYU_PORT:-3090}")
for authority in "localhost:${LUOYU_PORT:-3090}" "127.0.0.1:${LUOYU_PORT:-3090}" ${DSH_EXTRA_TRUSTED_HOSTS:-}; do
  args+=(--trusted-host "$authority")
done

log "workspace=${WORKSPACE} home=${DSH_HOME} ui=http://localhost:${LUOYU_PORT:-3090} (container ${BIND_HOST}:${INTERNAL_PORT})"
log "the browser-trust login URL (with ?token=…) is printed below and in \`docker compose logs dsh\`"
exec dsh "${args[@]}"
