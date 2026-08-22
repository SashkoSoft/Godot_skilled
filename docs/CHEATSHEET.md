# GDScript 4.7 — рабочая шпаргалка

Все конструкции сверены с `docs/godot-docs/classes/` и кодом `docs/godot-demo-projects/` (Godot 4.7).
Стиль соответствует официальному `tutorials/scripting/gdscript/gdscript_styleguide.rst`:
табы для отступов, `snake_case` для файлов/переменных/функций, `PascalCase` для классов,
`CONSTANT_CASE` для констант, статическая типизация везде, где возможно.

## Порядок объявлений в скрипте

```gdscript
class_name Player
extends CharacterBody2D
## Документирующий комментарий класса (два решётки).

signal died
signal health_changed(new_value: int)

enum State { IDLE, RUN, JUMP }

const MAX_SPEED := 300.0

@export var jump_velocity: float = -700.0
@export_range(1, 10) var lives: int = 3
@export_group("Combat")
@export var damage: int = 1

var _state: State = State.IDLE

@onready var sprite: Sprite2D = $Sprite2D
@onready var anim: AnimationPlayer = $AnimationPlayer
@onready var hud: Control = %HUD          # % = уникальное имя ноды в сцене


func _ready() -> void:
	pass

func _physics_process(delta: float) -> void:
	pass
```

## Жизненный цикл ноды

| Метод | Когда |
|---|---|
| `_init()` | конструктор объекта, ноды ещё нет в дереве |
| `_enter_tree()` | нода добавлена в дерево (может вызываться повторно) |
| `_ready()` | все дети готовы; вызывается один раз (сверху вниз — дети раньше родителя) |
| `_process(delta)` | каждый кадр отрисовки |
| `_physics_process(delta)` | фиксированный шаг физики (по умолчанию 60 Гц) |
| `_input(event)` / `_unhandled_input(event)` | ввод; для геймплея — `_unhandled_input` |
| `_notification(what)` | системные уведомления (`NOTIFICATION_WM_CLOSE_REQUEST` и др.) |
| `_exit_tree()` | удаление из дерева |

## Персонаж 2D

```gdscript
extends CharacterBody2D

const SPEED := 300.0
const JUMP_VELOCITY := -700.0

func _physics_process(delta: float) -> void:
	# get_gravity() учитывает Area2D и настройки проекта — не хардкодить гравитацию.
	if not is_on_floor():
		velocity += get_gravity() * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	var direction := Input.get_axis("move_left", "move_right")
	velocity.x = move_toward(velocity.x, direction * SPEED, SPEED * 6.0 * delta)

	move_and_slide()   # двигает по velocity, обрабатывает склоны и стены

	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		# c.get_collider(), c.get_normal(), c.get_position()
```

Полезное у `CharacterBody2D/3D`: `is_on_floor()`, `is_on_wall()`, `is_on_ceiling()`,
`get_real_velocity()`, `floor_max_angle`, `floor_snap_length`, `motion_mode`
(`MOTION_MODE_GROUNDED` для платформеров, `MOTION_MODE_FLOATING` для видов сверху),
`up_direction`, `apply_floor_snap()`.

Для 3D — то же самое, `Vector3`, направление обычно:
`var dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()`.

Ручное движение без скольжения: `move_and_collide(velocity * delta)` — возвращает
`KinematicCollision2D` или `null`.

## Ввод

```gdscript
Input.is_action_pressed("fire")          # удерживается
Input.is_action_just_pressed("jump")     # нажата в этом кадре
Input.is_action_just_released("jump")
Input.get_axis("left", "right")          # -1..1
Input.get_vector("left", "right", "up", "down")   # Vector2, с deadzone

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		get_viewport().set_input_as_handled()
	if event is InputEventMouseButton and event.pressed:
		pass
```

Действия заводятся в **Project Settings → Input Map**. В 4.7 ID устройства мыши/клавиатуры —
`InputEvent.DEVICE_ID_MOUSE` / `InputEvent.DEVICE_ID_KEYBOARD`, а не `0`.

## Сигналы

