import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { loadWearNoise, makeWearMaterial, randomWear } from "./wear_furniture.js";
import { lodManifest, texUrl, texPx } from "./texlod.js";

// Стенд мебели: квартира из четырёх комнат (гостиная, спальня, кухня, детская),
// в ней вся мебель blend (game/assets/models/furniture/*_web.glb) — у каждого
// экземпляра свой износ и оттенок (wear_furniture.js). Полы — паркет HoudiniCOP
// (ёлочка и мозаика), стены — побелка (обоев пока нет).
//
// Раскладка — правилами, не координатами предметов: габарит каждой модели
// меряется после загрузки; ряд вдоль стены ставит предметы спиной к стене,
// вплотную друг к другу; стол — в точку, стулья — к его сторонам лицом к столу;
// горшки — на подоконник. Лицо модели — её −Z (у кроватей −Z — изножье).
// Стена между камерой и точкой, куда она смотрит, срезается до 0.9 м («кукольный
// дом») — с любой стороны, куда ни повернуть.

const FURN = "../game/assets/models/furniture/", TEX = "../game/assets/textures/";
const CURT = "../game/assets/models/curtains/";   // шторы HoudiniCOP (ткань — Vellum), износа мебели на них нет
const H = 2.6, T = 0.1, CUT = 0.9;   // высота стен, толщина, срез

// комнаты — прямоугольники по осям стен [x0, z0, x1, z1]
const ROOMS = {
	living: { name: "гостиная", rect: [0, 0, 5.2, 4], floor: "herring" },
	bedroom: { name: "спальня", rect: [5.2, 0, 9, 4], floor: "mosaic" },
	kitchen: { name: "кухня", rect: [0, 4, 3.2, 6.8], floor: "mosaic" },
	kids: { name: "детская", rect: [3.2, 4, 9, 6.8], floor: "herring" },
};
// стены: отрезок по оси, проёмы — {c: середина от начала, w, door | window}
const DOOR = [0, 2.05], WIN = [0.86, 2.2];
const WALLS = [
	{ a: [0, 0], b: [9, 0], open: [{ c: 4.3, w: 1.3, y: WIN }, { c: 7.2, w: 1.3, y: WIN }] },
	{ a: [0, 0], b: [0, 6.8] },
	{ a: [0, 6.8], b: [9, 6.8], open: [{ c: 1.6, w: 1.2, y: WIN }, { c: 6.1, w: 1.4, y: WIN }] },
	{ a: [9, 0], b: [9, 6.8] },
	{ a: [5.2, 0], b: [5.2, 4], open: [{ c: 2.45, w: 0.9, y: DOOR }] },
	{ a: [0, 4], b: [9, 4], open: [{ c: 1.45, w: 0.9, y: DOOR }, { c: 4.45, w: 0.9, y: DOOR }, { c: 8.45, w: 0.9, y: DOOR }] },
	{ a: [3.2, 4], b: [3.2, 6.8] },
];

