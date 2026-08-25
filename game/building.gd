class_name Building
extends Node3D
## Одноподъездная башня по образцу серии II-67: восемь квартир кольцом вокруг
## центрального ядра. В ядре лестница в два марша, пассажирский и грузовой
## лифты, мусоропровод и щитовая.
##
## Планировка задана числами в этом файле — стены, проёмы и комнаты строятся
## по ним. Детали (дверные блоки, перила, рамы, мебель) приходят готовыми
## ассетами и ставятся поверх этой структуры.
##
## Каждому куску геометрии проставляется этаж (meta "floor") — по нему работает
## срез: виден этаж игрока, перекрытие над ним не рисуется.

const FLOOR_HEIGHT := 3.0      ## от пола до пола; в свету 2,8 — как в II-67
const WALL_THICK := 0.2
const HALF_W := 13.0           ## габарит 26 x 21 м
const HALF_D := 10.5

const CORE_X := 3.8            ## ядро: лестница, лифты, мусоропровод
const CORE_Z := 3.7
const CORR_X := 5.5            ## кольцевой коридор снаружи ядра
const CORR_Z := 5.4

const DOOR_W := 1.0            ## входная дверь квартиры
const ROOM_DOOR := 0.9
const WIN_W := 1.7

var fadeable: Array[MeshInstance3D] = []
var by_floor: Dictionary = {}

var _mat_wall: ShaderMaterial
var _mat_floor: ShaderMaterial
var _mat_stair: ShaderMaterial
var _mat_shaft: ShaderMaterial

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


func build(floors_count: int = 4) -> void:
	_mat_wall = _make_mat(Color(0.60, 0.60, 0.58))
	_mat_floor = _make_mat(Color(0.33, 0.34, 0.33))
	_mat_stair = _make_mat(Color(0.46, 0.42, 0.37))
	_mat_shaft = _make_mat(Color(0.38, 0.40, 0.42))

	for f in floors_count:
		by_floor[f] = []
		_build_floor(f, f < floors_count - 1)
	_slab(floors_count - 1, true)


## Куда «прорезать окно» в гасимых стенах — за игроком.
func set_focus(p: Vector3) -> void:
	for m in [_mat_wall, _mat_floor, _mat_stair, _mat_shaft]:
		if m:
			m.set_shader_parameter("focus_pos", p)


func _make_mat(c: Color) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = FADE_SHADER
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("base_color", c)
	m.set_shader_parameter("tint_top", Color(1.04, 1.03, 1.0))
	return m


# ---------------------------------------------------------------------------
#  Этаж
# ---------------------------------------------------------------------------

func _build_floor(f: int, with_stairs: bool) -> void:
	var y := f * FLOOR_HEIGHT
	_slab(f, false)
	_outer_walls(f, y)
	_corridor_walls(f, y)
	_core_walls(f, y)
	_flats(f, y)
	_shafts(f, y)
	if with_stairs:
		_stairs(f)


func _outer_walls(f: int, y: float) -> void:
	_wall_run(f, Vector3(0, y, -HALF_D), Vector3(1, 0, 0), HALF_W * 2.0,
			[Vector2(-9.0, WIN_W), Vector2(-4.0, WIN_W), Vector2(3.0, WIN_W), Vector2(8.5, WIN_W)])
	_wall_run(f, Vector3(0, y, HALF_D), Vector3(1, 0, 0), HALF_W * 2.0,
			[Vector2(-8.5, WIN_W), Vector2(-3.0, WIN_W), Vector2(4.0, WIN_W), Vector2(9.0, WIN_W)])
	_wall_run(f, Vector3(-HALF_W, y, 0), Vector3(0, 0, 1), HALF_D * 2.0,
			[Vector2(-6.5, WIN_W), Vector2(-2.5, WIN_W), Vector2(2.5, WIN_W), Vector2(6.5, WIN_W)])
	_wall_run(f, Vector3(HALF_W, y, 0), Vector3(0, 0, 1), HALF_D * 2.0,
			[Vector2(-6.5, WIN_W), Vector2(-2.5, WIN_W), Vector2(2.5, WIN_W), Vector2(6.5, WIN_W)])


