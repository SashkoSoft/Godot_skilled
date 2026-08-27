# -*- coding: utf-8 -*-
"""Подтягивает координаты комнат к осям стен на скане БТИ — но без перекрытий.

Исходная таблица (снятая с чертежа вручную) лежит в game/plan_rooms_raw.txt и
не меняется. Каждая координата двигается один раз, сразу для всех стен, что на
ней стоят; смещение принимается, только если ни одна пара помещений после него
не наложилась друг на друга. Иначе берётся следующее по качеству смещение,
вплоть до исходного значения.
"""
import re, io
import numpy as np
from PIL import Image

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
RAW  = r"C:/Users/Papa/Documents/godot_skilled/game/plan_rooms_raw.txt"
SRC  = r"C:/Users/Papa/Documents/godot_skilled/game/tower.gd"
S, CX, CZ = 23.94, 607.0, 610.5
SEARCH = 5          # px, ±0,21 м — дальше стены уезжают и площади плывут
WELD_MOVE = 0.16    # насколько сварка вправе сдвинуть координату, м
OVERLAP = 0.05      # допустимое наложение, м
MIN_SIDE = 0.75     # уже этого помещение стать не может

rows = []
for line in io.open(RAW, encoding="utf-8").read().splitlines():
    body = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", body)
    if not m:
        rows.append((None, line)); continue
    p = [x.strip() for x in m.group(1).split(",")]
    rows.append(([float(p[0]), float(p[1]), float(p[2]), float(p[3]), int(p[4]), p[5]], line))
recs = [r for r, _ in rows if r is not None]

img  = np.array(Image.open(SCAN).convert("L")).astype(int)
dark = img < 140

def hit(axis, coord_px, a0, a1):
    lo = int(round((CZ if axis == 1 else CX) + a0 * S))
    hi = int(round((CZ if axis == 1 else CX) + a1 * S))
    lim = img.shape[0] if axis == 1 else img.shape[1]
    lo, hi = max(lo, 0), min(hi, lim)
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
    return float((strip.sum(axis=1) > 0).sum()), hi - lo

groups = {}
for r in recs:
    if r[5] == "SHF":          # шахты лифтов ни к каким линиям не тянем
        continue
    groups.setdefault((1, round(r[0], 2)), []).append((r[1], r[3]))
    groups.setdefault((1, round(r[2], 2)), []).append((r[1], r[3]))
    groups.setdefault((0, round(r[1], 2)), []).append((r[0], r[2]))
    groups.setdefault((0, round(r[3], 2)), []).append((r[0], r[2]))

value = {k: k[1] for k in groups}          # текущее значение каждой координаты

def rect(r):
    if r[5] == "SHF":
        return (r[0], r[1], r[2], r[3])
    return (value[(1, round(r[0], 2))], value[(0, round(r[1], 2))],
            value[(1, round(r[2], 2))], value[(0, round(r[3], 2))])

def clashes():
    boxes = [rect(r) for r in recs]
    for i in range(len(boxes)):
        a = boxes[i]
        # Подгонка не вправе сузить помещение: 70-сантиметровая уборная
        # получается не с чертежа, а от сдвига стены на 12 см.
        if a[2] - a[0] < MIN_SIDE or a[3] - a[1] < MIN_SIDE:
            return True
        for j in range(i + 1, len(boxes)):
            b = boxes[j]
            if recs[i][5] == "SHF" or recs[j][5] == "SHF":
                continue
            w = min(a[2], b[2]) - max(a[0], b[0])
            h = min(a[3], b[3]) - max(a[1], b[1])
            if w > OVERLAP and h > OVERLAP:
                return True
    return False

# --- сварка: щели между помещениями уже 34 см — это не стены, а артефакт
# ручного снятия. Такие координаты сводятся в одну, иначе получаются две
# параллельные стены с пустотой между ними, и дверь в одной упирается в другую.
welded = 0
for axis in (0, 1):
    keys = sorted([k for k in groups if k[0] == axis], key=lambda k: value[k])
    i = 0
    while i < len(keys):
        j = i + 1
        while j < len(keys) and value[keys[j]] - value[keys[j - 1]] <= 0.34:
            j += 1
        if j - i > 1:
            grp = keys[i:j]
            old = [value[k] for k in grp]
            # сводим не к середине, а к той координате, под которой на скане
            # больше всего линии: иначе стены уезжают с чертежа
            def support(v):
                h = t = 0.0
                for k in grp:
                    for a0, a1 in groups[k]:
                        a, b = hit(k[0], (CX if k[0] == 1 else CZ) + v * S, a0, a1)
                        h += a; t += b
                return h / t if t else 0.0
            mean = max(old, key=support)
            if max(abs(v - mean) for v in old) > WELD_MOVE:
                i = j
                continue
            for k in grp:
                value[k] = mean
            if clashes():
                for k, v in zip(grp, old):
                    value[k] = v
            else:
                welded += j - i - 1
        i = j

# порядок: сперва координаты с самыми длинными стенами — им доверяем больше
order = sorted(groups, key=lambda k: -sum(a1 - a0 for a0, a1 in groups[k]))
moved = quality = 0
for key in order:
    axis, coord = key
    base = (CX if axis == 1 else CZ) + coord * S
    cand = []
    for off in range(-SEARCH, SEARCH + 1):
        h = t = 0.0
        for a0, a1 in groups[key]:
            a, b = hit(axis, base + off, a0, a1)
            h += a; t += b
        if t >= 6:
            cand.append((h / t, abs(off), off))
    cand.sort(key=lambda c: (-c[0], c[1]))
    for score, _, off in cand:
        if score < 0.55:
            break
        new = round(coord + off / S, 3)
        old = value[key]
        value[key] = new
        if clashes():
            value[key] = old
            continue
        if abs(new - coord) > 1e-6:
            moved += 1
        quality += score
        break

out = []
for r, src in rows:
    if r is None:
        out.append(src); continue
    x0, z0, x1, z1 = rect(r)
    comment = ("  #" + src.split("#", 1)[1]) if "#" in src else ""
    out.append("\t[%6.2f, %6.2f, %6.2f, %6.2f, %d, %s],%s" % (x0, z0, x1, z1, r[4], r[5], comment))

txt = io.open(SRC, encoding="utf-8").read()
head, rest = txt.split("const ROOMS := [", 1)
_, tail = rest.split("\n]", 1)
io.open(SRC, "w", encoding="utf-8").write(head + "const ROOMS := [\n" + "\n".join(out) + "\n]" + tail)
print("координат: %d, подтянуто: %d, сварено щелей: %d, перекрытий нет" % (len(groups), moved, welded))
