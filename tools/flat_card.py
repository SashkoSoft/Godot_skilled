# -*- coding: utf-8 -*-
"""Подписывает кадр квартиры: заголовок и легенда."""
import sys
from PIL import Image, ImageDraw, ImageFont

ITEMS = [("жилая", (235, 214, 148)), ("кухня", (247, 148, 41)),
         ("санузел", (41, 194, 209)), ("прихожая", (168, 168, 179)),
         ("кладовая", (204, 184, 77)), ("лоджия", (117, 209, 92)),
         ("дверь", (38, 191, 76)), ("окно", (51, 140, 242))]

def font(sz, bold=False):
    n = "seguisb.ttf" if bold else "segoeui.ttf"
    try: return ImageFont.truetype("C:/Windows/Fonts/" + n, sz)
    except OSError: return ImageFont.load_default()

img = Image.open(sys.argv[1]).convert("RGB")
title = sys.argv[3]
TOP, LEG = 52, 58
out = Image.new("RGB", (img.width, img.height + TOP + LEG), (24, 25, 28))
out.paste(img, (0, TOP))
d = ImageDraw.Draw(out)
d.text((20, 13), title, font=font(26, True), fill=(255, 232, 150))
x, y = 20, img.height + TOP + 16
f = font(17)
for name, col in ITEMS:
    d.rectangle([x, y, x + 22, y + 22], fill=col)
    d.text((x + 30, y + 2), name, font=f, fill=(230, 230, 234))
    x += 30 + int(d.textlength(name, font=f)) + 24
out.save(sys.argv[2])
