extends Node3D
## Пустая сцена: только дорога и тротуар. Ни дома, ни ботов, ни навигации —
## это площадка, на которой доводится само покрытие, и всё остальное сюда
## будет добавляться по одному.
##
## Раскладка от осевой линии проезда наружу, в метрах. Полосы уходят за
## дальность тумана, поэтому их концов не видно ни с какого ракурса — это
## дешевле, чем строить квартал, который всё равно не разглядеть.
##
## Покрытие — процедурный шейдер `surface.gdshader` от мировых координат.
## Тайловой текстуры здесь нет намеренно: на полосе в сотни метров любой тайл
## начинает дышать сеткой.

## Уровень тротуара — ноль сцены: по нему потом встанет и дом, и персонаж.
const Y_WALK := 0.0
const KERB_H := 0.14                ## бордюр над асфальтом
const Y_ROAD := Y_WALK - KERB_H
const Y_EARTH := Y_WALK - 0.02      ## обочина чуть ниже плиты

const ROAD_HALF := 3.60             ## полуширина проезда, две полосы
const KERB_W := 0.14
const WALK_W := 2.40
const VERGE := 220.0                ## земля за тротуаром, до самого тумана
const LEN_HALF := 220.0             ## вдоль X

const THICK := 0.30                 ## толщина плиты; не бумажная, иначе
                                    ## на кромке течёт свет

var _shader: Shader
var _m_road: ShaderMaterial
var _m_walk: ShaderMaterial
var _m_kerb: ShaderMaterial
var _m_earth: ShaderMaterial

var _cam: Camera3D
var _bump := 1.0
## A/B-флаги: на каждый спорный эффект свой выключатель. Два кадра рядом
## отвечают на «откуда это взялось» за минуту, гадание — за час.
var _fog := true
var _shadow := true
var _verge := true
var _ssao := true
var _debug := 0
var _cam_pos := Vector3(-16.0, 10.0, 16.0)
var _yaw := -45.0
var _pitch := -26.0
var _look := false

## Харнесс самопроверки: кадр в PNG и выход, без участия человека.
var _shot_path := ""
var _shot_frames := 90
var _frame := 0


func _ready() -> void:
	_args()
	_materials()
	_env()
	_lay_out()
	_camera()


func _args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot_path = a.substr(7)
		elif a.begins_with("--shot-frames="):
			_shot_frames = int(a.substr(14))
		elif a.begins_with("--cam="):
			_view(a.substr(6))
		elif a == "--no-bump":
			_bump = 0.0
		elif a == "--no-fog":
			_fog = false
		elif a == "--no-shadow":
			_shadow = false
		elif a == "--no-verge":
			_verge = false
		elif a.begins_with("--debug="):
			_debug = int(a.substr(8))
		elif a == "--no-ssao":
			_ssao = false


## Раскладка: осевая -> проезд -> бордюр -> тротуар -> обочина, зеркально
## в обе стороны от оси.
func _lay_out() -> void:
	_strip(ROAD_HALF * 2.0, 0.0, Y_ROAD, _m_road, "Road")

	for s: float in [-1.0, 1.0]:
		var z := s * (ROAD_HALF + KERB_W * 0.5)
		# Бордюрный камень: выступает на KERB_H, вкопан на THICK.
		_strip(KERB_W, z, Y_WALK, _m_kerb, "Kerb")
		var wz: float = s * (ROAD_HALF + KERB_W + WALK_W * 0.5)
		_strip(WALK_W, wz, Y_WALK, _m_walk, "Walk")
		if _verge:
			var ez: float = s * (ROAD_HALF + KERB_W + WALK_W + VERGE * 0.5)
			_strip(VERGE, ez, Y_EARTH, _m_earth, "Verge")


## Полоса вдоль X: коробка с коллизией и своей копией материала, знающей
## поперечную ось ИМЕННО ЭТОЙ полосы. Без копии все полосы делили бы один
## `lat_center`, и колеи с намывом считались бы от чужой середины.
func _strip(width: float, cz: float, top: float, mat: ShaderMaterial,
		name_: String) -> void:
	var size := Vector3(LEN_HALF * 2.0, THICK, width)
	var m: ShaderMaterial = mat.duplicate()
	m.set_shader_parameter("lat_center", cz)
	m.set_shader_parameter("lat_half", maxf(width * 0.5, 0.05))
	m.set_shader_parameter("bump", _bump)
	m.set_shader_parameter("debug", _debug)

	var body := StaticBody3D.new()
	body.name = name_
	body.position = Vector3(0.0, top - THICK * 0.5, cz)
	add_child(body)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	body.add_child(cs)


func _materials() -> void:
	_shader = load("res://surface.gdshader")
	# Тротуар: серая бетонная плита 0.75 м, какую клали во дворах. Альбедо
	# намеренно низкое: бетон на солнце и так уходит в пересвет, а со светлым
	# альбедо плита читается мрамором, а не старым двором.
	_m_walk = _surface(0, Color(0.50, 0.49, 0.46), Color(0.35, 0.345, 0.33),
			Color(0.17, 0.17, 0.16), 0.75)
	# Бордюрный камень: та же плита, но крупнее, холоднее и темнее — он всегда
	# грязнее тротуара, по нему идёт вся вода с проезда.
	_m_kerb = _surface(0, Color(0.44, 0.44, 0.435), Color(0.33, 0.33, 0.325),
			Color(0.18, 0.18, 0.175), 1.00)
	# Асфальт: тёмный, но не чёрный — выгоревший и запылённый.
	_m_road = _surface(1, Color(0.27, 0.27, 0.275), Color(0.165, 0.165, 0.17),
			Color(0.10, 0.10, 0.105), 1.0)
	_m_road.set_shader_parameter("marking", 1)
	_m_earth = _surface(2, Color(0.27, 0.25, 0.175), Color(0.145, 0.14, 0.105),
			Color(0.10, 0.09, 0.07), 1.0)


