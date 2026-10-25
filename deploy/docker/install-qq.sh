#!/usr/bin/env bash
#
# Install the official Tencent QQ client into the running container, from a
# .deb you already have on this machine.
#
# Why this exists: the plugin's managed mode downloads the .deb from Tencent's
# CDN itself, but qqdl.gtimg.cn answers 403 to this host's IP (measured from
# both the host and the container), so the automatic path cannot work here.
#
#   ./deploy/docker/install-qq.sh path/to/QQ_3.2.34_260924_amd64_01.deb
#
# Get the file from https://im.qq.com/linuxqq/download.html in a browser (or
# copy it over from another machine). The client is extracted into the
# luoyu-dsh-home volume, so it survives container recreation; the entrypoint
# links it back to /opt/QQ on every start.
#
set -euo pipefail

DEB=${1:-}
CONTAINER=${CONTAINER:-luoyu-dsh}

if [ -z "$DEB" ] || [ ! -f "$DEB" ]; then
  echo "usage: $0 <qq-client.deb>" >&2
  exit 2
fi
if ! head -c 8 "$DEB" | grep -q '!<arch>'; then
  echo "$DEB is not a Debian package" >&2
  exit 2
fi

docker cp "$DEB" "$CONTAINER:/tmp/qq.deb"
docker exec "$CONTAINER" sh -euc '
  mkdir -p /dsh-home/qq
  dpkg -x /tmp/qq.deb /dsh-home/qq
  rm -f /tmp/qq.deb
  ln -sfn /dsh-home/qq/opt/QQ /opt/QQ
  test -f /dsh-home/qq/opt/QQ/resources/app/package.json
'

echo "QQ installed into the volume at /dsh-home/qq/opt/QQ."
echo "Now open http://localhost:3090/luoyu and press Start NapCat."
