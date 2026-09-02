#!/usr/bin/env bash
# Пересчитывает game/assets/gallery_data.json по всем .glb в game/assets/models.
# HTML (gallery.html) статический и ничего не считает сам — запускать это
# после каждой новой поставки, страницу не трогать.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

./Godot_v4.7-stable_win64_console.exe --headless --path game res://plan3d.tscn \
		-- --gallery-data
