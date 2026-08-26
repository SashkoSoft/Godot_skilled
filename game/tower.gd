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

## Габарит снят сложением ширин квартир северного ряда:
## 6,22 + 9,18 + 2,60 + 3,37 + 6,06 = 27,43
const W_HALF := 13.72
const D_HALF := 9.90             ## север 9,1 + коридор 1,6 + юг 9,1

## Коридор — узкая полоса между рядами, проходит через весь корпус.
const CORR := 0.80               ## полуширина

## Ядро по центру южного ряда: лестница слева, два лифта друг за другом справа.
const CORE_X0 := -2.40
const CORE_X1 := 2.40
const CORE_Z0 := 0.80            ## граница с коридором
const CORE_Z1 := 9.90            ## до южного фасада
const STAIR_X1 := -0.20          ## лестница от CORE_X0 до STAIR_X1

## Границы квартир северного ряда (5 штук)
const N_BOUNDS := [-13.72, -7.50, 1.68, 4.28, 7.65, 13.72]
## Южный ряд: две квартиры западнее ядра, две восточнее
const S_BOUNDS := [-13.72, -7.50, -2.40]
const S_BOUNDS_E := [2.40, 7.50, 13.72]

## Глубины комнат — поимённо с чертежа
const R_20_7 := 6.10             ## 20,7 — 3,37 x 6,10
const R_12_2 := 4.71             ## 12,2 — 2,57 x 4,71
const R_15_1 := 4.72             ## 15,1 — 3,24 x 4,72
const R_19_1 := 6.16             ## 19,1 — 3,37 x 6,16
const R_19_2 := 6.20             ## 19,2 — 3,39 x 6,20
const R_18_5 := 5.54             ## 18,5 — 3,42 x 5,54
const R_18_5S := 6.08            ## 18,5 южная — 3,34 x 6,08
const R_14_0 := 5.52             ## 14,0 — 2,80 x 5,52
const R_18_2 := 5.58             ## 18,2 — 3,29 x 5,58
const R_13_9 := 5.57             ## 13,9 — 2,77 x 5,57
const R_13_8 := 5.57             ## 13,8 — 2,80 x 5,57
const R_18_6 := 5.55             ## 18,6 — 3,39 x 5,55
const R_18_7 := 5.55             ## 18,7 — 3,40 x 5,55
const R_13_5 := 5.56             ## 13,5 — 2,71 x 5,56

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


## Квартиры и помещения выводятся из тех же констант, что строят стены,
## поэтому разметка не может разойтись с геометрией.
enum Room { LIVING, KITCHEN, BATH, HALL, CORE }

func flats() -> Array:
	var n := N_BOUNDS
	var w := S_BOUNDS
	var e := S_BOUNDS_E
	var zn0 := -D_HALF
	var zn1 := -CORR
	var zs0 := CORR
	var zs1 := D_HALF
	var out := []
	var names := ["2К", "3К", "1К", "1К", "2К"]
	for i in 5:
		out.append({"name": names[i], "rect": Rect2(n[i], zn0, n[i + 1] - n[i], zn1 - zn0)})
	out.append({"name": "2К", "rect": Rect2(w[0], zs0, w[1] - w[0], zs1 - zs0)})
	out.append({"name": "2К", "rect": Rect2(w[1], zs0, w[2] - w[1], zs1 - zs0)})
	out.append({"name": "2К", "rect": Rect2(e[0], zs0, e[1] - e[0], zs1 - zs0)})
	out.append({"name": "2К", "rect": Rect2(e[1], zs0, e[2] - e[1], zs1 - zs0)})
	return out


