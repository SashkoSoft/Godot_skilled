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

## Тип проёма — третьей компонентой в описании: помечаем их цветом,
## чтобы планировку можно было проверять глазами, не считая координаты.
const KIND_DOOR := 0.0
const KIND_WINDOW := 1.0

var marks_visible := true      ## показывать цветные метки проёмов и помещений

## Назначение помещения. По нему ставится метка, а позже — расставляется лут:
## аптечка в санузле, консервы на кухне, инструмент в кладовой.
enum Room { KITCHEN, BATH, STORAGE, BALCONY }

## Помещения типового этажа: прямоугольник в плане и назначение.
## Координаты совпадают с перегородками — если двигать стену, двигать и это.
const ROOMS: Array = [
	# северо-западная трёхкомнатная
	[Rect2(-12.8, -10.3, 3.0, 2.6), Room.KITCHEN],
	[Rect2(-3.1, -8.0, 2.0, 1.5), Room.BATH],
	[Rect2(-3.1, -6.4, 2.0, 1.0), Room.STORAGE],
	# северо-восточная двухкомнатная
	[Rect2(1.8, -10.3, 2.6, 2.4), Room.KITCHEN],
	[Rect2(4.9, -7.5, 1.9, 1.7), Room.BATH],
	[Rect2(4.9, -5.7, 1.9, 0.9), Room.STORAGE],
	# юго-восточная трёхкомнатная
	[Rect2(9.8, 7.7, 3.0, 2.6), Room.KITCHEN],
	[Rect2(1.1, 6.5, 2.0, 1.5), Room.BATH],
	[Rect2(1.1, 5.4, 2.0, 1.0), Room.STORAGE],
	# юго-западная двухкомнатная
	[Rect2(-4.4, 7.9, 2.6, 2.4), Room.KITCHEN],
	[Rect2(-6.8, 5.8, 1.9, 1.7), Room.BATH],
	[Rect2(-6.8, 4.8, 1.9, 0.9), Room.STORAGE],
	# западная однокомнатная
	[Rect2(-12.8, -5.0, 2.8, 2.2), Room.KITCHEN],
	[Rect2(-8.4, -2.9, 2.6, 1.6), Room.BATH],
	# западная двухкомнатная
	[Rect2(-12.8, 2.8, 2.8, 2.4), Room.KITCHEN],
	[Rect2(-8.4, 1.0, 2.6, 1.5), Room.BATH],
	[Rect2(-8.4, 2.6, 2.6, 0.9), Room.STORAGE],
	# восточная однокомнатная
	[Rect2(10.0, -5.0, 2.8, 2.2), Room.KITCHEN],
	[Rect2(5.8, -2.9, 2.6, 1.6), Room.BATH],
	# восточная двухкомнатная
	[Rect2(10.0, 2.8, 2.8, 2.4), Room.KITCHEN],
	[Rect2(5.8, 1.0, 2.6, 1.5), Room.BATH],
	[Rect2(5.8, 2.6, 2.6, 0.9), Room.STORAGE],
]

## Лоджии по углам: выступают за фасад, поэтому строятся отдельной геометрией.
const LOGGIAS: Array[Rect2] = [
	Rect2(-12.6, -10.5, 3.4, -1.3),
	Rect2(9.2, -10.5, 3.4, -1.3),
	Rect2(-12.6, 10.5, 3.4, 1.3),
	Rect2(9.2, 10.5, 3.4, 1.3),
]


static func _door(offset: float, width: float = ROOM_DOOR) -> Vector3:
	return Vector3(offset, width, KIND_DOOR)


static func _win(offset: float, width: float = WIN_W) -> Vector3:
	return Vector3(offset, width, KIND_WINDOW)

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


## Первый этаж отличается от типового: вместо южной пары квартир — вестибюль,
## тамбур с улицы, мусорокамера под стволом и колясочная.
func build(floors_count: int = 4) -> void:
	_mat_wall = _make_mat(Color(0.60, 0.60, 0.58))
	_mat_floor = _make_mat(Color(0.33, 0.34, 0.33))
	_mat_stair = _make_mat(Color(0.46, 0.42, 0.37))
	_mat_shaft = _make_mat(Color(0.38, 0.40, 0.42))

	for f in floors_count:
		by_floor[f] = []
		_build_floor(f, f < floors_count - 1, f == 0)
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