// Расстановка. wall(комната, сторона, [модели], от угла м) — ряд спиной к стене;
// at(модель, x, z, лицо) — центр в точке; around(стол, [[модель, сторона, доля]]);
// sill(окно №, [модели]) — на подоконник; top(предмет, модель, доля) — сверху на предмет.
const PLAN = [
	// гостиная: «стенка» по северной стене до окна, шкаф и буфет по западной
	["wall", "living", "N", ["sideboard_tall", "sideboard_bar", "bookcase_glass"], 0.05],
	["wall", "living", "W", ["sideboard", "wardrobe_legs"], 0.05],
	["wall", "living", "S", ["table_book_closed"], 2.35],
	["table", "table_extending", 2.55, 2.2, [0, -1], [["chair_vienna", "N", 0.5], ["chair_vienna", "S", 0.5], ["chair_leather", "W", 0.5], ["chair_leather", "E", 0.5]]],
	["table", "table_round", 4.35, 1.15, [0, -1], [["chair_ladder", "S", 0.5], ["chair_spindle", "W", 0.5]]],
	["top", "sideboard", "pot_bowl", 0.3], ["top", "sideboard_bar", "pot_classic", 0.7],
	// спальня: две кровати изголовьем к восточной стене, шифоньер у двери, рабочий стол у южной
	["wall", "bedroom", "E", ["bed_double", { m: "bed_polished", gap: 0.5 }], 0.1],
	["wall", "bedroom", "W", ["wardrobe_mirror"], 2.55],
	["wall", "bedroom", "N", ["chair_bent"], 0.2],
	["table", "table_book", 6.35, 3.45, [0, -1], [["chair_bent", "N", 0.35], ["stool_cream", "N", 0.75]]],
	["sill", 1, ["pot_ribbed", "pot_bowl", "pot_tall"]],
	// кухня: плита и мойки по западной стене, стол с табуретами
	["wall", "kitchen", "W", ["stove_gas", "sink_cabinet", "sink_backsplash"], 0.1],
	["table", "table_kitchen", 2.0, 5.65, [0, -1], [["stool_cream", "N", 0.5], ["stool_marble", "S", 0.3], ["stool_green", "S", 0.75], ["chair_spindle", "E", 0.5]]],
	["top", "table_kitchen", "pot_classic", 0.5],
	// детская: кровати по стенам, два письменных стола между дверями
	["wall", "kids", "E", ["bed_metal"], 0.25],
	["wall", "kids", "W", ["bed_pine_metal"], 0.15],
	["wall", "kids", "S", [{ m: "folding_cot", side: true }], 1.9],
	["wall", "kids", "N", ["desk_pedestal", "desk_legs"], 1.8],
	["front", "desk_pedestal", "chair_ladder"], ["front", "desk_legs", "chair_vienna"],
	["sill", 0, ["pot_tall", "pot_classic", "pot_ribbed"]],
	["sill", 2, ["pot_bowl", "pot_classic"]], ["sill", 3, ["pot_ribbed", "pot_tall"]],
	// отопление: батарея под каждым окном, стояк наращивается трубами до потолка;
	// rise — что ставить на стояк снизу вверх (floor — проход через пол)
	["rad", 0, "rad_7_riser_left", ["pipe_floor_pass", "pipe_straight_1m", "pipe_straight_1m", "pipe_bend_90"]],
	["rad", 1, "rad_10_two_pipe", ["pipe_floor_pass", "pipe_straight_1m", "pipe_straight_1m"]],
	["rad", 2, "rad_4_short", ["pipe_floor_pass", "pipe_tee", "pipe_straight_1m"]],
	["rad", 3, "rad_6_bypass_right", ["pipe_floor_pass", "pipe_straight_1m", "pipe_straight_1m"]],
	["radwall", "kitchen", "N", 1.95, "rad_8_bare"],
	// Шторы: на окне два карниза, оба дальше подоконника (он 0.26 м): тюль у стекла,
	// плотные шторы перед ним; на каждом — пара, левая и правая (правая — зеркало).
	// Штора на кольцах: начало — край карниза, полотно — к центру окна.
	["drape", 0, { tulle: "curtain_rings_w140_g100_114_lod0", heavy: ["curtain_rings_w100_g20_30_lod0", "curtain_rings_w100_g45_55_lod0"], color: 0x7a2e2a }],
	["drape", 1, { tulle: "curtain_rings_w140_g100_114_lod0", heavy: ["curtain_rings_w100_g45_55_lod0", "curtain_rings_w100_g20_30_lod0"], color: 0x5f6b3a }],
	["drape", 2, { tulle: "curtain_rings_w140_g100_114_lod0", heavy: ["curtain_rings_w100_g20_30_lod0", "curtain_rings_w100_g20_30_lod0"], color: 0xa9803a }],
	["drape", 3, { tulle: "curtain_rings_w140_g100_114_lod0", heavy: ["curtain_rings_w100_g45_55_lod0", "curtain_rings_w100_g45_55_lod0"], color: 0x3f4f6b }],
];

