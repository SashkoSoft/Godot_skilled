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
var _marks := false   ## метки проёмов — только для разбора, флаг --marks
var _plan_view := false
var _check_reach := false
var _reach_map := false
var _fix_reach := false
var _prune := false
var _audit := false
var _no_fade := false
var _only_flat := -1
var _paint := false          ## бот закрашивает за собой пол
var _cover: PackedByteArray = PackedByteArray()
var _cover_nx := 0
var _cover_nz := 0
const COVER := 0.25          ## клетка закраски, м
var _bots := 4          ## сколько жителей ходит по дому
var _bot_log := false
var _bot_audit := false
var _walk_all := false
var _audit_countdown := -1   ## для осмотра: не гасить стены прозрачностью
var _spawn := Vector2(-1.7, 1.4)   ## лестничная клетка
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

	_build_tower()
	if _prune:
		_prune_reach.call_deferred()
	elif _check_reach:
		_report_reach.call_deferred()
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
			"stairs":
				# подъём на этаж выше и обратно в коридор
				_route = [
					Vector3(-1.7, 0.0, 1.4),
					Vector3(-2.08, 0.0, 2.6),
					Vector3(-2.08, 1.5, 4.9),
					Vector3(-1.65, 1.5, 5.6),
					Vector3(-1.08, 1.5, 4.8),
					Vector3(-1.08, 3.0, 2.5),
					Vector3(-1.7, 3.0, 1.4),
					Vector3(-2.3, 3.0, 1.2),
					Vector3(-2.3, 3.0, 0.2),
					Vector3(-8.0, 3.0, 0.2),
					Vector3(-11.0, 3.0, -1.5),
				]
			_:
				# коридор из конца в конец и в лифтовой холл: у автопрохода
				# нет поиска пути, заходы в квартиры проверяет --audit
				_route = [
					Vector3(-8.0, 0, 0.2),
					Vector3(-11.4, 0, 0.2),
					Vector3(8.0, 0, 0.2),
					Vector3(11.4, 0, 0.2),
					Vector3(1.5, 0, 0.2),
					Vector3(1.5, 0, 2.2),
					Vector3(1.5, 0, 5.0),
				]
		player.auto_target = _route[0]

	_spawn_bots.call_deferred()

	occ = Occlusion.new()
	occ.name = "Occlusion"
	occ.fade_enabled = not _no_fade
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


## Аудит охвата запускаем внутри шага физики: снаружи сервер навигации
## возвращает пустой путь, хотя агенты по той же карте ходят.
func _physics_process(_delta: float) -> void:
	if _paint:
		_paint_step()
	if _walk_all:
		_walk_all_step()
	if _audit_countdown > 0:
		_audit_countdown -= 1
		if _audit_countdown == 0:
			_audit_bot_coverage()
	elif _audit_i >= 0:
		_audit_step()


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
		elif a == "--reach-map":
			_check_reach = true
			_reach_map = true
		elif a == "--prune-reach":
			_check_reach = true
			_prune = true
		elif a == "--fix-reach":
			_check_reach = true
			_fix_reach = true
		elif a == "--check-reach":
			_check_reach = true
		elif a == "--audit":
			_check_reach = true
			_audit = true
		elif a.begins_with("--bots="):
			_bots = int(a.split("=")[1])
		elif a == "--walk-all":
			_walk_all = true
		elif a == "--bot-audit":
			_bot_audit = true
		elif a == "--bot-log":
			_bot_log = true
		elif a == "--no-fade":
			_no_fade = true
		elif a == "--plan":
			_plan_view = true
		elif a == "--paint-walk":
			_paint = true
			_walk_all = true
		elif a.begins_with("--only-flat="):
			_only_flat = int(a.split("=")[1])
		elif a == "--marks":
			_marks = true
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


## Этаж пересобирается целиком: проверка проходимости прогоняется несколько раз.
func _build_tower() -> void:
	building = Tower.new()
	building.name = "Building"
	building.marks_visible = _marks
	building.only_flat = _only_flat
	add_child(building)
	building.build(_floors)
	print("[план] проёмов с чертежа: стен %d, по правилу %d, дверей добавлено ради прохода %d"
			% [building.traced_count, building.rule_count, building.added_count])
	if not building.unreachable.is_empty():
		print("[план] по графу не открылось: ", building.unreachable)
	if _plan_view:
		building.paint_plan(_start_floor)


