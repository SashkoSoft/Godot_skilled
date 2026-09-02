#!/usr/bin/env bash
# Локальный сервер для галереи ассетов. Нужен именно http:// — при открытии
# gallery.html как file:// браузер режет fetch() и загрузку .glb по CORS.
# Данные (game/assets/gallery_data.json) обновляются отдельно:
#   Godot_v4.7-stable_win64_console.exe --path game res://plan3d.tscn -- --gallery-data
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PORT="${1:-8765}"
echo "Галерея: http://localhost:${PORT}/tools/asset_gallery/gallery.html"
echo "Остановить — Ctrl+C."
python -m http.server "$PORT" --bind 127.0.0.1