/* ── сцена ──────────────────────────────────────────────────────────── */
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9b6c2);   // небо в окнах
{
	const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x5d6150, roughness: 1 }));
	g.rotation.x = -Math.PI / 2; g.position.set(4.5, -0.02, 3.4); g.receiveShadow = true; scene.add(g);   // земля за окнами
}
scene.add(new THREE.HemisphereLight(0xe4ecf5, 0x6b5a48, 1.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.set(-3, 10, -6); sun.target.position.set(4.5, 0, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const status = document.getElementById("status");
const q = new URLSearchParams(location.hash.slice(1));

/* ── стены и полы ───────────────────────────────────────────────────── */
const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.93 });   // побелка
function box(w, h, d, x, y, z, mat) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
	scene.add(m); return m;
}
const windows = [];   // центры окон для подоконников
const wallPieces = [];   // куски стен: для среза — линия стены (нормаль, смещение) и высоты
for (const W of WALLS) {
	const [ax, az] = W.a, [bx, bz] = W.b, len = Math.hypot(bx - ax, bz - az);
	const ux = (bx - ax) / len, uz = (bz - az) / len, h = H;
	const along = (s0, s1, y0, y1) => {
		if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
		// у концов стены — продлить на полтолщины: углы сходятся без щели
		const e0 = s0 === 0 ? T / 2 : 0, e1 = s1 === len ? T / 2 : 0, l = s1 - s0 + e0 + e1, m = (s0 + s1) / 2 + (e1 - e0) / 2;
		const b = box(ux ? l : T, y1 - y0, uz ? l : T, ax + ux * m, (y0 + y1) / 2, az + uz * m, wallMat);
		wallPieces.push({ b, n: [-uz, ux], c: -uz * ax + ux * az, y0, y1 });
	};
	let s = 0;
	for (const o of (W.open || []).slice().sort((p, r) => p.c - r.c)) {
		const o0 = o.c - o.w / 2, o1 = o.c + o.w / 2;
		along(s, o0, 0, h);
		along(o0, o1, 0, o.y[0]); along(o0, o1, o.y[1], h);
		if (o.y === WIN) {
			const x = ax + ux * o.c, z = az + uz * o.c;
			let n = [-uz, ux];
			if (n[0] * (4.5 - x) + n[1] * (3.4 - z) < 0) n = [uz, -ux];   // нормаль — внутрь квартиры
			windows.push({ x, z, w: o.w, n });
		}
		s = o1;
	}
	along(s, len, 0, h);
}
// подоконники — доска внутрь комнаты (окна — на стенах вдоль X)
const sillMat = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.6 });
for (const w of windows) {
	box(w.w + 0.12, 0.04, 0.26, w.x, WIN[0] - 0.02, w.z + w.n[1] * 0.12, sillMat);
	w.top = WIN[0]; w.depthZ = w.z + w.n[1] * 0.13;
}

const LOD = await lodManifest();
function parquet(kind) {
	const set = kind === "mosaic" ? "parquet-mosaic-v0" : "parquet-herring-v0";
	const L = new THREE.TextureLoader(), ld = (m, srgb) => {
		const t = L.load(texUrl(LOD, set, m, texPx, "2k"));   // ступень под устройство (texlod.js)
		t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
		t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		return t;
	};
	// ORM: R — AO, G — шероховатость (лак ~0.3), B — высота
	return new THREE.MeshStandardMaterial({ map: ld("albedo", true), normalMap: ld("normal"), roughnessMap: ld("orm"), roughness: 1, metalness: 0 });
}
const floorMats = { herring: parquet("herring"), mosaic: parquet("mosaic") };
const TILE = { herring: 0.849, mosaic: 1.04 };
for (const R of Object.values(ROOMS)) {
	const [x0, z0, x1, z1] = R.rect, g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
	g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
	const p = g.attributes.position, uv = g.attributes.uv;   // UV — мировые метры / тайл: рисунок сквозной
	for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / TILE[R.floor], -p.getZ(i) / TILE[R.floor]);
	const m = new THREE.Mesh(g, floorMats[R.floor]); m.receiveShadow = true; scene.add(m);
}