## Стены кольцевого коридора: в них восемь входных дверей квартир.
func _corridor_walls(f: int, y: float) -> void:
	_wall_run(f, Vector3(0, y, -CORR_Z), Vector3(1, 0, 0), CORR_X * 2.0,
			[Vector2(-2.9, DOOR_W), Vector2(3.3, DOOR_W)], true)
	_wall_run(f, Vector3(0, y, CORR_Z), Vector3(1, 0, 0), CORR_X * 2.0,
			[Vector2(2.9, DOOR_W), Vector2(-3.3, DOOR_W)], true)
	_wall_run(f, Vector3(-CORR_X, y, 0), Vector3(0, 0, 1), CORR_Z * 2.0,
			[Vector2(-3.3, DOOR_W), Vector2(2.1, DOOR_W)], true)
	_wall_run(f, Vector3(CORR_X, y, 0), Vector3(0, 0, 1), CORR_Z * 2.0,
			[Vector2(-2.1, DOOR_W), Vector2(3.3, DOOR_W)], true)


## Стены ядра. С южной стороны два проёма: слева на лестницу, справа к лифтам.
func _core_walls(f: int, y: float) -> void:
	_wall_run(f, Vector3(0, y, -CORE_Z), Vector3(1, 0, 0), CORE_X * 2.0, [] as Array[Vector2], true)
	_wall_run(f, Vector3(-CORE_X, y, 0), Vector3(0, 0, 1), CORE_Z * 2.0, [] as Array[Vector2], true)
	_wall_run(f, Vector3(CORE_X, y, 0), Vector3(0, 0, 1), CORE_Z * 2.0, [] as Array[Vector2], true)
	_wall_run(f, Vector3(0, y, CORE_Z), Vector3(1, 0, 0), CORE_X * 2.0,
			[Vector2(-2.2, 1.6), Vector2(2.2, 2.2)], true)


## Внутренние перегородки квартир.
func _flats(f: int, y: float) -> void:
	# --- северная пара: 3К слева, 2К справа ---
	_wall_run(f, Vector3(1.5, y, -7.85), Vector3(0, 0, 1), 5.3, [] as Array[Vector2], true)
	_wall_run(f, Vector3(-9.6, y, -7.6), Vector3(0, 0, 1), 5.6, [Vector2(1.4, ROOM_DOOR)], true)
	_wall_run(f, Vector3(-6.4, y, -7.6), Vector3(1, 0, 0), 6.2,
			[Vector2(-1.6, ROOM_DOOR), Vector2(2.0, ROOM_DOOR)], true)
	_wall_run(f, Vector3(-3.3, y, -6.9), Vector3(0, 0, 1), 2.4, [] as Array[Vector2], true)
	_wall_run(f, Vector3(4.6, y, -7.9), Vector3(0, 0, 1), 5.0, [Vector2(1.2, ROOM_DOOR)], true)
	_wall_run(f, Vector3(8.2, y, -7.7), Vector3(1, 0, 0), 7.2, [Vector2(-2.0, ROOM_DOOR)], true)

	# --- южная пара: те же квартиры, повёрнутые на 180 градусов ---
	_wall_run(f, Vector3(-1.5, y, 7.85), Vector3(0, 0, 1), 5.3, [] as Array[Vector2], true)
	_wall_run(f, Vector3(9.6, y, 7.6), Vector3(0, 0, 1), 5.6, [Vector2(-1.4, ROOM_DOOR)], true)
	_wall_run(f, Vector3(6.4, y, 7.6), Vector3(1, 0, 0), 6.2,
			[Vector2(1.6, ROOM_DOOR), Vector2(-2.0, ROOM_DOOR)], true)
	_wall_run(f, Vector3(3.3, y, 6.9), Vector3(0, 0, 1), 2.4, [] as Array[Vector2], true)
	_wall_run(f, Vector3(-4.6, y, 7.9), Vector3(0, 0, 1), 5.0, [Vector2(-1.2, ROOM_DOOR)], true)
	_wall_run(f, Vector3(-8.2, y, 7.7), Vector3(1, 0, 0), 7.2, [Vector2(2.0, ROOM_DOOR)], true)

	# --- западная пара: 1К севернее, 2К южнее ---
	_wall_run(f, Vector3(-9.2, y, -0.5), Vector3(1, 0, 0), 7.6, [] as Array[Vector2], true)
	_wall_run(f, Vector3(-8.6, y, -3.0), Vector3(0, 0, 1), 4.4, [Vector2(1.2, ROOM_DOOR)], true)
	_wall_run(f, Vector3(-8.6, y, 2.6), Vector3(0, 0, 1), 5.2, [Vector2(-1.4, ROOM_DOOR)], true)
	_wall_run(f, Vector3(-10.8, y, 2.6), Vector3(1, 0, 0), 4.4, [Vector2(1.0, ROOM_DOOR)], true)

	# --- восточная пара: зеркально ---
	_wall_run(f, Vector3(9.2, y, -0.5), Vector3(1, 0, 0), 7.6, [] as Array[Vector2], true)
	_wall_run(f, Vector3(8.6, y, -3.0), Vector3(0, 0, 1), 4.4, [Vector2(1.2, ROOM_DOOR)], true)
	_wall_run(f, Vector3(8.6, y, 2.6), Vector3(0, 0, 1), 5.2, [Vector2(-1.4, ROOM_DOOR)], true)
	_wall_run(f, Vector3(10.8, y, 2.6), Vector3(1, 0, 0), 4.4, [Vector2(-1.0, ROOM_DOOR)], true)


