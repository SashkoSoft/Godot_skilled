class_name Player
extends CharacterBody3D
## Персонаж-заглушка: капсула. Движение — относительно камеры.
##
## Направление ввода пересчитывается по ТЕКУЩЕМУ углу камеры, а не по целевому:
## тогда во время доезда камеры после поворота курс доворачивается плавно вместе
## с ней, и персонаж не дёргается в момент нажатия кнопки поворота.

const SPEED := 4.2
const ACCEL := 28.0
const HEIGHT := 1.8
const RADIUS := 0.35

var rig: CameraRig
var floor_index: int = 0        ## этаж, на котором стоит игрок

var _visual: MeshInstance3D


func _ready() -> void:
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.height = HEIGHT
	cap.radius = RADIUS
	shape.shape = cap
	shape.position.y = HEIGHT * 0.5
	add_child(shape)

	_visual = MeshInstance3D.new()
	var mesh := CapsuleMesh.new()
	mesh.height = HEIGHT
	mesh.radius = RADIUS
	_visual.mesh = mesh
	_visual.position.y = HEIGHT * 0.5
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.95, 0.86, 0.52)
	mat.roughness = 0.6
	# Игрок должен читаться даже в тени и сквозь вырез в стене.
	mat.emission_enabled = true
	mat.emission = Color(0.95, 0.80, 0.35)
	mat.emission_energy_multiplier = 0.55
	_visual.material_override = mat
	add_child(_visual)

	# «Нос» — чтобы было видно, куда повёрнут персонаж.
	var nose := MeshInstance3D.new()
	var nm := BoxMesh.new()
	nm.size = Vector3(0.12, 0.12, 0.4)
	nose.mesh = nm
	nose.position = Vector3(0, HEIGHT * 0.72, -RADIUS - 0.15)
	nose.material_override = mat
	add_child(nose)


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta

	var raw := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var dir := Vector3.ZERO
	if raw.length_squared() > 0.001 and rig:
		# Поворот ввода на текущий угол камеры: «вверх» — всегда от камеры вперёд.
		var yaw := rig.get_yaw()
		var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var right := Vector3(cos(yaw), 0.0, -sin(yaw))
		dir = (right * raw.x + forward * (-raw.y)).normalized()

	var want := dir * SPEED
	velocity.x = move_toward(velocity.x, want.x, ACCEL * delta)
	velocity.z = move_toward(velocity.z, want.z, ACCEL * delta)

	move_and_slide()

	if dir.length_squared() > 0.001:
		var target_yaw := atan2(dir.x, dir.z)
		rotation.y = lerp_angle(rotation.y, target_yaw, clampf(12.0 * delta, 0.0, 1.0))

	floor_index = int(floor((global_position.y + 0.4) / Building.FLOOR_HEIGHT))
