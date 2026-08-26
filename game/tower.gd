class_name Tower
extends Node3D
## Типовой этаж восьмиквартирной секции, снятый с поэтажного плана БТИ.
##
## Масштаб чертежа определён по комнате 18,5 (3,42 x 5,54 м): 23,94 px/м.
## Габарит корпуса по контуру скана — 35,9 x 18,6 м, начало координат в
## середине контура, X вдоль длинного фасада, Z вглубь, север = -Z.
##
## Таблица ROOMS — это и есть чертёж: каждая строка снята со скана, стены
## строятся по границам помещений, проёмы выводятся из соседства. Ничего
## не подгоняется на глаз.

const FLOOR_H := 3.0             ## от пола до пола; в свету 2,73 по чертежу
const WALL := 0.16               ## внутренние перегородки
const WALL_EXT := 0.34           ## наружные
const W_HALF := 17.96
const D_HALF := 9.27

const DOOR_FLAT := 1.0
const DOOR_ROOM := 0.85
const WIN := 1.7

const KIND_DOOR := 0.0
const KIND_WIN := 1.0

enum Room { LIVING, KITCHEN, BATH, HALL, CORE, LOGGIA, SHAFT }

const LIV := Room.LIVING
const KIT := Room.KITCHEN
const BAT := Room.BATH
const HAL := Room.HALL
const COR := Room.CORE
const LOG := Room.LOGGIA
const SHF := Room.SHAFT