/* ── мебель ─────────────────────────────────────────────────────────── */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// маска: без премультипликации и без переворота (A — класс материала; UV как у атласа glb)
const bmp = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
const names = [...new Set(PLAN.flatMap(p => p[0] === "wall" ? p[3].map(e => e.m || e) : p[0] === "table" ? [p[1], ...p[5].map(c => c[0])] :
	p[0] === "sill" ? p[2] : p[0] === "top" ? [p[2]] : p[0] === "front" ? [p[2]] : p[0] === "rad" ? [p[2], ...p[3]] :
	p[0] === "radwall" ? [p[4]] : []))];
const curtainNames = [...new Set(PLAN.filter(p => p[0] === "drape").flatMap(p => [p[2].tulle, ...p[2].heavy]).concat("curtain_rail_bare"))];
const TULLE_Z = 0.36, HEAVY_Z = 0.48, ROD = 1.0;   // от внутренней грани стены, м; полкарниза
// тюль — полупрозрачный (кружево ждём у HoudiniCOP: текстура с альфой по узору)
const tulleMat = new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.9, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
const noise = await loadWearNoise(`${FURN}textures/wear_noise.png`);
const models = {};
await Promise.all(names.map(async n => {
	const [g, img] = await Promise.all([loader.loadAsync(`${FURN}${n}_web.glb`), bmp.loadAsync(`${FURN}textures/baked/${n}_lod0_mask.png`)]);
	const mask = new THREE.Texture(img);
	g.scene.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
	models[n] = { scene: g.scene, mask };
	status.textContent = `загружено ${Object.keys(models).length} из ${names.length}`;
}));
// шторы — без масок износа; текстуры простых штор лежат рядом с glb
await Promise.all(curtainNames.map(async n => {
	const g = await loader.loadAsync(`${CURT}${n}.glb`);
	g.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.material.side = THREE.DoubleSide; } });
	models[n] = { scene: g.scene, mask: null };
}));

let seed = 1;
const placed = {};   // имя → последние габариты (для «стулья к столу», «сверху»)
// экземпляр модели лицом по face = [x, z]; свой износ на каждый экземпляр
function make(n, face) {
	const M = models[n], o = M.scene.clone(true);
	const params = randomWear(seed++ * 7919 + 13);
	if (M.mask) o.traverse(m => { if (m.isMesh && m.material.map && !m.material.transparent) m.material = makeWearMaterial(m.material, M.mask, noise, params); });
	o.rotation.y = Math.atan2(-face[0], -face[1]);
	o.updateMatrixWorld(true);
	return { o, bb: new THREE.Box3().setFromObject(o) };
}
// поставить так, чтобы центр габарита был в (cx, cz), низ — на высоте y
function put(n, { o, bb }, cx, cz, y = 0) {
	o.position.set(cx - (bb.min.x + bb.max.x) / 2, y - bb.min.y, cz - (bb.min.z + bb.max.z) / 2);
	scene.add(o); o.updateMatrixWorld(true);
	const w = new THREE.Box3().setFromObject(o);
	placed[n] = w;
	return w;
}
const SIDES = { N: { n: [0, 1], t: [1, 0], c: r => [r[0], r[1]] }, E: { n: [-1, 0], t: [0, 1], c: r => [r[2], r[1]] },
	S: { n: [0, -1], t: [-1, 0], c: r => [r[2], r[3]] }, W: { n: [1, 0], t: [0, -1], c: r => [r[0], r[3]] } };
