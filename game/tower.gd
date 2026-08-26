class_name Tower
extends Node3D
## Типовой этаж одноподъездной башни, построенный по поэтажному плану БТИ.
##
## Все числа ниже сняты с чертежа и проверены суммами: ширины квартир по
## северному фасаду складываются в 24,83 м — это и есть габарит корпуса.
## Ничего не подгонялось «чтобы влезло»; если размер здесь не такой, как на
## скане, это ошибка чтения, а не вольность.
##
## Оси: X вдоль длинного фасада, Z вглубь корпуса, начало — центр дома.

# ---------------------------------------------------------------------------
#  Таблица координат: снято с чертежа
# ---------------------------------------------------------------------------

const FLOOR_H := 3.0            ## от пола до пола; в свету 2,73 по чертежу
const WALL := 0.2
const W_HALF := 12.42           ## 24,83 / 2
const D_HALF := 10.2            ## глубина корпуса 20,4

## Границы квартир северного ряда: 6,22 + 9,18 + 3,37 + 6,06 = 24,83
const N_BOUNDS := [-12.42, -6.20, 2.98, 6.35, 12.42]
## Южный ряд: 2К, 1К, 1К слева от ядра и 1К справа от него
const S_BOUNDS := [-12.42, -6.20, -1.50, 2.98]

## Коридор — линейная полоса между рядами квартир.
const CORR := 1.1               ## полуширина

## Ядро вставлено в южный ряд: холл у коридора, за ним лестница и два лифта.
const CORE_X0 := 2.98
const CORE_X1 := 9.00
const CORE_Z0 := 1.10           ## граница с коридором
const CORE_Z1 := 8.00
const HALL_Z := 3.10            ## холл от CORE_Z0 до HALL_Z
const STAIR_X1 := 5.90          ## лестница от CORE_X0 до STAIR_X1, дальше лифты

## Глубина комнат по чертежу
const R_20_7 := 6.10            ## комната 20,7 — 3,37 x 6,10
const R_12_2 := 4.71            ## 12,2 — 2,57 x 4,71
const R_15_1 := 4.72            ## 15,1 — 3,24 x 4,72
const R_19_1 := 6.16            ## 19,1 — 3,37 x 6,16
const R_18_5 := 5.54            ## 18,5 — 3,42 x 5,54
const R_14_0 := 5.52            ## 14,0 — 2,80 x 5,52
const R_18_2 := 5.58            ## 18,2 — 3,29 x 5,58
const R_13_9 := 5.57            ## 13,9 — 2,77 x 5,57

const DOOR_FLAT := 1.0
const DOOR_ROOM := 0.85
const WIN := 1.7

const KIND_DOOR := 0.0
const KIND_WIN := 1.0

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


static func door(offset: float, width: float = DOOR_ROOM) -> Vector3:
	return Vector3(offset, width, KIND_DOOR)


static func win(offset: float, width: float = WIN) -> Vector3:
	return Vector3(offset, width, KIND_WIN)


# ---------------------------------------------------------------------------
#  Сборка
# ---------------------------------------------------------------------------

func build(floors: int = 3) -> void:
	_m_wall = _mat(Color(0.60, 0.60, 0.58))
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
	_shell(f, y)
	_corridor(f, y)
	_core(f, y)
	_north_row(f, y)
	_south_row(f, y)
	if with_stairs:
		_stairs(f)


## Наружные стены с окнами по фасадам.
func _shell(f: int, y: float) -> void:
	_wall(f, Vector3(0, y, -D_HALF), Vector3(1, 0, 0), W_HALF * 2.0,
			[win(-9.5), win(-4.0), win(1.0), win(4.6), win(9.5)])
	_wall(f, Vector3(0, y, D_HALF), Vector3(1, 0, 0), W_HALF * 2.0,
			[win(-9.5), win(-4.0), win(0.5), win(10.8)])
	_wall(f, Vector3(-W_HALF, y, 0), Vector3(0, 0, 1), D_HALF * 2.0,
			[win(-7.0), win(-3.0), win(4.0), win(7.5)])
	_wall(f, Vector3(W_HALF, y, 0), Vector3(0, 0, 1), D_HALF * 2.0,
			[win(-7.0), win(-3.0), win(4.0), win(7.5)])


## Коридор: полоса через весь корпус, двери квартир выходят в него.
func _corridor(f: int, y: float) -> void:
	# северная стена: четыре двери северного ряда
	_wall(f, Vector3(0, y, -CORR), Vector3(1, 0, 0), W_HALF * 2.0,
			[door(-9.3, DOOR_FLAT), door(-1.6, DOOR_FLAT),
			 door(4.6, DOOR_FLAT), door(9.4, DOOR_FLAT)], true)
	# южная: три двери южного ряда и широкий проём в лифтовой холл
	_wall(f, Vector3(0, y, CORR), Vector3(1, 0, 0), W_HALF * 2.0,
			[door(-9.3, DOOR_FLAT), door(-3.9, DOOR_FLAT), door(0.5, DOOR_FLAT),
			 door(6.0, 2.4), door(10.7, DOOR_FLAT)], true)
	# торцы коридора
	_wall(f, Vector3(-W_HALF + 0.1, y, 0), Vector3(0, 0, 1), CORR * 2.0, [] as Array[Vector3], true)
	_wall(f, Vector3(W_HALF - 0.1, y, 0), Vector3(0, 0, 1), CORR * 2.0, [] as Array[Vector3], true)


