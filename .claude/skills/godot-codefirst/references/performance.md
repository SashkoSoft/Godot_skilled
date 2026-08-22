# Производительность: draw calls решают

Реальный кейс: поле 16×9, ~300 `MeshInstance3D` декора на плитку → десятки тысяч
draw calls → **22 FPS на RTX 4070 Ti**. После батчинга в MultiMesh — 2173 draw
call и **74–84 FPS** (×3.3), картинка та же.

Мораль: на сценах из множества мелких объектов узкое место — не полигоны и не
шейдеры, а **количество draw call**. Сначала считай их, потом оптимизируй.

## Диагностика

- Счётчик FPS в углу — постоянно, не «на время отладки»:
  `Engine.get_frames_per_second()`.
- В GUI-редакторе: *Отладчик → Монитор* — `Rendering/Total Draw Calls`,
  `Objects Drawn`. Ориентир для десктопа: держись в пределах ~2–3k draw calls.
- Меряй с выключённым vsync
  (`DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)`),
  иначе всё упрётся в 60 и регресс не будет виден.
- Замеры пиши в коммит: «22.3 → 83.9 FPS (16×9, 10 машинок, RTX 4070 Ti)».

## MultiMesh: главный инструмент

Сотни одинаковых мешей с одним материалом → **один** draw call:

```gdscript
var mm := MultiMesh.new()
mm.transform_format = MultiMesh.TRANSFORM_3D
mm.use_colors = true                    # если нужен свой цвет на экземпляр
mm.mesh = tuft_mesh
mm.instance_count = xs.size()
for i in range(xs.size()):
    mm.set_instance_transform(i, xs[i])
    mm.set_instance_color(i, pal[randi() % pal.size()])

var mmi := MultiMeshInstance3D.new()
mmi.multimesh = mm
mmi.material_override = tuft_mat
mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
add_child(mmi)
```

`instance_count` задавай **до** `set_instance_transform` — иначе тихо ничего не
запишется. `use_colors` / `use_custom_data` включай до заполнения.

## Батчинг составных объектов

Дерево — это ствол + крона + шапка снега: три меша с разными материалами.
Разбирай прототипы на части и группируй **по ключу (меш, материал, тень, дальность LOD)**:

```gdscript
var buckets := {}
for it in t.items:
    var proto := _proto(it.type)
    var item_xf := Transform3D(Basis(Vector3.UP, it.rot).scaled(Vector3.ONE * it.sc),
                               Vector3(it.x, 0.0, it.y))
    for ch in proto.get_children():
        var mi := ch as MeshInstance3D
        if mi == null:
            continue
        var mat_id: int = mi.material_override.get_instance_id() if mi.material_override else 0
        var key := "%d|%d|%d|%d" % [mi.mesh.get_instance_id(), mat_id,
                                    int(mi.cast_shadow), int(vis_range)]
        if not buckets.has(key):
            buckets[key] = {"mesh": mi.mesh, "mat": mi.material_override, "x": []}
        buckets[key]["x"].append(item_xf * mi.transform)   # общий × локальный
```

Из ~300 узлов на плитку остаётся 30–40 MultiMesh-инстансов при той же картинке.
Ключ обязан включать тень и LOD-дальность: иначе не выключить тени отдельно у
травы и не скрыть мелочь по дистанции.

## LOD «на бедного»: visibility_range_end

```gdscript
const DECOR_VIS_RANGE := {"flower": 3600.0, "rock": 3600.0, "bush": 4200.0, "tree": 0.0}
mmi.visibility_range_end = 3600.0     # 0 = видно всегда
```

Мелочь, которая с отъехавшей камеры занимает меньше пикселя, просто не рисуется.
Пороги подбирай так, чтобы на **дефолтной** дистанции камеры было видно всё, а
отсечка начиналась при отъезде или росте поля.

## Тени

Тени примерно удваивают стоимость геометрии. Выключай там, где тень не читается:
трава, цветы, мелкие камни, частицы —
`cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF`.

## Прочее, что реально дало прирост

- **Не дёргать RenderingServer впустую**: перед перекраской/пересборкой подсветки
  сравни с прошлым состоянием и выйди, если ничего не менялось.
- **Дорогие алгоритмы — по таймеру**, не каждый кадр (поиск замкнутых петель —
  раз в 0.15 с, ход ИИ — раз в 0.08 с).
- **Дешёвые предикаты вперёд**: сначала «а могло ли вообще что-то измениться»
  (расстояние между парой объектов), и только потом полный обход графа.
- **Предвычисленные структуры** (соседи, середины рёбер, порталы) считаются один
  раз при построении поля, а не в горячем цикле.
- **Случайная подвыборка** вместо полного перебора, когда ИИ застрял: 40
  случайных плиток вместо всех 144 — качество то же, цена в разы ниже.
- Строительство большого поля размазывай по кадрам (`GROW_PER_FRAME := 4`).

## Порядок действий при просадке

1. Померь FPS и draw calls, зафиксируй цифру.
2. Посчитай, сколько узлов создаётся на единицу мира. Больше сотни — батчить.
3. Сгруппируй в MultiMesh по (меш, материал, тень, LOD).
4. Выключи тени у мелочи, поставь `visibility_range_end`.
5. И только потом лезь в шейдеры и разрешение теней.
