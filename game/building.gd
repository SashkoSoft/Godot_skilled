class_name Building
extends Node3D
## Двухэтажный дом из примитивов: пол, внешние стены с проёмами окон,
## внутренние перегородки, лестница, перекрытие. Всё строится кодом.
##
## Каждому куску геометрии проставляется этаж (meta "floor") — по нему работает
## срез: виден этаж игрока, перекрытие над ним гасится, верхние прячутся.

const FLOOR_HEIGHT := 3.0     ## высота этажа в метрах
const WALL_THICK := 0.2
const SIZE := 12.0            ## дом 12x12 м
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
uniform float focus_radius = 2.4;
uniform float focus_soft = 1.1;

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
	_mat_wall = _make_mat(Color(0.62, 0.60, 0.56))
	_mat_floor = _make_mat(Color(0.40, 0.39, 0.37))
	_mat_stair = _make_mat(Color(0.52, 0.45, 0.38))

	for f in floors_count:
		by_floor[f] = []
		# Лестница нужна только там, откуда есть куда подниматься.
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
	m.set_shader_parameter("tint_top", Color(1.06, 1.04, 1.0))
	return m


func _build_floor(f: int, with_stairs: bool = true) -> void:
	var y := f * FLOOR_HEIGHT
	_slab(f, false)                    # пол этажа

	var half := SIZE * 0.5
	# Внешние стены: две сплошные, две с оконными проёмами.
	_wall_run(f, Vector3(-half, y, 0), Vector3(0, 0, 1), SIZE, [] as Array[Vector2])
	_wall_run(f, Vector3(half, y, 0), Vector3(0, 0, 1), SIZE, [Vector2(-3.4, 1.6), Vector2(2.2, 1.6)])
	_wall_run(f, Vector3(0, y, -half), Vector3(1, 0, 0), SIZE, [Vector2(-2.0, 1.6), Vector2(3.0, 1.6)])
	_wall_run(f, Vector3(0, y, half), Vector3(1, 0, 0), SIZE, [Vector2(0.5, 1.6)])

	# Внутренние перегородки: коридор по центру + две комнаты, проёмы дверные.
	_wall_run(f, Vector3(0, y, -2.0), Vector3(1, 0, 0), SIZE, [Vector2(-3.5, DOOR_W), Vector2(2.5, DOOR_W)], true)
	_wall_run(f, Vector3(0, y, 2.6), Vector3(1, 0, 0), SIZE, [Vector2(1.0, DOOR_W)], true)
	_wall_run(f, Vector3(-1.5, y, -4.3), Vector3(0, 0, 1), 4.6, [] as Array[Vector2], true)

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
	# Плита строится целиком, поэтому вырезаем «дыру» тем, что ставим
	# перекрытие четырьмя кусками вокруг лестничного проёма.
	var slab: Node = get_node_or_null("Floor_%d" % f)
	if slab:
		slab.queue_free()
	var y := f * FLOOR_HEIGHT
	var pieces: Array[Rect2] = [
		Rect2(Vector2(-6, -6), Vector2(9, 12)),
		Rect2(Vector2(3, -1), Vector2(3, 7)),
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


## Лестница с этажа f на f+1.
func _stairs(f: int) -> void:
	var steps := 12
	var y0 := f * FLOOR_HEIGHT
	var step_h := FLOOR_HEIGHT / float(steps)
	var step_d := 0.32
	for i in steps:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(1.4, step_h, step_d)
		var pos := Vector3(4.5, y0 + step_h * (i + 0.5), -5.6 + step_d * i)
		var mi := _spawn(mesh, pos, _mat_stair, f)
		mi.name = "Step_%d_%d" % [f, i]


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
