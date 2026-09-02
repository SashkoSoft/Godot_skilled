extends Node3D
## Две квартиры, собранные прямо по разбору скана БТИ.
##
## Геометрия не подгоняется на глаз: `plan_left.json` выгружен из разбора
## чертежа — стены прямоугольниками со снятой с чертежа толщиной, дверные
## проёмы вырезаны насквозь, оконные с подоконником и перемычкой.
##
## Запуск:
##   Godot_v4.7-stable_win64_console.exe --path game res://plan3d.tscn
## Кадр в файл:
##   ... --resolution 1500x900 res://plan3d.tscn -- "--shot=C:/tmp/a.png"

const DATA := "res://plan_left.json"

var _shot := ""
var _frames := 90
var _size := Vector2i(3200, 2750)
var _ss := 2                          # кратность суперсэмплинга
var _turn := ""                       # папка для кадров оборота
var _turn_n := 36
var _turn_i := 0
var _turn_c := Vector3.ZERO
var _turn_r := 20.0
var _turn_pitch := 40.0
var _vp: SubViewport = null
var _plan: Dictionary = {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.substr(7)
		elif a.begins_with("--frames="):
			_frames = int(a.substr(9))
		elif a.begins_with("--turn="):
			_turn = a.substr(7)
		elif a.begins_with("--turn-frames="):
			_turn_n = clampi(int(a.substr(14)), 8, 180)
		elif a.begins_with("--turn-pitch="):
			_turn_pitch = clampf(float(a.substr(13)), 10.0, 85.0)
		elif a.begins_with("--ss="):
			_ss = clampi(int(a.substr(5)), 1, 3)
		elif a.begins_with("--size="):
			var wh := a.substr(7).split("x")
			if wh.size() == 2:
				_size = Vector2i(int(wh[0]), int(wh[1]))
	# Превью меньше 2К не отдаём: на кадре разбирают стык обоев и профиль рамы,
	# а окно всё равно упирается в экран, поэтому кадр снимается в SubViewport.
	var lo := mini(_size.x, _size.y)
	if lo < 2048:
		var k := 2048.0 / float(maxi(lo, 1))
		_size = Vector2i(int(_size.x * k), int(_size.y * k))

	var f := FileAccess.open(DATA, FileAccess.READ)
	if f == null:
		push_error("нет файла разбора: " + DATA)
		return
	_plan = JSON.parse_string(f.get_as_text())
	f.close()

	if OS.get_cmdline_user_args().has("--flat"):
		_keep_one_flat()

	# --probe=res://путь/к.glb — печатает AABB и узлы модели без рендера.
	# Пивот и габарит по документации доставки не всегда совпадают с тем,
	# что реально пришло импортом — дешевле замерить, чем гадать.
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--probe="):
			_probe_asset(a.substr(8))
			get_tree().quit()
			return

	# --texcheck=res://путь/к.glb — числом, не рендером: привязан ли albedo,
	# границы UV, разброс яркости в этой области атласа на каждую поверхность.
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--texcheck="):
			_texcheck_asset(a.substr(11))
			get_tree().quit()
			return

	# --meshcheck=res://путь/к.glb — форма и развёртка по треугольникам: доля
	# перевёрнутых нормалей, вырожденные треугольники, разброс плотности UV.
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--meshcheck="):
			_meshcheck_asset(a.substr(12))
			get_tree().quit()
			return

	# --gallery-data[=res://путь/к.json] — обход всей game/assets/models и
	# выгрузка цифр (тр., нормали, UV, albedo) в JSON для tools/asset_gallery/.
	for a in OS.get_cmdline_user_args():
		if a == "--gallery-data" or a.begins_with("--gallery-data="):
			var out := "res://assets/gallery_data.json"
			if a.begins_with("--gallery-data="):
				out = a.substr(15)
			_gallery_data(out)
			get_tree().quit()
			return

	# --asset=res://путь/к.glb — осмотр одной модели вне квартиры и без плана:
	# --debug=uv кладёт шахматную развёртку, --debug=normal — цвет по нормали;
	# кадр — через --shot=, как обычно. Не требует --headless=false отдельно,
	# но сам рендер (в отличие от --probe/--texcheck/--meshcheck) нуждается
	# в GPU-контексте — без --headless в запуске.
	var asset_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--asset="):
			asset_path = a.substr(8)
	if asset_path != "":
		_asset_inspect(asset_path)
		return


	# Снимок делаю в SubViewport, а не в окне: окно упирается в размер экрана
	# (1800 x 1500 превращается в 1800 x 1012), а вьюпорту потолка нет и кадр
	# можно взять любой высоты. Мир общий, поэтому свет и среда те же.
	if _shot != "":
		_vp = SubViewport.new()
		# Суперсэмплинг: рисуем вдвое крупнее и уменьшаем на сохранении.
		# MSAA сглаживает только кромки геометрии, а на превью лезет ещё и
		# рябь текстуры под скользящим углом — её убирает только выборка
		# нескольких пикселей на один. Флаг --ss=N меняет кратность.
		_vp.size = _size * _ss
		_vp.own_world_3d = false
		_vp.world_3d = get_viewport().find_world_3d()
		_vp.msaa_3d = Viewport.MSAA_8X
		_vp.positional_shadow_atlas_size = 8192
		_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		add_child(_vp)

	_build()
	_decals()
	_ceiling()
	_light()
	_room_lights()
	_camera()
	# VoxelGI печётся из кода и по мануалу — правильный выбор для сцены,
	# собранной программно. Но на нашей камере он проигрывает: перекрытие
	# закрывает верх, комнаты уходят в темноту, а по полу идёт воксельная
	# рябь. Поэтому по умолчанию выключен, включается флагом --gi.
	# Лампочку показываем всегда: патрон без неё выглядит перегоревшим, а так
	# видно и сам источник, и его цвет.
	_show_lights()
	if OS.get_cmdline_user_args().has("--gi"):
		_bake_gi()
	_ready_fly()
	if OS.get_cmdline_user_args().has("--hall"):
		_hall_report()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--spot="):
			var nums := a.substr(7).split(",")
			if nums.size() == 4:
				_spot_debug([nums[0].to_float(), nums[1].to_float(),
						nums[2].to_float(), nums[3].to_float()])
	if OS.get_cmdline_user_args().has("--walk"):
		_walk_check()


## Оставить в разборе только верхнюю квартиру. Половины зеркальны относительно
## z = 0, поэтому режу по центру прямоугольника: общая межквартирная стена
## стоит ровно на нуле и остаётся, соседняя квартира уходит целиком.
func _keep_one_flat() -> void:
	var edge := 0.05

	var rooms := []
	for room in _plan["rooms"]:
		var rects := []
		for r in room["rects"]:
			if (float(r[1]) + float(r[3])) * 0.5 < edge:
				rects.append(r)
		if not rects.is_empty():
			rooms.append({"kind": room["kind"], "rects": rects})
	_plan["rooms"] = rooms

	for key in ["walls", "windows", "door_openings", "parapets"]:
		var keep := []
		for r in _plan.get(key, []):
			if (float(r[1]) + float(r[3])) * 0.5 < edge:
				keep.append(r)
		_plan[key] = keep

	for key in ["closets", "fixtures"]:
		var keep2 := []
		for it in _plan.get(key, []):
			var r: Array = it["r"]
			if (float(r[1]) + float(r[3])) * 0.5 < edge:
				keep2.append(it)
		_plan[key] = keep2

	var b: Array = _plan["bounds"]
	var mz := -1e9
	for room in _plan["rooms"]:
		for r in room["rects"]:
			mz = maxf(mz, float(r[3]))
	_plan["bounds"] = [b[0], b[1], b[2], mz + 0.34]


## Замер модели без рендера: узлы и AABB, свой у каждого MeshInstance3D
## и общий по всем сразу. --probe=res://путь/к.glb.
func _probe_asset(path: String) -> void:
	if not ResourceLoader.exists(path):
		print("[probe] нет файла: ", path)
		return
	var node: Node3D = (load(path) as PackedScene).instantiate()
	add_child(node)
	print("[probe] %s root=%s children=%d" % [path, node.name, node.get_child_count()])
	for c in node.get_children():
		var p := (c as Node3D).position if c is Node3D else Vector3.ZERO
		print("  узел=%s класс=%s позиция=%s" % [c.name, c.get_class(), p])
	var whole := AABB()
	var first := true
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var a := m.global_transform * m.get_aabb()
		whole = a if first else whole.merge(a)
		first = false
		print("  меш=%s локальный=%s мировой=%s" % [m.name, m.get_aabb(), a])
	if not first:
		print("[probe] общий AABB: низ=%.4f верх=%.4f высота=%.4f, x=%.4f..%.4f, z=%.4f..%.4f"
				% [whole.position.y, whole.position.y + whole.size.y, whole.size.y,
						whole.position.x, whole.position.x + whole.size.x,
						whole.position.z, whole.position.z + whole.size.z])


## Проверка текстуры числом, а не рендером и глазом: по каждой поверхности —
## привязан ли albedo, реальный размер текстуры, границы UV и разброс (σ)
## яркости пикселей в прямоугольнике UV-границ этой поверхности. Ловит
## главное — вообще не привязанную текстуру (albedo=false, так поймался
## task-0029/task-0030 с внешним uri без скопированного PNG). Но это σ по
## всему UV-прямоугольнику поверхности разом: если на одном меше есть и
## пёстрый, и ровный участок с одним материалом (как каркас+одеяло в одном
## surface у кровати), общий σ смажет разницу. Для проверки конкретного
## участка меша — --meshcheck= (площадь UV/3D по треугольникам) и
## --asset=...--debug=uv|normal (посмотреть глазами по факту, не гадая).
## --texcheck=res://путь/к.glb.
func _texcheck_asset(path: String) -> void:
	if not ResourceLoader.exists(path):
		print("[texcheck] нет файла: ", path)
		return
	var node: Node3D = (load(path) as PackedScene).instantiate()
	add_child(node)
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var mesh := m.mesh
		if mesh == null:
			continue
		for si in mesh.get_surface_count():
			var mat := m.get_active_material(si)
			var alb: Texture2D = null
			var mat_class := "null"
			if mat != null:
				mat_class = mat.get_class()
				if mat is BaseMaterial3D:
					alb = (mat as BaseMaterial3D).albedo_texture
			var arrays := mesh.surface_get_arrays(si)
			var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] \
					if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
			var umin := 1e9
			var umax := -1e9
			var vmin := 1e9
			var vmax := -1e9
			for uv in uvs:
				umin = minf(umin, uv.x)
				umax = maxf(umax, uv.x)
				vmin = minf(vmin, uv.y)
				vmax = maxf(vmax, uv.y)
			var stddev := -1.0
			var tex_size := Vector2i.ZERO
			if alb != null:
				tex_size = Vector2i(alb.get_width(), alb.get_height())
				var img := alb.get_image()
				if img != null and uvs.size() > 0 and umax > umin and vmax > vmin:
					img.convert(Image.FORMAT_RGB8)
					var w := img.get_width()
					var h := img.get_height()
					var x0 := clampi(int(clampf(umin, 0.0, 1.0) * w), 0, w - 1)
					var x1 := clampi(int(clampf(umax, 0.0, 1.0) * w), x0 + 1, w)
					var y0 := clampi(int(clampf(vmin, 0.0, 1.0) * h), 0, h - 1)
					var y1 := clampi(int(clampf(vmax, 0.0, 1.0) * h), y0 + 1, h)
					var step_x := maxi((x1 - x0) / 80, 1)
					var step_y := maxi((y1 - y0) / 80, 1)
					var sum := 0.0
					var sum2 := 0.0
					var n := 0
					var yy := y0
					while yy < y1:
						var xx := x0
						while xx < x1:
							var px := img.get_pixel(xx, yy)
							var g := (px.r + px.g + px.b) / 3.0
							sum += g
							sum2 += g * g
							n += 1
							xx += step_x
						yy += step_y
					if n > 0:
						var mean := sum / float(n)
						stddev = sqrt(maxf(sum2 / float(n) - mean * mean, 0.0))
			print(("[texcheck] меш=%s surf=%d материал=%s albedo=%s размер=%s " +
					"UV=(%.3f..%.3f, %.3f..%.3f) разброс(σ)=%.4f")
					% [m.name, si, mat_class, alb != null, tex_size,
							umin, umax, vmin, vmax, stddev])


## Форма и развёртка числом, по треугольникам, а не по пикселям текстуры.
## На каждом треугольнике сравниваю площадь в 3D с площадью в UV — их
## отношение и есть плотность текстуры на этом кусочке меша. Если развёртка
## растянута неровно, отношение скачет от треугольника к треугольнику;
## коэффициент вариации (σ/среднее) — единое число на разброс, не зависящее
## от того, пёстрый атлас или нет. Заодно: вырожденные (нулевой площади)
## треугольники и доля треугольников, чья геометрическая нормаль не
## согласуется с большинством меша (не «перевёрнута ли нормаль вообще» —
## общее направление cross-произведения зависит от порядка вершин в
## экспорте и само по себе ничего не значит; важно, когда часть треугольников
## одного меша расходится с остальными — это и есть реальный дефект,
## например залипшая symmetry-модификация или трансформация навыворот).
## --meshcheck=res://путь/к.glb.
func _meshcheck_asset(path: String) -> void:
	if not ResourceLoader.exists(path):
		print("[meshcheck] нет файла: ", path)
		return
	var node: Node3D = (load(path) as PackedScene).instantiate()
	add_child(node)
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var mesh := m.mesh
		if mesh == null:
			continue
		for si in mesh.get_surface_count():
			var arrays := mesh.surface_get_arrays(si)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] \
					if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
			var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] \
					if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
			var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] \
					if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			if idx.is_empty():
				idx.resize(verts.size())
				for i in verts.size():
					idx[i] = i
			var tri_count := idx.size() / 3
			var degenerate := 0
			var flipped := 0
			var normal_checked := 0
			var ratios: Array[float] = []
			for t in tri_count:
				var i0 := idx[t * 3]
				var i1 := idx[t * 3 + 1]
				var i2 := idx[t * 3 + 2]
				var p0 := verts[i0]
				var p1 := verts[i1]
				var p2 := verts[i2]
				var cr := (p1 - p0).cross(p2 - p0)
				var area2 := cr.length()
				if area2 < 1e-10:
					degenerate += 1
					continue
				if not normals.is_empty():
					var vn := normals[i0] + normals[i1] + normals[i2]
					if vn.length() > 1e-6:
						normal_checked += 1
						if vn.normalized().dot(cr / area2) < 0.0:
							flipped += 1
				if not uvs.is_empty():
					var u0 := uvs[i0]
					var u1 := uvs[i1]
					var u2 := uvs[i2]
					var uv_area2 := absf((u1 - u0).cross(u2 - u0))
					if uv_area2 > 1e-12:
						ratios.append(uv_area2 / area2)
			var line := "[meshcheck] меш=%s surf=%d тр=%d вырожд=%d" \
					% [m.name, si, tri_count, degenerate]
			if normal_checked > 0:
				# Направление cross-произведения — условность (порядок вершин
				# в буфере против часовой/по часовой), поэтому 100% или 0% на
				# весь меш — это просто общая конвенция экспорта, не дефект.
				# Дефект — когда часть треугольников смотрит иначе, чем
				# большинство: несогласованность внутри одного меша.
				var inconsistent: int = mini(flipped, normal_checked - flipped)
				line += " несогласованных_нормалей=%d/%d (%.1f%%)" \
						% [inconsistent, normal_checked,
								100.0 * inconsistent / normal_checked]
			if ratios.size() > 1:
				var s := 0.0
				for r in ratios:
					s += r
				var mean: float = s / ratios.size()
				var s2 := 0.0
				for r in ratios:
					s2 += (r - mean) * (r - mean)
				var sd := sqrt(s2 / ratios.size())
				var lo: float = ratios[0]
				var hi: float = ratios[0]
				for r in ratios:
					lo = minf(lo, r)
					hi = maxf(hi, r)
				line += " UV-плотность: среднее=%.5f σ=%.5f σ/сред=%.2f мин=%.5f макс=%.5f" \
						% [mean, sd, (sd / mean if mean > 0.0 else -1.0), lo, hi]
			print(line)


## UV-текстура для --debug=uv: стандартная пронумерованная сетка (00..99,
## стрелка на каждой клетке — видно поворот и зеркалирование, подписи
## [0,0]/[1,1] по углам — видно, где на развёртке верх/низ). Своя клетка без
## разметки не давала отличить поворот на 90° и зеркалирование от нормальной
## развёртки — этого рисунком без стрелок не видно. Файл — готовый
## UV-Checker-Grid (ALanMAttano, CC-BY 4.0), лежит рядом с игрой, а не
## генерируется в рантайме.
const UV_CHECKER := "res://assets/debug/uv_checker_grid_2k.png"

