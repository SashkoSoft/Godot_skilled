import * as THREE from "three";
import { rectsOf, walkLines, entrancePoint } from "./district.js";
import { GLSL_COMMON, grassUniforms } from "./grass.js";

// Пол квартала вне твёрдых покрытий.
//  • Карта весов (шаг 0.5 м) считается ПРАВИЛАМИ от данных квартала:
//    дорожки, двери, лавки, кучи, фасады со степенью разрушения, деревья,
//    заборы, площадки. Раскладка своя у каждого квартала, правила общие —
//    так пол получится и у сгенерированного квартала без ручной разметки.
//  • СЛОИ — тайловые наборы одного формата (albedo+height, normal+ORM),
//    в двух массивах текстур. Смешиваются по высоте: слой с бóльшим
//    (вес + рельеф + рваная кромка шума) ложится сверху.
//  • НАКЛАДКИ — стопки предметов (листья, камешки, травинки, куски): маска с
//    порядком предмета в стопке, порог R > 1 − плотность оставляет верхние
//    предметы целиком. Ими и сшиваются поверхности: на стыке рассыпаны целые
//    камешки, а не размытый градиент. Плотность — из правил (свой канал карты),
//    из карты травы (накладки под газон) или редкая россыпь по шуму.
//    Накладки «сверху» ложатся и на дорожки с асфальтом (hardify) — стык
//    сшивается с обеих сторон.
//  • Почва — всё, что не заняли остальные слои. Трава вытесняется слоями
//    и накладками (ground.grass в JSON) — карта травы берёт это отсюда.

export const CELL = 0.5;
const TEX = "../game/assets/textures/";
const MAX_CH = 8;    // каналов карты весов: слои с правилами, почва-остаток, накладки с правилами
const MAX_LAYERS = 10;   // слоёв в массиве (дёрну канал не нужен — вес от карты травы)
const MAX_OV = 6;    // накладок

/* ── карта весов ─────────────────────────────────────────────────────── */

function segDist(x, z, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
	return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
// расстояние от точки до прямоугольника снаружи (0 внутри)
function rectDist(x, z, r) {
	return Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - z, 0, z - r[3]));
}
// до контура прямоугольника: и снаружи, и изнутри
function edgeDist(x, z, r) {
	if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return Math.min(x - r[0], r[2] - x, z - r[1], r[3] - z);
	return rectDist(x, z, r);
}
const listOf = (s) => (s.split(":")[1] || "").split(",").filter(Boolean);
const doorsOf = (b) => b.entrances ? [].concat(b.entrances) : [];

/**
 * Источники правила: у каждого — габарит для штампа и расстояние до точки.
 * Расстояние меряется от края источника; 0 — на нём или внутри.
 * edge: true — от КРОМКИ в обе стороны (для переходов: пик на самом стыке).
 */
function sources(d, rule, ctx) {
	const near = rule.near, edge = !!rule.edge, out = [];
	const add = (bb, dist) => out.push({ bb, dist });
	if (near === "paths") {
		for (const l of walkLines(d)) for (let s = 1; s < l.path.length; s++) {
			const a = l.path[s - 1], b = l.path[s];
			add([Math.min(a[0], b[0]) - l.half, Math.min(a[1], b[1]) - l.half, Math.max(a[0], b[0]) + l.half, Math.max(a[1], b[1]) + l.half],
				edge ? (x, z) => Math.abs(segDist(x, z, a, b) - l.half) : (x, z) => Math.max(0, segDist(x, z, a, b) - l.half));
		}
	} else if (near === "doors") {
		for (const b of d.buildings) for (const e of doorsOf(b)) {
			const [px, pz] = entrancePoint(b, e).p;
			add([px, pz, px, pz], (x, z) => Math.hypot(x - px, z - pz));
		}
	} else if (near.startsWith("objects:")) {
		const kinds = listOf(near);
		for (const o of d.objects) if (kinds.includes(o.kind)) {
			const [px, pz] = o.at, hs = o.size ? Math.max(...o.size) / 2 : 0.5;
			add([px - hs, pz - hs, px + hs, pz + hs], (x, z) => Math.max(0, Math.hypot(x - px, z - pz) - hs));
		}
	} else if (near.startsWith("areas:")) {
		const kinds = listOf(near);
		for (const a of d.areas) if (kinds.includes(a.kind) && a.rect)
			add(a.rect, edge ? (x, z) => edgeDist(x, z, a.rect) : (x, z) => rectDist(x, z, a.rect));
	} else if (near.startsWith("buildings:")) {
		const kinds = listOf(near);
		for (const b of d.buildings) if (kinds.includes(b.kind)) for (const r of rectsOf(b)) add(r, (x, z) => rectDist(x, z, r));
	} else if (near === "facades") {
		for (const b of d.buildings) {
			const reach = (rule.dist || 0) + (rule.perDamage || 0) * (b.damage || 0);
			for (const r of rectsOf(b)) out.push({ bb: r, dist: (x, z) => rectDist(x, z, r), reach });
		}
	} else if (near === "fences") {
		for (const a of d.areas) if (a.kind === "fenced" && a.rect) add(a.rect, (x, z) => edgeDist(x, z, a.rect));
	} else if (near === "piles") {
		for (const p of ctx.piles) {
			const hs = Math.hypot(p.w, p.d) / 2 * 0.7;
			add([p.x - hs, p.z - hs, p.x + hs, p.z + hs], (x, z) => Math.max(0, Math.hypot(x - p.x, z - p.z) - hs));
		}
	} else if (near === "trees") {
		for (const [tx, tz, tr] of ctx.trees)
			out.push({ bb: [tx, tz, tx, tz], dist: (x, z) => Math.hypot(x - tx, z - tz), reach: rule.dist * tr });
	} else console.warn("ground: неизвестный источник правила", near);
	return out;
}

/**
 * Каналы карты: слои (ground.layers), затем накладки, у которых есть правила.
 * Возвращает { names, layerCount, weights[канал][ячейка], W, H, origin, size, grassCut }.
 */
export function buildGroundMap(d, { piles = [], trees = [] } = {}) {
	const G = d.ground;
	const layers = Object.keys(G.layers).slice(0, MAX_LAYERS);
	// канал нужен слою с правилами и почве-остатку; накладке — если у неё есть правила
	const chLayers = layers.filter(n => G.layers[n].rest || G.rules.some(r => r.layer === n));
	const ruled = (G.overlays || []).map(o => o.id).filter(id => G.rules.some(r => r.overlay === id));
	const names = [...chLayers, ...ruled].slice(0, MAX_CH);
	if (chLayers.length + ruled.length > MAX_CH) console.warn("ground: каналов больше", MAX_CH, "— лишние отброшены");
	const [x0, z0, x1, z1] = d.interior;
	const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
	const weights = names.map(() => new Float32Array(W * H));
	const ctx = { piles, trees };

	for (const rule of G.rules) {
		const li = names.indexOf(rule.layer ?? rule.overlay);
		if (li < 0) { console.warn("ground: нет канала", rule.layer ?? rule.overlay); continue; }
		const wl = weights[li];
		for (const src of sources(d, rule, ctx)) {
			const reach = src.reach ?? rule.dist;
			// штамп по габариту источника плюс досягаемость (+ ячейка, чтобы край не срезался)
			const pad = reach + CELL;
			const i0 = Math.max(0, Math.floor((src.bb[0] - pad - x0) / CELL)), i1 = Math.min(W - 1, Math.floor((src.bb[2] + pad - x0) / CELL));
			const j0 = Math.max(0, Math.floor((src.bb[1] - pad - z0) / CELL)), j1 = Math.min(H - 1, Math.floor((src.bb[3] + pad - z0) / CELL));
			for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
				const e = src.dist(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL);
				// внутри источника — полный вес, дальше спад к нулю на досягаемости
				const w = e <= 0 ? rule.weight : reach > 0 ? rule.weight * Math.pow(Math.max(0, 1 - e / reach), 0.7) : 0;
				const k = j * W + i;
				if (w > wl[k]) wl[k] = w;
			}
		}
	}
	// почва — остаток по слоям (накладки её не занимают)
	const si = names.findIndex(n => G.layers[n]?.rest);
	const grassCut = new Float32Array(W * H);
	for (let k = 0; k < W * H; k++) {
		let top = 0, cut = 0;
		names.forEach((n, li) => {
			if (li !== si && li < chLayers.length) top = Math.max(top, weights[li][k]);
			if (li !== si) cut = Math.max(cut, weights[li][k] * (G.grass?.[n] ?? 0));
		});
		if (si >= 0) weights[si][k] = Math.max(0.15, 1 - top);
		grassCut[k] = cut;
	}
	// «from»: вариант слоя делит канал своего слоя (сухая/сырая утоптанная земля)
	return { names, layers, layerCh: layers.map(n => names.indexOf(G.layers[n].from || n)), weights, W, H,
		origin: new THREE.Vector2(x0, z0), size: new THREE.Vector2(W * CELL, H * CELL), grassCut };
}

/* ── карта кромки: где лежат ленты переходов ─────────────────────────── */

/**
 * Для лент переходов шейдеру нужно: знаковое расстояние до края твёрдого
 * покрытия (минус — на покрытии), направление вдоль края (для U ленты) и тип
 * стыка. Расстояние — до ОБЪЕДИНЕНИЯ всех дорожек (минимум по отрезкам):
 * на перекрёстке край одной дорожки внутри другой краем не считается.
 * Тротуары — только дворовая сторона: со стороны проезжей части бордюр.
 * Тип: 1 — асфальт → земля (тропы, проезды, подходы), 2 — плитка → трава (тротуары).
 */
const ECELL = 0.25, EREACH = 0.8;
export function buildEdgeField(d) {
	const [x0, z0, x1, z1] = d.interior;
	const W = Math.ceil((x1 - x0) / ECELL), H = Math.ceil((z1 - z0) / ECELL);
	const dist = new Float32Array(W * H).fill(9), tan = new Float32Array(W * H * 2), type = new Uint8Array(W * H);
	for (const l of walkLines(d)) {
		const street = l.id.startsWith("walk-") ? d.streets.find(s => "walk-" + s.id === l.id) : null;
		for (let s = 1; s < l.path.length; s++) {
			const a = l.path[s - 1], b = l.path[s];
			let tx = b[0] - a[0], tz = b[1] - a[1];
			const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
			if (tx < -1e-6 || (Math.abs(tx) < 1e-6 && tz < 0)) { tx = -tx; tz = -tz; }   // одна ориентация — U не переворачивается
			const pad = l.half + EREACH;
			const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - pad - x0) / ECELL)), i1 = Math.min(W - 1, Math.floor((Math.max(a[0], b[0]) + pad - x0) / ECELL));
			const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - pad - z0) / ECELL)), j1 = Math.min(H - 1, Math.floor((Math.max(a[1], b[1]) + pad - z0) / ECELL));
			for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
				const x = x0 + (i + 0.5) * ECELL, z = z0 + (j + 0.5) * ECELL;
				if (street) {   // сторона проезжей части — пропустить
					const toRoad = street.axis === "x" ? (street.at - a[1]) * (z - a[1]) : (street.at - a[0]) * (x - a[0]);
					if (toRoad > 0) continue;
				}
				const e = segDist(x, z, a, b) - l.half, k = j * W + i;
				if (e < dist[k]) { dist[k] = e; tan[k * 2] = tx; tan[k * 2 + 1] = tz; type[k] = street ? 2 : 1; }
			}
		}
	}
	const data = new Uint8Array(W * H * 4);
	for (let k = 0; k < W * H; k++) {
		const far = dist[k] > EREACH;
		data[k * 4] = Math.round((Math.max(-1, Math.min(1, dist[k])) * 0.5 + 0.5) * 255);
		data[k * 4 + 1] = Math.round((tan[k * 2] * 0.5 + 0.5) * 255);
		data[k * 4 + 2] = Math.round((tan[k * 2 + 1] * 0.5 + 0.5) * 255);
		data[k * 4 + 3] = far ? 0 : type[k] * 85;
	}
	const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return { tex, origin: new THREE.Vector2(x0, z0), size: new THREE.Vector2(W * ECELL, H * ECELL) };
}

