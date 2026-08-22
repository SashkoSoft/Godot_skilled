# 3D-визуал из кода: меши, материалы, шейдеры, эффекты

## Процедурные меши: SurfaceTool → ArrayMesh

```gdscript
var st := SurfaceTool.new()
st.begin(Mesh.PRIMITIVE_TRIANGLES)
_quad(st, a, b, c, d, Vector3.UP)
st.generate_normals()          # если не задавал set_normal вручную
var mesh := ArrayMesh.new()
st.commit(mesh)

func _quad(st: SurfaceTool, a, b, c, d: Vector3, nrm: Vector3) -> void:
    for v in [a, b, c, a, c, d]:
        st.set_normal(nrm)
        st.add_vertex(v)
```

Порядок вершин задаёт лицевую сторону (CCW = лицо при `cull_back`). Если
поверхность «пропала» — почти всегда перевёрнутый порядок, а не материал.

**Лента вдоль кривой** (дорога, река, трасса) — идёшь по точкам кривой, на каждой
берёшь нормаль в плоскости и выдаёшь два квада:

```gdscript
for i in range(n):
    var p := curve_point(i)          # Vector3
    var tang := (curve_point(i+1) - p).normalized()
    var side := tang.cross(Vector3.UP).normalized() * (w * 0.5)
    # соединяешь предыдущую пару (l0,r0) с текущей (p-side, p+side)
```

Отдельными сабмешами кладутся: полотно, краевые линии, пунктир по центру —
каждый со своим материалом; так они не z-fight'ятся, если чуть поднять
(`+0.05` по Y) верхний слой.

**Несколько поверхностей в одном ArrayMesh**: несколько `st.commit(mesh)` от
разных SurfaceTool в тот же `ArrayMesh` → surface 0,1,2 с разными материалами.

## Материалы

```gdscript
var m := StandardMaterial3D.new()
m.albedo_color = Color8(0xc6, 0xc6, 0xc6)
m.roughness = 0.9
m.metallic = 0.0
m.cull_mode = BaseMaterial3D.CULL_DISABLED          # двусторонняя листва/трава
m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA  # только если правда нужно
m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED  # для «плоских» значков
```

Материалы **переиспользуй**: один экземпляр на сотни мешей. Каждый уникальный
материал — это отдельный draw call и, при батчинге, отдельный MultiMesh.

## Шейдер прямо из строки

Никаких `.gdshader`-файлов не нужно — код шейдера живёт константой в скрипте
рядом с тем, кто его использует:

```gdscript
const GROUND_SHADER := """
shader_type spatial;
render_mode cull_back, depth_draw_opaque, diffuse_burley;
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec2 field_half = vec2(1.0);
uniform float fade_start = 1.05;
uniform float fade_end = 1.95;
void fragment() {
    ALBEDO = texture(tex, UV * rep).rgb;
    vec2 n = (UV - 0.5) * plane_size / field_half;
    ALPHA = 1.0 - smoothstep(fade_start, fade_end, length(n));
}
"""

var sh := Shader.new()
sh.code = GROUND_SHADER
var m := ShaderMaterial.new()
m.shader = sh
m.set_shader_parameter("field_half", Vector2(FIELD_W * 0.5, FIELD_H * 0.5))
```

**Приём «поле не квадратное»**: нормируй смещение от центра на полуразмер поля
и бери `length()` — изолинии станут эллипсами, и на виде сверху земля/дождь
растворяются кругом, без видимой прямоугольной кромки. Плоскость земли делай
заметно больше поля, чтобы alpha дошла до нуля **до** её реального края.

## Полноэкранный пост-эффект

```gdscript
fx_layer = CanvasLayer.new()
fx_layer.layer = 0                  # поверх 3D, но под UI (ui.layer = 1)
add_child(fx_layer)

fx_rect = ColorRect.new()
fx_rect.material = fx_mat           # ShaderMaterial, shader_type canvas_item
fx_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
fx_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE   # не съедать клики
fx_rect.visible = false
fx_layer.add_child(fx_rect)
```

