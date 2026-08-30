# -*- coding: utf-8 -*-
"""Двери напрямую: чёрточка торчит из стены на обе стороны.

Идём вдоль стены и в каждой точке смотрим пиксели сразу за её гранями с двух
сторон. Тёмное с обеих — здесь чёрточка, то есть дверь. Ни длина штриха, ни
его вытянутость не проверяются: на этом масштабе обломки бывают в 2-3 пикселя.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
S, CX, CZ = 23.94, 607.0, 610.5
BUILD = (170, 370, 1045, 845)
DARK, RUN, NET = 150, 16, 2000
WIDE = 0.75 * S
V3 = np.array([[0, 1, 0], [0, 1, 0], [0, 1, 0]], bool)
H3 = np.array([[0, 0, 0], [1, 1, 1], [0, 0, 0]], bool)
X4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
X8 = np.ones((3, 3), bool)


def keep(m, st, lo):
    l, n = ndimage.label(m, structure=st)
    sz = np.bincount(l.ravel())
    k = sz >= lo
    k[0] = False
    return k[l]


img = np.array(Image.open(SCAN).convert("L")).astype(int)
dark = img < DARK
struct = keep(keep(dark, V3, RUN) | keep(dark, H3, RUN), X8, 300)
foot = np.zeros_like(struct)
foot[BUILD[1]:BUILD[3], BUILD[0]:BUILD[2]] = struct[BUILD[1]:BUILD[3], BUILD[0]:BUILD[2]]
foot = ndimage.binary_fill_holes(foot)
lab, n = ndimage.label(~struct, structure=X4)
border = set(lab[0].tolist()) | set(lab[-1].tolist()) \
    | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
room_ids = []
for i, sl in enumerate(ndimage.find_objects(lab), start=1):
    if i in border:
        continue
    zs, xs = sl
    if (xs.start < BUILD[0] or zs.start < BUILD[1]
            or xs.stop > BUILD[2] or zs.stop > BUILD[3]):
        continue
    pad = np.zeros((zs.stop - zs.start + 2, xs.stop - xs.start + 2), bool)
    pad[1:-1, 1:-1] = lab[sl] == i
    if 2.0 * ndimage.distance_transform_edt(pad).max() >= WIDE:
        room_ids.append(i)
is_room = np.isin(lab, room_ids)
wall = keep(foot & ~is_room, X8, NET)

# Для ЗАЛИВКИ стен нужен мелкий порог длины штриха: при крупном коридор,
# межквартирные полосы и ядро сливаются в одну область на 91 м², и толстые
# стены остаются незакрашенными. Для поиска ДВЕРЕЙ мелкий порог не годится —
# в каркас лезет мебель, — поэтому чёрточки ищем по крупному, выше.
_s6 = keep(keep(dark, V3, 6) | keep(dark, H3, 6), X8, 300)
_f6 = np.zeros_like(_s6)
_f6[BUILD[1]:BUILD[3], BUILD[0]:BUILD[2]] = _s6[BUILD[1]:BUILD[3], BUILD[0]:BUILD[2]]
_f6 = ndimage.binary_fill_holes(_f6)
_l6, _n6 = ndimage.label(~_s6, structure=X4)
_b6 = set(_l6[0].tolist()) | set(_l6[-1].tolist())     | set(_l6[:, 0].tolist()) | set(_l6[:, -1].tolist())
_ids6 = []
for _i, _sl in enumerate(ndimage.find_objects(_l6), start=1):
    if _i in _b6:
        continue
    _zs, _xs = _sl
    if (_xs.start < BUILD[0] or _zs.start < BUILD[1]
            or _xs.stop > BUILD[2] or _zs.stop > BUILD[3]):
        continue
    _pad = np.zeros((_zs.stop - _zs.start + 2, _xs.stop - _xs.start + 2), bool)
    _pad[1:-1, 1:-1] = _l6[_sl] == _i
    if 2.0 * ndimage.distance_transform_edt(_pad).max() >= 0.75 * S:
        _ids6.append(_i)
wall_fill = keep(_f6 & ~np.isin(_l6, _ids6), X8, NET)

H, W = wall.shape

# Чёрточка двери длиной около 0,7 м попадает в каркас и прирастает к стене.
# Поэтому она видна как местное УТОЛЩЕНИЕ полосы стены: на один-два пикселя
# вдоль стены полоса становится толще на длину вылета чёрточки, а потом
# возвращается к своей толщине. Пересекающая стена так себя не ведёт — она
# толстая на всём протяжении.
BUMP_MIN, BUMP_MAX = 5, 22       # px, насколько утолщается полоса
BUMP_WIDE = 3                    # px, ширина утолщения вдоль стены


def bands(vec, lo, hi, limit=44):
    """Отрезки подряд идущих True: (начало, конец)."""
    out, i = [], lo
    while i < hi:
        if not vec[i]:
            i += 1
            continue
        j = i
        while j < hi and vec[j]:
            j += 1
        if j - i <= limit:
            out.append((i, j - 1))
        i = j
    return out


def find_ticks(vertical, wall=None):
    """Утолщения полосы стены — дверные чёрточки."""
    if wall is None:
        wall = globals()["wall"]
    res = []
    n = (W if not vertical else H)
    segs = {}
    for a in range(BUILD[0] if not vertical else BUILD[1],
                   BUILD[2] if not vertical else BUILD[3]):
        vec = wall[:, a] if not vertical else wall[a]
        lo, hi = (BUILD[1], BUILD[3]) if not vertical else (BUILD[0], BUILD[2])
        for c0, c1 in bands(vec, lo, hi):
            key = round((c0 + c1) / 2.0 / 3.0)
            segs.setdefault(key, []).append((a, (c0 + c1) / 2.0, c1 - c0 + 1))
    for key, items in segs.items():
        items.sort()
        th = np.array([t for _, _, t in items], float)
        if th.size < 8:
            continue
        med = np.median(th)
        flag = (th >= med + BUMP_MIN) & (th <= med + BUMP_MAX)
        i = 0
        while i < flag.size:
            if not flag[i]:
                i += 1
                continue
            j = i
            while j < flag.size and flag[j]:
                j += 1
            if j - i <= BUMP_WIDE:
                a = np.mean([items[k][0] for k in range(i, j)])
                c = np.median([items[k][1] for k in range(i, j)])
                res.append((0 if not vertical else 1, a, c))
            i = j
    return res


# Ищем по обоим разборам: крупный чист от мебели, мелкий видит толстые стены,
# которых в крупном нет (там они сливаются с помещениями).
hits = (find_ticks(False, wall) + find_ticks(True, wall)
        + find_ticks(False, wall_fill) + find_ticks(True, wall_fill))
_seen, _uniq = [], []
for h in hits:
    if any(a == h[0] and abs(b - h[1]) < 4 and abs(c - h[2]) < 4 for a, b, c in _seen):
        continue
    _seen.append(h)
    _uniq.append(h)
hits = _uniq

# соседние попадания — одна и та же чёрточка
doors = []
for axis in (0, 1):
    hs = sorted([h for h in hits if h[0] == axis], key=lambda h: (round(h[2]), h[1]))
    cur = []
    for h in hs:
        if cur and abs(h[1] - cur[-1][1]) <= 2 and abs(h[2] - cur[-1][2]) <= 2:
            cur.append(h)
        else:
            if cur:
                doors.append((axis, np.mean([c[1] for c in cur]),
                              np.mean([c[2] for c in cur]), len(cur)))
            cur = [h]
    if cur:
        doors.append((axis, np.mean([c[1] for c in cur]),
                      np.mean([c[2] for c in cur]), len(cur)))

box = [int(v) for v in sys.argv[1:5]]
sel = [d for d in doors if (box[0] <= (d[1] if d[0] == 0 else d[2]) <= box[2]
                            and box[1] <= (d[2] if d[0] == 0 else d[1]) <= box[3])]
print("чёрточек всего по этажу: %d, в куске: %d" % (len(doors), len(sel)))
for axis, along, across, k in sorted(sel, key=lambda d: (d[0], d[1])):
    x, z = (along, across) if axis == 0 else (across, along)
    print("   %s стена  X %7.2f  Z %7.2f   пикселей %d"
          % ("гориз." if axis == 0 else "верт. ", (x - CX) / S, (z - CZ) / S, k))

# --- ширина проёма ---------------------------------------------------------
# Косяк — тёмная метка ВНУТРИ полосы стены, которая не продолжается за её
# грани. Стена, пересекающая эту, продолжается; чёрточка двери — тоже.
# Порог берём относительный: внутренность стены на скане серая, а косяк
# заметно темнее.

def band(across, along, vert):
    """Границы полосы стены поперёк неё в данной точке."""
    line = wall[:, along] if vert else wall[:, :][:, 0] * 0
    if vert:
        col = wall[:, int(along)]
        c = int(round(across))
    else:
        col = wall[:, 0] * 0
    return None


def _pair(inside, out_a, out_b, pos):
    """Пара косяков вокруг чёрточки на одной линии внутри стены."""
    lo = max(int(pos) - 30, 0)
    hi = min(int(pos) + 31, inside.size)
    seg = inside[lo:hi]
    thr = np.median(seg) - 45
    cand = []
    for i in range(seg.size):
        p = lo + i
        if seg[i] >= thr or out_a[p] or out_b[p] or abs(p - pos) <= 2:
            continue
        cand.append(float(p))
    grp, cur = [], []
    for c in cand:
        if cur and c - cur[-1] <= 1.5:
            cur.append(c)
        else:
            if cur:
                grp.append(sum(cur) / len(cur))
            cur = [c]
    if cur:
        grp.append(sum(cur) / len(cur))
    best = None
    for i, aa in enumerate(grp):
        for bb in grp[i + 1:]:
            d = bb - aa
            if d < 0.45 * S or d > 1.6 * S:
                continue
            sc = abs((aa + bb) / 2.0 - pos)
            if sc > 2.5:
                continue
            if best is None or sc < best[0]:
                best = (sc, aa, bb, d / S)
    return best


def opening(zc, xc, vert):
    """Ширина проёма: перебираем линии внутри полосы стены и берём ту,
    где пара тёмных меток симметрична чёрточке. Метка, продолжающаяся за
    грань стены, — это пересекающая стена, а не косяк."""
    if vert:
        # полосу берём в стороне от чёрточки: в ней самой стена утолщена
        row = wall[zc]
        base = int(xc)
        for d in (5, -5, 7, -7):
            if 0 <= zc + d < wall.shape[0] and wall[zc + d, base]:
                row = wall[zc + d]
                break
        x0 = x1 = base
        while x0 > 0 and row[x0 - 1]:
            x0 -= 1
        while x1 + 1 < wall.shape[1] and row[x1 + 1]:
            x1 += 1
        if x1 - x0 < 2:
            return None
        # отступаем на 2 px: вплотную к полосе лежит её же грань
        out_a = dark[:, max(x0 - 5, 0):max(x0 - 2, 0)].any(axis=1)
        out_b = dark[:, x1 + 3:x1 + 6].any(axis=1)
        best = None
        for c in range(x0, x1 + 1):
            r = _pair(img[:, c].astype(float), out_a, out_b, zc)
            if r and (best is None or r[0] < best[0]):
                best = r
        return best
    col = wall[:, xc]
    base = int(zc)
    for d in (5, -5, 7, -7):
        if 0 <= xc + d < wall.shape[1] and wall[base, xc + d]:
            col = wall[:, xc + d]
            break
    z0 = z1 = base
    while z0 > 0 and col[z0 - 1]:
        z0 -= 1
    while z1 + 1 < wall.shape[0] and col[z1 + 1]:
        z1 += 1
    if z1 - z0 < 2:
        return None
    out_a = dark[max(z0 - 5, 0):max(z0 - 2, 0), :].any(axis=0)
    out_b = dark[z1 + 3:z1 + 6, :].any(axis=0)
    best = None
    for r0 in range(z0, z1 + 1):
        r = _pair(img[r0, :].astype(float), out_a, out_b, xc)
        if r and (best is None or r[0] < best[0]):
            best = r
    return best


print()
print("проёмы в куске:")
for axis, along, across, k in sorted(sel, key=lambda d: (d[0], d[1])):
    x, z = (along, across) if axis == 0 else (across, along)
    r = opening(int(round(z)), int(round(x)), axis == 1)
    if r:
        print("   X %7.2f  Z %7.2f   ширина %.2f м" % ((x - CX) / S, (z - CZ) / S, r[3]))
    else:
        print("   X %7.2f  Z %7.2f   ширина не снялась" % ((x - CX) / S, (z - CZ) / S))

# --- дверцы кладовок -------------------------------------------------------
# Кладовка нарисована маленькой коробкой одиночной линией, а её дверца — не
# одна чёрточка, а несколько коротких штрихов поперёк этой линии. Ищем сами
# коробки, потом сторону, из которой торчат штрихи.
closets = []
for i, sl in enumerate(ndimage.find_objects(lab), start=1):
    zs, xs = sl
    w, h = xs.stop - xs.start, zs.stop - zs.start
    if not (0.30 * S <= min(w, h) <= 0.95 * S and 0.55 * S <= max(w, h) <= 2.3 * S):
        continue
    if np.isin(i, room_ids):
        continue
    m = lab[sl] == i
    if m.mean() < 0.75:
        continue
    ring = np.zeros(lab.shape, bool)
    ring[sl] = m
    around = ndimage.binary_dilation(ring, X8, 3) & ~ring
    if wall[around].mean() < 0.75:
        continue                       # коробка должна сидеть в стене
    # сторона с штрихами: там за стеной тёмное несколькими отрезками
    best, side = 0, None
    for nm, (dz, dx) in (("z-", (-1, 0)), ("z+", (1, 0)), ("x-", (0, -1)), ("x+", (0, 1))):
        cnt = 0
        for t in range(4, 9):
            zz = slice(zs.start, zs.stop) if dz == 0 else                 slice(zs.start - t, zs.start - t + 1) if dz < 0 else slice(zs.stop + t - 1, zs.stop + t)
            xx = slice(xs.start, xs.stop) if dx == 0 else                 slice(xs.start - t, xs.start - t + 1) if dx < 0 else slice(xs.stop + t - 1, xs.stop + t)
            if zz.start < 0 or xx.start < 0:
                continue
            cnt += int(dark[zz, xx].sum())
        if cnt > best:
            best, side = cnt, (dz, dx)
    if side is None or best < 6:
        continue
    closets.append((sl, side))

# --- сантехника и плиты ----------------------------------------------------
# Пиктограммы на чертеже одинаковые, поэтому ищем их сопоставлением с
# эталоном, вырезанным из самого чертежа. Половины дома зеркальны, а квартиры
# развёрнуты по-разному, поэтому каждый эталон примеряется в восьми
# положениях: четыре поворота и зеркало к ним.
import cv2
_gray = img.astype(np.uint8)
_TX, _TY, _TS = 246, 564, 0.230        # привязка кадра с пиктограммами


def _tbox(a, b, c, d):
    return (int(_TX + a * _TS), int(_TY + b * _TS),
            int(_TX + c * _TS), int(_TY + d * _TS))


# порог у каждой свой: подобран так, чтобы находилось по одной на квартиру
FIXTURES = {
    "ванна":    (_tbox(103, 16, 157, 152), 0.84, (0, 150, 195)),
    "унитаз":   (_tbox(270, 86, 328, 172), 0.76, (155, 40, 175)),
    "мойка":    (_tbox(20, 86, 90, 154), 0.80, (20, 155, 85)),
    "раковина": (_tbox(163, 104, 220, 164), 0.92, (0, 115, 115)),
    "плита":    (_tbox(6, 14, 74, 82), 0.74, (235, 120, 20)),
}

fixtures = []
for _name, (_bx, _thr, _col) in FIXTURES.items():
    _t = _gray[_bx[1]:_bx[3], _bx[0]:_bx[2]]
    _hits = []
    for _f in (_t, cv2.flip(_t, 1)):
        for _k in range(4):
            _v = np.rot90(_f, _k).copy()
            _r = cv2.matchTemplate(_gray, _v, cv2.TM_CCOEFF_NORMED)
            _ys, _xs = np.nonzero(_r >= _thr)
            for _y, _x in zip(_ys, _xs):
                _cy, _cx = _y + _v.shape[0] / 2.0, _x + _v.shape[1] / 2.0
                if not (BUILD[0] < _cx < BUILD[2] and BUILD[1] < _cy < BUILD[3]):
                    continue
                _hits.append((_r[_y, _x], _y, _x, _v.shape))
    _hits.sort(reverse=True, key=lambda h: h[0])
    _keep = []
    for _sc, _y, _x, _sh in _hits:
        _cy, _cx = _y + _sh[0] / 2.0, _x + _sh[1] / 2.0
        if any((_cy - k[0]) ** 2 + (_cx - k[1]) ** 2 <= 49 for k in _keep):
            continue
        _keep.append((_cy, _cx))
        fixtures.append((_name, _y, _x, _sh, _col))
_cnt = {}
for _n, *_ in fixtures:
    _cnt[_n] = _cnt.get(_n, 0) + 1
print("приборов: " + ", ".join("%s %d" % kv for kv in sorted(_cnt.items())))

rgb = np.dstack([img.astype(np.uint8)] * 3)
rgb[wall_fill] = (rgb[wall_fill] * 0.25 + np.array([40, 85, 180]) * 0.75).astype(np.uint8)
_measured = []
for axis, along, across, k in doors:
    x, z = (along, across) if axis == 0 else (across, along)
    xi, zi = int(round(x)), int(round(z))
    r = opening(zi, xi, axis == 1)
    if not r:
        continue
    _, aa, bb, wm = r
    if axis == 1:
        sub = (slice(int(round(aa)), int(round(bb)) + 1), slice(xi - 12, xi + 13))
    else:
        sub = (slice(zi - 12, zi + 13), slice(int(round(aa)), int(round(bb)) + 1))
    m = wall[sub]
    rgb[sub][m] = np.array([215, 20, 20])
    _measured.append(((x - CX) / S, (z - CZ) / S, wm))

for sl, (dz, dx) in closets:
    zs, xs = sl
    if dz < 0:
        sub = (slice(max(zs.start - 4, 0), zs.start), slice(xs.start, xs.stop))
    elif dz > 0:
        sub = (slice(zs.stop, zs.stop + 4), slice(xs.start, xs.stop))
    elif dx < 0:
        sub = (slice(zs.start, zs.stop), slice(max(xs.start - 4, 0), xs.start))
    else:
        sub = (slice(zs.start, zs.stop), slice(xs.stop, xs.stop + 4))
    rgb[sub] = np.array([215, 20, 20])
for _n, _y, _x, _sh, _col in fixtures:
    _reg = (slice(_y, _y + _sh[0]), slice(_x, _x + _sh[1]))
    _ink = dark[_reg]
    _sub = rgb[_reg]
    _sub[_ink] = np.array(_col)
print("проёмов с измеренной шириной по этажу: %d, дверец кладовок: %d"
      % (len(_measured), len(closets)))
out = Image.fromarray(rgb).crop(tuple(box))
zoom = int(sys.argv[6]) if len(sys.argv) > 6 else 8
out = out.resize((out.width * zoom, out.height * zoom), Image.LANCZOS)
out.save(sys.argv[5])


