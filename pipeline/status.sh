#!/usr/bin/env bash
# Пересобирает pipeline/QUEUE.md из файлов заданий и печатает сводку.
# Источник истины — папка, в которой лежит файл задания.
# Запуск из любого места:  bash pipeline/status.sh
set -euo pipefail

PIPE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS="$PIPE/tasks"
OUT="$PIPE/QUEUE.md"

field() { # field <файл> <имя_поля>
	sed -n "/^---$/,/^---$/p" "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -1
}

max_id=0
rows=""

for dir in open in_progress done blocked; do
	for f in "$TASKS/$dir"/task-*.md; do
		[ -e "$f" ] || continue
		base="$(basename "$f" .md)"
		num="$(printf '%s' "$base" | sed -n 's/^task-0*\([0-9]\+\).*/\1/p')"
		[ -n "$num" ] && [ "$num" -gt "$max_id" ] && max_id="$num"

		title="$(field "$f" title)";      [ -n "$title" ] || title="$base"
		type="$(field "$f" type)";        [ -n "$type" ] || type="—"
		status="$(field "$f" status)";    [ -n "$status" ] || status="$dir"
		rev="$(field "$f" revision)";     [ -n "$rev" ] || rev="1"
		created="$(field "$f" created)";  [ -n "$created" ] || created="—"
		finished="$(field "$f" finished)"; [ -n "$finished" ] || finished="—"

		rows="${rows}| ${base%%-*}-$(printf '%s' "$base" | cut -d- -f2) | $title | $type | v$rev | **$status** | $dir/ | $created | $finished |"$'\n'
	done
done

next=$((max_id + 1))
next_id="$(printf 'task-%04d' "$next")"

{
	echo "# Доска состояния пайплайна"
	echo
	echo "Файл генерируется: \`bash pipeline/status.sh\`. Руками не править —"
	echo "источник истины в том, **в какой папке лежит файл задания**."
	echo
	echo "| ID | Задание | Тип | Ревизия | Статус | Папка | Создано | Закрыто |"
	echo "|---|---|---|---|---|---|---|---|"
	if [ -n "$rows" ]; then
		printf '%s' "$rows"
	else
		echo "| — | заданий пока нет | — | — | — | — | — | — |"
	fi
	echo
	echo "## Следующий свободный номер"
	echo
	echo "**$next_id**"
} > "$OUT"

cat "$OUT"
