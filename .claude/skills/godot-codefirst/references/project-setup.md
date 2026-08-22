# Заведение проекта, запуск, сборка

## Минимальный `project.godot`

```ini
; Engine configuration file.
config_version=5

[application]
config/name="My Game"
run/main_scene="res://Main.tscn"
config/features=PackedStringArray("4.7", "Forward Plus")
config/icon="res://icon.svg"
boot_splash/show_image=false          ; убрать логотип Godot при старте
boot_splash/bg_color=Color(0.02, 0.03, 0.06, 1)

[display]
window/size/viewport_width=1280
window/size/viewport_height=800
window/stretch/mode="canvas_items"    ; UI масштабируется, 3D — нет

[rendering]
anti_aliasing/quality/msaa_3d=2       ; 4x MSAA; 0=выкл, 1=2x, 2=4x, 3=8x
```

`config_version=5` — для всей ветки Godot 4. `config/features` определяет рендерер:
`"Forward Plus"` (десктоп, все фичи), `"Mobile"`, `"Compatibility"` (GLES3/веб).
Пост-шейдеры и GPUParticles3D нормально живут только на Forward Plus.

## `Main.tscn` — заглушка

```
[gd_scene load_steps=2 format=3 uid="uid://c0000000000000"]

[ext_resource type="Script" path="res://Main.gd" id="1"]

[node name="Main" type="Node3D"]
script = ExtResource("1")
```

Файл создаётся один раз и больше не трогается. Всё дерево — из `Main.gd`.

## Структура папок

```
game/
  project.godot
  export_presets.cfg
  Main.tscn  Main.gd
  icon.svg   icon.svg.import
  sounds/*.wav  *.wav.import
  build/          # в .gitignore
  .godot/         # в .gitignore — кэш импорта
```

`*.import` — генерируются движком при первом импорте ресурса и **должны лежать
в git**: без них экспорт не найдёт ресурс. Если добавил .wav/.png руками —
прогони проект (или `--headless --quit-after 5`), чтобы .import создался.

## `.gitignore`

```
.godot/
build/
*.tmp
```

## Экспорт standalone .exe

1. Шаблоны экспорта нужны один раз. Без них CLI-экспорт молча падает с
   «No export template found».
   - В GUI-редакторе: *Проект → Экспорт → Управление шаблонами → Скачать*.
   - **Без редактора** (если пользователь его не открывает): скачать `.tpz` релиза
     и распаковать содержимое папки `templates/` в
     `%APPDATA%\Godot\export_templates\<версия>.stable\`:
     ```bash
     curl -L -o templates.tpz \
       https://github.com/godotengine/godot/releases/download/4.7-stable/Godot_v4.7-stable_export_templates.tpz
     unzip -j templates.tpz 'templates/*' -d "$APPDATA/Godot/export_templates/4.7.stable/"
     ```
     Архив ~1.3 ГБ (все платформы), поэтому если нужен только Windows —
     проверь, не лежат ли `windows_release_x86_64.exe` и соседние файлы там уже.
2. `export_presets.cfg` — ключевое:
   ```ini
   [preset.0]
   name="Windows Desktop"
   platform="Windows Desktop"
   runnable=true
   export_path="build/Game.exe"
   export_filter="all_resources"

   [preset.0.options]
   binary_format/embed_pck=true      ; ВСЁ в один .exe, без .pck рядом
   binary_format/architecture="x86_64"
   debug/export_console_wrapper=0    ; без чёрного окна консоли
   application/product_name="My Game"
   application/company_name="..."
   ```
3. Сборка:
   ```bash
   ./Godot_v4.7-stable_win64_console.exe --headless --path game \
     --export-release "Windows Desktop" build/Game.exe
   ```
   Имя пресета в кавычках должно совпадать с `name=` в `export_presets.cfg`.
   `--export-debug` — сборка с отладочными проверками.

## Полезные CLI-флаги

| Флаг | Что делает |
|---|---|
| `--path DIR` | папка проекта (там, где `project.godot`) |
| `--headless` | без окна и звука — для CI/проверок/экспорта |
| `--quit-after N` | выйти через N кадров — «прогнал и вышел» |
| `--resolution 1280x800` | размер окна |
| `-- --my-flag` | всё после второго `--` уйдёт в `OS.get_cmdline_user_args()` |
| `--verbose` | подробный лог импорта/шейдеров |

Всегда бери `*_console.exe` для CLI: обычный `.exe` на Windows не пишет в stdout,
и ты не увидишь ни `print()`, ни ошибок парсинга.

## Где живут сохранения

`user://` = `%APPDATA%\Godot\app_userdata\<config/name>\` на Windows.
Полезно, когда пользователь жалуется «настройки не сбрасываются».
