import * as THREE from "three";

// Ветер для деревьев — вставкой в стандартный материал через onBeforeCompile,
// как покрытие улицы: свет, тени и туман остаются общими. Смещение считается
// в мировых координатах ПОСЛЕ матрицы экземпляра, иначе у каждого дерева
// «ветер» дул бы в свою сторону — экземпляры повёрнуты.
//
// Три уровня: ствол (всё дерево, медленно), ветки (вразнобой по фазе),
// листья (мелкая дрожь). Порыв — волна, бегущая по кварталу по ветру.
// Маски из генератора — атрибут _wind (x изгиб, y фаза ветки, z дрожь,
// w порядок ветки); пока их нет — изгиб оценивается по высоте вершины.

export const windUniforms = {
	uTime: { value: 0 },
	uWindDir: { value: new THREE.Vector2(1, 0) },
	uWindStrength: { value: 0.6 },
	uFlutter: { value: 0.5 },
	uSSS: { value: 1 },   // сила просвета листвы против солнца (#sss=)
};

// Выключатель ветра — для замера его цены (perf.js, строка «ветер»): смещение
// вершин не считается вовсе, программы пересобираются.
let windOn = true;
const windMats = [];
export function setWindEnabled(on) {
	windOn = on;
	for (const m of windMats) m.needsUpdate = true;
}

export function setWind({ dirDeg = 60, strength = 0.6, flutter = 0.5 } = {}) {
	const a = dirDeg * Math.PI / 180;
	windUniforms.uWindDir.value.set(Math.cos(a), Math.sin(a));
	windUniforms.uWindStrength.value = strength;
	windUniforms.uFlutter.value = flutter;
}

const HEAD = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uFlutter;
uniform float uSSS;
uniform float uTreeH;
#ifdef WIND_ATTR
attribute vec4 _wind;
#endif
// Растворение при смене LOD: 1 — видно целиком; 0…1 — проявляется;
// 2…3 — исчезает (дополняющие пиксели к проявляющейся ступени).
varying float vLodFade;
// VEG_BATCH — растения в BatchedMesh (все варианты одной ступени — один вызов):
// параметры варианта и растворение — не униформами и атрибутом, а из текстур по
// номеру экземпляра. uVegData: 6 текселей на экземпляр, 256 экземпляров в строке
// (0: высота, доля осени; 1: центр кроны; 2: полуоси кроны; 3–5: палитра осени).
// uVegFade: растворение, 1024 в строке.
#ifdef VEG_BATCH
uniform highp sampler2D uVegData, uVegFade;
#else
attribute float aFade;
#endif
// параметры варианта для текущей вершины (из униформ или из текстуры — см. PROJECT)
float gTreeH, gAutAmt;
vec3 gCrownC, gCrownR, gAut0, gAut1, gAut2;
#ifdef WIND_TINT
varying vec3 vLeafTint;
// Глубина в кроне: 1 — на поверхности, 0 — в сердцевине; нормаль кроны (вид).
// Из генератора (_crown: xyz — наружу, w — глубина) или оценка по эллипсоиду листвы.
uniform vec3 uCrownC, uCrownR;
varying float vCrownDepth;
varying vec3 vCrownN;
// Начало осени по породе (district.json trees.autumn): доля пожелтевших веток
// и палитра из трёх цветов; uAutAmt = 0 — порода не желтеет (сирень).
uniform vec3 uAut0, uAut1, uAut2;
uniform float uAutAmt;
varying vec4 vAut;
#ifdef CROWN_ATTR
attribute vec4 _crown;
#endif
#endif

float windHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// local — вершина в координатах дерева (до экземпляра), world — после.
vec3 windOffset(vec3 local, vec3 world, vec3 root) {
#ifdef NO_WIND
	return vec3(0.0);
#endif
#ifdef WIND_ATTR
	float bend = _wind.x, phase = _wind.y, flut = _wind.z, order = _wind.w;
#else
	float h = clamp(local.y / gTreeH, 0.0, 1.0);
	float bend = h * h;
	float phase = windHash(floor(local * 0.8));         // «ветка» — ячейка кроны
	float flut = 1.0;
	float order = h;
#endif
	float s = uWindStrength;
	float treePhase = windHash(floor(root * 0.37)) * 6.2831;
	// порыв: волна вдоль ветра, у каждого дерева своя задержка
	float along = dot(root.xz, uWindDir);
	float gust = 0.55 + 0.45 * sin(uTime * 0.45 - along * 0.035) * sin(uTime * 0.17 - along * 0.011 + 1.3);
	vec3 off = vec3(0.0);
	// ствол: медленный наклон по ветру + качание, амплитуда в метрах от высоты дерева
	float trunk = bend * gTreeH * 0.035 * s;
	float sway = gust + 0.25 * sin(uTime * 1.3 + treePhase);
	off.xz += uWindDir * trunk * sway;
	// ветки: вразнобой, тонкие быстрее
	float br = sin(uTime * (1.6 + order * 1.4) + phase * 6.2831 + treePhase);
	off += vec3(uWindDir.x, 0.35, uWindDir.y) * br * bend * 0.12 * s * (0.6 + gust);
#ifdef WIND_LEAF
	// листья: мелкая дрожь, фаза от положения карточки; сила — uFlutter
	float lp = windHash(floor(local * 6.0)) * 6.2831;
	off += vec3(sin(uTime * 6.0 + lp), sin(uTime * 7.3 + lp * 1.3), sin(uTime * 6.7 + lp * 0.7))
		* 0.035 * uFlutter * s * flut * (0.3 + bend) * (0.5 + gust);
#endif
	return off;
}
`;

const PROJECT = /* glsl */`
#ifdef VEG_BATCH
{
	int vi = int( getIndirectIndex( gl_DrawID ) );
	ivec2 vb = ivec2( ( vi % 256 ) * 6, vi / 256 );
	vec4 vd = texelFetch( uVegData, vb, 0 );
	gTreeH = vd.x; gAutAmt = vd.y;
	gCrownC = texelFetch( uVegData, vb + ivec2( 1, 0 ), 0 ).xyz;
	gCrownR = texelFetch( uVegData, vb + ivec2( 2, 0 ), 0 ).xyz;
	gAut0 = texelFetch( uVegData, vb + ivec2( 3, 0 ), 0 ).xyz;
	gAut1 = texelFetch( uVegData, vb + ivec2( 4, 0 ), 0 ).xyz;
	gAut2 = texelFetch( uVegData, vb + ivec2( 5, 0 ), 0 ).xyz;
	vLodFade = texelFetch( uVegFade, ivec2( vi % 1024, vi / 1024 ), 0 ).r;
}
#else
gTreeH = uTreeH;
#ifdef WIND_TINT
gCrownC = uCrownC; gCrownR = uCrownR; gAut0 = uAut0; gAut1 = uAut1; gAut2 = uAut2; gAutAmt = uAutAmt;
#endif
vLodFade = aFade;
#endif
vec4 mvPosition = vec4( transformed, 1.0 );
vec3 windRoot = vec3( 0.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
	windRoot = batchingMatrix[ 3 ].xyz;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	windRoot = instanceMatrix[ 3 ].xyz;
#endif
mvPosition.xyz += windOffset( transformed, mvPosition.xyz, windRoot );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
#ifdef WIND_TINT
{
	// Разнотон листвы в три уровня: дерево (от желтовато- до сизо-зелёного,
	// светлее/темнее), ветка (ячейка кроны ~1.2 м), карточка листьев (мелкий
	// разброс). Верх и край кроны светлее — там больше солнца. У немногих
	// деревьев желтеют отдельные ветки: квартал заброшенный, деревья болеют.
	float tH = windHash(floor(windRoot * 0.37) + 1.7);
	float tV = windHash(floor(windRoot * 0.37) + 5.3);
	float bH = windHash(floor(transformed * 0.8) + floor(windRoot));
	float cH = windHash(floor(transformed * 6.0) + floor(windRoot));
	float h = clamp(transformed.y / gTreeH, 0.0, 1.0);
	vec3 yellowish = vec3(1.18, 1.08, 0.62), bluish = vec3(0.82, 0.98, 1.02);
	vec3 tint = mix(bluish, yellowish, tH) * (0.78 + 0.4 * tV);
	tint *= 0.86 + 0.28 * bH;
	tint *= 0.92 + 0.16 * cH;
	tint *= 0.8 + 0.35 * h;
	float sick = step(0.82, tV * 0.5 + tH * 0.5) * step(0.7, bH);   // больная ветка у больного дерева
	tint = mix(tint, vec3(1.45, 1.05, 0.35), sick * 0.8);
	vLeafTint = tint;
#ifdef CROWN_ATTR
	// ремап глубины: у листьев медиана 0.55, p90 0.8 — тянем, чтобы средний лист
	// был «наружным» (яркость кроны как прежде), а тёмной осталась только сердцевина
	vec3 cn = _crown.xyz; vCrownDepth = clamp(_crown.w / 0.72, 0.0, 1.0);
#else
	vec3 cq = (transformed - gCrownC) / gCrownR;
	vCrownDepth = clamp(length(cq), 0.0, 1.0);
	vec3 cn = cq;
#endif
	vec3 cw = cn;
#ifdef USE_BATCHING
	cw = mat3(batchingMatrix) * cn;
#endif
#ifdef USE_INSTANCING
	cw = mat3(instanceMatrix) * cn;
#endif
	vCrownN = normalize((viewMatrix * vec4(normalize(cw + 1e-5), 0.0)).xyz);
	// Начало осени: у каждого дерева породы своя степень (от половины до полной
	// доли породы), желтеют ветки целиком, первыми — наружные и верхние.
	float autTree = windHash(floor(windRoot * 0.37) + 9.1);
	float amt = gAutAmt * (0.5 + 0.5 * autTree);
	float bAut = windHash(floor(transformed * 0.8) + floor(windRoot) + 2.9);
	float turn = smoothstep(1.0 - amt - 0.06, 1.0 - amt + 0.06, bAut * 0.8 + h * 0.12 + vCrownDepth * 0.08);
	// цвет ветки по палитре породы: у дерева свой уклон (один клён краснее, другой желтее)
	float tb = windHash(floor(windRoot * 0.37) + 4.4);
	float x = clamp(windHash(floor(transformed * 0.8) + floor(windRoot) + 7.7) * 0.7 + tb * 0.5 - 0.1, 0.0, 1.0);
	vec3 ac = x < 0.5 ? mix(gAut0, gAut1, x * 2.0) : mix(gAut1, gAut2, x * 2.0 - 1.0);
	vAut = vec4(ac, turn);
}
#endif
`;

// Фрагмент: растровое растворение по шуму от пиксельной координаты
// (interleaved gradient noise — ровный, без видимой сетки Байера).
const FRAG_HEAD = /* glsl */`
varying float vLodFade;
uniform float uSSS;
#ifdef WIND_TINT
varying vec3 vLeafTint;
varying float vCrownDepth;
varying vec3 vCrownN;
varying vec4 vAut;
#endif
float lodDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
const FRAG_FADE = /* glsl */`
#include <clipping_planes_fragment>
{
	float dth = lodDither(gl_FragCoord.xy);
	if (vLodFade < 1.5) { if (dth >= vLodFade) discard; }        // проявляется
	else if (dth < vLodFade - 2.0) discard;                       // исчезает
}
`;

function inject(material, { leaf, height, attr, tint = false, crown = null, crownAttr = false, autumn = null, barkCd = null, batch = null }) {
	material.onBeforeCompile = (shader) => {
		// Кора (HoudiniCOP): развёрнуты только ствол и толстые ветви; у тонких U = 0 —
		// там fwidth(u) = 0. Где развёрнуто: цвет = текстура × COLOR_0 / cd (средний
		// цвет текстуры = цвет породы в COLOR_0 — стыка нет), рельеф и шероховатость
		// из карт. Где нет — COLOR_0, без карты нормалей (базис по производным вырожден).
		if (barkCd && material.map) {
			shader.uniforms.uBarkCd = { value: barkCd };
			shader.fragmentShader = shader.fragmentShader
				.replace("#include <common>", "#include <common>\nuniform vec3 uBarkCd;")
				.replace("#include <map_fragment>", `
					float bUw = step(1e-5, fwidth(vMapUv.x));
					vec4 bTex = texture2D(map, vMapUv);
					diffuseColor.rgb *= mix(vec3(1.0), bTex.rgb / max(uBarkCd, vec3(0.02)), bUw);`)
				.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
					roughnessFactor = mix(0.92, roughnessFactor, bUw);`)
				.replace("#include <normal_fragment_maps>", `{
					vec3 bN0 = normal;
					#include <normal_fragment_maps>
					normal = bUw > 0.5 ? normal : bN0;
				}`);
		}
		Object.assign(shader.uniforms, windUniforms, { uTreeH: { value: height },
			uAut0: { value: autumn ? autumn.colors[0] : new THREE.Color() },
			uAut1: { value: autumn ? autumn.colors[1] : new THREE.Color() },
			uAut2: { value: autumn ? autumn.colors[2] : new THREE.Color() },
			uAutAmt: { value: autumn ? autumn.amount : 0 },
			uCrownC: { value: crown ? crown.c : new THREE.Vector3(0, height * 0.6, 0) },
			uCrownR: { value: crown ? crown.r : new THREE.Vector3(height * 0.4, height * 0.4, height * 0.4) } });
		if (batch) {
			shader.uniforms.uVegData = { value: batch.data };
			shader.uniforms.uVegFade = { value: batch.fade };
			shader.defines = { ...shader.defines, VEG_BATCH: "" };
		}
		if (tint && crownAttr) shader.defines = { ...shader.defines, CROWN_ATTR: "" };
		if (leaf) shader.defines = { ...shader.defines, WIND_LEAF: "" };
		if (tint) shader.defines = { ...shader.defines, WIND_TINT: "" };
		if (attr) shader.defines = { ...shader.defines, WIND_ATTR: "" };
		if (!windOn) shader.defines = { ...shader.defines, NO_WIND: "" };
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\n" + HEAD)
			.replace("#include <project_vertex>", PROJECT);
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\n" + FRAG_HEAD)
			.replace("#include <clipping_planes_fragment>", FRAG_FADE);
		if (tint) shader.fragmentShader = shader.fragmentShader
			// Цвет листвы из вершин — кислотный жёлто-зелёный почти без синего, одного
			// оттенка у всех пород. Приглушаем насыщенность (живая листва сероватая)
			// и чуть поднимаем синий, затем разнотон дерева, ветки и листа.
			.replace("#include <map_fragment>", `#include <map_fragment>
				{
					vec3 c = diffuseColor.rgb;
					float l = dot(c, vec3(0.3, 0.59, 0.11));
					c = mix(vec3(l), c, 0.62);
					c.b += 0.06 * l;
					// объём кроны: в глубине темнее и холоднее, снаружи светлее и теплее
					// глубина в цвете — только оттенок: снаружи теплее, в глубине холоднее.
					// Затемнение глубиной — в рассеянном свете (ниже), а не в цвете: прямое
					// солнце внутри кроны уже гасит карта теней, двойное гашение даёт муть.
					c *= mix(vec3(0.9, 0.96, 1.0), vec3(1.05, 1.03, 0.94), smoothstep(0.1, 0.75, vCrownDepth));
					diffuseColor.rgb = c * vLeafTint;
					// пожелтевшая ветка: цвет опада породы, тот же объём кроны, свой разброс по листьям
					vec3 aut = vAut.rgb * mix(0.9, 1.05, smoothstep(0.1, 0.75, vCrownDepth)) * (0.85 + 0.3 * fract(vLeafTint.g * 13.7));
					diffuseColor.rgb = mix(diffuseColor.rgb, aut, vAut.a);
				}`)
			// Нормаль листа подгибается к нормали кроны: свет ложится на крону как
			// на объём, а не рябью карточек. Подгибается ГЕОМЕТРИЧЕСКАЯ нормаль, до
			// карты нормалей листа: жилки и выгиб ложатся поверх и не размываются.
			.replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
				normal = normalize(mix(normal, vCrownN, 0.65));`)
			// Просвет (SSS): против солнца наружные листья светятся тёплым жёлто-зелёным;
			// в глубине лист «толще» — просвет гаснет. Первый направленный свет — солнце.
			.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
				// небо в сердцевину кроны не заглядывает: рассеянный свет гаснет с глубиной
				reflectedLight.indirectDiffuse *= mix(0.5, 1.15, smoothstep(0.05, 0.8, vCrownDepth));
				#if NUM_DIR_LIGHTS > 0
				{
					vec3 Ls = directionalLights[0].direction;
					vec3 Vw = normalize(vViewPosition);
					float back = pow(clamp(dot(-Vw, Ls), 0.0, 1.0), 4.0);   // контровой свет — сквозь лист
					float wrap = clamp(dot(-normal, Ls) * 0.5 + 0.5, 0.0, 1.0);
					float thin = smoothstep(0.35, 0.95, vCrownDepth);       // наружный слой кроны
					vec3 trans = diffuseColor.rgb * vec3(1.1, 1.15, 0.5) * directionalLights[0].color;   // свет, прошедший сквозь лист, — жёлто-зелёный
					reflectedLight.directDiffuse += trans * (back * 0.75 + wrap * 0.05) * thin * uSSS;
				}
				#endif`);
	};
	// Иначе three.js переиспользует программу без ветра от похожего материала.
	windMats.push(material);
	material.customProgramCacheKey = () => `wind${windOn ? "" : "-off"}${batch ? "-batch" : ""}-${leaf ? "leaf" : "bark"}-${attr ? "attr" : "est"}${tint ? "-tint" : ""}${crownAttr ? "-crown" : ""}${barkCd && material.map ? "-barktex" : ""}`;
	material.needsUpdate = true;
}

/**
 * Включить ветер на материале дерева и выдать материал для теней с тем же
 * смещением — без него крона качается, а тень стоит.
 */
// batch — { data, fade }: материал BatchedMesh (VEG_BATCH), параметры варианта — из текстур
export function windify(material, { leaf = false, height = 10, attr = false, crown = null, crownAttr = false, autumn = null, barkCd = null, batch = null } = {}) {
	inject(material, { leaf, height, attr, tint: leaf, crown, crownAttr, autumn, barkCd, batch });   // тени коры текстура не нужна   // разнотон, объём и просвет — только цвету, не тени
	const depth = new THREE.MeshDepthMaterial({
		depthPacking: THREE.RGBADepthPacking,
		map: leaf ? material.map : null,
		alphaTest: leaf ? material.alphaTest : 0,
		side: material.side,
	});
	inject(depth, { leaf, height, attr, batch });
	return depth;
}
