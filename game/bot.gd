class_name Bot
extends CharacterBody3D
## Житель дома: ходит по навигационной сетке от помещения к помещению.
##
## Цели берутся из той же таблицы ROOMS, что строит дом, поэтому бот обходит
## именно комнаты, а не случайные точки пола. Если путь не строится или бот
## застрял — берёт следующую цель, а не буксует на месте.

const SPEED := 1.3
const TURN := 9.0
const GRAVITY := 22.0
const STUCK_TIME := 1.5         ## столько стоим на месте, прежде чем что-то делать
const NUDGES := 6               ## сколько раз качнуться вбок, прежде чем сдаться

var agent: NavigationAgent3D
var watcher: Player          ## чей этаж показываем: жителей с других этажей не рисуем
var floor_index: int = 0

var _targets: Array[Vector3] = []
var _stuck := 0.0
var _last_pos := Vector3.ZERO
var _check := 0.0
var _retried := 0
var _since_target := 0.0
var _cur := Vector3.INF
var cycle := true            ## false — обойти список один раз и остановиться
var done := false
var visited: Array = []      ## [цель, дошёл ли]
var _reached := 0
var _failed := 0
var _log := false
var _name := "бот"


func setup(spawn: Vector3, targets: Array[Vector3], colour: Color, log_moves: bool,
		label: String) -> void:
	position = spawn
	_targets = targets
	_log = log_moves
	_name = label

	# Коллизия бота уже, чем коридор, который ему строит навигация: иначе он
	# трётся плечом о косяк и встаёт намертво там, где путь формально есть.
	var cap := CapsuleShape3D.new()
	cap.height = Player.HEIGHT
	cap.radius = 0.20
	var shape := CollisionShape3D.new()
	shape.shape = cap
	shape.position.y = Player.HEIGHT * 0.5
	add_child(shape)

	var mesh := CapsuleMesh.new()
	mesh.height = Player.HEIGHT
	mesh.radius = Player.RADIUS
	var mat := StandardMaterial3D.new()
	mat.albedo_color = colour
	mat.emission_enabled = true
	mat.emission = colour
	mat.emission_energy_multiplier = 0.35
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position.y = Player.HEIGHT * 0.5
	add_child(mi)

	agent = NavigationAgent3D.new()
	agent.radius = Navigation.AGENT_RADIUS
	agent.height = Player.HEIGHT
	agent.path_desired_distance = 0.30
	agent.target_desired_distance = 0.55
	agent.path_max_distance = 3.0
	agent.avoidance_enabled = false
	add_child(agent)


func start() -> void:
	_next_target()


func _next_target(ok := true) -> void:
	if _cur != Vector3.INF:
		visited.append([_cur, ok])
	if _targets.is_empty():
		done = true
		_cur = Vector3.INF
		return
	# Берём цель подальше: если она рядом, агент отчитается о приходе в тот же
	# кадр, и бот будет «доходить» до целей сотнями раз в секунду, не двигаясь.
	var t: Vector3 = _targets.pop_front()
	if cycle:
		_targets.append(t)             # цели идут по кругу
		for _try in mini(_targets.size(), 12):
			if t.distance_to(global_position) > 3.0:
				break
			t = _targets.pop_front()
			_targets.append(t)
	_cur = t
	agent.target_position = t
	_stuck = 0.0
	_retried = 0
	_since_target = 0.0


func _physics_process(delta: float) -> void:
	if agent == null or done:
		return
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0

	_since_target += delta
	if _since_target > 0.3 and agent.is_navigation_finished():
		_reached += 1
		if _log:
			print("[бот] %s дошёл до цели %d, этаж %d, позиция (%.1f, %.1f, %.1f)"
					% [_name, _reached, floor_index, position.x, position.y, position.z])
		if _log:
			print("[бот] %s длина пути %d, следующая точка (%.1f, %.1f, %.1f)"
					% [_name, agent.get_current_navigation_path().size(),
							agent.get_next_path_position().x,
							agent.get_next_path_position().y,
							agent.get_next_path_position().z])
		_next_target()
		return

	var next := agent.get_next_path_position()
	var climb := absf(next.y - global_position.y)
	var speed := SPEED * (0.65 if climb > 0.12 else 1.0)   # на марше тише
	var dir := next - global_position
	dir.y = 0.0
	if dir.length() > 0.05:
		dir = dir.normalized()
		velocity.x = dir.x * speed
		velocity.z = dir.z * speed
		var want := atan2(dir.x, dir.z)
		rotation.y = lerp_angle(rotation.y, want, TURN * delta)
	else:
		velocity.x = 0.0
		velocity.z = 0.0

	move_and_slide()
	floor_index = int(floor((global_position.y + 0.4) / Tower.FLOOR_H))
	if watcher != null:
		visible = floor_index == watcher.floor_index

	# Смещение считаем не за кадр (за кадр его всегда мало), а за полсекунды.
	_check += delta
	if _check >= 0.5:
		if global_position.distance_to(_last_pos) < 0.15:
			_stuck += _check
			if _stuck > STUCK_TIME:
				# Сначала пробуем перестроить путь и качнуться вбок: чаще всего
				# бот просто трётся плечом о косяк и не может из него выйти.
				if _retried < NUDGES:
					# Чаще всего бот просто трётся плечом о косяк: качаем его
					# вбок, поочерёдно в разные стороны, и перестраиваем путь.
					_retried += 1
					_stuck = 0.0
					var dir2 := (agent.get_next_path_position() - global_position)
					dir2.y = 0.0
					if dir2.length() < 0.01:
						dir2 = Vector3(0, 0, 1)
					var side := Vector3(-dir2.z, 0.0, dir2.x).normalized()
					if _retried % 2 == 0:
						side = -side
					global_position += side * 0.22 + dir2.normalized() * 0.10
					agent.target_position = agent.target_position
				else:
					_failed += 1
					if _log:
						print("[бот] %s ЗАСТРЯЛ у (%.1f, %.1f, %.1f), беру следующую цель"
								% [_name, position.x, position.y, position.z])
					_next_target(false)
		else:
			_stuck = 0.0
		_last_pos = global_position
		_check = 0.0


func stats() -> Array:
	return [_reached, _failed]
