"""Замер белого ореола на кромке альфы: глобально и локально (окрестность 9 px).

Глобально: средняя яркость полупрозрачных пикселей минус средняя яркость ядра
по всему файлу. Смешивает ореол с настоящей структурой (тонкая светлая метёлка
и правда светлее затенённой глубины куста), поэтому сам по себе не доказателен.

Локально: каждый кромочный пиксель сравнивается со средней яркостью ядра в своей
окрестности 9x9. Ореол — эффект локальный, подложка светлее ровно рядом с листом,
поэтому эта метрика его и ловит.
"""
import sys
import glob
import os
import numpy as np
from PIL import Image

CORE = 0.9          # альфа, выше которой пиксель считается ядром
EDGE_LO, EDGE_HI = 0.05, 0.5
R = 4               # радиус окрестности -> окно 9x9


def box_mean(a: np.ndarray, r: int) -> np.ndarray:
	"""Среднее по окну (2r+1)^2 через интегральное изображение."""
	p = np.pad(a, r + 1, mode="edge")
	s = p.cumsum(0).cumsum(1)
	h, w = a.shape
	y0, x0 = np.mgrid[0:h, 0:w]
	y1, x1 = y0 + 2 * r + 1, x0 + 2 * r + 1
	return (s[y1, x1] - s[y0, x1] - s[y1, x0] + s[y0, x0]) / float((2 * r + 1) ** 2)


def report(path: str) -> None:
	im = Image.open(path).convert("RGBA")
	arr = np.asarray(im).astype(np.float32) / 255.0
	rgb, a = arr[..., :3], arr[..., 3]
	lum = rgb.mean(axis=2)

	core = a > CORE
	edge = (a > EDGE_LO) & (a < EDGE_HI)
	if not core.any() or not edge.any():
		print("%-16s нет ядра или нет кромки" % os.path.basename(path))
		return

	g = lum[edge].mean() - lum[core].mean()

	# локально: среднее ядра вокруг каждого пикселя
	core_sum = box_mean(np.where(core, lum, 0.0), R)
	core_cnt = box_mean(core.astype(np.float32), R)
	ok = edge & (core_cnt > 0.02)
	if not ok.any():
		print("%-16s кромка без ядра рядом" % os.path.basename(path))
		return
	local = (lum[ok] - (core_sum[ok] / core_cnt[ok])).mean()

	name = os.path.basename(path).replace("_albedo_1k.png", "")
	print("%-16s %6dx%-5d глобально %+7.4f   локально %+7.4f" % (
		name, im.width, im.height, g, local))


if __name__ == "__main__":
	files = []
	for pat in sys.argv[1:]:
		files.extend(sorted(glob.glob(pat)))
	for f in files:
		report(f)
