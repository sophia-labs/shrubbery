#!/bin/sh

set -eu

KOREADER_ROOT=${KOREADER_ROOT:-/koreader}
KOREADER_WIDTH=${KOREADER_WIDTH:-800}
KOREADER_HEIGHT=${KOREADER_HEIGHT:-1200}
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PORT=${VNC_PORT:-5900}

if [ ! -x "$KOREADER_ROOT/lib/koreader/reader.lua" ]; then
    echo "KOReader release not mounted at $KOREADER_ROOT" >&2
    exit 66
fi

mkdir -p "$KO_HOME/settings"

if [ ! -f "$KO_HOME/settings.reader.lua" ]; then
    printf 'return { ["sdl_window"] = { ["height"] = %s, ["width"] = %s } }\n' \
        "$KOREADER_HEIGHT" "$KOREADER_WIDTH" > "$KO_HOME/settings.reader.lua"
fi

if [ -n "${SOPHIA_FEED_URL:-}" ] && [ ! -f "$KO_HOME/settings/sophia.lua" ]; then
    escaped_feed_url=$(printf '%s' "$SOPHIA_FEED_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf 'return { ["sophia"] = { ["bearer_token"] = "", ["feed_url"] = "%s", ["local_title"] = "Sophia" } }\n' \
        "$escaped_feed_url" > "$KO_HOME/settings/sophia.lua"
fi

cleanup() {
    kill "${WEBSOCKIFY_PID:-}" "${X11VNC_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 "${KOREADER_WIDTH}x${KOREADER_HEIGHT}x24" -nolisten tcp -ac &
XVFB_PID=$!

display_ready=0
attempt=0
while [ "$attempt" -lt 50 ]; do
    if xdotool getdisplaygeometry >/dev/null 2>&1; then
        display_ready=1
        break
    fi
    attempt=$((attempt + 1))
    sleep 0.1
done
if [ "$display_ready" -ne 1 ]; then
    echo "Xvfb did not become ready on $DISPLAY" >&2
    exit 70
fi

x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport "$VNC_PORT" \
    -o /tmp/x11vnc.log &
X11VNC_PID=$!

websockify --web=/usr/share/novnc "$NOVNC_PORT" "localhost:$VNC_PORT" \
    >/tmp/websockify.log 2>&1 &
WEBSOCKIFY_PID=$!

set --
if [ -n "${KOREADER_DOCUMENT:-}" ]; then
    if [ ! -f "$KOREADER_DOCUMENT" ]; then
        echo "KOReader startup document does not exist: $KOREADER_DOCUMENT" >&2
        exit 66
    fi
    set -- "$KOREADER_DOCUMENT"
fi

cd "$KOREADER_ROOT/lib/koreader"
status=85
while [ "$status" -eq 85 ]; do
    set +e
    ./reader.lua "$@"
    status=$?
    set -e
    set --
done
exit "$status"
