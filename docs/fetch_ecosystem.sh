#!/usr/bin/env bash
# Подтягивает сторонние репозитории экосистемы Godot в docs/ecosystem/.
# Разбор каждого — в docs/ECOSYSTEM.md. В git эти клоны не хранятся.
#
#   bash docs/fetch_ecosystem.sh          # базовый набор (~40 МБ)
#   bash docs/fetch_ecosystem.sh --all    # плюс тяжёлые (TPS-контроллер ~390 МБ и др.)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ecosystem"
mkdir -p "$DIR"

get() { # get <owner/repo> <папка> <описание>
	local repo="$1" name="$2" note="$3"
	if [ -d "$DIR/$name/.git" ]; then
		echo "== обновляю $name ($note)"
		git -C "$DIR/$name" pull --ff-only || echo "   (пропущено: локальные изменения)"
	else
		echo "== клонирую $name — $note"
		git clone -q --depth 1 "https://github.com/$repo.git" "$DIR/$name"
	fi
}

# --- базовый набор ---
get godotengine/awesome-godot            awesome-godot           "каталог плагинов и шаблонов"
get ramokz/phantom-camera                phantom-camera          "камера, аналог Cinemachine, MIT"
get gdquest-demos/godot-2d-builder       godot-2d-builder        "2D-симуляция: инвентарь, сетка, drag-and-drop, MIT"

# НЕ тянем: арт GDQuest под CC-BY-NC-SA (некоммерческая + share-alike).
#   gdquest-demos/godot-4-3D-Characters, gdquest-demos/godot-4-3d-third-person-controller
# Их код под MIT, но модели и текстуры в релиз брать нельзя. Нужен эталон структуры —
# смотреть на github, в рабочее окружение не класть.

# --- тяжёлое и по потребности ---
if [ "${1:-}" = "--all" ]; then
	get dialogic-godot/dialogic                           dialogic                            "диалоги и визуальные новеллы, 2.0-alpha"
	get TokisanGames/Terrain3D                            Terrain3D                           "ландшафт; стабильный релиз заявляет 4.4-4.6, под 4.7 нужен main"
fi

echo
du -sh "$DIR"/*/ 2>/dev/null || true