func _build_floor(f: int, with_stairs: bool, is_ground: bool = false) -> void:
	var y := f * FLOOR_HEIGHT
	_slab(f, false)
	_outer_walls(f, y, is_ground)
	_corridor_walls(f, y, is_ground)
	_core_walls(f, y)
	if is_ground:
		_ground_entrance(f, y)
		_flats(f, y, true)
	else:
		_flats(f, y, false)
	_shafts(f, y)
	_loggias(f, y)
	_room_marks(f, y)
	if with_stairs:
		_stairs(f)


func _outer_walls(f: int, y: float, is_ground: bool = false) -> void:
	_wall_run(f, Vector3(0, y, -HALF_D), Vector3(1, 0, 0), HALF_W * 2.0,
			[_win(-9.0), _win(-4.0), _win(3.0), _win(8.5)])
	var south: Array[Vector3] = [_win(-8.5), _win(9.0)]
	if is_ground:
		south.append(_door(0.0, 2.0))            # входная дверь в тамбур
	else:
		south.append(_win(-3.0))
		south.append(_win(4.0))
	_wall_run(f, Vector3(0, y, HALF_D), Vector3(1, 0, 0), HALF_W * 2.0, south)
	_wall_run(f, Vector3(-HALF_W, y, 0), Vector3(0, 0, 1), HALF_D * 2.0,
			[_win(-6.5), _win(-2.5), _win(2.5), _win(6.5)])
	_wall_run(f, Vector3(HALF_W, y, 0), Vector3(0, 0, 1), HALF_D * 2.0,
			[_win(-6.5), _win(-2.5), _win(2.5), _win(6.5)])


## Стены кольцевого коридора: в них восемь входных дверей квартир.
func _corridor_walls(f: int, y: float, is_ground: bool = false) -> void:
	_wall_run(f, Vector3(0, y, -CORR_Z), Vector3(1, 0, 0), CORR_X * 2.0,
			[_door(-2.9, DOOR_W), _door(3.3, DOOR_W)], true)
	if is_ground:
		# на первом этаже южная сторона коридора открыта в вестибюль
		_wall_run(f, Vector3(0, y, CORR_Z), Vector3(1, 0, 0), CORR_X * 2.0,
				[_door(0.0, 3.4)], true)
	else:
		_wall_run(f, Vector3(0, y, CORR_Z), Vector3(1, 0, 0), CORR_X * 2.0,
				[_door(2.9, DOOR_W), _door(-3.3, DOOR_W)], true)
	_wall_run(f, Vector3(-CORR_X, y, 0), Vector3(0, 0, 1), CORR_Z * 2.0,
			[_door(-3.3, DOOR_W), _door(2.1, DOOR_W)], true)
	_wall_run(f, Vector3(CORR_X, y, 0), Vector3(0, 0, 1), CORR_Z * 2.0,
			[_door(-2.1, DOOR_W), _door(3.3, DOOR_W)], true)


## Стены ядра. По чертежу серии лестница стоит между двумя лифтами,
## поэтому с южной стороны три проёма: к лестнице по центру и к обеим шахтам.
func _core_walls(f: int, y: float) -> void:
	_wall_run(f, Vector3(0, y, -CORE_Z), Vector3(1, 0, 0), CORE_X * 2.0, [] as Array[Vector3], true)
	_wall_run(f, Vector3(-CORE_X, y, 0), Vector3(0, 0, 1), CORE_Z * 2.0, [] as Array[Vector3], true)
	_wall_run(f, Vector3(CORE_X, y, 0), Vector3(0, 0, 1), CORE_Z * 2.0, [] as Array[Vector3], true)
	_wall_run(f, Vector3(0, y, CORE_Z), Vector3(1, 0, 0), CORE_X * 2.0,
			[_door(-2.9, 1.2), _door(0.0, 2.6), _door(2.9, 1.2)], true)


