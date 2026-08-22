#!/usr/bin/env bash
# Восстанавливает локальную копию документации Godot 4.7 и демо-проектов.
# Эти клоны не хранятся в репозитории (~970 МБ, своя история git).
# Запуск из корня репозитория:  bash docs/fetch_docs.sh
set -euo pipefail

BRANCH_DOCS="4.7"     # ветка мануала — должна совпадать с версией движка
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

clone_or_pull() {
	local url="$1" path="$2" branch="$3"
	if [ -d "$path/.git" ]; then
		echo "== обновляю $path"
		git -C "$path" pull --ff-only
	else
		echo "== клонирую $url ($branch) -> $path"
		git clone --depth 1 --branch "$branch" --single-branch "$url" "$path"
	fi
}

clone_or_pull https://github.com/godotengine/godot-docs.git          "$DIR/godot-docs"          "$BRANCH_DOCS"
clone_or_pull https://github.com/godotengine/godot-demo-projects.git "$DIR/godot-demo-projects" master

echo
echo "Готово:"
du -sh "$DIR/godot-docs" "$DIR/godot-demo-projects"
echo "Статей мануала: $(find "$DIR/godot-docs" -name '*.rst' | wc -l)"