func _surface(kind: int, a: Color, b: Color, joint_c: Color,
		plate: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("kind", kind)
	m.set_shader_parameter("col_a", a)
	m.set_shader_parameter("col_b", b)
	m.set_shader_parameter("col_joint", joint_c)
	m.set_shader_parameter("plate", plate)
	m.set_shader_parameter("joint", 0.030)
	m.set_shader_parameter("rough_base", 0.92)
	return m


## Свет и небо. Солнце низкое и сбоку: скользящий свет — единственное, на чём
## вообще читается микрорельеф покрытия. В зенит его ставить нельзя, иначе
## вся работа с нормалями пропадает.
func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-32.0, 38.0, 0.0)
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.96, 0.90)
	sun.shadow_enabled = _shadow
	# Дальность каскада коротко: на плоской земле под скользящим углом у
	# дальней границы каскада вылезает акне — пунктир тёмных штрихов вдоль
	# горизонта. Всё, что дальше, и так съедает туман.
	sun.directional_shadow_max_distance = 55.0
	sun.shadow_normal_bias = 2.0
	sun.shadow_blur = 1.2
	add_child(sun)

	var env := Environment.new()
	var sky := Sky.new()
	var pm := ProceduralSkyMaterial.new()
	pm.sky_top_color = Color(0.42, 0.52, 0.62)
	pm.sky_horizon_color = Color(0.68, 0.70, 0.70)
	pm.ground_bottom_color = Color(0.26, 0.26, 0.24)
	pm.ground_horizon_color = Color(0.62, 0.63, 0.62)
	pm.sun_angle_max = 12.0
	sky.sky_material = pm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 1.0
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 4.0
	env.ssao_enabled = _ssao
	env.ssao_intensity = 2.0
	env.ssao_radius = 0.5
	# Туман закрывает горизонт: концы полос в него уходят, и где покрытие
	# кончается — не видно ни с какого ракурса.
	env.fog_enabled = _fog
	env.fog_light_color = Color(0.70, 0.72, 0.71)
	env.fog_density = 1.0
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_depth_begin = 55.0
	env.fog_depth_end = 150.0
	env.fog_depth_curve = 0.9
	env.fog_sky_affect = 0.5

	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func _camera() -> void:
	_cam = Camera3D.new()
	_cam.fov = 55.0
	_cam.far = 400.0
	add_child(_cam)
	_apply_cam()


## Ракурсы, с которых покрытие надо смотреть: сверху — не читается ли тайл,
## с глаз — не мыло ли вблизи, в упор на бордюр — держится ли кромка.
func _view(kind: String) -> void:
	# Камера в Godot смотрит вдоль ЛОКАЛЬНОГО −Z: yaw = 0 — это взгляд в −Z,
	# yaw = −90 — вдоль +X, то есть вдоль улицы.
	match kind:
		"eye":
			_cam_pos = Vector3(-24.0, 1.70, 5.00)   # с тротуара вдоль улицы
			_yaw = -78.0
			_pitch = -7.0
		"kerb":
			_cam_pos = Vector3(-3.0, 1.20, 6.20)    # в упор на бордюр
			_yaw = -37.0
			_pitch = -16.0
		"high":
			_cam_pos = Vector3(0.0, 60.0, 6.0)      # сверху: ищем повтор
			_yaw = 0.0
			_pitch = -84.0
		_:
			_cam_pos = Vector3(-16.0, 10.0, 16.0)   # общий три четверти
			_yaw = -45.0
			_pitch = -26.0
	if _cam != null:
		_apply_cam()


func _apply_cam() -> void:
	_cam.position = _cam_pos
	_cam.rotation_degrees = Vector3(_pitch, _yaw, 0.0)


## Свободная камера: без неё дорогу можно только сфотографировать, а надо по
## ней походить глазом. ЛКМ-зажатие — обзор, WASD — движение, Shift — быстро.
func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		_look = e.pressed
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if _look \
				else Input.MOUSE_MODE_VISIBLE
	elif e is InputEventMouseMotion and _look:
		_yaw -= e.relative.x * 0.15
		_pitch = clampf(_pitch - e.relative.y * 0.15, -89.0, 60.0)
		_apply_cam()
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_1: _view("iso")
			KEY_2: _view("eye")
			KEY_3: _view("kerb")
			KEY_4: _view("high")
			KEY_ESCAPE:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				_look = false


func _process(dt: float) -> void:
	var dir := Vector3.ZERO
	if Input.is_key_pressed(KEY_W): dir.z -= 1.0
	if Input.is_key_pressed(KEY_S): dir.z += 1.0
	if Input.is_key_pressed(KEY_A): dir.x -= 1.0
	if Input.is_key_pressed(KEY_D): dir.x += 1.0
	if Input.is_key_pressed(KEY_E): dir.y += 1.0
	if Input.is_key_pressed(KEY_Q): dir.y -= 1.0
	if dir != Vector3.ZERO:
		var spd := 18.0 if Input.is_key_pressed(KEY_SHIFT) else 5.0
		_cam_pos += (_cam.transform.basis * dir).normalized() * spd * dt
		_apply_cam()

	if _shot_path == "":
		return
	_frame += 1
	if _frame < _shot_frames:
		return
	var img := get_viewport().get_texture().get_image()
	img.save_png(_shot_path)
	print("[shot] %s %dx%d кадр=%d FPS_буфера=%d"
			% [_shot_path, img.get_width(), img.get_height(), _frame,
			Engine.get_frames_per_second()])
	get_tree().quit()
