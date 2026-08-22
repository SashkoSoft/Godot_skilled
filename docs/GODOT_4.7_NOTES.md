# Godot 4.7 — что важно знать (выжимка из гайдов миграции)

Источники: `docs/godot-docs/tutorials/migrating/upgrading_to_godot_4.5.rst`, `_4.6.rst`, `_4.7.rst`.
Читать их целиком, если что-то ведёт себя не так, как ожидалось.

## Новые дефолты — влияют на любой новый проект

| Настройка | Стало (версия) | Было |
|---|---|---|
| `display/window/stretch/mode` | `canvas_items` (4.7) | `disabled` |
| `display/window/stretch/aspect` | `expand` (4.7) | `keep` |
| `rendering/rendering_device/driver.windows` | **D3D12** (4.6) | Vulkan |
| `physics/3d/physics_engine` | **Jolt Physics** (4.6) | Godot Physics |
| `rendering/reflections/sky_reflections/roughness_layers` | 8 (4.7) | 7 |
| `Environment.glow_blend_mode` | Screen (4.6) | Soft Light |
| `Environment.glow_intensity` | 0.3 (4.6) | 0.8 |
| `LookAtModifier3D.relative` | `false` (4.7) | `true` |
| `MeshInstance3D.skeleton` | `NodePath("")` (4.6) | `NodePath("..")` |
| `ResourceImporterDynamicFont.hinting` | 3 (4.7) | 1 |

Следствия на практике:
- UI по умолчанию масштабируется вместе с окном — отдельно включать stretch больше не нужно.
- 3D-физика по умолчанию Jolt: см. `tutorials/physics/using_jolt_physics.rst`; часть поведения
  (`SoftBody3D`, `WorldBoundaryShape3D.plane.d`, оверлапы `Area3D` с `SoftBody3D`) отличается от Godot Physics.
- Свечение (glow) и объёмный туман в 4.6 стали ярче — параметры Environment придётся подкручивать.

## Изменения поведения, о которых легко забыть

### GDScript (4.7)
- Присваивание элемента packed-массива больше **не** вызывает сеттер всего свойства-массива.
- Метод, переопределяющий метод с типизированным возвратом, наследует тип возврата — в переопределении
  обязателен явный `return` (если возвращать нечего — `return null`).

### Ввод (4.7)
- ID устройств мыши и клавиатуры больше не `0`, а `InputEvent.DEVICE_ID_MOUSE` / `InputEvent.DEVICE_ID_KEYBOARD`
  (некоторые геймпады используют `0`). Проверять тип события или сравнивать `event.device` с этими константами.

### Рендер (4.7)
- `CanvasItem` больше не добавляет сглаживающее «перо» при рисовании линий — линии выглядят тоньше,
  толщину надо задавать явно.
- Визуальный шейдер `LinearToSRGB` не клампит в `[0.0, 1.0]` на Forward+ / Mobile.

### Аудио (4.7)
- Дефолтный `area_mask` у `AudioStreamPlayer` изменён с `1` на `0` (выключен). Если используется
  `audio_bus_override` у `Area2D`/`Area3D` — вернуть маску на слой 1 вручную.

### Формат сцен (4.6)
- В `.tscn` больше не пишется `load_steps`, зато пишутся **уникальные ID нод** — рефакторинг сцен
  стал надёжнее. Формат совместим в обе стороны, но первое пересохранение старой сцены даёт большой diff.
  Разово прогнать `Project > Tools > Upgrade Project Files...`.

### Навигация
- `AStar2D/AStar3D.get_point_path`, `AStarGrid2D.get_id_path/get_point_path` возвращают пустой путь,
  если стартовая точка отключена/непроходима (4.6).
- Регионы NavigationServer обновляются асинхронно в потоках (4.5) — обновление навмеша не мгновенно.
  Отключается настройкой `navigation/world/region_use_async_iterations`.

### Прочее из 4.5, что легко упустить
- `TileMapLayer`: физика чанкуется (`physics_quadrant_size`), из-за чего `get_coords_for_body_rid()`
  возвращает координаты чанка. Для точных координат клетки — `physics_quadrant_size = 1`.
- `Resource.duplicate(true)` больше не дублирует **внешние** ресурсы; для старого поведения —
  `duplicate_deep(DEEP_DUPLICATE_ALL)`.

## Устаревшее — не использовать в новом коде

- **`TileMap` — deprecated.** Использовать несколько нод `TileMapLayer` (по слою на ноду).
  Конвертация: панель TileMap → иконка ящика с инструментами → «Extract TileMap layers as individual TileMapLayer nodes».
- `AnimationNodeBlendSpace1D/2D`: булево `sync` заменено на enum `sync_mode` (4.7). После апгрейда
  переходы в AnimationTree могут вести себя иначе — выставить режим явно.
- `RichTextLabel.add_image/update_image`: `width_in_percent`/`height_in_percent` (bool) заменены на
  `width_unit`/`height_unit` (enum `RichTextLabel.ImageUnit`), а `width`/`height` теперь `float`.
- `AudioEffectSpectrumAnalyzer.tap_back_pos` — удалено.
- Минимальная macOS для запуска Godot — 11 Big Sur (4.7).

## Версии

- Локальный движок: 4.7-stable (`5b4e0cb0f`). Последний патч ветки на 2026-08-22: **4.7.2-stable**
  (обновление рекомендуется — это только багфиксы, совместимость сохраняется).
- Ветки миграции по всем версиям: `docs/godot-docs/tutorials/migrating/upgrading_to_godot_4.{1..7}.rst`.
