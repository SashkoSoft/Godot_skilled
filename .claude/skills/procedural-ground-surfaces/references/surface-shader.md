# Рабочий шейдер покрытия целиком

Снят с game/street.gd проекта, из которого вырос скил. `kind`: 0 —
тротуарная плита, 1 — асфальт, 2 — земля. Уникформы `lat_center` /
`lat_half` задаются на КОПИЮ материала для каждой полосы отдельно.

```gdscript
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
```