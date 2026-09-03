"""Сверяет каждую сданную задачу с тем, что реально лежит в game/assets и
реально упомянуто в коде игры — а не с тем, что написано в разделе «Приёмка».
«Принято» в задаче — это оценка ассета, не подтверждение, что он в сцене;
эти две вещи разошлись минимум дважды (task-0017, task-0024: приёмка
утверждала «стоит в игре», а файлы не копировались вообще). Отсюда и скрипт:
единственный источник правды — файловая система и grep по исходникам, не
текст в markdown.

Запуск: python pipeline/check_integration.py
Пишет pipeline/INTEGRATION.md.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
TASKS_DONE = os.path.join(HERE, "tasks", "done")
DELIVERY = os.path.join(HERE, "delivery")
GAME_ASSETS = os.path.join(ROOT, "game", "assets")
GAME_SRC = os.path.join(ROOT, "game")
OUT = os.path.join(HERE, "INTEGRATION.md")

ASSET_EXT = (".glb", ".png", ".jpg", ".jpeg", ".wav", ".ogg")
SKIP_NAMES = {"preview.png"}


def read_frontmatter(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    fields = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fields[k.strip()] = v.strip()
    return fields


def find_delivery_dir(task_id):
    # каталоги доставки называются то "task-0007", то "task-0007-slug"
    candidates = [d for d in os.listdir(DELIVERY)
                  if os.path.isdir(os.path.join(DELIVERY, d)) and
                  (d == task_id or d.startswith(task_id + "-"))]
    if not candidates:
        return None
    # если несколько (не должно быть) — берём точное совпадение или первое
    for c in candidates:
        if c == task_id:
            return os.path.join(DELIVERY, c)
    return os.path.join(DELIVERY, candidates[0])


def latest_version_dir(delivery_dir):
    versions = [d for d in os.listdir(delivery_dir)
                if re.match(r"^v\d+$", d) and os.path.isdir(os.path.join(delivery_dir, d))]
    if not versions:
        return None
    versions.sort(key=lambda v: int(v[1:]))
    return os.path.join(delivery_dir, versions[-1])


RES_SUFFIX_RE = re.compile(r"_(\d+k|\d{3,4})(?=\.[A-Za-z0-9]+$)", re.IGNORECASE)


def normalize(filename):
    """Снимает суффикс разрешения (_2k, _1k, _512...) перед сравнением —
    интеграция иногда даунскейлит (task-0002/0003 пришли в 2k, легли в 1k),
    и точное совпадение имени файла тогда ложно кричит «не скопировано»."""
    return RES_SUFFIX_RE.sub("", filename).lower()


def asset_files(version_dir):
    out = []
    for dirpath, dirnames, filenames in os.walk(version_dir):
        if os.path.basename(dirpath) == "source":
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn in SKIP_NAMES:
                continue
            if fn.lower().endswith(ASSET_EXT):
                out.append(fn)
    return out


def build_index(root, exts):
    """Нормализованное имя -> присутствует где-то в дереве (без учёта разрешения)."""
    idx = set()
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith(exts) and not fn.lower().endswith(".import"):
                idx.add(normalize(fn))
    return idx


def build_source_text():
    chunks = []
    for fn in os.listdir(GAME_SRC):
        if fn.endswith(".gd"):
            with open(os.path.join(GAME_SRC, fn), encoding="utf-8") as f:
                chunks.append(f.read())
    return "\n".join(chunks)


def main():
    asset_index = build_index(GAME_ASSETS, ASSET_EXT)
    source_text = build_source_text()

    rows = []
    for fn in sorted(os.listdir(TASKS_DONE)):
        if not fn.endswith(".md"):
            continue
        path = os.path.join(TASKS_DONE, fn)
        fm = read_frontmatter(path)
        status = fm.get("status", "?")
        if status not in ("accepted", "done"):
            continue  # cancelled — сюда не смотрим, там и не должно быть файлов
        task_id = fm.get("id", fn.split("-")[0] + "-" + fn.split("-")[1])
        title = fm.get("title", fn)

        ddir = find_delivery_dir(task_id)
        if ddir is None:
            rows.append((task_id, title, status, "нет папки доставки", "-", "-"))
            continue
        vdir = latest_version_dir(ddir)
        if vdir is None:
            rows.append((task_id, title, status, "нет версии vN", "-", "-"))
            continue
        files = asset_files(vdir)
        if not files:
            rows.append((task_id, title, status, "0 файлов-ассетов в доставке", "-", "-"))
            continue

        copied = [f for f in files if normalize(f) in asset_index]
        missing = [f for f in files if normalize(f) not in asset_index]
        stems = {os.path.splitext(f)[0] for f in files}
        referenced = [s for s in stems if s in source_text]

        copied_frac = f"{len(copied)}/{len(files)}"
        ref_frac = f"{len(referenced)}/{len(stems)}"
        rows.append((task_id, title, status, copied_frac, ref_frac, ", ".join(missing)))

    def is_gap(r):
        cf = r[3]
        if "/" not in cf:
            return True
        a, b = cf.split("/")
        return a != b
    gaps = [r for r in rows if is_gap(r)]

    gaps_json_path = os.path.join(GAME_ASSETS, "integration_gaps.json")
    with open(gaps_json_path, "w", encoding="utf-8") as f:
        json.dump(
            [{"task": r[0], "title": r[1], "copied": r[3], "missing": r[5]} for r in gaps],
            f, ensure_ascii=False, indent=2,
        )

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# Интеграция ассетов — файл vs игра\n\n")
        f.write("Генерируется: `python pipeline/check_integration.py`. Руками не "
                "править.\n\n")
        f.write("Проверяет не то, что написано в разделе «Приёмка» задачи, а то, "
                "что реально есть на диске: скопирован ли файл поставки куда-либо "
                "под `game/assets/` (по имени файла) и упоминается ли его имя "
                "(без расширения) хоть в одном `.gd`-файле `game/` (грубая, но "
                "рабочая проверка «использован ли», а не просто «лежит рядом»).\n\n")
        f.write("| Задача | Статус | Скопировано | Упомянуто в коде | Что не скопировано |\n")
        f.write("|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r[0]} — {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |\n")

        f.write("\n## Не полностью в игре\n\n")
        if gaps:
            for r in gaps:
                f.write(f"- **{r[0]}** — {r[1]}: скопировано {r[3]}"
                        + (f", не хватает: {r[5]}" if r[5] else "") + "\n")
        else:
            f.write("Нет — всё скопировано.\n")

    print(f"[integration] {len(rows)} tasks, {len(gaps)} not fully in game/assets -> {OUT}")


if __name__ == "__main__":
    main()