## Внутренние перегородки квартир.
##
## Раскладка по чертежу серии: квартиры вытянуты вглубь корпуса, а не лежат
## полосами вдоль фасадов. Размеры комнат взяты с плана БТИ трёхкомнатной
## квартиры: 20,8 (6,20 x 3,35), 15,0 (4,82 x 3,12), 12,6 (4,76 x 2,68),
## кухня 9,2 (3,40 x 2,72).
func _flats(f: int, y: float, is_ground: bool) -> void:
	# --- западная трёхкомнатная: X -13..-5,5, Z -10,5..-0,6 ---
	_three_room(f, y, -1.0, 1.0)
	# --- восточная трёхкомнатная: тот же план, повёрнутый на 180 ---
	_three_room(f, y, 1.0, -1.0)

	# --- северные однокомнатные: между трёшкой и коридором ---
	_wall_run(f, Vector3(0.5, y, -7.95), Vector3(0, 0, 1), 5.1, [] as Array[Vector3], true)
	_one_room(f, y, -2.5, -1.0)
	_one_room(f, y, 3.5, -1.0)

	# --- южные двухкомнатные (на первом этаже вместо них вестибюль) ---
	if not is_ground:
		_wall_run(f, Vector3(-0.5, y, 7.95), Vector3(0, 0, 1), 5.1, [] as Array[Vector3], true)
		_one_room(f, y, 2.5, 1.0)
		_one_room(f, y, -3.5, 1.0)

	# --- западная и восточная двухкомнатные, южнее трёшек ---
	_two_room(f, y, -1.0, 1.0)
	_two_room(f, y, 1.0, -1.0)


## Трёхкомнатная по плану БТИ. sx = -1 западная, +1 восточная;
## sz задаёт разворот на 180 градусов.
func _three_room(f: int, y: float, sx: float, sz: float) -> void:
	var x_out := 12.8 * sx          # наружная стена
	var x_in := 5.7 * sx            # стена коридора
	var z_out := 10.3 * sz          # торцевой фасад
	# комната 20,8: 6,20 вдоль фасада, 3,35 вглубь
	_wall_run(f, Vector3((x_out + x_in) * 0.5, y, z_out - 3.35 * sz), Vector3(1, 0, 0), 7.1,
			[_door(2.2 * sx)], true)
	# коридор квартиры вдоль стены с соседями
	_wall_run(f, Vector3(x_in + 1.6 * sx, y, z_out - 6.2 * sz), Vector3(0, 0, 1), 5.8,
			[_door(1.2 * sz), _door(-1.6 * sz)], true)
	# комната 15,0 и комната 12,6 — одна за другой вглубь
	_wall_run(f, Vector3((x_out + x_in) * 0.5 - 0.8 * sx, y, z_out - 6.47 * sz), Vector3(1, 0, 0), 5.5,
			[] as Array[Vector3], true)
	# кухня 9,2 у дальнего конца
	_wall_run(f, Vector3((x_out + x_in) * 0.5 - 0.8 * sx, y, z_out - 9.19 * sz), Vector3(1, 0, 0), 5.5,
			[_door(-1.4 * sx)], true)
	# санузел раздельный, у стены коридора
	_wall_run(f, Vector3(x_in + 1.4 * sx, y, z_out - 8.0 * sz), Vector3(1, 0, 0), 2.8,
			[] as Array[Vector3], true)


## Двухкомнатная: тот же приём, короче на одну комнату.
func _two_room(f: int, y: float, sx: float, sz: float) -> void:
	var x_out := 12.8 * sx
	var x_in := 5.7 * sx
	var z_far := 10.3 * sz
	_wall_run(f, Vector3((x_out + x_in) * 0.5, y, z_far - 3.4 * sz), Vector3(1, 0, 0), 7.1,
			[_door(2.0 * sx)], true)
	_wall_run(f, Vector3(x_in + 1.7 * sx, y, z_far - 6.0 * sz), Vector3(0, 0, 1), 5.4,
			[_door(1.4 * sz)], true)
	_wall_run(f, Vector3((x_out + x_in) * 0.5 - 0.9 * sx, y, z_far - 7.2 * sz), Vector3(1, 0, 0), 5.3,
			[_door(-1.2 * sx)], true)


