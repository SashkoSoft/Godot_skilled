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

var building: Building
var player: Player
var rig: CameraRig
var occ: Occlusion

var _hud: Label
var _shot_path: String = ""
var _shot_frames: int = SHOT_DEFAULT_FRAMES
var _shot_yaw_deg: float = -1.0
var _start_floor: int = 0
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

	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.42, 0.51, 0.60)
	sky_mat.sky_horizon_color = Color(0.71, 0.72, 0.68)
	sky_mat.ground_bottom_color = Color(0.24, 0.24, 0.22)
	sky_mat.ground_horizon_color = Color(0.55, 0.55, 0.50)
	sky.sky_material = sky_mat
	env.sky = sky

	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 2.2   # интерьеры без этого проваливаются в тень
	# Заполняющий свет обязателен: камера вращается, и без него половина
	# ракурсов проваливается в черноту.
	env.ambient_light_sky_contribution = 1.0

	env.fog_enabled = true
	env.fog_light_color = Color(0.72, 0.74, 0.70)
	env.fog_density = 0.0025

	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 6.0

	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52.0, 38.0, 0.0)
	sun.light_energy = 1.5
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 90.0
	add_child(sun)

	# Заполняющий свет с противоположной стороны: камера вращается, и без него
	# половина ракурсов оказывается в глухой тени.
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-28.0, -140.0, 0.0)
	fill.light_energy = 0.45
	fill.light_color = Color(0.82, 0.88, 0.95)
	fill.shadow_enabled = false
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
	ground.position.y = -0.2
	ground.add_child(gm)
	var gs := CollisionShape3D.new()
	var gbox := BoxShape3D.new()
	gbox.size = plane.size
	gs.shape = gbox
	ground.add_child(gs)
	add_child(ground)

	building = Building.new()
	building.name = "Building"
	add_child(building)
	building.build(2)

	player = Player.new()
	player.name = "Player"
	player.position = Vector3(-3.0, 0.2 + _start_floor * Building.FLOOR_HEIGHT, 4.0)
	add_child(player)

	rig = CameraRig.new()
	rig.name = "CameraRig"
	rig.target = player
	rig.indoor = true
	add_child(rig)
	player.rig = rig
	rig.snap()

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
