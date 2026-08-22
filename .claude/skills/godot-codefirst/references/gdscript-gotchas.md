# Грабли GDScript 4 (сверено с документацией Godot 4.7)

Полный справочник по языку — `docs/godot-docs/tutorials/scripting/gdscript/gdscript_basics.rst`.
Таблица переименований Godot 3 → 4 — `docs/godot-docs/tutorials/migrating/upgrading_to_godot_4.rst`.

## Пришло из Godot 3 — уже не работает

| Godot 3 | Godot 4 |
|---|---|
| `export var hp = 10` | `@export var hp: int = 10` |
| `onready var s = $Sprite` | `@onready var s: Sprite2D = $Sprite2D` |
| `tool`, `master`, `puppet` | `@tool`, `@rpc(...)` |
| `yield(get_tree(), "idle_frame")` | `await get_tree().process_frame` |
| `scene.instance()` | `scene.instantiate()` |
| `connect("pressed", self, "_on_p")` | `pressed.connect(_on_p)` |
| `emit_signal("died")` | `died.emit()` (старый вариант ещё работает) |
| `get_tree().change_scene(path)` | `get_tree().change_scene_to_file(path)` |
| `KinematicBody2D` + `move_and_slide(vel)` | `CharacterBody2D`, `velocity = ...` + `move_and_slide()` |
| `Spatial`, `Sprite`, `Position2D` | `Node3D`, `Sprite2D`, `Marker2D` |
| `SpatialMaterial`, `ParticlesMaterial` | `StandardMaterial3D`, `ParticleProcessMaterial` |
| `Particles`, `GIProbe`, `VisualServer` | `GPUParticles3D`, `VoxelGI`, `RenderingServer` |
| `PoolVector3Array` | `PackedVector3Array` |
| `File`, `Directory` | `FileAccess`, `DirAccess` (статические `open()`) |
| `OS.get_ticks_msec()` | `Time.get_ticks_msec()` |
| `OS.window_size`, `OS.set_window_*` | `DisplayServer.window_*` или `get_window().size` |
| `deg2rad`, `rad2deg`, `stepify` | `deg_to_rad`, `rad_to_deg`, `snapped` |
| `rand_range(a, b)` | `randf_range(a, b)` / `randi_range(a, b)` |
| `.method()` (вызов родителя) | `super.method()` |
| нода `Tween` | `create_tween()` |
| `update()` (перерисовка) | `queue_redraw()` |
| `empty()` | `is_empty()` |

Симптом «пришло из тройки»: ошибка вида
`Invalid call. Nonexistent function 'instance' in base 'PackedScene'`.

## Типы и значения

- **`5 / 2 == 2`**: если оба операнда `int`, деление целочисленное. Нужен `float` —
  пиши `5.0 / 2` или `float(a) / b`. Движок предупреждает (`INTEGER_DIVISION`).
- **По ссылке передаются**: `Object`, `Array`, `Dictionary` **и все packed-массивы**
  (`PackedByteArray`, `PackedVector3Array`, …). Всё остальное (`Vector2`, `Color`,
  `Transform3D`, `String`) — по значению. Нужна копия — `duplicate()`
  (для вложенных структур — `duplicate(true)`).
- `Vector2`/`Vector3` — значения: `node.position.x = 5` работает, а
  `var p = node.position; p.x = 5` **не** двигает ноду.
- Типизированные массивы инвариантны: `Array[Node]` нельзя присвоить в `Array[Node2D]`.
- `String` vs `StringName`: литерал `&"name"` — StringName (быстрое сравнение,
  для имён групп/анимаций/инпут-действий), `^"Path/Node"` — NodePath.

## Ноды и дерево

- `_ready()` у **детей вызывается раньше**, чем у родителя. Обращаться к чужим
  нодам «сверху вниз» в `_ready` ребёнка небезопасно — используй сигналы или
  инициализацию из родителя.
- `@onready` срабатывает непосредственно перед `_ready()`. В `_init()` нод ещё нет.
- `get_tree()` возвращает `null`, пока нода не в дереве. Проверяй `is_inside_tree()`.
- `free()` удаляет мгновенно и роняет всё, что обращается к ноде в этом кадре.
  Всегда `queue_free()`. Живость проверять `is_instance_valid(node)`.
- `%UniqueName` работает только если нода помечена как Scene Unique в редакторе
  (в код-первом подходе используй прямые ссылки на переменные).
- `$Path` — синтаксический сахар для `get_node("Path")`, падает, если ноды нет.
  Безопасно — `get_node_or_null(^"Path")`.
- Ноды, созданные в коде, получают имя автоматически. Если по ноде ходят RPC или
  `get_node()`, задавай `node.name = "Net"` явно — иначе путь у разных пиров разъедется.

