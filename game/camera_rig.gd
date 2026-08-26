class_name CameraRig
extends Node3D
## Изометрическая камера: фиксированный наклон, свободное вращение вокруг
## вертикальной оси, два пресета дистанции (улица / помещение).
##
## Коллизии у камеры нет намеренно: в изометрии она проходит сквозь геометрию,
## а мешающее гасится (см. occlusion.gd). Физическое тело в тесных комнатах
## приводит к постоянным рывкам.

const PITCH_DEG := 40.0        ## наклон, фиксирован
var pitch_override: float = 0.0   ## для обзорных планов сверху
const FOV := 16.0              ## узкий угол: почти ортогонально, но с объёмом
## При FOV 16 половина охвата = dist * tan(8°) ≈ dist * 0.14.
## Комната 5-6 м требует ~45 м дистанции, дом целиком — ~80.
const DIST_OUTDOOR := 80.0
const DIST_INDOOR := 46.0
const ROT_SPEED := 2.2         ## рад/с при удержании клавиши
const FOLLOW_LERP := 8.0

var yaw: float = deg_to_rad(45.0)
var target: Node3D
var indoor: bool = false
## Принудительная дистанция (для обзорных кадров планировки).
var dist_override: float = 0.0

var _dist: float = DIST_OUTDOOR
var _cam: Camera3D
var _pivot: Vector3


func _ready() -> void:
	_cam = Camera3D.new()
	_cam.fov = FOV
	_cam.far = 400.0
	_cam.near = 0.5
	add_child(_cam)
	if target:
		_pivot = target.global_position


func get_camera() -> Camera3D:
	return _cam


## Угол поворота камеры вокруг Y — по нему считается направление движения.
func get_yaw() -> float:
	return yaw


func _process(delta: float) -> void:
	var turn := 0.0
	if Input.is_physical_key_pressed(KEY_Q):
		turn += 1.0
	if Input.is_physical_key_pressed(KEY_E):
		turn -= 1.0
	yaw += turn * ROT_SPEED * delta

	if target:
		_pivot = _pivot.lerp(target.global_position, clampf(FOLLOW_LERP * delta, 0.0, 1.0))

	var want := dist_override if dist_override > 0.0 else (DIST_INDOOR if indoor else DIST_OUTDOOR)
	_dist = lerpf(_dist, want, clampf(3.0 * delta, 0.0, 1.0))

	var pitch := deg_to_rad(pitch_override if pitch_override > 0.0 else PITCH_DEG)
	var offset := Vector3(
		sin(yaw) * cos(pitch),
		sin(pitch),
		cos(yaw) * cos(pitch)
	) * _dist

	_cam.global_position = _pivot + offset
	_cam.look_at(_pivot + Vector3(0, 1.0, 0), Vector3.UP)


## Мгновенно поставить камеру (на старте, чтобы не было «проезда»).
func snap() -> void:
	if target:
		_pivot = target.global_position
	_dist = dist_override if dist_override > 0.0 else (DIST_INDOOR if indoor else DIST_OUTDOOR)
	_process(1.0)
