# -*- coding: utf-8 -*-
"""Подтягивает координаты таблицы ROOMS к осям стен на скане БТИ.

Каждая координата (не каждое ребро) сдвигается один раз: берутся все стены,
стоящие на этой координате, и выбирается смещение, на котором суммарная
длина попадания на тёмную линию скана максимальна. Так общие стены соседних
помещений остаются общими.
"""
import re, io
import numpy as np
from PIL import Image

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
SRC  = r"C:/Users/Papa/Documents/godot_skilled/game/tower.gd"
S, CX, CZ = 23.94, 607.0, 610.5
SEARCH = 9        # px, ±0,38 м

KIND = {"LIV":0,"KIT":1,"BAT":2,"HAL":3,"COR":4,"LOG":5,"SHF":6}
txt = io.open(SRC, encoding="utf-8").read()
head, rest = txt.split("const ROOMS := [", 1)
tbl, tail = rest.split("\n]", 1)

rows = []
for line in tbl.splitlines():
    src = line
    body = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", body)
    if not m:
        rows.append((None, src)); continue
    p = [x.strip() for x in m.group(1).split(",")]
    rows.append(([float(p[0]), float(p[1]), float(p[2]), float(p[3]), int(p[4]), p[5]], src))

img  = np.array(Image.open(SCAN).convert("L")).astype(int)
dark = img < 140

def coverage(axis, coord_px, a0, a1):
    lo = int(round((CZ if axis == 1 else CX) + a0 * S))
    hi = int(round((CZ if axis == 1 else CX) + a1 * S))
    lo, hi = max(lo, 0), min(hi, img.shape[0] if axis == 1 else img.shape[1])
    if hi - lo < 6:
        return 0.0, 0
    c = int(round(coord_px))
    if axis == 1:
        if c - 2 < 0 or c + 3 > img.shape[1]:
            return 0.0, 0
        strip = dark[lo:hi, c - 2:c + 3]
    else:
        if c - 2 < 0 or c + 3 > img.shape[0]:
            return 0.0, 0
        strip = dark[c - 2:c + 3, lo:hi].T
    hit = (strip.sum(axis=1) > 0).sum()
    return float(hit), hi - lo

# ребра, сгруппированные по координате
groups = {}
for r, _ in rows:
    if r is None:
        continue
    groups.setdefault((1, round(r[0], 2)), []).append((r[1], r[3]))
    groups.setdefault((1, round(r[2], 2)), []).append((r[1], r[3]))
    groups.setdefault((0, round(r[1], 2)), []).append((r[0], r[2]))
    groups.setdefault((0, round(r[3], 2)), []).append((r[0], r[2]))

shift = {}
report = []
for (axis, coord), segs in groups.items():
    base = (CX if axis == 1 else CZ) + coord * S
    best = None
    for off in range(-SEARCH, SEARCH + 1):
        hit = tot = 0.0
        for a0, a1 in segs:
            h, n = coverage(axis, base + off, a0, a1)
            hit += h; tot += n
        if tot < 6:
            continue
        score = hit / tot
        if best is None or score > best[0] + 1e-9 or (abs(score - best[0]) < 0.02 and abs(off) < abs(best[1])):
            if best is None or score >= best[0] - 0.02:
                best = (max(score, best[0] if best else 0.0), off)
    if best is None or best[0] < 0.55:
        shift[(axis, coord)] = coord
        report.append((axis, coord, coord, best[0] if best else 0.0, "оставлено"))
        continue
    new = round(coord + best[1] / S, 3)
    shift[(axis, coord)] = new
    report.append((axis, coord, new, best[0], "сдвиг %+.0f px" % best[1]))

out = []
for r, src in rows:
    if r is None:
        out.append(src); continue
    x0 = shift[(1, round(r[0], 2))]; x1 = shift[(1, round(r[2], 2))]
    z0 = shift[(0, round(r[1], 2))]; z1 = shift[(0, round(r[3], 2))]
    if x1 - x0 < 0.4 or z1 - z0 < 0.4:      # схлопнулось — оставляем как было
        x0, z0, x1, z1 = r[0], r[1], r[2], r[3]
    comment = ("  #" + src.split("#", 1)[1]) if "#" in src else ""
    out.append("\t[%6.2f, %6.2f, %6.2f, %6.2f, %d, %s],%s" % (x0, z0, x1, z1, r[4], r[5], comment))

io.open(SRC, "w", encoding="utf-8").write(head + "const ROOMS := [\n" + "\n".join(out) + "\n]" + tail)
moved = sum(1 for r in report if abs(r[1] - r[2]) > 0.001)
print("координат всего:", len(report), " подтянуто:", moved)
print("средняя доля попадания на линию: %.2f" % (sum(r[3] for r in report) / len(report)))