## [x0, z0, x1, z1, квартира, назначение]
## Квартиры пронумерованы как в БТИ: 46 44 45 43 по северу, 42 41 48 47 по югу,
## 8 — места общего пользования.
const ROOMS := [
	# --- 46, северо-запад -------------------------------------------------
	[-17.80, -8.00, -16.35, -3.35, 0, LOG],
	[-16.08, -8.87, -13.30, -3.35, 0, LIV],   # 14,0 = 2,80 x 5,52
	[-13.30, -8.87,  -9.90, -3.33, 0, LIV],   # 18,5 = 3,42 x 5,54
	[-17.30, -3.30, -14.14, -0.35, 0, KIT],
	[-14.00, -2.30, -12.85, -0.35, 0, BAT],
	[-12.75, -2.30, -11.80, -0.35, 0, BAT],
	[-11.70, -3.30,  -9.90, -0.35, 0, HAL],
	# --- 44, север-центр, трёхкомнатная -----------------------------------
	[ -9.51, -9.24,  -3.24, -8.06, 1, LOG],   # лоджия 1б
	[ -3.06, -9.24,   2.84, -8.06, 1, LOG],   # лоджия 3а
	[ -9.40, -7.60,  -6.03, -1.50, 1, LIV],   # 20,7 = 3,37 x 6,10
	[ -6.03, -7.60,  -3.46, -2.89, 1, LIV],   # 12,2 = 2,57 x 4,71
	[ -3.36, -7.60,  -0.12, -2.88, 1, LIV],   # 15,1 = 3,24 x 4,72
	[ -6.03, -2.80,  -0.12, -1.50, 1, HAL],   # холл 7
	[  0.60, -7.51,   3.02, -4.97, 1, KIT],
	[  0.75, -3.43,   2.02, -2.61, 1, BAT],
	[  0.75, -2.42,   3.02, -0.97, 1, BAT],
	[ -0.05, -4.90,   0.70, -0.35, 1, HAL],
	# --- 45, север справа от центра ---------------------------------------
	[  3.20, -9.24,   9.19, -8.06, 2, LOG],   # лоджия 1а
	[  3.56, -7.60,   5.93, -3.43, 2, LIV],
	[  6.10, -7.60,   9.01, -1.44, 2, LIV],   # 19,1 = 3,37 x 6,16
	[  3.20, -3.35,   4.93, -2.55, 2, BAT],
	[  3.75, -2.45,   5.38, -1.16, 2, BAT],
	[  5.56, -2.45,   7.38, -0.35, 2, HAL],
	# --- 43, северо-восток (зеркало 46) -----------------------------------
	[ 16.35, -8.00,  17.80, -3.35, 3, LOG],
	[ 13.30, -8.87,  16.08, -3.35, 3, LIV],   # 13,9
	[  9.90, -8.87,  13.30, -3.33, 3, LIV],   # 18,2
	[ 14.14, -3.30,  17.30, -0.35, 3, KIT],
	[ 12.85, -2.30,  14.00, -0.35, 3, BAT],
	[ 11.80, -2.30,  12.75, -0.35, 3, BAT],
	[  9.90, -3.30,  11.70, -0.35, 3, HAL],
	# --- общий коридор ----------------------------------------------------
	[-11.70, -0.30,  11.70,  0.65, 8, HAL],
	# --- 42, юго-запад ----------------------------------------------------
	[-17.68,  3.70, -16.23,  8.44, 4, LOG],
	[-15.68,  3.53, -13.50,  8.44, 4, LIV],   # 13,8
	[-13.41,  3.53, -10.15,  8.44, 4, LIV],   # 18,6
	[-17.32,  0.72, -14.60,  3.45, 4, KIT],
	[-14.14,  0.72, -12.96,  3.45, 4, BAT],
	[-12.77,  0.72, -11.87,  3.45, 4, BAT],
	[-11.68,  0.70, -10.05,  3.53, 4, HAL],
	# --- 41, юг слева от ядра ---------------------------------------------
	[ -9.32,  7.62,  -3.33,  9.07, 5, LOG],   # лоджия 1а
	[ -9.15,  1.30,  -5.85,  7.40, 5, LIV],   # 18,5 = 3,34 x 6,08
	[ -5.75,  0.70,  -4.90,  5.10, 5, HAL],
	[ -4.80,  1.30,  -3.20,  2.55, 5, BAT],
	[ -4.80,  2.65,  -3.20,  3.35, 5, BAT],
	[ -4.80,  3.45,  -3.20,  5.10, 5, KIT],
	[ -5.75,  5.20,  -3.20,  7.40, 5, LIV],
	# --- 48, юг справа от ядра --------------------------------------------
	[  3.67,  7.62,   9.66,  9.07, 6, LOG],
	[  6.19,  1.30,   9.49,  7.40, 6, LIV],   # 19,2 = 3,39 x 6,20
	[  5.24,  0.70,   6.09,  5.10, 6, HAL],
	[  3.54,  1.30,   5.14,  2.55, 6, BAT],
	[  3.54,  2.65,   5.14,  3.35, 6, BAT],
	[  3.54,  3.45,   5.14,  5.10, 6, KIT],
	[  3.54,  5.20,   6.09,  7.40, 6, LIV],
	# --- 47, юго-восток (зеркало 42) --------------------------------------
	[ 16.23,  3.70,  17.68,  8.44, 7, LOG],
	[ 13.50,  3.53,  15.68,  8.44, 7, LIV],   # 13,5
	[ 10.15,  3.53,  13.41,  8.44, 7, LIV],   # 18,7
	[ 14.60,  0.72,  17.32,  3.45, 7, KIT],
	[ 12.96,  0.72,  14.14,  3.45, 7, BAT],
	[ 11.87,  0.72,  12.77,  3.45, 7, BAT],
	[ 10.05,  0.70,  11.68,  3.53, 7, HAL],
	# --- ядро: лестница, лифтовой холл, две шахты, балкон «г» -------------
	[ -2.70,  0.44,  -0.61,  7.49, 8, COR],
	[ -0.50,  0.44,   3.30,  7.49, 8, COR],
	[ -0.16,  1.08,   1.48,  2.90, 8, SHF],
	[ -0.16,  5.35,   1.48,  7.16, 8, SHF],
	[ -2.70,  7.62,  -0.61,  9.07, 8, LOG],
]

## Лестничная клетка — левая часть ядра.
const STAIR_X0 := -2.70
const STAIR_X1 := -0.61
const STAIR_Z0 := 0.44
const STAIR_Z1 := 7.49

var fadeable: Array[MeshInstance3D] = []
var by_floor: Dictionary = {}
var marks_visible := true

var _m_wall: ShaderMaterial
var _m_floor: ShaderMaterial
var _m_stair: ShaderMaterial
var _m_shaft: ShaderMaterial

const FADE_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley;

uniform vec3 base_color : source_color = vec3(0.60, 0.60, 0.58);
uniform float rough = 0.92;
uniform vec3 tint_top : source_color = vec3(1.0);
uniform vec3 focus_pos = vec3(0.0);
uniform float focus_radius = 1.9;
uniform float focus_soft = 0.9;

