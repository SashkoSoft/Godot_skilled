# -*- coding: utf-8 -*-
"""Снимает планировку со скана БТИ так, как она там нарисована.

Что важно про этот чертёж:

* стена рисуется двумя линиями, расстояние между ними — её толщина, и толщина
  непостоянная; тонкая перегородка при этом масштабе сливается в одну линию;
* помещение — замкнутая белая область внутри линий, её граница это внутренняя
  грань стены, а не ось и не внешняя грань;
* дверь — короткая чёрточка поперёк стены, линия стены при этом не рвётся;
* окно — четыре линии: две грани стены и две внутри неё.

Поэтому помещения берутся как связные белые области, а стена — это то, что
осталось между двумя областями. Толщина получается сама и своя на каждом
участке; двойных стен с пустотой внутри при таком чтении не бывает в принципе.

    python tools/trace_walls.py [--debug out.png]
"""
import io, json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
OUT = r"C:/Users/Papa/Documents/godot_skilled/game/plan_traced.json"
SRC = r"C:/Users/Papa/Documents/godot_skilled/game/tower.gd"
S, CX, CZ = 23.94, 607.0, 610.5

DARK = 150       # порог бинаризации
RUN = 10         # px, ~0,84 м: короче — не стена, а мебель, размер или подпись
MIN_AREA = 380   # px², ~0,66 м²: меньше — внутренность ванны или шкафа

# Контур дома на скане: за ним штампы, подписи и рамка листа — не помещения.
BUILD = (170, 370, 1045, 845)

V3 = np.array([[0, 1, 0], [0, 1, 0], [0, 1, 0]], bool)
H3 = np.array([[0, 0, 0], [1, 1, 1], [0, 0, 0]], bool)
X4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)


def long_runs(mask, structure, run):
    """Оставляет только пиксели, входящие в достаточно длинный штрих."""
    lab, n = ndimage.label(mask, structure=structure)
    if n == 0:
        return np.zeros_like(mask)
    size = np.bincount(lab.ravel())
    keep = size >= run
    keep[0] = False
    return keep[lab]


def largest_rect(mask):
    """Наибольший вписанный прямоугольник: гистограмма высот по строкам."""
    h, w = mask.shape
    best = (0, 0, 0, 0, 0)          # площадь, x0, z0, x1, z1
    height = np.zeros(w, int)
    for z in range(h):
        height = np.where(mask[z], height + 1, 0)
        stack = []
        for x in range(w + 1):
            cur = height[x] if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                area = hh * (x - s)
                if area > best[0]:
                    best = (area, s, z - hh + 1, x, z + 1)
                start = s
            stack.append((start, cur))
    return best


def decompose(mask, ox, oz, limit=4, keep=0.04):
    """Область — в несколько прямоугольников: Г-образные комнаты тут норма."""
    m = mask.copy()
    total = m.sum()
    out = []
    for _ in range(limit):
        area, x0, z0, x1, z1 = largest_rect(m)
        if area < max(MIN_AREA * 0.5, total * keep):
            break
        out.append((ox + x0, oz + z0, ox + x1, oz + z1))
        m[z0:z1, x0:x1] = False
        if not m.any():
            break
    return out


def px_to_m(q):
    return [round((q[0] - CX) / S, 2), round((q[1] - CZ) / S, 2),
            round((q[2] - CX) / S, 2), round((q[3] - CZ) / S, 2)]


def tag(rooms):
    """Назначение и номер квартиры переносим с текущей таблицы по перекрытию."""
    import re
    txt = io.open(SRC, encoding="utf-8").read()
    tbl = txt.split("const ROOMS := [", 1)[1].split("\n]", 1)[0]
    old = []
    for line in tbl.splitlines():
        m = re.match(r"\[(.+)\],?$", line.split("#")[0].strip())
        if m:
            p = [v.strip() for v in m.group(1).split(",")]
            old.append((float(p[0]), float(p[1]), float(p[2]), float(p[3]),
                        int(p[4]), p[5]))
    for r in rooms:
        best, score = None, 0.0
        for o in old:
            w = min(r["x1"], o[2]) - max(r["x0"], o[0])
            h = min(r["z1"], o[3]) - max(r["z0"], o[1])
            if w > 0 and h > 0 and w * h > score:
                score, best = w * h, o
        r["flat"] = best[4] if best else -1
        r["kind"] = best[5] if best else "?"
        r["cover"] = round(score / max(r["area"], 0.01), 2)


def main():
    img = np.array(Image.open(SCAN).convert("L")).astype(int)
    dark = img < DARK

    # Каркас чертежа: длинные штрихи по осям. Мебель, подписи, размерные
    # засечки и чёрточки дверей сюда не попадают — они короткие.
    struct = long_runs(dark, V3, RUN) | long_runs(dark, H3, RUN)

    lab, n = ndimage.label(~struct, structure=X4)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)

    # Наружная область — та, что выходит на край кадра.
    border = set(lab[0].tolist()) | set(lab[-1].tolist()) \
        | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())

    rooms = []
    for i, sl in enumerate(objs, start=1):
        if i in border or sizes[i - 1] < MIN_AREA:
            continue
        zs, xs = sl
        if (xs.start < BUILD[0] or zs.start < BUILD[1]
                or xs.stop > BUILD[2] or zs.stop > BUILD[3]):
            continue
        rooms.append({
            "id": i,
            "px": [int(xs.start), int(zs.start), int(xs.stop), int(zs.stop)],
            "area_px": float(sizes[i - 1]),
            "fill": float(sizes[i - 1]) / ((xs.stop - xs.start) * (zs.stop - zs.start)),
            "x0": round((xs.start - CX) / S, 2), "z0": round((zs.start - CZ) / S, 2),
            "x1": round((xs.stop - CX) / S, 2), "z1": round((zs.stop - CZ) / S, 2),
            "area": round(float(sizes[i - 1]) / (S * S), 2),
        })
    rooms.sort(key=lambda r: -r["area"])

    for r in rooms:
        r["rects"] = [px_to_m(q) for q in decompose(
            lab[r["px"][1]:r["px"][3], r["px"][0]:r["px"][2]] == r["id"],
            r["px"][0], r["px"][1])]
    tag(rooms)

    print("областей всего %d, помещений после отсева %d" % (n, len(rooms)))
    print("суммарная площадь: %.1f м²" % sum(r["area"] for r in rooms))
    print()
    print(" # |  кв | назнач | площадь | габарит, м     | прям | прямоуг-в")
    for k, r in enumerate(rooms):
        print("%2d | %3s | %-6s | %6.1f  | %5.2f x %5.2f  | %.2f | %d" % (
            k, r["flat"], r["kind"], r["area"], r["x1"] - r["x0"],
            r["z1"] - r["z0"], r["fill"], len(r["rects"])))

    if "--debug" in sys.argv:
        dst = sys.argv[sys.argv.index("--debug") + 1]
        rgb = np.dstack([img.astype(np.uint8)] * 3)
        rng = np.random.default_rng(7)
        for r in rooms:
            col = rng.integers(60, 235, 3)
            m = lab[tuple(slice(*p) for p in
                          ((r["px"][1], r["px"][3]), (r["px"][0], r["px"][2])))] == r["id"]
            sub = rgb[r["px"][1]:r["px"][3], r["px"][0]:r["px"][2]]
            sub[m] = (sub[m] * 0.45 + col * 0.55).astype(np.uint8)
        Image.fromarray(rgb).save(dst)
        print("\nотладочная картинка:", dst)

    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps({"rooms": rooms}, ensure_ascii=False, indent=1))


main()
