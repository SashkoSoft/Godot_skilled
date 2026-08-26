class_name PlanGrid
extends RefCounted
## Растровая проверка проходимости этажа — до того, как построена геометрия.
##
## Граф дверей врёт: он считает помещения связанными, даже если проём упирается
## в перпендикулярную стену или в шахту лифта и капсула игрока туда не входит.
## Поэтому стены и проёмы растеризуются сеткой 10 см, занятые клетки
## раздуваются на радиус игрока, и по свободным идёт волна от лестничной
## клетки. Что волна не залила — то недостижимо, и туда ставится дверь.

const G := 0.10                       ## шаг сетки, м
const PAD := 3                        ## раздутие препятствий, клеток (радиус игрока с запасом)


static func size_x() -> int:
	return int(Tower.W_HALF * 2.0 / G) + 1


static func size_z() -> int:
	return int(Tower.D_HALF * 2.0 / G) + 1


static func _mark_box(occ: PackedByteArray, nz: int, x0: float, z0: float,
		x1: float, z1: float) -> void:
	var nx := size_x()
	var ix0 := maxi(int((x0 + Tower.W_HALF) / G), 0)
	var ix1 := mini(int((x1 + Tower.W_HALF) / G) + 1, nx - 1)
	var iz0 := maxi(int((z0 + Tower.D_HALF) / G), 0)
	var iz1 := mini(int((z1 + Tower.D_HALF) / G) + 1, nz - 1)
	for ix in range(ix0, ix1 + 1):
		for iz in range(iz0, iz1 + 1):
			occ[ix * nz + iz] = 1


## Занятые клетки: стены за вычетом дверей, парапеты, шахты, контур дома.
static func occupancy(recs: Array) -> PackedByteArray:
	var nx := size_x()
	var nz := size_z()
	var occ := PackedByteArray()
	occ.resize(nx * nz)
	for w in recs:
		var axis: int = w["axis"]
		var f: float = w["fixed"]
		var half: float = (w["thick"] as float) * 0.5
		var cuts: Array = []
		if not w["parapet"]:
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z < 0.5:
					cuts.append([w["mid"] + h.x - h.y * 0.5, w["mid"] + h.x + h.y * 0.5])
		cuts.sort_custom(func(a, b): return a[0] < b[0])
		var cursor: float = w["a0"]
		var pieces: Array = []
		for c in cuts:
			if c[0] > cursor:
				pieces.append([cursor, c[0]])
			cursor = maxf(cursor, c[1])
		if cursor < w["a1"]:
			pieces.append([cursor, w["a1"]])
		for p in pieces:
			if p[1] - p[0] < 0.02:
				continue
			if axis == 1:
				_mark_box(occ, nz, f - half, p[0], f + half, p[1])
			else:
				_mark_box(occ, nz, p[0], f - half, p[1], f + half)
	for r in Tower.ROOMS:
		if int(r[5]) == Tower.SHF:
			_mark_box(occ, nz, r[0], r[1], r[2], r[3])
	return occ


## Клетки внутри помещений: снаружи дома и в толще стен ходить негде,
## иначе волна обтекает дом кругом и «достаёт» всё подряд.
static func _inside() -> PackedByteArray:
	var nx := size_x()
	var nz := size_z()
	var m := PackedByteArray()
	m.resize(nx * nz)
	for r in Tower.ROOMS:
		if int(r[5]) == Tower.SHF:
			continue
		_mark_box(m, nz, r[0] - 0.25, r[1] - 0.25, r[2] + 0.25, r[3] + 0.25)
	return m


## Свободные клетки с учётом радиуса игрока.
static func walkable(occ: PackedByteArray) -> PackedByteArray:
	var nx := size_x()
	var nz := size_z()
	var out := PackedByteArray()
	out.resize(nx * nz)
	for ix in nx:
		for iz in nz:
			var free := true
			for dx in range(-PAD, PAD + 1):
				for dz in range(-PAD, PAD + 1):
					if dx * dx + dz * dz > PAD * PAD:
						continue
					var ax := ix + dx
					var az := iz + dz
					if ax < 0 or az < 0 or ax >= nx or az >= nz:
						continue
					if occ[ax * nz + az] == 1:
						free = false
						break
				if not free:
					break
			out[ix * nz + iz] = 1 if free else 0
	var inside := _inside()
	for i in out.size():
		if inside[i] == 0:
			out[i] = 0
	return out


static func flood(free: PackedByteArray, x: float, z: float) -> PackedByteArray:
	var nx := size_x()
	var nz := size_z()
	var seen := PackedByteArray()
	seen.resize(nx * nz)
	var sx := clampi(int((x + Tower.W_HALF) / G), 0, nx - 1)
	var sz := clampi(int((z + Tower.D_HALF) / G), 0, nz - 1)
	var seed := -1
	for r in 20:
		for dx in range(-r, r + 1):
			for dz in range(-r, r + 1):
				var ax := sx + dx
				var az := sz + dz
				if ax < 0 or az < 0 or ax >= nx or az >= nz:
					continue
				if free[ax * nz + az] == 1:
					seed = ax * nz + az
					break
			if seed >= 0:
				break
		if seed >= 0:
			break
	if seed < 0:
		return seen
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
			if free[i] == 1 and seen[i] == 0:
				seen[i] = 1
				queue.append(i)
	return seen


## Доля залитой площади помещения.
static func room_share(seen: PackedByteArray, free: PackedByteArray, ri: int) -> float:
	var nz := size_z()
	var r = Tower.ROOMS[ri]
	var f := 0
	var got := 0
	var ix0 := maxi(int((r[0] + Tower.W_HALF) / G), 0)
	var ix1 := mini(int((r[2] + Tower.W_HALF) / G), size_x() - 1)
	var iz0 := maxi(int((r[1] + Tower.D_HALF) / G), 0)
	var iz1 := mini(int((r[3] + Tower.D_HALF) / G), nz - 1)
	for ix in range(ix0, ix1 + 1):
		for iz in range(iz0, iz1 + 1):
			var i := ix * nz + iz
			if free[i] == 1:
				f += 1
				if seen[i] == 1:
					got += 1
	if f == 0:
		return 1.0            # помещение уже целиком занято — проверять нечего
	return float(got) / float(f)
