# -*- coding: utf-8 -*-
"""Подписывает отрендеренный план: назначение помещений, номера квартир, легенда."""
import re, io, sys
from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1]
DST = sys.argv[2]
CX_PX, CZ_PX, PPM = 700.0, 394.0, 35.02      # центр кадра и масштаб рендера

KINDS = {"LIV": ("жилая", "Ж"), "KIT": ("кухня", "К"), "BAT": ("санузел", "С"),
         "HAL": ("прихожая", "П"), "COR": ("лестница и лифты", "Л"),
         "LOG": ("лоджия", "лдж"), "SHF": ("шахта лифта", "ш"),
         "STO": ("кладовая", "клд")}
COLORS = {"LIV": (235, 214, 148), "KIT": (247, 148, 41), "BAT": (41, 194, 209),
          "HAL": (168, 168, 179), "COR": (92, 122, 245), "LOG": (117, 209, 92),
          "SHF": (140, 51, 140), "STO": (204, 184, 77)}
BTI = {0: "46", 1: "44", 2: "45", 3: "43", 4: "42", 5: "41", 6: "48", 7: "47", 8: "общее"}

txt = io.open("game/tower.gd", encoding="utf-8").read()
tbl = txt.split("const ROOMS := [", 1)[1].split("\n]", 1)[0]
rooms = []
for line in tbl.splitlines():
    body = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", body)
    if not m:
        continue
    p = [x.strip() for x in m.group(1).split(",")]
    rooms.append((float(p[0]), float(p[1]), float(p[2]), float(p[3]), int(p[4]), p[5]))

def font(sz, bold=False):
    name = "seguisb.ttf" if bold else "segoeui.ttf"
    try:
        return ImageFont.truetype("C:/Windows/Fonts/" + name, sz)
    except OSError:
        return ImageFont.load_default()

img = Image.open(SRC).convert("RGB")
LEG = 96
out = Image.new("RGB", (img.width, img.height + LEG), (26, 27, 30))
out.paste(img, (0, 0))
d = ImageDraw.Draw(out)

def px(x, z):
    return CX_PX + x * PPM, CZ_PX + z * PPM

def label(cx, cz, text, fnt, fill=(20, 20, 22)):
    w = d.textlength(text, font=fnt)
    h = fnt.size
    d.rectangle([cx - w / 2 - 4, cz - h / 2 - 2, cx + w / 2 + 4, cz + h / 2 + 3],
                fill=(255, 255, 255, 210))
    d.text((cx - w / 2, cz - h / 2), text, font=fnt, fill=fill)

f_room = font(15)
f_small = font(12)
f_flat = font(23, True)
f_leg = font(17)

for x0, z0, x1, z1, flat, kind in rooms:
    cx, cz = px((x0 + x1) / 2.0, (z0 + z1) / 2.0)
    w_m, h_m = x1 - x0, z1 - z0
    full, short = KINDS[kind]
    if kind == "COR":
        full, short = ("лестница", "л") if x1 <= 0.0 else ("лифтовой холл", "лх")
    elif kind == "SHF":
        full, short = "лифт", "лифт"
    area = w_m * h_m
    if kind == "LIV" and min(w_m, h_m) * PPM > 60:
        label(cx, cz, "%s %.1f м²" % (full, area), f_room)
    elif min(w_m, h_m) * PPM > 48 and w_m * PPM > 70:
        label(cx, cz, full, f_room if min(w_m, h_m) * PPM > 60 else f_small)
    else:
        label(cx, cz, short, f_small)

# номера квартир
box = {}
for x0, z0, x1, z1, flat, kind in rooms:
    if kind == "LOG":
        continue
    b = box.setdefault(flat, [x0, z0, x1, z1])
    b[0] = min(b[0], x0); b[1] = min(b[1], z0)
    b[2] = max(b[2], x1); b[3] = max(b[3], z1)
for flat, b in box.items():
    if flat == 8:
        continue
    cx, cz = px((b[0] + b[2]) / 2.0, b[1] + 0.55)
    t = "кв. " + BTI[flat]
    w = d.textlength(t, font=f_flat)
    d.rectangle([cx - w / 2 - 9, cz - 16, cx + w / 2 + 9, cz + 16], fill=(24, 25, 28))
    d.text((cx - w / 2, cz - 14), t, font=f_flat, fill=(255, 235, 150))

# легенда
x = 18
y = img.height + 22
for key in ("LIV", "KIT", "BAT", "HAL", "STO", "COR", "LOG", "SHF"):
    d.rectangle([x, y, x + 26, y + 26], fill=COLORS[key])
    d.text((x + 34, y + 4), KINDS[key][0], font=f_leg, fill=(232, 232, 236))
    x += 34 + int(d.textlength(KINDS[key][0], font=f_leg)) + 26
d.text((18, y + 40), "нумерация квартир — как в поэтажном плане БТИ; площади жилых комнат посчитаны по построенной геометрии",
       font=f_small, fill=(150, 152, 160))
out.save(DST)
print("ok", out.size)
