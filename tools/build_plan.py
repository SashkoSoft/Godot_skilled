# -*- coding: utf-8 -*-
"""Собирает стены этажа и проёмы в них по таблице ROOMS и скану БТИ.

Стены разных помещений, стоящие на одной оси, режутся на общие элементарные
участки — иначе дверь, прорезанная в стене одной комнаты, остаётся заперта
стеной соседней, лежащей там же. Для каждого участка со скана читаются
разрывы (двери) и полосы остекления (окна).

Результат — game/plan_walls.gd, единственный источник правды для Tower.
"""
import re, io, json
import numpy as np
from PIL import Image

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
SRC  = r"C:/Users/Papa/Documents/godot_skilled/game/tower.gd"
OUT  = r"C:/Users/Papa/Documents/godot_skilled/game/plan_walls.gd"
S, CX, CZ = 23.94, 607.0, 610.5
HALF   = 7          # полуширина поперечного среза, px
Q      = 0.05       # шаг привязки осей, м
MINSEG = 0.12       # короче — не участок, а щель

LIV, KIT, BAT, HAL, COR, LOG, SHF, STO = range(8)
KIND = {"LIV":LIV,"KIT":KIT,"BAT":BAT,"HAL":HAL,"COR":COR,"LOG":LOG,"SHF":SHF,"STO":STO}

txt = io.open(SRC, encoding="utf-8").read()
tbl = txt.split("const ROOMS := [", 1)[1].split("\n]", 1)[0]
ROOMS = []
for line in tbl.splitlines():
    body = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", body)
    if not m:
        continue
    p = [x.strip() for x in m.group(1).split(",")]
    ROOMS.append([float(p[0]), float(p[1]), float(p[2]), float(p[3]), int(p[4]), KIND[p[5]]])

def _load(path, thr=140):
    return np.array(Image.open(path).convert("L")).astype(int) < thr

## Источники чертежей. Общий поэтажный план — 23,94 px/м, его хватает на
## габариты, но узкие проёмы на нём не читаются. Планы отдельных квартир
## втрое крупнее; где они покрывают участок стены, читаем по ним.
## (маска, px/м, X центра корпуса в пикселях, Z центра, зона покрытия)
SOURCES = [
    {"dark": _load(r"C:/Users/Papa/AppData/Local/Temp/claude/shots/bti006.jpg"),
     "s": 58.1, "cx": 643.1, "cz": 598.9,
     "box": (-9.7, -9.4, 3.2, -0.3), "name": "трёшка 44"},
    {"dark": _load(SCAN), "s": 23.94, "cx": 607.0, "cz": 610.5,
     "box": (-99.0, -99.0, 99.0, 99.0), "name": "поэтажный"},
]
img  = np.array(Image.open(SCAN).convert("L")).astype(int)
dark = SOURCES[-1]["dark"]


def pick_source(x, z):
    for src in SOURCES:
        b = src["box"]
        if b[0] <= x <= b[2] and b[1] <= z <= b[3]:
            return src
    return SOURCES[-1]

def q(v):
    return round(round(v / Q) * Q, 2)

def room_at(x, z):
    for i, r in enumerate(ROOMS):
        if r[0] < x < r[2] and r[1] < z < r[3]:
            return i
    return -1

def slab(axis, fixed, a0, a1, off, half, src=None):
    if src is None:
        src = SOURCES[-1]
    d = src["dark"]
    sc, cx, cz = src["s"], src["cx"], src["cz"]
    if axis == 1:
        c = int(round(cx + fixed * sc)) + off
        lo, hi = int(round(cz + a0 * sc)), int(round(cz + a1 * sc))
        if c - half < 0 or c + half + 1 > d.shape[1]:
            return None
        lo, hi = max(lo, 0), min(hi, d.shape[0])
        if hi - lo < 8:
            return None
        return d[lo:hi, c - half:c + half + 1]
    c = int(round(cz + fixed * sc)) + off
    lo, hi = int(round(cx + a0 * sc)), int(round(cx + a1 * sc))
    if c - half < 0 or c + half + 1 > d.shape[0]:
        return None
    lo, hi = max(lo, 0), min(hi, d.shape[1])
    if hi - lo < 8:
        return None
    return d[c - half:c + half + 1, lo:hi].T