## Сколько помещений сейчас недостижимо физически.
func _reach_bad() -> Array:
	await get_tree().physics_frame
	await get_tree().physics_frame
	var space := get_viewport().world_3d.direct_space_state
	var res := ReachCheck.run(space, _start_floor * Tower.FLOOR_H)
	if res.has("error"):
		return [{"room": -1, "flat": -1, "kind": -1}]
	var bad: Array = []
	for r in res["rooms"]:
		var f: int = r["free"]
		if f < 6 or int(r["kind"]) == Tower.SHF:
			continue
		if float(r["reached"]) / float(f) < 0.15:
			bad.append(r)
	return bad


## Отсев: лишняя дверь та, без которой этаж остаётся проходимым.
func _prune_reach() -> void:
	var keys: Array = Tower.extra_doors.keys()
	var dropped := 0
	for k in keys:
		var saved = Tower.extra_doors[k]
		Tower.extra_doors.erase(k)
		building.queue_free()
		building = null
		await get_tree().process_frame
		_build_tower()
		var bad: Array = await _reach_bad()
		# Проём лишний, только если без него и дом проходим, И каждая квартира
		# по-прежнему доступна изнутри: общая проходимость этого не ловит.
		if bad.is_empty() and _flats_bad() == 0:
			dropped += 1
		else:
			Tower.extra_doors[k] = saved
	print("[отсев] убрано лишних проёмов: %d, осталось %d"
			% [dropped, Tower.extra_doors.size()])
	building.queue_free()
	building = null
	await get_tree().process_frame
	_build_tower()
	var bad2: Array = await _reach_bad()
	print("[отсев] контроль: недостижимо ", bad2.size())
	_write_extra_doors()
	get_tree().quit(0)


## Физическая проверка проходимости. С --fix-reach недостающие двери
## дорезаются и этаж пересобирается, пока каждое помещение не станет
## достижимым; результат пишется в game/plan_extra_doors.gd.
func _report_reach() -> void:
	var passes := 25 if _fix_reach else 1
	var bad: Array = []
	for step in passes:
		await get_tree().physics_frame
		await get_tree().physics_frame
		var space := get_viewport().world_3d.direct_space_state
		var res := ReachCheck.run(space, _start_floor * Tower.FLOOR_H)
		if res.has("error"):
			print("[проход] ", res["error"])
			get_tree().quit(1)
			return
		var reached: Dictionary = {}
		bad = []
		for r in res["rooms"]:
			var f: int = r["free"]
			var share := 1.0 if f < 6 else float(r["reached"]) / float(f)
			reached[r["room"]] = share >= 0.15
			if f >= 6 and share < 0.15 and int(r["kind"]) != Tower.SHF:
				bad.append(r)
		# Помещение, недостижимое ИЗ СВОЕЙ квартиры, тоже надо чинить: общая
		# волна его достаёт в обход, через коридор и соседей.
		if _fix_reach:
			for r in _flat_bad_rooms():
				var dup := false
				for b in bad:
					if int(b["room"]) == int(r["room"]):
						dup = true
				if not dup:
					bad.append(r)
					reached[r["room"]] = false
		print("[проход] проход %d: свободно %d, достигнуто %d, недостижимо %d"
				% [step, res["free"], res["reached"], bad.size()])
		if bad.is_empty() or not _fix_reach:
			break
		var cut := 0
		for r in bad:
			if building.open_into(int(r["room"]), reached) != "":
				cut += 1
		if cut == 0:
			print("[проход] больше нечего резать, осталось ", bad.size())
			break
		building.queue_free()
		building = null
		await get_tree().process_frame
		_build_tower()
	if _audit:
		_audit_rooms()
		_audit_flats()
	for r in bad:
		print("   НЕТ ХОДА: помещение %d, квартира %d, назначение %d"
				% [r["room"], r["flat"], r["kind"]])
	if _fix_reach:
		_write_extra_doors()
	get_tree().quit(1 if bad.size() > 0 else 0)


