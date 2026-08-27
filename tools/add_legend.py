# -*- coding: utf-8 -*-
"""Дописывает к кадру полосу легенды с назначением помещений."""
import sys
from PIL import Image, ImageDraw, ImageFont

ITEMS = [("жилая", (235, 214, 148)), ("кухня", (247, 148, 41)),
         ("санузел", (41, 194, 209)), ("прихожая", (168, 168, 179)),
         ("кладовая", (204, 184, 77)), ("лестница и лифты", (92, 122, 245)),
         ("лоджия", (117, 209, 92)),
         ("шахта лифта", (140, 51, 140))]

def font(sz):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", sz)
    except OSError:
        return ImageFont.load_default()

img = Image.open(sys.argv[1]).convert("RGB")
LEG = 64
out = Image.new("RGB", (img.width, img.height + LEG), (26, 27, 30))
out.paste(img, (0, 0))
d = ImageDraw.Draw(out)
f = font(19)
x, y = 20, img.height + 19
for name, col in ITEMS:
    d.rectangle([x, y, x + 26, y + 26], fill=col)
    d.text((x + 34, y + 4), name, font=f, fill=(232, 232, 236))
    x += 34 + int(d.textlength(name, font=f)) + 28
out.save(sys.argv[2])
