#!/bin/bash
set -e

CITY_DATA_DIR="${CITY_DATA_DIR:-/app/backend/data}"
VERSION_FILE="$CITY_DATA_DIR/.version"
CURRENT_VERSION="${DATA_VERSION:-}"

if [ -n "$DATA_DOWNLOAD_URL" ]; then
    DISK_VERSION=""
    if [ -f "$VERSION_FILE" ]; then
        DISK_VERSION=$(cat "$VERSION_FILE")
    fi

    if [ "$DISK_VERSION" != "$CURRENT_VERSION" ]; then
        echo "City data version mismatch (disk=$DISK_VERSION, want=$CURRENT_VERSION) — downloading..."
        mkdir -p "$CITY_DATA_DIR"
        curl -L "$DATA_DOWNLOAD_URL" | tar xz --strip-components=1 -C "$CITY_DATA_DIR"
        echo "$CURRENT_VERSION" > "$VERSION_FILE"
        echo "City data ready (version $CURRENT_VERSION)."
    else
        echo "City data up to date (version $CURRENT_VERSION)."
    fi
fi

exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-10000}"