/* ── карта дороги: где колеи, пыль, выкрошено, заплаты, лужи ─────────── */

/**
 * Карта дорог квартала (0.5 м, на весь участок bounds), два слоя в массиве:
 *  0: R колеи (по полосам движения, две на полосу), G пыль у кромки, B выкрошенность,
 *     A заплата (поперечные полосы-траншеи и прямоугольники в полосах);
 *  1: RG направление движения (для маски износа), B середина полосы (масло между
 *     колёсами), A низины (лужи: колеи, лотки у бордюра, осевшие заплаты).
 * Всё — правилами от улиц и проездов, детерминированно.
 */
const RCELL = 0.5;
export function buildRoadMap(d) {
	const [x0, z0, x1, z1] = d.bounds || d.interior;
	const W = Math.ceil((x1 - x0) / RCELL), H = Math.ceil((z1 - z0) / RCELL), N = W * H;
	const L0 = new Float32Array(N * 4), L1 = new Float32Array(N * 4);
	const PID = new Uint8Array(N);   // слой 2: номер пролома в клетке (0 — нет), без фильтрации
	const pits = [];
	const rnd = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
	const g = (x, s) => Math.exp(-(x * x) / (s * s));
	// дорожное полотно: ось a→b, полуширина, полос; пишет в ячейки внутри полотна
	function lane(a, b, half, lanes, kerb) {
		const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
		if (len < 0.5) return;
		const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
		const pad = half + 0.5;
		const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - pad - x0) / RCELL)), i1 = Math.min(W - 1, Math.floor((Math.max(a[0], b[0]) + pad - x0) / RCELL));
		const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - pad - z0) / RCELL)), j1 = Math.min(H - 1, Math.floor((Math.max(a[1], b[1]) + pad - z0) / RCELL));
		const lw = 2 * half / lanes;
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
			const x = x0 + (i + 0.5) * RCELL, z = z0 + (j + 0.5) * RCELL;
			const u = (x - a[0]) * tx + (z - a[1]) * tz, c = (x - a[0]) * nx + (z - a[1]) * nz;
			if (u < -half || u > len + half || Math.abs(c) > half) continue;
			const k = (j * W + i) * 4;
			// полоса и позиция в ней
			const lc = (c + half) / lw, li = Math.min(lanes - 1, Math.floor(lc)), inLane = (lc - li - 0.5) * lw;
			const rut = Math.max(g(inLane - 0.8, 0.3), g(inLane + 0.8, 0.3)) * (0.7 + 0.3 * rnd(Math.floor(u / 30), li));
			const mid = g(inLane, 0.45);
			const edge = half - Math.abs(c);
			const gutter = kerb ? 1 - Math.min(1, edge / 0.9) : 0;
			// выкрошено: у края полотна и пятнами вдоль (участки по 15 м)
			const crumble = Math.max((1 - Math.min(1, edge / 0.8)) * 0.8, 0.25 * rnd(Math.floor(u / 15) + 3, Math.floor(c) + 7));
			// заплаты: поперечная траншея раз в 30–70 м (на всю ширину или одну полосу),
			// прямоугольники 2×3 м в полосах
			const seg = Math.floor(u / 50), su = u - seg * 50, tw = 1.2 + rnd(seg, 11) * 1.2, tpos = 10 + rnd(seg, 5) * 30;
			const trench = rnd(seg, 19) < 0.6 && Math.abs(su - tpos) < tw / 2 && (rnd(seg, 23) < 0.5 || li === Math.floor(rnd(seg, 29) * lanes));
			const rs = Math.floor(u / 9), rc = rnd(rs, li * 13 + 1);
			const rect = rc < 0.12 && Math.abs(u - (rs * 9 + 4.5)) < 1.5 && Math.abs(inLane) < 1.2;
			const patch = trench || rect ? 1 : 0;
			const low = Math.max(rut * 0.8, gutter * 0.9, patch * 0.5);
			if (rut >= L0[k] || edge < 0.9) {
				L0[k] = Math.max(L0[k], rut); L0[k + 1] = Math.max(L0[k + 1], gutter);
				L0[k + 2] = Math.max(L0[k + 2], crumble); L0[k + 3] = Math.max(L0[k + 3], patch);
			}
			// направление — у той полосы, чья ось ближе (на перекрёстках)
			if (L1[k + 3] === 0 || Math.abs(c) < half * 0.9) { L1[k] = tx; L1[k + 1] = tz; }
			L1[k + 2] = Math.max(L1[k + 2], mid); L1[k + 3] = Math.max(L1[k + 3], low, 0.01);
		}
	}
	// Проломы (HoudiniCOP pit-*): в колеях, раз в ~40 м полосы улицы (во дворе — чаще и
	// через 25 м); размер 1–3 м (во дворе 1–2); не пересекаются. Клетки квадрата — номер.
	function pitsAlong(a, b, half, lanes, step, chance, maxSize, salt) {
		const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
		if (len < 4) return;
		const tx = dx / len, tz = dz / len, nx = -tz, nz = tx, lw = 2 * half / lanes;
		for (let li = 0; li < lanes; li++) for (let u = step / 2; u < len - 1; u += step) {
			if (pits.length >= 60 || rnd(u + salt, li * 7 + salt) > chance) continue;
			const size = 1 + Math.floor(rnd(u, li + salt * 3) * maxSize);
			const cOff = -half + lw * (li + 0.5) + (rnd(li, u + 1) < 0.5 ? -0.8 : 0.8);   // в колее
			const cx = a[0] + tx * (u + (rnd(u, 3) - 0.5) * step * 0.6) + nx * cOff, cz = a[1] + tz * (u + (rnd(u, 5) - 0.5) * step * 0.6) + nz * cOff;
			const hs = size / 2, i0 = Math.floor((cx - hs - x0) / RCELL), i1 = Math.floor((cx + hs - x0) / RCELL);
			const j0 = Math.floor((cz - hs - z0) / RCELL), j1 = Math.floor((cz + hs - z0) / RCELL);
			if (i0 < 0 || j0 < 0 || i1 >= W || j1 >= H) continue;
			let free = true;
			for (let j = j0; j <= j1 && free; j++) for (let i = i0; i <= i1; i++) if (PID[j * W + i]) { free = false; break; }
			if (!free) continue;
			const kind = rnd(u, li + 9) < 0.5 ? 0 : 1, v = Math.floor(rnd(u + 2, li) * 4);
			pits.push({ x: cx, z: cz, size, set: `pit-${kind ? "vor" : "web"}-${size}m-v${v}`, layer: (kind * 3 + size - 1) * 4 + v, rot: Math.floor(rnd(u, li + 17) * 4) });
			for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) PID[j * W + i] = pits.length;
		}
	}
	for (const s of d.streets) {
		const a = s.axis === "x" ? [s.from, s.at] : [s.at, s.from], b = s.axis === "x" ? [s.to, s.at] : [s.at, s.to];
		lane(a, b, s.roadHalf, s.lanes || 2, true);
		pitsAlong(a, b, s.roadHalf, s.lanes || 2, 40, 0.35, 3, 1);
	}
	for (const w of d.driveways) for (let k = 1; k < w.path.length; k++) pitsAlong(w.path[k - 1], w.path[k], w.width / 2, 1, 25, 0.5, 2, 7 + k);
	for (const w of d.driveways) for (let k = 1; k < w.path.length; k++) lane(w.path[k - 1], w.path[k], w.width / 2, 1, true);
	for (const ar of d.areas) if (ar.kind === "parking" && ar.rect) {
		const [a0, b0, a1, b1] = ar.rect, cz = (b0 + b1) / 2;
		lane([a0, cz], [a1, cz], (b1 - b0) / 2, Math.max(1, Math.round((b1 - b0) / 5)), false);
	}
	const data = new Uint8Array(N * 4 * 3);
	for (let k = 0; k < N; k++) data[N * 8 + k * 4] = PID[k];
	for (let k = 0; k < N * 4; k++) {
		data[k] = Math.round(Math.min(1, L0[k]) * 255);
		const v = (k % 4) < 2 ? L1[k] * 0.5 + 0.5 : Math.min(1, L1[k]);
		data[N * 4 + k] = Math.round(v * 255);
	}
	const tex = new THREE.DataArrayTexture(data, W, H, 3);
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return { tex, origin: new THREE.Vector2(x0, z0), size: new THREE.Vector2(W * RCELL, H * RCELL), pits };
}

// Декали проломов: массив 48 слоёв (24 маски, затем 24 нормали), 256 px — у маски
// максимум по блоку (тонкая трещина не пропадает). Порядок слоя: (вид×3 + размер−1)×4 + v.
const PIT_SETS = [];
for (const k of ["web", "vor"]) for (const s of [1, 2, 3]) for (let v = 0; v < 4; v++) PIT_SETS.push(`pit-${k}-${s}m-v${v}`);
// bands — пиксели лент (2 слоя) — идут первыми
async function loadPitArray(bands, res = 256) {
	const S = res * res * 4, data = new Uint8Array(S * (PIT_SETS.length * 2 + 2));
	bands.forEach((b, i) => data.set(b, i * S));
	const down = (src, w, keepMax) => {
		const out = new Uint8Array(S), f = w / res;
		for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) for (let c = 0; c < 4; c++) {
			let v = 0;
			for (let y = 0; y < f; y += 2) for (let x = 0; x < f; x += 2) {
				const s = src[((j * f + y) * w + i * f + x) * 4 + c];
				v = keepMax ? Math.max(v, s) : v + s;
			}
			out[(j * res + i) * 4 + c] = keepMax ? v : v / Math.ceil(f / 2) ** 2;
		}
		return out;
	};
	await Promise.all(PIT_SETS.map(async (s, i) => {
		const sz = +s.match(/-(\d)m-/)[1], tag = sz === 1 ? "1k" : "2k", base = `${TEX}${s}/${s.replace(/-/g, "_")}_`;
		const [m, n] = await Promise.all([loadImage(base + `mask_${tag}.png`), loadImage(base + `normal_${tag}.png`)]);
		data.set(down(rawPixels(m, m.width), m.width, true), (2 + i) * S);
		data.set(down(rawPixels(n, n.width), n.width, false), (2 + PIT_SETS.length + i) * S);
	}));
	const t = arrayTex(data, res, PIT_SETS.length * 2 + 2, false);
	t.wrapT = THREE.ClampToEdgeWrapping;   // ленты тайлятся по U, поперёк — нет; декали сами в пределах 0..1
	return t;
}

