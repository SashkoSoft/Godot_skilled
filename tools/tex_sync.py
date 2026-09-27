"""Ступени текстур HoudiniCOP → игра.

Для каждого набора в game/assets/textures/<set>/, у которого в выгрузке HoudiniCOP
есть lod/ (1k, 512, у мелких исходников и 256; альбедо ещё .webp), копирует lod/ и tile.txt и пишет манифест
game/assets/textures/lod.json:
    { "<set>": { "src": "2k" | "1k" (файлы в корне набора), "tiers": ["1k", "512"] (lod/),
                 "maps": {"1k": [...], "512": [...]},
                 "webp": true, "ormHeight": true } }
ormHeight — в tile.txt есть строка orm_b= (высота в синем канале ORM, отдельный
*_height_* не нужен). Веб берёт файлы по манифесту (web/src/texlod.js).

    python tools/tex_sync.py [путь к export/textures]
"""
import json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game", "assets", "textures")
SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Papa\Documents\HoudiniCOP\export\textures"
RX = re.compile(r"^(?P<map>[a-z_]+?)_(?P<tier>1k|512|256)\.(?P<ext>png|webp)$")

manifest, copied = {}, 0
for s in sorted(os.listdir(GAME)):
    lod = os.path.join(SRC, s, "lod")
    if not os.path.isdir(os.path.join(GAME, s)) or not os.path.isdir(lod):
        continue
    dst = os.path.join(GAME, s, "lod")
    os.makedirs(dst, exist_ok=True)
    maps, webp = {}, False
    base = s.replace("-", "_") + "_"   # файлы: <набор через _>_<карта>_<ступень>
    for f in sorted(os.listdir(lod)):
        m = RX.match(f[len(base):]) if f.startswith(base) else None
        if not m:
            continue
        shutil.copy2(os.path.join(lod, f), os.path.join(dst, f)); copied += 1
        if m["ext"] == "webp":
            webp = True
        maps.setdefault(m["tier"], set()).add(m["map"])
    # исходная ступень — файлы в корне набора (<base><карта>_2k|1k|05k.png; 05k — это 512): она тоже ступень.
    # ORM исходника обновляется из выгрузки: в нём теперь высота (синий канал).
    src = None
    for f in os.listdir(os.path.join(GAME, s)):
        m = re.match(re.escape(base) + r"([a-z_]+?)_(2k|1k|05k)\.png$", f)
        if m:
            src = m[2]
            if m[1] == "orm" and os.path.exists(os.path.join(SRC, s, f)):
                shutil.copy2(os.path.join(SRC, s, f), os.path.join(GAME, s, f))
    tile = os.path.join(SRC, s, "tile.txt")
    orm_h = False
    if os.path.exists(tile):
        shutil.copy2(tile, os.path.join(GAME, s, "tile.txt"))
        orm_h = any(l.startswith("orm_b") for l in open(tile, encoding="utf-8", errors="replace"))
    manifest[s] = {"src": src, "tiers": sorted(maps, key=lambda t: -int(t.replace("k", "000"))),
                   "maps": {t: sorted(v) for t, v in maps.items()}, "webp": webp, "ormHeight": orm_h}

with open(os.path.join(GAME, "lod.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print(f"наборов со ступенями: {len(manifest)}, файлов скопировано: {copied}, "
      f"высота в ORM.B: {sum(v['ormHeight'] for v in manifest.values())}")
