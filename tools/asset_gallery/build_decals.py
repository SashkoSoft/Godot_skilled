"""Сканирует game/assets/decals/** и группирует файлы по общему имени
(не по папке — в decals/paper/ лежит десяток НЕСВЯЗАННЫХ декалей вперемешку,
папка тут не единица материала, как в textures/, а просто подкаталог).
Группировка — по имени файла без суффикса карты и разрешения:
poster_torn_albedo_1k.png -> группа "poster_torn".
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "game", "assets", "decals"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "game", "assets", "decals_data.json"))

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")
SUFFIX_RE = re.compile(
    r"_(albedo|normal|orm|id|seam|rough|metal|ao|height|mask)(_\d+k?)?$",
    re.IGNORECASE,
)


def group_key(stem):
    m = SUFFIX_RE.search(stem)
    if m:
        return stem[: m.start()]
    return stem


def main():
    groups = {}
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        for fn in sorted(filenames):
            if not fn.lower().endswith(IMG_EXT):
                continue
            stem = os.path.splitext(fn)[0]
            key = group_key(stem)
            rel_dir = os.path.relpath(dirpath, ROOT)
            rel_file = fn if rel_dir == "." else f"{rel_dir}/{fn}"
            groups.setdefault(key, []).append(rel_file)

    decals = [{"category": k, "files": sorted(v)} for k, v in sorted(groups.items())]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(decals, f, ensure_ascii=False, indent=2)
    print(f"[decals] {len(decals)} groups -> {OUT}")


if __name__ == "__main__":
    main()