## Шахты лифтов, мусоропровод и щитовая — глухие объёмы внутри ядра.
func _shafts(f: int, y: float) -> void:
	var h := FLOOR_HEIGHT - WALL_THICK
	_box(f, Vector3(1.5, y + h * 0.5, -1.9), Vector3(1.7, h, 2.4), _mat_shaft, "LiftPass")
	_box(f, Vector3(3.3, y + h * 0.5, -1.7), Vector3(1.7, h, 2.8), _mat_shaft, "LiftCargo")
	_box(f, Vector3(1.4, y + h * 0.5, 1.4), Vector3(1.2, h, 1.2), _mat_shaft, "Chute")
	_box(f, Vector3(3.2, y + h * 0.5, 1.4), Vector3(1.6, h, 1.2), _mat_shaft, "Panel")


# ---------------------------------------------------------------------------
#  Перекрытия и лестница
# ---------------------------------------------------------------------------

func _slab(f: int, is_roof: bool) -> void:
	var y := f * FLOOR_HEIGHT + (FLOOR_HEIGHT if is_roof else 0.0)
	var owner_floor := f + 1 if is_roof else f
	if not by_floor.has(owner_floor):
		by_floor[owner_floor] = []

	if f == 0 and not is_roof:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(HALF_W * 2.0, WALL_THICK, HALF_D * 2.0)
		var mi := _spawn(mesh, Vector3(0, y - WALL_THICK * 0.5, 0), _mat_floor, owner_floor)
		mi.name = "Floor_%d" % f
		mi.set_meta("is_ceiling", false)
		return

	# Проём под марши — западная половина ядра.
	var hx0 := -CORE_X
	var hx1 := -0.2
	var pieces: Array[Rect2] = [
		Rect2(Vector2(-HALF_W, -HALF_D), Vector2(hx0 + HALF_W, HALF_D * 2.0)),
		Rect2(Vector2(hx1, -HALF_D), Vector2(HALF_W - hx1, HALF_D * 2.0)),
		Rect2(Vector2(hx0, -HALF_D), Vector2(hx1 - hx0, -CORE_Z + HALF_D)),
		Rect2(Vector2(hx0, CORE_Z), Vector2(hx1 - hx0, HALF_D - CORE_Z)),
	]
	for i in pieces.size():
		var r: Rect2 = pieces[i]
		if r.size.x <= 0.01 or r.size.y <= 0.01:
			continue
		var mesh := BoxMesh.new()
		mesh.size = Vector3(r.size.x, WALL_THICK, r.size.y)
		var pos := Vector3(r.position.x + r.size.x * 0.5, y - WALL_THICK * 0.5,
				r.position.y + r.size.y * 0.5)
		var mi := _spawn(mesh, pos, _mat_floor, owner_floor)
		mi.name = ("Roof_%d_%d" % [f, i]) if is_roof else ("Floor_%d_%d" % [f, i])
		mi.set_meta("is_ceiling", true)