instance uniform float fade = 1.0;
instance uniform float hole_mode = 1.0;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	ALBEDO = base_color * mix(vec3(0.82), tint_top, clamp(NORMAL.y, 0.0, 1.0));
	ROUGHNESS = rough;
	METALLIC = 0.0;
	float d = length(world_pos.xz - focus_pos.xz);
	float in_hole = 1.0 - smoothstep(focus_radius - focus_soft, focus_radius, d);
	float a = mix(fade, mix(1.0, fade, in_hole), hole_mode);
	ALPHA = max(a, 0.20);
	ALPHA_HASH_SCALE = 1.0;
}
"""


# ---------------------------------------------------------------------------
#  Разметка
# ---------------------------------------------------------------------------

func rooms() -> Array:
	var out: Array = []
	for r in ROOMS:
		out.append({
			"rect": Rect2(Vector2(r[0], r[1]), Vector2(r[2] - r[0], r[3] - r[1])),
			"kind": int(r[5]),
			"flat": int(r[4]),
		})
	return out


func flats() -> Array:
	var box: Dictionary = {}
	for r in ROOMS:
		var f: int = int(r[4])
		if int(r[5]) == LOG:
			continue
		if box.has(f):
			var b: Array = box[f]
			b[0] = minf(b[0], r[0]); b[1] = minf(b[1], r[1])
			b[2] = maxf(b[2], r[2]); b[3] = maxf(b[3], r[3])
		else:
			box[f] = [r[0], r[1], r[2], r[3]]
	var out: Array = []
	var keys: Array = box.keys()
	keys.sort()
	for f in keys:
		var b: Array = box[f]
		out.append({
			"id": f,
			"rect": Rect2(Vector2(b[0], b[1]), Vector2(b[2] - b[0], b[3] - b[1])),
		})
	return out


func paint_plan(f: int) -> void:
	var y := f * FLOOR_H
	var palette := [
		Color(0.90, 0.42, 0.35), Color(0.95, 0.68, 0.25), Color(0.62, 0.78, 0.32),
		Color(0.30, 0.75, 0.62), Color(0.35, 0.62, 0.90), Color(0.62, 0.48, 0.88),
		Color(0.90, 0.45, 0.70), Color(0.75, 0.70, 0.45), Color(0.55, 0.60, 0.95),
	]
	for fl in flats():
		var id: int = fl["id"]
		_plate(f, fl["rect"] as Rect2, palette[id % palette.size()], 0.18, y + 0.03)
	for r in rooms():
		var col: Color
		match int(r["kind"]):
			Room.KITCHEN: col = Color(0.98, 0.62, 0.20)
			Room.BATH:    col = Color(0.20, 0.80, 0.80)
			Room.HALL:    col = Color(0.72, 0.72, 0.74)
			Room.CORE:    col = Color(0.45, 0.55, 0.98)
			Room.LOGGIA:  col = Color(0.55, 0.85, 0.45)
			Room.SHAFT:   col = Color(0.30, 0.32, 0.38)
			_:            col = Color(0.88, 0.86, 0.80)
		_plate(f, r["rect"] as Rect2, col, 0.52, y + 0.06)


func _plate(f: int, r: Rect2, col: Color, alpha: float, y: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(maxf(absf(r.size.x) - 0.08, 0.05), 0.02,
			maxf(absf(r.size.y) - 0.08, 0.05))
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(col.r, col.g, col.b, alpha)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = col
	mat.emission_energy_multiplier = 0.55
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = Vector3(r.position.x + r.size.x * 0.5, y, r.position.y + r.size.y * 0.5)
	mi.name = "Plate_%d" % f
	add_child(mi)
	mi.set_meta("floor", f)
	mi.set_meta("is_mark", true)


# ---------------------------------------------------------------------------
#  Сборка
# ---------------------------------------------------------------------------

func build(floors: int = 3) -> void:
	_m_wall = _mat(Color(0.62, 0.61, 0.58))
	_m_floor = _mat(Color(0.33, 0.34, 0.33))
	_m_stair = _mat(Color(0.46, 0.42, 0.37))
	_m_shaft = _mat(Color(0.38, 0.40, 0.42))
	for f in floors:
		by_floor[f] = []
		_floor(f, f < floors - 1)
	_slab(floors - 1, true)


func set_focus(p: Vector3) -> void:
	for m in [_m_wall, _m_floor, _m_stair, _m_shaft]:
		if m:
			m.set_shader_parameter("focus_pos", p)


func _floor(f: int, with_stairs: bool) -> void:
	var y := f * FLOOR_H
	_slab(f, false)
	_emit_walls(f, y)
	_shafts(f, y)
	if with_stairs:
		_stairs(f)


# ---------------------------------------------------------------------------
#  Стены выводятся из границ помещений
# ---------------------------------------------------------------------------

func _room_at(x: float, z: float) -> int:
	for i in ROOMS.size():
		var r = ROOMS[i]
		if x > r[0] and x < r[2] and z > r[1] and z < r[3]:
			return i
	return -1


## Что за проём между двумя помещениями: -1 глухая стена, 0 дверь, 1 окно.
func _opening(a: int, b: int, length: float, on_facade: bool) -> int:
	if a < 0:
		return -1
	var ra = ROOMS[a]
	if int(ra[5]) == SHF:
		return -1
	if b >= 0 and int(ROOMS[b][5]) == SHF:
		return -1
	if b < 0:
		if on_facade and length >= 1.9 and int(ra[5]) != BAT:
			return 1
		return -1
	var rb = ROOMS[b]
	if int(ra[5]) == LOG or int(rb[5]) == LOG:
		return 0 if length >= 1.2 else -1
	if int(ra[4]) == int(rb[4]):
		return 0 if length >= 1.1 else -1
	var common := int(ra[4]) == 8 or int(rb[4]) == 8
	var hall_a := int(ra[5]) == HAL or int(ra[5]) == COR
	var hall_b := int(rb[5]) == HAL or int(rb[5]) == COR
	if common and hall_a and hall_b and length >= 1.0:
		return 0
	return -1


func _emit_walls(f: int, y: float) -> void:
	var seen: Dictionary = {}
	for i in ROOMS.size():
		var r = ROOMS[i]
		var edges := [
			[1, r[0], r[1], r[3]], [1, r[2], r[1], r[3]],
			[0, r[1], r[0], r[2]], [0, r[3], r[0], r[2]],
		]
		for e in edges:
			var key := "%d|%.2f|%.2f|%.2f" % [e[0], e[1], e[2], e[3]]
			if seen.has(key):
				continue
			seen[key] = true
			var axis: int = e[0]
			var fixed: float = e[1]
			var a0: float = e[2]
			var a1: float = e[3]
			var length: float = a1 - a0
			if length < 0.25:
				continue
			var mid := (a0 + a1) * 0.5
			var ia: int
			var ib: int
			if axis == 1:
				ia = _room_at(fixed - 0.22, mid)
				ib = _room_at(fixed + 0.22, mid)
			else:
				ia = _room_at(mid, fixed - 0.22)
				ib = _room_at(mid, fixed + 0.22)
			if ia < 0 and ib < 0:
				continue
			var inner := ia if ia >= 0 else ib
			var outer := ib if ia >= 0 else -1
			var facade := (absf(fixed) > 16.9) if axis == 1 else (absf(fixed) > 7.9)
			if outer >= 0:
				facade = false
			if outer >= 0 and int(ROOMS[inner][5]) == LOG and int(ROOMS[outer][5]) == LOG:
				continue
			if outer < 0 and int(ROOMS[inner][5]) == LOG:
				_parapet(f, y, axis, fixed, a0, a1)
				continue
			var op := _opening(inner, outer, length, facade)
			var thick := WALL_EXT if (outer < 0 and facade) else WALL
			var holes: Array[Vector3] = []
			if op == 0:
				holes.append(Vector3(0.0, DOOR_FLAT if length > 3.0 else DOOR_ROOM, KIND_DOOR))
			elif op == 1:
				if length < 4.2:
					holes.append(Vector3(0.0, WIN, KIND_WIN))
				else:
					holes.append(Vector3(-length * 0.22, WIN, KIND_WIN))
					holes.append(Vector3(length * 0.22, WIN, KIND_WIN))
			var dir := Vector3(0, 0, 1) if axis == 1 else Vector3(1, 0, 0)
			var center := Vector3(fixed, y, mid) if axis == 1 else Vector3(mid, y, fixed)
			_wall(f, center, dir, length, holes, thick)


func _parapet(f: int, y: float, axis: int, fixed: float, a0: float, a1: float) -> void:
	var length := a1 - a0
	if length < 0.3:
		return
	var mesh := BoxMesh.new()
	if axis == 1:
		mesh.size = Vector3(0.14, 1.05, length)
	else:
		mesh.size = Vector3(length, 1.05, 0.14)
	var mid := (a0 + a1) * 0.5
	var pos := Vector3(fixed, y + 0.525, mid) if axis == 1 else Vector3(mid, y + 0.525, fixed)
	var mi := _spawn(mesh, pos, _m_wall, f)
	mi.name = "Parapet_%d" % f


func _shafts(f: int, y: float) -> void:
	for r in ROOMS:
		if int(r[5]) != SHF:
			continue
		var mesh := BoxMesh.new()
		mesh.size = Vector3(r[2] - r[0], FLOOR_H - WALL, r[3] - r[1])
		var mi := _spawn(mesh, Vector3((r[0] + r[2]) * 0.5, y + (FLOOR_H - WALL) * 0.5,
				(r[1] + r[3]) * 0.5), _m_shaft, f)
		mi.name = "Shaft_%d" % f


# ---------------------------------------------------------------------------
#  Перекрытия и лестница
# ---------------------------------------------------------------------------

func _slab(f: int, is_roof: bool) -> void:
	var y := f * FLOOR_H + (FLOOR_H if is_roof else 0.0)
	var owner := f + 1 if is_roof else f
	if not by_floor.has(owner):
		by_floor[owner] = []

	if f == 0 and not is_roof:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(W_HALF * 2.0, WALL, D_HALF * 2.0)
		var mi := _spawn(mesh, Vector3(0, y - WALL * 0.5, 0), _m_floor, owner)
		mi.name = "Floor_%d" % f
		mi.set_meta("is_ceiling", false)
		return

	var hz0 := STAIR_Z0 + 1.6
	var pieces: Array[Rect2] = [
		Rect2(Vector2(-W_HALF, -D_HALF), Vector2(STAIR_X0 + W_HALF, D_HALF * 2.0)),
		Rect2(Vector2(STAIR_X1, -D_HALF), Vector2(W_HALF - STAIR_X1, D_HALF * 2.0)),
		Rect2(Vector2(STAIR_X0, -D_HALF), Vector2(STAIR_X1 - STAIR_X0, D_HALF + hz0)),
		Rect2(Vector2(STAIR_X0, STAIR_Z1), Vector2(STAIR_X1 - STAIR_X0, D_HALF - STAIR_Z1)),
	]
	for i in pieces.size():
		var r: Rect2 = pieces[i]
		if r.size.x <= 0.01 or r.size.y <= 0.01:
			continue
		var mesh := BoxMesh.new()
		mesh.size = Vector3(r.size.x, WALL, r.size.y)
		var mi := _spawn(mesh, Vector3(r.position.x + r.size.x * 0.5, y - WALL * 0.5,
				r.position.y + r.size.y * 0.5), _m_floor, owner)
		mi.name = ("Roof_%d_%d" % [f, i]) if is_roof else ("Floor_%d_%d" % [f, i])
		mi.set_meta("is_ceiling", true)


func _stairs(f: int) -> void:
	var y0 := f * FLOOR_H
	var half := FLOOR_H * 0.5
	var run := 2.6
	var z_near := STAIR_Z0 + 1.7
	var z_far := z_near + run
	var w := 0.95
	_flight(f, Vector3(STAIR_X0 + 0.62, y0, z_near), 1.0, half, run, w)
	_landing(f, y0 + half, z_far)
	_flight(f, Vector3(STAIR_X0 + 1.55, y0 + half, z_far + 1.05), -1.0, half, run, w)


func _flight(f: int, start: Vector3, dz: float, rise: float, run: float, width: float) -> void:
	var steps := 8
	var sh := rise / float(steps)
	var sd := run / float(steps)
	for i in steps:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(width, sh, sd)
		var mi := _spawn_visual(mesh, Vector3(start.x, start.y + sh * (i + 0.5),
				start.z + dz * sd * (i + 0.5)), _m_stair, f)
		mi.name = "Step_%d" % f

	var hw := width * 0.5
	var ze := run * dz
	var th := 0.25
	var wedge := ConvexPolygonShape3D.new()
	wedge.points = PackedVector3Array([
		Vector3(-hw, 0, 0), Vector3(hw, 0, 0),
		Vector3(-hw, -th, 0), Vector3(hw, -th, 0),
		Vector3(-hw, rise, ze), Vector3(hw, rise, ze),
		Vector3(-hw, rise - th, ze), Vector3(hw, rise - th, ze),
	])
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = wedge
	body.add_child(shape)
	body.position = start
	add_child(body)
	body.set_meta("floor", f)
	(by_floor[f] as Array).append(body)


func _landing(f: int, y: float, z: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(STAIR_X1 - STAIR_X0 - 0.2, WALL, 1.05)
	var mi := _spawn(mesh, Vector3((STAIR_X0 + STAIR_X1) * 0.5, y - WALL * 0.5, z + 0.5),
			_m_floor, f)
	mi.name = "Landing_%d" % f


# ---------------------------------------------------------------------------
#  Примитивы
# ---------------------------------------------------------------------------

func _wall(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector3], thick: float = WALL) -> void:
	var cuts: Array[Vector3] = holes.duplicate()
	cuts.sort_custom(func(a, b): return a.x < b.x)

	var segs: Array[Vector2] = []
	var cursor := -length * 0.5
	for h: Vector3 in cuts:
		var hs: float = h.x - h.y * 0.5
		if hs > cursor:
			segs.append(Vector2(cursor, hs))
		cursor = h.x + h.y * 0.5
	if cursor < length * 0.5:
		segs.append(Vector2(cursor, length * 0.5))

	var hw := FLOOR_H - WALL
	for s: Vector2 in segs:
		var sl: float = s.y - s.x
		if sl < 0.04:
			continue
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(thick, hw, sl)
		else:
			mesh.size = Vector3(sl, hw, thick)
		var pos := center + dir * ((s.x + s.y) * 0.5)
		pos.y = center.y + hw * 0.5
		var mi := _spawn(mesh, pos, _m_wall, f)
		mi.name = "Wall_%d" % f

	for h: Vector3 in cuts:
		var above := 0.6 if h.z < 0.5 else 0.9
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(thick, above, h.y)
		else:
			mesh.size = Vector3(h.y, above, thick)
		var pos := center + dir * h.x
		pos.y = center.y + hw - above * 0.5
		var mi := _spawn(mesh, pos, _m_wall, f)
		mi.name = "Lintel_%d" % f
		if h.z >= 0.5:
			var sill := BoxMesh.new()
			if dir.z > 0.5:
				sill.size = Vector3(thick, 0.85, h.y)
			else:
				sill.size = Vector3(h.y, 0.85, thick)
			var sp := center + dir * h.x
			sp.y = center.y + 0.425
			var ms := _spawn(sill, sp, _m_wall, f)
			ms.name = "Sill_%d" % f
		_mark(f, center + dir * h.x, dir, h.y, h.z, center.y)


func _mark(f: int, pos: Vector3, dir: Vector3, width: float, kind: float, base_y: float) -> void:
	if not marks_visible:
		return
	var is_win := kind >= 0.5
	var h := 1.0 if is_win else 2.1
	var mesh := BoxMesh.new()
	if dir.z > 0.5:
		mesh.size = Vector3(WALL + 0.12, h, width)
	else:
		mesh.size = Vector3(width, h, WALL + 0.12)

	var mat := StandardMaterial3D.new()
	var col := Color(0.35, 0.70, 0.95) if is_win else Color(0.35, 0.85, 0.45)
	mat.albedo_color = Color(col.r, col.g, col.b, 0.45)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = col
	mat.emission_energy_multiplier = 0.9
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = Vector3(pos.x, base_y + (1.5 if is_win else h * 0.5), pos.z)
	mi.name = ("WinMark_%d" % f) if is_win else ("DoorMark_%d" % f)
	add_child(mi)
	mi.set_meta("floor", f)
	mi.set_meta("is_mark", true)


func _mat(c: Color) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = FADE_SHADER
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("base_color", c)
	m.set_shader_parameter("tint_top", Color(1.04, 1.03, 1.0))
	return m


func _spawn(mesh: Mesh, pos: Vector3, mat: ShaderMaterial, f: int) -> MeshInstance3D:
	var body := StaticBody3D.new()
	body.position = pos
	add_child(body)

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	body.add_child(mi)

	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = (mesh as BoxMesh).size
	shape.shape = box
	body.add_child(shape)

	mi.set_meta("floor", f)
	body.set_meta("floor", f)
	fadeable.append(mi)
	(by_floor[f] as Array).append(body)
	return mi


func _spawn_visual(mesh: Mesh, pos: Vector3, mat: ShaderMaterial, f: int) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	mi.set_meta("floor", f)
	fadeable.append(mi)
	return mi
