# syntax=docker/dockerfile:1

# Luoyu (dsh-luoyu) — the DeepSeek Harness QQ plugin, packaged with the
# Harness itself.
#
#   build context : repository root (../..)
#   runtime       : `dsh --profile web` inside the container, published on 3090
#
# Two stages: the plugin is type-checked and bundled by tsdown, the runtime
# image only carries `lib/`, `client.js`, the bundle patch and the Harness.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1 — build the plugin bundle (lib/index.js)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS plugin-build

WORKDIR /src

# Dependencies first, so source edits do not invalidate the npm layer.
COPY package.json tsconfig.json tsdown.config.ts ./
RUN npm install --no-audit --no-fund

COPY src ./src
COPY client.js cordis.patch.yml ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — DeepSeek Harness + the built plugin
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ARG DSH_VERSION=0.2.1-rc.2
ARG PNPM_VERSION=12.15.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8

# socat publishes the loopback-only Harness UI on the container network;
# Xvfb + the Electron libraries are what the QQ client needs in managed mode;
# unzip is used by the NapCat installer, sudo + apt by the QQ installer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dbus-x11 \
        fonts-noto-cjk \
        git \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcairo2 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnss3 \
        libpango-1.0-0 \
        libx11-xcb1 \
        libxcb-dri3-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        socat \
        sudo \
        tini \
        unzip \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

# The Harness CLI plus the pnpm that `dsh plugin` forwards to.
RUN npm install -g --no-audit --no-fund \
        "@deepseek-ai/dsh@${DSH_VERSION}" \
        "pnpm@${PNPM_VERSION}" \
    && npm cache clean --force

# The plugin. tsdown keeps the Harness packages external, so the only runtime
# import that must resolve from this directory is @deepseek-ai/schemastery.
COPY --from=plugin-build /src/lib /opt/dsh-luoyu/lib
COPY --from=plugin-build /src/package.json /src/client.js /src/cordis.patch.yml /opt/dsh-luoyu/
WORKDIR /opt/dsh-luoyu
RUN npm install --no-save --legacy-peer-deps --no-audit --no-fund \
        "@deepseek-ai/schemastery@^3.18.5" \
    && npm cache clean --force

# Seed $DSH_HOME once: `dsh plugin add` writes the profile manifest (with the
# plugin listed as a bundle layer and linked from /opt/dsh-luoyu) that the
# entrypoint copies into the persistent volume on first start.
ENV DSH_HOME=/opt/dsh-home-seed
RUN dsh plugin --profile web add /opt/dsh-luoyu
COPY deploy/docker/settings.yaml /opt/dsh-home-seed/settings.yaml

ENV DSH_HOME=/dsh-home \
    DSH_WEB_PORT=3080 \
    DSH_PUBLISHED_PORT=3090

COPY deploy/docker/entrypoint.sh /usr/local/bin/luoyu-entrypoint
RUN chmod 0755 /usr/local/bin/luoyu-entrypoint

WORKDIR /workspace
EXPOSE 3090

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3090/ | grep -qE '^(200|401)$'"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/luoyu-entrypoint"]
