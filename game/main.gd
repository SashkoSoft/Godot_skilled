extends Node3D
## Вертикальный срез: двухэтажный дом, изометрическая камера с вращением,
## гашение стен и перекрытия, персонаж-капсула. Ассетов нет — только примитивы.
##
## Запуск:
##   Godot_v4.7-stable_win64_console.exe --path game
## Проверка без окна (падения, ошибки API):
##   ... --headless --quit-after 120
## Кадр в файл (окно нужно, headless даст чёрный PNG):
##   ... --resolution 1280x720 -- "--shot=C:/tmp/a.png" "--shot-frames=90"

const SHOT_DEFAULT_FRAMES := 90

var building: Tower
var player: Player
var rig: CameraRig
var occ: Occlusion

var _hud: Label
var _shot_path: String = ""
var _shot_frames: int = SHOT_DEFAULT_FRAMES
var _shot_yaw_deg: float = -1.0
var _start_floor: int = 0
var _floors: int = 3
var _cam_dist: float = 0.0
var _marks := true
var _plan_view := false
var _spawn := Vector2(-9.3, 0.0)
var _walk_test := false
var _walk_route := "stairs"
var _route: Array[Vector3] = []
var _route_i := 0
var _route_time := 0.0
var _frame := 0


func _ready() -> void:
	_parse_args()
	_setup_environment()
	_build_world()
	_build_hud()


# --------------------------------------------------------------------------
#  Мир
# --------------------------------------------------------------------------

func _setup_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY

	# Небо: низкое солнце, тёплый горизонт против холодного зенита.
	# Этот контраст и делает картинку — интерьер получает холодную заливку
	# от неба и тёплые пятна от прямого света.
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.30, 0.42, 0.58)
	sky_mat.sky_horizon_color = Color(0.78, 0.74, 0.63)
	sky_mat.sky_energy_multiplier = 1.1
	sky_mat.ground_bottom_color = Color(0.18, 0.19, 0.17)
	sky_mat.ground_horizon_color = Color(0.52, 0.50, 0.44)
	sky_mat.sun_angle_max = 18.0
	sky_mat.sun_curve = 0.12
	sky.sky_material = sky_mat
	env.sky = sky

	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.48   # низкая заливка: тогда видны пятна света из окон
	env.ambient_light_sky_contribution = 1.0

	# Объёмный туман: из-за него из окон в комнаты бьют видимые лучи.
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0032   # плотнее — и сцена тонет в молоке
	env.volumetric_fog_albedo = Color(0.80, 0.84, 0.88)
	env.volumetric_fog_anisotropy = 0.35
	env.volumetric_fog_length = 90.0
	env.volumetric_fog_ambient_inject = 0.12
	env.volumetric_fog_sky_affect = 0.1

	# Лёгкая дымка вдаль, чтобы дальние стены не были такими же контрастными.
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = Color(0.74, 0.76, 0.72)
	env.fog_light_energy = 0.7
	env.fog_density = 0.0005
	env.fog_sky_affect = 0.0

	# Затенение в углах и стыках — без него интерьер выглядит плоским.
	env.ssao_enabled = true
	env.ssao_radius = 1.4
	env.ssao_intensity = 2.6
	env.ssao_power = 1.6
	env.ssao_detail = 0.6
	env.ssao_light_affect = 0.25

	# Свечение только на пересветах: окна и залитые солнцем пятна пола.
	env.glow_enabled = true
	env.glow_intensity = 0.28
	env.glow_bloom = 0.05
	env.glow_hdr_threshold = 1.05
	env.glow_strength = 1.0

	env.tonemap_mode = Environment.TONE_MAPPER_ACES   # AgX слишком выбеливает
	env.tonemap_exposure = 0.92
	env.tonemap_white = 6.0

	env.adjustment_enabled = true
	env.adjustment_contrast = 1.12
	env.adjustment_saturation = 1.06

	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	# Ключевой свет: низкое тёплое солнце, длинные тени, мягкий край.
	var sun := DirectionalLight3D.new()
	# Азимут подобран так, чтобы лучи шли сквозь оконные проёмы внутрь,
	# а не били в глухую стену: иначе интерьер освещается только заливкой.
	sun.rotation_degrees = Vector3(-26.0, 96.0, 0.0)
	sun.light_energy = 2.3
	sun.light_color = Color(1.0, 0.90, 0.74)
	sun.shadow_enabled = true
	sun.light_angular_distance = 1.2          # мягкая граница тени
	sun.directional_shadow_max_distance = 120.0
	sun.directional_shadow_blend_splits = true
	sun.light_volumetric_fog_energy = 3.2     # это и рисует лучи из окон
	add_child(sun)

	# Заполняющий холодный свет с противоположной стороны: камера вращается,
	# и без него половина ракурсов уходит в глухую тень.
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-30.0, -70.0, 0.0)
	fill.light_energy = 0.5
	fill.light_color = Color(0.72, 0.82, 0.98)
	fill.shadow_enabled = false
	fill.light_volumetric_fog_energy = 0.2
	add_child(fill)


