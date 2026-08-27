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
var watcher: Player
var lifts: Array = []        ## кабины, которыми житель умеет пользоваться
var use_lift := true          ## чей этаж показываем: жителей с других этажей не рисуем
var floor_index: int = 0

var _targets: Array[Vector3] = []
var _stuck := 0.0
var _last_pos := Vector3.ZERO
var _check := 0.0
var _retried := 0
var _since_target := 0.0
var _cur := Vector3.INF

enum LiftState { NONE, GOTO, WAIT, ENTER, RIDE, LEAVE }
var _lift: Lift = null
var _ls: LiftState = LiftState.NONE
var _ls_time := 0.0
var _ride_to := 0
var rides := 0
var _cool := 0.0             ## пауза после поездки, чтобы не кататься по кругу               ## сколько раз проехал на лифте
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
	if _ls != LiftState.NONE:
		_lift_step(delta)
		return
	_maybe_take_lift()
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0

	_cool = maxf(_cool - delta, 0.0)
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


## Ждать кабину у двери, зайти, доехать, выйти. Пока житель занят лифтом,
## обычная навигация не работает — иначе он уедет из кабины на полпути.
func _lift_step(delta: float) -> void:
	_ls_time += delta
	if _ls_time > 16.0:                     # лифт не дождались — идём пешком
		_ls = LiftState.NONE
		_lift = null
		_cool = 20.0
		agent.target_position = _cur
		return
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0
	var here := int(floor((global_position.y + 0.4) / Tower.FLOOR_H))
	var door := Vector3(_lift.rect.position.x + _lift.rect.size.x + 0.55,
			global_position.y,
			_lift.rect.position.y + _lift.rect.size.y * 0.5)
	var cabin := Vector3(_lift.rect.position.x + _lift.rect.size.x * 0.5,
			global_position.y,
			_lift.rect.position.y + _lift.rect.size.y * 0.5)

	match _ls:
		LiftState.GOTO:
			# к двери лифта идём НАВИГАЦИЕЙ: напрямую он упрётся в стену
			if agent.target_position.distance_to(door) > 0.3:
				agent.target_position = door
			var flat := Vector2(door.x - global_position.x, door.z - global_position.z)
			if flat.length() < 1.1:
				_ls = LiftState.WAIT
			else:
				_walk_path(delta)
		LiftState.WAIT:
			velocity.x = 0.0
			velocity.z = 0.0
			move_and_slide()
			if _lift.at_floor() == here:
				_ls = LiftState.ENTER
				_ls_time = 0.0
		LiftState.ENTER:
			if _lift.at_floor() != here and not _lift.inside(global_position):
				_ls = LiftState.WAIT          # уехал без нас, ждём снова
			elif _step_to(cabin, delta, 0.30):
				_ls = LiftState.RIDE
				_ls_time = 0.0
		LiftState.RIDE:
			velocity.x = 0.0
			velocity.z = 0.0
			move_and_slide()
			if _lift.at_floor() == _ride_to:
				_ls = LiftState.LEAVE
				_ls_time = 0.0
				rides += 1
				if _log:
					print("[бот] %s приехал на лифте на этаж %d" % [_name, _ride_to])
		LiftState.LEAVE:
			var out := Vector3(door.x + 0.7, global_position.y, door.z)
			if _step_to(out, delta, 0.4) and not _lift.inside(global_position):
				_ls = LiftState.NONE
				_lift = null
				_cool = 5.0
				agent.target_position = _cur
	floor_index = int(floor((global_position.y + 0.4) / Tower.FLOOR_H))
	if watcher != null:
		visible = floor_index == watcher.floor_index


## Обычный шаг по маршруту навигации.
func _walk_path(delta: float) -> void:
	var next := agent.get_next_path_position()
	var dir := next - global_position
	dir.y = 0.0
	if dir.length() > 0.05:
		dir = dir.normalized()
		velocity.x = dir.x * SPEED
		velocity.z = dir.z * SPEED
		rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), TURN * delta)
	else:
		velocity.x = 0.0
		velocity.z = 0.0
	move_and_slide()


## Шаг к точке напрямую, без навигации: внутри шахты сетки нет.
func _step_to(p: Vector3, delta: float, near: float) -> bool:
	var dir := p - global_position
	dir.y = 0.0
	if dir.length() < near:
		velocity.x = 0.0
		velocity.z = 0.0
		move_and_slide()
		return true
	dir = dir.normalized()
	velocity.x = dir.x * SPEED * 0.8
	velocity.z = dir.z * SPEED * 0.8
	rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), TURN * delta)
	move_and_slide()
	return false


## Стоит ли ехать лифтом: цель на другом этаже и кабина ближе лестницы.
func _maybe_take_lift() -> void:
	if _cool > 0.0:
		return
	if not use_lift or lifts.is_empty() or _cur == Vector3.INF:
		return
	var here := int(floor((global_position.y + 0.4) / Tower.FLOOR_H))
	var want := int(floor((_cur.y + 0.4) / Tower.FLOOR_H))
	if want == here:
		return
	var best: Lift = null
	var best_d := 14.0
	for l in lifts:
		var lift := l as Lift
		var door := Vector3(lift.rect.position.x + lift.rect.size.x + 0.55,
				global_position.y, lift.rect.position.y + lift.rect.size.y * 0.5)
		var d := Vector2(door.x - global_position.x, door.z - global_position.z).length()
		if d < best_d:
			best_d = d
			best = lift
	if best == null:
		return
	_lift = best
	_ride_to = want
	_ls = LiftState.GOTO
	_ls_time = 0.0


func stats() -> Array:
	return [_reached, _failed]
