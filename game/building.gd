class_name Building
extends Node3D
## Двухэтажный дом из примитивов: пол, внешние стены с проёмами окон,
## внутренние перегородки, лестница, перекрытие. Всё строится кодом.
##
## Каждому куску геометрии проставляется этаж (meta "floor") — по нему работает
## срез: виден этаж игрока, перекрытие над ним гасится, верхние прячутся.

const FLOOR_HEIGHT := 3.0     ## высота этажа в метрах
const WALL_THICK := 0.2
const SIZE := 16.0            ## дом 16x16 м
## Лестничная клетка: два марша с разворотом на 180° и промежуточной
## площадкой — как в обычном жилом доме.
## Подступенок ~21 см, проступь ~31 см, уклон ~34° — реальные пропорции.
const BAY_X0 := 1.2           ## границы клетки по X
const BAY_X1 := 6.0
const BAY_Z_FAR := -7.8       ## дальний край (за промежуточной площадкой)
const BAY_Z_NEAR := -3.6      ## ближний край: отсюда входят и сюда выходят
const FLIGHT_RUN := 2.4       ## горизонтальная длина одного марша
const FLIGHT_W := 1.5         ## ширина марша
const STEPS_PER_FLIGHT := 7
const BAY_Z_LANDING := -2.0   ## где кончается подъезд: за ним квартира
const APT_DOOR_Z := -2.9      ## двери квартир — на этажной площадке
const FLAT_DOOR_W := 1.1
const DOOR_W := 1.2
const DOOR_H := 2.1

## Гасимые куски (стены и перекрытия) — им можно менять прозрачность.
var fadeable: Array[MeshInstance3D] = []
## Пол каждого этажа: floor_index -> Array[Node3D]
var by_floor: Dictionary = {}

var _mat_wall: ShaderMaterial
var _mat_floor: ShaderMaterial
var _mat_stair: ShaderMaterial

## Шейдер с per-instance прозрачностью: один материал на все стены,
## гашение через set_instance_shader_parameter — без лишних draw call.
const FADE_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley;

uniform vec3 base_color : source_color = vec3(0.62, 0.60, 0.56);
uniform float rough = 0.92;
uniform vec3 tint_top : source_color = vec3(1.0);

// Позиция игрока и радиус «окна»: гасим не всю стену, а круг вокруг персонажа —
// так стена остаётся читаемой, а игрок виден.
uniform vec3 focus_pos = vec3(0.0);
uniform float focus_radius = 1.9;
uniform float focus_soft = 0.9;

