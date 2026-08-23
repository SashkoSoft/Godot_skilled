#!/usr/bin/env bash
# Пересобирает pipeline/QUEUE.md из файлов заданий и печатает сводку.
# Источник истины — папка, в которой лежит файл задания, и поле assignee в его шапке.
#
#   bash pipeline/status.sh                  # вся доска
#   bash pipeline/status.sh --for comfyui    # только задания одной роли
set -euo pipefail

PIPE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS="$PIPE/tasks"
OUT="$PIPE/QUEUE.md"

FILTER=""
if [ "${1:-}" = "--for" ]; then
	FILTER="${2:-}"
	[ -n "$FILTER" ] || { echo "Укажите роль: --for houdini-assets|houdini-anim|comfyui"; exit 1; }
fi

field() { # field <файл> <имя_поля>
	local v
	v="$(sed -n "/^---$/,/^---$/p" "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -1)"
	# вертикальную черту заменяем на broken bar: иначе значение разрежет таблицу
	printf '%s' "${v//|/¦}"
}

max_id=0
rows=""
filtered=""

for dir in open in_progress done blocked; do
	for f in "$TASKS/$dir"/task-*.md; do
		[ -e "$f" ] || continue
		base="$(basename "$f" .md)"
		id="$(printf '%s' "$base" | cut -d- -f1,2)"
		num="$(printf '%s' "$base" | sed -n 's/^task-0*\([0-9]\+\).*/\1/p')"
		[ -n "$num" ] && [ "$num" -gt "$max_id" ] && max_id="$num"

		title="$(field "$f" title)";       [ -n "$title" ] || title="$base"
		who="$(field "$f" assignee)";      [ -n "$who" ] || who="—"
		type="$(field "$f" type)";         [ -n "$type" ] || type="—"
		status="$(field "$f" status)";     [ -n "$status" ] || status="$dir"
		rev="$(field "$f" revision)";      [ -n "$rev" ] || rev="1"
		created="$(field "$f" created)";   [ -n "$created" ] || created="—"
		finished="$(field "$f" finished)"; [ -n "$finished" ] || finished="—"

		rows="${rows}| $id | $title | **$who** | $type | v$rev | $status | $dir/ | $created | $finished |"$'\n'
		if [ -n "$FILTER" ] && [ "$who" = "$FILTER" ]; then
			filtered="${filtered}  $id  [$status]  $title  ($dir/)"$'\n'
		fi
	done
done

next_id="$(printf 'task-%04d' "$((max_id + 1))")"

{
	echo "# Доска состояния пайплайна"
	echo
	echo "Файл генерируется: \`bash pipeline/status.sh\`. Руками не править —"
	echo "источник истины в том, **в какой папке лежит файл задания** и что у него в \`assignee\`."
	echo
	echo "| ID | Задание | Кому | Тип | Ревизия | Статус | Папка | Создано | Закрыто |"
	echo "|---|---|---|---|---|---|---|---|---|"
	if [ -n "$rows" ]; then
		printf '%s' "$rows"
	else
		echo "| — | заданий пока нет | — | — | — | — | — | — | — |"
	fi
	echo
	echo "## Следующий свободный номер"
	echo
	echo "**$next_id**"
} > "$OUT"

if [ -n "$FILTER" ]; then
	echo "Задания роли $FILTER:"
	if [ -n "$filtered" ]; then
		printf '%s' "$filtered"
	else
		echo "  (нет)"
	fi
else
	cat "$OUT"
fi
