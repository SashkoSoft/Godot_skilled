class_name ReachCheck
extends RefCounted
## Проверка проходимости этажа физикой, а не графом дверей.
##
## Этаж растеризуется сеткой 12 см. В каждой ячейке лучом вниз ищется опора,
## на неё ставится капсула игрока — если она ни во что не упирается, ячейка
## проходима. Дальше волна от лестничной клетки: между соседними ячейками
## переход есть, если перепад опоры не больше высоты шага. Так лестница
## считается проходом, а не препятствием.

const STEP := 0.12
const CLIMB := 0.45          ## максимальный перепад между ячейками, м


static func run(space: PhysicsDirectSpaceState3D, y: float) -> Dictionary:
	var shape := CapsuleShape3D.new()
	shape.height = Player.HEIGHT
	shape.radius = Player.RADIUS - 0.02
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = shape

	var nx := int((Tower.W_HALF * 2.0) / STEP) + 1
	var nz := int((Tower.D_HALF * 2.0) / STEP) + 1
	var free := PackedByteArray()
	var ground := PackedFloat32Array()
	free.resize(nx * nz)
	ground.resize(nx * nz)

	for ix in nx:
		var x := -Tower.W_HALF + ix * STEP
		for iz in nz:
			var z := -Tower.D_HALF + iz * STEP
			# луч пускаем ниже перемычек над дверями, иначе опорой окажется
			# перемычка и проём прочитается как глухая стена
			var ray := PhysicsRayQueryParameters3D.create(
					Vector3(x, y + 2.0, z), Vector3(x, y - 0.4, z))
			var hit := space.intersect_ray(ray)
			var i := ix * nz + iz
			if hit.is_empty():
				free[i] = 0
				continue
			var gy: float = (hit["position"] as Vector3).y
			if gy > y + 1.7:
				free[i] = 0
				continue
			ground[i] = gy
			q.transform = Transform3D(Basis.IDENTITY,
					Vector3(x, gy + Player.HEIGHT * 0.5 + 0.03, z))
			free[i] = 1 if space.intersect_shape(q, 1).is_empty() else 0

	var sx := int((((Tower.STAIR_X0 + Tower.STAIR_X1) * 0.5) + Tower.W_HALF) / STEP)
	var sz := int(((Tower.STAIR_Z0 + 0.5) + Tower.D_HALF) / STEP)
	var seed := -1
	for r in 14:
		for dx in range(-r, r + 1):
			for dz in range(-r, r + 1):
				var i := (sx + dx) * nz + (sz + dz)
				if i >= 0 and i < free.size() and free[i] == 1:
					seed = i
					break
			if seed >= 0:
				break
		if seed >= 0:
			break
	if seed < 0:
		return {"error": "лестничная клетка непроходима"}

	var seen := PackedByteArray()
	seen.resize(nx * nz)
	var queue: Array[int] = [seed]
	seen[seed] = 1
	while not queue.is_empty():
		var cur: int = queue.pop_back()
		var cx := cur / nz
		var cz := cur % nz
		for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
			var ax: int = cx + d[0]
			var az: int = cz + d[1]
			if ax < 0 or az < 0 or ax >= nx or az >= nz:
				continue
			var i := ax * nz + az
			if free[i] == 0 or seen[i] == 1:
				continue
			if absf(ground[i] - ground[cur]) > CLIMB:
				continue
			seen[i] = 1
			queue.append(i)

	var report: Array = []
	for ri in Tower.ROOMS.size():
		var r = Tower.ROOMS[ri]
		if int(r[5]) == Tower.SHF:
			continue
		var f := 0
		var got := 0
		var ix0 := int((r[0] + Tower.W_HALF) / STEP)
		var ix1 := int((r[2] + Tower.W_HALF) / STEP)
		var iz0 := int((r[1] + Tower.D_HALF) / STEP)
		var iz1 := int((r[3] + Tower.D_HALF) / STEP)
		for ix in range(ix0, ix1 + 1):
			for iz in range(iz0, iz1 + 1):
				var i := ix * nz + iz
				if i < 0 or i >= free.size():
					continue
				if free[i] == 1:
					f += 1
					if seen[i] == 1:
						got += 1
		report.append({"room": ri, "flat": int(r[4]), "kind": int(r[5]),
				"free": f, "reached": got})

	var nfree := 0
	var nseen := 0
	for i in free.size():
		nfree += free[i]
		nseen += seen[i]
	return {"rooms": report, "cells": nx * nz, "free": nfree, "reached": nseen,
			"nx": nx, "nz": nz, "map_free": free, "map_seen": seen}


## Карта для глаз: # непроходимо, . проходимо но не достигнуто, + достигнуто.
static func ascii_map(res: Dictionary, step: int = 3) -> Array[String]:
	var nx: int = res["nx"]
	var nz: int = res["nz"]
	var free: PackedByteArray = res["map_free"]
	var seen: PackedByteArray = res["map_seen"]
	var out: Array[String] = []
	for iz in range(0, nz, step):
		var line := ""
		for ix in range(0, nx, step):
			var i := ix * nz + iz
			line += "+" if seen[i] == 1 else ("." if free[i] == 1 else "#")
		out.append(line)
	return out