func _write_extra_doors() -> void:
	var lines: Array[String] = []
	var keys: Array = Tower.extra_doors.keys()
	keys.sort()
	for k in keys:
		var items: Array[String] = []
		for v: Vector3 in Tower.extra_doors[k]:
			items.append("Vector3(%.3f, %.3f, %.1f)" % [v.x, v.y, v.z])
		lines.append("	\"%s\": [%s]," % [k, ", ".join(items)])
	var text := "class_name PlanExtraDoors
extends RefCounted
"
	text += "## Двери, которых на чертеже нет, но без них в помещение не попасть.
"
	text += "## Найдены физической проверкой: main.gd --fix-reach.

"
	text += "const DOORS := {
" + "
".join(lines) + "
}
"
	var f := FileAccess.open("res://plan_extra_doors.gd", FileAccess.WRITE)
	f.store_string(text)
	f.close()
	print("[проход] дописано дверей: ", Tower.extra_doors.size())


## Поимённая сверка: у каждого помещения — свои двери и своя достижимость.
func _audit_rooms() -> void:
	var space := get_viewport().world_3d.direct_space_state
	var res := ReachCheck.run(space, _start_floor * Tower.FLOOR_H)
	var share: Dictionary = {}
	for r in res["rooms"]:
		share[r["room"]] = [r["free"], r["reached"]]
	var names := ["жилая", "кухня", "санузел", "прихожая", "ядро", "лоджия", "шахта", "кладовая"]
	var bti := {0: "46", 1: "44", 2: "45", 3: "43", 4: "42", 5: "41",
			6: "48", 7: "47", 8: "общее"}
	var no_door := 0
	var tiny := 0
	var unreached := 0
	var counted := 0
	print("[сверка] помещение | квартира | назначение | дверей | ячеек | залито")
	for i in Tower.ROOMS.size():
		var r = Tower.ROOMS[i]
		var kind := int(r[5])
		if kind == Tower.SHF:
			continue
		counted += 1
		var doors := 0
		for w in building.walls_built:
			if w["parapet"]:
				continue
			if w["inner"] != i and w["outer"] != i:
				continue
			for h: Vector3 in (w["holes"] as Array[Vector3]):
				if h.z < 0.5:
					doors += 1
		var st: Array = share.get(i, [0, 0])
		var free: int = st[0]
		var got: int = st[1]
		var mark := ""
		if doors == 0:
			mark += "  БЕЗ ДВЕРИ"
			no_door += 1
		if free < 6:
			mark += "  тесно для проверки"
			tiny += 1
		elif float(got) / float(free) < 0.15:
			mark += "  НЕ ДОСТАЁТСЯ"
			unreached += 1
		print("   %2d | кв %-6s | %-9s | %d | %4d | %4d%s"
				% [i, bti.get(int(r[4]), "?"), names[kind], doors, free, got, mark])
	print("[сверка] помещений %d, без двери %d, недостижимо %d, слишком тесных %d"
			% [counted, no_door, unreached, tiny])


## Помещения, недостижимые от входа собственной квартиры.
func _flat_bad_rooms() -> Array:
	var space := get_viewport().world_3d.direct_space_state
	var g := ReachCheck.grid(space, _start_floor * Tower.FLOOR_H)
	var nx: int = g["nx"]
	var nz: int = g["nz"]
	var seeds: Array[Vector2] = [
		Vector2((Tower.STAIR_X0 + Tower.STAIR_X1) * 0.5, Tower.STAIR_Z0 + 0.8),
		Vector2(-8.0, 0.15), Vector2(-4.0, 0.15), Vector2(4.0, 0.15),
		Vector2(8.0, 0.15), Vector2(0.0, 0.15),
	]
	var out: Array = []
	for flat in 8:
		var mask := ReachCheck.flat_mask([flat, 8], nx, nz)
		var seen := ReachCheck.flood_masked(g, mask, seeds)
		for i in Tower.ROOMS.size():
			if int(Tower.ROOMS[i][4]) != flat or int(Tower.ROOMS[i][5]) == Tower.SHF:
				continue
			var st := ReachCheck.share_in(g, seen, i)
			if int(st[0]) < 6:
				continue
			if float(st[1]) / float(st[0]) < 0.15:
				out.append({"room": i, "flat": flat, "kind": int(Tower.ROOMS[i][5]),
						"free": st[0], "reached": st[1]})
	return out


