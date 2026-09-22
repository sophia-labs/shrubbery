#!/bin/sh

set -eu

KOREADER_VERSION=v2026.07
KOREADER_ARCHIVE=koreader-linux-x86_64-${KOREADER_VERSION}.tar.xz
KOREADER_ARCHIVE_SHA256=3b1b8d6cce6e53ed0062a7a6a2e58c4f28e8cfe04a429ff79fe690bdcbc6b386
KOREADER_DOWNLOAD_URL=https://github.com/koreader/koreader/releases/download/${KOREADER_VERSION}/${KOREADER_ARCHIVE}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CACHE_DIR=${KOREADER_EMULATOR_CACHE:-${TMPDIR:-/tmp}/sophia-koreader-emulator-${KOREADER_VERSION}}
ARCHIVE_PATH=${KOREADER_ARCHIVE_PATH:-$CACHE_DIR/$KOREADER_ARCHIVE}
KOREADER_ROOT=${KOREADER_ROOT:-$CACHE_DIR/release}
FEED_DIR=${SOPHIA_KOREADER_FEED_DIR:-$APP_DIR/dist/feed}
STATE_DIR=${KOREADER_EMULATOR_STATE:-$CACHE_DIR/state}
IMAGE_NAME=${KOREADER_EMULATOR_IMAGE:-sophia-koreader-emulator:${KOREADER_VERSION}}
CONTAINER_NAME=${KOREADER_EMULATOR_CONTAINER:-sophia-koreader-emulator-${KOREADER_VERSION}}
NOVNC_HOST=${NOVNC_HOST:-127.0.0.1}
NOVNC_PORT=${NOVNC_PORT:-6080}
SOPHIA_FEED_URL=${SOPHIA_FEED_URL:-http://host.docker.internal:8787/manifest.json}

for command in curl docker shasum tar; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command is unavailable: $command" >&2
        exit 69
    fi
done

if [ ! -f "$FEED_DIR/index.xhtml" ] || [ ! -f "$FEED_DIR/manifest.json" ]; then
    echo "Generated feed is missing from $FEED_DIR" >&2
    echo "Run the Sophia KOReader build first or set SOPHIA_KOREADER_FEED_DIR." >&2
    exit 66
fi

mkdir -p "$CACHE_DIR" "$STATE_DIR"

if [ ! -f "$ARCHIVE_PATH" ]; then
    curl --fail --location --output "$ARCHIVE_PATH.part" "$KOREADER_DOWNLOAD_URL"
    mv "$ARCHIVE_PATH.part" "$ARCHIVE_PATH"
fi

printf '%s  %s\n' "$KOREADER_ARCHIVE_SHA256" "$ARCHIVE_PATH" | shasum -a 256 --check

if [ ! -x "$KOREADER_ROOT/lib/koreader/reader.lua" ]; then
    staged_release=$CACHE_DIR/release.part
    if [ -e "$staged_release" ]; then
        echo "Refusing to replace an unexpected staged release: $staged_release" >&2
        exit 73
    fi
    mkdir "$staged_release"
    tar -xJf "$ARCHIVE_PATH" -C "$staged_release"
    mv "$staged_release" "$KOREADER_ROOT"
fi

docker build --platform linux/amd64 --tag "$IMAGE_NAME" "$SCRIPT_DIR"

existing_container=$(docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}')
if [ -n "$existing_container" ]; then
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null
fi

docker run --detach \
    --name "$CONTAINER_NAME" \
    --platform linux/amd64 \
    --publish "$NOVNC_HOST:$NOVNC_PORT:6080" \
    --env KOREADER_DOCUMENT=/feed/index.xhtml \
    --env SOPHIA_FEED_URL="$SOPHIA_FEED_URL" \
    --volume "$KOREADER_ROOT:/koreader:ro" \
    --volume "$FEED_DIR:/feed:ro" \
    --volume "$STATE_DIR:/state" \
    --volume "$APP_DIR/runtime/sophia.koplugin:/state/plugins/sophia.koplugin:ro" \
    "$IMAGE_NAME" >/dev/null

url="http://$NOVNC_HOST:$NOVNC_PORT/vnc.html?autoconnect=1&resize=scale"
echo "KOReader is starting at $url"
echo "Container: $CONTAINER_NAME"
echo "Persistent state: $STATE_DIR"

if [ "${KOREADER_EMULATOR_OPEN:-1}" = "1" ] && command -v open >/dev/null 2>&1; then
    open "$url"
fi
