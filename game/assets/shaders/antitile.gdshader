shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley,
		specular_schlick_ggx, world_vertex_coords;

// Тайл, который не читается тайлом.
//
// Три приёма, каждый бьёт свой масштаб повторения:
//   1. стохастическая выборка по треугольной решётке (Heitz & Neyret) —
//      убирает саму сетку тайла: в каждой точке смешиваются три сдвинутые
//      копии текстуры, границы смешивания идут по случайной решётке;
//   2. макро-вариация — крупный шум с шагом в несколько метров слегка
//      меняет светлоту и тон, так что «поле» пола не одинаковое;
//   3. пере-окраска по карте id — если у набора есть карта, где каждая
//      паркетина залита своим номером, каждая получает собственный оттенок.
//
// UV берётся из мировых координат по доминирующей оси нормали: геометрия
// собрана из осевых коробок, поэтому полноценный трипланар не нужен, а три
// выборки вместо девяти экономят втрое.

uniform sampler2D tex_albedo : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D tex_orm : hint_default_white, filter_linear_mipmap_anisotropic;
uniform sampler2D tex_id : hint_default_black, filter_linear_mipmap_anisotropic;

uniform float tile_m = 1.6;          // сколько метров занимает один тайл
uniform vec4 tint : source_color = vec4(1.0);
// Контраст рисунка: 1.0 — как в наборе, меньше — рисунок глуше. Считается
// относительно среднего цвета набора, он передаётся отдельно, иначе тянуть
// его пришлось бы из текстуры каждый кадр.
uniform float contrast = 1.0;
uniform vec4 base_col : source_color = vec4(0.5, 0.5, 0.5, 1.0);
// Шероховатость берётся из ORM и множится на этот коэффициент: так плитка
// блестит, линолеум почти нет, а бетон совсем матовый. Раньше здесь стояла
// константа 0.92 — тогда все поверхности выглядели одинаково матовыми.
uniform float roughness_mul = 1.0;
uniform float roughness_min = 0.18;
uniform float specular_amount = 0.5;
uniform float normal_depth = 1.0;

uniform bool use_stochastic = true;
// Если у набора внутри регулярная сетка (плитка, щитовой паркет), сдвиг копий
// надо привязать к её шагу: иначе стохастика разрежет шов между плитками и
// ряды планок перестанут продолжаться. Число — сколько ячеек в тайле.
uniform int snap_cells = 0;
uniform float macro_scale_m = 7.3;   // шаг макро-вариации, метры
uniform float macro_value = 0.09;    // насколько гуляет светлота
uniform float macro_hue = 0.03;      // насколько гуляет тон

uniform bool use_id = false;
uniform float id_value = 0.16;       // разброс светлоты между планками
uniform float id_hue = 0.05;

// Пятна выцветания: комбинирует по маске цветную и обесцвеченную версию ОДНОЙ
// и той же текстуры — там, где солнце годами било в пол сильнее, паркет не
// просто светлее, у него и цвет садится первым. Пятна резкие (smoothstep), не
// градиент — так читается как два соседних куска пола, а не общая дымка.
uniform float mono_patch = 0.0;      // 0 — выключено, иначе сила ухода в ч/б
uniform float mono_scale_m = 2.6;    // размер пятна, метры, не кратно тайлу
uniform float mono_sharp = 3.0;      // резкость границы пятна

varying vec3 world_pos;
varying vec3 world_nrm;


// Дублировать treugolnuyu setku на каждый канал незачем: у альбедо, нормали,
// ORM и id один и тот же uv, значит и решётка, и веса смешивания общие.
// Раньше sample_stochastic пересчитывала её самостоятельно на каждый вызов —
// до четырёх раз за фрагмент с одинаковым результатом.
vec4 blend3(sampler2D t, vec2 uv, vec2 ddx, vec2 ddy,
		vec2 o1, vec2 o2, vec2 o3, vec3 p) {
	vec4 c1 = textureGrad(t, uv + o1, ddx, ddy);
	vec4 c2 = textureGrad(t, uv + o2, ddx, ddy);
	vec4 c3 = textureGrad(t, uv + o3, ddx, ddy);
	return c1 * p.x + c2 * p.y + c3 * p.z;
}