func _checker_texture() -> Texture2D:
	if ResourceLoader.exists(UV_CHECKER):
		return load(UV_CHECKER) as Texture2D
	push_error("[asset] нет " + UV_CHECKER + " — эталонная UV-сетка не скачана")
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	img.fill(Color.MAGENTA)
	return ImageTexture.create_from_image(img)


## Цвет = нормаль поверхности, без освещения. Перевёрнутая или рваная
## нормаль сразу видна как чужой или скачущий цвет там, где на глаз всё
## ровно.
func _normal_debug_shader() -> Shader:
	var sh := Shader.new()
	sh.code = "shader_type spatial;\nrender_mode unshaded, cull_disabled;\n" \
			+ "void fragment() {\n\tALBEDO = NORMAL * 0.5 + 0.5;\n}\n"
	return sh


## Осмотр одной модели вне квартиры и без разбора плана — форма, развёртка,
## нормали. --debug=uv кладёт шахматную текстуру на все поверхности,
## --debug=normal — цвет по нормали; без --debug — обычный материал модели.
## Кадр берётся тем же --shot=/--size=/--ss=/--pitch=/--yaw=/--zoom=, что и
## у сцены квартиры — код захвата в _process() общий, здесь только своя
## камера, кадрирующая AABB модели, а не помещения.
func _asset_inspect(path: String) -> void:
	if not ResourceLoader.exists(path):
		push_error("[asset] нет файла: " + path)
		get_tree().quit()
		return
	var node: Node3D = (load(path) as PackedScene).instantiate()
	add_child(node)
	var whole := AABB()
	var first := true
	var meshes: Array[MeshInstance3D] = []
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		meshes.append(m)
		var a: AABB = m.global_transform * m.get_aabb()
		whole = a if first else whole.merge(a)
		first = false
	if first:
		push_error("[asset] в модели нет MeshInstance3D: " + path)
		get_tree().quit()
		return

	var debug_mode := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--debug="):
			debug_mode = a.substr(8)
	if debug_mode == "uv":
		var checker := _checker_texture()
		for m in meshes:
			var mat := StandardMaterial3D.new()
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			mat.albedo_texture = checker
			m.material_override = mat
	elif debug_mode == "normal":
		var nmat := ShaderMaterial.new()
		nmat.shader = _normal_debug_shader()
		for m in meshes:
			m.material_override = nmat

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55.0, -35.0, 0.0)
	sun.light_energy = 1.1
	add_child(sun)
	var env_res := Environment.new()
	env_res.background_mode = Environment.BG_COLOR
	env_res.background_color = Color(0.5, 0.52, 0.55)
	env_res.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env_res.ambient_light_color = Color(0.65, 0.65, 0.68)
	var world_env := WorldEnvironment.new()
	world_env.environment = env_res
	add_child(world_env)

	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.current = true
	if _shot != "":
		_vp = SubViewport.new()
		_vp.size = _size * _ss
		_vp.own_world_3d = false
		_vp.world_3d = get_viewport().find_world_3d()
		_vp.msaa_3d = Viewport.MSAA_8X
		_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		add_child(_vp)
		_vp.add_child(cam)
	else:
		add_child(cam)

	var pitch := 35.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--pitch="):
			pitch = clampf(float(a.substr(8)), 5.0, 89.0)
	var yaw := 35.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--yaw="):
			yaw = float(a.substr(6))
	var center := whole.position + whole.size * 0.5
	var diag := maxf(whole.size.length(), 0.05)
	cam.size = diag
	var rad := deg_to_rad(pitch)
	var yr := deg_to_rad(yaw)
	var eye := Vector3(cos(rad) * sin(yr), sin(rad), cos(rad) * cos(yr)) * diag * 3.0
	cam.global_position = center + eye
	cam.look_at(center, Vector3.UP)
	_frame(cam, whole.position, whole.position + whole.size)


## Те же цифры, что --meshcheck=/--texcheck=, но по одной поверхности сразу
## (меш грузится один раз, а не дважды) — для пакетного прохода по всей
## библиотеке в --gallery-data=. Отдельная функция, а не общая с
## _meshcheck_asset/_texcheck_asset: те печатают в stdout построчно для
## человека, тут нужен словарь для JSON, и совмещать оба формата в одной
## функции сложнее, чем недорого продублировать один проход по треугольникам.
func _surface_gallery_stats(m: MeshInstance3D, si: int) -> Dictionary:
	var mesh := m.mesh
	var arrays := mesh.surface_get_arrays(si)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] \
			if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] \
			if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] \
			if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
	if idx.is_empty():
		idx.resize(verts.size())
		for i in verts.size():
			idx[i] = i
	var tri_count := idx.size() / 3
	var degenerate := 0
	var flipped := 0
	var normal_checked := 0
	var ratios: Array[float] = []
	var umin := 1e9
	var umax := -1e9
	var vmin := 1e9
	var vmax := -1e9
	for t in tri_count:
		var i0 := idx[t * 3]
		var i1 := idx[t * 3 + 1]
		var i2 := idx[t * 3 + 2]
		var p0 := verts[i0]
		var p1 := verts[i1]
		var p2 := verts[i2]
		var cr := (p1 - p0).cross(p2 - p0)
		var area2 := cr.length()
		if area2 < 1e-10:
			degenerate += 1
			continue
		if not normals.is_empty():
			var vn := normals[i0] + normals[i1] + normals[i2]
			if vn.length() > 1e-6:
				normal_checked += 1
				if vn.normalized().dot(cr / area2) < 0.0:
					flipped += 1
		if not uvs.is_empty():
			var u0 := uvs[i0]
			var u1 := uvs[i1]
			var u2 := uvs[i2]
			umin = minf(umin, minf(u0.x, minf(u1.x, u2.x)))
			umax = maxf(umax, maxf(u0.x, maxf(u1.x, u2.x)))
			vmin = minf(vmin, minf(u0.y, minf(u1.y, u2.y)))
			vmax = maxf(vmax, maxf(u0.y, maxf(u1.y, u2.y)))
			var uv_area2 := absf((u1 - u0).cross(u2 - u0))
			if uv_area2 > 1e-12:
				ratios.append(uv_area2 / area2)
	var cv := -1.0
	if ratios.size() > 1:
		var s := 0.0
		for r in ratios:
			s += r
		var mean: float = s / ratios.size()
		var s2 := 0.0
		for r in ratios:
			s2 += (r - mean) * (r - mean)
		var sd := sqrt(s2 / ratios.size())
		cv = sd / mean if mean > 0.0 else -1.0
	var inconsistent_pct := 0.0
	if normal_checked > 0:
		inconsistent_pct = 100.0 * mini(flipped, normal_checked - flipped) \
				/ float(normal_checked)

	var mat := m.get_active_material(si)
	var albedo := false
	var tex_w := 0
	var tex_h := 0
	var sigma := -1.0
	if mat is BaseMaterial3D:
		var alb := (mat as BaseMaterial3D).albedo_texture
		if alb != null:
			albedo = true
			tex_w = alb.get_width()
			tex_h = alb.get_height()
			var img := alb.get_image()
			if img != null and umax > umin and vmax > vmin:
				img.convert(Image.FORMAT_RGB8)
				var w := img.get_width()
				var h := img.get_height()
				var x0 := clampi(int(clampf(umin, 0.0, 1.0) * w), 0, w - 1)
				var x1 := clampi(int(clampf(umax, 0.0, 1.0) * w), x0 + 1, w)
				var y0 := clampi(int(clampf(vmin, 0.0, 1.0) * h), 0, h - 1)
				var y1 := clampi(int(clampf(vmax, 0.0, 1.0) * h), y0 + 1, h)
				var sx := maxi((x1 - x0) / 60, 1)
				var sy := maxi((y1 - y0) / 60, 1)
				var sum := 0.0
				var sum2 := 0.0
				var n := 0
				var yy := y0
				while yy < y1:
					var xx := x0
					while xx < x1:
						var px := img.get_pixel(xx, yy)
						var g := (px.r + px.g + px.b) / 3.0
						sum += g
						sum2 += g * g
						n += 1
						xx += sx
					yy += sy
				if n > 0:
					var mn := sum / float(n)
					sigma = sqrt(maxf(sum2 / float(n) - mn * mn, 0.0))
	return {
		"tris": tri_count, "degenerate": degenerate,
		"inconsistent_normals_pct": inconsistent_pct,
		"uv_cv": cv, "albedo": albedo, "tex_w": tex_w, "tex_h": tex_h,
		"sigma": sigma,
	}


## Обход всей библиотеки моделей и выгрузка в JSON — данные для галереи
## (tools/asset_gallery/). Сам HTML статический и ничего не считает, только
## читает этот файл через fetch(); чтобы обновить галерею после новой
## поставки — перезапустить --gallery-data=, HTML не трогать.
## --gallery-data=res://путь/к.json (по умолчанию res://assets/gallery_data.json).
func _gallery_data(out_path: String) -> void:
	var root := "res://assets/models/"
	var stack: Array[String] = [root]
	var files: Array[String] = []
	while not stack.is_empty():
		var dir_path: String = stack.pop_back()
		var d := DirAccess.open(dir_path)
		if d == null:
			continue
		d.list_dir_begin()
		var fn := d.get_next()
		while fn != "":
			if fn == "." or fn == "..":
				fn = d.get_next()
				continue
			var full := dir_path.path_join(fn)
			if d.current_is_dir():
				stack.append(full)
			elif fn.ends_with(".glb"):
				files.append(full)
			fn = d.get_next()
		d.list_dir_end()
	files.sort()
	var results := []
	for path in files:
		var node: Node3D = (load(path) as PackedScene).instantiate()
		add_child(node)
		var surfaces := []
		for mi in node.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			if m.mesh == null:
				continue
			for si in m.mesh.get_surface_count():
				surfaces.append(_surface_gallery_stats(m, si))
		node.queue_free()
		var rel: String = path.substr(root.length())
		results.append({"path": path, "rel": rel,
				"category": rel.get_base_dir(), "surfaces": surfaces})
		print("[gallery] ", rel, " — ", surfaces.size(), " surf.")
	var f := FileAccess.open(out_path, FileAccess.WRITE)
	if f == null:
		push_error("[gallery] не смог записать: " + out_path)
		return
	f.store_string(JSON.stringify(results, "  "))
	f.close()
	print("[gallery] записал ", results.size(), " моделей в ", out_path)


