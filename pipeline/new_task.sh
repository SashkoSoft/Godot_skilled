#!/usr/bin/env bash
# Создаёт новое задание из шаблона со следующим свободным номером.
# Для Godot-сессии; исполнители этим не пользуются.
#
#   bash pipeline/new_task.sh houdini-anim walk-cycle
#   bash pipeline/new_task.sh comfyui ui-icons "Иконки интерфейса"
set -euo pipefail

PIPE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE="${1:-}"
SLUG="${2:-}"
TITLE="${3:-}"

case "$ROLE" in
	houdini-assets|houdini-anim|comfyui) ;;
	*)
		echo "Использование: bash pipeline/new_task.sh <роль> <slug> [заголовок]"
		echo "Роли: houdini-assets | houdini-anim | comfyui"
		exit 1
		;;
esac
[ -n "$SLUG" ] || { echo "Укажите slug, например: walk-cycle"; exit 1; }

# следующий свободный номер — по всем папкам сразу
max=0
for f in "$PIPE"/tasks/*/task-*.md; do
	[ -e "$f" ] || continue
	n="$(basename "$f" | sed -n 's/^task-0*\([0-9]\+\).*/\1/p')"
	[ -n "$n" ] && [ "$n" -gt "$max" ] && max="$n"
done
id="$(printf 'task-%04d' "$((max + 1))")"
dest="$PIPE/tasks/open/$id-$SLUG.md"
[ -e "$dest" ] && { echo "Уже существует: $dest"; exit 1; }

today="$(date +%Y-%m-%d)"
[ -n "$TITLE" ] || TITLE="$SLUG"

case "$ROLE" in
	# тип — стартовое значение, при необходимости поправьте в шапке задания
	houdini-anim)   spec="ANIM_SPEC.md"; type="animation" ;;
	comfyui)        spec="ASSET_SPEC.md (текстуры) / AUDIO_SPEC.md (звук)"; type="texture" ;;
	houdini-assets) spec="ASSET_SPEC.md"; type="model" ;;
esac

# шапка + тело шаблона (тело берём из TEMPLATE.md, начиная с первого заголовка)
{
	echo "---"
	echo "id: $id"
	echo "title: $TITLE"
	echo "assignee: $ROLE"
	echo "type: $type"
	echo "status: open"
	echo "revision: 1"
	echo "priority: normal"
	echo "created: $today"
	echo "started:"
	echo "finished:"
	echo "---"
	echo
	echo "# $id — $TITLE"
	echo
	echo "> Требования к сдаче: \`pipeline/$spec\`"
	echo
	sed -n '/^## Зачем это в игре/,$p' "$PIPE/tasks/TEMPLATE.md"
} > "$dest"

echo "Создано: $dest"
echo "Теперь опишите разделы «Зачем это в игре» и «Требования», затем:"
echo "  bash pipeline/status.sh && git add pipeline && git commit -m \"godot: $id $SLUG\" && git push"