def runs_across(strip):
    prev = np.zeros(strip.shape[0], bool)
    n = np.zeros(strip.shape[0], int)
    for j in range(strip.shape[1]):
        col = strip[:, j]
        n += (col & ~prev)
        prev = col
    return n

def leaf_doors(axis, fixed, a0, a1, off, src):
    """Двери по штриху дверного полотна.

    На плане БТИ дверь рисуют разрывом стены плюс коротким отрезком ПОПЕРЁК
    неё — это само полотно. Штрих искать надёжнее, чем разрыв: он не зависит
    от того, слиплись ли линии стены, и сразу даёт ширину проёма.
    """
    d = src["dark"]
    sc, cx, cz = src["s"], src["cx"], src["cz"]
    lo_m, hi_m = a0, a1
    if axis == 1:
        c = int(round(cx + fixed * sc)) + off
        lo, hi = int(round(cz + lo_m * sc)), int(round(cz + hi_m * sc))
        H, W = d.shape
        if c - 2 < 0 or c + 3 > W:
            return []
        lo, hi = max(lo, 0), min(hi, H)
    else:
        c = int(round(cz + fixed * sc)) + off
        lo, hi = int(round(cx + lo_m * sc), ), int(round(cx + hi_m * sc))
        H, W = d.shape
        if c - 2 < 0 or c + 3 > H:
            return []
        lo, hi = max(lo, 0), min(hi, W)
    if hi - lo < 8:
        return []

    near = int(round(0.10 * sc)) + 2      # от оси стены до начала штриха
    far = int(round(1.15 * sc))           # дальше полотна не бывает
    wmin, wmax = 0.55 * sc, 1.15 * sc
    hits = []
    for t in range(lo, hi):
        for side in (-1, 1):
            run = 0
            best = 0
            for k in range(near, far):
                p = c + side * k
                if axis == 1:
                    v = d[t, p] if 0 <= p < W else False
                else:
                    v = d[p, t] if 0 <= p < H else False
                if v:
                    run += 1
                    best = max(best, run)
                else:
                    if run >= 3:
                        break
                    run = 0
            if wmin <= best <= wmax:
                hits.append((t, side, best))
                break
    if not hits:
        return []
    # штрих толщиной в 1-3 пикселя — группируем подряд идущие t
    groups = []
    cur = [hits[0]]
    for h in hits[1:]:
        if h[0] - cur[-1][0] <= 2:
            cur.append(h)
        else:
            groups.append(cur); cur = [h]
    groups.append(cur)

    out = []
    for g in groups:
        if len(g) > int(0.25 * sc):        # это уже не штрих, а стена
            continue
        base = sum(x[0] for x in g) / len(g)
        length = sum(x[2] for x in g) / len(g)
        # полотно навешено на один косяк; проём уходит в ту сторону,
        # где вдоль стены меньше тёмного
        def wall_darkness(fr, to):
            n = 0
            for t in range(int(fr), int(to)):
                for p in range(c - 1, c + 2):
                    if axis == 1:
                        if 0 <= t < d.shape[0] and 0 <= p < d.shape[1] and d[t, p]:
                            n += 1
                    else:
                        if 0 <= p < d.shape[0] and 0 <= t < d.shape[1] and d[p, t]:
                            n += 1
            return n
        left = wall_darkness(base - length, base)
        right = wall_darkness(base, base + length)
        centre_px = base - length / 2.0 if left < right else base + length / 2.0
        # Штрихов, похожих на полотно, на чертеже много: выносные линии
        # размеров, мебель, штриховка. Настоящая дверь — та, где стена под
        # полотном ПУСТАЯ. Требуем и разрыв, и штрих одновременно.
        gap = min(left, right)
        if gap > 0.25 * length:
            continue
        centre_m = (centre_px - (cz if axis == 1 else cx)) / sc
        out.append([round(centre_m, 3), round(length / sc, 3), 0.0])
    return out


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