```gdscript
signal health_changed(new_value: int)

# подключение (современный синтаксис, без строк)
health_changed.connect(_on_health_changed)
button.pressed.connect(_on_button_pressed)
button.pressed.connect(_on_shoot.bind(weapon_id))     # доп. аргумент
area.body_entered.connect(_on_body_entered, CONNECT_ONE_SHOT)

health_changed.emit(50)                                # испускание
health_changed.disconnect(_on_health_changed)
if health_changed.is_connected(_on_health_changed): pass

await health_changed                                   # ждать сигнал
await get_tree().create_timer(1.5).timeout             # пауза 1.5 с
await get_tree().process_frame                         # дождаться кадра
```

## Дерево сцены, инстансинг, группы

```gdscript
@onready var enemy_scene: PackedScene = preload("res://enemies/enemy.tscn")

var enemy := enemy_scene.instantiate() as Enemy
enemy.global_position = spawn_point.global_position
add_child(enemy)

queue_free()                       # безопасное удаление в конце кадра
get_tree().current_scene
get_node_or_null(^"Path/To/Node")  # ^"..." — NodePath-литерал, быстрее строки
%UniqueName                        # уникальное имя (Scene Unique Node)

add_to_group("enemies")
get_tree().get_nodes_in_group("enemies")
get_tree().call_group("enemies", "take_damage", 1)
```

Смена сцены и пауза:

```gdscript
get_tree().change_scene_to_file("res://levels/level_2.tscn")
get_tree().change_scene_to_packed(preload("res://levels/level_2.tscn"))

get_tree().paused = true
# у нод, которые должны работать на паузе (меню, музыка):
process_mode = Node.PROCESS_MODE_ALWAYS
# PROCESS_MODE_INHERIT / PAUSABLE / WHEN_PAUSED / ALWAYS / DISABLED
```

## Автозагрузки (синглтоны)

Project Settings → Autoload; путь к скрипту или сцене, имя становится глобальным:

```gdscript
# res://autoload/game_state.gd
extends Node
var score: int = 0
signal score_changed(value: int)

# в любом другом скрипте:
GameState.score += 10
```

Когда автозагрузка оправдана, а когда нет — `tutorials/best_practices/autoloads_versus_regular_nodes.rst`.

## Таймеры и твины

```gdscript
await get_tree().create_timer(2.0).timeout

var t := create_tween()
t.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
t.tween_property(self, "modulate:a", 0.0, 0.4)
t.parallel().tween_property(self, "scale", Vector2.ZERO, 0.4)
t.tween_callback(queue_free)
await t.finished
```

Нода `Timer`: `wait_time`, `one_shot`, `autostart`, сигнал `timeout`.

## Ресурсы и данные

```gdscript
const Bullet := preload("res://bullet.tscn")     # на этапе компиляции
var tex := load("res://icon.svg") as Texture2D   # в рантайме

# кастомный ресурс-данные
class_name WeaponData
extends Resource
@export var damage: int = 10
@export var fire_rate: float = 0.2
```

Фоновая загрузка (`loading/load_threaded` в демках):

```gdscript
ResourceLoader.load_threaded_request(path)
var progress: Array = []
match ResourceLoader.load_threaded_get_status(path, progress):
	ResourceLoader.THREAD_LOAD_IN_PROGRESS: print(progress[0])
	ResourceLoader.THREAD_LOAD_LOADED: var res := ResourceLoader.load_threaded_get(path)
	ResourceLoader.THREAD_LOAD_FAILED: push_error("fail")
```

## Сохранение игры

```gdscript
const SAVE_PATH := "user://save.json"   # user:// — папка пользователя, res:// только на чтение

func save_game(data: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		push_error("Save failed: %s" % FileAccess.get_open_error())
		return
	f.store_string(JSON.stringify(data, "\t"))

func load_game() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}
```

Бинарно: `store_var()` / `get_var()`. С шифрованием: `FileAccess.open_encrypted_with_pass()`.
Подробно — `tutorials/io/saving_games.rst`.

## Типизация и полезный синтаксис