/** Веса в две RGBA-текстуры (каналы 0–3, 4–7), с размытием 3×3 — без ступенек по ячейке. */
function weightTextures(map) {
	const { W, H, weights } = map;
	const texs = [];
	for (let t = 0; t < 2; t++) {
		const data = new Uint8Array(W * H * 4);
		for (let c = 0; c < 4; c++) {
			const wl = weights[t * 4 + c];
			if (!wl) continue;
			for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
				let s = 0, n = 0;
				for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
					const ii = i + di, jj = j + dj;
					if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
					s += wl[jj * W + ii]; n++;
				}
				data[(j * W + i) * 4 + c] = Math.round(s / n * 255);
			}
		}
		const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
		tex.magFilter = tex.minFilter = THREE.LinearFilter;
		tex.needsUpdate = true;
		texs.push(tex);
	}
	return texs;
}

/* ── чтение картинок ─────────────────────────────────────────────────── */

function loadImage(url) {
	return new Promise((ok, fail) => {
		const img = new Image();
		img.onload = () => ok(img);
		img.onerror = () => fail(new Error("не загрузилось: " + url));
		img.src = url;
	});
}
function parseTile(txt) {
	const num = (key, def) => { const m = txt.match(new RegExp(key + "[ =]+([\\d.]+)")); return m ? parseFloat(m[1]) : def; };
	const st = txt.match(/status=([^\r\n]+)/);
	const sp = txt.match(/species=([^\r\n]+)/);
	return { tile: num("tile_m", 2), heightCm: num("height_cm", 1.5), status: st ? st[1] : "",
		species: sp ? sp[1].split(",").map(s => s.trim()).filter(Boolean) : null };
}
async function loadSet(name, kinds, suffix = "1k") {
	const base = TEX + name + "/", file = name.replace(/-/g, "_");
	const r = await fetch(base + "tile.txt");
	if (!r.ok) return null;
	const meta = parseTile(await r.text());
	const imgs = await Promise.all(kinds.map(k => loadImage(`${base}${file}_${k}_${suffix}.png`)));
	return { meta, ...Object.fromEntries(kinds.map((k, i) => [k, imgs[i]])) };
}

// Сырые байты картинки через WebGL: без премультипликации альфы и без цветовых
// преобразований. Canvas 2D хранит цвет умноженным на альфу — у маски, где альфа
// это высота предмета, он портил бы порядок в стопке (R) по краям предметов.
// Строки снизу вверх (как flipY у обычной текстуры) — иначе зелёный канал
// нормали смотрит не туда.
let rawGL = null;
function rawPixels(img, res) {
	if (!rawGL) rawGL = document.createElement("canvas").getContext("webgl2");
	const gl = rawGL, w = img.width, h = img.height;
	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
	const fb = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
	const src = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, src);
	gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
	if (w === res && h === res) return src;
	// в квадрат res×res: по оси, где картинка больше, — среднее блока, где меньше
	// (лента 1024×256) — ближайший пиксель; блок всегда хотя бы из одного пикселя
	const out = new Uint8Array(res * res * 4), fx = w / res, fy = h / res;
	for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) for (let c = 0; c < 4; c++) {
		const y0 = Math.floor(j * fy), y1 = Math.max(y0 + 1, Math.floor((j + 1) * fy));
		const x0 = Math.floor(i * fx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * fx));
		let s = 0, n = 0;
		for (let y = y0; y < Math.min(y1, h); y++) for (let x = x0; x < Math.min(x1, w); x++) { s += src[(y * w + x) * 4 + c]; n++; }
		out[(j * res + i) * 4 + c] = n ? s / n : 0;
	}
	return out;
}

function arrayTex(data, res, n, srgb) {
	const t = new THREE.DataArrayTexture(data, res, res, n);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
	t.generateMipmaps = true;
	t.anisotropy = 4;
	// sRGB только у альбедо; данные в альфе от этого не страдают — sRGB альфу не трогает
	t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;
}

/**
 * Слои: A = albedo.rgb + height, B = normal.xy + roughness + AO.
 * Слой без набора — заглушка из почвы (оттенок, насыщенность, высота из stand_in).
 */
async function buildLayerArrays(d, names, res) {
	const L = d.ground.layers;
	const kinds = ["albedo", "normal", "orm", "height"];
	const packs = await Promise.all(names.map(n => loadSet(L[n].pack, kinds).catch(e => { console.warn("ground:", e.message); return null; })));
	const rest = names.find(n => L[n].rest) || names[0];
	const soil = packs[names.indexOf(rest)];
	if (!soil) throw new Error("ground: нет набора почвы " + L[rest]?.pack);
	const N = names.length, S = res * res * 4;
	const A = new Uint8Array(S * N), B = new Uint8Array(S * N);
	const tile = [], hScale = [];
	const px = (p) => ({ alb: rawPixels(p.albedo, res), nrm: rawPixels(p.normal, res), orm: rawPixels(p.orm, res), hgt: rawPixels(p.height, res) });
	const soilPx = px(soil);
	names.forEach((n, li) => {
		const p = packs[li], st = L[n].stand_in;
		let P = soilPx, tint = [1, 1, 1], sat = 1, hk = 1, meta = soil.meta;
		if (p) {
			P = p === soil ? soilPx : px(p); meta = p.meta;
			if (/chernovik|черновик/i.test(meta.status)) console.warn(`ground: ${n} — ЧЕРНОВИК поставщика (${meta.status})`);
		} else {
			console.warn(`ground: ${n} — ЗАГЛУШКА из почвы (ждём ${L[n].pack})`);
			if (st) { tint = st.tint || tint; sat = st.sat ?? 1; hk = st.height ?? 1; }
		}
		tile.push(meta.tile);
		hScale.push(meta.heightCm * hk);
		const o = li * S;
		for (let k = 0; k < S; k += 4) {
			let r = P.alb[k], g = P.alb[k + 1], b = P.alb[k + 2];
			if (!p) {
				const y = 0.3 * r + 0.59 * g + 0.11 * b;
				r = Math.min(255, (y + (r - y) * sat) * tint[0]);
				g = Math.min(255, (y + (g - y) * sat) * tint[1]);
				b = Math.min(255, (y + (b - y) * sat) * tint[2]);
			}
			A[o + k] = r; A[o + k + 1] = g; A[o + k + 2] = b; A[o + k + 3] = P.hgt[k];
			B[o + k] = P.nrm[k]; B[o + k + 1] = P.nrm[k + 1]; B[o + k + 2] = P.orm[k + 1]; B[o + k + 3] = P.orm[k];
		}
	});
	return { A: arrayTex(A, res, N, true), B: arrayTex(B, res, N, false), tile, hScale, stand: names.filter((n, i) => !packs[i]) };
}

/**
 * Накладки: OA = albedo.rgb (светотень B маски запечена) + номер предмета (G маски),
 * OB = normal.xy + порядок (R) + высота (A). Номер нужен опаду нескольких пород:
 * в нём порода листа.
 * Накладка без набора пропускается (её не на чем показать) — в консоли помечено.
 */
async function buildOverlayArrays(list, res) {
	const kinds = ["albedo", "normal", "mask"];
	const sets = await Promise.all(list.map(o => loadSet(o.pack, kinds).catch(e => { console.warn("ground:", e.message); return null; })));
	const ready = list.map((o, i) => ({ o, s: sets[i] })).filter(x => {
		if (!x.s) console.warn(`ground: накладка ${x.o.id} — ждём ${x.o.pack}`);
		return x.s;
	});
	if (!ready.length) return { ready: [] };
	const N = ready.length, S = res * res * 4;
	const OA = new Uint8Array(S * N), OB = new Uint8Array(S * N);
	ready.forEach(({ s }, li) => {
		const alb = rawPixels(s.albedo, res), nrm = rawPixels(s.normal, res), msk = rawPixels(s.mask, res), o = li * S;
		for (let k = 0; k < S; k += 4) {
			const sh = 0.5 + msk[k + 2] / 255;   // светотень: 0.5 — нейтраль
			OA[o + k] = Math.min(255, alb[k] * sh); OA[o + k + 1] = Math.min(255, alb[k + 1] * sh); OA[o + k + 2] = Math.min(255, alb[k + 2] * sh);
			OA[o + k + 3] = msk[k + 1];
			OB[o + k] = nrm[k]; OB[o + k + 1] = nrm[k + 1]; OB[o + k + 2] = msk[k]; OB[o + k + 3] = msk[k + 3];
		}
	});
	return { ready, OA: arrayTex(OA, res, N, true), OB: arrayTex(OB, res, N, false) };
}

/* ── шейдер ──────────────────────────────────────────────────────────── */