func _build_world() -> void:
	# Земля вокруг дома.
	var ground := StaticBody3D.new()
	var gm := MeshInstance3D.new()
	var plane := BoxMesh.new()
	plane.size = Vector3(60, 0.4, 60)
	gm.mesh = plane
	var gmat := StandardMaterial3D.new()
	gmat.albedo_color = Color(0.31, 0.33, 0.28)
	gmat.roughness = 1.0
	gm.material_override = gmat
	# Земля ниже пола дома: при совпадении верхних граней получается
	# z-fighting — пол мерцает. Порог в 15 см игрок перешагивает (step-up).
	ground.position.y = -0.35
	ground.add_child(gm)
	var gs := CollisionShape3D.new()
	var gbox := BoxShape3D.new()
	gbox.size = plane.size
	gs.shape = gbox
	ground.add_child(gs)
	add_child(ground)

	building = Tower.new()
	building.name = "Building"
	building.marks_visible = _marks
	add_child(building)
	building.build(_floors)
	if _plan_view:
		building.paint_plan(_start_floor)

	player = Player.new()
	player.name = "Player"
	player.position = Vector3(_spawn.x, 0.2 + _start_floor * Tower.FLOOR_H, _spawn.y)
	add_child(player)

	rig = CameraRig.new()
	rig.name = "CameraRig"
	rig.target = player
	rig.indoor = true
	rig.dist_override = _cam_dist
	if _plan_view:
		rig.pitch_override = 88.0
	add_child(rig)
	player.rig = rig
	rig.snap()

	if _walk_test:
		# У автопрохода нет поиска пути — он идёт по прямой, поэтому маршруты
		# заданы по точкам и разделены по проверяемому сценарию.
		match _walk_route:
			_:
				# обход этажа: по коридору с заходом в квартиры обоих рядов,
				# затем в лифтовой холл
				_route = [
					Vector3(-9.3, 0, 0.0),
					Vector3(-9.3, 0, -2.6),   # 2К северная
					Vector3(-9.3, 0, 0.0),
					Vector3(-1.6, 0, -2.6),   # 3К северная
					Vector3(-1.6, 0, 0.0),
					Vector3(4.6, 0, -2.6),    # 1К северная
					Vector3(4.6, 0, 0.0),
					Vector3(9.4, 0, -2.6),    # 2К северо-восточная
					Vector3(9.4, 0, 0.0),
					Vector3(0.0, 0, 0.0),     # по коридору на запад
					Vector3(-9.3, 0, 0.0),
					Vector3(-9.3, 0, 2.6),    # 2К южная
					Vector3(-9.3, 0, 0.0),
					Vector3(-3.9, 0, 2.6),    # 1К южная
					Vector3(-3.9, 0, 0.0),
					Vector3(0.5, 0, 2.6),     # 1К южная вторая
					Vector3(0.5, 0, 0.0),
					Vector3(6.0, 0, 0.0),
					Vector3(10.7, 0, 0.0),
					Vector3(10.7, 0, 2.6),    # 1К восточная
					Vector3(10.7, 0, 0.0),
					Vector3(6.0, 0, 2.2),     # лифтовой холл
				]
		player.auto_target = _route[0]

	occ = Occlusion.new()
	occ.name = "Occlusion"
	occ.building = building
	occ.player = player
	occ.rig = rig
	add_child(occ)


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)

	_hud = Label.new()
	_hud.position = Vector2(14, 10)
	_hud.add_theme_color_override("font_color", Color(0.92, 0.94, 0.90))
	_hud.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_hud.add_theme_constant_override("outline_size", 4)
	layer.add_child(_hud)


