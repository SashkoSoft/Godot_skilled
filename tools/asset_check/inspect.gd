extends SceneTree
## Печатает паспорт ассета: габариты, полигонаж, материалы, анимации, текстуры.
## Запуск через tools/asset_check/check.sh — вручную вызывать не нужно.

const SPEC_MAX_TRIS_PROP := 20000


func _init() -> void:
	var files := _collect("res://incoming")
	if files.is_empty():
		print("[check] В incoming/ пусто — положите туда файлы из delivery/<task-id>/v<N>/")
		quit(1)
		return

	print("[check] Файлов найдено: %d" % files.size())
	var problems: Array[String] = []

	for path in files:
		print("\n" + "=".repeat(70))
		print(path)
		print("=".repeat(70))
		match path.get_extension().to_lower():
			"glb", "gltf", "obj", "dae", "fbx":
				problems.append_array(_inspect_scene(path))
			"png", "webp", "exr", "hdr", "svg", "tga":
				problems.append_array(_inspect_image(path))
			_:
				print("  тип не проверяется")

	print("\n" + "=".repeat(70))
	if problems.is_empty():
		print("[check] Замечаний нет.")
	else:
		print("[check] Замечания (%d):" % problems.size())
		for p in problems:
			print("  - " + p)
	quit(0)


func _collect(dir_path: String) -> PackedStringArray:
	var out := PackedStringArray()
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if name.begins_with("."):
			name = dir.get_next()
			continue
		var full := dir_path.path_join(name)
		if dir.current_is_dir():
			out.append_array(_collect(full))
		elif not name.ends_with(".import"):
			out.append(full)
		name = dir.get_next()
	dir.list_dir_end()
	return out


func _inspect_scene(path: String) -> Array[String]:
	var problems: Array[String] = []
	var res := load(path)
	if res == null:
		problems.append("%s: не загружается (импорт не прошёл?)" % path.get_file())
		print("  ОШИБКА: не загружается")
		return problems
	if not (res is PackedScene):
		print("  не сцена: %s" % res.get_class())
		return problems

	var root: Node = (res as PackedScene).instantiate()
	var meshes: Array[MeshInstance3D] = []
	var anims: Array[AnimationPlayer] = []
	var skeletons := 0
	_walk(root, meshes, anims)

	var total_tris := 0
	var mats := {}
	var aabb := AABB()
	var first := true

	for mi in meshes:
		var mesh := mi.mesh
		if mesh == null:
			continue
		var mesh_tris := 0
		for s in mesh.get_surface_count():
			var arrays := mesh.surface_get_arrays(s)
			var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			mesh_tris += (idx.size() / 3) if idx.size() > 0 else (verts.size() / 3)
			var m := mi.get_active_material(s)
			if m != null:
				mats[m.resource_name if m.resource_name != "" else str(m)] = true
		total_tris += mesh_tris
		var box := mi.global_transform * mesh.get_aabb() if mi.is_inside_tree() else mesh.get_aabb()
		if first:
			aabb = box
			first = false
		else:
			aabb = aabb.merge(box)
		print("  меш: %-28s %6d tris, поверхностей: %d" % [mi.name, mesh_tris, mesh.get_surface_count()])

	for n in root.find_children("*", "Skeleton3D", true, false):
		skeletons += 1

	print("  ------")
	print("  габариты: %.2f x %.2f x %.2f м" % [aabb.size.x, aabb.size.y, aabb.size.z])
	print("  начало координат внутри габаритов: низ по Y = %.2f" % aabb.position.y)
	print("  всего треугольников: %d" % total_tris)
	print("  материалов: %d" % mats.size())
	print("  скелетов: %d" % skeletons)

	for ap in anims:
		var list := ap.get_animation_list()
		print("  анимации (%s): %s" % [ap.name, ", ".join(list)])

	# Проверки по ASSET_SPEC.md
	var max_dim: float = maxf(aabb.size.x, maxf(aabb.size.y, aabb.size.z))
	if max_dim > 200.0:
		problems.append("%s: габарит %.1f м — похоже на сантиметры вместо метров" % [path.get_file(), max_dim])
	if max_dim < 0.02 and max_dim > 0.0:
		problems.append("%s: габарит %.3f м — подозрительно мелко, проверьте единицы" % [path.get_file(), max_dim])
	if absf(aabb.position.y) > max_dim * 0.6 and max_dim > 0.0:
		problems.append("%s: пивот далеко от геометрии по Y (низ на %.2f м)" % [path.get_file(), aabb.position.y])
	if mats.size() > 3:
		problems.append("%s: материалов %d — каждый лишний это отдельный draw call" % [path.get_file(), mats.size()])
	if total_tris > SPEC_MAX_TRIS_PROP:
		problems.append("%s: %d треугольников — выше бюджета пропа (%d)" % [path.get_file(), total_tris, SPEC_MAX_TRIS_PROP])

	root.free()
	return problems


func _walk(n: Node, meshes: Array[MeshInstance3D], anims: Array[AnimationPlayer]) -> void:
	if n is MeshInstance3D:
		meshes.append(n)
	elif n is AnimationPlayer:
		anims.append(n)
	for c in n.get_children():
		_walk(c, meshes, anims)


func _inspect_image(path: String) -> Array[String]:
	var problems: Array[String] = []
	var tex := load(path)
	if tex == null:
		problems.append("%s: не загружается" % path.get_file())
		print("  ОШИБКА: не загружается")
		return problems
	if not (tex is Texture2D):
		print("  не текстура: %s" % tex.get_class())
		return problems

	var w := (tex as Texture2D).get_width()
	var h := (tex as Texture2D).get_height()
	print("  размер: %d x %d" % [w, h])

	if not _is_pow2(w) or not _is_pow2(h):
		problems.append("%s: %dx%d — не степень двойки, сжатие и мипмапы будут хуже" % [path.get_file(), w, h])

	var fname := path.get_file().to_lower()
	if fname.contains("normal"):
		print("  (карта нормалей: конвенцию Y+ автоматически не проверить — смотреть глазами)")
	return problems


func _is_pow2(v: int) -> bool:
	return v > 0 and (v & (v - 1)) == 0