export const groundUniforms = {
	uGW0: { value: null }, uGW1: { value: null },
	uGOrigin: { value: new THREE.Vector2() }, uGSize: { value: new THREE.Vector2(1, 1) },
	uGA: { value: null }, uGB: { value: null },
	uGTile: { value: new Array(MAX_LAYERS).fill(2) },
	uGH: { value: new Array(MAX_LAYERS).fill(1.5) },
	uGCh: { value: new Array(MAX_LAYERS).fill(-1) },      // канал карты весов слоя; -1 — нет
	uGGrass: { value: new Array(MAX_LAYERS).fill(0) },    // доля веса от карты травы (дёрн)
	uGSel: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4(-1, 0, 1, 0)) },
	uGRest: { value: -1 },                                // слой-остаток (почва)
	uGHex: { value: new Array(MAX_LAYERS).fill(0) },      // 1 — шестиугольное расслоение тайла (однородные покрытия)
	// Шумы одним массивом (лимит 16 текстур на шейдер — D3D): 0 blend-noise (32 м),
	// 1 гранж (R грязь, G сырость, B мох по швам, A трещины; 8 м), 2 клеточный
	// (R пятна, G номер ячейки, B границы, A ridged; 32 м), 3 детальная нормаль (1 м).
	uNoise: { value: null },
	// ленты переходов
	uEdge: { value: null }, uEOrigin: { value: new THREE.Vector2() }, uESize: { value: new THREE.Vector2(1, 1) },

	// асфальт (HoudiniCOP): массивы как у слоёв — A albedo+height, B normal.xy+roughness+AO;
	// слои 0 старый, 1 выкрошенный, 2 в заплатах
	uAA: { value: null }, uAB: { value: null }, uATile: { value: 4 }, uAOn: { value: 0 },
	uRoad: { value: null }, uROrigin: { value: new THREE.Vector2() }, uRSize: { value: new THREE.Vector2(1, 1) },
	uPitTex: { value: null }, uPitOn: { value: 0 },
	uPits: { value: Array.from({ length: 64 }, () => new THREE.Vector4()) },   // (x, z, размер, слой + поворот·64)
	uHardCol: { value: new THREE.Color(0.3, 0.3, 0.3) },   // цвет асфальта дорожек — для отколотых кусков на земле
	uEdgeFloor: { value: 0 },                              // слой пола, что проступает в выбоинах и по шву
	uOvEdge: { value: -1 },                                // накладка, которой лента задаёт плотность крошки
	uOvSpecies: { value: -1 }, uSpN: { value: 1 }, uSpMap: { value: null },   // опад по породам деревьев
	uGN: { value: 0 },
	uGDebug: { value: 0 },
	// накладки
	uOA: { value: null }, uOB: { value: null },
	uOvN: { value: 0 },
	uOvCh: { value: new Array(MAX_OV).fill(-1) },      // канал карты весов; -1 — нет правил
	uOvUnder: { value: new Array(MAX_OV).fill(0) },    // 1 — под газоном, 0 — поверх всего
	uOvTile: { value: new Array(MAX_OV).fill(2) },
	uOvAmb: { value: new Array(MAX_OV).fill(0) },      // редкая россыпь пятнами шума
	uOvGrass: { value: new Array(MAX_OV).fill(0) },    // доля плотности от карты травы
	uOvSel: { value: Array.from({ length: MAX_OV }, () => new THREE.Vector4(-1, 0, 1, 0)) },   // канал шума, от, до
};

const NOISE_TILE = 32.0;

