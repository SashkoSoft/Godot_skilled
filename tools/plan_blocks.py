# -*- coding: utf-8 -*-
"""Блочная модель двух квартир: этаж это список помещений, а не пиксели.

Каждый блок — прямоугольник с назначением. Стена не ищется на скане: она есть
зазор между блоками. Дверь и окно — проём на границе конкретной пары блоков,
заданный по оси стены; знак двери на чертеже в модель не попадает вовсе.

Реперы сняты со скана: вход в квартиру X=-9.72 (стена 0.34), стена между
комнатами X=-13.39 (дверь -13.32), балконная дверь X=-16.44, двери комнат
Z=-3.16, двери санузлов Z=-2.01. Паспортные размеры: 2.80x5.52 и 3.42x5.54.
Нижняя квартира — зеркало верхней относительно Z=0.

    python tools/plan_blocks.py
"""
import io, json
import numpy as np
from PIL import Image
from scipy import ndimage

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
OUT_JSON = r"C:/Users/Papa/Documents/godot_skilled/game/plan_left.json"
OUT_PNG = (r"C:/Users/Papa/AppData/Local/Temp/claude/C--Users-Papa-Documents-"
           r"godot-skilled/40f45dbe-a11a-4213-9104-d3637346c744/scratchpad/blocks2d.png")
S, CX, CZ = 23.94, 607.0, 610.5

# --- верхняя квартира (46); нижняя — зеркало Z -> -Z -----------------------
FLAT = [
    ("лоджия",   -17.92, -8.67, -16.61, -3.39),
    ("комната1", -16.27, -8.76, -13.47, -3.24),   # 2.80 x 5.52 = 14.0
    ("комната2", -13.31, -8.78, -9.89, -3.24),    # 3.42 x 5.54 = 18.5
    ("кухня",    -17.32, -3.03, -14.42, -0.33),
    ("ванная",   -14.12, -1.94, -12.78, -0.31),
    ("уборная",  -12.61, -1.94, -11.90, -0.31),
    ("прихожая", -14.26, -3.08, -9.89, -2.10),    # коридор вдоль комнат
    ("прихожая", -11.74, -2.20, -9.89, -0.31),    # рукав к входной двери
]
# приборы: каждый принадлежит блоку и стоит по чертежу
FIXTURES = [
    ("ванна",    -14.08, -1.73, -13.62, -0.48),
    ("раковина", -13.66, -0.91, -13.16, -0.41),
    ("унитаз",   -12.45, -0.98, -12.00, -0.48),
    ("мойка",    -14.86, -1.06, -14.30, -0.56),
    ("плита",    -14.98, -1.78, -14.42, -1.22),
]
CLOSETS = [   # ниша, дверца вправо (к входной двери)
    ("1а", -14.95, -3.99, -14.24, -3.09, "x+"),
    ("6а", -11.90, -0.98, -11.44, -0.06, "x+"),
]
# (ось стены, координата оси стены, центр проёма вдоль стены, ширина)
DOORS = [
    ("x", -9.72,  -0.61, 0.88),   # вход в квартиру
    ("z", -3.16, -13.95, 0.71),   # прихожая -> комната 1
    ("z", -3.16, -11.28, 0.81),   # прихожая -> комната 2
    ("x", -13.39, -3.97, 0.94),   # комната 1 -> комната 2, ближе к выходу
    ("x", -14.27, -2.65, 0.81),   # прихожая -> кухня
    ("z", -2.01, -13.24, 0.63),   # прихожая -> ванная
    ("z", -2.01, -12.26, 0.63),   # прихожая -> уборная
    ("x", -16.44, -4.89, 1.13),   # комната 1 -> лоджия, балконная
]
WINDOWS = [
    ("z", -8.93, -11.61, 1.70),   # комната 2 -> улица (север)
    ("x", -17.49, -1.25, 1.45),   # кухня -> улица (запад)
    ("x", -16.44, -6.30, 1.20),   # комната 1 -> лоджия, с простенком от двери
]
WALL_H, DOOR_H, SILL, LINTEL = 2.84, 2.27, 0.85, 2.39
GRID = 0.02
PAD = 0.36                       # рост пятна: полтолщины самой толстой стены
CLIP = (-18.00, -9.12, -9.38, 9.12)   # x0, z0, x1, z1 контура секции


def zmirror(t, i0, i1):
    t = list(t)
    t[i0], t[i1] = -t[i1], -t[i0]
    return tuple(t)