```gdscript
var speed := 10.0                     # вывод типа
var names: Array[String] = []         # типизированный массив
var scores: Dictionary[String, int] = {}
@export var scene: PackedScene

for i in range(0, 10, 2): pass
match state:
	State.IDLE: pass
	State.RUN, State.JUMP: pass
	_: pass

if node is Enemy: (node as Enemy).take_damage(1)

func heal(amount: int = 1) -> void: pass
static func make() -> Player: return Player.new()

randomize()                           # в 4.x seed и так случайный, вызов не обязателен
randi_range(1, 6)
randf_range(0.0, 1.0)
array.pick_random()

lerp(a, b, 0.5); move_toward(a, b, delta); clampf(x, 0.0, 1.0)
Vector2.ZERO / Vector2.UP / Vector2.RIGHT
print(), print_debug(), push_warning(), push_error()
assert(hp > 0, "hp must be positive")   # только в debug-сборке
```

## Тайлмапы (4.7)

`TileMap` — устаревший. Использовать ноды **`TileMapLayer`**, по одной на слой.

```gdscript
@onready var ground: TileMapLayer = $Ground

var cell := ground.local_to_map(global_position)
ground.set_cell(cell, source_id, atlas_coords, alternative_tile)
ground.erase_cell(cell)
var data := ground.get_cell_tile_data(cell)   # кастомные данные тайла
```

Статьи: `tutorials/2d/using_tilesets.rst`, `using_tilemaps.rst`; демо `2d/dynamic_tilemap_layers`.

## UI

- Layout: якоря и `Container`-ы (`VBoxContainer`, `HBoxContainer`, `MarginContainer`,
  `GridContainer`, `CenterContainer`). Ручные позиции у Control — почти всегда ошибка.
- Масштабирование под разрешения: Project Settings → `display/window/stretch/*`
  (в 4.7 по умолчанию `canvas_items` + `expand`), демо `gui/multiple_resolutions`.
- Оформление — ресурсы `Theme` (`tutorials/ui/gui_skinning.rst`), демо `gui/theming`.
- `CanvasLayer` — UI поверх игрового мира, не двигается с камерой.

## Запуск и экспорт из командной строки

Исполняемый файл проекта: `Godot_v4.7-stable_win64_console.exe` (даёт вывод в консоль;
`Godot_v4.7-stable_win64.exe` — без консоли).

```bash
# запустить проект
./Godot_v4.7-stable_win64_console.exe --path game

# запустить конкретную сцену
./Godot_v4.7-stable_win64_console.exe --path game --scene res://levels/level_1.tscn

# открыть редактор
./Godot_v4.7-stable_win64_console.exe --path game -e

# прогнать скрипт без окна (тесты, генерация ассетов)
./Godot_v4.7-stable_win64_console.exe --headless --path game --script res://tools/check.gd --quit

# экспорт (пресет должен быть в export_presets.cfg)
./Godot_v4.7-stable_win64_console.exe --headless --path game --export-release "Windows Desktop" build/game.exe
./Godot_v4.7-stable_win64_console.exe --headless --path game --export-debug "Web" build/web/index.html

# импортировать ассеты, не открывая редактор (полезно для CI)
./Godot_v4.7-stable_win64_console.exe --headless --path game --import
```

Прочее: `--verbose`, `--quit-after N`, `--resolution 1280x720`, `--rendering-method forward_plus|mobile|gl_compatibility`,
`--write-movie out.avi` (запись видео), `--` для аргументов игры (`OS.get_cmdline_user_args()`).
Полный список — `tutorials/editor/command_line_tutorial.rst`.

## Структура проекта (рекомендация из best practices)

```
game/
	project.godot
	assets/            # спрайты, звуки, шрифты
	scenes/            # .tscn по фичам
	scripts/ или рядом со сценами
	autoload/
	resources/         # .tres — данные (оружие, уровни, настройки)
	addons/
```

Ключевой принцип Godot: **сцена = переиспользуемая сущность**, композиция из мелких сцен важнее
глубокой иерархии наследования. См. `tutorials/best_practices/scene_organization.rst`.