## Сигналы и Callable

- Лямбда-подключение (`sig.connect(func(): ...)`) невозможно отключить по ссылке
  и держит захваченные переменные — для долгоживущих объектов подключай методы.
- Соединение автоматически рвётся при удалении **приёмника**, но не источника.
- Сеттер свойства контрола (`cb.button_pressed = true`) **не эмитит** `toggled` —
  при программной синхронизации UI эмитить вручную.
- Порядок аргументов: `sig.connect(callable, flags)`, флаги —
  `CONNECT_ONE_SHOT`, `CONNECT_DEFERRED`, `CONNECT_PERSIST`.
- `await sig` внутри `_ready()` превращает функцию в корутину: остаток `_ready`
  выполнится позже, чем ждут вызывающие.

## Процессинг и время

- `_process(delta)` зависит от FPS, `_physics_process(delta)` — фиксированный шаг.
  Любая физика и движение тел — только в `_physics_process`.
- Скорость всегда умножать на `delta`; `move_and_slide()` — **исключение**,
  он сам учитывает шаг физики (в отличие от `move_and_collide()`).
- `Engine.time_scale` замедляет и `delta`, и таймеры — учитывай в UI-анимациях.
- Пауза: `get_tree().paused = true` останавливает ноды по `process_mode`;
  меню и музыке ставить `PROCESS_MODE_ALWAYS`.
- Дорогая логика — по `Timer`/аккумулятору, а не каждый кадр.

## Ресурсы

- `preload()` принимает **только константный литерал пути**, вычисляется при
  компиляции скрипта. Динамический путь — `load()`.
- Ресурс, загруженный `load()`, кэшируется и **общий** для всех: правка
  `AudioStreamWAV.loop_mode` или материала испортит его везде. Меняешь —
  сначала `duplicate()`.
- `@export var res: Resource` в нескольких инстансах сцены ссылается на один и тот
  же объект, пока не включён `resource_local_to_scene = true`.
- `res://` в экспортированной игре **только на чтение**. Всё, что пишется, — в `user://`.
- Файлы `.import` обязаны быть в git, иначе экспорт не найдёт ассет.
- В 4.5+ `Resource.duplicate(true)` не дублирует внешние ресурсы —
  нужен `duplicate_deep(DEEP_DUPLICATE_ALL)`.

## Ввод

- `Input.is_action_pressed` — состояние, `Input.is_action_just_pressed` — фронт;
  «just»-варианты корректны только внутри `_process`/`_physics_process`.
- Раскладка: `Input.is_physical_key_pressed(KEY_W)` не зависит от языка ввода,
  `is_key_pressed` — зависит.
- Событие, обработанное в UI, доходит до `_input`, но не до `_unhandled_input`.
  Гасить своё событие: `get_viewport().set_input_as_handled()`.
- В 4.7 ID устройства мыши/клавиатуры — `InputEvent.DEVICE_ID_MOUSE` /
  `InputEvent.DEVICE_ID_KEYBOARD`, а не `0`.
- При активном `LineEdit`/`TextEdit` буквенные хоткеи будут срабатывать —
  нужен явный гейт по `has_focus()`.

## Строки, вывод, отладка

- Форматирование: `"HP: %d/%d" % [hp, max_hp]`, `"{a}".format({"a": 1})`.
  `%s` подходит для любого типа.
- `print()` пишет в stdout только у `*_console.exe` на Windows.
- `push_error()`/`push_warning()` попадают в отладчик, но выполнение не прерывают.
- `assert(cond, "msg")` вырезается из release-сборки — не держать в нём побочные эффекты.
- Ошибки парсинга скрипта видны только при загрузке сцены — прогоняй
  `--headless --quit-after N` после каждой правки.

## Классы

- `class_name A` + `class_name B`, ссылающиеся друг на друга типами, дают
  циклическую зависимость. Разрывать — типизировать как `Node` и приводить
  через `as`, либо через сигналы.
- Статические переменные (`static var`) живут до конца процесса — годятся для
  кэшей утилит, но это глобальное состояние.
- Внутренние классы (`class Foo:` внутри файла) не видны снаружи без `class_name`.

## Специфика 4.7 (см. docs/GODOT_4.7_NOTES.md)

- Присваивание элемента packed-массива не вызывает сеттер всего свойства.
- Переопределение метода с типизированным возвратом требует явного `return`.
- `TileMap` устарел — только `TileMapLayer`.
- 3D-физика по умолчанию Jolt; `SoftBody3D` и `WorldBoundaryShape3D` ведут себя иначе.
- `CanvasItem` больше не добавляет сглаживающее «перо» линиям — задавай толщину явно.
