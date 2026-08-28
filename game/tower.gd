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

const DOOR_FLAT := 0.90
const DOOR_ROOM := 0.80
const WIN := 1.7

const KIND_DOOR := 0.0
const KIND_WIN := 1.0

enum Room { LIVING, KITCHEN, BATH, HALL, CORE, LOGGIA, SHAFT, STORE }

const LIV := Room.LIVING
const KIT := Room.KITCHEN
const BAT := Room.BATH
const HAL := Room.HALL
const COR := Room.CORE
const LOG := Room.LOGGIA
const SHF := Room.SHAFT
const STO := Room.STORE   ## кладовая, на планах БТИ подписана 5а (в трёшке 7а/7б)

## [x0, z0, x1, z1, квартира, назначение]
## Квартиры пронумерованы как в БТИ: 46 44 45 43 по северу, 42 41 48 47 по югу,
## 8 — места общего пользования.
const ROOMS := [
	# --- 46, северо-запад ---------------------------------------------------
	[-17.88,  -8.06, -16.19,  -3.73, 0, LOG],  # лоджия 1б
	[-16.15,  -8.73, -13.30,  -3.95, 0, LIV],  # 14,0 = 2,80 x 4,78
	[-13.30,  -8.73,  -9.96,  -3.19, 0, LIV],  # 18,5 = 3,42 x 5,54
	[-17.32,  -3.73, -14.17,  -0.39, 0, KIT],  # кухня 3
	[-14.17,  -2.13, -13.15,  -0.39, 0, BAT],  # ванная 4
	[-13.15,  -2.13, -11.84,  -0.39, 0, BAT],  # уборная 5
	[-11.84,  -3.19,  -9.96,  -2.34, 0, STO],  # кладовая (5а на плане БТИ)
	[-11.84,  -2.34,  -9.96,  -0.39, 0, HAL],
	# --- 44, север-центр, трёхкомнатная -----------------------------------
	[ -9.51,  -9.24,  -3.28,  -8.06, 1, LOG],  # лоджия 1б
	[ -3.06,  -9.24,   2.92,  -8.06, 1, LOG],  # лоджия 3а
	[ -9.40,  -7.52,  -6.03,  -1.33, 1, LIV],  # 20,7 = 3,37 x 6,10
	[ -6.03,  -7.52,  -3.42,  -2.89, 1, LIV],  # 12,2 = 2,57 x 4,71
	[ -3.44,  -7.52,  -0.12,  -2.88, 1, LIV],  # 15,1 = 3,24 x 4,72
	[ -6.03,  -2.80,  -5.18,  -1.33, 1, STO],  # кладовая (5а на плане БТИ)
	[ -5.18,  -2.80,  -0.12,  -1.33, 1, HAL],
	[  0.43,  -7.51,   3.02,  -4.97, 1, KIT],
	[  0.70,  -3.43,   1.90,  -2.65, 1, BAT],
	[  0.70,  -2.46,   3.02,  -0.97, 1, BAT],
	[ -0.12,  -4.97,   0.70,  -0.39, 1, HAL],
	# --- 45, север справа от центра, однокомнатная -------------------------
	[  3.38,  -9.17,   9.40,  -8.04, 2, LOG],  # лоджия 1а
	[  3.68,  -7.46,   5.93,  -4.45, 2, KIT],  # кухня 2
	[  6.02,  -7.46,   9.44,  -2.74, 2, LIV],  # 19,1 = 3,37 x 6,16, Г-образная
	[  7.31,  -2.74,   9.44,  -0.85, 2, LIV],
	[  3.22,  -3.40,   5.01,  -2.65, 2, BAT],  # уборная 3
	[  3.22,  -2.49,   5.01,  -0.85, 2, BAT],  # ванная 4
	[  6.46,  -2.65,   7.31,  -0.85, 2, STO],  # кладовая (5а на плане БТИ)
	[  5.10,  -2.65,   6.46,  -0.85, 2, HAL],
	[  5.10,  -4.45,   6.02,  -2.65, 2, HAL],  # проход из прихожей в кухню
	# --- 43, северо-восток (зеркало 46) -----------------------------------
	[ 16.19,  -8.06,  17.88,  -3.73, 3, LOG],
	[ 13.30,  -8.73,  16.11,  -3.95, 3, LIV],  # 13,9
	[  9.92,  -8.73,  13.30,  -3.19, 3, LIV],  # 18,2
	[ 14.21,  -3.73,  17.32,  -0.39, 3, KIT],
	[ 12.90,  -2.13,  14.21,  -0.39, 3, BAT],
	[ 11.93,  -2.13,  12.90,  -0.39, 3, BAT],
	[  9.92,  -3.19,  11.93,  -2.34, 3, STO],  # кладовая (5а на плане БТИ)
	[  9.92,  -2.34,  11.93,  -0.39, 3, HAL],
	# --- общий коридор ----------------------------------------------------
	[-11.70,  -0.39,  11.74,   0.70, 8, HAL],
	# --- 42, юго-запад ----------------------------------------------------
	[-17.85,   3.70, -16.11,   8.60, 4, LOG],  # лоджия 2б
	[-16.09,   3.88, -13.26,   8.67, 4, LIV],  # 13,8 = 2,80 x 4,79
	[-13.26,   3.13,  -9.91,   8.67, 4, LIV],  # 18,6 = 3,39 x 5,54
	[-17.32,   0.36, -14.17,   3.02, 4, KIT],  # кухня 3
	[-14.17,   0.36, -12.80,   2.02, 4, BAT],  # ванная 4
	[-12.80,   0.36, -11.84,   2.02, 4, BAT],  # уборная 5
	[-11.84,   0.70,  -9.91,   1.55, 4, STO],  # кладовая (5а на плане БТИ)
	[-11.84,   1.55,  -9.91,   3.13, 4, HAL],
	# --- 41, юг слева от ядра, однокомнатная -------------------------------
	[ -9.32,   7.54,  -3.33,   9.20, 5, LOG],  # лоджия 1а
	[ -9.33,   1.10,  -7.14,   2.75, 5, LIV],  # 18,5 — Г-образная
	[ -9.33,   2.75,  -5.92,   7.42, 5, LIV],
	[ -7.14,   1.10,  -5.92,   2.75, 5, HAL],  # прихожая 5
	[ -5.92,   3.72,  -4.84,   4.49, 5, STO],  # кладовая (5а на плане БТИ)
	[ -5.92,   1.10,  -4.84,   3.72, 5, HAL],
	[ -4.84,   3.49,  -3.17,   4.49, 5, HAL],
	[ -4.84,   1.10,  -3.17,   2.57, 5, BAT],  # ванная 4
	[ -4.84,   2.57,  -3.17,   3.49, 5, BAT],  # уборная 3
	[ -5.92,   4.49,  -3.17,   7.42, 5, KIT],  # кухня 2
	# --- 48, юг справа от ядра (зеркало 41) --------------------------------
	[  3.49,   7.54,   9.48,   9.20, 6, LOG],
	[  7.30,   1.10,   9.49,   2.75, 6, LIV],  # 19,2 — Г-образная
	[  6.33,   2.75,   9.49,   7.42, 6, LIV],
	[  6.33,   1.10,   7.30,   2.75, 6, HAL],
	[  5.00,   3.72,   6.33,   4.49, 6, STO],  # кладовая (5а на плане БТИ)
	[  5.00,   1.10,   6.33,   3.72, 6, HAL],
	[  3.47,   3.49,   5.00,   4.49, 6, HAL],
	[  3.47,   1.10,   5.00,   2.57, 6, BAT],
	[  3.47,   2.57,   5.00,   3.49, 6, BAT],
	[  3.47,   4.49,   6.33,   7.42, 6, KIT],
	# --- 47, юго-восток (зеркало 42) --------------------------------------
	[ 16.15,   3.70,  17.98,   8.60, 7, LOG],
	[ 13.34,   3.88,  16.17,   8.67, 7, LIV],  # 13,5
	[ 10.04,   3.13,  13.34,   8.67, 7, LIV],  # 18,7
	[ 14.21,   0.36,  17.32,   3.02, 7, KIT],
	[ 12.80,   0.36,  14.21,   2.02, 7, BAT],
	[ 11.93,   0.36,  12.80,   2.02, 7, BAT],
	[ 10.04,   0.70,  11.93,   1.55, 7, STO],  # кладовая (5а на плане БТИ)
	[ 10.04,   1.55,  11.93,   3.13, 7, HAL],
	# --- ядро: лестница, лифтовой холл, две шахты, балкон «г» -------------
	[ -2.83,   0.70,  -0.61,   7.49, 8, COR],
	[ -0.54,   0.70,   3.38,   7.49, 8, COR],
	[ -0.16,   1.20,   1.48,   3.00, 8, SHF],
	[ -0.16,   5.35,   1.48,   7.16, 8, SHF],
	[ -2.83,   7.62,  -0.61,   9.20, 8, LOG],
]