func rooms() -> Array:
	var n := N_BOUNDS
	var w := S_BOUNDS
	var e := S_BOUNDS_E
	var z := -D_HALF
	var zs := D_HALF
	var out := []
	# северный ряд
	out.append({"kind": Room.LIVING, "rect": Rect2(n[0], z, 2.80, R_14_0)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[0] + 2.80, z, 3.42, R_18_5)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(n[0] + 0.2, z + R_18_5, 2.6, 2.2)})
	out.append({"kind": Room.BATH, "rect": Rect2(n[0] + 3.0, z + R_18_5, 1.7, 1.5)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[1], z, 3.37, R_20_7)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[1] + 3.37, z, 2.57, R_12_2)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[1] + 5.94, z, 3.24, R_15_1)})
	out.append({"kind": Room.HALL, "rect": Rect2(n[1] + 1.8, z + R_20_7, 3.4, 2.4)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(n[1] + 6.4, z + R_15_1, 2.4, 2.2)})
	out.append({"kind": Room.BATH, "rect": Rect2(n[1] + 4.2, z + R_12_2, 1.6, 1.4)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[2], z, n[3] - n[2], 4.4)})
	out.append({"kind": Room.BATH, "rect": Rect2(n[2] + 0.3, z + 4.6, 1.6, 1.4)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[3], z, n[4] - n[3], R_19_1)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(n[3] + 0.3, z + R_19_1, 2.2, 2.0)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[4], z, 3.29, R_18_2)})
	out.append({"kind": Room.LIVING, "rect": Rect2(n[4] + 3.29, z, 2.77, R_13_9)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(n[4] + 3.4, z + R_13_9, 2.4, 2.2)})
	out.append({"kind": Room.BATH, "rect": Rect2(n[4] + 0.4, z + R_18_2, 1.7, 1.5)})
	# южный ряд
	out.append({"kind": Room.LIVING, "rect": Rect2(w[0], zs - R_13_8, 2.80, R_13_8)})
	out.append({"kind": Room.LIVING, "rect": Rect2(w[0] + 2.80, zs - R_18_6, 3.39, R_18_6)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(w[0] + 0.2, zs - R_18_6 - 2.2, 2.6, 2.2)})
	out.append({"kind": Room.BATH, "rect": Rect2(w[0] + 3.0, zs - R_18_6 - 1.5, 1.7, 1.5)})
	out.append({"kind": Room.LIVING, "rect": Rect2(w[1], zs - R_18_5S, 3.34, R_18_5S)})
	out.append({"kind": Room.LIVING, "rect": Rect2(w[1] + 3.34, zs - 4.6, w[2] - w[1] - 3.34, 4.6)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(w[1] + 0.3, zs - R_18_5S - 2.2, 2.4, 2.2)})
	out.append({"kind": Room.LIVING, "rect": Rect2(e[0], zs - R_19_2, 3.39, R_19_2)})
	out.append({"kind": Room.LIVING, "rect": Rect2(e[0] + 3.39, zs - 4.6, e[1] - e[0] - 3.39, 4.6)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(e[0] + 0.3, zs - R_19_2 - 2.2, 2.4, 2.2)})
	out.append({"kind": Room.LIVING, "rect": Rect2(e[1], zs - R_18_7, 3.40, R_18_7)})
	out.append({"kind": Room.LIVING, "rect": Rect2(e[1] + 3.40, zs - R_13_5, 2.71, R_13_5)})
	out.append({"kind": Room.KITCHEN, "rect": Rect2(e[1] + 3.5, zs - R_13_5 - 2.2, 2.4, 2.2)})
	out.append({"kind": Room.BATH, "rect": Rect2(e[1] + 0.4, zs - R_18_7 - 1.5, 1.7, 1.5)})
	# ядро
	out.append({"kind": Room.CORE, "rect": Rect2(CORE_X0, CORE_Z0, STAIR_X1 - CORE_X0, CORE_Z1 - CORE_Z0)})
	out.append({"kind": Room.CORE, "rect": Rect2(STAIR_X1, CORE_Z0, CORE_X1 - STAIR_X1, CORE_Z1 - CORE_Z0)})
	return out


## Заливка квартир и помещений: каждая квартира своим цветом, помещения ярче.
func paint_plan(f: int) -> void:
	var y := f * FLOOR_H
	var palette := [
		Color(0.90, 0.42, 0.35), Color(0.95, 0.68, 0.25), Color(0.62, 0.78, 0.32),
		Color(0.30, 0.75, 0.62), Color(0.35, 0.62, 0.90), Color(0.62, 0.48, 0.88),
		Color(0.90, 0.45, 0.70), Color(0.75, 0.70, 0.45),
	]
	var i := 0
	for fl in flats():
		_plate(f, fl["rect"] as Rect2, palette[i % palette.size()], 0.22, y + 0.03)
		i += 1
	for r in rooms():
		var kind: int = r["kind"]
		var col: Color
		match kind:
			Room.KITCHEN: col = Color(0.98, 0.62, 0.20)
			Room.BATH:    col = Color(0.20, 0.80, 0.80)
			Room.HALL:    col = Color(0.70, 0.70, 0.72)
			Room.CORE:    col = Color(0.55, 0.60, 0.95)
			_:            col = Color(0.85, 0.85, 0.80)
		_plate(f, r["rect"] as Rect2, col, 0.50, y + 0.06)