def main():
    img = np.array(Image.open(SCAN).convert("L")).astype(np.uint8)

    blocks = [("46",) + b for b in FLAT] + \
             [("42", b[0]) + zmirror(b[1:], 1, 3) for b in FLAT]
    closets = [c for c in CLOSETS] + \
              [(c[0],) + zmirror(c[1:5], 1, 3) + (c[5],) for c in CLOSETS]
    doors = list(DOORS)
    wins = list(WINDOWS)
    for a, w, c, ww in DOORS:
        if a == "z":
            doors.append((a, -w, c, ww))
        else:
            doors.append((a, w, -c, ww))
    for a, w, c, ww in WINDOWS:
        if a == "z":
            wins.append((a, -w, c, ww))
        else:
            wins.append((a, w, -c, ww))

    xs0, zs0 = CLIP[0] - 0.1, CLIP[1] - 0.1
    xs1, zs1 = CLIP[2] + 0.1, CLIP[3] + 0.1
    W = int((xs1 - xs0) / GRID) + 1
    H = int((zs1 - zs0) / GRID) + 1

    def ix(x):
        return int(round((x - xs0) / GRID))

    def iz(z):
        return int(round((z - zs0) / GRID))

    free = np.zeros((H, W), bool)
    for _, _, x0, z0, x1, z1 in blocks:
        free[iz(z0):iz(z1), ix(x0):ix(x1)] = True

    grown = ndimage.binary_dilation(free, np.ones((3, 3), bool),
                                    iterations=int(PAD / GRID))
    grown[:iz(CLIP[1])] = False
    grown[iz(CLIP[3]):] = False
    grown[:, :ix(CLIP[0])] = False
    grown[:, ix(CLIP[2]):] = False
    foot = ndimage.binary_fill_holes(grown)
    wall = foot & ~free

    # кладовка — ниша в стене: внутренность вычитается, стенки остаются
    closet_in = np.zeros((H, W), bool)
    for _, x0, z0, x1, z1, _side in closets:
        closet_in[iz(z0):iz(z1), ix(x0):ix(x1)] = True
    wall &= ~closet_in

    def cut(axis, wpos, c0, wdt, out):
        if axis == "z":
            sl = (slice(iz(wpos - 0.28), iz(wpos + 0.28)),
                  slice(ix(c0 - wdt / 2), ix(c0 + wdt / 2)))
        else:
            sl = (slice(iz(c0 - wdt / 2), iz(c0 + wdt / 2)),
                  slice(ix(wpos - 0.28), ix(wpos + 0.28)))
        m = wall[sl].copy()
        wall[sl] = False
        out.append((axis, wpos, c0, wdt))

    door_out, win_out = [], []
    for d in doors:
        cut(*d, door_out)
    for v in wins:
        cut(*v, win_out)

    # --- контроль поверх скана --------------------------------------------
    over = np.dstack([img] * 3).astype(int)
    pal = {"кухня": (250, 218, 228), "прихожая": (250, 220, 180),
           "лоджия": (198, 238, 192), "ванная": (180, 220, 240),
           "уборная": (180, 220, 240)}

    def rp(x0, z0, x1, z1):
        return (int(round(CX + x0 * S)), int(round(CZ + z0 * S)),
                int(round(CX + x1 * S)), int(round(CZ + z1 * S)))

    for _, kind, x0, z0, x1, z1 in blocks:
        p = rp(x0, z0, x1, z1)
        col = np.array(pal.get(kind, (255, 255, 255)))
        over[p[1]:p[3], p[0]:p[2]] = (over[p[1]:p[3], p[0]:p[2]] * 0.5 + col * 0.5)

    # стены: перевод сетки в пиксели одним resize
    wall_img = Image.fromarray((wall * 255).astype(np.uint8))
    px0, pz0 = rp(xs0, zs0, xs0, zs0)[:2]
    px1, pz1 = rp(xs1, zs1, xs1, zs1)[:2]
    wall_px = np.array(wall_img.resize((px1 - px0, pz1 - pz0), Image.NEAREST)) > 127
    sub = over[pz0:pz1, px0:px1]
    sub[wall_px] = (sub[wall_px] * 0.25 + np.array([45, 85, 175]) * 0.75)

    for _, x0, z0, x1, z1, side in closets:
        p = rp(x0, z0, x1, z1)
        over[p[1]:p[3], p[0]:p[2]] = (over[p[1]:p[3], p[0]:p[2]] * 0.25
                                      + np.array([210, 210, 210]) * 0.75)
        # дверца кладовки — красным по стороне, куда открывается
        if side == "x+":
            q = rp(x1 - 0.06, z0, x1 + 0.06, z1)
        elif side == "x-":
            q = rp(x0 - 0.06, z0, x0 + 0.06, z1)
        elif side == "z+":
            q = rp(x0, z1 - 0.06, x1, z1 + 0.06)
        else:
            q = rp(x0, z0 - 0.06, x1, z0 + 0.06)
        over[q[1]:q[3], q[0]:q[2]] = np.array([215, 20, 20])
    for axis, wpos, c0, wdt in door_out:
        if axis == "z":
            p = rp(c0 - wdt / 2, wpos - 0.09, c0 + wdt / 2, wpos + 0.09)
        else:
            p = rp(wpos - 0.09, c0 - wdt / 2, wpos + 0.09, c0 + wdt / 2)
        over[p[1]:p[3], p[0]:p[2]] = np.array([215, 20, 20])
    for axis, wpos, c0, wdt in win_out:
        if axis == "z":
            p = rp(c0 - wdt / 2, wpos - 0.09, c0 + wdt / 2, wpos + 0.09)
        else:
            p = rp(wpos - 0.09, c0 - wdt / 2, wpos + 0.09, c0 + wdt / 2)
        over[p[1]:p[3], p[0]:p[2]] = np.array([120, 200, 250])

    # --- экспорт для 3D ----------------------------------------------------
    # парапет лоджии — из стен в отдельный слой
    parap = []
    for fl, kind, x0, z0, x1, z1 in blocks:
        if kind != "лоджия":
            continue
        parap.append((CLIP[0], z0, x0, z1))
        wall[iz(z0):iz(z1), ix(CLIP[0]):ix(x0)] = False

    def rects(mask, limit=500):
        m = mask.copy()
        out = []
        while len(out) < limit and m.any():
            h, w = m.shape
            best = (0, 0, 0, 0, 0)
            height = np.zeros(w, int)
            for z in range(h):
                height = np.where(m[z], height + 1, 0)
                stack = []
                for x in range(w + 1):
                    cur = height[x] if x < w else 0
                    st = x
                    while stack and stack[-1][1] >= cur:
                        s0, hh = stack.pop()
                        if hh * (x - s0) > best[0]:
                            best = (hh * (x - s0), s0, z - hh + 1, x, z + 1)
                        st = s0
                    stack.append((st, cur))
            if best[0] < 9:
                break
            _, a, b, c, d = best
            out.append((round(a * GRID + xs0, 3), round(b * GRID + zs0, 3),
                        round(c * GRID + xs0, 3), round(d * GRID + zs0, 3)))
            m[b:d, a:c] = False
        return out

    def band(axis, wpos, c0, wdt, half=0.28):
        if axis == "z":
            return [round(c0 - wdt / 2, 3), round(wpos - half, 3),
                    round(c0 + wdt / 2, 3), round(wpos + half, 3)]
        return [round(wpos - half, 3), round(c0 - wdt / 2, 3),
                round(wpos + half, 3), round(c0 + wdt / 2, 3)]

    kindmap = {"кухня": "кухня", "прихожая": "прихожая",
               "лоджия": "лоджия", "ванная": "санузел", "уборная": "санузел"}
    rooms_out = {}
    for fl, kind, x0, z0, x1, z1 in blocks:
        k = kindmap.get(kind)
        if k:
            rooms_out.setdefault(k, []).append([x0, z0, x1, z1])

    fixtures = list(FIXTURES) + [(f[0],) + zmirror(f[1:], 1, 3) for f in FIXTURES]
    sidemap = {"x+": [0, 1], "x-": [0, -1], "z+": [1, 0], "z-": [-1, 0]}
    data = {
        "walls": rects(wall),
        "windows": [band(*v) for v in win_out],
        "door_openings": [band(*d, half=0.20) for d in door_out],
        "parapets": [list(p) for p in parap],
        "rooms": [{"kind": k, "rects": v} for k, v in rooms_out.items()],
        "fixtures": [{"kind": f[0], "r": list(f[1:])} for f in fixtures],
        "closets": [{"r": [c[1], c[2], c[3], c[4]], "side": sidemap[c[5]]}
                    for c in closets],
        "wall_h": WALL_H, "door_h": DOOR_H, "sill": SILL, "lintel": LINTEL,
        "bounds": list(CLIP),
    }
    io.open(OUT_JSON, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False))
    print("экспорт:", OUT_JSON, " стен:", len(data["walls"]))

    crop = np.clip(over, 0, 255).astype(np.uint8)[pz0:pz1, px0:px1]
    im = Image.fromarray(crop)
    im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS)
    im.save(OUT_PNG)
    print("контроль:", OUT_PNG, im.size)
    print("блоков %d, дверей %d, окон %d, кладовок %d"
          % (len(blocks), len(door_out), len(win_out), len(closets)))


main()
