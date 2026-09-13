#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Переносит текущее состояние игры в веб-стенд `preview.html`.

Стенд должен показывать ровно то, что лежит в репозитории, иначе смысл
прототипирования теряется: подобранные в браузере числа приедут в игру и
дадут другую картинку. Поэтому один источник правды — файлы игры, а
страница собирается из них:

  game/surface.gdshader   -> блок между //<<<BEGIN surface.gdshader и //>>>END
  game/road.gd            -> массив MATS между /*<<<BEGIN MATS*/ и /*>>>END MATS*/

Обратный ход делается руками и намеренно: правка в браузере -> кнопка
«Скопировать .gdshader» -> вставить в `game/surface.gdshader` -> снова
запустить этот скрипт.

    python tools/shader_web/sync.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = ROOT / "tools" / "shader_web" / "preview.html"
SHADER = ROOT / "game" / "surface.gdshader"
ROAD = ROOT / "game" / "road.gd"

# Подписи вкладок материалов: в road.gd их нет, они нужны только человеку.
TITLES = {
    "_m_walk": "Тротуар",
    "_m_road": "Асфальт",
    "_m_kerb": "Бордюр",
    "_m_earth": "Земля",
}
# Порядок в шейдере: индекс материала, на который ссылается trace().
ORDER = ["_m_walk", "_m_road", "_m_kerb", "_m_earth"]

CALL = re.compile(
    r"(_m_\w+)\s*=\s*_surface\(\s*(\d+)\s*,\s*"
    r"Color\(([^)]*)\)\s*,\s*Color\(([^)]*)\)\s*,\s*"
    r"Color\(([^)]*)\)\s*,\s*([0-9.]+)\s*\)",
    re.S,
)


def triple(text: str) -> list:
    parts = [float(x) for x in text.replace("\n", " ").split(",")]
    if len(parts) < 3:
        raise ValueError("ожидались три компоненты цвета, получено: " + text)
    return parts[:3]


def read_materials() -> list:
    src = ROAD.read_text(encoding="utf-8")
    found = {}
    for m in CALL.finditer(src):
        found[m.group(1)] = {
            "kind": int(m.group(2)),
            "a": triple(m.group(3)),
            "b": triple(m.group(4)),
            "j": triple(m.group(5)),
            "plate": float(m.group(6)),
        }
    missing = [n for n in ORDER if n not in found]
    if missing:
        raise SystemExit("в road.gd не найдены материалы: " + ", ".join(missing))
    return [dict(found[n], gd=n, name=TITLES[n]) for n in ORDER]


def js_materials(mats: list) -> str:
    def c(v):
        return "[" + ", ".join("%.3f" % x for x in v) + "]"

    rows = []
    for m in mats:
        rows.append(
            '\t{ name: "%s", gd: "%s", kind: %d, plate: %.2f, joint: 0.030, rough: 0.92,\n'
            "\t  a: %s, b: %s, j: %s },"
            % (m["name"], m["gd"], m["kind"], m["plate"], c(m["a"]), c(m["b"]), c(m["j"]))
        )
    return "const MATS = [\n" + "\n".join(rows) + "\n];"


def splice(page: str, begin: str, end: str, body: str) -> str:
    i = page.find(begin)
    j = page.find(end)
    if i < 0 or j < 0 or j < i:
        raise SystemExit("в preview.html не найдены метки %r / %r" % (begin, end))
    return page[: i + len(begin)] + "\n" + body + "\n" + page[j:]


def main() -> int:
    page = PAGE.read_text(encoding="utf-8")
    shader = SHADER.read_text(encoding="utf-8").rstrip("\n")

    if "</script" in shader.lower():
        raise SystemExit("в шейдере есть '</script' — он разорвёт страницу")

    page = splice(page, "//<<<BEGIN surface.gdshader", "//>>>END surface.gdshader",
                  shader)
    mats = read_materials()
    page = splice(page, "/*<<<BEGIN MATS — заполняется sync.py из road.gd::_materials() */",
                  "/*>>>END MATS*/", js_materials(mats))

    PAGE.write_text(page, encoding="utf-8", newline="\n")
    print("preview.html обновлён: %d строк шейдера, %d материала"
          % (len(shader.splitlines()), len(mats)))
    for m in mats:
        print("  %-9s kind=%d plate=%.2f" % (m["gd"], m["kind"], m["plate"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