func _process(_delta: float) -> void:
	_frame += 1
	if _walk_test:
		_run_walk_test(_delta)
	if _hud:
		_hud.text = "FPS %d    этаж %d    Q/E — поворот камеры, стрелки — движение" % [
			Engine.get_frames_per_second(), player.floor_index
		]
	if _shot_path != "" and _frame >= _shot_frames:
		_take_shot()


# --------------------------------------------------------------------------
#  Скриншот-харнесс: агент смотрит на свою работу сам
# --------------------------------------------------------------------------

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot_path = a.substr(7)
		elif a.begins_with("--shot-frames="):
			_shot_frames = int(a.substr(14))
		elif a.begins_with("--shot-yaw="):
			_shot_yaw_deg = float(a.substr(11))
		elif a.begins_with("--start-floor="):
			_start_floor = int(a.substr(14))
		elif a.begins_with("--spawn="):
			var parts := a.substr(8).split(",")
			if parts.size() == 2:
				_spawn = Vector2(float(parts[0]), float(parts[1]))
		elif a == "--plan":
			_plan_view = true
		elif a == "--no-marks":
			_marks = false
		elif a.begins_with("--cam-dist="):
			_cam_dist = float(a.substr(11))
		elif a.begins_with("--floors="):
			_floors = maxi(2, int(a.substr(9)))
		elif a == "--walk-test" or a.begins_with("--walk-test="):
			_walk_test = true
			if a.contains("="):
				_walk_route = a.split("=")[1]


func _take_shot() -> void:
	if _shot_yaw_deg >= 0.0:
		rig.yaw = deg_to_rad(_shot_yaw_deg)
		rig.snap()
		await RenderingServer.frame_post_draw

	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(_shot_path)
	print("[shot] %s -> %s  (этаж %d, yaw %.0f, FPS %d, draw calls %d, объектов %d)" % [
		"ok" if err == OK else "ошибка %d" % err,
		_shot_path, player.floor_index, rad_to_deg(rig.yaw),
		Engine.get_frames_per_second(),
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
	])
	get_tree().quit()


## Автопроверка проходимости: доходит ли игрок до лестницы и поднимается ли.
func _run_walk_test(delta: float) -> void:
	if _route_i >= _route.size():
		return
	_route_time += delta
	var target: Vector3 = _route[_route_i]
	var flat := Vector2(player.global_position.x - target.x, player.global_position.z - target.z)

	if flat.length() < 0.7 and absf(player.global_position.y - target.y) < 0.6:
		print("[walk] точка %d достигнута за %.1f с  pos=(%.1f, %.1f, %.1f) этаж %d" % [
			_route_i, _route_time,
			player.global_position.x, player.global_position.y, player.global_position.z,
			player.floor_index])
		_route_i += 1
		_route_time = 0.0
		if _route_i < _route.size():
			player.auto_target = _route[_route_i]
		else:
			print("[walk] маршрут пройден полностью")
			get_tree().quit()
		return

	if _route_time > 12.0:
		print("[walk] ЗАСТРЯЛ на точке %d (цель %.1f, %.1f, %.1f), стоит в (%.1f, %.1f, %.1f) этаж %d" % [
			_route_i, target.x, target.y, target.z,
			player.global_position.x, player.global_position.y, player.global_position.z,
			player.floor_index])
		get_tree().quit()
