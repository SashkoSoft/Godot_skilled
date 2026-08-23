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
	# Копируем только сами ассеты: соседние .tres/.tscn/.gd тянут ссылки по UID
	# и ломают импорт всей папки — проверено на демо-проектах.
	find "$SRC" -maxdepth 1 -type f \
		\( -iname '*.glb' -o -iname '*.gltf' -o -iname '*.obj' -o -iname '*.dae' -o -iname '*.fbx' \
		-o -iname '*.png' -o -iname '*.webp' -o -iname '*.exr' -o -iname '*.hdr' -o -iname '*.tga' \
		-o -iname '*.wav' -o -iname '*.ogg' -o -iname '*.mp3' \) \
		! -iname 'preview.*' \
		-exec cp {} "$PROJ/incoming/" \;
	echo "Скопировано в incoming/: $(ls -1 "$PROJ/incoming" | wc -l) файл(ов)"
fi

# Импорт: без него load() в скрипте не увидит ассеты.
"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true
"$GODOT" --headless --path "$PROJ" --script res://inspect.gd