const inset = T / 2 + 0.02;
let count = 0;
for (const p of PLAN) {
	if (p[0] === "wall") {
		const [, room, side, list, from] = p, S = SIDES[side], [cx, cz] = S.c(ROOMS[room].rect);
		let cur = from + inset;
		for (const e of list) {
			// side — боком к стене (раскладушка вдоль стены): лицо вдоль стены; gap — отступ перед предметом
			if (e.gap) cur += e.gap;
			const n = e.m || e, it = make(n, e.side ? S.t : S.n), sx = it.bb.max.x - it.bb.min.x, sz = it.bb.max.z - it.bb.min.z;
			const L = Math.abs(S.t[0]) * sx + Math.abs(S.t[1]) * sz, D = Math.abs(S.n[0]) * sx + Math.abs(S.n[1]) * sz;
			const a = cur + L / 2, d = inset + D / 2;
			put(n, it, cx + S.t[0] * a + S.n[0] * d, cz + S.t[1] * a + S.n[1] * d);
			cur += L + 0.04; count++;
		}
	} else if (p[0] === "table") {
		const [, n, x, z, face, chairs] = p;
		const tb = put(n, make(n, face), x, z); count++;
		for (const [c, side, f] of chairs) {
			// стул лицом к столу; сиденье наполовину задвинуто
			const S = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[side];
			const it = make(c, S), d = (Math.abs(S[0]) * (it.bb.max.x - it.bb.min.x) + Math.abs(S[1]) * (it.bb.max.z - it.bb.min.z)) / 2;
			const ex = side === "W" ? tb.min.x : side === "E" ? tb.max.x : tb.min.x + (tb.max.x - tb.min.x) * f;
			const ez = side === "N" ? tb.min.z : side === "S" ? tb.max.z : tb.min.z + (tb.max.z - tb.min.z) * f;
			put(c, it, ex - S[0] * d * 0.55, ez - S[1] * d * 0.55); count++;
		}
	} else if (p[0] === "front") {
		// стул перед предметом у стены (письменный стол): лицом к нему
		const [, base, c] = p, b = placed[base], it = make(c, [0, -1]);
		const d = (it.bb.max.z - it.bb.min.z) / 2;
		put(c, it, (b.min.x + b.max.x) / 2, b.max.z + d * 0.45); count++;
	} else if (p[0] === "top") {
		const [, base, n, f] = p, b = placed[base];
		put(n, make(n, [0, 1]), b.min.x + (b.max.x - b.min.x) * f, (b.min.z + b.max.z) / 2, b.max.y); count++;
	} else if (p[0] === "rad" || p[0] === "radwall") {
		// Батарея: начало модели — на полу в плоскости стены (не центр габарита):
		// ставится началом на внутреннюю грань стены, по высоте — как есть; вдоль стены —
		// по центру окна (rad) или от угла комнаты (radwall).
		const name = p[0] === "rad" ? p[2] : p[4];
		let face, wallAt, alongAt;   // нормаль, координата грани стены (по нормали), центр вдоль стены
		const it0 = { face: null };
		if (p[0] === "rad") {
			const w = windows[p[1]];
			face = w.n; wallAt = w.z + w.n[1] * T / 2; alongAt = w.x;   // окна — на стенах вдоль X
		} else {
			const [, room, side, from] = p, S = SIDES[side], [cx, cz] = S.c(ROOMS[room].rect);
			face = S.n;
			wallAt = Math.abs(S.n[1]) ? cz + S.n[1] * T / 2 : cx + S.n[0] * T / 2;
			alongAt = (Math.abs(S.t[0]) ? cx : cz) + (S.t[0] + S.t[1]) * (from + inset);   // начало, центр — ниже
			it0.start = true; it0.sign = S.t[0] + S.t[1];
		}
		const it = make(name, face), onX = Math.abs(face[1]) > 0;   // стена вдоль X?
		const lo = onX ? it.bb.min.x : it.bb.min.z, hi = onX ? it.bb.max.x : it.bb.max.z;
		const center = it0.start ? alongAt + it0.sign * (hi - lo) / 2 : alongAt;
		const shift = center - (lo + hi) / 2;
		it.o.position.set(onX ? shift : wallAt, 0, onX ? wallAt : shift);
		scene.add(it.o); it.o.updateMatrixWorld(true); count++;
		const along = onX ? 0 : 2;		// стояки — по геометрии: вершины выше 0.8 м — трубы (батарея ниже); кучки по оси вдоль стены
		if (p[0] === "rad") {
			const xs = [], v = new THREE.Vector3();
			it.o.traverse(m => { if (!m.isMesh) return; const a = m.geometry.attributes.position;
				for (let i = 0; i < a.count; i += 3) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); if (v.y > 0.85) xs.push([v.x, v.z]); } });
			xs.sort((a, b) => a[along ? 1 : 0] - b[along ? 1 : 0]);
			const risers = [];
			for (const q of xs) { const r = risers[risers.length - 1], k = along ? 1 : 0;
				if (r && q[k] - r.last < 0.04) { r.s[0] += q[0]; r.s[1] += q[1]; r.n++; r.last = q[k]; } else risers.push({ s: [q[0], q[1]], n: 1, last: q[k] }); }
			for (const r of risers) {
				const rx = r.s[0] / r.n, rz = r.s[1] / r.n;
				let y = 0;
				for (const pn of p[3]) {
					// труба — центр её габарита на ось стояка; проход через пол — от пола, остальное — стык в стык
					const pi = make(pn, face), h = pi.bb.max.y - pi.bb.min.y;
					const y0 = pn === "pipe_floor_pass" ? 0 : Math.max(y, 1.0);
					if (y0 >= H - 0.05) break;   // стояк — до потолка, не выше стены
					if (y0 + h > H) {   // последняя прямая — укоротить по потолок; фасонное — не ставить
						if (pn !== "pipe_straight_1m") break;
						pi.o.scale.y = (H - y0) / h; pi.o.updateMatrixWorld(true); pi.bb.setFromObject(pi.o);
					}
					put(pn, pi, rx, rz, y0);
					if (pn !== "pipe_floor_pass") y = y0 + h * pi.o.scale.y;
					count++;
				}
			}
		}
	} else if (p[0] === "drape") {
		const [, wi, D] = p, w = windows[wi], zf = w.z + w.n[1] * T / 2;   // внутренняя грань стены
		// ткань плотных штор — своего цвета на окно (материал ткани из glb — однотонный)
		const heavyMat = new THREE.MeshStandardMaterial({ color: D.color, roughness: 0.95, side: THREE.DoubleSide });
		const hang = (n, side, off, mat) => {
			const it = make(n, w.n);
			if (Math.sign((it.bb.min.x + it.bb.max.x) / 2) !== -side) it.o.scale.x = -1;   // полотно — к центру окна
			it.o.traverse(m => { if (m.isMesh && /fabric/i.test(m.material.name)) { m.material = mat; if (mat === tulleMat) m.castShadow = false; } });
			it.o.position.set(w.x + side * ROD, 0, zf + w.n[1] * off);
			scene.add(it.o); it.o.updateMatrixWorld(true); count++;
		};
		for (const [off, pair, mat] of [[TULLE_Z, [D.tulle, D.tulle], tulleMat], [HEAVY_Z, D.heavy, heavyMat]]) {
			hang(pair[0], -1, off, mat); hang(pair[1], 1, off, mat);
			// карниз: центр по окну, на высоте колец (2.545 м), на том же отступе
			const r = make("curtain_rail_bare", w.n), d = r.bb.max.z - r.bb.min.z;
			put("curtain_rail_bare", r, w.x, zf + w.n[1] * off, 2.545 - (r.bb.max.y - r.bb.min.y) / 2); count++;
		}	} else if (p[0] === "sill") {
		const [, i, list] = p, w = windows[i];
		list.forEach((n, k) => { put(n, make(n, [0, 1]), w.x - w.w / 2 + w.w * (k + 0.5) / list.length, w.depthZ, w.top); count++; });
	}
}
status.textContent = `${count} предметов, ${names.length} моделей, износ у каждого свой`;
console.log("[квартира] габариты, м (ш × г × в): " + names.map(n => { const s = new THREE.Box3().setFromObject(models[n].scene).getSize(new THREE.Vector3()); return `${n} ${s.x.toFixed(2)}×${s.z.toFixed(2)}×${s.y.toFixed(2)}`; }).join(", "));
console.log(`[квартира] ${count} предметов из ${names.length} моделей`);

