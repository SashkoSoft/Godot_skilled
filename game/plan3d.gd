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
	_light()
	_camera()


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
	var m_wall := _mat(Color(0.74, 0.72, 0.68))
	var m_floor := _mat(Color(0.42, 0.41, 0.40), 1.0)
	var m_sill := _mat(Color(0.80, 0.78, 0.74))
	var m_closet := _mat(Color(0.62, 0.56, 0.48))

	var b: Array = _plan["bounds"]
	_box(Vector3(b[2] - b[0], 0.16, b[3] - b[1]),
			Vector3((b[0] + b[2]) * 0.5, -0.08, (b[1] + b[3]) * 0.5), m_floor, "Slab")

	for r in _plan["walls"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.02 or d < 0.02:
			continue
		_box(Vector3(w, h, d),
				Vector3((float(r[0]) + float(r[2])) * 0.5, h * 0.5,
						(float(r[1]) + float(r[3])) * 0.5), m_wall, "Wall")

	# Окно: снизу подоконная часть, сверху перемычка, между ними проём.
	for r in _plan["windows"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		if w < 0.02 or d < 0.02:
			continue
		var cx: float = (float(r[0]) + float(r[2])) * 0.5
		var cz: float = (float(r[1]) + float(r[3])) * 0.5
		_box(Vector3(w, sill, d), Vector3(cx, sill * 0.5, cz), m_sill, "Sill")
		_box(Vector3(w, h - lintel, d), Vector3(cx, (h + lintel) * 0.5, cz),
				m_sill, "Lintel")

	for r in _plan["closets"]:
		var w: float = float(r[2]) - float(r[0])
		var d: float = float(r[3]) - float(r[1])
		_box(Vector3(w, 2.2, d), Vector3((float(r[0]) + float(r[2])) * 0.5, 1.1,
				(float(r[1]) + float(r[3])) * 0.5), m_closet, "Closet")


func _light() -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -38, 0)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	add_child(sun)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.22, 0.24, 0.28)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.55, 0.58, 0.64)
	e.ambient_light_energy = 0.9
	env.environment = e
	add_child(env)


func _camera() -> void:
	var b: Array = _plan["bounds"]
	var cx: float = (float(b[0]) + float(b[2])) * 0.5
	var cz: float = (float(b[1]) + float(b[3])) * 0.5
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 21.0
	cam.current = true
	add_child(cam)                      # look_at работает только внутри дерева
	cam.global_position = Vector3(cx + 13.0, 17.0, cz + 13.0)
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