func _plate(f: int, r: Rect2, col: Color, alpha: float, y: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(absf(r.size.x) - 0.1, 0.02, absf(r.size.y) - 0.1)
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


## Коридор: узкая полоса через весь корпус между рядами квартир.
func _corridor(f: int, y: float) -> void:
	var n := N_BOUNDS
	# северная стена: пять дверей, по одной в каждую квартиру ряда
	_wall(f, Vector3(0, y, -CORR), Vector3(1, 0, 0), W_HALF * 2.0,
			[door(-10.6, DOOR_FLAT), door(-3.0, DOOR_FLAT), door(2.98, DOOR_FLAT),
			 door(5.9, DOOR_FLAT), door(10.6, DOOR_FLAT)], true)
	# южная: две двери западнее ядра, две восточнее и проём в холл
	_wall(f, Vector3(0, y, CORR), Vector3(1, 0, 0), W_HALF * 2.0,
			[door(-10.6, DOOR_FLAT), door(-4.9, DOOR_FLAT), door(0.0, 2.6),
			 door(4.9, DOOR_FLAT), door(10.6, DOOR_FLAT)], true)
	_wall(f, Vector3(-W_HALF + 0.1, y, 0), Vector3(0, 0, 1), CORR * 2.0,
			[] as Array[Vector3], true)
	_wall(f, Vector3(W_HALF - 0.1, y, 0), Vector3(0, 0, 1), CORR * 2.0,
			[] as Array[Vector3], true)


## Ядро по центру: лестница слева, два лифта друг за другом справа,
## между ними лифтовой холл — как на чертеже.
func _core(f: int, y: float) -> void:
	var cx := (CORE_X0 + CORE_X1) * 0.5
	_wall(f, Vector3(CORE_X0, y, (CORE_Z0 + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			CORE_Z1 - CORE_Z0, [] as Array[Vector3], true)
	_wall(f, Vector3(CORE_X1, y, (CORE_Z0 + CORE_Z1) * 0.5), Vector3(0, 0, 1),
			CORE_Z1 - CORE_Z0, [] as Array[Vector3], true)
	_wall(f, Vector3(STAIR_X1, y, (CORE_Z0 + CORE_Z1) * 0.5 + 1.0), Vector3(0, 0, 1),
			CORE_Z1 - CORE_Z0 - 2.0, [] as Array[Vector3], true)

	var h := FLOOR_H - WALL
	_box(f, Vector3(1.35, y + h * 0.5, 3.4), Vector3(2.0, h, 2.2), _m_shaft, "LiftPass")
	_box(f, Vector3(1.35, y + h * 0.5, 6.6), Vector3(2.0, h, 2.2), _m_shaft, "LiftCargo")
	if f > 0:
		_box(f, Vector3(-1.9, y + h * 0.5, 9.0), Vector3(0.9, h, 0.9), _m_shaft, "Chute")


## Северный ряд по чертежу: 2К, 3К, 1К, 1К, 2К — слева направо.
func _north_row(f: int, y: float) -> void:
	var z_out := -D_HALF
	var n := N_BOUNDS
	for i in [1, 2, 3, 4]:
		_wall(f, Vector3(n[i], y, (z_out - CORR) * 0.5), Vector3(0, 0, 1),
				D_HALF - CORR, [] as Array[Vector3], true)

	# 2К: комнаты 14,0 (2,80) и 18,5 (3,42)
	_wall(f, Vector3(n[0] + 2.80, y, z_out + R_14_0 * 0.5), Vector3(0, 0, 1),
			R_14_0, [] as Array[Vector3], true)
	_wall(f, Vector3(n[0] + 3.11, y, z_out + R_18_5), Vector3(1, 0, 0), 6.22,
			[door(-1.6), door(1.9)], true)

	# 3К: 20,7 (3,37 x 6,10), 12,2 (2,57 x 4,71), 15,1 (3,24 x 4,72)
	_wall(f, Vector3(n[1] + 3.37, y, z_out + R_20_7 * 0.5), Vector3(0, 0, 1),
			R_20_7, [] as Array[Vector3], true)
	_wall(f, Vector3(n[1] + 5.94, y, z_out + R_12_2 * 0.5), Vector3(0, 0, 1),
			R_12_2, [] as Array[Vector3], true)
	_wall(f, Vector3(n[1] + 1.68, y, z_out + R_20_7), Vector3(1, 0, 0), 3.37,
			[door(0.9)], true)
	_wall(f, Vector3(n[1] + 7.56, y, z_out + R_12_2), Vector3(1, 0, 0), 5.81,
			[door(-2.0), door(1.6)], true)

	# 1К узкая (санузлы и комната)
	_wall(f, Vector3((n[2] + n[3]) * 0.5, y, z_out + 4.4), Vector3(1, 0, 0),
			n[3] - n[2], [door(0.5)], true)

	# 1К: комната 19,1 (3,37 x 6,16)
	_wall(f, Vector3((n[3] + n[4]) * 0.5, y, z_out + R_19_1), Vector3(1, 0, 0),
			n[4] - n[3], [door(0.7)], true)

	# 2К: комнаты 18,2 (3,29) и 13,9 (2,77)
	_wall(f, Vector3(n[4] + 3.29, y, z_out + R_18_2 * 0.5), Vector3(0, 0, 1),
			R_18_2, [] as Array[Vector3], true)
	_wall(f, Vector3(n[4] + 3.03, y, z_out + R_18_2), Vector3(1, 0, 0), 6.06,
			[door(-1.7), door(1.8)], true)


## Южный ряд: 2К и 2К западнее ядра, 2К и 2К восточнее.
func _south_row(f: int, y: float) -> void:
	var z_out := D_HALF
	var w := S_BOUNDS
	var e := S_BOUNDS_E
	for i in [1, 2]:
		_wall(f, Vector3(w[i], y, (z_out + CORR) * 0.5), Vector3(0, 0, 1),
				D_HALF - CORR, [] as Array[Vector3], true)
	_wall(f, Vector3(e[1], y, (z_out + CORR) * 0.5), Vector3(0, 0, 1),
			D_HALF - CORR, [] as Array[Vector3], true)

	# 2К западная: комнаты 13,8 (2,80) и 18,6 (3,39)
	_wall(f, Vector3(w[0] + 2.80, y, z_out - R_13_8 * 0.5), Vector3(0, 0, 1),
			R_13_8, [] as Array[Vector3], true)
	_wall(f, Vector3(w[0] + 3.10, y, z_out - R_18_6), Vector3(1, 0, 0), 6.22,
			[door(-1.6), door(1.9)], true)

	# 2К у ядра слева: комната 18,5 (3,34 x 6,08)
	_wall(f, Vector3(w[1] + 3.34, y, z_out - R_18_5S * 0.5), Vector3(0, 0, 1),
			R_18_5S, [] as Array[Vector3], true)
	_wall(f, Vector3((w[1] + w[2]) * 0.5, y, z_out - R_18_5S), Vector3(1, 0, 0),
			w[2] - w[1], [door(-1.2), door(1.4)], true)

	# 2К у ядра справа: комната 19,2 (3,39 x 6,20)
	_wall(f, Vector3(e[0] + 3.39, y, z_out - R_19_2 * 0.5), Vector3(0, 0, 1),
			R_19_2, [] as Array[Vector3], true)
	_wall(f, Vector3((e[0] + e[1]) * 0.5, y, z_out - R_19_2), Vector3(1, 0, 0),
			e[1] - e[0], [door(-1.4), door(1.2)], true)

	# 2К восточная: комнаты 18,7 (3,40) и 13,5 (2,71)
	_wall(f, Vector3(e[1] + 3.40, y, z_out - R_18_7 * 0.5), Vector3(0, 0, 1),
			R_18_7, [] as Array[Vector3], true)
	_wall(f, Vector3(e[1] + 3.11, y, z_out - R_18_7), Vector3(1, 0, 0), 6.22,
			[door(-1.7), door(1.8)], true)


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
		Rect2(Vector2(hx0, -D_HALF), Vector2(hx1 - hx0, D_HALF + CORE_Z0)),
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


## Два марша с промежуточной площадкой — в левой части ядра.
func _stairs(f: int) -> void:
	var y0 := f * FLOOR_H
	var half := FLOOR_H * 0.5
	var run := 2.4
	var z_near := CORE_Z0 + 0.6
	var z_far := z_near + run

	_flight(f, Vector3(CORE_X0 + 0.7, y0, z_near), 1.0, half, run, 1.2)
	_landing(f, y0 + half, z_far)
	_flight(f, Vector3(CORE_X0 + 1.9, y0 + half, z_far + 1.0), -1.0, half, run, 1.2)


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
	var mi := _spawn(mesh, Vector3(CORE_X0 + 1.3, y - WALL * 0.5, z + 0.5), _m_floor, f)
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
