#!/usr/bin/env bash
# Пересчитывает game/assets/gallery_data.json (модели),
# game/assets/textures_data.json (материалы) и game/assets/decals_data.json
# (декали). HTML (gallery.html) статический и ничего не считает сам —
# запускать это после каждой новой поставки, страницу не трогать.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

./Godot_v4.7-stable_win64_console.exe --headless --path game res://plan3d.tscn \
		-- --gallery-data
python tools/asset_gallery/build_textures.py
python tools/asset_gallery/build_decals.py
