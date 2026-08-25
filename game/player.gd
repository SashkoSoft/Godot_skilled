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
## Автопроход: если задан, игрок идёт к точке сам (проверка проходимости).
var auto_target: Vector3 = Vector3.INF

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
	mat.emission_energy_multiplier = 0.28
	_visual.material_override = mat
	add_child(_visual)

	# «Нос» — чтобы было видно, куда повёрнут персонаж.
	# Поворот считается через atan2(dir.x, dir.z), поэтому перёд — это +Z.
	var nose := MeshInstance3D.new()
	var nm := BoxMesh.new()
	nm.size = Vector3(0.12, 0.12, 0.4)
	nose.mesh = nm
	nose.position = Vector3(0, HEIGHT * 0.72, RADIUS + 0.15)
	nose.material_override = mat
	add_child(nose)


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta

	var dir := Vector3.ZERO
	if auto_target != Vector3.INF:
		var to := auto_target - global_position
		to.y = 0.0
		if to.length() > 0.35:
			dir = to.normalized()
		_step_up(dir, delta)
		var want_auto := dir * SPEED
		velocity.x = move_toward(velocity.x, want_auto.x, ACCEL * delta)
		velocity.z = move_toward(velocity.z, want_auto.z, ACCEL * delta)
		move_and_slide()
		floor_index = int(floor((global_position.y + 0.4) / Building.FLOOR_HEIGHT))
		return

	var raw := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if raw.length_squared() > 0.001 and rig:
		# Поворот ввода на текущий угол камеры: «вверх» — всегда от камеры вперёд.
		var yaw := rig.get_yaw()
		var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var right := Vector3(cos(yaw), 0.0, -sin(yaw))
		dir = (right * raw.x + forward * (-raw.y)).normalized()

	_step_up(dir, delta)
	var want := dir * SPEED
	velocity.x = move_toward(velocity.x, want.x, ACCEL * delta)
	velocity.z = move_toward(velocity.z, want.z, ACCEL * delta)

	move_and_slide()

	if dir.length_squared() > 0.001:
		var target_yaw := atan2(dir.x, dir.z)
		rotation.y = lerp_angle(rotation.y, target_yaw, clampf(12.0 * delta, 0.0, 1.0))

	floor_index = int(floor((global_position.y + 0.4) / Building.FLOOR_HEIGHT))


## Шаг на уступ. CharacterBody3D сам на ступеньку не поднимается: для него
## вертикальный уступ — стена. Пробуем «переставить ногу»: если впереди
## препятствие не выше STEP_MAX, поднимаем тело на его высоту.
const STEP_MAX := 0.45
const STEP_CHECK := 0.45


func _step_up(dir: Vector3, _delta: float) -> void:
	if dir.length_squared() < 0.001 or not is_on_floor():
		return
	var space := get_world_3d().direct_space_state
	var from := global_position + Vector3(0, 0.08, 0)
	var to := from + dir * STEP_CHECK

	var q := PhysicsRayQueryParameters3D.create(from, to)
	q.exclude = [get_rid()]
	if space.intersect_ray(q).is_empty():
		return   # впереди свободно, шагать некуда

	# Есть ли свободное место на высоте ступени?
	var up_from := global_position + Vector3(0, STEP_MAX + 0.05, 0)
	var up_to := up_from + dir * STEP_CHECK
	var q2 := PhysicsRayQueryParameters3D.create(up_from, up_to)
	q2.exclude = [get_rid()]
	if not space.intersect_ray(q2).is_empty():
		return   # это стена, а не ступень

	# Ищем высоту опоры и переставляем тело.
	var down_from := up_to
	var down_to := down_from - Vector3(0, STEP_MAX + 0.1, 0)
	var q3 := PhysicsRayQueryParameters3D.create(down_from, down_to)
	q3.exclude = [get_rid()]
	var hit := space.intersect_ray(q3)
	if hit.is_empty():
		return
	var step_y: float = hit["position"].y
	if step_y - global_position.y <= 0.02:
		return
	global_position.y = step_y + 0.02
	velocity.y = 0.0
