import { pavingPads } from "./paving.js";
import * as THREE from "three";
import { rectsOf, streetRect, walkLines } from "./district.js";
import { windUniforms } from "./wind.js";

// Трава в два слоя, по одной карте «где растёт».
//  1) далеко — только цвет в шейдере земли: с 35–45 м травинок не видно,
//     видна фактура; цена — несколько строк в уже работающем материале;
//  2) близко — настоящие травинки в участке вокруг камеры: одна отрисовка,
//     без текстур и без альфы (альфа на телефоне дороже всего — перерисовка),
//     положение каждой травинки считается в шейдере из её номера и хеша.
//     Участок переезжает за камерой, число травинок постоянное.
// Ветер — тот же, что у деревьев (windUniforms): порыв идёт по траве той же волной.

const CELL = 0.5;   // шаг карты, м

/* ── карта: R — густота 0…1, G — высота 0…1 ───────────────────────────── */

export function buildGrassMap(d, piles = [], ground = null) {
	const [x0, z0, x1, z1] = d.interior;
	const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
	const dens = new Float32Array(W * H).fill(1), hgt = new Float32Array(W * H).fill(0.35);
	const idx = (i, j) => j * W + i;
	const cellOf = (x, z) => [Math.floor((x - x0) / CELL), Math.floor((z - z0) / CELL)];
	// штамп по прямоугольнику ячеек с функцией от центра ячейки
	function stamp(r, fn) {
		const [i0, j0] = cellOf(r[0], r[1]), [i1, j1] = cellOf(r[2], r[3]);
		for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
			for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++)
				fn(idx(i, j), x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL);
	}
	const put = (k, v) => { dens[k] = Math.min(dens[k], v); };

	// сквер зарос — трава выше и гуще; остальной двор — газон
	for (const a of d.areas) {
		if (a.kind === "green" && a.poly) {
			const bb = [Math.min(...a.poly.map(p => p[0])), Math.min(...a.poly.map(p => p[1])),
				Math.max(...a.poly.map(p => p[0])), Math.max(...a.poly.map(p => p[1]))];
			stamp(bb, (k, x, z) => { if (inPolyXZ(x, z, a.poly)) hgt[k] = 1.0; });
		}
		if (["parking", "sport", "playground", "bins"].includes(a.kind) && a.rect) stamp(a.rect, k => put(k, 0));
	}
	// дома: внутри нет; у стен, в трещинах отмостки — редкие пучки
	for (const b of d.buildings) for (const r of rectsOf(b)) {
		stamp([r[0] - 1.2, r[1] - 1.2, r[2] + 1.2, r[3] + 1.2], (k, x, z) => {
			const inside = x > r[0] && x < r[2] && z > r[1] && z < r[3];
			put(k, inside ? 0 : 0.35);
		});
	}
	// проезды, тропы, тротуары: на оси пусто, к кромке трава возвращается
	for (const l of walkLines(d)) for (let s = 1; s < l.path.length; s++) {
		const a = l.path[s - 1], b = l.path[s], pad = l.half + 0.8;
		stamp([Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad],
			(k, x, z) => {
				const dd = segDist(x, z, a, b);
				if (dd < l.half) put(k, 0);
				else if (dd < pad) put(k, 0.25 + 0.75 * (dd - l.half) / 0.8);   // сорняк по кромке
			});
	}
	for (const s of d.streets) stamp(streetRect(s), k => put(k, 0));
	// кучи мусора — под ними нет, по краю пробивается
	for (const p of piles) {
		const r = Math.hypot(p.w, p.d) / 2;
		stamp([p.x - r - 0.5, p.z - r - 0.5, p.x + r + 0.5, p.z + r + 0.5], (k, x, z) => {
			const dd = Math.hypot(x - p.x, z - p.z);
			if (dd < r * 0.7) put(k, 0); else if (dd < r + 0.5) put(k, 0.5);
		});
	}

	// слои пола вытесняют траву (утоптано, засыпано крошкой, гравий, песок) — та же сетка
	if (ground && ground.W === W && ground.H === H)
		for (let k = 0; k < W * H; k++) dens[k] *= 1 - ground.grassCut[k];

	// Дорожки — жёсткая маска ПОСЛЕ размытия: иначе размытие и линейная выборка
	// заносят траву на полметра внутрь проезда. С запасом в ячейку по краю.
	const hard = new Uint8Array(W * H);
	for (const l of walkLines(d)) for (let s = 1; s < l.path.length; s++) {
		const a = l.path[s - 1], b = l.path[s], pad = l.half + CELL;
		stamp([Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad],
			(k, x, z) => { if (segDist(x, z, a, b) < pad) hard[k] = 1; });
	}
	// площадки и площади из плитки (paving.js) — без травы
	for (const r of pavingPads(d)) stamp([r[0] - CELL, r[1] - CELL, r[2] + CELL, r[3] + CELL], k => { hard[k] = 1; });

	// в текстуру; лёгкое размытие 3×3 — чтобы кромки не были ступенькой в полметра
	const data = new Uint8Array(W * H * 4);
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		let s = 0, n = 0;
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
			const ii = i + di, jj = j + dj;
			if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
			s += dens[idx(ii, jj)]; n++;
		}
		const k = idx(i, j) * 4;
		data[k] = hard[idx(i, j)] ? 0 : Math.round((s / n) * 255);
		data[k + 1] = Math.round(hgt[idx(i, j)] * 255);
		data[k + 3] = 255;
	}
	const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return { tex, origin: new THREE.Vector2(x0, z0), size: new THREE.Vector2(W * CELL, H * CELL) };
}

