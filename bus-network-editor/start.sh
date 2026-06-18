#!/bin/bash
set -e

CITY_DATA_DIR="${CITY_DATA_DIR:-/app/backend/data}"

if [ -n "$DATA_DOWNLOAD_URL" ] && [ -z "$(ls -A "$CITY_DATA_DIR"/*.geojson 2>/dev/null)" ]; then
    echo "City data not found at $CITY_DATA_DIR — downloading..."
    mkdir -p "$CITY_DATA_DIR"
    curl -L "$DATA_DOWNLOAD_URL" | tar xz -C "$CITY_DATA_DIR"
    echo "City data ready."
fi

exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-10000}"
