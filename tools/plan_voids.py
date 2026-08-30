# -*- coding: utf-8 -*-
"""Подсвечивает на плане «ничьё» место: внутри контура дома, но вне помещений.

    python tools/plan_voids.py <render.png> <out.png> <ppm,px,pz> [x0 z0 x1 z1] [zoom]

Такая полоса — след двойной стены: два соседних помещения не сомкнуты, и
между ними остаётся замурованная пустота.
"""
import re, io, sys
import numpy as np
from PIL import Image

W_HALF, D_HALF = 17.96, 9.27
STEP = 0.04

src, dst = sys.argv[1], sys.argv[2]
PPM, PX, PZ = [float(v) for v in sys.argv[3].split(",")]
box = [float(v) for v in sys.argv[4:8]] if len(sys.argv) > 7 else None
zoom = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0

txt = io.open("game/tower.gd", encoding="utf-8").read()
tbl = txt.split("const ROOMS := [", 1)[1].split("\n]", 1)[0]
rooms = []
for line in tbl.splitlines():
    body = line.split("#")[0].strip()
    m = re.match(r"\[(.+)\],?$", body)
    if m:
        p = [x.strip() for x in m.group(1).split(",")]
        rooms.append([float(p[0]), float(p[1]), float(p[2]), float(p[3])])

base = Image.open(src).convert("RGB")
lay = np.zeros((base.height, base.width, 4), np.uint8)

xs = np.arange(-W_HALF, W_HALF, STEP)
zs = np.arange(-D_HALF, D_HALF, STEP)
free = np.ones((zs.size, xs.size), bool)
for x0, z0, x1, z1 in rooms:
    ix = (xs >= x0 - 0.08) & (xs <= x1 + 0.08)
    iz = (zs >= z0 - 0.08) & (zs <= z1 + 0.08)
    free[np.ix_(iz, ix)] = False

zi, xi = np.nonzero(free)
px = np.rint(PX + xs[xi] * PPM).astype(int)
pz = np.rint(PZ + zs[zi] * PPM).astype(int)
ok = (px >= 0) & (px < base.width) & (pz >= 0) & (pz < base.height)
lay[pz[ok], px[ok]] = (255, 0, 200, 130)

out = base.convert("RGBA")
out.alpha_composite(Image.fromarray(lay))
out = out.convert("RGB")
if box:
    x0, z0, x1, z1 = box
    out = out.crop((int(PX + x0 * PPM), int(PZ + z0 * PPM),
                    int(PX + x1 * PPM), int(PZ + z1 * PPM)))
if zoom != 1.0:
    out = out.resize((int(out.width * zoom), int(out.height * zoom)), Image.LANCZOS)
out.save(dst)
print(dst, out.size)