def trace(axis, fixed, a0, a1, src=None):
    if src is None:
        src = SOURCES[-1]
    S = src["s"]
    """Проёмы на участке: None — оси на скане нет."""
    cands = []
    for off in range(-6, 7):
        core = slab(axis, fixed, a0, a1, off, 2, src)
        if core is None:
            continue
        cands.append(((core.sum(axis=1) > 0).mean(), abs(off), off))
    if not cands:
        return None
    top = max(c[0] for c in cands)
    if top < 0.60:
        return None
    off = min((c for c in cands if c[0] >= top - 0.02), key=lambda c: c[1])[2]
    core = slab(axis, fixed, a0, a1, off, 1, src).sum(axis=1)
    core2 = slab(axis, fixed, a0, a1, off, 2, src).sum(axis=1)
    # На плане БТИ дверь — это разрыв стены плюс короткий штрих полотна
    # ПОПЕРЁК стены. Штрих пересекает ось в одной точке и режет разрыв надвое,
    # после чего обе половины короче порога. Заклеиваем такие пересечения.
    LEAF = max(3, int(round(0.20 * S)))
    empty = core == 0
    i = 0
    while i < len(empty):
        if empty[i]:
            i += 1
            continue
        j = i
        while j < len(empty) and not empty[j]:
            j += 1
        if j - i <= LEAF and i > 0 and j < len(empty) and empty[i - 1] and empty[j]:
            empty[i:j] = True
        i = j
    wide = runs_across(slab(axis, fixed, a0, a1, off, HALF, src))
    total = len(core)
    edge = max(2, int(round(0.10 * S)))
    found = []
    for flags, kind, wmin, wmax in ((empty, 0.0, 0.55, 2.30),
                                    (wide >= 3, 1.0, 0.60, 3.40)):
        for g0, g1 in spans(flags):
            if g0 < edge and g1 > total - edge:
                continue
            w = (g1 - g0) / S
            if not (wmin <= w <= wmax):
                continue
            if kind == 0.0 and (core2[g0:g1] > 0).mean() > 0.85:
                continue
            found.append([round(((g0 + g1) / 2.0 - total / 2.0) / S, 3), round(w, 3), kind])
    found.sort(key=lambda f: (f[0], -f[2]))
    keep = []
    for f in found:
        if keep and abs(f[0] - keep[-1][0]) < 0.35:
            continue
        keep.append(f)
    return keep

# --- общая разбивка осей -----------------------------------------------------
groups = {}
for r in ROOMS:
    for axis, fixed, a0, a1 in ((1, r[0], r[1], r[3]), (1, r[2], r[1], r[3]),
                                (0, r[1], r[0], r[2]), (0, r[3], r[0], r[2])):
        groups.setdefault((axis, q(fixed)), []).append((q(a0), q(a1)))