## Однокомнатная: кухня, комната, санузел, прихожая.
func _one_room(f: int, y: float, cx: float, sz: float) -> void:
	var z_out := 10.3 * sz
	_wall_run(f, Vector3(cx, y, z_out - 2.9 * sz), Vector3(1, 0, 0), 5.6,
			[_door(1.6)], true)
	_wall_run(f, Vector3(cx + 1.7, y, z_out - 1.5 * sz), Vector3(0, 0, 1), 2.9,
			[] as Array[Vector3], true)


## Входная группа первого этажа: тамбур, вестибюль с почтовыми ящиками,
## колясочная и мусорокамера под стволом мусоропровода.
func _ground_entrance(f: int, y: float) -> void:
	# тамбур: вторая дверь отделяет улицу от вестибюля
	_wall_run(f, Vector3(0, y, 8.6), Vector3(1, 0, 0), 5.2, [_door(0.0, 1.6)], true)
	_wall_run(f, Vector3(-2.6, y, 9.5), Vector3(0, 0, 1), 1.9, [] as Array[Vector3], true)
	_wall_run(f, Vector3(2.6, y, 9.5), Vector3(0, 0, 1), 1.9, [] as Array[Vector3], true)

	# колясочная слева от вестибюля
	_wall_run(f, Vector3(-5.6, y, 7.6), Vector3(0, 0, 1), 4.4, [_door(1.2)], true)
	_wall_run(f, Vector3(-9.0, y, 5.4), Vector3(1, 0, 0), 6.8, [] as Array[Vector3], true)

	# помещение уборщицы справа
	_wall_run(f, Vector3(5.6, y, 7.6), Vector3(0, 0, 1), 4.4, [_door(1.2)], true)
	_wall_run(f, Vector3(9.0, y, 5.4), Vector3(1, 0, 0), 6.8, [] as Array[Vector3], true)

	# мусорокамера под стволом: вход из коридора, отдельный выход на улицу
	_wall_run(f, Vector3(-4.7, y, -2.3), Vector3(1, 0, 0), 2.0, [] as Array[Vector3], true)
	_wall_run(f, Vector3(-5.7, y, -3.4), Vector3(0, 0, 1), 2.2, [_door(0.0, DOOR_W)], true)


## Шахты лифтов по краям ядра, между ними лестница. Мусоропровод у северной
## стены — его ствол идёт вертикально через все этажи в мусорокамеру внизу.
func _shafts(f: int, y: float) -> void:
	var h := FLOOR_HEIGHT - WALL_THICK
	_box(f, Vector3(-2.9, y + h * 0.5, 1.6), Vector3(1.7, h, 2.4), _mat_shaft, "LiftPass")
	_box(f, Vector3(2.9, y + h * 0.5, 1.5), Vector3(1.7, h, 2.6), _mat_shaft, "LiftCargo")
	if f > 0:
		_box(f, Vector3(-3.0, y + h * 0.5, -2.9), Vector3(1.2, h, 1.2), _mat_shaft, "Chute")
	_box(f, Vector3(2.9, y + h * 0.5, -2.9), Vector3(1.6, h, 1.2), _mat_shaft, "Panel")


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
	var hx0 := -1.8
	var hx1 := 1.8
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


## Лестница в два марша между лифтовыми шахтами, по центру ядра.
func _stairs(f: int) -> void:
	var y0 := f * FLOOR_HEIGHT
	var half_rise := FLOOR_HEIGHT * 0.5
	var run := 2.6
	var z_near := CORE_Z - 0.6
	var z_mid := z_near - run

	_flight(f, Vector3(-0.85, y0, z_near), Vector3(0, 0, -1), half_rise, run, 1.4)
	_landing(f, y0 + half_rise, z_mid)
	_flight(f, Vector3(0.85, y0 + half_rise, z_mid), Vector3(0, 0, 1), half_rise, run, 1.4)


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
	var mi := _spawn(mesh, Vector3(0.0, y - WALL_THICK * 0.5, z_mid - 0.75), _mat_floor, f)
	mi.name = "Landing_%d" % f


# ---------------------------------------------------------------------------
#  Примитивы
# ---------------------------------------------------------------------------