## Выход из подъезда: на первом этаже парапет лоджии «г» у лестничной клетки
## разрывается на ширину двери, а снаружи кладётся площадка, иначе выйти
## некуда — за порогом обрыв и навигации там нет.
const EXIT_X := -1.65        ## середина выхода по X
const EXIT_W := 1.40
const APRON := 5.0           ## насколько площадка выступает за габарит дома

## Лестничная клетка — левая часть ядра.
const STAIR_X0 := -2.70
const STAIR_X1 := -0.61
const STAIR_Z0 := 0.70
const STAIR_Z1 := 7.49

var fadeable: Array[MeshInstance3D] = []
var by_floor: Dictionary = {}
var marks_visible := true
var only_flat := -1        ## подсветить одну квартиру, остальные приглушить

var traced_count := 0     ## стен с проёмами, снятыми с чертежа
var rule_count := 0       ## стен, где оси на скане нет и проёмы выведены правилом
var walls_built: Array = []
var unreachable: Array[int] = []
var added_count := 0      ## дверей, добавленных ради проходимости

var _m_wall: ShaderMaterial
var _m_floor: ShaderMaterial
var _m_stair: ShaderMaterial
var _m_shaft: ShaderMaterial
var _m_glass: StandardMaterial3D
var _m_frame: ShaderMaterial
var _m_wall_worn: ShaderMaterial
var _m_facade: ShaderMaterial
var _m_core_floor: ShaderMaterial

const FADE_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley;

// Текстуры кладутся трипланарно по мировым координатам: стены и полы —
// это боксы разных размеров, развёртки у них нет, а тайл должен быть
// одинаковым в метрах на всех поверхностях.
uniform sampler2D tex_albedo : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_orm : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform bool textured = false;
uniform float tile = 2.0;              // сколько метров на один повтор

uniform vec3 base_color : source_color = vec3(0.60, 0.60, 0.58);
uniform float rough = 0.92;
uniform vec3 tint_top : source_color = vec3(1.0);
uniform vec3 focus_pos = vec3(0.0);
uniform float focus_radius = 1.9;
uniform float focus_soft = 0.9;

instance uniform float fade = 1.0;
instance uniform float hole_mode = 1.0;

varying vec3 world_pos;
varying vec3 world_normal;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec4 triplanar(sampler2D t, vec3 p, vec3 n) {
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	return texture(t, p.zy) * w.x + texture(t, p.xz) * w.y + texture(t, p.xy) * w.z;
}