/* ── камера: вращение вокруг точки ──────────────────────────────────── */
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
const VIEWS = { all: { t: [4.5, 0.4, 3.4], d: 12.5, yaw: 20, pitch: 55, name: "вся квартира" } };
for (const [id, R] of Object.entries(ROOMS)) {
	const [x0, z0, x1, z1] = R.rect;
	VIEWS[id] = { t: [(x0 + x1) / 2, 0.6, (z0 + z1) / 2], d: Math.max(x1 - x0, z1 - z0) * 1.15 + 1.5, yaw: 25, pitch: 50, name: R.name };
}
const cam = { t: new THREE.Vector3(), d: 10, yaw: 0, pitch: 45 };
function setView(id) {
	const v = VIEWS[id] || VIEWS.all;
	cam.t.set(...v.t); cam.d = v.d; cam.yaw = v.yaw; cam.pitch = v.pitch;
	for (const b of document.querySelectorAll("#rooms button")) b.setAttribute("aria-pressed", String(b.dataset.view === id));
}
const bar = document.getElementById("rooms");
if (q.get("clean") === "1") { document.getElementById("hud").hidden = true; bar.hidden = true; }
for (const [id, v] of Object.entries(VIEWS)) {
	const b = document.createElement("button");
	b.type = "button"; b.textContent = v.name; b.dataset.view = id;
	b.addEventListener("click", () => setView(id));
	bar.appendChild(b);
}
setView(q.get("view") || "all");