instance uniform float fade = 1.0;
// 1 = гасить только круг вокруг игрока (стены), 0 = гасить целиком (перекрытия)
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
	// В центре окна — чистый вырез без шума, по краю — мягкий dither.
	if (a < 0.35) {
		discard;
	}
	ALPHA = a;
	ALPHA_HASH_SCALE = 1.0;
}
"""


func build(floors_count: int = 2) -> void:
	_mat_wall = _make_mat(Color(0.60, 0.60, 0.58))
	_mat_floor = _make_mat(Color(0.33, 0.34, 0.33))
	_mat_stair = _make_mat(Color(0.46, 0.42, 0.37))

	for f in floors_count:
		by_floor[f] = []
		# Марши нужны только там, откуда есть куда подниматься.
		_build_floor(f, f < floors_count - 1)
	# Крыша — это перекрытие над верхним этажом.
	_slab(floors_count - 1, true)


## Куда «прорезать окно» в гасимых стенах — за игроком.
func set_focus(p: Vector3) -> void:
	for m in [_mat_wall, _mat_floor, _mat_stair]:
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


func _build_floor(f: int, with_stairs: bool = true) -> void:
	var y := f * FLOOR_HEIGHT
	_slab(f, false)                    # пол этажа

	var half := SIZE * 0.5
	var bay_mid := (BAY_X0 + BAY_X1) * 0.5

	# Внешние стены. В торце подъезда — вход с улицы (на первом этаже)
	# и окно лестничной клетки на остальных.
	_wall_run(f, Vector3(-half, y, 0), Vector3(0, 0, 1), SIZE, [Vector2(-4.0, 1.8), Vector2(3.0, 1.8)])
	_wall_run(f, Vector3(half, y, 0), Vector3(0, 0, 1), SIZE, [Vector2(-4.5, 1.8), Vector2(2.5, 1.8)])
	_wall_run(f, Vector3(0, y, -half), Vector3(1, 0, 0), SIZE,
			[Vector2(-4.0, 1.8), Vector2(bay_mid, 1.6)])
	_wall_run(f, Vector3(0, y, half), Vector3(1, 0, 0), SIZE, [Vector2(0.5, 1.8)])

	# --- Подъезд: общая лестничная клетка + этажная площадка ---
	# Полоса x[BAY_X0..BAY_X1] от торцевой стены до z = BAY_Z_LANDING.
	var bay_len := BAY_Z_LANDING + half
	var bay_center_z := (-half + BAY_Z_LANDING) * 0.5
	# Стены подъезда с входными дверями в квартиры.
	_wall_run(f, Vector3(BAY_X0, y, bay_center_z), Vector3(0, 0, 1), bay_len,
			[Vector2(APT_DOOR_Z - bay_center_z, FLAT_DOOR_W)], true)
	_wall_run(f, Vector3(BAY_X1, y, bay_center_z), Vector3(0, 0, 1), bay_len,
			[Vector2(APT_DOOR_Z - bay_center_z, FLAT_DOOR_W)], true)
	# Торец подъезда — глухая стена, отделяющая его от квартиры.
	_wall_run(f, Vector3(bay_mid, y, BAY_Z_LANDING), Vector3(1, 0, 0),
			BAY_X1 - BAY_X0, [] as Array[Vector2], true)

	# --- Перегородки внутри квартир ---
	# Левая квартира
	_wall_run(f, Vector3(-3.0, y, 0.0), Vector3(1, 0, 0), 10.0, [Vector2(1.5, DOOR_W)], true)
	_wall_run(f, Vector3(-3.0, y, -4.0), Vector3(0, 0, 1), 8.0, [Vector2(2.0, DOOR_W)], true)
	# Правая квартира
	_wall_run(f, Vector3(7.0, y, 0.0), Vector3(1, 0, 0), 2.0, [Vector2(0.0, DOOR_W)], true)

	if f > 0:
		_stairwell_hole(f)
	if with_stairs:
		_stairs(f)


## Плита пола (или перекрытие/крыша над этажом f).
func _slab(f: int, is_roof: bool) -> void:
	var y := f * FLOOR_HEIGHT + (FLOOR_HEIGHT if is_roof else 0.0)
	var mesh := BoxMesh.new()
	mesh.size = Vector3(SIZE, WALL_THICK, SIZE)
	# Перекрытие принадлежит этажу, ПОЛОМ которого является: крыша над этажом f —
	# это «пол» несуществующего этажа f+1. Иначе срез не найдёт потолок над игроком.
	var owner_floor := f + 1 if is_roof else f
	if not by_floor.has(owner_floor):
		by_floor[owner_floor] = []
	var mi := _spawn(mesh, Vector3(0, y - WALL_THICK * 0.5, 0), _mat_floor, owner_floor)
	mi.name = ("Roof_%d" % f) if is_roof else ("Floor_%d" % f)
	mi.set_meta("is_ceiling", is_roof or f > 0)


## Стена вдоль оси dir длиной length с проёмами: список (смещение вдоль стены, ширина).
func _wall_run(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector2], interior: bool = false) -> void:
	var segments: Array[Vector2] = []   # (начало, конец) вдоль оси
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

	var y := f * FLOOR_HEIGHT
	for seg: Vector2 in segments:
		var seg_len: float = seg.y - seg.x
		if seg_len < 0.05:
			continue
		var mid: float = (seg.x + seg.y) * 0.5
		var mesh := BoxMesh.new()
		var h_wall := FLOOR_HEIGHT - WALL_THICK
		if dir.z > 0.5:
			mesh.size = Vector3(WALL_THICK, h_wall, seg_len)
		else:
			mesh.size = Vector3(seg_len, h_wall, WALL_THICK)
		var pos := center + dir * mid
		pos.y = y + h_wall * 0.5
		var mi := _spawn(mesh, pos, _mat_wall, f)
		mi.name = "Wall_%d" % f

	# Перемычка над проёмами (чтобы дом не выглядел решетом).
	for h: Vector2 in cuts:
		var above := FLOOR_HEIGHT - WALL_THICK - DOOR_H if interior else 0.7
		if above <= 0.05:
			continue
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(WALL_THICK, above, h.y)
		else:
			mesh.size = Vector3(h.y, above, WALL_THICK)
		var pos := center + dir * h.x
		pos.y = y + (FLOOR_HEIGHT - WALL_THICK) - above * 0.5
		var mi := _spawn(mesh, pos, _mat_wall, f)
		mi.name = "Lintel_%d" % f


## Проём в перекрытии под лестницу.
func _stairwell_hole(f: int) -> void:
	# Плита строится целиком, поэтому убираем её и ставим перекрытие кусками
	# вокруг лестничного проёма.
	# Имя задаётся мешу, а тело — его родитель: искать надо через меш,
	# иначе плита остаётся на месте и игрок бьётся головой на лестнице.
	for mi in fadeable.duplicate():
		if mi.name == "Floor_%d" % f:
			fadeable.erase(mi)
			var body: Node = mi.get_parent()
			(by_floor[f] as Array).erase(body)
			body.queue_free()
	var y := f * FLOOR_HEIGHT
	var half := SIZE * 0.5
	# Дыра — вся лестничная клетка: над маршами и промежуточной площадкой
	# перекрытия быть не должно, иначе на подъёме упираешься головой.
	var pieces: Array[Rect2] = [
		Rect2(Vector2(-half, -half), Vector2(BAY_X0 + half, SIZE)),                 # левее клетки
		Rect2(Vector2(BAY_X1, -half), Vector2(half - BAY_X1, SIZE)),                # правее
		Rect2(Vector2(BAY_X0, BAY_Z_NEAR), Vector2(BAY_X1 - BAY_X0, half - BAY_Z_NEAR)),  # перед клеткой
		Rect2(Vector2(BAY_X0, -half), Vector2(BAY_X1 - BAY_X0, BAY_Z_FAR + half)),  # за клеткой
	]
	for i in pieces.size():
		var r: Rect2 = pieces[i]
		if r.size.x <= 0.01 or r.size.y <= 0.01:
			continue
		var mesh := BoxMesh.new()
		mesh.size = Vector3(r.size.x, WALL_THICK, r.size.y)
		var pos := Vector3(r.position.x + r.size.x * 0.5, y - WALL_THICK * 0.5,
				r.position.y + r.size.y * 0.5)
		var mi := _spawn(mesh, pos, _mat_floor, f)
		mi.name = "Floor_%d_%d" % [f, i]
		mi.set_meta("is_ceiling", true)


## Лестница с этажа f на f+1: два марша с разворотом и площадкой между ними.
## Ступени — только визуал, физика — клинья: CharacterBody3D не умеет
## шагать на уступ, для него ступенька это стена.
func _stairs(f: int) -> void:
	var y0 := f * FLOOR_HEIGHT
	var half_rise := FLOOR_HEIGHT * 0.5
	var x_up := BAY_X0 + FLIGHT_W * 0.5          # марш вверх: вдоль -Z
	var x_down := BAY_X1 - FLIGHT_W * 0.5        # марш после разворота: вдоль +Z
	var z_mid := BAY_Z_NEAR - FLIGHT_RUN         # где кончается первый марш

	# Первый марш: от пола этажа до промежуточной площадки.
	_flight(f, Vector3(x_up, y0, BAY_Z_NEAR), Vector3(0, 0, -1), half_rise)
	# Промежуточная площадка на высоте половины этажа.
	_landing(f, y0 + half_rise)
	# Второй марш: разворот на 180°, от площадки до пола следующего этажа.
	_flight(f, Vector3(x_down, y0 + half_rise, z_mid), Vector3(0, 0, 1), half_rise)


## Один марш: визуальные ступени + клин-коллайдер.
func _flight(f: int, start: Vector3, dir: Vector3, rise: float) -> void:
	var step_h := rise / float(STEPS_PER_FLIGHT)
	var step_d := FLIGHT_RUN / float(STEPS_PER_FLIGHT)

	for i in STEPS_PER_FLIGHT:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(FLIGHT_W, step_h, step_d)
		var pos := start + dir * (step_d * (i + 0.5))
		pos.y = start.y + step_h * (i + 0.5)
		var mi := _spawn_visual(mesh, pos, _mat_stair, f)
		mi.name = "Step_%d" % f

	var hw := FLIGHT_W * 0.5
	var zs := 0.0
	var ze := FLIGHT_RUN * dir.z
	# Наклонная плита, а не клин: у клина плоское дно, и марш следующего этажа
	# нависает над этим — просвет падает до 1.5 м, игрок бьётся головой.
	# Плита повторяет уклон, поэтому под ней остаётся ~2.7 м.
	var th := 0.25
	var pts := PackedVector3Array([
		Vector3(-hw, 0.0, zs), Vector3(hw, 0.0, zs),
		Vector3(-hw, -th, zs), Vector3(hw, -th, zs),
		Vector3(-hw, rise, ze), Vector3(hw, rise, ze),
		Vector3(-hw, rise - th, ze), Vector3(hw, rise - th, ze),
	])
	var wedge := ConvexPolygonShape3D.new()
	wedge.points = pts

	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = wedge
	body.add_child(shape)
	body.position = Vector3(start.x, start.y, start.z)
	add_child(body)
	body.set_meta("floor", f)
	(by_floor[f] as Array).append(body)


## Промежуточная площадка между маршами.
func _landing(f: int, y: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(BAY_X1 - BAY_X0, WALL_THICK, BAY_Z_NEAR - FLIGHT_RUN - BAY_Z_FAR)
	var pos := Vector3(
		(BAY_X0 + BAY_X1) * 0.5,
		y - WALL_THICK * 0.5,
		(BAY_Z_FAR + BAY_Z_NEAR - FLIGHT_RUN) * 0.5
	)
	var mi := _spawn(mesh, pos, _mat_floor, f)
	mi.name = "Landing_%d" % f


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


## Кусок геометрии без коллизии — для того, что не должно мешать движению.
func _spawn_visual(mesh: Mesh, pos: Vector3, mat: ShaderMaterial, f: int) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	mi.set_meta("floor", f)
	fadeable.append(mi)
	return mi