## Материал по набору текстур из assets: albedo + normal + ORM.
## Развёртка трипланарная и в метрах, чтобы масштаб не зависел от размера
## коробки: у стены 5 м и у откоса 0.2 м рисунок одинаковый.
func _tex(dir_: String, base: String, scale: float,
		tint: Color = Color(1, 1, 1), use_normal: bool = true,
		rough_mul: float = 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var root := "res://assets/textures/%s/%s" % [dir_, base]
	var alb := root + "_albedo_1k.png"
	if not ResourceLoader.exists(alb):
		return _mat(tint)
	m.albedo_texture = load(alb)
	m.albedo_color = tint
	var nrm := root + "_normal_1k.png"
	if use_normal and ResourceLoader.exists(nrm):
		m.normal_enabled = true
		m.normal_texture = load(nrm)
	var orm := root + "_orm_1k.png"
	if ResourceLoader.exists(orm):
		m.ao_enabled = true
		m.ao_texture = load(orm)
		m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
		# Шероховатость берём из зелёного канала ORM: в принятых наборах шум
		# по нему 0.0001…0.003, искрить нечему, а разница материалов без неё
		# пропадает — всё выглядит одинаково матовым.
		m.roughness_texture = m.ao_texture
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
	m.roughness = rough_mul
	m.metallic_specular = 0.5
	m.uv1_triplanar = true
	m.uv1_scale = Vector3.ONE * scale
	return m


## Пол: то же самое, но без карты нормалей — при скользящем свете лампы
## она даёт по полу искры, которые читаются как мусор.
func _texf(dir_: String, base: String, scale: float,
		tint: Color = Color(1, 1, 1)) -> StandardMaterial3D:
	return _tex(dir_, base, scale, tint, false)


func _mat(c: Color, rough: float = 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


## Коллизию получают только те коробки, о которые можно стукнуться: стены,
## полы, парапеты, стенки кладовок. Отделка (2 см на стене), перемычки над
## головой и стёкла её не получают — иначе игрок цепляется за декор.
const SOLID := ["Wall", "Slab", "Floor", "Sill", "Parapet", "ClosetW",
		"ClosetFloor", "Fx"]


func _box(size: Vector3, pos: Vector3, mat: Material, name_: String) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	mi.name = name_
	if not SOLID.has(name_):
		return
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	body.position = pos
	body.name = name_ + "Body"
	add_child(body)


func _build() -> void:
	var h: float = _plan["wall_h"]
	var sill: float = _plan["sill"]
	var lintel: float = _plan["lintel"]
	var door_h: float = _plan["door_h"]

	# Каждому виду блока свой материал. Пол квартир, обои и плитка санузла
	# ещё в работе (task-0014 у houdini-assets) — до сдачи стоят ближайшие
	# из принятых, чтобы масштаб и тон уже читались.
	var m_wall := _tex("wall-paint", "wall_paint", 0.32)
	# Побелка потолка и полоски стены под ним — советская квартира красилась
	# так почти всегда, отдельного набора под это заводить незачем: это тот
	# же wall-paint, что и база стены под отделкой.
	_m_white_shared = m_wall
	var m_wall_out := _tex("concrete-facade", "concrete_facade", 0.22)
	var m_floor := _texf("concrete-facade", "concrete_facade", 0.25,
			Color(0.78, 0.76, 0.73))
	var m_frame := _mat(Color(0.86, 0.84, 0.79), 0.55)
	var m_leaf := _mat(Color(0.55, 0.42, 0.30), 0.75)
	var m_closet := _tex("wall-paint-worn", "wall_paint_worn", 0.30)
	var m_fix := _mat(Color(0.00, 0.63, 0.84))
	var m_glass := _mat(Color(0.62, 0.84, 0.92), 0.12)
	m_glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m_glass.albedo_color.a = 0.40
	_m_glass_shared = m_glass

	var b: Array = _plan["bounds"]
	_box(Vector3(b[2] - b[0], 0.16, b[3] - b[1]),
			Vector3((b[0] + b[2]) * 0.5, -0.08, (b[1] + b[3]) * 0.5), m_floor, "Slab")

	# пол помещений цветом по назначению
	# Масштаб — из tiles.txt доставки: 1 / (размер тайла в метрах).
	# Полы — самая большая непрерывная поверхность в кадре, повторяемость на
	# них заметнее всего. Поэтому они идут через шейдер без видимого тайла.
	# Тёплый подкрас дерева. Наборы приходят серыми: у паркета разница
	# красного и синего всего +0.07 при насыщенности 0.174, и на кадре это
	# читается как серая доска. Множитель поднимает красный и опускает синий,
	# давая примерно +0.15 — тон выцветшего дуба, порода видна.
	var wood := Color(1.10, 1.00, 0.86)
	var m_kind := {
		# Линолеум вернулся под доску: тайл 0.48 вместо 1.20 — на 60 % мельче,
		# и рисунок приглушён на 30 % относительно среднего цвета набора.
		# Средний цвет замерен по albedo, поэтому глушение не уводит в серое.
		# Потёртость: та же текстура линолеума, обесцвеченная по маске из точек
		# у порогов/рабочего места — не декаль отдельным цветом (см. правку
		# «Убрана вторая, настоящая потёртость...»). Прихожая — главный
		# коридор, там сила выше, чем на пятачке у мойки и плиты.
		"кухня": _tex_st("floor-lino-2", "floor_lino_2",
				_tile_m("floor-lino-2", 1.20) * 0.4, Color(1, 1, 1), 0.09, 0,
				0.95, 0.7, LINO_BASE, true, 0.0, _wear_points("кухня"), 0.45, 0.45),
		"прихожая": _tex_st("floor-lino-2", "floor_lino_2",
				_tile_m("floor-lino-2", 1.20) * 0.4, Color(0.98, 0.97, 0.96),
				0.11, 0, 0.95, 0.7, LINO_BASE, true, 0.0,
				_wear_points("прихожая"), 1.0, 0.8),
		"лоджия": _tex_st("landing-floor", "landing_floor", 4.55,
				Color(1, 1, 1), 0.07, 0, 1.0),
		"санузел": _tex_st("tile-floor", "tile_floor",
				_tile_m("tile-floor", 1.60), Color(1.06, 1.00, 0.90), 0.05, 8,
				0.62, 0.78, Color(0.42, 0.40, 0.37)),
	}
	# Пятна выцветания: солнце годами било в пол сильнее у окна — там и
	# цвет садится первым, не только светлота. 999.0 здесь стояло отладочным
	# сторожевым значением (шейдер закрашивал пол сплошным шумом для
	# проверки маски) и осталось в коммите по ошибке — щитовой паркет
	# из-за этого стоял серым пятном вместо дерева.
	# Потёртость у дверей в жилых — не по центру комнаты (она большая, следа
	# от хождения по центру не бывает), а у каждого проёма, ведущего внутрь.
	var wear_zhilaya := _wear_points_doors("жилая")
	m_kind["жилая"] = _tex_st("floor-parquet", "floor_parquet",
			_tile_m("floor-parquet", 1.60) * 1.35, wood, 0.09, 4, 0.85,
			1.0, Color(0.5, 0.5, 0.5), true, 0.30, wear_zhilaya, 0.12, 0.5)
	# В большой комнате паркет уложен ёлочкой, в маленькой — щитовой.
	var m_herring: Material = m_kind["жилая"]
	if ResourceLoader.exists(
			"res://assets/textures/floor-parquet-2/floor_parquet_2_albedo_1k.png"):
		# Ёлочка идёт без стохастической выборки: её сдвиги режут планки
		# поперёк, и доски выглядят пересекающимися. Повторяемость снимается
		# макро-вариацией и картой id, а сетку тайла у диагонального рисунка
		# глаз и так не ловит.
		m_herring = _tex_st("floor-parquet-2", "floor_parquet_2",
				_tile_m("floor-parquet-2", 1.70) * 1.35, wood, 0.13, 0, 0.85,
				1.0, Color(0.5, 0.5, 0.5), false, 0.65, wear_zhilaya, 0.12, 0.5)
	for room in _plan["rooms"]:
		var mk: Material = m_kind.get(room["kind"], m_floor)
		for r in room["rects"]:
			if String(room["kind"]) == "жилая":
				var area := (float(r[2]) - float(r[0])) * (float(r[3]) - float(r[1]))
				mk = m_herring if area > 17.0 else m_kind["жилая"]
			if float(r[2]) - float(r[0]) < 0.08 or float(r[3]) - float(r[1]) < 0.08:
				continue
			_box(Vector3(float(r[2]) - float(r[0]), 0.04, float(r[3]) - float(r[1])),
					Vector3((float(r[0]) + float(r[2])) * 0.5, 0.02,
							(float(r[1]) + float(r[3])) * 0.5), mk, "Floor")

	for r in _plan["walls"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.02 or d < 0.02:
			continue
		var b2: Array = _plan["bounds"]
		var outer := (float(r[0]) - float(b2[0]) < 0.45
				or float(b2[2]) - float(r[2]) < 0.45
				or float(r[1]) - float(b2[1]) < 0.45
				or float(b2[3]) - float(r[3]) < 0.45)
		_box(Vector3(w, h, d), Vector3((float(r[0]) + float(r[2])) * 0.5, h * 0.5,
				(float(r[1]) + float(r[3])) * 0.5),
				m_wall_out if outer else m_wall, "Wall")

	# Окно сидит в середине толщины стены: снизу и сверху бетон, между ними
	# рама со стеклом, и по бокам остаются откосы.
	for r in _plan["windows"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.05 or d < 0.05:
			continue
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		_box(Vector3(w, sill, d), Vector3(cx, sill * 0.5, cz), m_wall, "Sill")
		_box(Vector3(w, h - lintel, d), Vector3(cx, (h + lintel) * 0.5, cz),
				m_wall, "Lintel")
		# оконный блок от houdini-assets; если по ширине не подходит — своё стекло
		if not _window_asset(cx, cz, maxf(w, d), w <= d, sill):
			_glazing(Vector3(w, 0, d), cx, cz, sill, lintel, m_frame, m_glass)

	# Дверь: над проёмом бетонная перемычка, в проёме полотно по центру стены.
	for r in _plan.get("door_openings", []):
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.05 or d < 0.05:
			continue
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		_box(Vector3(w, h - door_h, d), Vector3(cx, (h + door_h) * 0.5, cz),
				m_wall, "DoorLintel")
		# дверной блок от houdini-assets вместо самодельного полотна с обвязкой
		if _door_asset(cx, cz, maxf(w, d), w <= d):
			continue
		var leaf := Vector3(w, door_h - 0.04, d)
		if w <= d:
			leaf.x = 0.05
		else:
			leaf.z = 0.05
		_box(leaf, Vector3(cx, (door_h - 0.04) * 0.5, cz), m_leaf, "DoorLeaf")
		# коробка двери: обвязка по краю проёма
		var fr := 0.08
		_box(Vector3(leaf.x, fr, leaf.z), Vector3(cx, door_h - fr * 0.5, cz),
				m_frame, "DoorFrameHi")
		if w <= d:
			_box(Vector3(leaf.x, door_h, fr),
					Vector3(cx, door_h * 0.5, cz - d * 0.5 + fr * 0.5), m_frame, "DFa")
			_box(Vector3(leaf.x, door_h, fr),
					Vector3(cx, door_h * 0.5, cz + d * 0.5 - fr * 0.5), m_frame, "DFb")
		else:
			_box(Vector3(fr, door_h, leaf.z),
					Vector3(cx - w * 0.5 + fr * 0.5, door_h * 0.5, cz), m_frame, "DFa")
			_box(Vector3(fr, door_h, leaf.z),
					Vector3(cx + w * 0.5 - fr * 0.5, door_h * 0.5, cz), m_frame, "DFb")
		# балконная дверь застеклена в верхней части
		if maxf(w, d) >= 1.0:
			var gl := leaf
			gl.y = door_h * 0.55
			_box(gl, Vector3(cx, door_h - gl.y * 0.5 - 0.06, cz), m_glass, "DoorGlass")

	# Лоджия остеклена: парапет по пояс, над ним стекло до перемычки.
	for r in _plan.get("parapets", []):
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.02 or d < 0.02:
			continue
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		_box(Vector3(w, 1.00, d), Vector3(cx, 0.50, cz), m_wall, "Parapet")
		_box(Vector3(w, h - lintel, d), Vector3(cx, (h + lintel) * 0.5, cz),
				m_wall, "LoggiaLintel")
		_glazing(Vector3(w, 0, d), cx, cz, 1.00, lintel, m_frame, m_glass)

	# Кладовка — закрытая комнатка: стенки по контуру, свой пол и дверца
	# во всю высоту с той стороны, куда открывается.
	for c in _plan["closets"]:
		var r: Array = c["r"]
		var side: Array = c["side"]
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.05 or d < 0.05:
			continue
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		var tw := 0.06
		var dz: float = float(side[0])
		var dx: float = float(side[1])
		if dz >= 0.0:
			_box(Vector3(w, h, tw), Vector3(cx, h * 0.5, cz - d * 0.5 + tw * 0.5),
					m_closet, "ClosetW")
		if dz <= 0.0:
			_box(Vector3(w, h, tw), Vector3(cx, h * 0.5, cz + d * 0.5 - tw * 0.5),
					m_closet, "ClosetW")
		if dx >= 0.0:
			_box(Vector3(tw, h, d), Vector3(cx - w * 0.5 + tw * 0.5, h * 0.5, cz),
					m_closet, "ClosetW")
		if dx <= 0.0:
			_box(Vector3(tw, h, d), Vector3(cx + w * 0.5 - tw * 0.5, h * 0.5, cz),
					m_closet, "ClosetW")
		_box(Vector3(w - tw * 2.0, 0.04, d - tw * 2.0), Vector3(cx, 0.03, cz),
				m_closet, "ClosetFloor")
		var dw := Vector3(w, h, d)
		var dpos := Vector3(cx, h * 0.5, cz)
		if dx > 0.0:
			dw.x = 0.05
			dpos.x = cx + w * 0.5
		elif dx < 0.0:
			dw.x = 0.05
			dpos.x = cx - w * 0.5
		elif dz > 0.0:
			dw.z = 0.05
			dpos.z = cz + d * 0.5
		else:
			dw.z = 0.05
			dpos.z = cz - d * 0.5
		_box(dw, dpos, m_leaf, "ClosetDoor")

	# Отделка стен по помещению. Стена — общий блок между двумя комнатами и
	# материал у неё один, поэтому обои, краску и плитку кладу отдельной
	# тонкой «шкурой» на внутреннюю грань каждого помещения.
	# У краски кухни рисунок привязан к высоте: тёмная панель на нижних 1.10 м
	# трёхметрового тайла. Трипланар кладёт его от мировой Y перевёрнутым,
	# поэтому вертикаль зеркалю — иначе панель уезжает под потолок.
	# У краски вертикаль вшита (панель до 1.10 при тайле 3.00), поэтому
	# стохастическая выборка ей противопоказана — она сдвигает копии и панель
	# поедет. Остаётся обычный трипланар с зеркальной вертикалью.
	# Тайл мельче кухонного изначального (2.4 м вместо 3.00) — крупная
	# текстура вплотную в узкой прихожей читалась грубо. Тайл один и тот же
	# для кухни и прихожей: разный масштаб одной и той же краски между
	# соседними комнатами читался нестыковкой, будто где-то текстура
	# низкополигональнее, хотя дело было в разном тайле, не в детализации.
	var m_paint := _tex("wall-paint-kitchen", "wall_paint_kitchen",
			1.0 / (_tile_m("wall-paint-kitchen", 3.00) * 0.6), Color(1, 1, 1),
			true, 0.80)
	m_paint.uv1_scale.y = -m_paint.uv1_scale.y
	# Второе состояние краски — битое — держим для разорённых квартир. В этой
	# оно стояло в прихожей и делало коридор избитым: помещение маленькое,
	# стены близко, и каждая выбоина читается в упор.
	var m_paint_worn := m_paint
	if ResourceLoader.exists(
			"res://assets/textures/wall-paint-kitchen-2/wall_paint_kitchen_2_albedo_1k.png"):
		m_paint_worn = _tex("wall-paint-kitchen-2", "wall_paint_kitchen_2",
				1.0 / _tile_m("wall-paint-kitchen-2", 3.00))
		m_paint_worn.uv1_scale.y = -m_paint_worn.uv1_scale.y
	# Обои в комнатах разные. Пока набор один (task-0014), поэтому комнаты
	# разводятся оттенком и шагом рисунка; как приедут варианты рисунка
	# (task-0021), сюда встанут они, а перебор по комнатам останется тот же.
	# Обои: вертикаль полотнища вшита, поэтому стохастика тоже не годится.
	# Порядок не по номеру, а по заметности рисунка: сначала ромб и полоса,
	# они читаются с расстояния, потом цветочек и однотонные. В квартире две
	# комнаты, поэтому первые два номера и определяют, что видно.
	# Порядок: сначала наборы с орнаментом (task-0027), они читаются рисунком;
	# фактурные из task-0021 остаются для соседних квартир.
	var papers: Array[Material] = []
	for i in [6, 8, 7, 9, 2, 5, 3, 4]:
		var dir_ := "wall-paper-%d" % i
		if ResourceLoader.exists("res://assets/textures/%s/wall_paper_%d_albedo_1k.png"
				% [dir_, i]):
			# Рисунок крупнее вдвое: на стене 2.8 x 2.84 мелкий орнамент
			# сливается в фактуру и перестаёт читаться рисунком.
			papers.append(_tex(dir_, "wall_paper_%d" % i,
					1.0 / (_tile_m(dir_, 1.06) * 3.0)))
	if papers.is_empty():
		papers.append(_tex("wall-paper", "wall_paper", 1.0 / 3.18))
	var room_i := 0

	var m_skin := {
		"жилая": papers[0],
		"кухня": m_paint,
		"прихожая": m_paint,
		# Стены санузла. Взял набор tile-floor, а не tile-bath, ради шва:
		# у tile-bath он 6.6 мм в его собственном тайле 1.20, а мы клали его
		# ещё крупнее — выходило 8.8 мм, то есть кирпичная кладка. У tile-floor
		# шов 3.6 мм при тайле 1.60, а на 1.20 это 2.7 мм — как в жизни.
		# Плитка получается 15 см, подкрашена светлее и глянцевее напольной.
		# Песочный оттенок и приглушённый рисунок: белая плитка с сильным
		# контрастом швов и сколов читается кафелем из больницы.
		"санузел": _tex_st("tile-bath", "tile_bath",
				_tile_m("tile-bath", 1.60), Color(1.16, 1.09, 0.94), 0.04, 8,
				0.52, 0.72, Color(0.60, 0.58, 0.54)),
	}
	var holes: Array = []
	holes.append_array(_plan.get("door_openings", []))
	holes.append_array(_plan.get("windows", []))
	holes.append_array(_plan.get("parapets", []))
	# Обои и краска не доходят до потолка — над ними полоса штукатурки на
	# побелке, как в реальной советской квартире. У плитки санузла своей
	# полосы нет, она кладётся во всю высоту.
	var paper_h: float = h - 0.35
	for room in _plan["rooms"]:
		var ms: Material = m_skin.get(room["kind"])
		if ms == null:
			continue
		var kind := String(room["kind"])
		var cap := _m_white_shared if kind != "санузел" else null
		var cap_h := paper_h if kind != "санузел" else -1.0
		# Помещения в разборе сгруппированы по назначению, поэтому «жилая» —
		# это один блок с несколькими прямоугольниками. Обои выбираются на
		# каждый прямоугольник, иначе обе комнаты получают один рисунок.
		for r in room["rects"]:
			if kind == "жилая":
				ms = papers[room_i % papers.size()]
				room_i += 1
			_room_skin(r, ms, h, door_h, holes, cap, cap_h)
			if kind == "жилая":
				_wallpaper_border(r, paper_h)

	_skirting()

	# Приборы: высоты как в жизни, стоят на полу.
	if OS.get_cmdline_user_args().has("--bare"):
		return                      # только стены, полы и отделка
	if _fixtures():
		_curtains()
		_furniture()
		_closet_doors()
		return
	var m_fh := {"ванна": 0.58, "унитаз": 0.40, "мойка": 0.85,
			"раковина": 0.80, "плита": 0.85}
	for fx in _plan["fixtures"]:
		var r: Array = fx["r"]
		var hh: float = float(m_fh.get(fx["kind"], 0.8))
		_box(Vector3(float(r[2]) - float(r[0]), hh, float(r[3]) - float(r[1])),
				Vector3((float(r[0]) + float(r[2])) * 0.5, hh * 0.5,
						(float(r[1]) + float(r[3])) * 0.5), m_fix, "Fx")


# --- блоки от houdini-assets -------------------------------------------------
# Пивот у всех — середина низа проёма, ширина модели по X, у окон «комнатная»
# сторона это местный −Z. Проём в стене вырезан нами, модель только заполняет.
const DOOR_MODELS := {
	"room": "res://assets/models/doors/door_room.glb",
	"flat": "res://assets/models/doors/door_flat.glb",
	"frame": "res://assets/models/doors/door_frame_only.glb",
	"broken": "res://assets/models/doors/door_broken.glb",
}
const DOOR_MODEL_W := {"room": 0.80, "flat": 0.90, "frame": 0.80, "broken": 0.80}
const WIN_MODELS := {
	"double": "res://assets/models/windows/window_double.glb",
	"broken": "res://assets/models/windows/window_broken.glb",
}
const WIN_MODEL_W := 1.70

var _asset_cache: Dictionary = {}
var _m_glass_shared: StandardMaterial3D = null
var _m_white_shared: StandardMaterial3D = null


func _asset(path: String) -> PackedScene:
	if not _asset_cache.has(path):
		_asset_cache[path] = load(path) if ResourceLoader.exists(path) else null
	return _asset_cache[path]


## Есть ли жилое помещение в этой точке. Лоджия для окна — «улица», поэтому
## считается отдельно: окно между комнатой и лоджией смотрит подоконником в
## комнату.
func _room_at(x: float, z: float, with_loggia: bool) -> bool:
	for room in _plan["rooms"]:
		if not with_loggia and String(room["kind"]) == "лоджия":
			continue
		for r in room["rects"]:
			if x > float(r[0]) and x < float(r[2]) 					and z > float(r[1]) and z < float(r[3]):
				return true
	return false


## Развернуть блок так, чтобы подоконник смотрел в помещение.
func _inward_yaw(cx: float, cz: float, along_z: bool) -> float:
	var probe := 0.45
	if along_z:                       # проём вытянут по Z, нормаль стены по X
		if _room_at(cx - probe, cz, false):
			return PI * 0.5
		return -PI * 0.5
	if _room_at(cx, cz - probe, false):
		return 0.0
	return PI


## Стёклам блока — свой прозрачный материал, иначе они непрозрачные.
func _take_glass(node: Node3D) -> void:
	for c in node.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		if mi.name.begins_with("glass"):
			mi.material_override = _m_glass_shared


## Что за дверь стоит в этом проёме — решается по соседям, а не по ширине.
## Ширина врёт: проём между комнатами 0.94 шире входного 0.88, и по ширине
## внутрь квартиры вставало входное полотно, обитое дерматином.
enum DoorRole { ROOM, ENTRANCE, BALCONY }


func _door_role(cx: float, cz: float, along_z: bool) -> DoorRole:
	var probe := 0.40
	var a := Vector2(cx - probe, cz) if along_z else Vector2(cx, cz - probe)
	var b := Vector2(cx + probe, cz) if along_z else Vector2(cx, cz + probe)
	if _kind_at(a.x, a.y) == "лоджия" or _kind_at(b.x, b.y) == "лоджия":
		return DoorRole.BALCONY
	# снаружи квартиры помещения нет — значит это выход на лестничную клетку
	if _kind_at(a.x, a.y) == "" or _kind_at(b.x, b.y) == "":
		return DoorRole.ENTRANCE
	return DoorRole.ROOM


func _kind_at(x: float, z: float) -> String:
	for room in _plan["rooms"]:
		for r in room["rects"]:
			if x > float(r[0]) and x < float(r[2]) 					and z > float(r[1]) and z < float(r[3]):
				return String(room["kind"])
	return ""


## Дверной блок в проём. Часть дверей в брошенном доме без полотна или сорвана;
## выбор детерминированный, по координате, иначе дом меняется между запусками.
func _door_asset(cx: float, cz: float, width: float, along_z: bool) -> bool:
	var role := _door_role(cx, cz, along_z)
	if role == DoorRole.BALCONY:
		return false                     # балконную рисую своим блоком со стеклом
	var kind := "flat" if role == DoorRole.ENTRANCE else "room"
	var seed_v := int(absf(cx) * 71.0 + absf(cz) * 131.0) % 100
	if role == DoorRole.ENTRANCE:
		pass                             # входную не срываем: она и держит квартиру
	elif seed_v < 16:
		kind = "frame"
	elif seed_v < 24:
		kind = "broken"
	var ps := _asset(DOOR_MODELS[kind])
	if ps == null:
		return false
	var node: Node3D = ps.instantiate()
	node.set_meta("opening", true)
	node.position = Vector3(cx, 0.0, cz)
	node.scale = Vector3(width / float(DOOR_MODEL_W[kind]), 1.0, 1.0)
	node.rotation.y = PI * 0.5 if along_z else 0.0
	add_child(node)
	# Двери приоткрыты: полотно — отдельный узел `leaf`, его начало координат
	# на оси петель, поэтому достаточно повернуть его вокруг Y. Угол и сторона
	# детерминированные, от координаты: иначе дом меняется между запусками.
	var leaf := node.find_child("leaf", true, false) as Node3D
	if leaf != null:
		var side := 1.0 if seed_v % 2 == 0 else -1.0
		var deg := 28.0 + float(seed_v % 17) * 1.6
		# Дверь санузла открывается наружу, в коридор: внутри ванной 1.34 x 1.63
		# и уборной 0.71 x 1.63 полотну просто некуда распахнуться.
		var probe := 0.40
		var a := _kind_at(cx - probe, cz) if along_z else _kind_at(cx, cz - probe)
		var b := _kind_at(cx + probe, cz) if along_z else _kind_at(cx, cz + probe)
		if a == "санузел" or b == "санузел":
			var out_dir: Vector3
			if along_z:
				out_dir = Vector3(1, 0, 0) if a == "санузел" else Vector3(-1, 0, 0)
			else:
				out_dir = Vector3(0, 0, 1) if a == "санузел" else Vector3(0, 0, -1)
			# Коридор узкий: прихожая всего 0.98 в чистоте, а полотно 0.63—0.71.
			# Распахнутая на 40° дверь перекрывает половину прохода и сверху
			# читается перегородкой — именно за неё её и принимали. Ограничиваю
			# угол так, чтобы полотно занимало не больше трети ширины коридора.
			var corridor := 0.98
			for room in _plan["rooms"]:
				if String(room["kind"]) != "прихожая":
					continue
				for rr in room["rects"]:
					var px := cx + out_dir.x * 0.5
					var pz := cz + out_dir.z * 0.5
					if px > float(rr[0]) and px < float(rr[2]) 							and pz > float(rr[1]) and pz < float(rr[3]):
						corridor = minf(float(rr[2]) - float(rr[0]),
								float(rr[3]) - float(rr[1]))
			var leaf_w := maxf(width, 0.5)
			var max_deg := rad_to_deg(asin(clampf(corridor * 0.33 / leaf_w, 0.1, 1.0)))
			deg = minf(deg, max_deg)
			leaf.rotation.y += deg_to_rad(deg) * side
			# куда уехал кончик полотна — туда и открылась дверь
			var tip := leaf.global_transform * Vector3(0.7, 1.0, 0.0)
			if (tip - Vector3(cx, 1.0, cz)).dot(out_dir) < 0.0:
				leaf.rotation.y -= deg_to_rad(deg) * side * 2.0
		else:
			leaf.rotation.y += deg_to_rad(deg) * side
	return true


## Оконный блок в проём. Пивот у модели на уровне подоконника.
func _window_asset(cx: float, cz: float, width: float, along_z: bool,
		sill: float) -> bool:
	if width < 0.9 or width > 2.3:
		return false
	var seed_v := int(absf(cx) * 53.0 + absf(cz) * 97.0) % 100
	var ps := _asset(WIN_MODELS["broken" if seed_v < 30 else "double"])
	if ps == null:
		return false
	var node: Node3D = ps.instantiate()
	node.set_meta("opening", true)
	node.position = Vector3(cx, sill, cz)
	node.scale = Vector3(width / WIN_MODEL_W, 1.0, 1.0)
	node.rotation.y = _inward_yaw(cx, cz, along_z)
	add_child(node)
	_take_glass(node)
	return true


# --- декали износа от houdini-assets ----------------------------------------
# Проекция задаётся в метрах (sizes.txt доставки), а не размером картинки.
# Узел Decal проецирует вдоль своего локального −Y, поэтому для стены базис
# строится от нормали, а «верх» картинки — от мирового верха.
const DECAL_DIR := "res://assets/decals/"
const DECAL_M := {
	"leak_ceiling": [1.20, 1.20, "1k"],
	"leak_wall": [0.60, 1.60, "512"],
	"mold_corner": [0.50, 0.50, "512"],
	"mold_seam": [0.80, 0.10, "512"],
	"furniture_ghost": [1.00, 1.80, "512"],
	"paper_peel": [0.60, 0.90, "512"],
	"debris_floor": [0.80, 0.40, "512"],
}


## spin: −1 — повернуть случайно (пятну всё равно), иначе угол в радианах
## вокруг оси проекции. У декали длинная сторона идёт по локальному Z, что для
## пола означает мировую Z; поворот на 90° кладёт её вдоль X.
func _decal(kind: String, pos: Vector3, normal: Vector3, scale_: float = 1.0,
		spin := -1.0, tint := Color(1, 1, 1)) -> void:
	var m: Array = DECAL_M.get(kind, [])
	if m.is_empty():
		return
	var alb := "%s%s_albedo_%s.png" % [DECAL_DIR, kind, m[2]]
	if not ResourceLoader.exists(alb):
		return
	var d := Decal.new()
	d.texture_albedo = load(alb)
	var nrm := "%s%s_normal_%s.png" % [DECAL_DIR, kind, m[2]]
	if ResourceLoader.exists(nrm):
		d.texture_normal = load(nrm)
	d.size = Vector3(float(m[0]) * scale_, 0.30, float(m[1]) * scale_)
	d.albedo_mix = 1.0
	d.modulate = tint
	d.normal_fade = 0.4
	# Кромка декали не должна читаться штампом: гасим её к краю проекции и по
	# наклону поверхности. У вытертостей смешивание слабее — это грязь в порах,
	# а не наклейка.
	d.upper_fade = 1.2
	d.lower_fade = 1.2
	var yv := -normal.normalized()
	var xv := Vector3.UP.cross(yv)
	if xv.length() < 0.01:
		xv = Vector3.RIGHT
	xv = xv.normalized()
	var zv := yv.cross(xv).normalized()
	# Одна и та же декаль в двух местах не должна читаться копией. Пятну на
	# полу и на потолке можно крутить как угодно, потёку и плесени — нет:
	# у них есть верх. Поэтому на стенах только зеркалю и слегка меняю размер,
	# а полные обороты оставляю горизонтальным.
	var seed_v := absf(pos.x) * 37.0 + absf(pos.z) * 91.0 + absf(pos.y) * 13.0
	var r1 := fposmod(sin(seed_v) * 43758.5453, 1.0)
	var r2 := fposmod(sin(seed_v + 1.7) * 43758.5453, 1.0)
	var b := Basis(xv, yv, zv)
	if spin >= 0.0:
		b = b.rotated(yv, spin)
	elif absf(normal.y) > 0.5:
		b = b.rotated(yv, r1 * TAU)
	elif r1 < 0.5:
		b = Basis(-xv, yv, -zv)          # зеркально, верх на месте
	d.transform = Transform3D(b, pos)
	d.size *= 1.0 + (r2 - 0.5) * 0.24
	add_child(d)


# --- предметы: сантехника, шторы, мебель ------------------------------------
# У всех моделей от houdini-assets ноль в середине низа, лицо смотрит в −Z.
# Поэтому «поставить к стене» — это развернуть модель так, чтобы её +Z
# указывал на стену, а «поставить в проём» — довернуть на комнату.
const FIXTURE_MODELS := {
	"ванна": "res://assets/models/fixtures/bathtub.glb",
	"унитаз": "res://assets/models/fixtures/toilet.glb",
	"раковина": "res://assets/models/fixtures/washbasin.glb",
	"мойка": "res://assets/models/fixtures/kitchen_sink.glb",
	"плита": "res://assets/models/fixtures/stove.glb",
}


## Куда смотрит ближайшая стена от точки: пробуем четыре стороны и берём ту,
## где помещения уже нет.
func _wall_dir(x: float, z: float, reach: float,
		dirs: Array = []) -> Vector3:
	# Ищем БЛИЖАЙШУЮ стену среди разрешённых направлений. Без ограничения
	# по осям «ближайшая» может оказаться боковой стеной, в которую прибор
	# физически не влезает глубиной, — так унитаз в уборной 0.71 x 1.63
	# однажды развернуло на 90° и он торчал в ширину, а не в длину комнаты.
	var candidates := dirs
	if candidates.is_empty():
		candidates = [Vector3(0, 0, 1), Vector3(0, 0, -1),
				Vector3(1, 0, 0), Vector3(-1, 0, 0)]
	var best: Vector3 = candidates[0]
	var best_d := 1e9
	for dir_ in candidates:
		var t := 0.05
		while t < reach + 1.2:
			if _kind_at(x + dir_.x * t, z + dir_.z * t) == "":
				break
			t += 0.05
		if t < best_d:
			best_d = t
			best = dir_
	return best


func _place(path: String, pos: Vector3, yaw: float,
		scale_x := 1.0) -> Node3D:
	if not ResourceLoader.exists(path):
		return null
	var node: Node3D = (load(path) as PackedScene).instantiate()
	node.position = pos
	node.rotation.y = yaw
	if not is_equal_approx(scale_x, 1.0):
		node.scale.x = scale_x
	add_child(node)
	return node


## Коробка столкновений по габариту модели. Для того, что вставлено в проём,
## не вызывается: там габарит накрывает пустоту, и дверь стала бы стеной.
func _solidify(node: Node3D, shrink := 0.04) -> void:
	if node == null or node.has_meta("opening"):
		return
	var box := AABB()
	var first := true
	for c in node.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		var a := mi.global_transform * mi.get_aabb()
		box = a if first else box.merge(a)
		first = false
	if first or box.size.x < 0.06 or box.size.z < 0.06:
		return
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(maxf(box.size.x - shrink, 0.05), box.size.y,
			maxf(box.size.z - shrink, 0.05))
	shape.shape = bs
	body.add_child(shape)
	add_child(body)
	body.global_position = box.position + box.size * 0.5


## Сантехника и плита по своим местам из разбора плана.
func _fixtures() -> bool:
	var any := false
	for fx in _plan.get("fixtures", []):
		var kind := String(fx["kind"])
		var path: String = FIXTURE_MODELS.get(kind, "")
		if path == "" or not ResourceLoader.exists(path):
			continue
		var r: Array = fx["r"]
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		var half: float = maxf(float(r[2]) - float(r[0]),
				float(r[3]) - float(r[1])) * 0.5 + 0.12
		# Прибор глубже, чем короткая сторона узкого помещения (унитаз 0.78
		# при уборной шириной 0.71), поэтому вставать он может только вдоль
		# ДЛИННОЙ оси собственного пятна на плане — она и задаёт, какая
		# пара стен вообще подходит. По площади искать нельзя: пятно почти
		# квадратное (0.45 x 0.50), а разница осей всё равно верно указывает
		# направление, потому что она снята с реальных размеров на скане.
		var fw: float = float(r[2]) - float(r[0])
		var fd: float = float(r[3]) - float(r[1])
		var axis_dirs: Array = []
		if fd > fw + 0.02:
			axis_dirs = [Vector3(0, 0, 1), Vector3(0, 0, -1)]
		elif fw > fd + 0.02:
			axis_dirs = [Vector3(1, 0, 0), Vector3(-1, 0, 0)]
		var wd := _wall_dir(cx, cz, half, axis_dirs)
		# модель смотрит лицом в −Z, значит спиной к стене — это +Z на стену
		var fx_node := _place(path, Vector3(cx, 0.0, cz), atan2(wd.x, wd.z))
		if fx_node != null:
			any = true
			_solidify(fx_node)
	return any


## Шторы в оконные проёмы. Пивот модели — середина верха проёма, комната со
## стороны −Z, поэтому доворачиваем на ту сторону, где помещение.
const CURTAIN_DIR := "res://assets/models/curtains/"
const CURTAIN_W := 1.70


func _curtains() -> void:
	var lintel: float = _plan["lintel"]
	for r in _plan.get("windows", []):
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		var width := maxf(w, d)
		var thick := minf(w, d)
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		var along_z := w <= d
		# в какую сторону комната
		var probe := thick * 0.5 + 0.3
		var inside := Vector3(-1, 0, 0) if along_z else Vector3(0, 0, -1)
		if _kind_at(cx - inside.x * probe, cz - inside.z * probe) != "":
			inside = -inside
		var seed_v := int(absf(cx) * 41.0 + absf(cz) * 89.0) % 100
		var kind := "curtain_pair"
		if _kind_at(cx + inside.x * probe, cz + inside.z * probe) == "кухня":
			kind = "curtain_half"
		elif seed_v < 22:
			kind = "curtain_torn"
		elif seed_v < 44:
			kind = "curtain_tulle"
		var yaw := atan2(-inside.x, -inside.z)
		# Подоконник выступает в комнату: у оконного блока габарит по толщине
		# 0.48 при стене 0.34, то есть примерно 0.07 наружу и 0.07 внутрь.
		# Штора вешается перед ним, иначе полотнище проходит сквозь доску.
		# Модель собрана от внутренней грани стены: карниз и ткань целиком лежат
		# в комнате, в стену ничего не заходит. Мой прежний сдвиг 0.14 отрывал
		# карниз от стены, а ткань уезжала ещё дальше.
		var sill_out := -0.04
		var pos := Vector3(cx + inside.x * (thick * 0.5 + sill_out), lintel,
				cz + inside.z * (thick * 0.5 + sill_out))
		# В моделях штор карниз уже есть внутри. Отдельный ставился сверху,
		# и получалось два карниза: полотно висело на своём, а над ним торчал
		# лишний — из-за этого казалось, что шторы не на карнизе.
		# чуть шире проёма: полотнище должно перекрывать откосы, иначе по краям
		# видны щели и штора кажется отставшей от окна
		var k := width / CURTAIN_W * 1.08
		_place(CURTAIN_DIR + kind + ".glb", pos, yaw, k)


# --- мебель ------------------------------------------------------------------
# Модели от houdini-assets (task-0015): ноль в середине низа, лицо в −Z.
# Расстановка считается от плана, а не забита координатами: батарея под окном,
# кухонный ряд вдоль стены с мойкой и плитой, шкаф в большой комнате у глухой
# стены, патрон под лампу — там же, где стоит источник света.
const FURN := "res://assets/models/furniture/"


## Занят ли участок пола проёмом: под окном батарея нужна, а в дверь мебель
## ставить нельзя.
func _blocked(x: float, z: float, r: float) -> bool:
	for o in _plan.get("door_openings", []):
		if x > float(o[0]) - r and x < float(o[2]) + r 				and z > float(o[1]) - r and z < float(o[3]) + r:
			return true
	return false


## Габарит модели по её AABB — не число, вписанное в код руками (шкаф один
## раз разошёлся с реальностью на треть: в коде стояло 0.45, по факту 0.616,
## и угол лез в проём). body_only исключает узлы door*/drawer* — открытая
## дверца или выдвинутый ящик не в счёт для отступа от стены, только для
## габарита вдоль стены (сам _place_at_wall берёт под каждое отдельно).
static var _fp_cache: Dictionary = {}

func _footprint(path: String, body_only: bool) -> Vector2:
	var key := path + ("#body" if body_only else "#full")
	if _fp_cache.has(key):
		return _fp_cache[key]
	var fp := Vector2.ZERO
	if ResourceLoader.exists(path):
		var node: Node3D = (load(path) as PackedScene).instantiate()
		add_child(node)
		var whole := AABB()
		var first := true
		for mi in node.find_children("*", "MeshInstance3D", true, false):
			var nm := String(mi.name).to_lower()
			if body_only and (nm.begins_with("door") or nm.begins_with("drawer")):
				continue
			var m := mi as MeshInstance3D
			var a: AABB = m.global_transform * m.get_aabb()
			whole = a if first else whole.merge(a)
			first = false
		if not first:
			fp = Vector2(whole.size.x, whole.size.z)
		node.queue_free()
	_fp_cache[key] = fp
	return fp


## Ставит модель к одной из четырёх стен помещения — задом (узлы door*/
## drawer* не в счёт), лицом в комнату, конвенция «низ в нуле, лицо в −Z»
## для всех принятых моделей. Сама измеряет модель и сама сканирует стену
## в поисках места, свободного от дверных проёмов — числа не вписываются
## руками под конкретную комнату. room — [x0,z0,x1,z1], wall — "x0"/"x1"/
## "z0"/"z1". margin0/margin1 — что оставить у краёв стены (под окно,
## под соседний предмет), step — шаг сканирования.
func _place_at_wall(path: String, room: Array, wall: String,
		margin0 := 0.1, margin1 := 0.1, step := 0.05) -> Node3D:
	var x0: float = float(room[0])
	var z0: float = float(room[1])
	var x1: float = float(room[2])
	var z1: float = float(room[3])
	var body := _footprint(path, true)
	var full := _footprint(path, false)
	if body == Vector2.ZERO:
		return null
	var along_x := wall == "z0" or wall == "z1"
	var a0: float = x0 if along_x else z0
	var a1: float = x1 if along_x else z1
	var half_along: float = full.x * 0.5 if along_x else full.y * 0.5
	var depth: float = body.y if along_x else body.x
	var face: float
	var inward: float
	var yaw: float
	match wall:
		"x0": face = x0; inward = 1.0; yaw = -PI * 0.5
		"x1": face = x1; inward = -1.0; yaw = PI * 0.5
		"z0": face = z0; inward = 1.0; yaw = PI
		"z1": face = z1; inward = -1.0; yaw = 0.0
		_: return null
	var lo := a0 + margin0 + half_along
	var hi := a1 - margin1 - half_along
	if lo > hi:
		return null
	var best_a := -1e9
	var best_margin := -1.0
	var a := lo
	while a <= hi + 0.001:
		var px := a if along_x else face + inward * depth
		var pz := face + inward * depth if along_x else a
		# +0.05 — общий зазор поверх точного измерения, не впритык: у шкафа
		# ровно измеренная полуширина однажды оставила зазор в 5 мм.
		if not _blocked(px, pz, half_along + 0.05):
			var m := minf(a - lo, hi - a)
			if m > best_margin:
				best_margin = m
				best_a = a
		a += step
	if best_a < -1e8:
		return null
	var pos := Vector3(best_a, 0.0, face + inward * depth * 0.5) if along_x \
			else Vector3(face + inward * depth * 0.5, 0.0, best_a)
	return _place(path, pos, yaw)


func _furniture() -> void:
	var h: float = _plan["wall_h"]

	# Батарея под каждым окном, спиной к стене, на высоте 0.12 от пола.
	for r in _plan.get("windows", []):
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		var along_z := w <= d
		var probe := minf(w, d) * 0.5 + 0.35
		var inside := Vector3(-1, 0, 0) if along_z else Vector3(0, 0, -1)
		if _kind_at(cx - inside.x * probe, cz - inside.z * probe) != "":
			inside = -inside
		if _kind_at(cx + inside.x * probe, cz + inside.z * probe) == "лоджия":
			continue
		var pos := Vector3(cx + inside.x * (minf(w, d) * 0.5 + 0.09), 0.12,
				cz + inside.z * (minf(w, d) * 0.5 + 0.09))
		_solidify(_place(FURN + "radiator.glb", pos, atan2(-inside.x, -inside.z)))

	# Патрон с проводом под потолком там же, где лампа.
	for room in _plan["rooms"]:
		if String(room["kind"]) == "лоджия":
			continue
		for r in room["rects"]:
			var w: float = float(r[2]) - float(r[0])
			var d: float = float(r[3]) - float(r[1])
			# Порог — тот же 0.5, что у самого источника света (_room_lights):
			# были разные (0.9 у патрона, 0.5 у света), и в узких помещениях
			# свет был, а патрона над ним — нет, светило неизвестно откуда.
			if w < 0.5 or d < 0.5:
				continue
			# Пивот модели — у потолка (верх AABB на Y=0, замерено --probe),
			# патрон с проводом свисает вниз сам. h − 0.56 сажал пивот на
			# 0.56 м НИЖЕ потолка — весь патрон повисал в воздухе с зазором.
			var lamp_node := _place(FURN + "ceiling_lamp.glb",
					Vector3((float(r[0]) + float(r[2])) * 0.5, h,
							(float(r[1]) + float(r[3])) * 0.5), 0.0)
			if lamp_node != null:
				# Патрон висит ниже источника и закрывал его собой: по полу шёл
				# тёмный круг во всю комнату. Голая лампочка такой тени не даёт.
				for c in lamp_node.find_children("*", "MeshInstance3D", true, false):
					(c as MeshInstance3D).cast_shadow = 							GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	# Кухонный ряд: тумбы вдоль той же стены, у которой стоят мойка и плита,
	# и навесные шкафы над ними на 1.45.
	var sink := Vector3.ZERO
	var stove := Vector3.ZERO
	for fx in _plan.get("fixtures", []):
		var rr: Array = fx["r"]
		var c := Vector3((float(rr[0]) + float(rr[2])) * 0.5, 0.0,
				(float(rr[1]) + float(rr[3])) * 0.5)
		if String(fx["kind"]) == "мойка":
			sink = c
		elif String(fx["kind"]) == "плита":
			stove = c
	if sink != Vector3.ZERO and stove != Vector3.ZERO:
		var wd := _wall_dir(sink.x, sink.z, 0.45)
		var yaw := atan2(wd.x, wd.z)
		# Между мойкой и плитой зазор всего 0.16 м — модулю 0.60 там не встать.
		# Свободная стена — за плитой, в глухом углу кухни: продолжаем ряд в ту
		# же сторону, куда «along» уже смотрит от мойки к плите, и идём дальше
		# за неё, пока следующий модуль целиком помещается в кухню.
		var along := (stove - sink)
		along.y = 0.0
		if along.length() > 0.01:
			along = along.normalized()
		else:
			along = Vector3(0, 0, -1)
		var placed := 0
		while placed < 4:
			var pos: Vector3 = stove + along * (0.31 + 0.62 * float(placed))
			var far: Vector3 = pos + along * 0.31
			if _kind_at(pos.x, pos.z) != "кухня" or _kind_at(far.x, far.z) != "кухня":
				break
			_solidify(_place(FURN + "kitchen_counter.glb",
					Vector3(pos.x, 0.0, pos.z), yaw))
			_place(FURN + "kitchen_upper.glb", Vector3(pos.x, 1.45, pos.z), yaw)
			placed += 1
	# Стол, стулья и холодильник — в кухне. Холодильник у свободной стены,
	# напротив рабочего ряда (сама сдача так просила), стена определяется
	# от направления к стене мойки (wd), а не подбором координат под эту
	# квартиру. Мойку и плиту ищем в границах ИМЕННО этой комнаты — общий
	# поиск по всем fixtures путал кухни двух квартир между собой.
	for room in _plan["rooms"]:
		if String(room["kind"]) != "кухня":
			continue
		for r in room["rects"]:
			var x0: float = float(r[0])
			var z0: float = float(r[1])
			var x1: float = float(r[2])
			var z1: float = float(r[3])
			var rsink := Vector3.ZERO
			for fx in _plan.get("fixtures", []):
				if String(fx["kind"]) != "мойка":
					continue
				var rr: Array = fx["r"]
				var c := Vector3((float(rr[0]) + float(rr[2])) * 0.5, 0.0,
						(float(rr[1]) + float(rr[3])) * 0.5)
				if c.x > x0 and c.x < x1 and c.z > z0 and c.z < z1:
					rsink = c
					break
			if rsink != Vector3.ZERO:
				var rwd := _wall_dir(rsink.x, rsink.z, 0.45)
				var free_wall := "x0"
				if rwd.x > 0.5:
					free_wall = "x0"
				elif rwd.x < -0.5:
					free_wall = "x1"
				elif rwd.z > 0.5:
					free_wall = "z0"
				else:
					free_wall = "z1"
				_solidify(_place_at_wall(FURN + "fridge.glb", r, free_wall, 0.15, 0.15))
			if x1 - x0 < 1.6 or z1 - z0 < 1.6:
				continue
			var cx := (x0 + x1) * 0.5
			var cz := (z0 + z1) * 0.5
			_solidify(_place(FURN + "kitchen_table.glb", Vector3(cx, 0.0, cz), 0.0))
			var tfp := _footprint(FURN + "kitchen_table.glb", true)
			var half_d: float = tfp.y * 0.5 + 0.05
			if _kind_at(cx, cz - half_d) == "кухня":
				_solidify(_place(FURN + "kitchen_chair.glb", Vector3(cx, 0.0, cz - half_d), PI))
			if _kind_at(cx, cz + half_d) == "кухня":
				_solidify(_place(FURN + "kitchen_chair.glb", Vector3(cx, 0.0, cz + half_d), 0.0))

	# Жилая: шкаф у короткой стены без окна (z1), кровать изголовьем к
	# длинной стене без окна (x0), тумбочка у изножья, комод у
	# противоположной длинной стены (x1). Всё — через общий поиск места
	# у стены: он сам измеряет модель и сам избегает дверных проёмов,
	# никаких чисел под конкретную комнату.
	for room in _plan["rooms"]:
		if String(room["kind"]) != "жилая":
			continue
		for r in room["rects"]:
			var x0: float = float(r[0])
			var x1: float = float(r[2])
			var z0: float = float(r[1])
			var z1: float = float(r[3])
			_solidify(_place_at_wall(FURN + "wardrobe.glb", r, "z1", 0.1, 0.1))
			var bed_path := FURN + (
					"bed_double.glb" if (x1 - x0) * (z1 - z0) > 17.0 else "bed_single.glb")
			var bed := _place_at_wall(bed_path, r, "x0", 0.1, 0.9)
			_solidify(bed)
			if bed != null:
				var bed_far: float = bed.position.z - z0 \
						+ _footprint(bed_path, false).y * 0.5 + 0.15
				_solidify(_place_at_wall(FURN + "nightstand.glb", r, "x0", bed_far, 0.1))
			_solidify(_place_at_wall(FURN + "dresser.glb", r, "x1", 0.1, 0.9))


# --- бумага на стенах (task-0019 от comfyui) --------------------------------
# Следы людей: то, что повесили и бросили. Кладётся декалью на стену, размер
# проекции — из RESULT доставки, в метрах.
const PAPER := "res://assets/decals/paper/"
const PAPER_M := {
	"poster_torn": [0.90, "1k"], "wallpaper_patch": [0.60, "1k"],
	"calendar": [0.40, "512"], "child_drawing": [0.40, "512"],
	"newspaper_scrap": [0.70, "512"], "photo_frame_mark": [0.35, "512"],
	"switch_grime": [0.25, "512"], "door_number": [0.20, "512"],
}


func _paper_decal(kind: String, pos: Vector3, normal: Vector3) -> void:
	var m: Array = PAPER_M.get(kind, [])
	if m.is_empty():
		return
	# не вешаем над проёмами: там и так перемычка, и лист читается заплаткой
	for o in _plan.get("door_openings", []):
		var ox: float = clampf(pos.x, float(o[0]) - 0.55, float(o[2]) + 0.55)
		var oz: float = clampf(pos.z, float(o[1]) - 0.55, float(o[3]) + 0.55)
		if absf(ox - pos.x) < 0.001 and absf(oz - pos.z) < 0.001:
			return
	var alb := "%s%s_albedo_%s.png" % [PAPER, kind, m[1]]
	if not ResourceLoader.exists(alb):
		return
	var d := Decal.new()
	d.texture_albedo = load(alb)
	d.size = Vector3(float(m[0]), 0.25, float(m[0]))
	# Бумага не должна читаться наклейкой: смешиваем не в полную силу и гасим
	# к краю проекции. Особенно это про светлый след от снятого шкафа — у него
	# ровная граница, и в полную силу он выглядит приклеенным листом.
	d.albedo_mix = 0.62 if kind == "furniture_ghost" else 0.8
	d.upper_fade = 2.2
	d.lower_fade = 2.2
	var yv := -normal.normalized()
	var xv := Vector3.UP.cross(yv)
	if xv.length() < 0.01:
		xv = Vector3.RIGHT
	xv = xv.normalized()
	d.transform = Transform3D(Basis(xv, yv, yv.cross(xv).normalized()), pos)
	add_child(d)


## По две-три бумажки на комнату, на разные стены и на разной высоте: пачкой в
## одном месте они читаются коллажем, а не следом жизни.
func _paper() -> void:
	var lintel: float = _plan["lintel"]
	var i := 0
	var plan := ["poster_torn", "calendar", "child_drawing", "newspaper_scrap",
			"photo_frame_mark", "wallpaper_patch"]
	for room in _plan["rooms"]:
		var kind := String(room["kind"])
		if kind != "жилая" and kind != "кухня" and kind != "прихожая":
			continue
		for r in room["rects"]:
			var x0: float = float(r[0])
			var z0: float = float(r[1])
			var x1: float = float(r[2])
			var z1: float = float(r[3])
			if x1 - x0 < 1.2 or z1 - z0 < 1.2:
				continue
			# на дальней стене повыше, на боковой пониже
			_paper_decal(plan[i % plan.size()],
					Vector3(x0 + (x1 - x0) * 0.35, lintel - 0.75, z0 + 0.02),
					Vector3(0, 0, 1))
			i += 1
			_paper_decal(plan[i % plan.size()],
					Vector3(x0 + 0.02, 1.45, z0 + (z1 - z0) * 0.62),
					Vector3(1, 0, 0))
			i += 1
			# засаленное пятно у выключателя — всегда у входа, на 1.40
			_paper_decal("switch_grime",
					Vector3(x0 + 0.02, 1.40, z1 - 0.35), Vector3(1, 0, 0))


## Где что лежит. Расстановка считается от прямоугольников помещений, а не
## забита координатами: зеркальная квартира получает то же самое сама.
func _decals() -> void:
	if OS.get_cmdline_user_args().has("--bare"):
		return
	_paper()
	var lintel: float = _plan["lintel"]
	for room in _plan["rooms"]:
		var kind := String(room["kind"])
		for r in room["rects"]:
			var x0: float = float(r[0])
			var z0: float = float(r[1])
			var x1: float = float(r[2])
			var z1: float = float(r[3])
			var w := x1 - x0
			var dp := z1 - z0
			if w < 0.6 or dp < 0.6:
				continue
			match kind:
				"санузел":
					# плесень из обоих нижних углов и полоса по шву плитки
					_decal("mold_corner", Vector3(x0 + 0.02, 0.32, z0 + 0.30),
							Vector3(1, 0, 0), 0.9)
					_decal("mold_corner", Vector3(x1 - 0.02, 0.28, z1 - 0.30),
							Vector3(-1, 0, 0), 0.9)
					_decal("mold_seam", Vector3(x0 + 0.02, 0.95, (z0 + z1) * 0.5),
							Vector3(1, 0, 0), 1.0)
				"жилая":
					# потёк по стене сверху и светлый след от снятого шкафа
					_decal("leak_wall", Vector3(x1 - 0.02, lintel - 0.55,
							z0 + dp * 0.28), Vector3(-1, 0, 0), 1.0)
					_decal("furniture_ghost", Vector3(x0 + 0.02, 0.95,
							z0 + dp * 0.62), Vector3(1, 0, 0), 1.0)
					_decal("paper_peel", Vector3(x0 + w * 0.35, lintel - 0.35,
							z1 - 0.02), Vector3(0, 0, -1), 1.0)
					_decal("debris_floor", Vector3(x0 + w * 0.7, 0.05,
							z1 - 0.28), Vector3(0, -1, 0), 1.0)
				"кухня":
					_decal("leak_wall", Vector3(x0 + 0.02, lintel - 0.75,
							z0 + dp * 0.5), Vector3(1, 0, 0), 0.9)
					_decal("debris_floor", Vector3(x0 + w * 0.5, 0.05,
							z1 - 0.25), Vector3(0, -1, 0), 1.0)


## Размер тайла берётся из tiles.txt доставки, а не из кода: исполнитель
## сдаёт его вместе с набором, и число не должно жить в двух местах.
const TILES_TXT := "res://assets/textures/tiles.txt"

static var _tiles: Dictionary = {}


func _tile_m(name: String, fallback: float) -> float:
	if _tiles.is_empty():
		var f := FileAccess.open(TILES_TXT, FileAccess.READ)
		if f != null:
			while not f.eof_reached():
				var parts := f.get_line().strip_edges().split(" ", false)
				if parts.size() >= 2 and parts[1].is_valid_float():
					_tiles[parts[0]] = parts[1].to_float()
			f.close()
	return float(_tiles.get(name, fallback))


# --- материал без видимой повторяемости --------------------------------------
# Тайл читается тайлом по трём причинам сразу: видна сетка стыков, видно
# «поле» одинаковой светлоты и видно, что все паркетины одного цвета. Шейдер
# бьёт все три: стохастическая выборка по треугольной решётке убирает сетку,
# макро-вариация с шагом 7.3 м (не кратным тайлу) ломает поле, карта id —
# если она есть в наборе — красит каждую планку в свой оттенок.
## Средний цвет линолеума, замерен по albedo: относительно него глушится
## рисунок, иначе понижение контраста утащило бы всё в серый.
const LINO_BASE := Color(0.466, 0.445, 0.413)
const ANTITILE := "res://assets/shaders/antitile.gdshader"

static var _antitile_shader: Shader = null


func _tex_st(dir_: String, base: String, tile_m: float,
		tint: Color = Color(1, 1, 1), macro := 0.09,
		snap := 0, rough_mul := 1.0, contrast := 1.0,
		base_col := Color(0.5, 0.5, 0.5), stoch := true,
		mono := 0.0, wear_pts: Array = [],
		wear_strength := 0.0, wear_radius := 1.0) -> ShaderMaterial:
	if _antitile_shader == null:
		_antitile_shader = load(ANTITILE)
	var root := "res://assets/textures/%s/%s" % [dir_, base]
	var m := ShaderMaterial.new()
	m.shader = _antitile_shader
	m.set_shader_parameter("tex_albedo", load(root + "_albedo_1k.png"))
	var nrm := root + "_normal_1k.png"
	if ResourceLoader.exists(nrm):
		m.set_shader_parameter("tex_normal", load(nrm))
	var orm := root + "_orm_1k.png"
	if ResourceLoader.exists(orm):
		m.set_shader_parameter("tex_orm", load(orm))
	# карта id: у набора её может не быть — тогда пере-окраска выключена
	var idm := root + "_id_1k.png"
	if ResourceLoader.exists(idm):
		m.set_shader_parameter("tex_id", load(idm))
		m.set_shader_parameter("use_id", true)
	m.set_shader_parameter("tile_m", tile_m)
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("macro_value", macro)
	m.set_shader_parameter("snap_cells", snap)
	m.set_shader_parameter("roughness_mul", rough_mul)
	m.set_shader_parameter("use_stochastic", stoch)
	m.set_shader_parameter("contrast", contrast)
	m.set_shader_parameter("mono_patch", mono)
	m.set_shader_parameter("base_col", base_col)
	# Маска шва (task-0033): если исполнитель уже прислал <набор>_seam_1k.png —
	# включаем сами, без правки вызовов на местах.
	var seam := root + "_seam_1k.png"
	if ResourceLoader.exists(seam):
		m.set_shader_parameter("tex_seam", load(seam))
		m.set_shader_parameter("use_seam", true)
	# Потёртость у порогов и рабочих мест: точки в мировых XZ, а не декаль —
	# декаль без tint красит своим цветом (см. правку), а маска по мировой
	# позиции всегда та же текстура, только обесцвеченная.
	if wear_strength > 0.0 and not wear_pts.is_empty():
		m.set_shader_parameter("wear_count", wear_pts.size())
		m.set_shader_parameter("wear_pos", wear_pts)
		m.set_shader_parameter("wear_radius", wear_radius)
		m.set_shader_parameter("wear_strength", wear_strength)
	return m


## Точки износа по геометрии плана: порог/центр помещения данного вида.
## Длинные отрезки (коридор прихожей) получают две точки вдоль длинной оси
## вместо одной — иначе пятно накрывает только середину, а концы остаются
## нетронутыми.
func _wear_points(kind: String) -> Array:
	var pts: Array = []
	for room in _plan["rooms"]:
		if String(room["kind"]) != kind:
			continue
		for r in room["rects"]:
			var x0: float = float(r[0])
			var z0: float = float(r[1])
			var x1: float = float(r[2])
			var z1: float = float(r[3])
			var w := x1 - x0
			var d := z1 - z0
			if w < 0.6 or d < 0.6:
				continue
			if maxf(w, d) > 2.2:
				var along_x := w > d
				var a0 := x0 if along_x else z0
				var a1 := x1 if along_x else z1
				var other := (z0 + z1) * 0.5 if along_x else (x0 + x1) * 0.5
				for f in [0.3, 0.7]:
					var a := lerpf(a0, a1, f)
					pts.append(Vector2(a, other) if along_x else Vector2(other, a))
			else:
				pts.append(Vector2((x0 + x1) * 0.5, (z0 + z1) * 0.5))
	return pts


## Точки износа у каждого дверного проёма, ведущего в помещение данного вида —
## для больших комнат (жилая), где след от хождения у самой двери, а не
## по центру всей комнаты, как в _wear_points().
func _wear_points_doors(kind: String) -> Array:
	var pts: Array = []
	for r in _plan.get("door_openings", []):
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		var along_x := w > d
		var off := 0.35
		for sign_ in [1.0, -1.0]:
			var ix: float = cx + (0.0 if along_x else off * sign_)
			var iz: float = cz + (off * sign_ if along_x else 0.0)
			if _kind_at(ix, iz) == kind:
				pts.append(Vector2(ix, iz))
	return pts


## Отделка одной комнаты: по тонкой панели на каждую из четырёх внутренних
## граней, разрезанной проёмами. Над дверью панель есть — там бетон остаётся
## только снаружи; в самом проёме её нет, иначе она перекроет дверной блок.
## top_h > 0 — где отделка обрывается и дальше до потолка идёт побелка
## (mat_top): в советской квартире и обои, и краска редко доходили до
## потолка, наверху штукатурка на побелке.
func _room_skin(r: Array, mat: Material, h: float, door_h: float,
		holes: Array, mat_top: Material = null, top_h := -1.0) -> void:
	var t := 0.02
	var x0: float = float(r[0])
	var z0: float = float(r[1])
	var x1: float = float(r[2])
	var z1: float = float(r[3])
	var sides := [
		[true, z0, 1.0], [true, z1, -1.0],
		[false, x0, 1.0], [false, x1, -1.0],
	]
	for sd in sides:
		var along_x: bool = sd[0]
		var face: float = sd[1]
		var inward: float = sd[2]
		var a0 := x0 if along_x else z0
		var a1 := x1 if along_x else z1
		# Проёмы: там отделки нет, но над дверью есть.
		var cuts: Array = []
		for o in holes:
			var oa0: float = float(o[0]) if along_x else float(o[1])
			var oa1: float = float(o[2]) if along_x else float(o[3])
			var ob0: float = float(o[1]) if along_x else float(o[0])
			var ob1: float = float(o[3]) if along_x else float(o[2])
			# Ось проёма снята со скана и может не совпадать с зазором между
			# блоками на несколько сантиметров: у двери кухни расхождение 0.07,
			# и с жёстким допуском отделка вставала прямо в проходе. Допуск
			# берём с запасом на толщину стены.
			if face < ob0 - 0.15 or face > ob1 + 0.15:
				continue
			var c0 := maxf(oa0, a0)
			var c1 := minf(oa1, a1)
			if c1 - c0 > 0.02:
				cuts.append([c0, c1, true])
		# Открытые участки: за гранью тоже помещение, значит стены там нет.
		# Г-образная прихожая — два прямоугольника, и по их общей границе
		# отделка вырастала перегородкой поперёк коридора.
		# Проба ставится СНАРУЖИ грани: inward смотрит внутрь помещения, поэтому
		# для проверки «есть ли там стена» надо шагнуть в противоположную
		# сторону. И признак «участок начался» — отдельный флаг, а не
		# отрицательная координата: координаты здесь сами отрицательные, и
		# сторожевое значение −1.0 совпадало с обычным X, из-за чего ни один
		# открытый участок не вырезался и отделка вставала поперёк коридора.
		var step := 0.10
		var open_from := 0.0
		var open_run := false
		var a := a0
		while a <= a1 + 0.001:
			var px := (a if along_x else face - inward * 0.07)
			var pz := (face - inward * 0.07 if along_x else a)
			var is_open := _kind_at(px, pz) != ""
			if is_open and not open_run:
				open_from = a
				open_run = true
			elif not is_open and open_run:
				cuts.append([open_from - step, a, false])
				open_run = false
			a += step
		if open_run:
			cuts.append([open_from - step, a1, false])
		cuts.sort_custom(func(p, q): return float(p[0]) < float(q[0]))

		if OS.get_cmdline_user_args().has("--hall"):
			var mid := (a0 + a1) * 0.5
			var qx := mid if along_x else face + inward * 0.07
			var qz := face + inward * 0.07 if along_x else mid
			if _kind_at(qx, qz) == "прихожая":
				print("[шкура] грань %.2f вдоль %s, %.2f..%.2f, проба (%.2f, %.2f) = %s, кусков %d"
						% [face, "X" if along_x else "Z", a0, a1, qx, qz,
								_kind_at(qx, qz), cuts.size()])
		var cur := a0
		for c in cuts:
			_skin_band(along_x, face, inward, cur, float(c[0]), 0.0, h, t,
					mat, mat_top, top_h)
			if bool(c[2]):
				_skin_band(along_x, face, inward, float(c[0]), float(c[1]),
						door_h, h, t, mat, mat_top, top_h)
			cur = maxf(cur, float(c[1]))
		_skin_band(along_x, face, inward, cur, a1, 0.0, h, t, mat, mat_top, top_h)


## Обёртка над _skin_piece: если top_h попадает внутрь y0..y1, режет панель
## на две — обои/краску снизу и побелку сверху — вместо одной на всю высоту.
func _skin_band(along_x: bool, face: float, inward: float, a0: float, a1: float,
		y0: float, y1: float, t: float, mat: Material, mat_top: Material,
		top_h: float) -> void:
	if mat_top == null or top_h <= y0 or top_h >= y1:
		_skin_piece(along_x, face, inward, a0, a1, y0, y1, t, mat)
		return
	_skin_piece(along_x, face, inward, a0, a1, y0, top_h, t, mat)
	_skin_piece(along_x, face, inward, a0, a1, top_h, y1, t, mat_top)


func _skin_piece(along_x: bool, face: float, inward: float, a0: float,
		a1: float, y0: float, y1: float, t: float,
		mat: Material) -> void:
	if a1 - a0 < 0.04 or y1 - y0 < 0.04:
		return
	var pos := Vector3()
	var size := Vector3()
	if along_x:
		size = Vector3(a1 - a0, y1 - y0, t)
		pos = Vector3((a0 + a1) * 0.5, (y0 + y1) * 0.5, face + inward * t * 0.5)
	else:
		size = Vector3(t, y1 - y0, a1 - a0)
		pos = Vector3(face + inward * t * 0.5, (y0 + y1) * 0.5, (a0 + a1) * 0.5)
	_box(size, pos, mat, "Skin")


## Бордюр по верху обоев, на стыке с побелкой — тонкая цветная полоса,
## клеили не везде и не всегда, поэтому через комнату (по её координате,
## детерминированно). Идёт по всем четырём граням без разрывов на проёмах:
## над дверью и окном там всё равно уже побелка, а не обои.
static var _m_border: StandardMaterial3D = null

func _wallpaper_border(r: Array, paper_h: float) -> void:
	var x0: float = float(r[0])
	var z0: float = float(r[1])
	var x1: float = float(r[2])
	var z1: float = float(r[3])
	var seed_v := int(absf(x0) * 53.0 + absf(z0) * 97.0) % 100
	if seed_v < 45:
		return
	if _m_border == null:
		_m_border = _mat(Color(0.62, 0.50, 0.28), 0.6)
	var bh := 0.045
	var t := 0.024
	var sides := [
		[true, z0, 1.0], [true, z1, -1.0],
		[false, x0, 1.0], [false, x1, -1.0],
	]
	for sd in sides:
		var along_x: bool = sd[0]
		var face: float = sd[1]
		var inward: float = sd[2]
		var a0 := x0 if along_x else z0
		var a1 := x1 if along_x else z1
		_skin_piece(along_x, face, inward, a0, a1, paper_h - bh * 0.5,
				paper_h + bh * 0.5, t, _m_border)


## Плинтус (task-0031): деревянный в жилых, пластиковый везде на линолеуме
## и плитке. Пивот модели — нижнее переднее ребро профиля, ось +X — длина,
## лицо смотрит в −X (см. RESULT.md), поэтому позиция и разворот считаются
## отдельно от _skin_piece — там центр грани, здесь угол пол/стена.
const SKIRTING_WOOD := "res://assets/models/skirting/skirting_wood.glb"
const SKIRTING_PVC := "res://assets/models/skirting/skirting_pvc.glb"


## Глубина профиля от пивота (передняя грань) до задней, что ложится на
## стену — см. секцию в RESULT.md task-0031, макс. отступ там 0.020.
## Пивот на ПЕРЕДНЕЙ грани, а не у стены: без сдвига на эту глубину планка
## наполовину тонет в стене, а не выступает от неё в комнату.
const SKIRTING_DEPTH := 0.023

func _skirting_piece(along_x: bool, face: float, inward: float, a0: float,
		a1: float, path: String) -> void:
	var len_ := a1 - a0
	if len_ < 0.08:
		return
	var yaw: float
	var anchor: float
	if along_x:
		yaw = PI if inward > 0.0 else 0.0
		anchor = a1 if inward > 0.0 else a0
	else:
		yaw = -PI * 0.5 if inward > 0.0 else PI * 0.5
		anchor = a0 if inward > 0.0 else a1
	var off := face + inward * SKIRTING_DEPTH
	var pos := Vector3(anchor, 0.0, off) if along_x else Vector3(off, 0.0, anchor)
	_place(path, pos, yaw, len_)


## По периметру каждого помещения, с разрывом на дверных проёмах и на
## открытых границах между прямоугольниками одной комнаты (Г-образная
## прихожая — соседние куски одной комнаты, там нет стены и плинтуса тоже
## нет). Логика открытой границы — та же, что в _room_skin, продублирована
## явно: это на редкость легко сломать правкой не в том месте.
func _skirting() -> void:
	for room in _plan["rooms"]:
		var kind := String(room["kind"])
		if kind == "лоджия":
			continue
		var path := SKIRTING_WOOD if kind == "жилая" else SKIRTING_PVC
		for r in room["rects"]:
			var x0: float = float(r[0])
			var z0: float = float(r[1])
			var x1: float = float(r[2])
			var z1: float = float(r[3])
			if x1 - x0 < 0.3 or z1 - z0 < 0.3:
				continue
			var sides := [
				[true, z0, 1.0], [true, z1, -1.0],
				[false, x0, 1.0], [false, x1, -1.0],
			]
			for sd in sides:
				var along_x: bool = sd[0]
				var face: float = sd[1]
				var inward: float = sd[2]
				var a0 := x0 if along_x else z0
				var a1 := x1 if along_x else z1
				var cuts: Array = []
				for o in _plan.get("door_openings", []):
					var oa0: float = float(o[0]) if along_x else float(o[1])
					var oa1: float = float(o[2]) if along_x else float(o[3])
					var ob0: float = float(o[1]) if along_x else float(o[0])
					var ob1: float = float(o[3]) if along_x else float(o[2])
					if face < ob0 - 0.15 or face > ob1 + 0.15:
						continue
					var c0 := maxf(oa0, a0)
					var c1 := minf(oa1, a1)
					if c1 - c0 > 0.02:
						cuts.append([c0, c1])
				# Открытая граница: снаружи грани (не внутрь) есть то же
				# помещение, значит стены там нет.
				var step := 0.10
				var open_from := 0.0
				var open_run := false
				var a := a0
				while a <= a1 + 0.001:
					var px := (a if along_x else face - inward * 0.07)
					var pz := (face - inward * 0.07 if along_x else a)
					var is_open := _kind_at(px, pz) != ""
					if is_open and not open_run:
						open_from = a
						open_run = true
					elif not is_open and open_run:
						cuts.append([open_from - step, a])
						open_run = false
					a += step
				if open_run:
					cuts.append([open_from - step, a1])
				cuts.sort_custom(func(p, q): return float(p[0]) < float(q[0]))
				var cur := a0
				for c in cuts:
					_skirting_piece(along_x, face, inward, cur, float(c[0]), path)
					cur = maxf(cur, float(c[1]))
				_skirting_piece(along_x, face, inward, cur, a1, path)


## Остекление проёма: рама по краю и стекло, всё по центру толщины стены.
func _glazing(size: Vector3, cx: float, cz: float, y0: float, y1: float,
		m_frame: StandardMaterial3D, m_glass: StandardMaterial3D) -> void:
	var thin := 0.06
	var g := Vector3(size.x, y1 - y0, size.z)
	if size.x <= size.z:
		g.x = thin
	else:
		g.z = thin
	_box(g, Vector3(cx, (y0 + y1) * 0.5, cz), m_glass, "Glass")
	var fr := 0.08
	_box(Vector3(g.x, fr, g.z), Vector3(cx, y0 + fr * 0.5, cz), m_frame, "FrameLo")
	_box(Vector3(g.x, fr, g.z), Vector3(cx, y1 - fr * 0.5, cz), m_frame, "FrameHi")
	if size.x <= size.z:
		_box(Vector3(g.x, y1 - y0, fr),
				Vector3(cx, (y0 + y1) * 0.5, cz - size.z * 0.5 + fr * 0.5),
				m_frame, "FrameA")
		_box(Vector3(g.x, y1 - y0, fr),
				Vector3(cx, (y0 + y1) * 0.5, cz + size.z * 0.5 - fr * 0.5),
				m_frame, "FrameB")
	else:
		_box(Vector3(fr, y1 - y0, g.z),
				Vector3(cx - size.x * 0.5 + fr * 0.5, (y0 + y1) * 0.5, cz),
				m_frame, "FrameA")
		_box(Vector3(fr, y1 - y0, g.z),
				Vector3(cx + size.x * 0.5 - fr * 0.5, (y0 + y1) * 0.5, cz),
				m_frame, "FrameB")


## Перекрытие над квартирами. Камере оно не нужно — иначе не видно планировку,
## — но свету нужно: без него солнце и лампы светят в комнаты сверху, теней
## от стен нет, и интерьер выглядит открытой коробкой. Поэтому плита стоит в
## режиме «только тени»: не рисуется, но свет держит.
func _ceiling() -> void:
	var h: float = _plan["wall_h"]
	var b: Array = _plan["bounds"]
	var mesh := BoxMesh.new()
	mesh.size = Vector3(float(b[2]) - float(b[0]), 0.16, float(b[3]) - float(b[1]))
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = Vector3((float(b[0]) + float(b[2])) * 0.5, h + 0.08,
			(float(b[1]) + float(b[3])) * 0.5)
	# --open-roof: снимок сверху смотрит сквозь перекрытие, как раньше —
	# потолок остаётся только тенью. По умолчанию (игра) он сплошной и
	# побелён — раньше был SHADOWS_ONLY всегда, изнутри квартиры потолка
	# просто не было видно.
	if OS.get_cmdline_user_args().has("--open-roof"):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		mi.name = "CeilingShadowOnly"
	else:
		mi.material_override = _m_white_shared
		mi.name = "Ceiling"
	add_child(mi)


func _light() -> void:
	# Значения взяты из официальных демо, а не подобраны на глаз:
	# physical_light_camera_units (единственный чисто интерьерный сетап),
	# global_illumination и таблица shadow_bias из graphics_settings.
	RenderingServer.directional_shadow_atlas_set_size(8192, true)
	get_viewport().positional_shadow_atlas_size = 4096

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -52, 0)
	sun.light_energy = 1.2
	sun.light_color = Color(1.0, 0.94, 0.86)
	# Мягкая тень солнца (angular_distance > 0) на этой сцене даёт по всем
	# поверхностям правильную точечную решётку: перекрытие в режиме «только
	# тени» кладёт весь интерьер в тень, выборка мягкой тени дизерится в
	# экранных координатах, а TAA, который её обычно размывает, у нас выключен.
	# Проверено: при 0.0 решётка исчезает целиком, кромку смягчает shadow_blur.
	sun.light_angular_distance = 0.0
	sun.light_bake_mode = Light3D.BAKE_STATIC
	sun.shadow_enabled = true
	sun.shadow_bias = 0.01                  # таблица под атлас 8192
	sun.shadow_normal_bias = 2.0            # поднимать раньше, чем bias
	sun.shadow_blur = 3.4
	# Сцена умещается в 30 м, поэтому один сплит: PSSM тут только даёт швы.
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_fade_start = 1.0
	sun.directional_shadow_max_distance = 30.0
	add_child(sun)

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var mat := ProceduralSkyMaterial.new()
	# Тон неба менее синий: в узких нишах (например, боковая стенка кладовки
	# у прихожей, толщиной 6 см) солнце не достаёт совсем, и цвет там даёт
	# только небо. При старом sky_top_color (0.40, 0.50, 0.66) такие щели
	# читались явно синими на фоне тёплого прямого света вокруг.
	mat.sky_top_color = Color(0.46, 0.50, 0.58)
	mat.sky_horizon_color = Color(0.74, 0.75, 0.76)
	mat.ground_bottom_color = Color(0.22, 0.21, 0.20)
	mat.ground_horizon_color = Color(0.52, 0.50, 0.48)
	sky.sky_material = mat
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# Небо вполсилы, иначе затенённые места отдают синевой и «плывут»
	e.ambient_light_sky_contribution = 0.42
	e.ambient_light_energy = 1.65
	# Затемнение в углах и под предметами. Демо ставят интенсивность 1.0, но
	# там открытые сцены; в комнате 3 x 5 углов много и они должны читаться.
	e.ssao_enabled = true
	e.ssao_intensity = 4.6
	e.ssao_radius = 1.3
	e.ssao_detail = 0.6
	e.ssao_power = 1.6
	e.ssao_light_affect = 0.25              # гасит и прямой свет, не только среду
	e.ssao_ao_channel_affect = 0.4          # уживается с AO из ORM
	# Отражённый свет: тёплое пятно от лампы ложится на соседние стены. Раньше
	# он давал точечную рябь на полу — она была от карт нормалей через ORM,
	# и с тех пор это исправлено.
	e.ssil_enabled = true
	e.ssil_intensity = 0.9
	e.ssil_radius = 3.0
	e.ssil_normal_rejection = 0.9
	e.glow_enabled = true
	e.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.environment = e
	add_child(env)


## Непрямой свет: VoxelGI печётся ИЗ КОДА, в отличие от LightmapGI, который
## доступен только в редакторе и вдобавок не берёт PrimitiveMesh. По одному
## узлу на квартиру: ячейка при SUBDIV_256 около 4 см, то есть тоньше самой
## тонкой стены, иначе свет течёт сквозь перегородки.
func _bake_gi() -> void:
	var b: Array = _plan["bounds"]
	var h: float = _plan["wall_h"]
	var zmid: float = (float(b[1]) + float(b[3])) * 0.5
	for half in [[float(b[1]), zmid], [zmid, float(b[3])]]:
		var gi := VoxelGI.new()
		gi.subdiv = VoxelGI.SUBDIV_128
		gi.size = Vector3(float(b[2]) - float(b[0]) + 0.4, h + 1.0,
				half[1] - half[0] + 0.4)
		gi.position = Vector3((float(b[0]) + float(b[2])) * 0.5, h * 0.5,
				(half[0] + half[1]) * 0.5)
		add_child(gi)
		await get_tree().process_frame
		gi.bake()
		if gi.data != null:
			# interior не включаем: перекрытие и так закрывает верх, а без
			# неба комнаты уходят в чёрное — на этой камере это хуже протечек
			gi.data.energy = 1.3
			gi.data.propagation = 0.6
			gi.data.normal_bias = 1.5   # против точечной ряби на полу
	print("[plan3d] GI запечён")


## Свет в помещениях. Солнце сквозь окна в интерьер почти не достаёт:
## проёмы узкие, а стены 2.84 высотой. Поэтому в каждом блоке своя лампа под
## потолком — тёплая в жилых, холоднее в санузлах, — и отдельная у окон,
## чтобы читался откос и то, что свет идёт снаружи.
func _room_lights() -> void:
	var h: float = _plan["wall_h"]
	# Лампа накаливания, а не дневной свет: в брошенном доме электричества нет,
	# но кадр читается как «вечер при лампочке», и холодный свет делает серым
	# даже тёплое дерево.
	# Лампа накаливания, а не дневной свет. Ориентир — 2400 К: у такой лампы
	# синего примерно вдвое меньше красного. Прежние значения (0.87, 0.70)
	# читались белыми, потому что глаз сравнивает их с холодным светом из окна.
	var warm := {
		"кухня": Color(1.00, 0.74, 0.46),
		"прихожая": Color(1.00, 0.72, 0.44),
		"санузел": Color(1.00, 0.82, 0.62),
		"лоджия": Color(0.90, 0.95, 1.00),
	}
	for room in _plan["rooms"]:
		var col: Color = warm.get(room["kind"], Color(1.00, 0.77, 0.52))
		for r in room["rects"]:
			var w: float = float(r[2]) - float(r[0])
			var d: float = float(r[3]) - float(r[1])
			if w < 0.5 or d < 0.5:
				continue
			var lamp := OmniLight3D.new()
			# На уровне самой лампочки — низ патрона (замерено --probe: пивот
			# модели у потолка, низ на 0.559 ниже). Источник света и видимый
			# шарик (_show_lights) должны совпадать с настоящим плафоном, а не
			# висеть отдельно от него.
			lamp.position = Vector3((float(r[0]) + float(r[2])) * 0.5, h - 0.559,
					(float(r[1]) + float(r[3])) * 0.5)
			lamp.light_color = col
			# Яркость по площади: одна и та же лампа в комнате 3 x 5 читается
			# ровно, а в уборной 0.7 x 1.6 выбивает стены в белое. Опорная
			# точка — комната около 15 м², от неё вниз до трети.
			lamp.light_energy = clampf(10.0 * sqrt(w * d / 15.0), 3.2, 11.0)
			lamp.omni_range = maxf(w, d) * 1.6 + 4.0
			# Затухание круче единицы: пятно под лампой не выбивается, свет
			# спадает к углам мягче и не растекается в соседнюю комнату.
			lamp.omni_attenuation = 1.8
			lamp.light_size = 0.0            # PCSS на этом масштабе даёт шум
			lamp.light_bake_mode = Light3D.BAKE_STATIC
			lamp.shadow_enabled = true
			lamp.shadow_bias = 0.03
			lamp.shadow_normal_bias = 4.0    # как во всех демо для точечных
			lamp.shadow_blur = 3.0           # мягче край — резкая тень от точки
			# на этом масштабе комнаты читается графично, а не бытово
			add_child(lamp)

	# у окон — холодный свет с улицы, чтобы читались откосы
	for r in _plan["windows"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		var lamp := OmniLight3D.new()
		lamp.position = Vector3((float(r[0]) + float(r[2])) * 0.5,
				(float(_plan["sill"]) + float(_plan["lintel"])) * 0.5,
				(float(r[1]) + float(r[3])) * 0.5)
		lamp.light_color = Color(0.80, 0.88, 1.00)
		lamp.light_energy = 3.0
		lamp.omni_range = 5.5
		lamp.omni_attenuation = 2.2
		lamp.light_specular = 0.0            # имитация отражённого, без бликов
		lamp.shadow_enabled = false          # окно светит, тени даёт солнце
		add_child(lamp)


## Показать сами источники: шарик на месте лампы и подпись с параметрами.
## Флаг --lights, чтобы не мешало обычному кадру.
func _show_lights() -> void:
	var seen := 0
	for n in get_children():
		if not (n is OmniLight3D):
			continue
		var l := n as OmniLight3D
		var mesh := SphereMesh.new()
		mesh.radius = 0.045
		mesh.height = 0.09
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		var m := StandardMaterial3D.new()
		m.albedo_color = l.light_color
		m.emission_enabled = true
		m.emission = l.light_color
		m.emission_energy_multiplier = 8.0
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mi.material_override = m
		mi.position = l.position
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)

		# Шар радиуса не рисуем: на этой камере он заливает весь кадр.
		# Дальность видно в подписи.

		seen += 1
	print("[plan3d] источников показано: %d" % seen)


func _camera() -> void:
	var b: Array = _plan["bounds"]
	var cx: float = (float(b[0]) + float(b[2])) * 0.5
	var cz: float = (float(b[1]) + float(b[3])) * 0.5
	var cam := Camera3D.new()
	# --fov=N — перспектива вместо изометрии: для превью широкий угол читается
	# лучше, стены расходятся от центра и видно глубину комнат.
	var fov := 0.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--fov="):
			fov = float(a.substr(6))
	if fov > 0.0:
		cam.projection = Camera3D.PROJECTION_PERSPECTIVE
		cam.fov = fov
		cam.near = 0.05
	else:
		cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 16.0
	cam.current = true
	# look_at работает только внутри дерева
	if _vp != null:
		_vp.add_child(cam)
	else:
		add_child(cam)
	# --focus=x0,z0,x1,z1 — тот же кадр, что и --flat, но границы заданы явно:
	# для проверки одной детали (декаль, шов, стык) вблизи, без подгонки под
	# всю квартиру.
	var focus: Array = []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--focus="):
			var nums := a.substr(8).split(",")
			if nums.size() == 4:
				focus = [nums[0].to_float(), nums[1].to_float(),
						nums[2].to_float(), nums[3].to_float()]
	# --flat: одна квартира крупно. Границы беру по её же помещениям, а не по
	# всему блоку, иначе половина кадра уходит на соседнюю квартиру.
	if OS.get_cmdline_user_args().has("--flat") or not focus.is_empty():
		var mnx := 1e9
		var mnz := 1e9
		var mxx := -1e9
		var mxz := -1e9
		if not focus.is_empty():
			mnx = focus[0]
			mnz = focus[1]
			mxx = focus[2]
			mxz = focus[3]
		else:
			for room in _plan["rooms"]:
				for r in room["rects"]:
					# соседняя квартира из разбора уже убрана (_keep_one_flat)
					mnx = minf(mnx, float(r[0]))
					mnz = minf(mnz, float(r[1]))
					mxx = maxf(mxx, float(r[2]))
					mxz = maxf(mxz, float(r[3]))
		var fx := (mnx + mxx) * 0.5
		var fz := (mnz + mxz) * 0.5
		cam.size = maxf(mxx - mnx, mxz - mnz) * 1.15
		# Наклон камеры: --pitch=N градусов над горизонтом. Чем больше, тем
		# ближе к взгляду сверху. У перспективы по умолчанию положе, чем у
		# изометрии, иначе широкий объектив только растягивает пол.
		var pitch := 66.0
		if cam.projection == Camera3D.PROJECTION_PERSPECTIVE:
			pitch = 58.0
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--pitch="):
				pitch = clampf(float(a.substr(8)), 10.0, 89.0)
		# --yaw=N — с какой стороны смотреть, градусы по часовой от +Z.
		# 45 — угол «справа-снизу» (как было), 225 — противоположный.
		var yaw := 45.0
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--yaw="):
				yaw = float(a.substr(6))
		var rad := deg_to_rad(pitch)
		var yr := deg_to_rad(yaw)
		var eye := Vector3(cos(rad) * sin(yr), sin(rad), cos(rad) * cos(yr)) * 20.0
		cam.global_position = Vector3(fx, 1.0, fz) + eye
		cam.look_at(Vector3(fx, 1.0, fz), Vector3.UP)
		_frame(cam, Vector3(mnx, 0.0, mnz),
				Vector3(mxx, float(_plan["wall_h"]), mxz))
		if _turn != "":
			# после подгонки известны и центр, и удаление — по ним и вращаем
			_turn_c = Vector3(fx, 1.0, fz)
			_turn_r = cam.global_position.distance_to(_turn_c)
		return
	var back := OS.get_cmdline_user_args().has("--back")
	if back:
		cam.global_position = Vector3(cx - 6.5, 26.0, cz - 6.5)
		cam.look_at(Vector3(cx, 1.0, cz), Vector3.UP)
	elif OS.get_cmdline_user_args().has("--top"):
		cam.global_position = Vector3(cx, 30.0, cz)
		cam.rotation_degrees = Vector3(-90, 0, 0)
		cam.size = 19.5
	else:
		cam.global_position = Vector3(cx + 6.5, 26.0, cz + 6.5)
		cam.look_at(Vector3(cx, 1.0, cz), Vector3.UP)


# --- игрок ------------------------------------------------------------------
# В сборке по квартире ходят, а не летают: капсула с гравитацией, глаза на
# 1.65, мышь по правой кнопке. F переключает на свободный полёт — им удобно
# смотреть сверху и заглядывать в санузлы.
var _fly := false
var _walkman: CharacterBody3D = null
var _fly_speed := 3.5


func _ready_fly() -> void:
	if _shot != "":
		return
	var cam := _find_cam()
	if cam == null:
		return
	cam.projection = Camera3D.PROJECTION_PERSPECTIVE
	cam.fov = 75.0
	cam.near = 0.05

	# ставим в прихожую: берём её прямоугольник из разбора, а не координату
	var spot := Vector3(0, 1.65, 0)
	for room in _plan["rooms"]:
		if String(room["kind"]) != "прихожая":
			continue
		for r in room["rects"]:
			var w := float(r[2]) - float(r[0])
			var d := float(r[3]) - float(r[1])
			if w * d > 2.0:
				spot = Vector3((float(r[0]) + float(r[2])) * 0.5, 1.65,
						(float(r[1]) + float(r[3])) * 0.5)

	_walkman = CharacterBody3D.new()
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.28
	cap.height = 1.70
	shape.shape = cap
	shape.position.y = 0.85
	_walkman.add_child(shape)
	_walkman.position = spot - Vector3(0, 1.65, 0) + Vector3(0, 0.15, 0)
	add_child(_walkman)
	cam.get_parent().remove_child(cam)
	_walkman.add_child(cam)
	cam.position = Vector3(0, 1.62, 0)
	cam.rotation = Vector3.ZERO


func _find_cam() -> Camera3D:
	for c in get_children():
		if c is Camera3D:
			return c
	if _vp != null:
		for c in _vp.get_children():
			if c is Camera3D:
				return c
	return null


func _unhandled_input(event: InputEvent) -> void:
	if _shot != "":
		return
	if event is InputEventKey and event.pressed:
		var kc := (event as InputEventKey).keycode
		if kc == KEY_ESCAPE:
			get_tree().quit()
		elif kc == KEY_F:
			_fly = not _fly
			print("[режим] ", "полёт" if _fly else "ходьба")
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if mb.pressed 					else Input.MOUSE_MODE_VISIBLE
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_fly_speed = minf(_fly_speed * 1.25, 30.0)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_fly_speed = maxf(_fly_speed * 0.8, 0.4)
	if event is InputEventMouseMotion 			and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var cam := _find_cam()
		if cam != null:
			var mm := event as InputEventMouseMotion
			cam.rotation.y -= mm.relative.x * 0.003
			cam.rotation.x = clampf(cam.rotation.x - mm.relative.y * 0.003,
					-1.4, 1.4)


func _fly_step(delta: float) -> void:
	var cam := _find_cam()
	if cam == null:
		return
	var dir := Vector3.ZERO
	var basis := cam.global_transform.basis
	if Input.is_key_pressed(KEY_W):
		dir -= basis.z
	if Input.is_key_pressed(KEY_S):
		dir += basis.z
	if Input.is_key_pressed(KEY_A):
		dir -= basis.x
	if Input.is_key_pressed(KEY_D):
		dir += basis.x

	if _fly or _walkman == null:
		if Input.is_key_pressed(KEY_E):
			dir += Vector3.UP
		if Input.is_key_pressed(KEY_Q):
			dir -= Vector3.UP
		if dir == Vector3.ZERO:
			return
		var k := 3.0 if Input.is_key_pressed(KEY_SHIFT) else 1.0
		var node: Node3D = _walkman if _walkman != null else cam
		node.global_position += dir.normalized() * _fly_speed * k * delta
		return

	# ходьба: горизонталь от взгляда, гравитация своя
	dir.y = 0.0
	var speed := 4.2 if Input.is_key_pressed(KEY_SHIFT) else 1.9
	var v := _walkman.velocity
	if dir != Vector3.ZERO:
		var h := dir.normalized() * speed
		v.x = h.x
		v.z = h.z
	else:
		v.x = 0.0
		v.z = 0.0
	if _walkman.is_on_floor():
		if Input.is_key_pressed(KEY_SPACE):
			v.y = 3.4
		else:
			v.y = -0.1
	else:
		v.y -= 9.8 * delta
	_walkman.velocity = v
	_walkman.move_and_slide()


# --- проверка проходимости ---------------------------------------------------
# Флаг --walk. Строит сетку 5 см по всей квартире, отмечает занятым всё, что
# стоит на высоте пояса, и заливкой проверяет, что из каждого помещения можно
# дойти в каждое. Это ответ на историю с «стеной в прихожей»: перегородка
# ловится числом, а не разглядыванием кадра.
func _walk_check() -> void:
	var b: Array = _plan["bounds"]
	var x0: float = float(b[0])
	var z0: float = float(b[1])
	var x1: float = float(b[2])
	var z1: float = float(b[3])
	var step := 0.05
	var w := int((x1 - x0) / step) + 1
	var h := int((z1 - z0) / step) + 1
	var blocked := PackedByteArray()
	blocked.resize(w * h)

	# занято всё, что пересекает высоту 0.35…1.20 — то есть мешает пройти
	var boxes := 0
	for c in get_children():
		# блок, вставленный в проём, считать стеной нельзя: его габаритная
		# коробка накрывает весь проём, хотя внутри неё дыра. Именно это
		# однажды показало «не дойти никуда» на совершенно проходимой квартире.
		if c.has_meta("opening"):
			continue
		var list: Array = []
		if c is MeshInstance3D:
			list = [c]
		elif c is Node3D:
			list = (c as Node3D).find_children("*", "MeshInstance3D", true, false)
		for n in list:
			var mi := n as MeshInstance3D
			var box := mi.global_transform * mi.get_aabb()
			if box.end.y < 0.35 or box.position.y > 1.20:
				continue
			# створки и ткань не считаем: дверь открывают, штору отодвигают
			var nm := String(mi.name)
			if nm.begins_with("leaf") or nm.begins_with("curtain") 					or nm.begins_with("sheer") or nm.begins_with("door-") 					or nm.begins_with("Door") or nm.begins_with("DF") 					or nm.begins_with("ClosetDoor") or nm.begins_with("Glass") 					or nm.begins_with("Frame"):
				continue
			boxes += 1
			var i0 := maxi(int((box.position.x - x0) / step), 0)
			var i1 := mini(int((box.end.x - x0) / step), w - 1)
			var j0 := maxi(int((box.position.z - z0) / step), 0)
			var j1 := mini(int((box.end.z - z0) / step), h - 1)
			for j in range(j0, j1 + 1):
				for i in range(i0, i1 + 1):
					blocked[j * w + i] = 1

	# точки, из которых надо ходить: середины прямоугольников помещений
	var spots: Array = []
	for room in _plan["rooms"]:
		for r in room["rects"]:
			spots.append([String(room["kind"]),
					(float(r[0]) + float(r[2])) * 0.5,
					(float(r[1]) + float(r[3])) * 0.5])
	if spots.is_empty():
		return

	# заливка от прихожей: из неё в жизни и попадают во все помещения
	var from_i := 0
	for k in spots.size():
		if String(spots[k][0]) == "прихожая":
			from_i = k
			break
	var tmp = spots[0]
	spots[0] = spots[from_i]
	spots[from_i] = tmp
	var seen := PackedByteArray()
	seen.resize(w * h)
	var start := int((float(spots[0][2]) - z0) / step) * w 			+ int((float(spots[0][1]) - x0) / step)
	var queue: Array[int] = [start]
	seen[start] = 1
	while not queue.is_empty():
		var cur: int = queue.pop_back()
		var ci := cur % w
		var cj := cur / w
		for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
			var ni: int = ci + int(d[0])
			var nj: int = cj + int(d[1])
			if ni < 0 or nj < 0 or ni >= w or nj >= h:
				continue
			var idx := nj * w + ni
			if seen[idx] == 1 or blocked[idx] == 1:
				continue
			seen[idx] = 1
			queue.append(idx)

	var bad: Array = []
	for sp in spots:
		var i := int((float(sp[1]) - x0) / step)
		var j := int((float(sp[2]) - z0) / step)
		# центр помещения может попасть в ванну или в тумбу — ищем ближайшую
		# свободную клетку, иначе проверка ругается на мебель, а не на стены
		var found := false
		for rad in range(0, 14):
			for dj in range(-rad, rad + 1):
				for di in range(-rad, rad + 1):
					var qi := clampi(i + di, 0, w - 1)
					var qj := clampi(j + dj, 0, h - 1)
					if blocked[qj * w + qi] == 0:
						i = qi
						j = qj
						found = true
						break
				if found:
					break
			if found:
				break
		if seen[j * w + i] != 1:
			bad.append("%s (%.2f, %.2f)" % [sp[0], sp[1], sp[2]])
	# карта проходимости: чёрное — занято, зелёное — куда дошли, серое — пусто
	var img := Image.create(w, h, false, Image.FORMAT_RGB8)
	for j in h:
		for i in w:
			var idx := j * w + i
			var col := Color(0.25, 0.25, 0.28)
			if blocked[idx] == 1:
				col = Color(0.05, 0.05, 0.05)
			elif seen[idx] == 1:
				col = Color(0.2, 0.8, 0.35)
			img.set_pixel(i, j, col)
	for sp in spots:
		var si := clampi(int((float(sp[1]) - x0) / step), 0, w - 1)
		var sj := clampi(int((float(sp[2]) - z0) / step), 0, h - 1)
		for dj in range(-2, 3):
			for di in range(-2, 3):
				var qi := clampi(si + di, 0, w - 1)
				var qj := clampi(sj + dj, 0, h - 1)
				img.set_pixel(qi, qj, Color(1, 0.3, 0.2))
	img.save_png("user://walk.png")
	print("[проходимость] карта: ", ProjectSettings.globalize_path("user://walk.png"))

	if bad.is_empty():
		print("[проходимость] ок: все %d помещений связаны, препятствий учтено %d"
				% [spots.size(), boxes])
	else:
		print("[проходимость] НЕ ДОЙТИ до %d из %d: %s"
				% [bad.size(), spots.size(), ", ".join(bad)])


## Оборот вокруг квартиры: кадр за кадром, по одному на такт. Камера ходит по
## окружности вокруг центра, наклон и радиус берутся от той же подгонки, что и
## обычный кадр, — поэтому квартира не «дышит» в кадре.
func _turn_step() -> void:
	var cam := _find_cam()
	if cam == null or _vp == null:
		return
	if _frames > 0:
		_frames -= 1
		return                      # дать сцене прогреться
	var a := TAU * float(_turn_i) / float(_turn_n)
	var rad := deg_to_rad(_turn_pitch)
	cam.global_position = _turn_c + Vector3(cos(rad) * sin(a), sin(rad),
			cos(rad) * cos(a)) * _turn_r
	cam.look_at(_turn_c, Vector3.UP)
	await RenderingServer.frame_post_draw
	var img := _vp.get_texture().get_image()
	if _ss > 1:
		img.resize(_size.x, _size.y, Image.INTERPOLATE_LANCZOS)
	img.save_png("%s/frame_%03d.png" % [_turn, _turn_i])
	_turn_i += 1
	if _turn_i >= _turn_n:
		print("[оборот] кадров: %d -> %s" % [_turn_n, _turn])
		get_tree().quit()


## Отладка: что стоит в прихожей выше метра. Флаг --hall.
## Что стоит в произвольной мировой точке — для разбора конкретных жалоб
## по кадру, а не всей прихожей целиком. Флаг --spot=x0,z0,x1,z1.
func _spot_debug(rect: Array) -> void:
	for c in get_children():
		var list: Array = []
		if c is MeshInstance3D:
			list = [c]
		elif c is Node3D:
			list = (c as Node3D).find_children("*", "MeshInstance3D", true, false)
		for n in list:
			var mi := n as MeshInstance3D
			var box := mi.global_transform * mi.get_aabb()
			if box.position.x < rect[2] and box.end.x > rect[0] 					and box.position.z < rect[3] and box.end.z > rect[1]:
				print("[spot] %s box %v..%v" % [c.name, box.position, box.end])


func _hall_report() -> void:
	var halls: Array = []
	for room in _plan["rooms"]:
		if String(room["kind"]) == "прихожая":
			halls.append_array(room["rects"])
	print("[прихожая] прямоугольники: ", halls)
	for c in get_children():
		var mi := c as MeshInstance3D
		var nodes: Array = []
		if mi != null:
			nodes = [mi]
		elif c is Node3D:
			nodes = (c as Node3D).find_children("*", "MeshInstance3D", true, false)
		for n in nodes:
			var m := n as MeshInstance3D
			var box := m.global_transform * m.get_aabb()
			if box.size.y < 1.0:
				continue
			for r in halls:
				var x0: float = float(r[0])
				var z0: float = float(r[1])
				var x1: float = float(r[2])
				var z1: float = float(r[3])
				var ox := minf(box.end.x, x1) - maxf(box.position.x, x0)
				var oz := minf(box.end.z, z1) - maxf(box.position.z, z0)
				if ox > 0.004 and oz > 0.004:
					print("[прихожая] %s x %.2f..%.2f z %.2f..%.2f (залезает %.2f x %.2f, h %.2f)"
							% [c.name, box.position.x, box.end.x,
									box.position.z, box.end.z, ox, oz, box.size.y])


## Подогнать ортокамеру под коробку: считаю экранные координаты восьми углов,
## по ним правлю размер и сдвигаю камеру так, чтобы коробка встала по центру.
## Два прохода — после сдвига проекция меняется.
func _frame(cam: Camera3D, mn: Vector3, mx: Vector3) -> void:
	var vp := Vector2(_vp.size) if _vp != null else get_viewport().get_visible_rect().size
	for _pass in 2:
		var lo := Vector2(1e9, 1e9)
		var hi := Vector2(-1e9, -1e9)
		for i in 8:
			var p := Vector3(
					mx.x if i & 1 else mn.x,
					mx.y if i & 2 else mn.y,
					mx.z if i & 4 else mn.z)
			var sp := cam.unproject_position(p)
			lo = Vector2(minf(lo.x, sp.x), minf(lo.y, sp.y))
			hi = Vector2(maxf(hi.x, sp.x), maxf(hi.y, sp.y))
		var zoom := 1.0
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--zoom="):
				zoom = maxf(float(a.substr(7)), 0.2)
		var k := maxf((hi.x - lo.x) / vp.x, (hi.y - lo.y) / vp.y) * 1.02 / zoom
		var b := cam.global_transform.basis
		if cam.projection == Camera3D.PROJECTION_ORTHOGONAL:
			var off := ((lo + hi) * 0.5 - vp * 0.5) / vp.y * cam.size
			cam.global_position += b.x * off.x - b.y * off.y
			cam.size *= k
		else:
			# у перспективы масштаб задаётся удалением, а сдвиг — доворотом
			var mid := (mn + mx) * 0.5
			cam.global_position = mid + (cam.global_position - mid) * k
			cam.look_at(mid, Vector3.UP)


## Дверцы кладовок (task-0016). Ширина модели подбирается по проёму: 0.71 для
## кладовок 1а и 2а, 0.46 для узкой 6а. Пивот коробки — середина низа проёма,
## ось Z наружу от полотна, поэтому доворачиваем на сторону открывания.
const CLOSET_DIR := "res://assets/models/closets/"

func _closet_doors() -> void:
	for c in _plan.get("closets", []):
		var r: Array = c["r"]
		var side: Array = c["side"]
		var x0: float = float(r[0])
		var z0: float = float(r[1])
		var x1: float = float(r[2])
		var z1: float = float(r[3])
		var dz: float = float(side[0])
		var dx: float = float(side[1])
		# куда смотрит дверца — туда и середина проёма
		var pos: Vector3
		var yaw: float
		var width: float
		if dx > 0.0:
			pos = Vector3(x1, 0.0, (z0 + z1) * 0.5)
			yaw = PI * 0.5
			width = z1 - z0
		elif dx < 0.0:
			pos = Vector3(x0, 0.0, (z0 + z1) * 0.5)
			yaw = -PI * 0.5
			width = z1 - z0
		elif dz > 0.0:
			pos = Vector3((x0 + x1) * 0.5, 0.0, z1)
			yaw = 0.0
			width = x1 - x0
		else:
			pos = Vector3((x0 + x1) * 0.5, 0.0, z0)
			yaw = PI
			width = x1 - x0
		var seed_v := int(absf(pos.x) * 61.0 + absf(pos.z) * 113.0) % 100
		var model := "closet_door_71"
		if width < 0.58:
			model = "closet_door_46"
		elif seed_v < 25:
			model = "closet_door_broken"
		var node := _place(CLOSET_DIR + model + ".glb", pos, yaw,
				width / (0.46 if model == "closet_door_46" else 0.71))
		if node == null:
			continue
		node.set_meta("opening", true)
		var leaf := node.find_child("leaf", true, false) as Node3D
		if leaf != null and model != "closet_door_broken":
			leaf.rotation.y += deg_to_rad(18.0 + float(seed_v % 11) * 1.5)


func _physics_process(delta: float) -> void:
	if _shot == "":
		_fly_step(delta)


func _process(_d: float) -> void:
	if _turn != "":
		_turn_step()
		return
	if _shot == "":
		return
	_frames -= 1
	if _frames > 0:
		return
	await RenderingServer.frame_post_draw
	var img := (_vp if _vp != null else get_viewport()).get_texture().get_image()
	if _vp != null and _ss > 1:
		img.resize(_size.x, _size.y, Image.INTERPOLATE_LANCZOS)
	var err := img.save_png(_shot)
	print("[plan3d] %s -> %s  (узлов %d)"
			% ["ok" if err == OK else "ошибка %d" % err, _shot, get_child_count()])
	get_tree().quit()