const GLSL_GROUND = /* glsl */`
uniform sampler2D uGW0, uGW1;
// uPitTex: слои 0–1 — ленты стыков (асфальт→земля, плитка→трава), дальше декали
// проломов (маски, затем нормали). Один сэмплер на всё — лимит 16 текстур под D3D.
uniform highp sampler2DArray uNoise, uAA, uAB, uRoad, uPitTex;
uniform vec4 uPits[64];
uniform float uPitOn;
uniform vec2 uROrigin, uRSize;
vec4 gRoad(vec2 xz, float layer) { return textureLod(uRoad, vec3((xz - uROrigin) / uRSize, layer), 0.0); }
uniform float uATile, uAOn, uAMode;
vec4 gNoise4(vec2 uv, float layer) { return texture(uNoise, vec3(uv, layer)); }
// Шум смешивания (32 м) на весь уровень повторялся сеткой — сверху видно сразу.
// Две копии: вторая повёрнута и с несоизмеримым шагом (45.7 м); какая действует —
// выбирает процедурный шум без повтора (~80 м). Переход между ними узкий: почти
// везде значение одной копии, контраст порогов не падает.
const mat2 BN_R = mat2(0.6, 0.8, -0.8, 0.6);
vec4 gBlendN(vec2 xz) {
	vec4 a = gNoise4(xz / 32.0, 0.0), b = gNoise4(BN_R * xz / 45.7 + vec2(0.19, 0.53), 0.0);
	float s = smoothstep(0.42, 0.58, gNoise(xz * 0.0125 + 5.3) * 0.7 + gNoise(xz * 0.031 + 1.7) * 0.3);
	return mix(a, b, s);
}
uniform vec2 uGOrigin, uGSize;
uniform highp sampler2DArray uGA, uGB, uOA, uOB;
uniform float uGTile[${MAX_LAYERS}], uGH[${MAX_LAYERS}], uGGrass[${MAX_LAYERS}];
uniform int uGCh[${MAX_LAYERS}], uGRest, uGHex[${MAX_LAYERS}];
uniform vec4 uGSel[${MAX_LAYERS}];
// Канал вектора по переменному номеру — скалярным произведением с маской:
// v[i] под D3D эмулируется ветвлениями и раздувает шейдер (предупреждения, а в
// циклах по слоям — и отказ сборки).
float gComp(vec4 v, int i) { return dot(v, vec4(equal(ivec4(i), ivec4(0, 1, 2, 3)))); }
// Производные мировых xz — один раз, ДО циклов. Под D3D выборка с автоматическими
// производными (texture, dFdx) внутри цикла с continue/break не собирается (X4014):
// в циклах — только textureGrad по этим производным или textureLod.
vec2 gDX, gDY;
void gDeriv(vec2 xz) { gDX = dFdx(xz); gDY = dFdy(xz); }
uniform sampler2D uEdge;
uniform vec2 uEOrigin, uESize;
uniform vec3 uHardCol;
uniform int uEdgeFloor, uOvEdge;
// кромка: d — знаковое расстояние до края покрытия (минус — на покрытии), t — вдоль края
struct GEdge { float d; vec2 t; int type; };
GEdge gEdge(vec2 xz) {
	vec2 euv = (xz - uEOrigin) / uESize;
	vec4 e = textureLod(uEdge, euv, 0.0);
	GEdge r;
	if (any(lessThan(euv, vec2(0.0))) || any(greaterThan(euv, vec2(1.0)))) { r.d = 9.0; r.t = vec2(1.0, 0.0); r.type = 0; return r; } r.d = (e.r - 0.5) * 2.0; r.t = normalize(e.gb * 2.0 - 1.0 + 1e-4); r.type = int(e.a * 3.0 + 0.5);
	return r;
}
// лента: U вдоль края (4 м), V поперёк (1 м): 0 — сторона покрытия, 1 — земля/трава
vec4 gBand(GEdge e, vec2 xz) {
	vec2 uv = vec2(dot(xz, e.t) / 4.0, clamp(0.5 + e.d, 0.0, 1.0));
	return textureGrad(uPitTex, vec3(uv, e.type == 1 ? 0.0 : 1.0), gDX / 4.0, gDY / 4.0);
}
uniform int uGN, uGDebug, uOvN, uOvSpecies, uSpN;
uniform sampler2D uSpMap;
// Гранж, тайл 8 м: на широком асфальте (перекрёсток) одни и те же пятна шли
// сеткой. Пятна грязи и сырости — из двух отсчётов с несоизмеримыми шагами
// (8 м и повёрнутый 11.3 м): одинаковый рисунок повторится через сотни метров.
// Швы мха и трещины — из одного: их и так дают только пятнами.
const float GR_A = 0.83;
const mat2 GR_R = mat2(cos(GR_A), sin(GR_A), -sin(GR_A), cos(GR_A));
vec4 gGrunge(vec2 xz) {
	vec4 a = gNoise4(xz / 8.0, 1.0);
	vec4 b = gNoise4(GR_R * xz / 11.3 + vec2(0.31, 0.67), 1.0);
	return vec4(min(sqrt(a.r * b.r) * 1.3, 1.0), min(sqrt(a.g * b.g) * 1.3, 1.0), a.b, a.a);
}
// Клеточный шум — узор чёткий (многоугольники, прямые рёбра): выборка искажена
// другим шумом, чтобы рёбра не были прямыми; порогом по нему одному не резать.
vec4 gCell(vec2 xz) {
	vec2 warp = (gBlendN(xz).rg - 0.5) * 0.025;   // мягкая версия уже искажена внутри — поверх слабее
	return gNoise4(xz / 32.0 + warp, 2.0);
}
// детальная нормаль: вблизи (до ~15 м), иначе только муар
vec2 gDetail(vec2 xz) {
	float k = 1.0 - smoothstep(4.0, 15.0, length(cameraPosition.xz - xz));
	return (gNoise4(xz, 3.0).xy * 2.0 - 1.0) * k;   // без ветвления: выборка в ветке под D3D — та же беда с производными
}
uniform int uOvCh[${MAX_OV}], uOvUnder[${MAX_OV}];
uniform float uOvTile[${MAX_OV}], uOvAmb[${MAX_OV}], uOvGrass[${MAX_OV}];
uniform vec4 uOvSel[${MAX_OV}];
// Отладочные цвета слоёв. Без конструктора массива vec3[10](…): мобильные
// компиляторы GLSL ES (телефон) требуют у него явную точность и не собирают шейдер.
vec3 gDebugCol(int i) {
	if (i == 0) return vec3(0.35, 0.22, 0.1);  if (i == 1) return vec3(0.85, 0.75, 0.5);
	if (i == 2) return vec3(0.8, 0.2, 0.15);   if (i == 3) return vec3(0.55, 0.55, 0.6);
	if (i == 4) return vec3(1.0, 0.9, 0.45);   if (i == 5) return vec3(0.2, 0.7, 0.2);
	if (i == 6) return vec3(0.8, 0.7, 0.3);    if (i == 7) return vec3(0.1, 0.4, 0.25);
	if (i == 8) return vec3(0.2, 0.6, 0.9);    return vec3(0.8, 0.3, 0.8);
}
// выбор по шуму: варианты делят площадь пятнами (канал, от, до);
// каналы 0–3 — blend-noise, 4–7 — гранж, 8–11 — клеточный
float gSelect(vec4 sel, vec4 nz, vec4 gz, vec4 cz) {
	if (sel.x < 0.0) return 1.0;
	int c = int(sel.x);
	float s = c < 4 ? gComp(nz, c) : c < 8 ? gComp(gz, c - 4) : gComp(cz, c - 8) + 0.35 * (nz.r - 0.5) + 0.15 * gz.r;   // клеточный — только в смеси с шумом
	return smoothstep(sel.y - 0.05, sel.y + 0.05, s) * (1.0 - smoothstep(sel.z - 0.05, sel.z + 0.05, s));
}
// leaf/lalb/lnxz — накладки «сверху» (лежат и на газоне); under — доля накладок под газоном
struct GroundS { vec3 alb; float h; vec2 nxz; float rough; float ao; float under; float leaf; vec3 lalb; vec2 lnxz; };

float gWeight(vec2 xz, int ch) {
	vec2 uv = (xz - uGOrigin) / uGSize;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;   // за картой правил нет
	return ch < 4 ? gComp(textureLod(uGW0, uv, 0.0), ch) : gComp(textureLod(uGW1, uv, 0.0), ch - 4);
}

// Шестиугольное расслоение тайла (hex tiling, Heitz–Neyret / Mikkelsen):
// плоскость режется на треугольную сетку, в каждой вершине тайл лежит со своим
// поворотом и сдвигом, три соседних отсчёта смешиваются барицентрически с
// усилением по высоте — повтор исчезает, шва нет. Для однородных покрытий
// (песок, утоптанная земля), где второй отсчёт пятнами не спасает.
vec2 gHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// один отсчёт шестиугольника: тайл повёрнут и сдвинут по хешу вершины сетки
void gHexTap(int li, vec2 uv, vec2 dx, vec2 dy, vec2 vtx, out vec4 a, out vec4 b) {
	vec2 h = gHash2(vtx);
	float ang = h.x * 6.2831853, c = cos(ang), s = sin(ang);
	mat2 R = mat2(c, s, -s, c);
	vec2 u = R * uv + h * 7.31;
	a = textureGrad(uGA, vec3(u, float(li)), R * dx, R * dy);
	b = textureGrad(uGB, vec3(u, float(li)), R * dx, R * dy);
	b.xy = transpose(R) * (b.xy * 2.0 - 1.0);   // нормаль повёрнутого отсчёта — обратно в мир
}
void gHexSample(int li, vec2 uv, out vec4 a, out vec4 b) {
	vec2 st = uv * 1.2;   // ячейка ~ тайл
	vec2 sk = vec2(st.x, -0.57735027 * st.x + 1.15470054 * st.y) * 1.7320508;
	vec2 base = floor(sk); vec2 f = fract(sk); float z = 1.0 - f.x - f.y;
	vec3 w; vec2 v1, v2, v3;
	if (z > 0.0) { w = vec3(z, f.y, f.x); v1 = base; v2 = base + vec2(0.0, 1.0); v3 = base + vec2(1.0, 0.0); }
	else { w = vec3(-z, 1.0 - f.y, 1.0 - f.x); v1 = base + vec2(1.0, 1.0); v2 = base + vec2(1.0, 0.0); v3 = base + vec2(0.0, 1.0); }
	vec2 dx = gDX / uGTile[li], dy = gDY / uGTile[li];
	vec4 a1, b1, a2, b2, a3, b3;
	gHexTap(li, uv, dx, dy, v1, a1, b1);
	gHexTap(li, uv, dx, dy, v2, a2, b2);
	gHexTap(li, uv, dx, dy, v3, a3, b3);
	// усиление по высоте: на стыке сверху то, что выше, — стык рвётся по рельефу
	vec3 k = vec3(pow(w.x, 3.0) * pow(0.25 + a1.a, 4.0), pow(w.y, 3.0) * pow(0.25 + a2.a, 4.0), pow(w.z, 3.0) * pow(0.25 + a3.a, 4.0));
	k /= max(k.x + k.y + k.z, 1e-5);
	a = a1 * k.x + a2 * k.y + a3 * k.z;
	b = b1 * k.x + b2 * k.y + b3 * k.z;
}

// Асфальт: шестиугольное расслоение, как у слоёв; quant — повороты только кратно 90°
// (у заплат прямоугольники, наискось они выглядели бы нелепо).
void gAsphTap(float li, vec2 uv, vec2 dx, vec2 dy, vec2 vtx, bool quant, out vec4 a, out vec4 b) {
	vec2 h = gHash2(vtx + li * 17.0);
	float ang = quant ? floor(h.x * 4.0) * 1.5707963 : h.x * 6.2831853, c = cos(ang), s = sin(ang);
	mat2 R = mat2(c, s, -s, c);
	vec2 u = R * uv + h * 7.31;
	a = textureGrad(uAA, vec3(u, li), R * dx, R * dy);
	b = textureGrad(uAB, vec3(u, li), R * dx, R * dy);
	b.xy = transpose(R) * (b.xy * 2.0 - 1.0);
}
void gAsphHex(float li, vec2 xz, out vec4 a, out vec4 b) {
	float tl = li > 2.5 ? uATile * 0.5 : uATile;   // тротуарный асфальт — тайл 2 м
	vec2 uv = xz / tl, dx = gDX / tl, dy = gDY / tl;
	vec2 sk = vec2(uv.x * 1.2, -0.57735027 * uv.x * 1.2 + 1.15470054 * uv.y * 1.2) * 1.7320508;
	vec2 base = floor(sk); vec2 f = fract(sk); float z = 1.0 - f.x - f.y;
	vec3 w; vec2 v1, v2, v3;
	if (z > 0.0) { w = vec3(z, f.y, f.x); v1 = base; v2 = base + vec2(0.0, 1.0); v3 = base + vec2(1.0, 0.0); }
	else { w = vec3(-z, 1.0 - f.y, 1.0 - f.x); v1 = base + vec2(1.0, 1.0); v2 = base + vec2(1.0, 0.0); v3 = base + vec2(0.0, 1.0); }
	bool q = li > 1.5;
	vec4 a1, b1, a2, b2, a3, b3;
	gAsphTap(li, uv, dx, dy, v1, q, a1, b1);
	gAsphTap(li, uv, dx, dy, v2, q, a2, b2);
	gAsphTap(li, uv, dx, dy, v3, q, a3, b3);
	vec3 k = vec3(pow(w.x, 3.0) * pow(0.25 + a1.a, 4.0), pow(w.y, 3.0) * pow(0.25 + a2.a, 4.0), pow(w.z, 3.0) * pow(0.25 + a3.a, 4.0));
	k /= max(k.x + k.y + k.z, 1e-5);
	a = a1 * k.x + a2 * k.y + a3 * k.z;
	b = b1 * k.x + b2 * k.y + b3 * k.z;
}

// Отсчёт слоя: вблизи два (второй повёрнут на 90° и сдвинут), смешаны по островкам
// шума — повтор тайла не читается сеткой. Нормаль второго поворачивается обратно.
void gSample(int li, vec2 xz, float mixW, bool two, out vec4 a, out vec4 b) {
	vec2 uv = xz / uGTile[li];
	if (two && uGHex[li] == 1) { gHexSample(li, uv, a, b); return; }
	vec2 du = gDX / uGTile[li], dv = gDY / uGTile[li];
	a = textureGrad(uGA, vec3(uv, float(li)), du, dv);
	b = textureGrad(uGB, vec3(uv, float(li)), du, dv);
	b.xy = b.xy * 2.0 - 1.0;
	if (two && mixW > 0.01) {
		vec2 uv2 = vec2(-uv.y, uv.x) + 0.37;
		vec2 du2 = vec2(-du.y, du.x), dv2 = vec2(-dv.y, dv.x);
		vec4 a2 = textureGrad(uGA, vec3(uv2, float(li)), du2, dv2);
		vec4 b2 = textureGrad(uGB, vec3(uv2, float(li)), du2, dv2);
		b2.xy = b2.xy * 2.0 - 1.0;
		b2.xy = vec2(b2.y, -b2.x);
		a = mix(a, a2, mixW); b = mix(b, b2, mixW);
	}
}

// Накладки стопкой. Каждая — два отсчёта под разными углами (тайл бесшовный —
// поворот на любой угол тоже бесшовный) и со сдвигом; в точке остаётся предмет,
// что выше в своей стопке (R). Предметы целые, повтор сбит, лежат под разными
// углами. Порог каждой стопки — по половине плотности: две стопки разом закрывают
// больше одной (по замерам поставщика это держит то же покрытие).
// Производные считаются до ветвлений и свои у каждого отсчёта: выбор uv по
// пикселю рвал бы мипы по краю предмета. Более поздняя накладка лежит выше.
const float OV_A = 2.17;
const mat2 OV_R = mat2(cos(OV_A), sin(OV_A), -sin(OV_A), cos(OV_A));
void overlays(vec2 xz, float grassD, vec4 nz, vec4 gz, vec4 cz, bool hard, inout GroundS g) {
	for (int i = 0; i < ${MAX_OV}; i++) {
		if (i >= uOvN) break;
		vec2 ou1 = xz / uOvTile[i];
		vec2 ou2 = OV_R * ou1 + vec2(0.37 + 0.11 * float(i), 0.61);
		vec2 dx1 = gDX / uOvTile[i], dy1 = gDY / uOvTile[i], dx2 = OV_R * dx1, dy2 = OV_R * dy1;
		bool under = uOvUnder[i] == 1;
		if (hard && under) continue;   // под газоном — только на земле
		float dens = uOvAmb[i] * smoothstep(0.35, 0.75, nz.r) + uOvGrass[i] * grassD;
		if (uOvCh[i] >= 0) dens += gWeight(xz, uOvCh[i]);
		if (i == uOvEdge) {   // крошка у стыка асфальта с землёй — из ленты, в обе стороны
			GEdge e = gEdge(xz);
			if (e.type == 1 && abs(e.d) < 0.5) dens += gBand(e, xz).b * 0.9;
		}
		dens *= gSelect(uOvSel[i], nz, gz, cz);
		// опад по породам: под кроной чужие листья отсеиваются — стопку гуще, чтобы
		// ковёр не редел (мелкий берёзовый лист — лишь ~1/5 площади стопки)
		vec4 spW = vec4(0.0); float spTot = 0.0;
		if (i == uOvSpecies) {
			spW = textureLod(uSpMap, (xz - uGOrigin) / uGSize, 0.0);
			spTot = spW.r + spW.g + spW.b + spW.a;
			dens *= 1.0 + 0.8 * smoothstep(0.02, 0.3, spTot);
		}
		dens = clamp(dens, 0.0, 1.0);
		if (dens < 0.01) continue;
		float fi = float(i);
		vec4 m1 = textureGrad(uOB, vec3(ou1, fi), dx1, dy1), m2 = textureGrad(uOB, vec3(ou2, fi), dx2, dy2);
		bool second = m2.b > m1.b;
		vec4 m = second ? m2 : m1;
		float t = 1.0 - dens * 0.5;
		float hit = smoothstep(t - 0.02, t + 0.02, m.b) * step(0.004, m.b);
		if (hit <= 0.0) continue;
		vec4 a = second ? textureGrad(uOA, vec3(ou2, fi), dx2, dy2) : textureGrad(uOA, vec3(ou1, fi), dx1, dy1);
		vec2 n = m.xy * 2.0 - 1.0;
		if (second) n = transpose(OV_R) * n;   // нормаль повёрнутого отсчёта — обратно в мир
		// Опад нескольких пород: порода листа — полоса номера (G). Лист своей породы
		// под кроной проходит, чужой — редко (занесён ветром); на стыке крон вперемешку.
		if (i == uOvSpecies) {
			int k = int(clamp(a.a, 0.0, 0.999) * float(uSpN));
			float share = spTot > 0.02 ? gComp(spW, k) / spTot : 1.0;   // вдали от деревьев — все породы
			float keep = mix(0.3, 1.0, share);                   // чужой лист — 30%, «занесло ветром»
			if (fract(m.b * 97.31) > keep) continue;             // решение на весь лист: порядок в стопке у листа один
		}
		vec3 col = uGDebug == 1 ? gDebugCol((i + 4) % 10) : a.rgb;
		if (under) {
			g.alb = mix(g.alb, col, hit); g.nxz = mix(g.nxz, n, hit);
			g.rough = mix(g.rough, 0.8, hit); g.ao = mix(g.ao, 1.0, hit);
			g.h = mix(g.h, 0.5 + 0.5 * m.a, hit); g.under = max(g.under, hit);
		} else {
			g.lalb = mix(g.lalb, col, hit); g.lnxz = mix(g.lnxz, n, hit);
			g.leaf = max(g.leaf, hit);
		}
	}
}

GroundS groundAt(vec2 xz, float near, float grassD) {
	gDeriv(xz);
	vec2 uv = (xz - uGOrigin) / uGSize;
	vec4 w0 = texture(uGW0, uv), w1 = texture(uGW1, uv);
	// за пределами карты (земля за улицами) правил нет — только почва и дёрн, без размазанного края карты
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { w0 = vec4(0.0); w1 = vec4(0.0); }
	vec4 nz = gBlendN(xz);
	vec4 gz = gGrunge(xz), cz = gCell(xz);
	float mixW = smoothstep(0.35, 0.65, nz.g);
	bool two = near > 0.0;
	// вес слоя: канал правил + доля от карты травы (дёрн), по выбору шума;
	// почва-остаток уступает дёрну — под газоном дёрн, в проплешинах почва
	float w[${MAX_LAYERS}]; float turf = 0.0;
	for (int i = 0; i < ${MAX_LAYERS}; i++) {
		w[i] = 0.0;
		if (i >= uGN) continue;
		int cI = uGCh[i];
		if (cI >= 0) w[i] = cI < 4 ? gComp(w0, cI) : gComp(w1, cI - 4);
		w[i] += uGGrass[i] * grassD;
		w[i] *= gSelect(uGSel[i], nz, gz, cz);
		if (uGGrass[i] > 0.0) turf = max(turf, w[i]);
	}
	if (uGRest >= 0) w[uGRest] = max(0.1, w[uGRest] - turf);
	vec4 A[${MAX_LAYERS}]; vec4 B[${MAX_LAYERS}]; float sc[${MAX_LAYERS}];
	float top = -1.0;
	for (int i = 0; i < ${MAX_LAYERS}; i++) {
		sc[i] = -1.0;
		if (i >= uGN || w[i] < 0.02) continue;
		gSample(i, xz, mixW, two, A[i], B[i]);
		// оценка: вес + рельеф слоя (в см, чтобы наборы были сравнимы) + рваная кромка
		sc[i] = w[i] + (A[i].a - 0.5) * uGH[i] * 0.12 + (nz.a - 0.5) * 0.25 * w[i];
		top = max(top, sc[i]);
	}
	GroundS g; g.alb = vec3(0.0); g.h = 0.0; g.nxz = vec2(0.0); g.rough = 0.0; g.ao = 0.0;
	g.under = 0.0; g.leaf = 0.0; g.lalb = vec3(0.0); g.lnxz = vec2(0.0);
	float sum = 0.0;
	for (int i = 0; i < ${MAX_LAYERS}; i++) {
		if (sc[i] < 0.0) continue;
		float k = max(sc[i] - top + 0.12, 0.0);   // 0.12 — ширина перехода
		if (k <= 0.0) continue;
		g.alb += (uGDebug == 1 ? gDebugCol(i) : A[i].rgb) * k;
		g.h += A[i].a * k; g.nxz += B[i].xy * k; g.rough += B[i].z * k; g.ao += B[i].w * k;
		sum += k;
	}
	if (sum > 0.0) { g.alb /= sum; g.h /= sum; g.nxz /= sum; g.rough /= sum; g.ao /= sum; }
	else { g.alb = vec3(0.12, 0.1, 0.07); g.rough = 0.95; g.ao = 1.0; }
	g.alb *= 0.8 + 0.4 * nz.r;   // крупный разнотон, ~16 м
	// сырость пятнами: темнее и глаже (блестит)
	float wet = smoothstep(0.45, 0.85, gz.g) * 0.5;
	g.alb *= 1.0 - 0.25 * wet; g.rough *= 1.0 - 0.45 * wet;
	overlays(xz, grassD, nz, gz, cz, false, g);
	return g;
}
`;