## Сколько квартир сейчас с проблемами — без печати, для отсева.
func _flats_bad() -> int:
	var space := get_viewport().world_3d.direct_space_state
	var g := ReachCheck.grid(space, _start_floor * Tower.FLOOR_H)
	var nx: int = g["nx"]
	var nz: int = g["nz"]
	var seeds: Array[Vector2] = [
		Vector2((Tower.STAIR_X0 + Tower.STAIR_X1) * 0.5, Tower.STAIR_Z0 + 0.8),
		Vector2(-8.0, 0.15), Vector2(-4.0, 0.15), Vector2(4.0, 0.15),
		Vector2(8.0, 0.15), Vector2(0.0, 0.15),
	]
	var bad := 0
	for flat in 8:
		var mask := ReachCheck.flat_mask([flat, 8], nx, nz)
		var seen := ReachCheck.flood_masked(g, mask, seeds)
		var got := false
		var miss := false
		for i in Tower.ROOMS.size():
			if int(Tower.ROOMS[i][4]) != flat or int(Tower.ROOMS[i][5]) == Tower.SHF:
				continue
			var st := ReachCheck.share_in(g, seen, i)
			if int(st[0]) < 6:
				continue
			if float(st[1]) / float(st[0]) >= 0.15:
				got = true
			else:
				miss = true
		if not got or miss:
			bad += 1
	return bad


## Строгая сверка по квартирам: волна пускается от лестничной клетки, но
## ходить разрешено только по местам общего пользования и по одной квартире.
## Так проверяется именно её вход и её внутренние двери, а не обход кругом.
func _audit_flats() -> void:
	var space := get_viewport().world_3d.direct_space_state
	var g := ReachCheck.grid(space, _start_floor * Tower.FLOOR_H)
	var nx: int = g["nx"]
	var nz: int = g["nz"]
	var names := ["жилая", "кухня", "санузел", "прихожая", "ядро", "лоджия", "шахта", "кладовая"]
	var bti := {0: "46", 1: "44", 2: "45", 3: "43", 4: "42", 5: "41", 6: "48", 7: "47"}
	# сеем в лестничной клетке и в коридоре: это места общего пользования,
	# из них и должен быть вход в каждую квартиру
	var seeds: Array[Vector2] = [
		Vector2((Tower.STAIR_X0 + Tower.STAIR_X1) * 0.5, Tower.STAIR_Z0 + 0.8),
		Vector2(-8.0, 0.15), Vector2(-4.0, 0.15), Vector2(4.0, 0.15),
		Vector2(8.0, 0.15), Vector2(0.0, 0.15),
	]
	var bad_flats := 0
	var bad_rooms := 0
	print("[квартиры] из подъезда внутрь квартиры, не проходя через соседей:")
	for flat in 8:
		var mask := ReachCheck.flat_mask([flat, 8], nx, nz)
		var seen := ReachCheck.flood_masked(g, mask, seeds)
		var miss: Array[String] = []
		var got_any := false
		for i in Tower.ROOMS.size():
			if int(Tower.ROOMS[i][4]) != flat or int(Tower.ROOMS[i][5]) == Tower.SHF:
				continue
			var st := ReachCheck.share_in(g, seen, i)
			var f: int = st[0]
			if f < 6:
				continue
			if float(st[1]) / float(f) >= 0.15:
				got_any = true
			else:
				miss.append("%s (%d)" % [names[int(Tower.ROOMS[i][5])], i])
		if not got_any:
			print("   кв %s — ВХОДА НЕТ" % bti[flat])
			bad_flats += 1
		elif miss.is_empty():
			print("   кв %s — вход есть, все помещения достижимы" % bti[flat])
		else:
			print("   кв %s — вход есть, НЕ ДОСТАЁТСЯ: %s" % [bti[flat], ", ".join(miss)])
			bad_flats += 1
			bad_rooms += miss.size()
	print("[квартиры] с проблемами %d, недостижимых помещений внутри квартир %d"
			% [bad_flats, bad_rooms])


