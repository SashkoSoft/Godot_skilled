# -*- coding: utf-8 -*-
"""Снимает двери и окна с поэтажного плана БТИ вдоль осей стен, которые строит tower.gd.

На скане стена нарисована двумя линиями, окно — тремя-четырьмя (остекление),
дверной проём — разрыв. Поэтому классифицируем по числу тёмных полос поперёк
стены: 0 — проём, 1-2 — глухая стена, 3 и больше — окно.
"""
import re, io, json
import numpy as np
from PIL import Image

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
SRC  = r"C:/Users/Papa/Documents/godot_skilled/game/tower.gd"
OUT  = r"C:/Users/Papa/Documents/godot_skilled/game/plan_openings.gd"
S      = 23.94          # пикселей на метр
CX, CZ = 607.0, 610.5   # центр корпуса на скане
HALF   = 7              # полуширина поперечного среза, px

KIND = {"LIV":0,"KIT":1,"BAT":2,"HAL":3,"COR":4,"LOG":5,"SHF":6}

txt = io.open(SRC, encoding="utf-8").read()
tbl = txt.split("const ROOMS := [", 1)[1].split("\n]", 1)[0]
ROOMS = []
for line in tbl.splitlines():
    line = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", line)
    if not m:
        continue
    p = [x.strip() for x in m.group(1).split(",")]
    ROOMS.append([float(p[0]), float(p[1]), float(p[2]), float(p[3]), int(p[4]), KIND[p[5]]])

img  = np.array(Image.open(SCAN).convert("L")).astype(int)
dark = img < 140

def room_at(x, z):
    for i, r in enumerate(ROOMS):
        if r[0] < x < r[2] and r[1] < z < r[3]:
            return i
    return -1

def slab(axis, fixed, a0, a1, off, half):
    """Поперечный срез стены: [точка вдоль стены][толщина]."""
    if axis == 1:
        c = int(round(CX + fixed * S)) + off
        lo, hi = int(round(CZ + a0 * S)), int(round(CZ + a1 * S))
        if c - half < 0 or c + half + 1 > img.shape[1]:
            return None
        lo, hi = max(lo, 0), min(hi, img.shape[0])
        if hi - lo < 8:
            return None
        return dark[lo:hi, c - half:c + half + 1]
    else:
        c = int(round(CZ + fixed * S)) + off
        lo, hi = int(round(CX + a0 * S)), int(round(CX + a1 * S))
        if c - half < 0 or c + half + 1 > img.shape[0]:
            return None
        lo, hi = max(lo, 0), min(hi, img.shape[1])
        if hi - lo < 8:
            return None
        return dark[c - half:c + half + 1, lo:hi].T


def runs_across(strip):
    """Сколько тёмных полос пересекает срез в каждой точке вдоль стены."""
    prev = np.zeros(strip.shape[0], bool)
    n = np.zeros(strip.shape[0], int)
    for j in range(strip.shape[1]):
        col = strip[:, j]
        n += (col & ~prev)
        prev = col
    return n

def spans(flags):
    out, s = [], None
    for i, v in enumerate(flags):
        if v and s is None:
            s = i
        if not v and s is not None:
            out.append((s, i)); s = None
    if s is not None:
        out.append((s, len(flags)))
    return out

def detect(axis, fixed, a0, a1):
    """Ось стены ищем на скане, потом читаем на ней разрывы и остекление."""
    cands = []
    for off in range(-6, 7):
        core = slab(axis, fixed, a0, a1, off, 2)
        if core is None:
            continue
        cands.append(((core.sum(axis=1) > 0).mean(), abs(off), off))
    if not cands:
        return None
    top = max(c[0] for c in cands)
    if top < 0.60:
        return None                      # оси стены на скане нет — строим по правилу
    best = min((c for c in cands if c[0] >= top - 0.02), key=lambda c: c[1])
    off = best[2]
    core = slab(axis, fixed, a0, a1, off, 1).sum(axis=1)
    core2 = slab(axis, fixed, a0, a1, off, 2).sum(axis=1)
    wide = runs_across(slab(axis, fixed, a0, a1, off, HALF))
    total = len(core)
    edge = max(2, int(round(0.10 * S)))
    found = []
    for flags, kind, wmin, wmax in ((core == 0, 0.0, 0.60, 2.20),
                                    (wide >= 3, 1.0, 0.60, 3.40)):
        for g0, g1 in spans(flags):
            if g0 < edge and g1 > total - edge:
                continue                 # «проём» во всю стену — промах, а не проём
            w = (g1 - g0) / S
            if not (wmin <= w <= wmax):
                continue
            if kind == 0.0 and (core2[g0:g1] > 0).mean() > 0.55:
                continue          # в «проёме» всё-таки идёт линия — это не дверь
            centre = ((g0 + g1) / 2.0 - total / 2.0) / S
            found.append([round(centre, 3), round(w, 3), kind])
    # окно и дверь на одном месте — оставляем окно
    found.sort(key=lambda f: (f[0], -f[2]))
    keep = []
    for f in found:
        if keep and abs(f[0] - keep[-1][0]) < 0.35:
            continue
        keep.append(f)
    return keep


seen, table = set(), {}
stats = {"traced": 0, "rule": 0, "doors": 0, "wins": 0}
for r in ROOMS:
    for axis, fixed, a0, a1 in ((1, r[0], r[1], r[3]), (1, r[2], r[1], r[3]),
                                (0, r[1], r[0], r[2]), (0, r[3], r[0], r[2])):
        key = "%d|%.2f|%.2f|%.2f" % (axis, fixed, a0, a1)
        if key in seen or a1 - a0 < 0.25:
            continue
        seen.add(key)
        mid = (a0 + a1) / 2.0
        if axis == 1:
            ia, ib = room_at(fixed - 0.22, mid), room_at(fixed + 0.22, mid)
        else:
            ia, ib = room_at(mid, fixed - 0.22), room_at(mid, fixed + 0.22)
        if ia < 0 and ib < 0:
            continue
        inner = ia if ia >= 0 else ib
        outer = ib if ia >= 0 else -1
        if ROOMS[inner][5] == 5 and (outer < 0 or ROOMS[outer][5] == 5):
            continue
        res = detect(axis, fixed, a0, a1)
        if res is None:
            stats["rule"] += 1
            continue
        stats["traced"] += 1
        for o in res:
            stats["wins" if o[2] else "doors"] += 1
        table[key] = res

lines = []
for k in sorted(table):
    v = table[k]
    items = ", ".join("Vector3(%.3f, %.3f, %.1f)" % (o[0], o[1], o[2]) for o in v)
    lines.append('\t"%s": [%s],' % (k, items))
io.open(OUT, "w", encoding="utf-8").write(
    "class_name PlanOpenings\nextends RefCounted\n"
    "## Двери и окна, снятые с поэтажного плана БТИ.\n"
    "## Ключ — ось стены: \"ось|координата|начало|конец\" (как в Tower._emit_walls).\n"
    "## Значение — Vector3(смещение от середины стены, ширина, 0 дверь / 1 окно).\n"
    "## Сгенерировано tools/trace_openings.py — руками не править.\n\n"
    "const TRACED := {\n" + "\n".join(lines) + "\n}\n")
print(json.dumps(stats))
