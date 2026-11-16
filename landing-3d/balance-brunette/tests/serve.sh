#!/usr/bin/env bash
# Serve this folder on http://localhost:8080 (dev only)
cd "$(dirname "$0")/.." && exec python3 -m http.server "${1:-8080}"