const ptrs = new Map();
let last = null;
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); last = null; });
canvas.addEventListener("pointerup", e => { ptrs.delete(e.pointerId); last = null; });
canvas.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); last = null; });
// сдвиг: мир идёт за пальцем (вправо на экране = (cos, −sin), вперёд = −(sin, cos))
function pan(dx, dy) {
	const k = cam.d * 0.0016, y = cam.yaw * Math.PI / 180;
	cam.t.x += (-Math.cos(y) * dx - Math.sin(y) * dy) * k;
	cam.t.z += (Math.sin(y) * dx - Math.cos(y) * dy) * k;
}
canvas.addEventListener("pointermove", e => {
	const p = ptrs.get(e.pointerId);
	if (!p) return;
	const dx = e.clientX - p.x, dy = e.clientY - p.y;
	p.x = e.clientX; p.y = e.clientY;
	if (ptrs.size === 1) {
		if (p.b === 2 || p.sh) pan(dx, dy);
		else { cam.yaw -= dx * 0.3; cam.pitch = Math.max(8, Math.min(88, cam.pitch + dy * 0.25)); }
	} else if (ptrs.size === 2) {
		const [a, b] = [...ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		if (last) { cam.d = Math.max(1.5, Math.min(30, cam.d * last.dist / dist)); pan(mid.x - last.mid.x, mid.y - last.mid.y); }
		last = { dist, mid };
	}
});
canvas.addEventListener("wheel", e => { e.preventDefault(); cam.d = Math.max(1.5, Math.min(30, cam.d * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });

function frame() {
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
		renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
	}
	const y = cam.yaw * Math.PI / 180, pt = cam.pitch * Math.PI / 180;
	camera.position.set(cam.t.x + Math.sin(y) * Math.cos(pt) * cam.d, cam.t.y + Math.sin(pt) * cam.d, cam.t.z + Math.cos(y) * Math.cos(pt) * cam.d);
	camera.lookAt(cam.t);
	// срез: стена между камерой и точкой взгляда — до CUT (выше — прячется)
	for (const P of wallPieces) {
		const dc = P.n[0] * camera.position.x + P.n[1] * camera.position.z - P.c, dt = P.n[0] * cam.t.x + P.n[1] * cam.t.z - P.c;
		const cut = dc * dt < 0;
		const top = cut ? Math.min(P.y1, CUT) : P.y1;
		P.b.visible = top > P.y0 + 1e-3;
		P.b.scale.y = P.b.visible ? (top - P.y0) / (P.y1 - P.y0) : 1;
		P.b.position.y = (P.y0 + top) / 2;
	}
	renderer.render(scene, camera);
	requestAnimationFrame(frame);
}
frame();