## Навигационная сетка и жители. Печём сетку по уже построенным коллизиям,
## цели берём из таблицы помещений — бот обходит комнаты, а не случайные точки.
func _spawn_bots() -> void:
	if _bots <= 0:
		return
	var nav := Navigation.new()
	nav.name = "Navigation"
	add_child(nav)
	nav.bake_from(building)
	nav.add_stair_links(_floors)
	# Регион попадает на карту навигации только на следующем шаге физики;
	# до этого любой запрос к карте возвращает ноль.
	await get_tree().physics_frame
	await get_tree().physics_frame
	print("[навигация] полигонов в сетке: %d" % nav.polygon_count())
	if nav.polygon_count() == 0:
		print("[навигация] сетка пустая — боты не запущены")
		return

	# Цель должна быть достижима: центр тесного санузла лежит вне навигационной
	# сетки, агент до него не доходит никогда и стоит у порога как вкопанный.
	# Отсеиваем по габариту — минимальная сторона должна быть шире агента.
	var min_side := (Navigation.AGENT_RADIUS + 0.12) * 2.0
	var rooms: Array[Vector3] = []
	var dropped := 0
	for f in _floors:
		for r in Tower.ROOMS:
			var kind := int(r[5])
			if kind == Tower.SHF:
				continue
			var w: float = float(r[2]) - float(r[0])
			var d: float = float(r[3]) - float(r[1])
			if minf(w, d) < min_side or w * d < 0.75:
				dropped += 1
				continue
			if _paint:
				# В режиме закраски цели ставим сеткой внутри помещения,
				# иначе бот ходит от центра к центру и подметает только тропы.
				var step := 1.3
				var mx := float(r[0]) + 0.55
				while mx < float(r[2]) - 0.4:
					var mz := float(r[1]) + 0.55
					while mz < float(r[3]) - 0.4:
						rooms.append(Vector3(mx, f * Tower.FLOOR_H + 0.15, mz))
						mz += step
					mx += step
			rooms.append(Vector3((float(r[0]) + float(r[2])) * 0.5,
					f * Tower.FLOOR_H + 0.15, (float(r[1]) + float(r[3])) * 0.5))
	print("[навигация] целей: %d, отброшено тесных: %d" % [rooms.size(), dropped])
	if rooms.is_empty():
		return

	var colours := [Color(0.85, 0.35, 0.30), Color(0.35, 0.65, 0.90),
			Color(0.55, 0.80, 0.35), Color(0.85, 0.60, 0.25),
			Color(0.75, 0.45, 0.85), Color(0.30, 0.80, 0.70)]
	for i in _bots:
		# Цели по всему дому: сетка связана по лестнице, житель ходит с этажа
		# на этаж сам.
		var route: Array[Vector3] = []
		if _walk_all:
			# каждому боту своя четверть списка, обходим все помещения по одному разу
			var from := int(rooms.size() * i / _bots)
			var to := int(rooms.size() * (i + 1) / _bots)
			for k in range(from, to):
				route.append(rooms[k])
		else:
			for k in 6:
				route.append(rooms[(i * 37 + k * 61) % rooms.size()])
		var b := Bot.new()
		b.name = "Bot%d" % i
		add_child(b)
		b.cycle = not _walk_all
		b.watcher = player
		b.setup(route[0] + Vector3(0, 0.1, 0), route, colours[i % colours.size()],
				_bot_log, "№%d" % (i + 1))
		b.start()
	print("[навигация] запущено жителей: %d" % _bots)
	if _bot_audit:
		_audit_countdown = 90


## Куда бот действительно может дойти. Меряем живым агентом: прямой запрос
## к серверу навигации в этой сборке возвращает пустой путь, хотя агенты по
## той же карте ходят, поэтому доверяем только агенту.
var _audit_agent: NavigationAgent3D
var _audit_list: Array = []
var _audit_i := -1
var _audit_wait := 0
var _audit_ok := 0
var _audit_bad: Array = []

