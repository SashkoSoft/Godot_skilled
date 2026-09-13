class_name Street
extends Node3D
## Улица вокруг дома: проезжая часть, тротуары, бордюры, палисадник, отмостка
## и корпус напротив.
##
## Раскладка ведётся ОТ СТЕНЫ ДОМА наружу и в метрах, а не абсолютными
## координатами: габарит корпуса берётся из `Tower.W_HALF/D_HALF`, поэтому
## если чертёж поправят, улица подвинется сама.
##
## Главный фасад смотрит в −Z (север по комментарию в `tower.gd`), там проезд;
## с +Z двор. Зелень ставится декалями через `DecalLib` — тем же набором
## task-0011, что на лоджии: он и был сдан под фасад и подъезд.
##
## Повторяющееся (окна дома напротив) идёт MultiMesh'ем, а не отдельными
## нодами: у дома уже под две тысячи draw call, и класть рядом ещё сотню
## поштучно — прямой путь в слайдшоу.

## Уровень тротуара. Совпадает с верхом земли из `main.gd`: у дома пол на 0,
## земля на −0.15, эти 15 см игрок перешагивает.
const Y_WALK := -0.15
const KERB_H := 0.14
const Y_ROAD := Y_WALK - KERB_H

## Отмостку вдоль стены кладёт сам дом (`Tower.APRON`), здесь её нет.
const GARDEN := 3.20       ## палисадник, он же полоса заросшей земли
const WALK_W := 2.40       ## тротуар
const KERB_W := 0.12
const ROAD_W := 7.20       ## проезжая часть
const FAR_GAP := 2.60      ## от дальнего тротуара до дома напротив

## Насколько улица тянется вдоль X. 46 м было мало: полосы кончались в воздухе
## на глазах у игрока. Теперь они уходят за дальность тумана (240 м в
## `main.gd`), поэтому края не видно вообще — и это дешевле, чем строить
## квартал, которого никто не разглядит.
const LEN_HALF := 150.0
const FAR_FLOORS := 3
const FAR_BLOCK_W := 44.0  ## длина корпуса напротив
const FAR_BLOCK_GAP := 11.0

## Насколько зелень заменяет альбедо поверхности. Не 1.0 намеренно: у набора
## task-0011 альфа доходит до края холста на полной непрозрачности, и при
## полной замене декаль читается наклеенным прямоугольником. Подмешивание
## прячет край, но лечит следствие — набор надо переделывать (см. замер
## в шапке `decal_lib.gd`).
const GREEN_MIX := 0.78

## Покрытие улицы считается в шейдере от МИРОВЫХ координат, а не берётся
## картинкой. Причина простая: тротуар делался фасадной панелью, у неё в
## текстуре швы панелей, и положенные плашмя они давали ровные полосы через
## весь кадр. Любая тайловая текстура на поверхности в сотни метров рано или
## поздно начинает повторяться и «дышать» сеткой.
##
## Здесь повторения нет вовсе: и шум, и разбивка на плиты берутся от мировой
## точки, поэтому рисунок уникален в каждой точке улицы. Плата — арифметика
## во фрагменте, но это плоскости без нагрузки на вершины.
##
## `kind`: 0 — тротуарная плита, 1 — асфальт, 2 — земля.
const SURFACE_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley;

uniform vec3 col_a : source_color = vec3(0.62, 0.61, 0.58);
uniform vec3 col_b : source_color = vec3(0.44, 0.43, 0.41);
uniform vec3 col_joint : source_color = vec3(0.24, 0.24, 0.22);
uniform float plate = 0.75;
uniform float joint = 0.030;
uniform int kind = 0;
uniform float rough_base = 0.92;
// Поперечная привязка: вся улица идёт вдоль X, значит «поперёк» — это Z.
// lat = −1 у одной кромки полосы, +1 у другой, 0 по оси. Без неё нельзя
// сделать ни колеи, ни грязь у бордюра, ни осевую разметку — а без них
// асфальт остаётся ровным серым полем.
uniform float lat_center = 0.0;
uniform float lat_half = 1.0;