## Ядро: холл у коридора, за ним лестница, восточнее два лифта друг за другом.
func _core(f: int, y: float) -> void:
	var cx := (CORE_X0 + CORE_X1) * 0.5
	# западная и восточная стены ядра
	_wall(f, Vector3(CORE_X0, y, (CORE_Z0 + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			CORE_Z1 - CORE_Z0, [] as Array[Vector3], true)
	_wall(f, Vector3(CORE_X1, y, (CORE_Z0 + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			CORE_Z1 - CORE_Z0, [] as Array[Vector3], true)
	# дальняя стена
	_wall(f, Vector3(cx, y, CORE_Z1), Vector3(1, 0, 0), CORE_X1 - CORE_X0, [] as Array[Vector3], true)
	# стена между холлом и лестнично-лифтовой частью: проход к лестнице и к лифтам
	_wall(f, Vector3(cx, y, HALL_Z), Vector3(1, 0, 0), CORE_X1 - CORE_X0,
			[door(-1.6, 1.4), door(1.8, 1.6)], true)
	# перегородка лестница | лифты
	_wall(f, Vector3(STAIR_X1, y, (HALL_Z + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			CORE_Z1 - HALL_Z, [] as Array[Vector3], true)

	# шахты лифтов и мусоропровод
	var h := FLOOR_H - WALL
	_box(f, Vector3(7.5, y + h * 0.5, 4.4), Vector3(2.4, h, 2.2), _m_shaft, "LiftPass")
	_box(f, Vector3(7.5, y + h * 0.5, 6.9), Vector3(2.4, h, 2.0), _m_shaft, "LiftCargo")
	if f > 0:
		_box(f, Vector3(3.6, y + h * 0.5, 2.0), Vector3(0.9, h, 0.9), _m_shaft, "Chute")


## Северный ряд: 2К, 3К, 1К, 2К — слева направо, размеры с чертежа.
func _north_row(f: int, y: float) -> void:
	var z_out := -D_HALF
	# межквартирные стены
	for i in [1, 2, 3]:
		var bx: float = N_BOUNDS[i]
		_wall(f, Vector3(bx, y, (z_out - CORR) * 0.5), Vector3(0, 0, 1), D_HALF - CORR, [] as Array[Vector3], true)

	# --- 2К: комнаты 14,0 (2,80) и 18,5 (3,42) ---
	var a0: float = N_BOUNDS[0]
	_wall(f, Vector3(a0 + 2.80, y, z_out + R_14_0 * 0.5), Vector3(0, 0, 1), R_14_0, [] as Array[Vector3], true)
	_wall(f, Vector3(a0 + 3.11, y, z_out + R_18_5), Vector3(1, 0, 0), 6.22,
			[door(-1.6), door(1.9)], true)

	# --- 3К: комнаты 20,7 (3,37 x 6,10), 12,2 (2,57 x 4,71), 15,1 (3,24 x 4,72) ---
	var b0: float = N_BOUNDS[1]
	_wall(f, Vector3(b0 + 3.37, y, z_out + R_20_7 * 0.5), Vector3(0, 0, 1), R_20_7, [] as Array[Vector3], true)
	_wall(f, Vector3(b0 + 5.94, y, z_out + R_12_2 * 0.5), Vector3(0, 0, 1), R_12_2, [] as Array[Vector3], true)
	_wall(f, Vector3(b0 + 1.68, y, z_out + R_20_7), Vector3(1, 0, 0), 3.37, [door(0.9)], true)
	_wall(f, Vector3(b0 + 7.56, y, z_out + R_12_2), Vector3(1, 0, 0), 5.81,
			[door(-2.0), door(1.6)], true)

	# --- 1К: комната 19,1 (3,37 x 6,16) ---
	var c0: float = N_BOUNDS[2]
	_wall(f, Vector3(c0 + 1.68, y, z_out + R_19_1), Vector3(1, 0, 0), 3.37, [door(0.8)], true)

	# --- 2К: комнаты 18,2 (3,29) и 13,9 (2,77) ---
	var d0: float = N_BOUNDS[3]
	_wall(f, Vector3(d0 + 3.29, y, z_out + R_18_2 * 0.5), Vector3(0, 0, 1), R_18_2, [] as Array[Vector3], true)
	_wall(f, Vector3(d0 + 3.03, y, z_out + R_18_2), Vector3(1, 0, 0), 6.06,
			[door(-1.7), door(1.8)], true)


## Южный ряд: 2К и две 1К западнее ядра, ещё одна 1К восточнее.
func _south_row(f: int, y: float) -> void:
	var z_out := D_HALF
	for i in [1, 2, 3]:
		var bx: float = S_BOUNDS[i]
		_wall(f, Vector3(bx, y, (z_out + CORR) * 0.5), Vector3(0, 0, 1), D_HALF - CORR, [] as Array[Vector3], true)
	# квартира восточнее ядра
	_wall(f, Vector3(CORE_X1, y, (z_out + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			D_HALF - CORE_Z1, [] as Array[Vector3], true)

	# 2К западная: те же комнаты, что и в северном ряду, зеркально
	var a0: float = S_BOUNDS[0]
	_wall(f, Vector3(a0 + 2.80, y, z_out - R_14_0 * 0.5), Vector3(0, 0, 1), R_14_0, [] as Array[Vector3], true)
	_wall(f, Vector3(a0 + 3.11, y, z_out - R_18_5), Vector3(1, 0, 0), 6.22,
			[door(-1.6), door(1.9)], true)

	# две 1К между ней и ядром
	_wall(f, Vector3((S_BOUNDS[1] + S_BOUNDS[2]) * 0.5, y, z_out - R_19_1), Vector3(1, 0, 0),
			S_BOUNDS[2] - S_BOUNDS[1], [door(0.6)], true)
	_wall(f, Vector3((S_BOUNDS[2] + S_BOUNDS[3]) * 0.5, y, z_out - R_19_1), Vector3(1, 0, 0),
			S_BOUNDS[3] - S_BOUNDS[2], [door(-0.5)], true)

	# 1К восточнее ядра
	_wall(f, Vector3((CORE_X1 + W_HALF) * 0.5, y, z_out - R_19_1), Vector3(1, 0, 0),
			W_HALF - CORE_X1, [door(0.4)], true)


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

	# проём под марши — над лестничной частью ядра
	var hx0 := CORE_X0
	var hx1 := STAIR_X1
	var pieces: Array[Rect2] = [
		Rect2(Vector2(-W_HALF, -D_HALF), Vector2(hx0 + W_HALF, D_HALF * 2.0)),
		Rect2(Vector2(hx1, -D_HALF), Vector2(W_HALF - hx1, D_HALF * 2.0)),
		Rect2(Vector2(hx0, -D_HALF), Vector2(hx1 - hx0, D_HALF + HALL_Z)),
		Rect2(Vector2(hx0, CORE_Z1), Vector2(hx1 - hx0, D_HALF - CORE_Z1)),
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


## Два марша с промежуточной площадкой, в лестничной части ядра.
func _stairs(f: int) -> void:
	var y0 := f * FLOOR_H
	var half := FLOOR_H * 0.5
	var run := 2.2
	var z_near := HALL_Z + 0.3
	var z_far := z_near + run

	_flight(f, Vector3(CORE_X0 + 0.8, y0, z_near), 1.0, half, run, 1.3)
	_landing(f, y0 + half, z_far)
	_flight(f, Vector3(CORE_X0 + 2.2, y0 + half, z_far + 0.9), -1.0, half, run, 1.3)


func _flight(f: int, start: Vector3, dz: float, rise: float, run: float, width: float) -> void:
	var steps := 7
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
	mesh.size = Vector3(2.8, WALL, 1.2)
	var mi := _spawn(mesh, Vector3(CORE_X0 + 1.5, y - WALL * 0.5, z + 0.6), _m_floor, f)
	mi.name = "Landing_%d" % f


# ---------------------------------------------------------------------------
#  Примитивы
# ---------------------------------------------------------------------------

func _wall(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector3], interior: bool = false) -> void:
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
		if sl < 0.05:
			continue
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(WALL, hw, sl)
		else:
			mesh.size = Vector3(sl, hw, WALL)
		var pos := center + dir * ((s.x + s.y) * 0.5)
		pos.y = center.y + hw * 0.5
		var mi := _spawn(mesh, pos, _m_wall, f)
		mi.name = "Wall_%d" % f

	for h: Vector3 in cuts:
		var above := 0.7 if interior else 0.6
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(WALL, above, h.y)
		else:
			mesh.size = Vector3(h.y, above, WALL)
		var pos := center + dir * h.x
		pos.y = center.y + hw - above * 0.5
		var mi := _spawn(mesh, pos, _m_wall, f)
		mi.name = "Lintel_%d" % f
		_mark(f, center + dir * h.x, dir, h.y, h.z, center.y)


func _mark(f: int, pos: Vector3, dir: Vector3, width: float, kind: float, base_y: float) -> void:
	if not marks_visible:
		return
	var is_win := kind >= 0.5
	var h := 1.0 if is_win else 2.1
	var mesh := BoxMesh.new()
	if dir.z > 0.5:
		mesh.size = Vector3(WALL + 0.06, h, width)
	else:
		mesh.size = Vector3(width, h, WALL + 0.06)

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


func _box(f: int, pos: Vector3, size: Vector3, mat: ShaderMaterial, name_: String) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := _spawn(mesh, pos, mat, f)
	mi.name = "%s_%d" % [name_, f]


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
