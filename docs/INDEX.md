# База знаний по Godot 4.7 — карта документации

Собрано 2026-08-22. Движок в проекте: **Godot 4.7-stable** (`Godot_v4.7-stable_win64.exe`,
build `5b4e0cb0f`). Актуальный патч на момент сборки: 4.7.2-stable.

## Что где лежит

| Путь | Что это | Объём |
|---|---|---|
| `docs/godot-docs/` | Официальный мануал, ветка `4.7` (git clone, коммит от 2026-08-05) | 1596 статей `.rst` |
| `docs/godot-docs/classes/` | Полный API-референс движка (сгенерирован из исходников) | 1079 классов |
| `docs/godot-demo-projects/` | Официальные демо-проекты (ветка `master`, рабочий код на GDScript и C#) | ~120 проектов |
| `docs/GODOT_4.7_NOTES.md` | Выжимка: что изменилось в 4.6 и 4.7, новые дефолты, грабли | — |
| `docs/CHEATSHEET.md` | Типовые паттерны GDScript + CLI движка | — |

Обновить документацию: `git -C docs/godot-docs pull` и `git -C docs/godot-demo-projects pull`.

## Как искать

```bash
# найти статью по теме
grep -ril "tilemaplayer" docs/godot-docs/tutorials --include='*.rst'

# API конкретного класса (имя файла всегда class_<нижний_регистр>.rst)
sed -n '1,120p' docs/godot-docs/classes/class_characterbody2d.rst

# все методы/свойства класса списком
grep -oE '\*\*[a-z_0-9]+\*\*' docs/godot-docs/classes/class_area2d.rst | sort -u

# рабочий пример кода
grep -rn "move_and_slide" docs/godot-demo-projects/2d --include='*.gd' | head
```

## Мануал: разделы

### Старт
- `getting_started/introduction/` — что такое ноды, сцены, скрипты, «мышление в Godot»
- `getting_started/step_by_step/` — узлы, инстансинг, скриптинг, сигналы
- `getting_started/first_2d_game/` — полная 2D-игра (Dodge the Creeps), пошагово
- `getting_started/first_3d_game/` — полная 3D-игра (Squash the Creeps), пошагово

### Скриптинг — `tutorials/scripting/`
- `gdscript/gdscript_basics.rst` — язык целиком: типы, аннотации, классы, корутины
- `gdscript/static_typing.rst` — статическая типизация (**использовать по умолчанию**)
- `gdscript/gdscript_exports.rst` — все `@export_*`
- `gdscript/gdscript_styleguide.rst` — официальный стиль кода
- `gdscript/gdscript_documentation_comments.rst` — doc-комментарии `##`
- `gdscript/gdscript_format_string.rst` — форматирование строк
- `gdscript/warning_system.rst` — предупреждения компилятора и их подавление
- `scene_tree.rst`, `nodes_and_scene_instances.rst`, `groups.rst` — дерево сцены, группы
- `singletons_autoload.rst` — автозагрузки (глобальные синглтоны)
- `scene_unique_nodes.rst` — уникальные имена нод `%Name`
- `instancing_with_signals.rst`, `overridable_functions.rst` — сигналы и переопределяемые методы
- `resources.rst`, `filesystem.rst` — ресурсы, пути `res://` / `user://`
- `idle_and_physics_processing.rst`, `pausing_games.rst` — процессинг и пауза
- `change_scenes_manually.rst` — смена сцен
- `debug/` — отладка, профайлер, `logging.rst`
- `c_sharp/` — C#, `cpp/` — GDExtension/C++, `cross_language_scripting.rst`

### 2D — `tutorials/2d/`
`introduction_to_2d`, `2d_movement`, `2d_sprite_animation`, `2d_transforms`,
`using_tilemaps` / `using_tilesets` (TileMapLayer!), `2d_lights_and_shadows`,
`canvas_layers`, `custom_drawing_in_2d`, `particle_systems_2d`, `2d_parallax`, `2d_meshes`

### 3D — `tutorials/3d/`
Освещение, GI (SDFGI/LightmapGI/VoxelGI), материалы, окружение, CSG, MeshInstance3D,
камера, оптимизация LOD/occlusion, `resolution_scaling.rst`

### Физика — `tutorials/physics/`
- `physics_introduction.rst` — типы тел, слои и маски
- `using_character_body_2d.rst`, `kinematic_character_2d.rst` — персонаж-контроллер
- `using_area_2d.rst` — зоны/триггеры
- `ray-casting.rst`, `collision_shapes_2d.rst` / `_3d.rst`, `rigid_body.rst`
- `using_jolt_physics.rst` — **Jolt = дефолт для 3D с 4.6**
- `interpolation/` — физическая интерполяция
- `troubleshooting_physics_issues.rst`

### Анимация — `tutorials/animation/`
`introduction.rst` (AnimationPlayer), `animation_tree.rst` (StateMachine/BlendSpace),
`animation_track_types.rst`, `cutout_animation.rst`, `2d_skeletons.rst`, `creating_movies.rst`

### UI — `tutorials/ui/`
`size_and_anchors.rst`, `gui_containers.rst`, `control_node_gallery.rst`,
`gui_skinning.rst` + `gui_using_theme_editor.rst` (темы), `gui_using_fonts.rst`,
`bbcode_in_richtextlabel.rst`, `custom_gui_controls.rst`, `gui_navigation.rst`

### Ввод — `tutorials/inputs/`
InputEvent, Input map, обработка клавиатуры/мыши/геймпада, мобильный ввод

### Звук — `tutorials/audio/` · Навигация — `tutorials/navigation/`
Шины, эффекты, синхронизация · NavigationRegion, NavigationAgent, авоиданс

### Шейдеры — `tutorials/shaders/`
Язык шейдеров Godot, canvas_item / spatial / particle / sky шейдеры, screen-reading,
`using_viewport_as_texture.rst`, компьют-шейдеры

### Ресурсы и импорт — `tutorials/assets_pipeline/`
Импорт изображений, аудио, 3D-сцен (glTF), retargeting анимаций, `.import`-файлы, UID

### Практики — `tutorials/best_practices/`
`introduction_best_practices.rst`, `scene_organization.rst`, `project_organization.rst`,
`autoloads_versus_regular_nodes.rst`, `scenes_versus_scripts.rst`, `node_alternatives.rst`,
`data_preferences.rst`, `godot_interfaces.rst`, `godot_notifications.rst`, `version_control_systems.rst`

### Производительность — `tutorials/performance/`
`general_optimization.rst`, `cpu_optimization.rst`, `gpu_optimization.rst`,
`using_multimesh.rst`, `using_multiple_threads.rst`, `thread_safe_apis.rst`, `using_servers.rst`

### Сохранения и IO — `tutorials/io/`
`saving_games.rst`, сериализация, background loading, шифрование, `data_paths.rst`

### Сеть — `tutorials/networking/` · Экспорт — `tutorials/export/`
High-level multiplayer, RPC, ENet, WebSocket, WebRTC · Windows/Linux/macOS/Android/iOS/Web, PCK, feature tags

### Редактор и разное
- `tutorials/editor/command_line_tutorial.rst` — все ключи CLI
- `tutorials/editor/project_settings.rst`, `external_editor.rst`, `game_embedding.rst`
- `tutorials/plugins/` — плагины редактора, GDExtension, Android-плагины
- `tutorials/migrating/` — гайды апгрейда 4.0 → 4.7 (**важно, см. NOTES**)
- `tutorials/i18n/`, `tutorials/xr/`, `tutorials/platform/`, `tutorials/troubleshooting.rst`
- `engine_details/` — внутреннее устройство: рендер-архитектура, форматы файлов (`.tscn`, `.tres`), компиляция

## Демо-проекты — что где смотреть

| Задача | Демо |
|---|---|
| Платформер 2D | `2d/platformer`, `2d/physics_platformer`, `2d/kinematic_character` |
| Первая игра / шутер сверху | `2d/dodge_the_creeps`, `2d/bullet_shower` |
| RPG, изометрия, гексы | `2d/role_playing_game`, `2d/isometric`, `2d/hexagonal_map` |
| Тайлмапы | `2d/dynamic_tilemap_layers` |
| Стейт-машина | `2d/finite_state_machine` |
| Пинг-понг, туториальная классика | `2d/pong`, `networking/multiplayer_pong` |
| Навигация / A* | `2d/navigation`, `2d/navigation_astar`, `3d/navigation` |
| Свет и тени 2D | `2d/lights_and_shadows`, `2d/light2d_as_mask` |
| Шейдеры | `2d/screen_space_shaders`, `2d/sprite_shaders`, `3d/sky_shaders`, `compute/*` |
| Частицы, твины | `2d/particles`, `2d/tween` |
| 3D-персонаж, транспорт, рэгдолл | `3d/platformer`, `3d/kinematic_character`, `3d/truck_town`, `3d/ragdoll_physics` |
| Графика 3D: GI, декали, AA, тонмаппинг | `3d/global_illumination`, `3d/decals`, `3d/antialiasing`, `3d/tonemap_color_correction` |
| Настройки графики в игре | `3d/graphics_settings` |
| UI: галерея контролов, темы, drag&drop | `gui/control_gallery`, `gui/theming`, `gui/drag_and_drop` |
| Разрешения экрана и масштабирование UI | `gui/multiple_resolutions` |
| Ввод и переназначение клавиш | `gui/input_mapping`, `misc/joypads` |
| Сохранение / загрузка, потоки | `loading/runtime_save_load`, `loading/serialization`, `loading/load_threaded`, `loading/threads` |
| Автозагрузки, смена сцен, пауза | `loading/autoload`, `loading/scene_changer`, `misc/pause` |
| Мультиплеер | `networking/multiplayer_bomber`, `networking/websocket_chat`, `networking/webrtc_*` |
| Сплит-скрин, viewport-трюки | `viewport/split_screen`, `viewport/3d_in_2d`, `viewport/2d_in_3d`, `viewport/gui_in_3d` |
| Звук: эффекты, спектр, ритм-игра | `audio/audio_effects`, `audio/spectrum`, `audio/rhythm_game`, `audio/bpm_sync` |
| C#-версии демок | `mono/*` |
| Мобильное (сенсоры, мультитач, IAP) | `mobile/*` |
| Окна, курсоры, ОС | `misc/window_management`, `misc/multiple_windows`, `misc/os_test` |
