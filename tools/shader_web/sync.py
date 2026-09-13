#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Переносит текущее состояние веб-версии в стенд `preview.html`.

Стенд должен показывать ровно то, что лежит в репозитории, иначе смысл
прототипирования теряется: подобранные в браузере числа приедут в игру и
дадут другую картинку. Поэтому один источник правды — файлы игры, а
страница собирается из них:

  web/src/shaders/surface.glsl -> блок между //<<<BEGIN surface.glsl и //>>>END
  web/src/surface.js           -> массив MATS между /*<<<BEGIN MATS*/ и /*>>>END MATS*/

Обратный ход делается руками и намеренно: правка в браузере -> кнопка
«Скопировать surface.glsl» -> вставить в файл -> снова запустить этот скрипт.

    python tools/shader_web/sync.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = ROOT / "tools" / "shader_web" / "preview.html"
SHADER = ROOT / "web" / "src" / "shaders" / "surface.glsl"
SURFACE_JS = ROOT / "web" / "src" / "surface.js"

# Подписи вкладок: в коде их нет, они нужны только человеку.
TITLES = {
    "walk": "Тротуар",
    "road": "Асфальт",
    "kerb": "Бордюр",
    "earth": "Земля",
}
# Порядок в стенде: индекс материала, на который ссылается trace().
ORDER = ["walk", "road", "kerb", "earth"]

PRESET = re.compile(
    r"(\w+)\s*:\s*\{\s*kind:\s*(\d+)\s*,\s*plate:\s*([0-9.]+)\s*,"
    r"\s*a:\s*0x([0-9a-fA-F]{6})\s*,\s*b:\s*0x([0-9a-fA-F]{6})\s*,"
    r"\s*j:\s*0x([0-9a-fA-F]{6})\s*\}"
)


def srgb(hex6: str) -> list:
    """Hex sRGB -> три компоненты 0..1. Именно так их читает three.js."""
    v = int(hex6, 16)
    return [((v >> 16) & 255) / 255.0, ((v >> 8) & 255) / 255.0, (v & 255) / 255.0]


def read_materials() -> list:
    src = SURFACE_JS.read_text(encoding="utf-8")
    found = {}
    for m in PRESET.finditer(src):
        found[m.group(1)] = {
            "kind": int(m.group(2)),
            "plate": float(m.group(3)),
            "a": srgb(m.group(4)),
            "b": srgb(m.group(5)),
            "j": srgb(m.group(6)),
        }
    missing = [n for n in ORDER if n not in found]
    if missing:
        raise SystemExit("в surface.js не найдены пресеты: " + ", ".join(missing))
    return [dict(found[n], key=n, name=TITLES[n]) for n in ORDER]


def js_materials(mats: list) -> str:
    def c(v):
        return "[" + ", ".join("%.3f" % x for x in v) + "]"

    rows = []
    for m in mats:
        rows.append(
            '\t{ name: "%s", key: "%s", kind: %d, plate: %.2f, joint: 0.030, rough: 0.92,\n'
            "\t  a: %s, b: %s, j: %s },"
            % (m["name"], m["key"], m["kind"], m["plate"],
               c(m["a"]), c(m["b"]), c(m["j"]))
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

    page = splice(page, "//<<<BEGIN surface.glsl", "//>>>END surface.glsl", shader)
    mats = read_materials()
    page = splice(page, "/*<<<BEGIN MATS — заполняется sync.py из web/src/surface.js */",
                  "/*>>>END MATS*/", js_materials(mats))

    PAGE.write_text(page, encoding="utf-8", newline="\n")
    print("preview.html обновлён: %d строк шейдера, %d материала"
          % (len(shader.splitlines()), len(mats)))
    for m in mats:
        print("  %-7s kind=%d plate=%.2f" % (m["key"], m["kind"], m["plate"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