const AUDIT_NAMES := ["жилая", "кухня", "санузел", "прихожая", "ядро", "лоджия", "шахта", "кладовая"]
const AUDIT_BTI := {0: "46", 1: "44", 2: "45", 3: "43", 4: "42", 5: "41",
		6: "48", 7: "47", 8: "общее"}


func _audit_bot_coverage() -> void:
	var probe := Node3D.new()
	add_child(probe)
	_audit_agent = NavigationAgent3D.new()
	_audit_agent.radius = Navigation.AGENT_RADIUS
	_audit_agent.height = Player.HEIGHT
	_audit_agent.avoidance_enabled = false
	probe.add_child(_audit_agent)

	for f in _floors:
		for i in Tower.ROOMS.size():
			var r = Tower.ROOMS[i]
			if int(r[5]) == Tower.SHF:
				continue
			_audit_list.append({
				"pos": Vector3((float(r[0]) + float(r[2])) * 0.5,
						f * Tower.FLOOR_H + 0.15,
						(float(r[1]) + float(r[3])) * 0.5),
				"kind": int(r[5]), "flat": int(r[4]), "floor": f,
			})
	# Пробник ставим туда же, где стоит живой бот: агент, стоящий вне сетки,
	# не строит путь вообще, и замер получается пустым.
	var origin: Vector3 = _audit_list[0]["pos"]
	for c in get_children():
		if c is Bot and (c as Bot).floor_index == _start_floor:
			origin = (c as Bot).global_position
			break
	probe.position = origin
	print("[бот-охват] пробник в (%.1f, %.1f, %.1f), проверяю %d помещений на %d этажах"
			% [origin.x, origin.y, origin.z, _audit_list.size(), _floors])
	_audit_i = 0
	_audit_wait = 0
	_audit_agent.target_position = _audit_list[0]["pos"]
	_audit_agent.get_next_path_position()


func _audit_step() -> void:
	if _audit_i >= _audit_list.size():
		return
	_audit_wait += 1
	if _audit_wait < 3:
		return
	_audit_wait = 0
	var t: Dictionary = _audit_list[_audit_i]
	# путь считается лениво: пока не спросишь следующую точку, его нет
	_audit_agent.get_next_path_position()
	var path := _audit_agent.get_current_navigation_path()
	var target: Vector3 = t["pos"]
	var ok := path.size() > 0 and path[path.size() - 1].distance_to(target) < 1.0
	if ok:
		_audit_ok += 1
	else:
		_audit_bad.append(t)
	_audit_i += 1
	if _audit_i < _audit_list.size():
		_audit_agent.target_position = _audit_list[_audit_i]["pos"]
		return

	print("[бот-охват] доходит до %d помещений из %d"
			% [_audit_ok, _audit_list.size()])
	var per_floor: Dictionary = {}
	for b in _audit_bad:
		var fl: int = b["floor"]
		per_floor[fl] = int(per_floor.get(fl, 0)) + 1
	for fl in per_floor:
		print("   этаж %d: не доходит %d" % [int(fl), int(per_floor[fl])])
	var by_kind: Dictionary = {}
	for b in _audit_bad:
		var k: int = b["kind"]
		if not by_kind.has(k):
			by_kind[k] = []
		(by_kind[k] as Array).append(b)
	for k in by_kind:
		var list: Array = by_kind[k]
		print("   не доходит: %s — %d шт." % [AUDIT_NAMES[int(k)], list.size()])
		var shown := 0
		for b in list:
			if shown >= 4:
				break
			print("      этаж %d, кв %s" % [b["floor"], AUDIT_BTI.get(int(b["flat"]), "?")])
			shown += 1
	get_tree().quit()


## Обход всех помещений по-настоящему: бот идёт в каждое и мы считаем,
## куда он реально дошёл, а не куда смог построить путь.
var _walk_done := false


