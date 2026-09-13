"""Почему декаль выглядит вырезанной ножницами: две независимые причины.

1. Альфа доходит до КРАЯ ХОЛСТА. Тогда декаль обрывается по границе своего
   бокса проекции ровной линией — прямоугольником, как ни крути. Меряется
   максимумом альфы по рамке в 2 px.

2. Срез альфы РЕЗКИЙ: пиксели либо 0, либо 1, полупрозрачной каймы почти нет.
   Тогда даже пятно в середине холста имеет ножевую кромку. Меряется долей
   пикселей в полосе 0.05 < a < 0.95 среди всех, у кого есть хоть какие-то
   непрозрачные соседи (то есть длиной периметра в пикселях).
"""
import sys
import glob
import os
import numpy as np
from PIL import Image


def report(path: str) -> None:
	im = Image.open(path).convert("RGBA")
	a = np.asarray(im).astype(np.float32)[..., 3] / 255.0
	h, w = a.shape

	border = max(
		a[:2, :].max(), a[-2:, :].max(), a[:, :2].max(), a[:, -2:].max()
	)

	solid = a > 0.95
	empty = a < 0.05
	soft = (~solid) & (~empty)
	# периметр: непрозрачные пиксели, рядом с которыми есть пустота
	pad = np.pad(solid, 1, constant_values=False)
	neigh = (
		pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
	)
	perim = solid & ~neigh
	n_perim = int(perim.sum())
	ratio = (soft.sum() / n_perim) if n_perim else 0.0

	cover = float(solid.mean())
	name = os.path.basename(path)
	flag = ""
	if border > 0.08:
		flag += " КРАЙ"
	if ratio < 1.2:
		flag += " РЕЗКО"
	print("%-34s %4dx%-4d альфа_на_рамке=%.3f  кайма/периметр=%5.2f  "
		"покрытие=%.2f%s" % (name, w, h, border, ratio, cover, flag))


if __name__ == "__main__":
	files = []
	for pat in sys.argv[1:]:
		files.extend(sorted(glob.glob(pat)))
	for f in files:
		report(f)