vec2 hash2(vec2 p) {
	return fract(sin(vec2(dot(p, vec2(127.1, 311.7)),
			dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}


float hash1(float n) {
	return fract(sin(n * 78.233) * 43758.5453);
}


// Треугольная решётка: три опорные вершины и веса. Из статьи Heitz & Neyret
// «High-Performance By-Example Noise using a Histogram-Preserving Blending».
void triangle_grid(vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
	uv *= 3.4641016;                       // 2 * sqrt(3)
	mat2 to_skew = mat2(vec2(1.0, -0.57735027), vec2(0.0, 1.15470054));
	vec2 skewed = to_skew * uv;
	vec2 base = floor(skewed);
	vec3 t = vec3(fract(skewed), 0.0);
	t.z = 1.0 - t.x - t.y;
	if (t.z > 0.0) {
		w = vec3(t.z, t.y, t.x);
		v1 = base;
		v2 = base + vec2(0.0, 1.0);
		v3 = base + vec2(1.0, 0.0);
	} else {
		w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x);
		v1 = base + vec2(1.0, 1.0);
		v2 = base + vec2(1.0, 0.0);
		v3 = base + vec2(0.0, 1.0);
	}
}




// Тот же треугольный разбор, но возвращает только номер ячейки — им красим
// крупные пятна макро-вариации, чтобы они не совпадали с сеткой тайла.
float cell_noise(vec2 uv) {
	vec3 w;
	vec2 v1;
	vec2 v2;
	vec2 v3;
	triangle_grid(uv, w, v1, v2, v3);
	float n1 = hash1(dot(v1, vec2(1.0, 57.0)));
	float n2 = hash1(dot(v2, vec2(1.0, 57.0)));
	float n3 = hash1(dot(v3, vec2(1.0, 57.0)));
	return n1 * w.x + n2 * w.y + n3 * w.z;
}


void vertex() {
	// world_vertex_coords переводит VERTEX/NORMAL в мировые координаты сам —
	// раньше это делалось вручную через MODEL_MATRIX.
	world_pos = VERTEX;
	world_nrm = normalize(NORMAL);
}


void fragment() {
	// плоскость проекции — по доминирующей оси нормали
	vec3 an = abs(world_nrm);
	vec2 uv;
	if (an.y >= an.x && an.y >= an.z) {
		uv = world_pos.xz;
	} else if (an.x >= an.z) {
		uv = vec2(world_pos.z, -world_pos.y);
	} else {
		uv = vec2(world_pos.x, -world_pos.y);
	}
	uv /= tile_m;

	vec2 ddx = dFdx(uv);
	vec2 ddy = dFdy(uv);

	vec4 alb;
	vec3 nrm;
	vec3 orm;
	// Смещения и веса решётки — на весь фрагмент один раз: у альбедо, нормали,
	// ORM и id общий uv, значит общая решётка. Объявлены здесь, а не внутри
	// if, чтобы карта id ниже могла их переиспользовать, а не считать заново.
	vec2 o1 = vec2(0.0);
	vec2 o2 = vec2(0.0);
	vec2 o3 = vec2(0.0);
	vec3 p = vec3(0.0);
	if (use_stochastic) {
		vec3 gw;
		vec2 v1;
		vec2 v2;
		vec2 v3;
		triangle_grid(uv, gw, v1, v2, v3);
		o1 = hash2(v1);
		o2 = hash2(v2);
		o3 = hash2(v3);
		if (snap_cells > 0) {
			float k = float(snap_cells);
			o1 = floor(o1 * k) / k;
			o2 = floor(o2 * k) / k;
			o3 = floor(o3 * k) / k;
		}
		p = pow(gw, vec3(7.0));
		p /= (p.x + p.y + p.z);
		alb = blend3(tex_albedo, uv, ddx, ddy, o1, o2, o3, p);
		nrm = blend3(tex_normal, uv, ddx, ddy, o1, o2, o3, p).rgb;
		orm = blend3(tex_orm, uv, ddx, ddy, o1, o2, o3, p).rgb;
	} else {
		alb = textureGrad(tex_albedo, uv, ddx, ddy);
		nrm = textureGrad(tex_normal, uv, ddx, ddy).rgb;
		orm = textureGrad(tex_orm, uv, ddx, ddy).rgb;
	}

	vec3 col = alb.rgb;
	if (contrast < 0.999) {
		col = base_col.rgb + (col - base_col.rgb) * contrast;
	}
	col *= tint.rgb;

	// макро-вариация: крупные пятна, шаг задан в метрах и не кратен тайлу
	float m = cell_noise(uv * tile_m / macro_scale_m);
	col *= 1.0 + (m - 0.5) * 2.0 * macro_value;
	col.r *= 1.0 + (m - 0.5) * 2.0 * macro_hue;
	col.b *= 1.0 - (m - 0.5) * 2.0 * macro_hue;

	// своя окраска каждой паркетине — та же решётка, что у альбедо выше
	if (use_id) {
		float id = use_stochastic
				? blend3(tex_id, uv, ddx, ddy, o1, o2, o3, p).r
				: textureGrad(tex_id, uv, ddx, ddy).r;
		float h = hash1(floor(id * 255.0) + 0.5);
		col *= 1.0 + (h - 0.5) * 2.0 * id_value;
		col.r *= 1.0 + (h - 0.5) * 2.0 * id_hue;
		col.g *= 1.0 + (h - 0.5) * id_hue;
	}

	// пятна выцветания: цветная и обесцвеченная версия одной текстуры
	float pm_debug = cell_noise(uv * tile_m / mono_scale_m + vec2(37.0, 91.0));
	if (mono_patch > 0.001) {
		float pm = pm_debug;
		float t = smoothstep(0.5 - 0.5 / mono_sharp, 0.5 + 0.5 / mono_sharp, pm);
		float luma = dot(col, vec3(0.299, 0.587, 0.114));
		col = mix(col, vec3(luma), t * mono_patch);
	}
	if (mono_patch > 100.0) { col = vec3(pm_debug); }

	ALBEDO = col;
	NORMAL_MAP = nrm;
	NORMAL_MAP_DEPTH = normal_depth;
	ROUGHNESS = clamp(orm.g * roughness_mul, roughness_min, 1.0);
	METALLIC = 0.0;
	SPECULAR = specular_amount;
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.7;
}
