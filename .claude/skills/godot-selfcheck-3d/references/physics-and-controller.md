# Физика и персонаж: CharacterBody3D, RigidBody3D, коллизия из процедурного меша

## Контроллер от первого лица — рабочий минимум

```gdscript
extends CharacterBody3D

const SPEED := 5.0
const RUN_MULT := 2.2
const GRAVITY := 20.0        # своя, не из project.godot: игровое падение
const JUMP_SPEED := 9.9      # высота прыжка растёт как v², скорость — как √h
const MOUSE_SENS := 0.003

var yaw := 0.0
var pitch := 0.0
@onready var cam: Camera3D = $Camera3D

func _ready() -> void:
    Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
    floor_max_angle = deg_to_rad(62.0)   # см. ниже

func _input(event: InputEvent) -> void:
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        yaw -= event.relative.x * MOUSE_SENS
        pitch = clamp(pitch - event.relative.y * MOUSE_SENS, -1.4, 1.4)

func _physics_process(delta: float) -> void:
    rotation.y = yaw          # телом крутим по yaw
    cam.rotation.x = pitch    # камерой — по pitch
    var input := Vector3.ZERO
    if Input.is_physical_key_pressed(KEY_W): input.z -= 1.0
    if Input.is_physical_key_pressed(KEY_S): input.z += 1.0
    if Input.is_physical_key_pressed(KEY_A): input.x -= 1.0
    if Input.is_physical_key_pressed(KEY_D): input.x += 1.0
    var spd := SPEED * RUN_MULT if Input.is_physical_key_pressed(KEY_SHIFT) else SPEED
    var dir := (transform.basis * input).normalized()
    velocity.x = dir.x * spd
    velocity.z = dir.z * spd
    if is_on_floor():
        velocity.y = 0.0
        if Input.is_physical_key_pressed(KEY_SPACE):
            velocity.y = JUMP_SPEED
    else:
        velocity.y -= GRAVITY * delta
    move_and_slide()
    if global_position.y < spawn.y - 12.0:   # провалился сквозь мир
        global_position = spawn
        velocity = Vector3.ZERO
```

Обязательные детали:
- **Страховка от провала**: любая процедурная геометрия рано или поздно даёт
  дырку. Возврат на спавн при падении ниже уровня спасает сессию (и тест).
- **`floor_max_angle`**: дефолт 45°. Деформированный/наклонный пол местами
  круче, и `move_and_slide` считает его стеной — персонаж «упирается в воздух»
  на пандусе. Поднимай осознанно, у нас 62°.
- **`is_physical_key_pressed`** — не зависит от раскладки (на кириллице
  `is_key_pressed(KEY_W)` молчит).
- **Не пересоздавай игрока** при перестройке мира: слетит `Input.mouse_mode`
  и захват мыши. Телепортируй существующего.
- Гейт по фокусу поля ввода (чат) — иначе набор текста бегает и прыгает.

## Коллизия из процедурного меша

Рендер-меш и коллизия — **разные меши**, и это не оптимизация, а корректность:

| | Рендер | Коллизия |
|---|---|---|
| стороны | односторонний + `cull_disabled` в материале | оба winding'а |
| сглаживание | сглаженные нормали | плоские, нормали не нужны |
| толщина стен | толстый короб (0.4 м) | тонкая осевая лента |

- **Winding важен для физики.** Материал с `cull_disabled` рисует обе стороны,
  но `ConcavePolygonShape3D` уважает направление треугольников: у пола с
  нормалью вниз капсула проваливается. Лечится генерацией коллизионного меша с
  треугольниками в обе стороны (`tris + reversed(tris)`).
- **Толстые стены в коллизии не нужны**: капсула клинится в дверных проёмах и
  углах. Рисуй толсто, сталкивай тонко.

```gdscript
var body := StaticBody3D.new()
var cs := CollisionShape3D.new()
cs.shape = collision_mesh.create_trimesh_shape()
body.add_child(cs)
```

`create_trimesh_shape()` — только для статики. Для движущихся тел — примитивы
(`BoxShape3D`, `SphereShape3D`, `CapsuleShape3D`) или `ConvexPolygonShape3D`.

## RigidBody3D: снаряды и предметы

- **Туннелирование**: тонкая стена + быстрое тело = пролёт насквозь.
  `continuous_cd = true` (проверено на 100 м/с).
- **Упругость — свойство обоих тел.** `PhysicsMaterial` с `bounce` нужен и мячу
  (0.85), и статической геометрии уровня (0.7). Забыл второй — мяч не скачет.
- **Точка и нормаль контакта**: у сигнала `body_entered` их нет. Включи
  `contact_monitor` + `max_contacts_reported`, бери из
  `_integrate_forces(state)`: `state.get_contact_local_position(i)` /
  `get_contact_local_normal(i)`.
- **Из физического колбэка нельзя менять дерево** — только
  `call_deferred("add_child", node)`.
- **Снаряд убивает стрелка на вылете**, если родился внутри его капсулы:
  `add_collision_exception_with(shooter)` и снятие через ~0.5 с. Та же грабля
  у ИИ-стрелков.
- Урон «по скорости» считай от `linear_velocity.length()` в момент контакта, а
  не от факта касания — тогда одна формула работает и для игрока, и для ботов.

## Прицеливание и баллистика для ИИ

Бросок в движущуюся цель без итеративного решения:
1. «плоское время» — `t = dist / speed`;
2. упреждение — цель + её скорость × t;
3. компенсация гравитации — добавить к вертикальной составляющей
   `0.5 * g * t`.

Важно: у игрока и у снарядов гравитация может отличаться (у нас 20 против
дефолтных 9.8) — считай компенсацию по той, что реально действует на снаряд,
иначе ИИ стабильно недолетает. Множитель к компенсации (`arc = 1.7`) даёт
навесную мортиру бесплатно.

## Мир → сетка

Если игрок ездит на физике, а логика (ИИ, поиск пути) живёт в клетках, нужна
функция `world_to_cell`. При деформированной геометрии прямой формулы нет —
работает итерация неподвижной точки: 4 итерации `p - warp_offset(p)` дают
ошибку < 0.35 клетки. Обратно — `cell_center()` через тот же `warp`, чтобы
боты и предметы стояли ровно там, где пол.
