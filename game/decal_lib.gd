class_name DecalLib
extends Object
## Общая расстановка декалей для обоих треков сцены.
##
## Вынесено из `plan3d.gd`, потому что улице (`street.gd`, сцена `main.tscn`)
## нужна ровно та же зелень, что и лоджии, а копировать сюда триста строк с
## тремя выстраданными починками ориентации — верный способ починить их в
## одном месте и забыть в другом.
##
## `plan3d.gd` пока живёт со своей копией: она рабочая и переписывать её
## заодно с улицей — лишний риск в одном заходе. Когда треки будут сводить,
## первым делом убрать её и звать отсюда.
##
## Проекция задаётся в МЕТРАХ (из `sizes.txt` доставки), а не размером
## картинки. Ключ со слешем = подпапка внутри `assets/decals/`.

const DIR := "res://assets/decals/"

const SIZES := {
	"leak_ceiling": [1.20, 1.20, "1k"],
	"leak_wall": [0.60, 1.60, "512"],
	"mold_corner": [0.50, 0.50, "512"],
	"mold_seam": [0.80, 0.10, "512"],
	"furniture_ghost": [1.00, 1.80, "512"],
	"paper_peel": [0.60, 0.90, "512"],
	"debris_floor": [0.80, 0.40, "512"],
	"path_worn": [1.00, 2.00, "1k"],
	# зелень (task-0011): метры из задания, они не равны размеру картинки —
	# исполнитель отдавал степени двойки
	"overgrowth/vine_wall_1": [2.00, 2.80, "1k"],
	"overgrowth/vine_wall_2": [2.00, 2.80, "1k"],
	"overgrowth/moss_corner": [1.00, 1.00, "1k"],
	"overgrowth/moss_edge": [2.00, 0.50, "1k"],
	"overgrowth/grass_patch_1": [2.00, 2.00, "1k"],
	"overgrowth/grass_patch_2": [2.00, 2.00, "1k"],
}


## Повесить декаль на `parent`.
##
## `normal` — нормаль ПОВЕРХНОСТИ, то есть куда она смотрит (для пола вверх,
## для стены в комнату). Не направление проекции: Decal сам проецирует вдоль
## своего локального −Y, и +Y обязан смотреть навстречу поверхности.
## Ошибка знака здесь не даёт ни ошибки в логе, ни чёрного квадрата — декаль
## просто не рисуется, потому что `normal_fade` гасит отвёрнутую поверхность.
##
## `spin`: −1 — повернуть случайно (пятну на полу всё равно), иначе угол
## в радианах вокруг оси проекции.
## `mix` < 1 — декаль не заменяет альбедо поверхности целиком, а подмешивается.
## Для зелени это единственное, чем её сейчас можно смягчить: у набора
## task-0011 альфа упирается в край холста на полной непрозрачности
## (замер: 1.000 на рамке у пяти файлов из шести, мягкой каймы 0.11…0.28
## от длины периметра против 26…550 у износа от houdini-assets), поэтому
## декаль обрывается по краю своего бокса ровным прямоугольником.
## Боковой растушёвки у `Decal` в движке нет вовсе — лечится только альфой
## в самом файле, то есть переделкой набора.
static func put(parent: Node3D, kind: String, pos: Vector3, normal: Vector3,
		scale_: float = 1.0, spin := -1.0, tint := Color(1, 1, 1),
		mix := 1.0) -> Decal:
	var m: Array = SIZES.get(kind, [])
	if m.is_empty():
		return null
	var alb := "%s%s_albedo_%s.png" % [DIR, kind, m[2]]
	if not ResourceLoader.exists(alb):
		return null

	var d := Decal.new()
	d.texture_albedo = load(alb)
	var nrm := "%s%s_normal_%s.png" % [DIR, kind, m[2]]
	if ResourceLoader.exists(nrm):
		d.texture_normal = load(nrm)
	d.size = Vector3(float(m[0]) * scale_, 0.30, float(m[1]) * scale_)
	d.albedo_mix = mix
	d.modulate = tint
	d.normal_fade = 0.4
	# Кромка не должна читаться штампом: гасим её к краю проекции.
	d.upper_fade = 1.2
	d.lower_fade = 1.2

	var yv := normal.normalized()
	var xv := Vector3.UP.cross(yv)
	if xv.length() < 0.01:
		xv = Vector3.RIGHT
	xv = xv.normalized()
	# Decal кладёт верх картинки в сторону локального −Z, поэтому чтобы верх
	# смотрел в мировой верх, локальный Z обязан смотреть ВНИЗ.
	var zv := -yv.cross(xv).normalized()

	# Одна и та же декаль в двух местах не должна читаться копией. Пятну на
	# полу можно крутить как угодно, потёку, мху и плети — нет, у них есть верх.
	var seed_v := absf(pos.x) * 37.0 + absf(pos.z) * 91.0 + absf(pos.y) * 13.0
	var r1 := fposmod(sin(seed_v) * 43758.5453, 1.0)
	var r2 := fposmod(sin(seed_v + 1.7) * 43758.5453, 1.0)
	var b := Basis(xv, yv, zv)
	if spin >= 0.0:
		b = b.rotated(yv, spin)
	elif absf(normal.y) > 0.5:
		b = b.rotated(yv, r1 * TAU)
	elif r1 < 0.5:
		# только по горизонтали: Basis(-xv, yv, -zv) — это не зеркало,
		# а поворот на 180°, он ставит картинку вверх ногами
		b = Basis(-xv, yv, zv)
	d.transform = Transform3D(b, pos)
	d.size *= 1.0 + (r2 - 0.5) * 0.24
	parent.add_child(d)
	return d
