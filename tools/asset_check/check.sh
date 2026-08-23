#!/usr/bin/env bash
# Паспорт ассета: габариты, полигонаж, материалы, скелет, анимации, размеры текстур
# плюс замечания по ASSET_SPEC.md (сантиметры вместо метров, пивот, лишние материалы).
#
#   bash tools/asset_check/check.sh pipeline/delivery/task-0007-lava/v1
#   bash tools/asset_check/check.sh            # проверить то, что уже лежит в incoming/
#
# Проверка автоматическая и неполная: конвенцию нормалей и «красиво ли»
# так не увидеть — на это смотрят глазами.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJ="$ROOT/tools/asset_check"
GODOT="$ROOT/Godot_v4.7-stable_win64_console.exe"

[ -x "$GODOT" ] || { echo "Не найден движок: $GODOT"; exit 1; }

if [ $# -ge 1 ]; then
	SRC="$1"
	[ -d "$SRC" ] || { echo "Нет такой папки: $SRC"; exit 1; }
	rm -rf "$PROJ/incoming"
	mkdir -p "$PROJ/incoming"
	# .md и превью не проверяем — только сами ассеты
	find "$SRC" -maxdepth 1 -type f \
		! -name '*.md' ! -name 'preview.*' ! -name '*.import' \
		-exec cp {} "$PROJ/incoming/" \;
	echo "Скопировано в incoming/: $(ls -1 "$PROJ/incoming" | wc -l) файл(ов)"
fi

# Импорт: без него load() в скрипте не увидит ассеты.
"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true
"$GODOT" --headless --path "$PROJ" --script res://inspect.gd