const VERT_WORLD = (s) => s
	.replace("#include <common>", "#include <common>\nvarying vec3 vGWorld;\nvarying float vGUp;")
	.replace("#include <begin_vertex>", `#include <begin_vertex>
		{
			mat4 gM = modelMatrix;
			#ifdef USE_INSTANCING
			gM = modelMatrix * instanceMatrix;   // экземпляры (плиты): мировая позиция с матрицей экземпляра
			#endif
			vGWorld = (gM * vec4(transformed, 1.0)).xyz;
			vGUp = normalize(mat3(gM) * objectNormal).y;
		}`);

/**
 * Пол на материале земли: слои, накладки под газоном, газон, накладки сверху.
 * Газон (цвет, слой 1 травы) там, где его оставила карта травы; в проплешинах
 * и там, где его вытеснили слои, — пол.
 */
export function groundify(material) {
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, grassUniforms, groundUniforms);
		shader.vertexShader = VERT_WORLD(shader.vertexShader);
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>\nvarying vec3 vGWorld;\nvarying float vGUp;\n${GLSL_COMMON}\n${GLSL_GROUND}`)
			.replace("#include <map_fragment>", `#include <map_fragment>
				vec2 gXZ = vGWorld.xz;
				vec4 gMap = grassAt(gXZ);
				float gTop = smoothstep(-0.2, -0.05, vGWorld.y);                   // только верх плиты
				float gNear = 1.0 - smoothstep(20.0, 60.0, length(cameraPosition.xz - gXZ));
				GroundS gG = groundAt(gXZ, gNear, gMap.r);
				vec4 gNz = gBlendN(gXZ);
				// Проплешины в газоне — по рельефу пола и рваной кромке; где трава
				// по карте слабее (вытоптана, вытеснена) — пол виден сильнее.
				float gField = gG.h * 0.45 + gNz.a * 0.35 + gNz.g * 0.2;
				float gBare = smoothstep(0.62, 0.78, gField + (1.0 - gMap.r) * 0.55 - gMap.g * 0.25);
				gBare = max(gBare, 1.0 - smoothstep(0.03, 0.25, gMap.r));   // где травы нет по карте — газона нет вовсе
				if (uGDebug == 1) gBare = 1.0;
				vec3 gTurf = grassColor(gXZ, 0.35 + 0.3 * gMap.g) * (0.85 + 0.3 * gNz.b) * (0.9 + 0.2 * gNz.r);
				vec3 gFloor = gG.alb * mix(1.0, gG.ao, 0.7);
				// Под травинками видна земля и накладки под газоном (стелющаяся трава,
				// ветошь): они и есть «газон» вблизи, ровный цвет остаётся вдали.
				float gSeen = (0.5 + 0.3 * (1.0 - gMap.r) - 0.2 * gMap.g) * smoothstep(0.15, 0.7, gG.h + 0.5 * gNz.b - 0.25) * (0.35 + 0.65 * gNear);
				gSeen = max(gSeen, gG.under * (0.3 + 0.6 * gNear));
				gSeen = max(gSeen, gMap.r * (0.3 + 0.4 * gNear));   // под газоном лежит дёрн — вблизи он и есть газон
				gTurf = mix(gTurf, gFloor * mix(0.8, 1.0, gG.under), clamp(gSeen, 0.0, 1.0));
				diffuseColor.rgb = mix(diffuseColor.rgb, mix(mix(gTurf, gFloor, gBare), gG.lalb, gG.leaf), gTop * 0.95);
				// Ленты переходов со стороны земли: отколотые куски асфальта за рваной
				// кромкой; у тротуара — полоса земли по шву.
				{
					GEdge gE = gEdge(gXZ);
					if (gE.type > 0 && gE.d > -0.05 && gE.d < 0.5) {
						vec4 bd = gBand(gE, gXZ);
						if (gE.type == 1) {
							float chip = smoothstep(0.4, 0.6, bd.r) * gTop;
							diffuseColor.rgb = mix(diffuseColor.rgb, uHardCol * (0.75 + 0.25 * bd.g), chip);
						} else {
							vec4 fa, fb; gSample(uEdgeFloor, gXZ, 0.0, false, fa, fb);
							diffuseColor.rgb = mix(diffuseColor.rgb, fa.rgb, smoothstep(0.2, 0.7, bd.b) * 0.8 * gTop);
						}
					}
				}
				// рельеф земли и под травой, но слабее — дёрн его сглаживает
				float gFloorMask = mix(0.45, 1.0, max(max(gBare, gG.leaf), gG.under)) * gTop;`)
			.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor, mix(gG.rough, 0.75, gG.leaf), gFloorMask);`)
			// нормаль пола: плоскость земли, T = +X, B = +Z, N = +Y; вдали гаснет
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
				{
					vec2 txy = mix(gG.nxz, gG.lnxz, gG.leaf) * gNear + gDetail(gXZ) * 0.5;
					vec3 wn = normalize(vec3(txy.x, sqrt(max(0.0, 1.0 - dot(txy, txy))), txy.y));
					vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
					normal = normalize(mix(normal, vn, gFloorMask));
				}`);
	};
	material.customProgramCacheKey = () => "ground-floor";
	material.needsUpdate = true;
}

/**
 * Твёрдые покрытия (дорожки, проезды, асфальт): свой цвет остаётся, сверху —
 * накладки «сверху» из той же карты. Так стык сшивается с обеих сторон:
 * камешки с кромки и опад лежат и на земле, и на дорожке.
 */
// lite — без асфальта и лент стыков (материалы со своими картами, например плиты):
// иначе под D3D программа превышает 16 текстур.
export function hardify(material, asphalt = 0, { lite = false } = {}) {
	const own = { uAMode: { value: asphalt } };   // 0 — нет, 1 — все варианты пятнами, 2 — только старый
	// свой шейдер материала (плиты: развёртка кусков) — сохраняется, накладки поверх
	const prevCB = material.onBeforeCompile, prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : "";
	material.onBeforeCompile = (shader, r) => {
		if (prevCB) prevCB.call(material, shader, r);
		if (lite) shader.defines = { ...shader.defines, HARD_LITE: "" };
		Object.assign(shader.uniforms, grassUniforms, groundUniforms, own);
		shader.vertexShader = VERT_WORLD(shader.vertexShader);
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>\nvarying vec3 vGWorld;\nvarying float vGUp;\n${GLSL_COMMON}\n${GLSL_GROUND}`)
			.replace("#include <map_fragment>", `#include <map_fragment>
				vec2 hXZ = vGWorld.xz;
				float hTop = smoothstep(0.5, 0.9, vGUp);   // только верхние грани
				float hNear = 1.0 - smoothstep(20.0, 60.0, length(cameraPosition.xz - hXZ));
				GroundS hG; hG.alb = vec3(0.0); hG.h = 0.0; hG.nxz = vec2(0.0); hG.rough = 0.0; hG.ao = 1.0;
				hG.under = 0.0; hG.leaf = 0.0; hG.lalb = vec3(0.0); hG.lnxz = vec2(0.0);
				gDeriv(hXZ);
				vec4 hGz = gGrunge(hXZ);
				// Асфальт: варианты пятнами (процедурный шум без тайла, границы рваные по
				// высоте отсчёта): в основном старый, местами выкрошенный, изредка заплаты.
				vec4 hAA = vec4(0.0), hAB = vec4(0.0, 0.0, 0.9, 1.0); float hAsph = 0.0;
				float hRut = 0.0, hOil = 0.0, hDust = 0.0, hPud = 0.0, hDamp = 0.0, hSeam = 0.0, hPch = 0.0, hGrav = 0.0;
				#ifndef HARD_LITE
				if (uAOn > 0.5 && uAMode > 0.5) {
					// Карта дороги (правила от улиц) + маска износа HoudiniCOP вдоль движения:
					// колеи, масло между колёс, пыль у бордюра, выкрошенность, заплаты, лужи.
					vec4 r0 = gRoad(hXZ, 0.0), r1 = gRoad(hXZ, 1.0);
					vec2 rt = normalize(r1.xy * 2.0 - 1.0 + vec2(1e-4, 0.0));
					vec4 wm = gNoise4(vec2(dot(hXZ, rt), dot(hXZ, vec2(-rt.y, rt.x))) / 8.0, 4.0);
					float brk = 0.6 + 0.8 * wm.a;
					hRut = r0.r * wm.r * brk;
					hOil = r1.z * wm.g;
					hDust = r0.g * wm.b * brk;
					// тротуар (режим 2): мелкозернистый, пятнами — с трещинами
					bool walk = uAMode > 1.5;
					float wc = walk ? smoothstep(0.52, 0.68, gNoise(hXZ * 0.07 + 3.3) * 0.7 + gNoise(hXZ * 0.3 + 1.1) * 0.3)
						: smoothstep(0.35, 0.65, r0.b + (gNoise(hXZ * 0.19 + 8.1) - 0.5) * 0.5);
					float L0 = walk ? 3.0 : 0.0, L1 = walk ? 4.0 : 1.0, TL = walk ? uATile * 0.5 : uATile;
					hPch = uAMode > 1.5 ? 0.0 : smoothstep(0.4, 0.6, r0.a);
					hSeam = uAMode > 1.5 ? 0.0 : smoothstep(0.15, 0.45, r0.a) * (1.0 - smoothstep(0.55, 0.85, r0.a));
					// вблизи — шестиугольное расслоение, дальше 30 м — один отсчёт
					float far = step(30.0, length(cameraPosition - vGWorld));
					vec4 a0, b0;
					if (far > 0.5) { gAsphTap(L0, hXZ / TL, gDX / TL, gDY / TL, vec2(0.0), false, a0, b0); }
					else gAsphHex(L0, hXZ, a0, b0);
					hAA = a0 * (1.0 - wc); hAB = b0 * (1.0 - wc);
					if (wc > 0.01) {
						vec4 a1, b1;
						if (far > 0.5) gAsphTap(L1, hXZ / TL, gDX / TL, gDY / TL, vec2(0.0), false, a1, b1);
						else gAsphHex(L1, hXZ, a1, b1);
						hAA += a1 * wc; hAB += b1 * wc;
					}
					hAsph = hTop;
					// выгоревший битум светлее и серее; заплата — свежее и темнее, шов битума
					vec3 ac = hAA.rgb * mix(1.0, hAB.w, 0.6) * vec3(1.1, 1.08, 1.05);
					ac = mix(ac, ac * vec3(0.62, 0.62, 0.64), hPch);
					ac = mix(ac, vec3(0.035), hSeam * 0.8);
					ac *= 1.0 + 0.12 * hRut;                                  // колея — отполирована
					ac = mix(ac, ac * 0.55, hOil * 0.8);                      // масло
					ac = mix(ac, vec3(0.42, 0.38, 0.31), hDust * 0.55);      // пыль и песок у бордюра
					// пролом (декаль по номеру клетки; край декали — ровно ноль, стыка нет)
					float pitLow = 0.0;
					if (uPitOn > 0.5) {
						ivec2 pc = ivec2(floor((hXZ - uROrigin) / 0.5));
						int pid = int(texelFetch(uRoad, ivec3(pc, 2), 0).r * 255.0 + 0.5) - 1;
						if (pid >= 0) {
							vec4 P = uPits[pid];
							vec2 pu = (hXZ - P.xy) / P.z;
							int pr = int(P.w / 64.0);
							if (pr == 1) pu = vec2(-pu.y, pu.x); else if (pr == 2) pu = -pu; else if (pr == 3) pu = vec2(pu.y, -pu.x);
							pu += 0.5;
							if (all(greaterThan(pu, vec2(0.0))) && all(lessThan(pu, vec2(1.0)))) {
								float pl = mod(P.w, 64.0);
								vec4 pm = textureLod(uPitTex, vec3(pu, pl + 2.0), 0.0);
								vec3 pn = textureLod(uPitTex, vec3(pu, pl + 26.0), 0.0).xyz * 2.0 - 1.0;
								float grav = smoothstep(0.3, 0.7, pm.a);
								// щебень основания: линейный тон чуть светлее асфальта (≈0.07), крупнозернистый
								vec3 gcol = vec3(0.085, 0.08, 0.072) * (0.55 + 0.9 * gNoise(hXZ * 23.0)) * (0.75 + 0.5 * gNoise(hXZ * 61.0));
								ac *= (1.0 - 0.7 * smoothstep(0.15, 0.6, pm.r)) * (1.0 - 0.3 * pm.b);
								ac = mix(ac, gcol, grav);
								hGrav = grav;
								hAB.xy = mix(hAB.xy, pn.xy, 0.85);
								pitLow = pm.b * 0.35 + grav * 0.3;   // лужа — в осевших кусках, щебень сухой
							}
						}
					}
					// лужи: низины + сырость пятнами; вокруг — тёмная сырая кайма
					float wet = gNoise(hXZ * 0.11 + 4.4) * 0.6 + hGz.g * 0.4;
					// край лужи — не по клеткам карты, а по мелкому шуму: органичная форма
					float lowv = max(r1.a * 0.85, pitLow) + (wet - 0.5) * 0.7 + (gNoise(hXZ * 1.7 + 2.1) - 0.5) * 0.3;
					hPud = smoothstep(0.57, 0.61, lowv) * hTop * (1.0 - hGrav);   // щебень воду не держит
					hDamp = smoothstep(0.44, 0.57, lowv) * hTop;
					ac *= 1.0 - 0.3 * hDamp;
					ac = mix(ac, ac * 0.45, hPud);
					diffuseColor.rgb = mix(diffuseColor.rgb, ac, hAsph);
				}
				#endif
				// Гранж по покрытию: грязь пятнами, сырость (темнее, блестит), мох по
				// швам там, где грязно, трещины. Вдали трещины гаснут — иначе муар.
				// Грязь и сырость на асфальте — процедурным шумом без тайла: из маски 8 м
				// на однотонном асфальте одни и те же кляксы шли рядом, шаг читался сверху.
				float hN1 = gNoise(hXZ * 0.21 + 3.7) * 0.6 + gNoise(hXZ * 0.83 + 1.1) * 0.4;
				float hN2 = gNoise(hXZ * 0.07 + 9.3) * 0.7 + gNoise(hXZ * 0.29 + 4.4) * 0.3;
				float hDirt = smoothstep(0.55, 0.85, hN1) * hTop;
				float hWet = smoothstep(0.62, 0.9, hN2) * hTop;
				// трещины и мох — не узором по всей площади, а пятнами там, где грязно и по шуму
				float hPatch = smoothstep(0.35, 0.75, 0.6 * gBlendN(hXZ).a + 0.6 * hGz.r);
				float hMoss = smoothstep(0.35, 0.8, hGz.b) * smoothstep(0.15, 0.5, hGz.r) * hPatch * hTop;
				float hCrack = smoothstep(0.25, 0.7, hGz.a) * hPatch * hNear * hTop;
				// Трещины и мох из общего гранжа на асфальте читались одинаковыми «рогатками»
				// (маска одна на весь квартал) — выключены до текстур асфальта HoudiniCOP,
				// где трещины свои, в рельефе. Грязь и сырость — слабее.
				hMoss = 0.0; hCrack = 0.0;
				diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.73, 0.66), hDirt * 0.5);
				diffuseColor.rgb *= 1.0 - 0.2 * hWet;
				// Ленты переходов со стороны покрытия: рваная кромка — в выбоинах земля,
				// вдоль кромки трещины, край чуть темнее (скруглён вниз); у тротуара —
				// трава языками и кустиками заходит на плитку, по шву земля.
				#ifndef HARD_LITE
				{
					GEdge hE = gEdge(hXZ);
					if (hE.type > 0 && hE.d < 0.05 && hE.d > -0.5) {
						vec4 bd = gBand(hE, hXZ);
						vec4 fa, fb; gSample(uEdgeFloor, hXZ, 0.0, false, fa, fb);
						if (hE.type == 1) {
							float hole = (1.0 - smoothstep(0.4, 0.6, bd.r)) * hTop;
							diffuseColor.rgb *= mix(1.0, 0.8, (1.0 - bd.g) * (1.0 - hole) * hTop);
							diffuseColor.rgb *= 1.0 - 0.6 * smoothstep(0.3, 0.7, bd.a) * hTop;
							diffuseColor.rgb = mix(diffuseColor.rgb, fa.rgb, hole);
						} else {
							float grass = max(smoothstep(0.4, 0.6, bd.r), smoothstep(0.3, 0.6, bd.a)) * hTop;
							diffuseColor.rgb = mix(diffuseColor.rgb, fa.rgb, smoothstep(0.2, 0.7, bd.b) * 0.8 * hTop);
							diffuseColor.rgb = mix(diffuseColor.rgb, grassColor(hXZ, 0.3 + 0.5 * bd.g), grass);
						}
					}
				}
				#endif
				overlays(hXZ, 0.0, gBlendN(hXZ), hGz, gCell(hXZ), true, hG);
				float hMask = hG.leaf * hTop;
				diffuseColor.rgb = mix(diffuseColor.rgb, hG.lalb, hMask);`)
			.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor, hAB.z, hAsph);
				roughnessFactor *= 1.0 - 0.2 * hRut - 0.35 * hOil - 0.25 * hDamp;
				roughnessFactor = mix(roughnessFactor, 0.97, hDust * 0.5);
				roughnessFactor = mix(roughnessFactor, 0.55, hSeam);
				roughnessFactor = mix(roughnessFactor, 0.04, hPud);   // вода: зеркало неба
				roughnessFactor = mix(roughnessFactor, 1.0, hGrav);
				roughnessFactor *= 1.0 - 0.5 * hWet;
				roughnessFactor = mix(roughnessFactor, 0.95, hMoss);
				roughnessFactor = mix(roughnessFactor, 0.75, hMask);`)
			// небо в отражении: сухой асфальт почти не отражает (иначе сереет весь),
			// лужа — в полную силу, щебень — никак
			.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
				reflectedLight.indirectSpecular *= mix(0.25, 2.5, hPud) * (1.0 - hGrav);`)
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
				{
					vec2 txy = mix(mix(gDetail(hXZ) * 0.6, hAB.xy, hAsph), hG.lnxz, hMask) * hNear * (1.0 - hPud);
					vec3 wn = normalize(vec3(txy.x, sqrt(max(0.0, 1.0 - dot(txy, txy))), txy.y));
					normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), hTop));
				}`);
	};
	material.customProgramCacheKey = () => "ground-hard|" + (lite ? "lite|" : "") + prevKey;   // режим асфальта — униформа
	material.needsUpdate = true;
}

/**
 * Всё вместе: карта весов → текстуры; наборы грузятся в фоне, пол включается,
 * когда готовы. res — сторона слоя в массиве (на телефоне 512: память вчетверо меньше).
 * hard — материалы твёрдых покрытий, на которые ложатся накладки «сверху».
 */
/**
 * Карта пород для опада: вес каждой породы (до 4, по списку набора) от крон
 * над клеткой — та же сетка, что у карты весов.
 */
function speciesField(map, trees, species) {
	const { W, H, origin } = map, data = new Uint8Array(W * H * 4);
	// породы без своих листьев в наборе — к похожим по листу
	const ALIAS = { elm: "linden", lilac: "linden", oak: "maple", rowan: "birch" };
	for (const [tx, tz, tr, p] of trees) {
		const s = p?.species, k = species.indexOf(species.includes(s) ? s : ALIAS[s]);
		if (k < 0 || k > 3) continue;
		const R = tr * 1.8;
		const i0 = Math.max(0, Math.floor((tx - R - origin.x) / CELL)), i1 = Math.min(W - 1, Math.floor((tx + R - origin.x) / CELL));
		const j0 = Math.max(0, Math.floor((tz - R - origin.y) / CELL)), j1 = Math.min(H - 1, Math.floor((tz + R - origin.y) / CELL));
		for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
			const dd = Math.hypot(origin.x + (i + 0.5) * CELL - tx, origin.y + (j + 0.5) * CELL - tz);
			const w = Math.round(Math.max(0, 1 - dd / R) * 255), q = (j * W + i) * 4 + k;
			if (w > data[q]) data[q] = w;
		}
	}
	const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

export async function setupGround(d, material, map, { res = 1024, debug = false, hard = [], trees = [] } = {}) {
	const [w0, w1] = weightTextures(map);
	const U = groundUniforms;
	U.uGW0.value = w0; U.uGW1.value = w1;
	U.uGOrigin.value.copy(map.origin); U.uGSize.value.copy(map.size);
	U.uGN.value = map.layers.length;

	const E = buildEdgeField(d);
	U.uEdge.value = E.tex; U.uEOrigin.value.copy(E.origin); U.uESize.value.copy(E.size);
	// шумы и ленты — массивами (данные: читаем без премультипликации альфы)
	const imgs = async (list, res) => Promise.all(list.map(f => loadImage(TEX + f).then(im => rawPixels(im, res))));
	const packArr = (px, res, wrapT) => {
		const data = new Uint8Array(res * res * 4 * px.length);
		px.forEach((p, i) => data.set(p, i * res * res * 4));
		const t = arrayTex(data, res, px.length, false);
		t.wrapT = wrapT;
		return t;
	};
	const [noisePx, bandPx] = await Promise.all([
		imgs(["blend-noise/blend_noise_rgba_1k.png", "grunge-mask/grunge_mask_rgba_1k.png",
			"noise-cellular-soft/noise_cellular_soft_rgba_1k.png", "detail-normal/detail_normal_normal_1k.png",
			"road-wear-mask/road_wear_mask_2k.png"], 1024),   // слой 4 — износ дороги (HoudiniCOP), U вдоль движения
		imgs(["band-asphalt-soil/band_asphalt_soil_rgba_1k.png", "band-paving-grass/band_paving_grass_rgba_1k.png"], 256),
	]);
	U.uNoise.value = packArr(noisePx, 1024, THREE.RepeatWrapping);
	const roadMap = buildRoadMap(d);
	U.uRoad.value = roadMap.tex; U.uROrigin.value.copy(roadMap.origin); U.uRSize.value.copy(roadMap.size);
	roadMap.pits.forEach((p, i) => U.uPits.value[i].set(p.x, p.z, p.size, p.layer + p.rot * 64));
	loadPitArray(bandPx).then(t => { U.uPitTex.value = t; U.uPitOn.value = 1; console.log(`ground: проломы ${roadMap.pits.length}`); })
		.catch(e => console.warn("ground: проломы", e));
	// ленты сразу, проломы — когда догрузятся (тот же массив, пересобранный)
	U.uPitTex.value = packArr(bandPx, 256, THREE.ClampToEdgeWrapping);
	const hard0 = Array.isArray(hard[0]) ? hard[0][0] : hard[0];
	if (hard0) U.uHardCol.value.copy(hard0.color);
	U.uGDebug.value = debug ? 1 : 0;
	const layerNames = map.layers, GL = d.ground.layers;
	const [L, O] = await Promise.all([buildLayerArrays(d, layerNames, res), buildOverlayArrays(d.ground.overlays || [], res)]);
	U.uGA.value = L.A; U.uGB.value = L.B;
	const SEL = { r: 0, g: 1, b: 2, a: 3, dirt: 4, wet: 5, moss: 6, crack: 7, cellSpot: 8, cell: 9, cellEdge: 10, cellRidge: 11 };
	L.tile.forEach((t, i) => {
		const c = GL[layerNames[i]];
		U.uGTile.value[i] = t; U.uGH.value[i] = L.hScale[i];
		U.uGCh.value[i] = map.layerCh[i];
		U.uGGrass.value[i] = c.grass || 0;
		U.uGHex.value[i] = c.antitile === "hex" ? 1 : 0;
		U.uGSel.value[i].set(c.select ? SEL[c.select[0]] : -1, c.select?.[1] ?? 0, c.select?.[2] ?? 1, 0);
	});
	U.uGRest.value = layerNames.findIndex(n => GL[n].rest);
	U.uEdgeFloor.value = Math.max(0, layerNames.indexOf(d.ground.edgeFloor || "packed"));
	O.ready.slice(0, MAX_OV).forEach(({ o, s }, i) => {
		U.uOvCh.value[i] = map.names.indexOf(o.id);
		U.uOvUnder.value[i] = o.under === "turf" ? 1 : 0;
		U.uOvTile.value[i] = s.meta.tile;
		U.uOvAmb.value[i] = o.ambient || 0;
		U.uOvGrass.value[i] = o.grass || 0;
		U.uOvSel.value[i].set(o.select ? SEL[o.select[0]] : -1, o.select?.[1] ?? 0, o.select?.[2] ?? 1, 0);
	});
	U.uOvN.value = Math.min(O.ready.length, MAX_OV);
	U.uOvEdge.value = O.ready.slice(0, MAX_OV).findIndex(x => x.o.edge);
	// опад нескольких пород: список пород — в tile.txt набора (species=birch,maple,…)
	const spI = O.ready.slice(0, MAX_OV).findIndex(x => x.s.meta.species?.length > 1);
	U.uOvSpecies.value = spI;
	if (spI >= 0) {
		const sp = O.ready[spI].s.meta.species;
		U.uSpN.value = sp.length;
		U.uSpMap.value = speciesField(map, trees, sp);
		console.log(`ground: опад пород ${sp.join(",")}`);
	} else U.uSpMap.value = new THREE.DataTexture(new Uint8Array(4), 1, 1);
	if (!U.uAA.value) { const e = () => arrayTex(new Uint8Array(4), 1, 1, false); U.uAA.value = e(); U.uAB.value = e(); }
	if (!U.uRoad.value) U.uRoad.value = arrayTex(new Uint8Array(8), 1, 1, false);
	if (O.OA) { U.uOA.value = O.OA; U.uOB.value = O.OB; }
	else {   // накладок нет — пустые массивы, чтобы шейдеру было что привязать
		const empty = () => arrayTex(new Uint8Array(4), 1, 1, false);
		U.uOA.value = empty(); U.uOB.value = empty();
	}
	groundify(material);
	for (const h of hard) Array.isArray(h) ? hardify(h[0], h[1]) : hardify(h);
	// асфальт — фоном: пока грузится, покрытие прежнее
	// слои: 0 дорога старая, 1 выкрошенная, 2 в заплатах (не используется — заплаты из карты),
	// 3 тротуар мелкозернистый, 4 тротуар с трещинами (тайл 2 м)
	const ASPH = ["asphalt-road-old", "asphalt-road-crumbled", "asphalt-road-patched", "asphalt-walk-fine", "asphalt-walk-cracked"];
	Promise.all(ASPH.map(n => loadSet(n, ["albedo", "normal", "orm", "height"], "2k"))).then(sets => {
		if (sets.some(s => !s)) { console.warn("ground: асфальт — нет наборов"); return; }
		const r = res, S = r * r * 4, A = new Uint8Array(S * sets.length), B = new Uint8Array(S * sets.length);
		sets.forEach((s, li) => {
			const alb = rawPixels(s.albedo, r), nrm = rawPixels(s.normal, r), orm = rawPixels(s.orm, r), hgt = rawPixels(s.height, r), o = li * S;
			for (let k = 0; k < S; k += 4) {
				A[o + k] = alb[k]; A[o + k + 1] = alb[k + 1]; A[o + k + 2] = alb[k + 2]; A[o + k + 3] = hgt[k];
				B[o + k] = nrm[k]; B[o + k + 1] = nrm[k + 1]; B[o + k + 2] = orm[k + 1]; B[o + k + 3] = orm[k];
			}
		});
		U.uAA.value = arrayTex(A, r, sets.length, true); U.uAB.value = arrayTex(B, r, sets.length, false);
		U.uATile.value = sets[0].meta.tile; U.uAOn.value = 1;
		console.log(`ground: асфальт ${ASPH.join(",")} · ${r}px`);
	}).catch(e => console.warn("ground: асфальт", e));
	console.log(`ground: слои ${layerNames.join(",")} · накладки ${O.ready.map(x => x.o.id).join(",") || "—"} · ${res}px` +
		(L.stand.length ? ` · заглушки: ${L.stand.join(",")}` : ""));
	return { stand: L.stand, overlays: O.ready.map(x => x.o.id), pits: roadMap.pits };
}

/** Кустики в проломах (HoudiniCOP joint_grass/grass_pit-*): пивот — центр декали на поверхности. */
export async function loadPitGrass(pits) {
	const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
	const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
	const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), cache = {};
	const group = new THREE.Group();
	group.name = "PitGrass";
	for (const p of pits) {
		const f = `../game/assets/models/joint_grass/grass_${p.set}_lod1.glb`;
		try {
			const g = await (cache[f] ||= L.loadAsync(f));
			const o = g.scene.clone();
			o.position.set(p.x, -0.14, p.z);            // полотно дороги на −KERB_H
			o.rotation.y = -p.rot * Math.PI / 2;
			o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
			group.add(o);
		} catch { /* без травы */ }
	}
	return group;
}