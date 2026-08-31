class_name Lift
extends AnimatableBody3D
## Кабина лифта: ездит между этажами и возит на себе всех, кто внутри.
##
## Кабина — AnimatableBody3D, поэтому CharacterBody3D на ней едет сам, без
## всякой ручной привязки. Пола внутри шахты нет — полом служит кабина.

const SPEED := 2.4              ## м/с
const DWELL := 1.6              ## сколько стоит с открытыми дверями, с
const CABIN_MODEL := "res://assets/models/lift/lift_cabin.glb"

var floors: int = 3
var rect: Rect2 = Rect2()       ## габарит шахты в плане

var _target_floor := 0
var _wait := DWELL
var _dir := 1


func setup(shaft: Rect2, floor_count: int) -> void:
	rect = shaft
	floors = floor_count
	sync_to_physics = false

	var size := Vector3(rect.size.x - 0.30, 0.20, rect.size.y - 0.30)
	# Кабина от houdini-assets: пивот в середине низа её проёма, отделка уходит
	# в +Z, лицом кабина смотрит в −Z. В шахте вход с востока, поэтому разворот
	# на −90° и сдвиг к внутренней грани восточной стенки.
	if ResourceLoader.exists(CABIN_MODEL):
		var cabin: Node3D = (load(CABIN_MODEL) as PackedScene).instantiate()
		cabin.position = Vector3(rect.size.x * 0.5 - Tower.WALL * 0.5, 0.0, 0.0)
		cabin.rotation.y = -PI * 0.5
		# Кабина сделана ровно по внутреннему размеру шахты (замер: 1.48 x 1.64,
		# грань в грань с бетоном). Совпадающие плоскости мерцали бы, поэтому
		# поджимаю на сантиметр с каждой стороны.
		cabin.scale = Vector3(0.988, 1.0, 0.988)
		add_child(cabin)
	else:
		var mesh := BoxMesh.new()
		mesh.size = size
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.55, 0.50, 0.42)
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		mi.position.y = -0.10
		add_child(mi)

	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	shape.position.y = -0.10
	add_child(shape)

	position = Vector3(rect.position.x + rect.size.x * 0.5, 0.0,
			rect.position.y + rect.size.y * 0.5)


## На каком этаже кабина прямо сейчас (−1, если едет).
func at_floor() -> int:
	var f := int(round(position.y / Tower.FLOOR_H))
	if absf(position.y - f * Tower.FLOOR_H) < 0.06:
		return f
	return -1


func inside(p: Vector3) -> bool:
	return rect.has_point(Vector2(p.x, p.z))


func _physics_process(delta: float) -> void:
	if floors < 2:
		return
	var want := _target_floor * Tower.FLOOR_H
	var d := want - position.y
	if absf(d) < 0.02:
		position.y = want
		_wait -= delta
		if _wait <= 0.0:
			_target_floor += _dir
			if _target_floor >= floors:
				_target_floor = floors - 2
				_dir = -1
			elif _target_floor < 0:
				_target_floor = 1
				_dir = 1
			_wait = DWELL
		return
	position.y += signf(d) * minf(SPEED * delta, absf(d))