void fragment() {
	vec3 col = base_color * mix(vec3(0.82), tint_top, clamp(NORMAL.y, 0.0, 1.0));
	float r = rough;
	float ao = 1.0;
	if (textured) {
		vec3 p = world_pos / tile;
		vec3 n = normalize(world_normal);
		col = triplanar(tex_albedo, p, n).rgb;
		vec3 orm = triplanar(tex_orm, p, n).rgb;
		ao = orm.r;
		r = orm.g;
		NORMAL_MAP = triplanar(tex_normal, p, n).rgb;
		NORMAL_MAP_DEPTH = 0.8;
	}
	ALBEDO = col;
	ROUGHNESS = r;
	METALLIC = 0.0;
	AO = ao;
	AO_LIGHT_AFFECT = 0.6;
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
	# Габарит квартиры не заливаем: он накрывает и пустоты между помещениями,
	# и от этого на картинке появляются цветные пятна, за которыми ничего нет.
	# Принадлежность к квартире показывают подписи, а цвет — назначение.
	for r in rooms():
		var col: Color
		if only_flat >= 0 and int(r["flat"]) != only_flat:
			_plate(f, r["rect"] as Rect2, Color(0.42, 0.42, 0.44), 0.55, y + 0.06)
			continue
		match int(r["kind"]):
			Room.KITCHEN: col = Color(0.97, 0.58, 0.16)
			Room.BATH:    col = Color(0.16, 0.76, 0.82)
			Room.HALL:    col = Color(0.66, 0.66, 0.70)
			Room.CORE:    col = Color(0.36, 0.48, 0.96)
			Room.LOGGIA:  col = Color(0.46, 0.82, 0.36)
			Room.SHAFT:   col = Color(0.55, 0.20, 0.55)
			Room.STORE:   col = Color(0.80, 0.72, 0.30)
			_:            col = Color(0.92, 0.84, 0.58)
		_plate(f, r["rect"] as Rect2, col, 0.82, y + 0.06)


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
	_load_extra_doors()
	_m_wall = _mat(Color(0.62, 0.61, 0.58), "wall-paint")
	_m_wall_worn = _mat(Color(0.60, 0.58, 0.54), "wall-paint-worn")
	_m_facade = _mat(Color(0.55, 0.55, 0.54), "concrete-facade")
	_m_floor = _mat(Color(0.45, 0.45, 0.44), "concrete-facade", 2.4)
	_m_core_floor = _mat(Color(0.33, 0.34, 0.33), "landing-floor", 1.2)
	_m_stair = _mat(Color(0.46, 0.42, 0.37), "stair-tread", 0.6)
	_m_shaft = _mat(Color(0.42, 0.43, 0.44), "concrete-facade", 1.6)
	_m_frame = _mat(Color(0.80, 0.79, 0.75))
	_m_glass = StandardMaterial3D.new()
	_m_glass.albedo_color = Color(0.60, 0.74, 0.80, 0.28)
	_m_glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_m_glass.cull_mode = BaseMaterial3D.CULL_DISABLED
	_m_glass.roughness = 0.06
	_m_glass.metallic = 0.25
	_m_glass.metallic_specular = 0.9
	_apron()
	for f in floors:
		by_floor[f] = []
		_floor(f, f < floors - 1)
	_slab(floors - 1, true)


## Двери, найденные физической проверкой, лежат отдельным файлом — он
## перегенерируется командой  --fix-reach  и в игре только читается.
func _load_extra_doors() -> void:
	if not extra_doors.is_empty():
		return
	if not ResourceLoader.exists("res://plan_extra_doors.gd"):
		return
	var scr: GDScript = load("res://plan_extra_doors.gd")
	var map := scr.get_script_constant_map()
	if map.has("DOORS"):
		extra_doors = (map["DOORS"] as Dictionary).duplicate(true)


## Площадка вокруг дома: по ней бот выходит наружу. Кладём её в само здание,
## иначе она не попадёт в навигационную сетку — её печём только по зданию.
func _apron() -> void:
	if not by_floor.has(0):
		by_floor[0] = []
	var mesh := BoxMesh.new()
	mesh.size = Vector3(W_HALF * 2.0 + APRON * 2.0, 0.20, D_HALF * 2.0 + APRON * 2.0)
	var mi := _spawn(mesh, Vector3(0, -0.15, 0), _m_floor, 0)
	mi.name = "Apron"
	mi.set_meta("is_ceiling", false)


func set_focus(p: Vector3) -> void:
	for m in [_m_wall, _m_floor, _m_stair, _m_shaft]:
		if m:
			m.set_shader_parameter("focus_pos", p)


func _floor(f: int, with_stairs: bool) -> void:
	var y := f * FLOOR_H
	_slab(f, false)
	_emit_walls(f, y)
	_core_floor(f, y)
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


## Дверь допустима только внутри одной квартиры или из мест общего
## пользования. Межквартирную стену не режем никогда — как бы ни хотелось
## проверке проходимости: из комнаты в комнату соседней квартиры хода нет.
func _may_open(a: int, b: int) -> bool:
	if a < 0 or b < 0:
		return false
	if int(ROOMS[a][5]) == SHF or int(ROOMS[b][5]) == SHF:
		return false
	var fa := int(ROOMS[a][4])
	var fb := int(ROOMS[b][4])
	if fa == fb:
		return true
	if fa != 8 and fb != 8:
		return false
	# из мест общего пользования входят в прихожую, а не в комнату или санузел
	var ka := int(ROOMS[a][5])
	var kb := int(ROOMS[b][5])
	var hall_a := ka == HAL or ka == COR
	var hall_b := kb == HAL or kb == COR
	return hall_a and hall_b


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
	var recs := _collect_walls()
	_ensure_entrances(recs)
	_ensure_room_doors(recs)
	_ensure_windows(recs)
	_link_rooms(recs)
	walls_built = recs
	for w in recs:
		var axis: int = w["axis"]
		var dir := Vector3(0, 0, 1) if axis == 1 else Vector3(1, 0, 0)
		var fixed: float = w["fixed"]
		var mid: float = w["mid"]
		if w["parapet"]:
			_parapet(f, y, axis, fixed, w["a0"], w["a1"])
			continue
		var center := Vector3(fixed, y, mid) if axis == 1 else Vector3(mid, y, fixed)
		_wall(f, center, dir, w["len"], w["holes"] as Array[Vector3], w["thick"])


## Стены и проёмы берутся из PlanWalls — он собран по таблице ROOMS и скану
## одной разбивкой, поэтому совпадающие оси соседних помещений это один
## участок, а не две стены друг в друге.
func _collect_walls() -> Array:
	var recs: Array = []
	traced_count = 0
	rule_count = 0
	for w in PlanWalls.WALLS:
		var axis: int = w[0]
		var fixed: float = w[1]
		var a0: float = w[2]
		var a1: float = w[3]
		var inner: int = w[4]
		var outer: int = w[5]
		var typ: int = w[6]
		var length := a1 - a0
		var mid := (a0 + a1) * 0.5
		if typ == 2:
			recs.append({"axis": axis, "fixed": fixed, "a0": a0, "a1": a1, "mid": mid,
					"len": length, "inner": inner, "outer": -1,
					"holes": [] as Array[Vector3], "thick": WALL, "parapet": true})
			continue
		var holes: Array[Vector3] = []
		if int(w[8]) == 1:
			traced_count += 1
			for v in w[7]:
				var h: Vector3 = v
				# косяки на скане съедают края проёма — добавляем их обратно
				if h.z < 0.5:
					if not _may_open(inner, outer) and outer >= 0:
						continue      # «дверь» сквозь межквартирную стену — промах чтения
					h.y = maxf(h.y, 0.70)
				elif outer >= 0 and typ != 1:
					continue          # «окно» во внутренней стене — тоже промах
				holes.append(h)
		else:
			rule_count += 1
			var op := _opening(inner, outer, length, typ == 1)
			if op == 0:
				holes.append(Vector3(0.0, DOOR_FLAT if length > 3.0 else DOOR_ROOM, KIND_DOOR))
			elif op == 1:
				if length < 4.2:
					holes.append(Vector3(0.0, WIN, KIND_WIN))
				else:
					holes.append(Vector3(-length * 0.22, WIN, KIND_WIN))
					holes.append(Vector3(length * 0.22, WIN, KIND_WIN))
		var key := "%d|%.2f|%.2f|%.2f" % [axis, fixed, a0, a1]
		if extra_doors.has(key):
			for v in extra_doors[key]:
				holes.append(v)
		recs.append({"axis": axis, "fixed": fixed, "a0": a0, "a1": a1, "mid": mid,
				"len": length, "inner": inner, "outer": outer,
				"holes": _fit_holes(holes, length),
				"thick": WALL_EXT if typ == 1 else WALL, "parapet": false})
	return recs


## Место для двери выбирается там, где по обе стороны есть куда шагнуть:
## иначе проём упирается в перпендикулярную стену или шахту лифта.
func _door_pos(recs: Array, w: Dictionary, width: float) -> float:
	var axis: int = w["axis"]
	var fixed: float = w["fixed"]
	var span: float = w["len"] - width - 0.20
	if span <= 0.0:
		return 0.0
	var steps := maxi(int(span / 0.08), 1)
	var best_c: float = w["mid"]
	var best_score := -1.0
	for i in steps + 1:
		var c: float = w["a0"] + width * 0.5 + 0.10 + span * (float(i) / float(steps))
		var score := _clearance(recs, axis, fixed, c, width)
		# при равном просвете ближе к середине стены
		score -= absf(c - w["mid"]) * 0.01
		if score > best_score:
			best_score = score
			best_c = c
	return best_c - w["mid"]


## Насколько далеко от проёма ближайшая помеха по обе стороны.
func _clearance(recs: Array, axis: int, fixed: float, c: float, width: float) -> float:
	var lo := c - width * 0.5 - 0.10
	var hi := c + width * 0.5 + 0.10
	var near := 1.2
	for o in recs:
		if o["axis"] == axis:
			continue
		var of: float = o["fixed"]
		if of < lo or of > hi:
			continue
		var oa: float = o["a0"]
		var ob: float = o["a1"]
		if ob < fixed - 1.2 or oa > fixed + 1.2:
			continue
		var solid := true
		for h: Vector3 in (o["holes"] as Array[Vector3]):
			var hs: float = o["mid"] + h.x - h.y * 0.5
			var he: float = o["mid"] + h.x + h.y * 0.5
			if hs <= fixed and fixed <= he:
				solid = false
		if not solid:
			continue
		var d := 1.2
		if oa <= fixed and fixed <= ob:
			d = 0.0
		else:
			d = minf(absf(oa - fixed), absf(ob - fixed))
		near = minf(near, d)
	for r in ROOMS:
		if int(r[5]) != SHF:
			continue
		var sx0: float = r[0] if axis == 1 else r[1]
		var sx1: float = r[2] if axis == 1 else r[3]
		var sz0: float = r[1] if axis == 1 else r[0]
		var sz1: float = r[3] if axis == 1 else r[2]
		if sz1 < lo or sz0 > hi:
			continue
		if sx1 < fixed - 1.2 or sx0 > fixed + 1.2:
			continue
		var d2 := 0.0 if (sx0 <= fixed and fixed <= sx1) else minf(absf(sx0 - fixed), absf(sx1 - fixed))
		near = minf(near, d2)
	return near


## Проём должен целиком лежать в стене и не упираться в угол: иначе капсула
## игрока в него не входит, даже если по чертежу он там есть.
func _fit_holes(holes: Array[Vector3], length: float) -> Array[Vector3]:
	var fitted: Array[Vector3] = []
	for h: Vector3 in holes:
		var w := minf(h.y, length - 0.16)
		if w < 0.4:
			continue
		var lim := (length - w) * 0.5 - 0.08
		if lim < 0.0:
			lim = 0.0
		fitted.append(Vector3(clampf(h.x, -lim, lim), w, h.z))

	# Окно и дверь на одном месте несовместимы: у окна остаётся подоконник,
	# и он наглухо перекрывает дверной проём. Дверь важнее — окно убираем.
	var out: Array[Vector3] = []
	for h: Vector3 in fitted:
		if h.z >= 0.5:
			var blocked := false
			for d: Vector3 in fitted:
				if d.z < 0.5 and absf(d.x - h.x) < (d.y + h.y) * 0.5 - 0.05:
					blocked = true
			if blocked:
				continue
		out.append(h)
	return out


## Двери, добавленные проверкой проходимости (tools: main.gd --fix-reach).
## Ключ — "ось|координата|начало|конец", значение — Vector3(смещение, ширина, 0).
static var extra_doors: Dictionary = {}

## В каждую квартиру должна вести дверь из мест общего пользования — и ровно
## оттуда, а не через дыру в стене соседа. Если чертёж её не дал, ставим сами.
func _ensure_entrances(recs: Array) -> void:
	for flat in 8:
		var has := false
		var best: Dictionary = {}
		var best_rank := -1.0
		var best_off := 0.0
		var best_w := 0.0
		for w in recs:
			if w["parapet"]:
				continue
			var a: int = w["inner"]
			var b: int = w["outer"]
			if b < 0:
				continue
			var fa := int(ROOMS[a][4])
			var fb := int(ROOMS[b][4])
			if not ((fa == flat and fb == 8) or (fb == flat and fa == 8)):
				continue
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z < 0.5:
					has = true
			var inside: int = a if fa == flat else b
			var width := minf(DOOR_FLAT, w["len"] - 0.20)
			if width < DOOR_ROOM and w["len"] >= 0.70 and w["len"] <= 1.60:
				width = w["len"]
			if width < 0.70:
				continue
			var off := _door_pos(recs, w, width)
			var rank := _clearance(recs, w["axis"], w["fixed"], w["mid"] + off, width) * 10.0
			rank += minf(w["len"], 4.0)
			if int(ROOMS[inside][5]) == HAL:
				rank += 20.0        # входим в прихожую, а не в комнату
			if rank > best_rank:
				best_rank = rank
				best = w
				best_off = off
				best_w = width
		if has or best.is_empty():
			continue
		_cut(recs, best, best_off, best_w)
		rule_count += 1


## Санузел, кухня и комната открываются в прихожую своей квартиры — других
## вариантов планировка не даёт. Где чертёж двери не дал (на скане 24 px/м,
## проём санузла — 14 пикселей, и читается он через раз), ставим её сюда,
## а не куда придётся.
func _ensure_room_doors(recs: Array) -> void:
	for i in ROOMS.size():
		var kind := int(ROOMS[i][5])
		if kind == SHF or kind == COR:
			continue
		var has_door := false
		var best: Dictionary = {}
		var best_rank := -1.0
		var best_off := 0.0
		var best_w := 0.0
		for w in recs:
			if w["parapet"]:
				continue
			var a: int = w["inner"]
			var b: int = w["outer"]
			if a != i and b != i:
				continue
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z < 0.5:
					has_door = true
			if b < 0:
				continue
			var other: int = b if a == i else a
			var ok := int(ROOMS[other][5]) == HAL or int(ROOMS[other][5]) == COR
			if kind == STO:
				ok = int(ROOMS[other][5]) == HAL
			if kind == LOG:
				ok = int(ROOMS[other][5]) == LIV or int(ROOMS[other][5]) == KIT
			if not ok:
				continue
			if not _may_open(i, other):
				continue
			var width := minf(DOOR_ROOM, w["len"] - 0.20)
			if width < DOOR_ROOM and w["len"] >= 0.70 and w["len"] <= 1.60:
				width = w["len"]
			if width < 0.65:
				continue
			var off := _door_pos(recs, w, width)
			var rank := _clearance(recs, w["axis"], w["fixed"], w["mid"] + off, width) * 10.0
			rank += minf(w["len"], 4.0)
			if rank > best_rank:
				best_rank = rank
				best = w
				best_off = off
				best_w = width
		if has_door or best.is_empty():
			continue
		_cut(recs, best, best_off, best_w)
		rule_count += 1


## Жилая комната и кухня без окна не бывают. Где чертёж окна не дал —
## ставим сами: в наружную стену, а если её нет, то в стену к лоджии.
func _ensure_windows(recs: Array) -> void:
	for i in ROOMS.size():
		var kind := int(ROOMS[i][5])
		if kind != LIV and kind != KIT:
			continue
		var has := false
		var facade_wall: Dictionary = {}
		var loggia_wall: Dictionary = {}
		for w in recs:
			if w["parapet"]:
				continue
			var a: int = w["inner"]
			var b: int = w["outer"]
			if a != i and b != i:
				continue
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z >= 0.5:
					has = true
			if w["len"] < 1.4:
				continue
			if b < 0 and w["thick"] > WALL + 0.01:
				if facade_wall.is_empty() or w["len"] > float(facade_wall["len"]):
					facade_wall = w
			elif b >= 0:
				var other: int = b if a == i else a
				if int(ROOMS[other][5]) == LOG:
					if loggia_wall.is_empty() or w["len"] > float(loggia_wall["len"]):
						loggia_wall = w
		if has:
			continue
		var w2: Dictionary = facade_wall if not facade_wall.is_empty() else loggia_wall
		if w2.is_empty():
			continue
		# окно не должно выдавить уже прорезанную дверь: у стены с балконной
		# дверью на два проёма может просто не хватить длины
		var used := 0.0
		for h: Vector3 in (w2["holes"] as Array[Vector3]):
			used += h.y
		var width := minf(WIN, float(w2["len"]) - used - 0.6)
		if width < 0.9:
			continue
		# отодвигаем окно от уже прорезанной двери
		var off := 0.0
		for h: Vector3 in (w2["holes"] as Array[Vector3]):
			if h.z < 0.5 and absf(h.x - off) < (h.y + width) * 0.5 + 0.1:
				var lim: float = (float(w2["len"]) - width) * 0.5 - 0.1
				off = clampf(h.x + (h.y + width) * 0.5 + 0.15, -lim, lim)
		(w2["holes"] as Array[Vector3]).append(Vector3(off, width, KIND_WIN))
		rule_count += 1


## Черновая связка по графу дверей: из лестничной клетки должно быть достижимо
## каждое помещение. Настоящая проверка — физическая, см. ReachCheck.
func _link_rooms(recs: Array) -> void:
	added_count = 0
	unreachable = []
	var start_room := -1
	for i in ROOMS.size():
		if int(ROOMS[i][5]) == COR:
			start_room = i
			break
	if start_room < 0:
		return
	for _pass in 80:
		var links: Dictionary = {}
		for w in recs:
			var o: int = w["outer"]
			if o < 0 or w["parapet"]:
				continue
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z < 0.5:
					var a: int = w["inner"]
					if not links.has(a):
						links[a] = []
					if not links.has(o):
						links[o] = []
					(links[a] as Array).append(o)
					(links[o] as Array).append(a)
					break
		var seen := {start_room: true}
		var queue: Array[int] = [start_room]
		while not queue.is_empty():
			var cur: int = queue.pop_back()
			for nxt in (links.get(cur, []) as Array):
				if not seen.has(nxt):
					seen[nxt] = true
					queue.append(nxt)
		var stuck: Array[int] = []
		for i in ROOMS.size():
			if int(ROOMS[i][5]) != SHF and not seen.has(i):
				stuck.append(i)
		if stuck.is_empty():
			return
		if not _open_one(recs, stuck, seen):
			unreachable = stuck
			return
		added_count += 1


func _open_one(recs: Array, stuck: Array[int], seen: Dictionary) -> bool:
	var best: Dictionary = {}
	var best_rank := -1.0
	var best_off := 0.0
	var best_w := 0.0
	for w in recs:
		if w["parapet"]:
			continue
		var a: int = w["inner"]
		var b: int = w["outer"]
		if b < 0 or not _may_open(a, b):
			continue
		var a_ok := seen.has(a)
		var b_ok := seen.has(b)
		if a_ok == b_ok:
			continue
		var far: int = b if a_ok else a
		if not stuck.has(far):
			continue
		# короткая стена: дверь не влезает — открываем участок целиком
		var width := minf(DOOR_ROOM, w["len"] - 0.20)
		if width < DOOR_ROOM and w["len"] >= 0.70 and w["len"] <= 1.60:
			width = w["len"]        # короткий простенок открываем целиком
		if width < 0.70:
			continue
		var off := _door_pos(recs, w, width)
		var rank := _clearance(recs, w["axis"], w["fixed"], w["mid"] + off, width) * 10.0
		rank += minf(w["len"], 4.0)
		# лишний вход с лестницы — хуже любой двери внутри квартиры
		if int(ROOMS[a][4]) != int(ROOMS[b][4]):
			rank -= 500.0
		if rank > best_rank:
			best_rank = rank
			best = w
			best_off = off
			best_w = width
	if best.is_empty():
		return false
	_cut(recs, best, best_off, best_w)
	return true


## Прорезает дверь и, если между помещениями осталась щель со второй стеной,
## прорезает и её — иначе проём упрётся в соседнюю стену.
func _cut(recs: Array, w: Dictionary, off: float, width: float) -> void:
	(w["holes"] as Array[Vector3]).append(Vector3(off, width, KIND_DOOR))
	var abs_c: float = w["mid"] + off
	for w2 in recs:
		if w2 == w or w2["parapet"] or w2["axis"] != w["axis"]:
			continue
		if not _may_open(w2["inner"], w2["outer"]):
			continue
		if absf(w2["fixed"] - w["fixed"]) > 0.85:
			continue
		if abs_c < w2["a0"] + width * 0.5 or abs_c > w2["a1"] - width * 0.5:
			continue
		var already := false
		for h: Vector3 in (w2["holes"] as Array[Vector3]):
			if h.z < 0.5 and absf(w2["mid"] + h.x - abs_c) < width * 0.6:
				already = true
		if not already:
			(w2["holes"] as Array[Vector3]).append(
					Vector3(abs_c - w2["mid"], width, KIND_DOOR))


## Если между помещениями осталась щель, стены там две — вторую надо
## прорезать тоже, иначе дверь упрётся в неё.
func _twin(w: Dictionary, off: float, width: float) -> void:
	var abs_c: float = w["mid"] + off
	for w2 in walls_built:
		if w2 == w or w2["parapet"] or w2["axis"] != w["axis"]:
			continue
		if not _may_open(w2["inner"], w2["outer"]):
			continue        # парная стена может оказаться межквартирной
		if absf(w2["fixed"] - w["fixed"]) > 0.85:
			continue
		if abs_c < w2["a0"] + width * 0.5 or abs_c > w2["a1"] - width * 0.5:
			continue
		var key2 := "%d|%.2f|%.2f|%.2f" % [w2["axis"], w2["fixed"], w2["a0"], w2["a1"]]
		var already := false
		for h: Vector3 in (w2["holes"] as Array[Vector3]):
			if h.z < 0.5 and absf(w2["mid"] + h.x - abs_c) < width * 0.6:
				already = true
		if already:
			continue
		var list: Array = extra_doors.get(key2, [])
		list.append(Vector3(abs_c - w2["mid"], width, KIND_DOOR))
		extra_doors[key2] = list


## Прорезать проход в помещение по требованию физической проверки.
## Стены перебираются от лучшей к худшей; уже прорезанная стена расширяется
## до полного проёма, а если и это не помогло — берётся следующая.
func open_into(room: int, reached: Dictionary) -> String:
	var ranked: Array = []
	for w in walls_built:
		if w["parapet"] or w["outer"] < 0:
			continue
		var a: int = w["inner"]
		var b: int = w["outer"]
		if a != room and b != room:
			continue
		var other: int = b if a == room else a
		if not _may_open(a, b):
			continue
		if w["len"] < 0.70:
			continue
		var rank := 0.0
		if reached.get(other, false):
			rank += 100.0
		var width := minf(DOOR_FLAT, w["len"] - 0.20)
		if width < DOOR_ROOM:
			width = minf(w["len"], 1.60)
		var off := _door_pos(walls_built, w, width)
		rank += _clearance(walls_built, w["axis"], w["fixed"], w["mid"] + off, width) * 10.0
		rank += minf(w["len"], 4.0)
		ranked.append({"w": w, "off": off, "width": width, "rank": rank})
	ranked.sort_custom(func(a, b): return a["rank"] > b["rank"])
	for c in ranked:
		var w: Dictionary = c["w"]
		var key := "%d|%.2f|%.2f|%.2f" % [w["axis"], w["fixed"], w["a0"], w["a1"]]
		if not extra_doors.has(key):
			extra_doors[key] = [Vector3(c["off"], c["width"], KIND_DOOR)]
			_twin(w, c["off"], c["width"])
			return key
		var full := false
		for v: Vector3 in extra_doors[key]:
			if v.y >= minf(w["len"], 1.60) - 0.05:
				full = true
		if not full:
			var fw := minf(w["len"], 1.60)
			extra_doors[key] = [Vector3(0.0, fw, KIND_DOOR)]
			_twin(w, 0.0, fw)
			return key
	return ""


func _parapet(f: int, y: float, axis: int, fixed: float, a0: float, a1: float) -> void:
	# На первом этаже в южном парапете у лестницы — проём наружу.
	if f == 0 and axis == 0 and fixed > 8.9:
		var lo := EXIT_X - EXIT_W * 0.5
		var hi := EXIT_X + EXIT_W * 0.5
		if a0 < hi and a1 > lo:
			if a0 < lo:
				_parapet(f, y, axis, fixed, a0, lo)
			if a1 > hi:
				_parapet(f, y, axis, fixed, hi, a1)
			return
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


## Шахта лифта — не глухой куб, а четыре стенки с дверным проёмом на каждом
## этаже. Пола внутри нет: полом служит кабина.
const LIFT_DOOR := 1.10


## Крошка — только в лестнично-лифтовом узле: в квартирах пол другой.
func _core_floor(f: int, y: float) -> void:
	for r in ROOMS:
		if int(r[5]) != COR:
			continue
		var mesh := BoxMesh.new()
		mesh.size = Vector3(r[2] - r[0] - 0.02, 0.04, r[3] - r[1] - 0.02)
		var mi := _spawn_visual(mesh, Vector3((r[0] + r[2]) * 0.5, y + 0.02,
				(r[1] + r[3]) * 0.5), _m_core_floor, f)
		mi.name = "CoreFloor_%d" % f


func _shafts(f: int, y: float) -> void:
	var idx := 0
	for r in ROOMS:
		if int(r[5]) != SHF:
			continue
		idx += 1
		var x0: float = r[0]
		var z0: float = r[1]
		var x1: float = r[2]
		var z1: float = r[3]
		var h := FLOOR_H - WALL
		# три глухие стенки и одна с проёмом в лифтовой холл (восточная)
		_shaft_wall(f, Vector3((x0 + x1) * 0.5, y + h * 0.5, z0),
				Vector3(x1 - x0, h, WALL))
		_shaft_wall(f, Vector3((x0 + x1) * 0.5, y + h * 0.5, z1),
				Vector3(x1 - x0, h, WALL))
		_shaft_wall(f, Vector3(x0, y + h * 0.5, (z0 + z1) * 0.5),
				Vector3(WALL, h, z1 - z0))
		var mid := (z0 + z1) * 0.5
		var half := (z1 - z0) * 0.5
		var d := LIFT_DOOR * 0.5
		_shaft_wall(f, Vector3(x1, y + h * 0.5, mid - (half + d) * 0.5),
				Vector3(WALL, h, half - d))
		_shaft_wall(f, Vector3(x1, y + h * 0.5, mid + (half + d) * 0.5),
				Vector3(WALL, h, half - d))
		_shaft_wall(f, Vector3(x1, y + h - 0.35, mid), Vector3(WALL, 0.70, LIFT_DOOR))
		_mark(f, Vector3(x1, y, mid), Vector3(0, 0, 1), LIFT_DOOR, KIND_DOOR, y)


func _shaft_wall(f: int, pos: Vector3, size: Vector3) -> void:
	if size.x <= 0.02 or size.z <= 0.02:
		return
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := _spawn(mesh, pos, _m_shaft, f)
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

	# Край проёма совпадает с верхом второго марша. Дальше — игрок падает в
	# проём; ближе — марш упирается в торец перекрытия ступенькой в 20 см,
	# которую бот перешагнуть не умеет.
	var hz0 := STAIR_Z0 + 1.70
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
	# Марши пошире: узкий марш после эрозии на радиус агента рвётся в
	# навигационной сетке, и этажи оказываются не связаны.
	var w := 1.02
	_flight(f, Vector3(STAIR_X0 + 0.58, y0, z_near), 1.0, half, run, w)
	_landing(f, y0 + half, z_far)
	# Второй марш начинается У площадки и уходит обратно, а не проходит НАД
	# ней: иначе под ним остаётся 8 см просвета и на площадке не пройти.
	_flight(f, Vector3(STAIR_X0 + 1.62, y0 + half, z_far), -1.0, half, run, w)


func _flight(f: int, start: Vector3, dz: float, rise: float, run: float, width: float) -> void:
	# Ступени — только вид, ходим по наклонной плите: по отдельным коробкам
	# капсула игрока цепляется за подступёнки и застревает на середине марша
	# (проверено --walk-test=stairs).
	var steps := 8
	var sh := rise / float(steps)
	var sd := run / float(steps)
	for i in steps:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(width, sh, sd)
		var mi := _spawn_visual(mesh, Vector3(start.x, start.y + sh * (i + 0.5),
				start.z + dz * sd * (i + 0.5)), _m_stair, f)
		mi.name = "Step_%d" % f

	var hyp := sqrt(run * run + rise * rise)
	var angle := atan2(rise, run)
	var box := BoxShape3D.new()
	box.size = Vector3(width, 0.25, hyp)
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = box
	body.add_child(shape)
	body.position = start + Vector3(0.0, rise * 0.5 - 0.125 / cos(angle),
			dz * run * 0.5)
	body.rotation.x = -angle * dz
	add_child(body)
	body.set_meta("floor", f)
	(by_floor[f] as Array).append(body)


func _landing(f: int, y: float, z: float) -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(STAIR_X1 - STAIR_X0 - 0.2, WALL, 1.05)
	var mi := _spawn(mesh, Vector3((STAIR_X0 + STAIR_X1) * 0.5, y - WALL * 0.5, z + 0.5),
			_m_core_floor, f)
	mi.name = "Landing_%d" % f


# ---------------------------------------------------------------------------
#  Примитивы
# ---------------------------------------------------------------------------

func _wall(f: int, center: Vector3, dir: Vector3, length: float,
		holes: Array[Vector3], thick: float = WALL, mat: ShaderMaterial = null) -> void:
	if mat == null:
		mat = _m_wall
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
		var mi := _spawn(mesh, pos, mat, f)
		mi.name = "Wall_%d" % f

	for h: Vector3 in cuts:
		# над окном перемычка ниже: иначе просвет всего метр, а окно 1,5
		var above := 0.6 if h.z < 0.5 else 0.45
		var mesh := BoxMesh.new()
		if dir.z > 0.5:
			mesh.size = Vector3(thick, above, h.y)
		else:
			mesh.size = Vector3(h.y, above, thick)
		var pos := center + dir * h.x
		pos.y = center.y + hw - above * 0.5
		var mi := _spawn(mesh, pos, mat, f)
		mi.name = "Lintel_%d" % f
		if h.z >= 0.5:
			var sill := BoxMesh.new()
			if dir.z > 0.5:
				sill.size = Vector3(thick, 0.85, h.y)
			else:
				sill.size = Vector3(h.y, 0.85, thick)
			var sp := center + dir * h.x
			sp.y = center.y + 0.425
			var ms := _spawn(sill, sp, mat, f)
			ms.name = "Sill_%d" % f
			_glaze(f, center + dir * h.x, dir, h.y, center.y, hw - above)
		if h.z < 0.5:
			_door_block(f, center + dir * h.x, dir, h.y, center.y)
		_mark(f, center + dir * h.x, dir, h.y, h.z, center.y)


## Дверной блок в проём. Модели от houdini-assets: пивот в середине низа
## проёма, ось Z наружу от полотна, полотно отдельным узлом `leaf`.
## Коллизии у них нет — проходимость считается по проёму в стене, как и раньше.
const DOOR_MODELS := {
	"room": "res://assets/models/doors/door_room.glb",
	"flat": "res://assets/models/doors/door_flat.glb",
	"frame": "res://assets/models/doors/door_frame_only.glb",
	"broken": "res://assets/models/doors/door_broken.glb",
}
const DOOR_MODEL_W := {"room": 0.80, "flat": 0.90, "frame": 0.80, "broken": 0.80}

static var _door_cache: Dictionary = {}


func _door_block(f: int, pos: Vector3, dir: Vector3, width: float, base_y: float) -> void:
	# В брошенном доме часть дверей стоит без полотна или сорвана: выбор
	# детерминированный, по координате, иначе дом будет меняться между запусками.
	var seed_v := int(absf(pos.x) * 71.0 + absf(pos.z) * 131.0) % 100
	var kind := "flat" if width >= 0.88 else "room"
	if seed_v < 18:
		kind = "frame"
	elif seed_v < 26:
		kind = "broken"
	if not _door_cache.has(kind):
		if not ResourceLoader.exists(DOOR_MODELS[kind]):
			return
		_door_cache[kind] = load(DOOR_MODELS[kind])
	var node: Node3D = (_door_cache[kind] as PackedScene).instantiate()
	node.position = Vector3(pos.x, base_y, pos.z)
	# блок сделан под проём своей ширины; лишнее растягиваем по X
	var k: float = width / float(DOOR_MODEL_W[kind])
	node.scale = Vector3(k, 1.0, 1.0)
	node.rotation.y = PI * 0.5 if dir.z > 0.5 else 0.0
	add_child(node)
	node.set_meta("floor", f)
	for c in node.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		mi.set_meta("floor", f)
		fadeable.append(mi)


## Стекло в оконный проём: только вид, коллизии не надо — проём и так
## перекрыт подоконником снизу и перемычкой сверху.
func _glaze(f: int, pos: Vector3, dir: Vector3, width: float, base_y: float,
		top: float) -> void:
	var y0 := 0.85
	var h := top - y0
	if h < 0.3 or width < 0.3:
		return
	var glass := BoxMesh.new()
	if dir.z > 0.5:
		glass.size = Vector3(0.05, h, width - 0.10)
	else:
		glass.size = Vector3(width - 0.10, h, 0.05)
	var mi := _spawn_visual(glass, Vector3(pos.x, base_y + y0 + h * 0.5, pos.z),
			_m_glass, f)
	mi.name = "Glass_%d" % f

	# импост: одна вертикальная стойка, чтобы окно читалось окном
	var bar := BoxMesh.new()
	if dir.z > 0.5:
		bar.size = Vector3(0.09, h, 0.07)
	else:
		bar.size = Vector3(0.07, h, 0.09)
	var mb := _spawn_visual(bar, Vector3(pos.x, base_y + y0 + h * 0.5, pos.z),
			_m_frame, f)
	mb.name = "Mullion_%d" % f


func _mark(f: int, pos: Vector3, dir: Vector3, width: float, kind: float, base_y: float) -> void:
	if not marks_visible:
		return
	var is_win := kind >= 0.5
	var h := 0.9 if is_win else 2.0
	var mesh := BoxMesh.new()
	# метка чуть тоньше стены, чтобы не заслоняла соседние помещения
	if dir.z > 0.5:
		mesh.size = Vector3(WALL + 0.05, h, width * 0.96)
	else:
		mesh.size = Vector3(width * 0.96, h, WALL + 0.05)

	var mat := StandardMaterial3D.new()
	var col := Color(0.20, 0.55, 0.95) if is_win else Color(0.15, 0.75, 0.30)
	mat.albedo_color = Color(col.r, col.g, col.b, 0.70)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = col
	mat.emission_energy_multiplier = 0.55
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = Vector3(pos.x, base_y + (1.5 if is_win else h * 0.5), pos.z)
	mi.name = ("WinMark_%d" % f) if is_win else ("DoorMark_%d" % f)
	add_child(mi)
	mi.set_meta("floor", f)
	mi.set_meta("is_mark", true)


## Один шейдер на всё, экземпляры материалов различаются текстурами.
static var _shader: Shader = null


func _mat(c: Color, set_name := "", tile := 2.0) -> ShaderMaterial:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = FADE_SHADER
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("base_color", c)
	m.set_shader_parameter("tint_top", Color(1.04, 1.03, 1.0))
	if set_name != "":
		var dir := "res://assets/textures/%s/" % set_name
		var stem: String = set_name.replace("-", "_")
		var alb := "%s%s_albedo_1k.png" % [dir, stem]
		if ResourceLoader.exists(alb):
			m.set_shader_parameter("tex_albedo", load(alb))
			m.set_shader_parameter("tex_normal", load("%s%s_normal_1k.png" % [dir, stem]))
			m.set_shader_parameter("tex_orm", load("%s%s_orm_1k.png" % [dir, stem]))
			m.set_shader_parameter("textured", true)
			m.set_shader_parameter("tile", tile)
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


func _spawn_visual(mesh: Mesh, pos: Vector3, mat: Material, f: int) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	mi.set_meta("floor", f)
	fadeable.append(mi)
	return mi
