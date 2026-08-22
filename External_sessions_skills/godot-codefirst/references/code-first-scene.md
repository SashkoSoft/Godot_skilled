# Архитектура кода: сцена целиком из GDScript

## Скелет

```
main.tscn   # 4 строки: Node3D + script
main.gd     # точка входа, мир, UI, ввод, игровая логика
player.gd   # CharacterBody3D, FPV-контроллер
<домен>.gd  # bot / prizes / sfx / net / signs — по одному файлу на подсистему
```

`main.gd` растёт до 3–5k строк и это нормально, если разбит баннерами-комментариями
и функциями `_build_*` (создать) / `_apply_*` (применить настройку) / `_update_*`
(каждый кадр). Дробить раньше — только мешать грепу.

## `_ready()` — строгий порядок

```gdscript
func _ready() -> void:
    _setup_scene()   # WorldEnvironment, солнце, камера — создаются ОДИН раз
    _build_ui()      # CanvasLayer'ы, живут через все перестройки мира
    _regenerate()    # собственно мир (может вызываться повторно)
    _shot_if_asked() # dev-харнесс, всегда последним (см. self-test.md)
```

Разделяй «создаётся один раз» и «пересобирается»:
- `_setup_scene` / `_build_ui` — среда, свет-солнце, HUD, игрок.
- `_regenerate()` — новый сид → `_rebuild()`.
- `_rebuild()` — снести старые ноды мира (`queue_free`), собрать заново.

**Игрока в `_rebuild` НЕ пересоздавать** — при пересоздании слетает захват мыши
(`Input.mouse_mode`), и после каждой генерации управление ломается. Телепортируй
существующую ноду.

В конце `_rebuild` обязательно переприменяй все тумблеры (`_apply_flashlight`,
`_apply_lamp_toggle`, `_apply_low_spec`, …): свежие ноды родились с дефолтами,
а пользователь эти галки уже снял. Это источник багов «настройка отвалилась
после генерации».

## Параметры мира: слайдеры пишут, кнопка строит

```gdscript
func _on_param(param: String, v: float) -> void:
    match param:
        "strength": Distortion.strength = v
        "floors":   FLOORS = int(v)
        # ...только присваивание, никакой перестройки
```

Слайдер на тяжёлой генерации (секунды) нельзя вешать на `value_changed` →
интерфейс встанет колом. Слайдеры складывают значения в живые переменные,
перестройка — по кнопке «Сгенерировать».

## UI из кода

Один хелпер на тип контрола — и панель собирается за 20 строк:

```gdscript
func _slider(parent: Control, label: String, minv: float, maxv: float,
             step: float, val: float, param: String) -> void:
    var row := HBoxContainer.new()
    var l := Label.new(); l.text = label; l.custom_minimum_size = Vector2(95, 0)
    var s := HSlider.new()
    s.min_value = minv; s.max_value = maxv; s.step = step; s.value = val
    s.custom_minimum_size = Vector2(130, 0)
    var vl := Label.new(); vl.custom_minimum_size = Vector2(46, 0)
    vl.text = "%.2f" % val
    s.value_changed.connect(func(v: float) -> void:
        vl.text = "%.2f" % v
        _on_param(param, v))
    row.add_child(l); row.add_child(s); row.add_child(vl)
    parent.add_child(row)
```

Слои `CanvasLayer` — по назначению, номер = порядок:
- `layer = 0` — пост-обработка (`ColorRect` на весь экран с `ShaderMaterial`,
  `mouse_filter = MOUSE_FILTER_IGNORE`). Она сэмплит 3D-кадр под собой.
- `layer = 1` — HUD/меню. Так зерно и виньетка не пачкают текст.

Дефолтный серый Godot-панелькой выглядит как прототип. Одна `StyleBoxFlat`
(тёмный фон 0.82 альфы, рамка, радиус 6, отступы 10) — и меню читается как
часть игры:

```gdscript
var sb := StyleBoxFlat.new()
sb.bg_color = Color(0.04, 0.05, 0.07, 0.82)
sb.border_color = Color(0.3, 0.55, 0.75, 0.6)
sb.set_border_width_all(1); sb.set_corner_radius_all(6); sb.set_content_margin_all(10)
panel.add_theme_stylebox_override("panel", sb)
```

**Меню прячь за клавишу** (`i` / `Tab`) и держи скрытым по умолчанию — иначе
скриншоты и первый запуск выглядят как отладочная сборка. В стартовом баннере
одной строкой напиши, какая клавиша его открывает.

## Ввод

Два разных механизма, не путать:
- `_input(event)` — дискретные события: нажатия, мышь, колесо. Хоткеи здесь.
- `_physics_process` + `Input.is_physical_key_pressed(KEY_W)` — удержание
  (движение). `is_physical_key_pressed` не зависит от раскладки — на русской
  раскладке `KEY_W` продолжает работать.

**Гейт ввода при текстовом поле.** Как только появляется чат/поле ввода имени,
все буквенные хоткеи начинают срабатывать при наборе. Один предикат:

```gdscript
func chat_blocked() -> bool:
    return chat_edit != null and chat_edit.has_focus()
```

и он проверяется в начале каждого обработчика клавиш — и в `main.gd`, и в
`player.gd`. Забыть — гарантированный баг «печатаю сообщение, а персонаж бежит
и стреляет».

Хоткей и галка в меню должны показывать одно состояние. Общая функция:

```gdscript
func _hotkey_toggle(cb: CheckButton) -> void:
    cb.button_pressed = not cb.button_pressed
    cb.toggled.emit(cb.button_pressed)  # сеттер сигнал НЕ шлёт — эмитим руками
```

## Модули без автозагрузок

Автозагрузки (`autoload`) в код-первом проекте почти не нужны. Хватает:
- `class_name Foo` + `static func` — чистые утилиты/фабрики (`Sfx.step()`,
  `Distortion.warp()`), состояние в `static var` с ленивым кэшем.
- Обычная нода-подсистема, добавленная в `main` с **фиксированным именем**:
  `net.name = "Net"` → путь `Main/Net` одинаков у всех пиров (обязательно
  для RPC) и достижим как `main.get_node("Net")`.

Ссылка на родителя у дочерних нод: `@onready var main_node := get_parent()`.
Типизировать её как `Node` (не как `Main`) — иначе циклическая зависимость
классов.

## Настройки и сохранения

```gdscript
var cfg := ConfigFile.new()
cfg.set_value("video", "low_spec", low_spec)
cfg.save("user://settings.cfg")
```

`user://` на Windows = `%APPDATA%\Godot\app_userdata\<config/name>\`.
Туда же кладут кэш сгенерированных ресурсов (у нас — конвертированные
depth-карты): ключ кэша = имя файла + его размер, версия формата — в имени
(`*_v3.png`), иначе после смены алгоритма подтянется старый мусор.

## Детерминизм

Всё процедурное — от явного сида, а не от глобального `randf()`:

```gdscript
var rng := RandomNumberGenerator.new()
rng.seed = 155 + gen_seed   # своя константа-смещение на каждую подсистему
```

Это даёт: воспроизводимый баг по одному числу, одинаковый мир у всех игроков
в сети без пересылки геометрии, и стабильные скриншоты для A/B-сравнений.
Одна общая `gen_seed` + разные смещения — лампы `99+seed`, ящики `155+seed`,
декор `991+seed` — чтобы правка одной подсистемы не перетасовывала остальные.