function segDist(x, z, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
	return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function inPolyXZ(x, z, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, zi] = poly[i], [xj, zj] = poly[j];
		if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

/* ── общий GLSL: цвет травы и порыв ветра (одинаково на земле и в травинках) ── */

export const GLSL_COMMON = /* glsl */`
uniform sampler2D uGrassMap;
uniform vec2 uGrassOrigin, uGrassSize;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}
vec4 grassAt(vec2 xz) {
	vec2 uv = (xz - uGrassOrigin) / uGrassSize;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
	return texture2D(uGrassMap, uv);
}
// Цвет травы: сочная ↔ выгоревшая пятнами в десяток метров
vec3 grassColor(vec2 xz, float t) {
	float n = gNoise(xz * 0.09) * 0.65 + gNoise(xz * 0.37) * 0.35;
	// Палитра травы в ключе листвы: сочная ↔ сизоватая ↔ выгоревшая, приглушённая —
	// кислотно-зелёная трава читается пластиком.
	vec3 lush = vec3(0.105, 0.185, 0.06), cool = vec3(0.085, 0.16, 0.085), dry = vec3(0.28, 0.265, 0.14);
	float m = gNoise(xz * 0.23 + 7.7);
	vec3 base = mix(mix(lush, cool, smoothstep(0.45, 0.8, m)), dry, smoothstep(0.55, 0.9, n));   // сухие пятна — меньшинство
	return base * (0.7 + 0.6 * t);   // t: 0 у корня (тень в дерне) … 1 на кончике
}
`;

export const grassUniforms = {
	uGrassMap: { value: null },
	uGrassOrigin: { value: new THREE.Vector2() },
	uGrassSize: { value: new THREE.Vector2(1, 1) },
	uGrassCenter: { value: new THREE.Vector2() },
	uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -99, 0)) },
};

/** Убрать траву в прямоугольниках [x0, z0, x1, z1] (вырезы над подвалами): травинки иначе висят в подвале. */
export function clearGrass(rects) {
	const tex = grassUniforms.uGrassMap.value;
	if (!tex || !rects.length) return;
	const { data, width: W, height: H } = tex.image, o = grassUniforms.uGrassOrigin.value, s = grassUniforms.uGrassSize.value;
	for (const [x0, z0, x1, z1] of rects) {
		const i0 = Math.max(0, Math.floor((x0 - o.x) / s.x * W)), i1 = Math.min(W - 1, Math.ceil((x1 - o.x) / s.x * W));
		const j0 = Math.max(0, Math.floor((z0 - o.y) / s.y * H)), j1 = Math.min(H - 1, Math.ceil((z1 - o.y) / s.y * H));
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[(j * W + i) * 4] = 0;
	}
	tex.needsUpdate = true;
}

