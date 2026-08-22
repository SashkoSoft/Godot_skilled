# Самопроверка без человека: headless-прогон и скриншот-харнесс

Агент не видит экран и не держит мышь. Без харнесса каждая правка визуала
превращается в «посмотри, пожалуйста» — по пять раз за задачу. Харнесс
окупается за первый же час.

## Три уровня проверки

| Уровень | Команда | Что ловит |
|---|---|---|
| парсинг/импорт | `--editor --headless --quit` | синтаксис, битые ресурсы |
| прогон логики | `--headless --quit-after 600` | падения в `_ready`/`_process`, ошибки API, warnings |
| визуал | `--shot=out.png` (окно, НЕ headless) | как это выглядит на самом деле |

```bash
G=./Godot_v4.7-stable_win64_console.exe   # всегда *_console.exe: обычный exe не пишет в stdout
$G --path game --editor --headless --quit
$G --path game --headless --quit-after 600
$G --path game --resolution 1280x720 -- "--shot=C:/tmp/f.png" "--shot-frames=150"
```

Двойное `--` обязательно: всё после него уходит в `OS.get_cmdline_user_args()`,
иначе Godot попытается разобрать флаг сам и ругнётся.

## Скриншот-харнесс

Вызывается последней строкой `_ready()`. Разбирает свои флаги, ждёт N кадров
(чтобы тени, glow и туман устоялись), печатает метрики и сохраняет PNG:

```gdscript
func _shot_if_asked() -> void:
    var path := ""; var view := "fpv"; var frames := 90
    for a in OS.get_cmdline_user_args():
        if a.begins_with("--shot="):            path = a.substr(7)
        elif a.begins_with("--shot-view="):     view = a.substr(12)
        elif a.begins_with("--shot-frames="):   frames = a.substr(14).to_int()
        elif a.begins_with("--shot-yaw="):      player.yaw += deg_to_rad(a.substr(11).to_float())
        elif a.begins_with("--shot-cell="):     _teleport_to(a.substr(12))  # "x,f,z"
        elif a == "--shot-no-ssao":             env.ssao_enabled = false    # A/B
        elif a == "--shot-normals":             mat.set_shader_parameter("debug_normals", true)
    if path.is_empty():
        return
    if view == "orbit":
        _set_orbit(true)
    Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
    for i in range(frames):
        await RenderingServer.frame_post_draw
    print("PERF fps=%d process=%.2fms objects=%d prims=%d draws=%d" % [
        Engine.get_frames_per_second(),
        Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
        int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
        int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
        int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))])
    var img := get_viewport().get_texture().get_image()
    if img.save_png(path) != OK:
        push_error("screenshot save failed")
    get_tree().quit()
```

Ключевые детали, каждая куплена ошибкой:

- **`--headless` не годится**: без окна рендера нет, PNG выходит чёрным. Нужен
  реальный экран, просто окно можно не трогать.
- **Ждать `RenderingServer.frame_post_draw`, а не таймер.** 90–150 кадров: за
  первые тени и volumetric fog ещё не сошлись, кадр «моргает».
- **FPS в таком кадре занижен** — неактивное окно throttle'ится ОС. Честные
  числа — строкой `PERF` из `Performance` (и её же класть в коммит).
- **Печатай координаты** (`SHOT-POS`, список интересных клеток): следующий
  прогон целится флагом `--shot-cell` туда, где реально есть, что смотреть.
  Случайный кадр «где-то в уровне» почти всегда мимо объекта проверки.
- **Замораживай физику** при телепорте камеры (`set_physics_process(false)`),
  иначе персонаж успеет съехать/упасть за 90 кадров, и кадр будет не там.
  Тогда же руками копируй `yaw/pitch` в трансформы — их обычно ставит
  `_physics_process`, который выключен.

## A/B-флаги — главный диагностический инструмент

На каждый спорный эффект — флаг, который его выключает. Два кадра рядом
отвечают на вопрос «виноват ли шум/SSAO/туман» за одну минуту, без гадания:

```
--shot-no-ssao      --shot-no-macro     --shot-half-lamps
--shot-no-flash     --shot-low-spec     --shot-ssao-buffer
```

Реальные случаи из проекта:
- «Квадратные пятна на бетоне»: `--shot-no-macro` показал гладкую стену →
  виноват шум в шейдере (value noise с экстремумами на решётке), а не меш и
  не текстура. Фикс — градиентный шум.
- «Пол чёрный, свет не работает»: `--shot-normals` (вывод нормали цветом)
  показал пурпурный пол = нормаль вниз → инвертированный winding. Три
  предыдущие сессии до этого чинили не то (bias теней, толщину плит).
- «SSAO не видно»: `--shot-ssao-buffer` (`DEBUG_DRAW_SSAO`) доказал, что
  буфер живой → дело не в SSAO, а в почти чёрном ambient.

Отладочный вывод внутрь шейдера («покажи нормаль/UV/маску цветом») — самый
быстрый способ понять геометрию, когда картинка «просто неправильная».

## Быстрый вход в состояние

Тестировать поздний геймплей руками = минуты на попытку. Флаг ставит мир
сразу в нужное состояние:

```gdscript
if "--td-test" in OS.get_cmdline_user_args():
    call_deferred("start_mode", "tower")   # сразу в режим башен
# --shot-throw: выдать патроны и метнуть три снаряда под разными углами,
#               потом напечатать, где они легли — проверка физики без рук
```

## Юнит-тесты без фреймворка

Чистая логика (генератор, BFS, поиск пути, синтез звука) проверяется `print`-ом
под флагом и грепом по stdout:

```gdscript
print("[wfc] cells=%d unreachable=%d" % [n, bad])   # ожидание: unreachable=0
print("[sfx] step dur=%.3f peak=%.2f loop_seam=%.4f" % [...])
```

Прогон `--headless --quit-after 60 | grep '^\['` — и есть регрессионный тест.
Для звука так ловится щелчок на шве лупа, для генератора — запертые комнаты.

## Что headless и скриншот НЕ проверяют

Композицию, цвет, «страшно/красиво», читаемость шрифта в движении, ощущение
управления. Здесь честно проси пользователя посмотреть — и формулируй КОНКРЕТНО,
что оценить («смотри на стык пола и стены в пятне фонаря — там должно быть
затенение»), иначе ответ будет «ну норм» и цикл повторится.
