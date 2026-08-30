# -*- coding: utf-8 -*-
"""Скан БТИ красным поверх плана, отрендеренного игрой.

    python tools/plan_overlay.py <render.png> <out.png> <ppm,px,pz> [x0 z0 x1 z1] [zoom]

Привязку кадра к миру (ppm,px,pz) печатает сам рендер строкой «[привязка]»:
ppm — пикселей на метр, px/pz — экранные координаты точки мира (0, 0).
Границы кропа — в метрах мира. Без них берётся весь кадр.
"""
import sys
import numpy as np
from PIL import Image

SCAN = r"C:/Users/Papa/AppData/Local/Temp/claude/shots/woolykh-tower-017.jpg"
S, CX, CZ = 23.94, 607.0, 610.5          # скан: px/м и начало координат

src, dst = sys.argv[1], sys.argv[2]
PPM, PX, PZ = [float(v) for v in sys.argv[3].split(",")]
box = [float(v) for v in sys.argv[4:8]] if len(sys.argv) > 7 else None
zoom = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0

base = Image.open(src).convert("RGB")

# скан -> система координат рендера
k = PPM / S
scan = Image.open(SCAN).convert("L")
scan = scan.resize((int(scan.width * k), int(scan.height * k)), Image.LANCZOS)
ox = PX - CX * k
oz = PZ - CZ * k

# линии чертежа — тёмное; кладём их красным, фон не трогаем
a = np.array(scan).astype(int)
mask = a < 150
lay = np.zeros((scan.height, scan.width, 4), np.uint8)
lay[..., 0] = 255
lay[..., 3] = np.where(mask, 210, 0).astype(np.uint8)

out = base.convert("RGBA")
out.alpha_composite(Image.fromarray(lay, "RGBA"), dest=(int(round(ox)), int(round(oz))))
out = out.convert("RGB")

if box:
    x0, z0, x1, z1 = box
    crop = (int(PX + x0 * PPM), int(PZ + z0 * PPM),
            int(PX + x1 * PPM), int(PZ + z1 * PPM))
    out = out.crop(crop)
if zoom != 1.0:
    out = out.resize((int(out.width * zoom), int(out.height * zoom)), Image.LANCZOS)
out.save(dst)
print(dst, out.size)