walls = []
stats = {"segments": 0, "traced": 0, "rule": 0, "doors": 0, "wins": 0, "parapets": 0}
for (axis, fixed), segs in sorted(groups.items()):
    # проёмы читаем по всей оси разом: если резать сначала на участки,
    # дверь на стыке двух участков не находится ни в одном из них
    line_a = min(s0 for s0, _ in segs)
    line_b = max(s1 for _, s1 in segs)
    src = pick_source(fixed if axis == 1 else (line_a + line_b) / 2.0,
                      (line_a + line_b) / 2.0 if axis == 1 else fixed)
    line_holes = trace(axis, fixed, line_a, line_b, src)
    if line_holes is None and src is not SOURCES[-1]:
        src = SOURCES[-1]                      # план квартиры не покрыл — читаем общий
        line_holes = trace(axis, fixed, line_a, line_b, src)
    line_mid = (line_a + line_b) / 2.0
    pts = sorted({p for s in segs for p in s})
    cut = [pts[0]]
    for p in pts[1:]:
        if p - cut[-1] >= MINSEG:
            cut.append(p)
    for a, b in zip(cut, cut[1:]):
        if not any(s0 <= a + 1e-6 and b - 1e-6 <= s1 for s0, s1 in segs):
            continue
        mid = (a + b) / 2.0
        # соседа ищем чуть дальше, если рядом пусто: между помещениями бывает
        # щель в две-три десятых — это не комната, а огрех ручного снятия
        def side(d):
            for dist in (0.22, 0.45, 0.78):
                i = room_at(fixed + d * dist, mid) if axis == 1 else room_at(mid, fixed + d * dist)
                if i >= 0:
                    return i
            return -1
        ia, ib = side(-1), side(1)
        if ia < 0 and ib < 0 or ia == ib:
            continue
        inner = ia if ia >= 0 else ib
        outer = ib if ia >= 0 else -1
        if ROOMS[inner][5] == LOG and (outer < 0 or ROOMS[outer][5] == LOG):
            if outer < 0:
                walls.append([axis, fixed, a, b, inner, -1, 2, []])
                stats["parapets"] += 1
            continue
        facade = (abs(fixed) > 16.9) if axis == 1 else (abs(fixed) > 7.9)
        if outer >= 0:
            facade = False
        seg_holes = trace(axis, fixed, a, b, src)
        if seg_holes is None and src is not SOURCES[-1]:
            seg_holes = trace(axis, fixed, a, b, SOURCES[-1])
        if seg_holes is None and line_holes is None:
            stats["rule"] += 1
            holes = []
            mode = 0            # проёмы поставит правило в Tower
        else:
            stats["traced"] += 1
            mode = 1
            seg_mid = (a + b) / 2.0
            found = list(seg_holes or [])
            # на фасаде полотен не бывает: там окна, и их «створки»
            # детектор принимает за двери
            for lf in ([] if facade else leaf_doors(axis, fixed, a, b, 0, src)):
                c_abs = lf[0]
                if a + 0.05 <= c_abs <= b - 0.05:
                    found.append([round(c_abs - seg_mid, 3), lf[1], 0.0])
            for h in (line_holes or []):
                c = line_mid + h[0]
                if a + 0.05 <= c <= b - 0.05:
                    found.append([round(c - seg_mid, 3),
                                  round(min(h[1], b - a - 0.10), 3), h[2]])
            found.sort(key=lambda f: (f[0], -f[2]))
            holes = []
            for h in found:
                if h[1] < 0.5:
                    continue
                if holes and abs(h[0] - holes[-1][0]) < 0.35:
                    continue
                holes.append(h)
                stats["wins" if h[2] else "doors"] += 1
        walls.append([axis, fixed, a, b, inner, outer, 1 if facade else 0, holes, mode])
        stats["segments"] += 1

lines = []
for w in walls:
    if len(w) == 8:
        w = w + [1]
    holes = ", ".join("Vector3(%.3f, %.3f, %.1f)" % tuple(h) for h in w[7])
    lines.append("\t[%d, %6.2f, %6.2f, %6.2f, %d, %d, %d, [%s], %d]," %
                 (w[0], w[1], w[2], w[3], w[4], w[5], w[6], holes, w[8]))
io.open(OUT, "w", encoding="utf-8").write(
    "class_name PlanWalls\nextends RefCounted\n"
    "## Стены этажа и проёмы в них, снятые с поэтажного плана БТИ.\n"
    "## [ось, координата, начало, конец, помещение, соседнее помещение,\n"
    "##  тип (0 внутренняя, 1 наружная, 2 парапет лоджии), проёмы, снято_с_чертежа]\n"
    "## Проём — Vector3(смещение от середины участка, ширина, 0 дверь / 1 окно).\n"
    "## Сгенерировано tools/build_plan.py — руками не править.\n\n"
    "const WALLS := [\n" + "\n".join(lines) + "\n]\n")
print(json.dumps(stats, ensure_ascii=False))
