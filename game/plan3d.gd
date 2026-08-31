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
var _plan: Dictionary = {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.substr(7)
		elif a.begins_with("--frames="):
			_frames = int(a.substr(9))

	var f := FileAccess.open(DATA, FileAccess.READ)
	if f == null:
		push_error("нет файла разбора: " + DATA)
		return
	_plan = JSON.parse_string(f.get_as_text())
	f.close()

	_build()
	_ceiling()
	_light()
	_room_lights()
	_camera()
	# VoxelGI печётся из кода и по мануалу — правильный выбор для сцены,
	# собранной программно. Но на нашей камере он проигрывает: перекрытие
	# закрывает верх, комнаты уходят в темноту, а по полу идёт воксельная
	# рябь. Поэтому по умолчанию выключен, включается флагом --gi.
	if OS.get_cmdline_user_args().has("--lights"):
		_show_lights()
	if OS.get_cmdline_user_args().has("--gi"):
		_bake_gi()


## Материал по набору текстур из assets: albedo + normal + ORM.
## Развёртка трипланарная и в метрах, чтобы масштаб не зависел от размера
## коробки: у стены 5 м и у откоса 0.2 м рисунок одинаковый.
func _tex(dir_: String, base: String, scale: float,
		tint: Color = Color(1, 1, 1), use_normal: bool = true) -> StandardMaterial3D:
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
		# Шероховатость и металличность из ORM не берём: в этих наборах
		# зелёный канал местами тёмный, поверхность начинает бликовать
		# точками по карте нормалей. Держим матовость постоянной.
	m.roughness = 0.92
	m.metallic_specular = 0.15
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


func _box(size: Vector3, pos: Vector3, mat: StandardMaterial3D, name_: String) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.name = name_
	add_child(mi)


func _build() -> void:
	var h: float = _plan["wall_h"]
	var sill: float = _plan["sill"]
	var lintel: float = _plan["lintel"]
	var door_h: float = _plan["door_h"]

	# Каждому виду блока свой материал. Пол квартир, обои и плитка санузла
	# ещё в работе (task-0009, 0010, 0013) — до сдачи стоят ближайшие из
	# принятых, чтобы масштаб и тон уже читались.
	var m_wall := _tex("wall-paint", "wall_paint", 0.32)
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

	var b: Array = _plan["bounds"]
	_box(Vector3(b[2] - b[0], 0.16, b[3] - b[1]),
			Vector3((b[0] + b[2]) * 0.5, -0.08, (b[1] + b[3]) * 0.5), m_floor, "Slab")

	# пол помещений цветом по назначению
	var m_kind := {
		"кухня": _texf("concrete-facade", "concrete_facade", 0.25,
				Color(0.95, 0.84, 0.80)),
		"прихожая": _texf("concrete-facade", "concrete_facade", 0.25,
				Color(0.95, 0.87, 0.72)),
		"лоджия": _texf("landing-floor", "landing_floor", 0.22,
				Color(0.86, 0.94, 0.84)),
		"санузел": _texf("stair-tread", "stair_tread", 0.30,
				Color(0.84, 0.92, 1.0)),
		"жилая": _texf("concrete-facade", "concrete_facade", 0.25,
				Color(0.86, 0.80, 0.72)),
	}
	for room in _plan["rooms"]:
		var mk: StandardMaterial3D = m_kind.get(room["kind"], m_floor)
		for r in room["rects"]:
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

	# Приборы: высоты как в жизни, стоят на полу.
	var m_fh := {"ванна": 0.58, "унитаз": 0.40, "мойка": 0.85,
			"раковина": 0.80, "плита": 0.85}
	for fx in _plan["fixtures"]:
		var r: Array = fx["r"]
		var hh: float = float(m_fh.get(fx["kind"], 0.8))
		_box(Vector3(float(r[2]) - float(r[0]), hh, float(r[3]) - float(r[1])),
				Vector3((float(r[0]) + float(r[2])) * 0.5, hh * 0.5,
						(float(r[1]) + float(r[3])) * 0.5), m_fix, "Fx")


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
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	mi.name = "CeilingShadowOnly"
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
	sun.light_angular_distance = 0.5        # мягкая кромка тени
	sun.light_bake_mode = Light3D.BAKE_STATIC
	sun.shadow_enabled = true
	sun.shadow_bias = 0.01                  # таблица под атлас 8192
	sun.shadow_normal_bias = 2.0            # поднимать раньше, чем bias
	sun.shadow_blur = 1.8
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
	mat.sky_top_color = Color(0.40, 0.50, 0.66)
	mat.sky_horizon_color = Color(0.74, 0.75, 0.76)
	mat.ground_bottom_color = Color(0.22, 0.21, 0.20)
	mat.ground_horizon_color = Color(0.52, 0.50, 0.48)
	sky.sky_material = mat
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# Небо вполсилы, иначе затенённые места отдают синевой и «плывут»
	e.ambient_light_sky_contribution = 0.65
	e.ambient_light_energy = 1.4
	e.ssao_enabled = true
	e.ssao_intensity = 1.0                  # демо ставит 1.0 вместо дефолтных 2.0
	e.ssil_enabled = false   # на нашем масштабе даёт точечную рябь на полу
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
	var warm := {
		"кухня": Color(1.00, 0.90, 0.78),
		"прихожая": Color(1.00, 0.88, 0.74),
		"санузел": Color(0.88, 0.94, 1.00),
		"лоджия": Color(0.90, 0.95, 1.00),
	}
	for room in _plan["rooms"]:
		var col: Color = warm.get(room["kind"], Color(1.00, 0.92, 0.82))
		for r in room["rects"]:
			var w: float = float(r[2]) - float(r[0])
			var d: float = float(r[3]) - float(r[1])
			if w < 0.5 or d < 0.5:
				continue
			var lamp := OmniLight3D.new()
			lamp.position = Vector3((float(r[0]) + float(r[2])) * 0.5, h - 0.35,
					(float(r[1]) + float(r[3])) * 0.5)
			lamp.light_color = col
			lamp.light_energy = 4.2
			lamp.omni_range = maxf(w, d) * 1.6 + 4.0
			# Затухание круче единицы: пятно под лампой не выбивается, свет
			# спадает к углам мягче и не растекается в соседнюю комнату.
			lamp.omni_attenuation = 1.8
			lamp.light_size = 0.0            # PCSS на этом масштабе даёт шум
			lamp.light_bake_mode = Light3D.BAKE_STATIC
			lamp.shadow_enabled = true
			lamp.shadow_bias = 0.03
			lamp.shadow_normal_bias = 4.0    # как во всех демо для точечных
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
		mesh.radius = 0.11
		mesh.height = 0.22
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		var m := StandardMaterial3D.new()
		m.albedo_color = l.light_color
		m.emission_enabled = true
		m.emission = l.light_color
		m.emission_energy_multiplier = 4.0
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
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 16.0
	cam.current = true
	add_child(cam)                      # look_at работает только внутри дерева
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


func _process(_d: float) -> void:
	if _shot == "":
		return
	_frames -= 1
	if _frames > 0:
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(_shot)
	print("[plan3d] %s -> %s  (узлов %d)"
			% ["ok" if err == OK else "ошибка %d" % err, _shot, get_child_count()])
	get_tree().quit()