export function setGrassMap(map) {
	grassUniforms.uGrassMap.value = map.tex;
	grassUniforms.uGrassOrigin.value.copy(map.origin);
	grassUniforms.uGrassSize.value.copy(map.size);
}

/* ── слой 1: трава в цвете земли ──────────────────────────────────────── */

// Слой 1 (трава в цвете земли) — в floor.js, вместе с полом: трава и пол смешиваются одним шейдером.

/* ── слой 2: травинки вокруг камеры ───────────────────────────────────── */

/**
 * grid × grid травинок с шагом spacing, одна отрисовка. Травинка — 5 вершин,
 * 3 треугольника. Положение, высота, наклон, цвет — в вершинном шейдере.
 */
export function buildGrassBlades({ grid = 200, spacing = 0.2, ring = false, nearHalf = null, widthMul = 1 } = {}) {
	const N = grid * grid;
	const shape = [[-1, 0], [1, 0], [-0.7, 0.5], [0.7, 0.5], [0, 1]];   // x — доля ширины, y — доля высоты
	const pos = new Float32Array(N * 5 * 3), id = new Float32Array(N * 5), nor = new Float32Array(N * 5 * 3);
	const index = new Uint32Array(N * 9);
	for (let b = 0; b < N; b++) {
		for (let v = 0; v < 5; v++) {
			const k = b * 5 + v;
			pos[k * 3] = shape[v][0]; pos[k * 3 + 1] = shape[v][1];
			id[k] = b;
			nor[k * 3 + 1] = 1;   // нормаль вверх — трава освещена как дерн, без полос на лопастях
		}
		const o = b * 5, t = b * 9;
		index.set([o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4], t);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
	geo.setAttribute("bladeId", new THREE.BufferAttribute(id, 1));
	geo.setIndex(new THREE.BufferAttribute(index, 1));

	const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, grassUniforms, windUniforms);
		shader.defines = {
			...shader.defines, GRID: grid.toFixed(1), SPACING: spacing.toFixed(4),
			NEAR_HALF: (nearHalf ?? grid * spacing / 2).toFixed(3), WIDTH_MUL: widthMul.toFixed(3),
			...(ring ? { RING: "", RING_HALF: (grid * spacing / 2).toFixed(3) } : {}),
		};
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", `#include <common>
				${GLSL_COMMON}
				uniform vec2 uGrassCenter;
				uniform vec3 uPushers[8];
				uniform float uTime, uWindStrength;
				uniform vec2 uWindDir;
				attribute float bladeId;
				varying vec3 vGrassCol;`)
			.replace("#include <begin_vertex>", `
				// ячейка участка и её мировой номер — чтобы травинки не «плыли» за камерой
				vec2 cell = vec2(mod(bladeId, GRID), floor(bladeId / GRID));
				vec2 base = floor(uGrassCenter / SPACING) - GRID * 0.5;
				vec2 wcell = base + cell;
				float h1 = gHash(wcell), h2 = gHash(wcell + 17.3), h3 = gHash(wcell + 41.7);
				vec2 root = (wcell + vec2(h1, h2)) * SPACING;
				vec4 g = grassAt(root);
				// LOD травы: ближний участок (частые тонкие травинки) и кольцо вокруг
				// (редкие широкие). В полосе 0.7…1.0 полуширины ближнего участка один
				// гаснет, другое проявляется — встречно, сумма густоты ровная, шва нет.
				// За кольцом — только цвет земли (слой 1).
				vec2 rel = root - uGrassCenter;
				float m = max(abs(rel.x), abs(rel.y));
				float edge = 1.0 - smoothstep(0.7 * NEAR_HALF, NEAR_HALF, m);
			#ifdef RING
				edge = smoothstep(0.7 * NEAR_HALF, NEAR_HALF, m) * (1.0 - smoothstep(0.75 * RING_HALF, RING_HALF, m));
			#endif
				// где трава выше — там и гуще: газон реже, заросли — каждая ячейка
				float alive = step(h3, g.r * mix(0.55, 1.0, g.g) * edge);
				// Вид растения по хешу — травинка превращается в мелочь без новых вершин:
				// 0 травинка, 1 подорожник, 2 клевер, 3 головка клевера, 4 одуванчик, 5 белый цветок.
				float hk = gHash(wcell + 73.1);
				float clov = smoothstep(0.58, 0.72, gNoise(root * 0.22 + 11.0));    // клевер пятнами
				float trodden = 1.0 - smoothstep(0.35, 0.85, g.r);                  // кромки троп — подорожник
				float kind = 0.0;
				if (hk < clov * 0.6) kind = (gHash(wcell + 5.9) < 0.1) ? 3.0 : 2.0;
				else if (hk < clov * 0.6 + trodden * 0.35 + 0.025) kind = 1.0;
				else if (hk > 0.978) kind = 4.0;
				else if (hk > 0.965) kind = 5.0;
				bool flower = kind > 2.5;
				// размеры: высота, ширина (у цветка — у стебля и у головки), наклон от вертикали
				float height, width, headW = 0.0, lay;
				// трава ниже там, где её вытесняет клевер и вытаптывают у троп — мелочь видна
				if (kind == 0.0) { height = mix(0.18, 0.75, g.g) * (0.6 + 0.8 * h2) * mix(1.0, 0.35, clov) * (1.0 - 0.5 * trodden); width = 0.035 * (0.7 + 0.6 * h1); lay = 0.0; }
				else if (kind == 1.0) { height = 0.16 * (0.7 + 0.6 * h2); width = 0.065; lay = 1.25; }     // лист почти плашмя
				else if (kind == 2.0) { height = 0.07 * (0.8 + 0.4 * h2); width = 0.045; lay = 1.0; }
				else if (kind == 3.0) { height = 0.12; width = 0.004; headW = 0.03; lay = 0.15; }
				else if (kind == 4.0) { height = 0.22 + 0.1 * h2; width = 0.005; headW = 0.045; lay = 0.1; }
				else { height = 0.32 + 0.15 * h2; width = 0.005; headW = 0.05; lay = 0.1; }
				height *= alive;
				width *= alive; headW *= alive;   // мёртвая травинка — в точку (иначе плоский ромбик цветка висел над землёй за кварталом)
				width *= WIDTH_MUL; headW *= WIDTH_MUL;   // в кольце травинок меньше — они шире
				float ang = h1 * 6.2831;
				vec2 side = vec2(cos(ang), sin(ang)), fwd = vec2(-side.y, side.x);
				// у цветка средняя пара вершин уходит под головку: тонкий стебель, на верху — цвет
				// У цветка из 5 вершин стебель с головкой не собрать — треугольники тянутся
				// от корня клином. Поэтому только головка: ромб на своей высоте, стебель
				// всё равно скрыт травой.
				float t = flower ? 0.82 + position.y * 0.18 : position.y;
				float w = flower ? headW * (position.y > 0.4 && position.y < 0.6 ? 1.0 : 0.35) : width * (1.0 - t);
				vec3 dir = vec3(fwd.x * sin(lay), cos(lay), fwd.y * sin(lay));
				vec3 transformed = vec3(root.x, 0.0, root.y) + vec3(side.x, 0.0, side.y) * position.x * w + dir * t * height;
				// изгиб: ветер тем же порывом, что у деревьев, + своя дрожь
				float along = dot(root, uWindDir);
				float gust = 0.55 + 0.45 * sin(uTime * 0.45 - along * 0.035) * sin(uTime * 0.17 - along * 0.011 + 1.3);
				float bend = t * t * height;
				vec2 lean = uWindDir * (0.35 * gust * uWindStrength + 0.12 * sin(uTime * 2.3 + h3 * 6.2831) * uWindStrength);
				lean += vec2(h2 - 0.5, h1 - 0.5) * 0.3;   // свой наклон у каждой травинки
				// роботы отгибают траву вокруг себя
				for (int i = 0; i < 8; i++) {
					vec2 dp = root - uPushers[i].xz;
					float dd = length(dp);
					lean += (dd < 1.2 && dd > 0.001) ? normalize(dp) * (1.2 - dd) * 1.6 : vec2(0.0);
				}
				lean *= (kind == 1.0 || kind == 2.0) ? 0.3 : 1.0;   // листья плашмя почти не качаются
				transformed.xz += lean * bend;
				transformed.y -= length(lean) * bend * 0.35;   // отогнутая травинка ниже
				transformed.y = max(transformed.y, 0.005);     // лист у земли не уходит под неё
				// Разнобой по травинкам: свой оттенок (желтее ↔ сизее), своя яркость,
				// сухие травинки среди живых (больше в выгоревших пятнах), побуревшие
				// кончики, изредка рыжеватые стебли. Газон вблизи — не одна заливка.
				vec3 col = grassColor(root, t);
				float hv = gHash(wcell + 17.3), hs = gHash(wcell + 31.7), hb = gHash(wcell + 47.9);
				col *= mix(vec3(1.14, 1.05, 0.78), vec3(0.86, 0.98, 1.15), hv) * mix(0.78, 1.22, h3);
				float dryShare = 0.05 + 0.3 * smoothstep(0.55, 0.9, gNoise(root * 0.09) * 0.65 + gNoise(root * 0.37) * 0.35);
				if (hs < dryShare) col = mix(vec3(0.30, 0.26, 0.14), vec3(0.44, 0.39, 0.24), hb) * (0.7 + 0.5 * t);
				else if (hs > 0.96) col *= vec3(1.25, 0.9, 0.7);                                     // рыжеватый стебель
				col = mix(col, vec3(0.30, 0.24, 0.11) * (0.8 + 0.4 * hb), smoothstep(0.72, 1.0, t) * step(0.62, hb) * 0.55);   // бурый кончик
				if (kind == 1.0) col = vec3(0.07, 0.15, 0.035) * (0.8 + 0.5 * t);                 // подорожник — тёмный, плотный
				else if (kind == 2.0) col = vec3(0.06, 0.16, 0.07) * (0.85 + 0.4 * h3);           // клевер — сизо-зелёный
				else if (flower) {
					vec3 head = kind == 3.0 ? vec3(0.75, 0.5, 0.6) : kind == 4.0 ? vec3(0.95, 0.72, 0.06) : vec3(0.88, 0.88, 0.82);
					col = head * (0.85 + 0.3 * position.y);
				}
				vGrassCol = col;
			`)
			.replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);");
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vGrassCol;")
			.replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( vGrassCol, opacity );")
			// Двусторонняя травинка: three.js разворачивает нормаль обратной стороны
			// вниз — и половина травинок чёрная. Нормаль травы — вверх с обеих сторон.
			.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );");
	};
	mat.customProgramCacheKey = () => `grass-blades-${grid}-${spacing}-${ring}-${nearHalf}-${widthMul}`;

	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = "GrassBlades";
	mesh.frustumCulled = false;   // положение травинок считает шейдер
	mesh.receiveShadow = true;
	mesh.castShadow = false;       // тень от травинок дороже всего и почти не видна
	return { mesh, blades: N, extent: grid * spacing };
}

/** Центр участка травы и роботы, которые её отгибают. */
export function updateGrass(center, pushers = []) {
	grassUniforms.uGrassCenter.value.set(center.x, center.z);
	const u = grassUniforms.uPushers.value;
	for (let i = 0; i < 8; i++) {
		const p = pushers[i];
		if (p) u[i].set(p.x, 0, p.z); else u[i].set(0, -99, 1e6);
	}
}