// Хеш без sin. С `sin(dot(...))` покрытие улицы стоило 20x производительности
// (83 -> 4 FPS на том же кадре): это полноэкранные плоскости, на каждый пиксель
// приходятся десятки выборок шума, а тригонометрия в каждой из них — самое
// дорогое, что тут может быть.
float h21(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = h21(i);
	float b = h21(i + vec2(1.0, 0.0));
	float c = h21(i + vec2(0.0, 1.0));
	float d = h21(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int oct) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 6; i++) {
		if (i >= oct) break;
		s += a * vnoise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

// Хребтовый шум: даёт ВЕТВЯЩИЕСЯ тонкие линии, а не один длинный потёк.
// Обычный fbm с порогом по |n−0.5| рисует ровно одну мажущую полосу на
// октаву, и асфальт от неё выглядит заляпанным, а не потрескавшимся.
float ridge(vec2 p, int oct) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 6; i++) {
		if (i >= oct) break;
		float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
		s += a * n * n;
		p = p * 2.11 + 7.3;
		a *= 0.5;
	}
	return s;
}

void fragment() {
	vec3 wpos = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 w = wpos.xz;

	// Боковые грани плиты — это торец бордюра или обрез покрытия, им ни
	// колеи, ни разметка не нужны. Ранним `return` это не отсечь: в Godot
	// `return` во фрагментной функции запрещён, поэтому флаг и подмена
	// результата в конце.
	bool is_side = NORMAL.y < 0.5;

	float lat = clamp((w.y - lat_center) / max(lat_half, 0.001), -1.0, 1.0);
	float edge = abs(lat);

	// Мелкое зерно глушится с расстоянием: иначе на дальнем плане оно
	// превращается в муар, то есть в ту же сетку, от которой мы уходили.
	float dist = length(VERTEX);
	float fine = clamp(1.0 - dist / 55.0, 0.0, 1.0);
	float mid_fade = clamp(1.0 - dist / 140.0, 0.0, 1.0);

	// Три поля шума на всё покрытие, дальше они ПЕРЕИСПОЛЬЗУЮТСЯ. Каждый
	// лишний fbm — это четыре выборки на октаву на каждом пикселе экрана,
	// и именно на них уходила производительность.
	float stain = fbm(w * 0.055, 3);
	float mid = fbm(w * 0.9, 2);
	float grain = fbm(w * 11.0, 2);

	float t = clamp(stain * 0.85 + mid * 0.25 - 0.12, 0.0, 1.0);
	vec3 col = mix(col_b, col_a, t);
	col *= 1.0 - (grain - 0.5) * 0.20 * fine;

	float rough = rough_base;

	if (kind == 0) {
		// --- тротуарная плита ------------------------------------------
		// Перевязка: каждый второй ряд сдвинут на полплиты. Прямая сетка
		// «клетка в клетку» сразу читается фальшивкой, так плитку не кладут.
		float row = floor(w.y / plate);
		float shift = mod(row, 2.0) * 0.5;
		vec2 cell = vec2(w.x / plate + shift, w.y / plate);
		vec2 id = floor(cell);
		vec2 f = fract(cell);

		float r1 = h21(id);
		float r2 = h21(id + 19.7);
		col *= 1.0 + (r1 - 0.5) * 0.15;
		col *= 1.0 + (vnoise(w * 2.7 + id * 7.3) - 0.5) * 0.10;

		// Ширина шва гуляет: где-то плиты разошлись, где-то встык.
		float jw = joint * (0.6 + 1.5 * h21(id + 5.1));
		vec2 e = min(f, 1.0 - f) * plate;
		float seam = 1.0 - smoothstep(jw * 0.5, jw * 1.7, min(e.x, e.y));
		seam *= 0.55 + 0.45 * vnoise(w * 14.0);

		// Грязь копится у кромок полосы: у бордюра и у стены её больше
		// всего, по середине ходят и вытирают.
		float dirt = smoothstep(0.45, 1.0, edge) * 0.55 + stain * 0.35;
		col *= 1.0 - dirt * 0.22;
		// В швах грязь и проросшее — шов тем темнее, чем грязнее место.
		col = mix(col, col_joint * (1.0 - dirt * 0.25),
				seam * (0.70 + dirt * 0.30));
		rough = mix(rough, 1.0, seam);

		// Просевшие и треснувшие плиты: не все, а примерно каждая шестая.
		float sunk = smoothstep(0.62, 1.0, r2);
		col *= 1.0 - sunk * 0.14;
		if (r1 > 0.72) {
			// трещина через плиту, своя у каждой
			float cr = abs(f.x - (0.25 + 0.5 * r2)
					+ (vnoise(w * 9.0 + id) - 0.5) * 0.22);
			float cm = 1.0 - smoothstep(0.006, 0.03, cr);
			col = mix(col, col_joint, cm * 0.8);
			rough = mix(rough, 1.0, cm);
		}
	} else if (kind == 1) {
		// --- асфальт ---------------------------------------------------
		// щебень — одна выборка, не fbm: на таком масштабе октавы неразличимы
		float chips = vnoise(w * 26.0);
		col *= 1.0 - (chips - 0.5) * 0.28 * fine;

		// Колеи: две накатанные полосы на полосу движения. Там асфальт
		// заглажен и темнее, между ними и по краям — шершавее и светлее.
		float track = exp(-pow((edge - 0.46) / 0.15, 2.0));
		col *= 1.0 - track * 0.13;
		rough = mix(rough, 0.62, track * mid_fade);

		// Ремонтные карты: прямоугольные заплаты другого замеса, со швом.
		vec2 pid = floor(vec2(w.x / 7.0, w.y / 3.5) + 31.0);
		if (h21(pid) > 0.68) {
			vec2 pf = fract(vec2(w.x / 7.0, w.y / 3.5) + 31.0);
			vec2 pe = min(pf, 1.0 - pf);
			float inside = smoothstep(0.03, 0.07, min(pe.x, pe.y));
			col = mix(col, col * 0.74, inside);
			float pseam = (1.0 - smoothstep(0.0, 0.035, min(pe.x, pe.y)))
					* step(0.02, min(pe.x, pe.y));
			col = mix(col, col_joint, pseam * 0.6);
		}

		// Сетка трещин. Один хребтовый шум на три октавы уже даёт и крупные
		// разломы, и мелкое ветвление — второй вызов ради «крокодильей»
		// сетки по краям стоил вдвое, а на глаз не добавлял ничего.
		float big = ridge(w * 0.55, 3);
		float cm1 = smoothstep(0.62, 0.80, big);
		float cm2 = smoothstep(0.74, 0.90, big) * smoothstep(0.35, 0.9, edge);
		float cm = clamp(cm1 + cm2 * 0.7, 0.0, 1.0);
		col = mix(col, col_joint * 0.85, cm * 0.75);
		rough = mix(rough, 1.0, cm);

		// Выбоины: редкие, с тёмным нутром и светлым обломанным ободком.
		vec2 hid = floor(w / 4.5 + 61.0);
		vec2 hf = fract(w / 4.5 + 61.0) - 0.5;
		float hr = h21(hid);
		if (hr > 0.86) {
			float rad = 0.10 + 0.10 * h21(hid + 2.3);
			float d2 = length(hf * vec2(1.0, 1.25))
					+ (vnoise(w * 7.0) - 0.5) * 0.05;
			float hole = 1.0 - smoothstep(rad * 0.6, rad, d2);
			float rim = smoothstep(rad, rad * 1.25, d2)
					* (1.0 - smoothstep(rad * 1.25, rad * 1.6, d2));
			col = mix(col, col_joint * 0.6, hole * 0.85);
			col = mix(col, col_a * 0.9, rim * 0.35);
			rough = mix(rough, 1.0, hole);
		}

		// Осевая разметка: почти стёрта. Она и делает полосу дорогой,
		// а её состояние — заброшенной дорогой.
		float dash = step(0.35, fract(w.x / 6.0));
		float line = (1.0 - smoothstep(0.045, 0.075, abs(lat * lat_half)))
				* dash;
		float wear = smoothstep(0.30, 0.72, stain * 0.6 + mid * 0.4);
		col = mix(col, vec3(0.72, 0.70, 0.63), line * wear * 0.55);

		// У бордюра наметает песок и мусор, там же держится вода.
		float silt = smoothstep(0.72, 1.0, edge);
		col = mix(col, col_a * 0.78, silt * (0.30 + 0.30 * mid));
		rough = mix(rough, 1.0, silt);
	} else {
		// --- земля -----------------------------------------------------
		float lumps = fbm(w * 3.1, 3);
		col *= 0.85 + lumps * 0.35;
	}

	if (is_side) {
		float se = fbm(wpos.xy * 6.0, 2);
		col = col_b * (0.80 + se * 0.30);
		rough = 1.0;
	}

	ALBEDO = col;
	ROUGHNESS = clamp(rough, 0.35, 1.0);
	METALLIC = 0.0;
	SPECULAR = 0.25;
}
"""

var _m_asphalt: ShaderMaterial
var _m_walk: ShaderMaterial
var _m_kerb: ShaderMaterial
var _m_earth: ShaderMaterial
var _m_facade: StandardMaterial3D
var _surface_shader: Shader


func _ready() -> void:
	_materials()

	# Улица начинается там, где кончается отмостка дома: её кладёт сам
	# `tower.gd` (`Tower.APRON`), и дублировать её здесь значило бы положить
	# одну плиту под другую — ровно эта ошибка и прятала палисадник.
	var front := -Tower.D_HALF - Tower.APRON
	var back := Tower.D_HALF + Tower.APRON

	# --- лицевая сторона: палисадник -> тротуар -> бордюр -> проезд
	var z := front
	var garden_z := _strip(z, -1, GARDEN, Y_WALK - 0.03, _m_earth, "Garden")
	z -= GARDEN
	var walk_z := _strip(z, -1, WALK_W, Y_WALK, _m_walk, "Walk")
	z -= WALK_W
	_kerb(z, -1)
	z -= KERB_W
	var road_z := _strip(z, -1, ROAD_W, Y_ROAD, _m_asphalt, "Road")
	z -= ROAD_W
	_kerb(z + KERB_W, 1)          # дальний бордюр смотрит в другую сторону
	z -= KERB_W
	var far_walk_z := _strip(z, -1, WALK_W, Y_WALK, _m_walk, "WalkFar")
	z -= WALK_W + FAR_GAP

	_far_row(z)

	# --- дворовая сторона: заросшая земля, проезда нет
	var yard_z := _strip(back, 1, GARDEN * 2.2, Y_WALK - 0.03, _m_earth, "Yard")

	_entrance()
	_overgrowth(garden_z, walk_z, road_z, far_walk_z, yard_z, front)


## Подъезд. Изнутри он давно есть — ядро, лестничная клетка, площадки, две
## шахты лифта. Снаружи входа не было вовсе: наружу выводил разрыв шириной 1.40
## в поясном парапете лоджии первого этажа с дворовой стороны
## (`Tower.EXIT_X`, условие `fixed > 8.9` в `tower.gd::_parapet`). Заглушка
## времён, когда за порогом был обрыв — и дом из-за неё стоял квартирами
## прямо на земле.
##
## Достраивается ПЕРЕД проёмом, а не правкой генерации стен: та считает
## проёмы по соседству помещений с чертежа, и лезть туда ради крыльца — это
## риск уронить весь разбор. Здесь же всё привязано к `Tower.EXIT_X/EXIT_W`,
## поэтому если проём на чертеже переедет, крыльцо уедет за ним.
func _entrance() -> void:
	var x := Tower.EXIT_X
	var zw := Tower.D_HALF              # стена дворового фасада
	var w := Tower.EXIT_W + 1.30        # крыльцо шире проёма
	var d := 1.80                       # вынос площадки от стены
	var jamb := 0.30                    # ширина щеки
	var door_h := 2.20

	# Площадка вровень с полом дома. Отмостка ниже на 5 см, тротуар двора —
	# на 15: получается две естественные ступени, выдумывать высоту не надо.
	_slab(Vector3(w, 0.30, d), Vector3(x, -0.15, zw + d * 0.5),
			_lat(_m_walk, zw + d * 0.5, d * 0.5), "PorchSlab")
	_slab(Vector3(w + 0.5, 0.10, 0.34),
			Vector3(x, -0.10, zw + d + 0.17), _lat(_m_kerb, zw + d + 0.17, 0.17), "PorchStep")

	# Щёки по бокам проёма: они и держат козырёк, и превращают дыру в парапете
	# в дверной портал.
	for s: float in [-1.0, 1.0]:
		var jx: float = x + s * (Tower.EXIT_W * 0.5 + jamb * 0.5)
		_slab(Vector3(jamb, door_h + 0.35, 0.36),
				Vector3(jx, (door_h + 0.35) * 0.5, zw + 0.18),
				_m_facade, "PorchJamb")
	# перемычка над проёмом
	_slab(Vector3(Tower.EXIT_W + jamb * 2.0, 0.35, 0.36),
			Vector3(x, door_h + 0.175, zw + 0.18), _m_facade, "PorchLintel")

	# Козырёк с небольшим уклоном от стены — по нему и читается подъезд
	# с любого ракурса.
	var vis := MeshInstance3D.new()
	var vm := BoxMesh.new()
	vm.size = Vector3(w + 0.6, 0.14, d + 0.35)
	vis.mesh = vm
	vis.material_override = _m_facade
	vis.position = Vector3(x, door_h + 0.62, zw + (d + 0.35) * 0.5)
	vis.rotation_degrees = Vector3(-4.0, 0.0, 0.0)
	add_child(vis)
	# подкосы
	for s: float in [-1.0, 1.0]:
		var bx: float = x + s * (w * 0.5 - 0.15)
		var br := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.10, 0.10, 1.35)
		br.mesh = bm
		br.material_override = _m_kerb
		br.position = Vector3(bx, door_h + 0.12, zw + 0.62)
		br.rotation_degrees = Vector3(28.0, 0.0, 0.0)
		add_child(br)

	# Дверь: глухая нижняя часть и застеклённый верх, как в типовой серии.
	var leaf := StandardMaterial3D.new()
	leaf.albedo_color = Color(0.20, 0.24, 0.22)
	leaf.roughness = 0.55
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.42, 0.50, 0.52, 0.35)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.roughness = 0.12
	var dz := zw - 0.04
	_panel(Vector3(Tower.EXIT_W, 1.05, 0.06), Vector3(x, 0.52, dz), leaf)
	_panel(Vector3(Tower.EXIT_W, door_h - 1.20, 0.04),
			Vector3(x, 1.05 + (door_h - 1.20) * 0.5, dz), glass)
	_panel(Vector3(Tower.EXIT_W, 0.08, 0.07), Vector3(x, 1.09, dz), leaf)

	# Дорожка от крыльца во двор: без неё подъезд выходит в бурьян.
	_slab(Vector3(1.60, 0.30, 9.0),
			Vector3(x, Y_WALK - 0.15, zw + d + 4.5), _lat(_m_walk, zw + d + 4.5, 0.80), "PorchPath")


## Деталь без коллизии: дверное полотно и стекло игрок не толкает, проход
## сделан разрывом в парапете.
func _panel(size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)


## Полоса вдоль всего фасада. `dir` = −1 наружу от лицевой стены, +1 от
## дворовой. Возвращает координату дальнего края, чтобы класть следующую.
func _strip(z_edge: float, dir: int, width: float, top: float,
		mat: Material, name_: String) -> float:
	var thick := 0.30
	var cz := z_edge + dir * width * 0.5
	_slab(Vector3(LEN_HALF * 2.0, thick, width),
			Vector3(0.0, top - thick * 0.5, cz), _lat(mat, cz, width * 0.5),
			name_)
	return z_edge + dir * width


## Копия материала, знающая, где у ЭТОЙ полосы середина и края. Без копии все
## полосы делили бы один материал и один `lat_center`, то есть колеи и грязь
## у бордюра считались бы от чужой оси. Материалов от этого немного: по одному
## на полосу, а полос меньше десятка.
func _lat(mat: Material, center: float, half: float) -> Material:
	var sm := mat as ShaderMaterial
	if sm == null:
		return mat
	var m: ShaderMaterial = sm.duplicate()
	m.set_shader_parameter("lat_center", center)
	m.set_shader_parameter("lat_half", maxf(half, 0.05))
	return m


## Бордюр: торчит на KERB_H над проезжей частью. `face` — в какую сторону
## смотрит его лицевая грань (−1 к проезду с лицевой стороны улицы).
func _kerb(z_edge: float, face: int) -> void:
	var cz := z_edge - float(face) * KERB_W * 0.5
	_slab(Vector3(LEN_HALF * 2.0, KERB_H + 0.30, KERB_W),
			Vector3(0.0, Y_WALK - (KERB_H + 0.30) * 0.5 + KERB_H, cz),
			_lat(_m_kerb, cz, KERB_W * 0.5), "Kerb")


func _slab(size: Vector3, pos: Vector3, mat: Material,
		name_: String) -> void:
	var body := StaticBody3D.new()
	body.name = name_
	body.position = pos
	add_child(body)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	body.add_child(cs)


## Ряд домов напротив: глухие коробки с тем же панельным бетоном. Внутрь зайти
## нельзя и не надо — они нужны, чтобы улица читалась улицей, а не диорамой
## на столе. Один корпус на весь кадр читался стеной, поэтому их несколько
## с разрывами; дальние уходят в туман, и где ряд кончается — не видно.
##
## Окна всего ряда — ОДИН MultiMesh: полторы сотни проёмов за одну отрисовку.
## Поштучными нодами это было бы +150 draw call на фон, который даже не
## интерактивен.
func _far_row(z_face: float) -> void:
	var h := float(FAR_FLOORS) * Tower.FLOOR_H
	var d := 12.0
	var pitch := FAR_BLOCK_W + FAR_BLOCK_GAP
	var n := int(ceil(LEN_HALF * 2.0 / pitch))
	var win_step := 2.90
	var cols := int(floor(FAR_BLOCK_W / win_step))

	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var win := BoxMesh.new()
	win.size = Vector3(1.30, 1.50, 0.18)
	mm.mesh = win
	mm.instance_count = n * cols * FAR_FLOORS

	var i := 0
	for b in n:
		var bx := -LEN_HALF + pitch * 0.5 + float(b) * pitch
		_slab(Vector3(FAR_BLOCK_W, h, d),
				Vector3(bx, Y_WALK + h * 0.5, z_face - d * 0.5),
				_m_facade, "FarBlock")
		for f in FAR_FLOORS:
			var y := Y_WALK + 1.10 + float(f) * Tower.FLOOR_H
			for c in cols:
				var x := bx - FAR_BLOCK_W * 0.5 + win_step * 0.5 \
						+ float(c) * win_step
				mm.set_instance_transform(i, Transform3D(Basis(),
						Vector3(x, y, z_face - 0.02)))
				i += 1
	mm.instance_count = i

	var mmi := MultiMeshInstance3D.new()
	mmi.name = "FarWindows"
	mmi.multimesh = mm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.09, 0.10, 0.11)
	gm.roughness = 0.35
	gm.metallic = 0.0
	mmi.material_override = gm
	add_child(mmi)


## Зелень (task-0011). Набор сдавался ровно под это — фасад, подъезд, лоджии.
## Плотность падает от земли к проезду: у стены и вдоль бордюров воды больше,
## по осевой проезда её нет.
func _overgrowth(garden_z: float, walk_z: float, road_z: float,
		far_walk_z: float, yard_z: float, front: float) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 20260912        # улица должна быть одинаковой между запусками
	# Зелень только вокруг дома, а не по всей длине полос: дальше 60 м она
	# всё равно в дымке, а размазанная по 300 м читалась бы конфетти.
	var g := 58.0

	# трава сквозь палисадник и через швы тротуара
	for i in 26:
		var x := rng.randf_range(-g, g)
		var z := rng.randf_range(garden_z, front)
		_grass(rng, x, z, rng.randf_range(0.7, 1.15))
	for i in 14:
		var x := rng.randf_range(-g, g)
		var z := rng.randf_range(walk_z, walk_z + WALK_W)
		_grass(rng, x, z, rng.randf_range(0.4, 0.7))
	# по кромке проезда вдоль обоих бордюров — там держится вода
	for i in 18:
		var x := rng.randf_range(-g, g)
		var near := rng.randf() < 0.5
		var z := (road_z - 0.5) if near else (road_z - ROAD_W + 0.5)
		_grass(rng, x, z + rng.randf_range(-0.4, 0.4),
				rng.randf_range(0.45, 0.8))
	# двор зарос сильнее: туда никто не ездил
	for i in 22:
		var x := rng.randf_range(-g * 0.9, g * 0.9)
		var z := rng.randf_range(Tower.D_HALF + Tower.APRON, yard_z)
		_grass(rng, x, z, rng.randf_range(0.8, 1.25))

	# мох по низу фасада с обеих сторон
	var n_moss := int(Tower.W_HALF * 2.0 / 2.0)
	for i in n_moss:
		var x := -Tower.W_HALF + (float(i) + 0.5) * (Tower.W_HALF * 2.0 / n_moss)
		DecalLib.put(self, "overgrowth/moss_edge",
				Vector3(x, Y_WALK + 0.30, -Tower.D_HALF - 0.02),
				Vector3(0, 0, -1), 1.0, -1.0, Color(1, 1, 1), GREEN_MIX)
		DecalLib.put(self, "overgrowth/moss_edge",
				Vector3(x, Y_WALK + 0.30, Tower.D_HALF + 0.02),
				Vector3(0, 0, 1), 1.0, -1.0, Color(1, 1, 1), GREEN_MIX)

	# плети по фасаду: редко и вразнобой, иначе читается обоями
	for i in 9:
		var x := rng.randf_range(-Tower.W_HALF + 1.5, Tower.W_HALF - 1.5)
		var face_z := -Tower.D_HALF - 0.02 if rng.randf() < 0.6 else Tower.D_HALF + 0.02
		var nrm := Vector3(0, 0, -1) if face_z < 0.0 else Vector3(0, 0, 1)
		DecalLib.put(self, "overgrowth/vine_wall_1" if i % 2 == 0
				else "overgrowth/vine_wall_2",
				Vector3(x, Y_WALK + rng.randf_range(1.2, 2.2), face_z),
				nrm, rng.randf_range(0.8, 1.25), -1.0, Color(1, 1, 1), GREEN_MIX)


func _grass(rng: RandomNumberGenerator, x: float, z: float,
		scale_: float) -> void:
	DecalLib.put(self, "overgrowth/grass_patch_1" if rng.randf() < 0.5
			else "overgrowth/grass_patch_2",
			Vector3(x, Y_WALK + 0.02, z), Vector3(0, 1, 0), scale_,
			-1.0, Color(1, 1, 1), GREEN_MIX)


func _materials() -> void:
	_surface_shader = Shader.new()
	_surface_shader.code = SURFACE_SHADER

	# Тротуар: серая бетонная плита 0.75 м, какую клали во дворах.
	_m_walk = _surface(0, Color(0.66, 0.65, 0.62), Color(0.47, 0.46, 0.44),
			Color(0.26, 0.26, 0.24), 0.75)
	# Асфальт: тёмный, но не чёрный — выгоревший и запылённый.
	_m_asphalt = _surface(1, Color(0.30, 0.30, 0.31), Color(0.19, 0.19, 0.20),
			Color(0.11, 0.11, 0.12), 1.0)
	# Бордюрный камень: та же плита, но крупнее и холоднее.
	_m_kerb = _surface(0, Color(0.60, 0.60, 0.59), Color(0.46, 0.46, 0.45),
			Color(0.28, 0.28, 0.27), 1.00)
	_m_earth = _surface(2, Color(0.30, 0.27, 0.19), Color(0.17, 0.16, 0.12),
			Color(0.12, 0.11, 0.08), 1.0)
	# Дом напротив — тот же панельный бетон, что на нашем доме: это фон,
	# и он должен читаться той же серией застройки.
	_m_facade = _textured("concrete-facade", Color(0.55, 0.55, 0.54), 3.0)


func _surface(kind: int, a: Color, b: Color, joint_c: Color,
		plate: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _surface_shader
	m.set_shader_parameter("kind", kind)
	m.set_shader_parameter("col_a", a)
	m.set_shader_parameter("col_b", b)
	m.set_shader_parameter("col_joint", joint_c)
	m.set_shader_parameter("plate", plate)
	m.set_shader_parameter("joint", 0.030)
	m.set_shader_parameter("rough_base", 0.92)
	return m


func _plain(c: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = 0.0
	return m


## Трипланар, потому что полосы улицы — длинные боксы: обычная развёртка
## BoxMesh растянула бы текстуру на все девяносто метров.
func _textured(set_name: String, c: Color, tile_m: float) -> StandardMaterial3D:
	var m := _plain(c, 0.95)
	var dir := "res://assets/textures/%s/" % set_name
	var stem := set_name.replace("-", "_")
	var alb := "%s%s_albedo_1k.png" % [dir, stem]
	if not ResourceLoader.exists(alb):
		return m
	m.albedo_texture = load(alb)
	var nrm := "%s%s_normal_1k.png" % [dir, stem]
	if ResourceLoader.exists(nrm):
		m.normal_enabled = true
		m.normal_texture = load(nrm)
	var orm := "%s%s_orm_1k.png" % [dir, stem]
	if ResourceLoader.exists(orm):
		m.ao_enabled = true
		m.ao_texture = load(orm)
		m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
		m.roughness_texture = load(orm)
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
	m.uv1_triplanar = true
	m.uv1_scale = Vector3.ONE / tile_m
	return m