## Лестница в два марша с промежуточной площадкой, внутри ядра.
func _stairs(f: int) -> void:
	var y0 := f * FLOOR_HEIGHT
	var half_rise := FLOOR_HEIGHT * 0.5
	var run := 2.6
	var z_near := CORE_Z - 0.5
	var z_mid := z_near - run

	_flight(f, Vector3(-3.0, y0, z_near), Vector3(0, 0, -1), half_rise, run, 1.4)
	_landing(f, y0 + half_rise, z_mid)
	_flight(f, Vector3(-1.3, y0 + half_rise, z_mid), Vector3(0, 0, 1), half_rise, run, 1.4)


func _flight(f: int, start: Vector3, dir: Vector3, rise: float, run: float, width: float) -> void:
	var steps := 7
	var step_h := rise / float(steps)
	var step_d := run / float(steps)

	for i in steps:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(width, step_h, step_d)
		var pos := start + dir * (step_d * (i + 0.5))
		pos.y = start.y + step_h * (i + 0.5)
		var mi := _spawn_visual(mesh, pos, _mat_stair, f)
		mi.name = "Step_%d" % f

	# Наклонная плита, а не клин: у клина плоское дно, и марш следующего этажа
	# нависает над этим, съедая просвет над головой.
	var hw := width * 0.5
	var ze := run * dir.z
	var th := 0.25
	var pts := PackedVector3Array([
		Vector3(-hw, 0.0, 0.0), Vector3(hw, 0.0, 0.0),
		Vector3(-hw, -th, 0.0), Vector3(hw, -th, 0.0),
		Vector3(-hw, rise, ze), Vector3(hw, rise, ze),
		Vector3(-hw, rise - th, ze), Vector3(hw, rise - th, ze),
	])
	var wedge := ConvexPolygonShape3D.new()
	wedge.points = pts

	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = wedge
	body.add_child(shape)
	body.position = start
	add_child(body)
	body.set_meta("floor", f)
	(by_floor[f] as Array).append(body)


func _landing(f: int, y: float, z_mid: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(3.2, WALL_THICK, 1.5)
	var mi := _spawn(mesh, Vector3(-2.15, y - WALL_THICK * 0.5, z_mid - 0.75), _mat_floor, f)
	mi.name = "Landing_%d" % f


# ---------------------------------------------------------------------------
#  Примитивы
# ---------------------------------------------------------------------------

## Стена вдоль dir длиной length с проёмами: (смещение от центра, ширина).
func _wall_run(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector2], interior: bool = false) -> void:
	var segments: Array[Vector2] = []
	var cuts: Array[Vector2] = holes.duplicate()
	cuts.sort_custom(func(a, b): return a.x < b.x)

	var cursor := -length * 0.5
	for h: Vector2 in cuts:
		var hole_start: float = h.x - h.y * 0.5
		if hole_start > cursor:
			segments.append(Vector2(cursor, hole_start))
		cursor = h.x + h.y * 0.5
	if cursor < length * 0.5:
		segments.append(Vector2(cursor, length * 0.5))

	var h_wall := FLOOR_HEIGHT - WALL_THICK
	for seg: Vector2 in segments:
		var seg_len: float = seg.y - seg.x
		if seg_len < 0.05:
			continue
		var mid: float = (seg.x + seg.y) * 0.5
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(WALL_THICK, h_wall, seg_len)
		else:
			mesh.size = Vector3(seg_len, h_wall, WALL_THICK)
		var pos := center + dir * mid
		pos.y = center.y + h_wall * 0.5
		var mi := _spawn(mesh, pos, _mat_wall, f)
		mi.name = "Wall_%d" % f

	for h: Vector2 in cuts:
		var above := 0.7 if interior else 0.6
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(WALL_THICK, above, h.y)
		else:
			mesh.size = Vector3(h.y, above, WALL_THICK)
		var pos := center + dir * h.x
		pos.y = center.y + h_wall - above * 0.5
		var mi := _spawn(mesh, pos, _mat_wall, f)
		mi.name = "Lintel_%d" % f


func _box(f: int, pos: Vector3, size: Vector3, mat: ShaderMaterial, name_: String) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := _spawn(mesh, pos, mat, f)
	mi.name = "%s_%d" % [name_, f]


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


## Геометрия без коллизии — ступени, чтобы не мешали движению.
func _spawn_visual(mesh: Mesh, pos: Vector3, mat: ShaderMaterial, f: int) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	mi.set_meta("floor", f)
	fadeable.append(mi)
	return mi