func _walk_all_step() -> void:
	if _walk_done:
		return
	var bots: Array = []
	for c in get_children():
		if c is Bot:
			bots.append(c)
	if bots.is_empty():
		return
	for b in bots:
		if not (b as Bot).done:
			return
	_walk_done = true
	var ok := 0
	var bad := 0
	for b in bots:
		for v in (b as Bot).visited:
			if v[1]:
				ok += 1
			else:
				bad += 1
				var p: Vector3 = v[0]
				print("   не дошёл: (%.1f, %.1f, %.1f), этаж %d"
						% [p.x, p.y, p.z, int(floor((p.y + 0.4) / Tower.FLOOR_H))])
	print("[обход] дошёл до %d помещений из %d" % [ok, ok + bad])
	if _paint:
		_paint_show()
		if _shot_path != "":
			_shot_frames = _frame + 6      # даём кадр на отрисовку следа
			return
	get_tree().quit()


# ---------------------------------------------------------------------------
#  След бота: где прошёл — там закрашено
# ---------------------------------------------------------------------------

## Отмечаем клетки под каждым жителем. Это и есть честный ответ на вопрос
## «везде ли он попадает»: закрашено ровно то, куда он дошёл ногами.
func _paint_step() -> void:
	if _cover.is_empty():
		_cover_nx = int(Tower.W_HALF * 2.0 / COVER) + 1
		_cover_nz = int(Tower.D_HALF * 2.0 / COVER) + 1
		_cover.resize(_cover_nx * _cover_nz)
	for c in get_children():
		if not (c is Bot):
			continue
		var b := c as Bot
		if b.floor_index != _start_floor:
			continue
		var p := b.global_position
		var ix := int((p.x + Tower.W_HALF) / COVER)
		var iz := int((p.z + Tower.D_HALF) / COVER)
		for dx in range(-1, 2):
			for dz in range(-1, 2):
				var ax := ix + dx
				var az := iz + dz
				if ax < 0 or az < 0 or ax >= _cover_nx or az >= _cover_nz:
					continue
				_cover[ax * _cover_nz + az] = 1


## Рисуем след одной сеткой: 10 тысяч клеток отдельными узлами не потянуть.
func _paint_show() -> void:
	var cells := 0
	for i in _cover.size():
		cells += _cover[i]
	if cells == 0:
		return
	var mesh := BoxMesh.new()
	mesh.size = Vector3(COVER * 0.92, 0.02, COVER * 0.92)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.20, 0.85, 0.45, 0.85)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(0.20, 0.85, 0.45)
	mat.emission_energy_multiplier = 0.7
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = cells
	var k := 0
	var y := _start_floor * Tower.FLOOR_H + 0.08
	for ix in _cover_nx:
		for iz in _cover_nz:
			if _cover[ix * _cover_nz + iz] == 0:
				continue
			var pos := Vector3(-Tower.W_HALF + ix * COVER, y, -Tower.D_HALF + iz * COVER)
			mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, pos))
			k += 1
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.name = "BotTrail"
	add_child(mi)
	print("[след] закрашено клеток: %d (%.0f м²)" % [cells, cells * COVER * COVER])
	# Помещение засчитано, только если бот реально оставил в нём след.
	var names := ["жилая", "кухня", "санузел", "прихожая", "ядро", "лоджия",
			"шахта", "кладовая"]
	var bti := {0: "46", 1: "44", 2: "45", 3: "43", 4: "42", 5: "41",
			6: "48", 7: "47", 8: "общее"}
	var empty := 0
	var total := 0
	for i in Tower.ROOMS.size():
		var r = Tower.ROOMS[i]
		if int(r[5]) == Tower.SHF:
			continue
		total += 1
		var hit := 0
		var ix0 := maxi(int((float(r[0]) + Tower.W_HALF) / COVER), 0)
		var ix1 := mini(int((float(r[2]) + Tower.W_HALF) / COVER), _cover_nx - 1)
		var iz0 := maxi(int((float(r[1]) + Tower.D_HALF) / COVER), 0)
		var iz1 := mini(int((float(r[3]) + Tower.D_HALF) / COVER), _cover_nz - 1)
		for ix in range(ix0, ix1 + 1):
			for iz in range(iz0, iz1 + 1):
				hit += _cover[ix * _cover_nz + iz]
		if hit == 0:
			empty += 1
			print("   без следа: %s, кв %s" % [names[int(r[5])], bti.get(int(r[4]), "?")])
	print("[след] помещений со следом: %d из %d" % [total - empty, total])