В шейдере читаешь кадр через `hint_screen_texture`:

```glsl
shader_type canvas_item;
uniform sampler2D screen : hint_screen_texture, filter_linear_mipmap;
uniform int u_style = 0;
void fragment() {
    vec3 col = texture(screen, SCREEN_UV).rgb;
    // Sobel/Canny по соседним текселям (шаг = 1.0 / vec2(textureSize(screen,0)))
    COLOR = vec4(col, 1.0);
}
```

- Все стили держи **в одном шейдере** с `uniform int u_style` и `if` — иначе
  каждое переключение = рекомпиляция и фриз на секунду.
- `visible = false` при стиле «Нет» — нулевая цена, когда эффект выключен.
- Мышь: `MOUSE_FILTER_IGNORE`, иначе прозрачный прямоугольник блокирует весь UI.
- Контур поверх цвета — это `col * (1.0 - ink)` (multiply), а «рисунок на бумаге» —
  `vec3(paper) - ink * tint`. Два разных ощущения от одних и тех же линий.

## Небо и освещение

```gdscript
env = Environment.new()
env.background_mode = Environment.BG_SKY
var sky := Sky.new()
sky.sky_material = sky_mat          # ShaderMaterial, shader_type sky
env.sky = sky
env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
$WorldEnvironment.environment = env

var sun := DirectionalLight3D.new()
sun.shadow_enabled = true
sun.light_energy = 1.2
```

День/ночь и сезоны удобно делать как **два независимых набора множителей**:
пресет времени суток задаёт базовый свет/небо, сезон домножает цвет
(`SEASON_GRADE`). Тогда любые пары («Зима + Ночь») комбинируются без
комбинаторного взрыва пресетов. Переход между фазами — линейный бленд словарей
`look` ~10 раз в секунду, а не каждый кадр.

## Частицы (дождь/снег)

```gdscript
var ps := GPUParticles3D.new()
ps.draw_pass_1 = drop_mesh                     # маленький QuadMesh/BoxMesh
var pm := ParticleProcessMaterial.new()
pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
pm.emission_box_extents = Vector3(ext_x, 1.0, ext_z)
pm.gravity = Vector3(0, -900, 0)
ps.process_material = pm
ps.amount = 16800
ps.lifetime = 0.7
ps.visibility_aabb = AABB(Vector3(-ext_x, -top - 100, -ext_z),
                          Vector3(2*ext_x, top + 200, 2*ext_z))
```

**Главная грабля: `visibility_aabb`.** По умолчанию он маленький и привязан к
эмиттеру. Эмиттер висит высоко над кадром → AABB уезжает за границы вида → фрустум-
куллинг вырубает **все** частицы разом, и дождь просто не виден. Задавай AABB на
весь объём падения вручную.

Вторая грабля: снег, рождённый одной плоскостью наверху, виден тонким слоем.
Спавни по всей высоте столба (`emission_box_extents.y = высота/2`) — тогда
хлопья равномерно заполняют объём с первого кадра.

`amount` масштабируй от размера поля, иначе на большом поле дождь редеет.

## Камера «почти ортогональная» сверху

Узкий FOV + большая дистанция = вид сверху почти без перспективных искажений,
но с честными тенями и объёмом (в отличие от настоящей ортокамеры):

```gdscript
cam.fov = 16.0
cam.far = 20000.0          # иначе дальний план обрежется на длинном фокусе
pitch = deg_to_rad(6.0)    # почти строго вниз
dist  = _fit_distance()    # чтобы поле влезло с учётом ширины боковой панели
```

Камеру веди к целевым значениям плавно (`cam_dist = lerp(cam_dist, tgt_dist, ...)`),
а на старте выставляй мгновенно, иначе игрок увидит «проезд» камеры.
Подпишись на `get_viewport().size_changed`, чтобы пересчитывать кадрирование.