## Стена вдоль dir длиной length с проёмами: (смещение от центра, ширина).
func _wall_run(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector3], interior: bool = false) -> void:
	var segments: Array[Vector2] = []
	var cuts: Array[Vector3] = holes.duplicate()
	cuts.sort_custom(func(a, b): return a.x < b.x)

	var cursor := -length * 0.5
	for h: Vector3 in cuts:
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

	for h: Vector3 in cuts:
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
		_mark(f, center + dir * h.x, dir, h.y, h.z, center.y)


## Лоджии: плита пола с ограждением, выступают за наружную стену.
func _loggias(f: int, y: float) -> void:
	for r: Rect2 in LOGGIAS:
		var depth: float = absf(r.size.y)
		var z_out: float = r.position.y + r.size.y
		var cz: float = (r.position.y + z_out) * 0.5
		var cx: float = r.position.x + r.size.x * 0.5

		var slab := BoxMesh.new()
		slab.size = Vector3(r.size.x, WALL_THICK, depth)
		var mi := _spawn(slab, Vector3(cx, y - WALL_THICK * 0.5, cz), _mat_floor, f)
		mi.name = "Loggia_%d" % f

		# ограждение по внешнему краю, высотой 1,1 м
		var rail := BoxMesh.new()
		rail.size = Vector3(r.size.x, 1.1, 0.12)
		var mi2 := _spawn(rail, Vector3(cx, y + 0.55, z_out), _mat_wall, f)
		mi2.name = "LoggiaRail_%d" % f


## Метки помещений на полу: кухня, санузел, кладовая, лоджия.
func _room_marks(f: int, y: float) -> void:
	if not marks_visible:
		return
	for entry in ROOMS:
		_room_mark(f, entry[0] as Rect2, entry[1] as int, y)
	for r: Rect2 in LOGGIAS:
		var depth: float = absf(r.size.y)
		var cz: float = r.position.y + r.size.y * 0.5
		_room_mark(f, Rect2(r.position.x, cz - depth * 0.5, r.size.x, depth), Room.BALCONY, y)


func _room_mark(f: int, r: Rect2, kind: int, y: float) -> void:
	var col: Color
	match kind:
		Room.KITCHEN: col = Color(0.98, 0.62, 0.20)
		Room.BATH:    col = Color(0.20, 0.78, 0.78)
		Room.STORAGE: col = Color(0.72, 0.52, 0.28)
		_:            col = Color(0.85, 0.38, 0.78)

	var mesh := BoxMesh.new()
	mesh.size = Vector3(r.size.x, 0.03, r.size.y)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(col.r, col.g, col.b, 0.55)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = col
	mat.emission_energy_multiplier = 0.7
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = Vector3(r.position.x + r.size.x * 0.5, y + 0.02, r.position.y + r.size.y * 0.5)
	mi.name = "RoomMark_%d" % f
	add_child(mi)
	mi.set_meta("floor", f)
	mi.set_meta("is_mark", true)


## Цветная метка проёма: зелёная — дверь, голубая — окно.
## Метки не имеют коллизии и нужны только для проверки планировки глазами.
func _mark(f: int, pos: Vector3, dir: Vector3, width: float, kind: float, base_y: float) -> void:
	if not marks_visible:
		return
	var is_win := kind >= 0.5
	var h := 1.0 if is_win else 2.1        # окно: полоса на уровне подоконника
	var y := base_y + (1.5 if is_win else h * 0.5)

	var mesh := BoxMesh.new()
	var t := 0.06
	if dir.z > 0.5:
		mesh.size = Vector3(WALL_THICK + t, h, width)
	else:
		mesh.size = Vector3(width, h, WALL_THICK + t)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.35, 0.85, 0.45, 0.45) if not is_win else Color(0.35, 0.70, 0.95, 0.45)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(0.25, 0.85, 0.40) if not is_win else Color(0.30, 0.65, 0.95)
	mat.emission_energy_multiplier = 0.9
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = Vector3(pos.x, y, pos.z)
	mi.name = ("WinMark_%d" % f) if is_win else ("DoorMark_%d" % f)
	add_child(mi)
	mi.set_meta("floor", f)
	mi.set_meta("is_mark", true)


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
