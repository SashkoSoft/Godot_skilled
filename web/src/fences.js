import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { loadConcreteKit, makeWeatheredConcrete, prepareWallGeometry } from "./concrete_weathered.js";

// Износ бетона — набор blend (concrete_kit): 12 слоёв по весам. Базовые смеси —
// его варианты A–D (bake_fence.py MIXES); у каждой плиты своя смесь с разбросом,
// сдвиги слоёв — от позиции: одинаковых плит в заборе нет.
const KIT = "../game/assets/textures/concrete-kit/";
const MIXES = [
	[0.80, 0.30, 0.20, 0.70, 0.12, 0.40, 0.50, 0.50, 0.5, 0.00, 0.20, 0.00],   // грязная
	[0.45, 0.85, 0.45, 0.50, 0.10, 0.60, 0.30, 0.70, 0.6, 0.00, 0.10, 0.00],   // ржавая, битая
	[0.50, 0.10, 0.30, 0.90, 0.35, 0.30, 0.70, 0.30, 0.4, 0.00, 0.45, 0.00],   // сырая, мох, лишайник
	[0.25, 0.20, 0.55, 0.40, 0.05, 0.20, 0.20, 0.40, 0.5, 0.55, 0.10, 0.00],   // крашеная, облезла
];

// Заборы-модели квартала по данным district.json: у огороженного
// участка поле fence задаёт модель (коробочный забор блок-аута там не строится).
//
// ПО-2 (blend, game/assets/models/props/fence/): плита 4.0 × 2.0 м, начало — на
// земле по центру, лицо в +Z (стороны равноправны). Ставится встык с шагом 4 м вдоль краёв
// прямоугольника, лицом наружу; калитка — пропуск на месте ближайшей плиты.
// Износ A–D чередуется по хешу, часть плит чуть наклонена (1–2°), как у настоящих.
// LOD: одна геометрия (28 треуг.), ступени отличаются текстурами 2048 / 1024 / 512.

const DIR = "../game/assets/models/props/fence/";
const FENCES = {
	// scale — во сколько раз модель крупнее файла (пользователь: «в два раза больше» — плита 8×4 м)
	// ivy — варианты плюща HoudiniCOP (game/assets/models/ivy_fence/); веса — повтором в списке
	po2: { step: 8.0, scale: 2, wall: [8, 4], ivy: [0, 1, 2].flatMap(i => ["light", "light", "mid", "mid", "heavy", "dry"].map(k => `fence_ivy_ivy_${k}_${i}`)
		.concat([`fence_ivy_creeper_mid_${i}`, `fence_ivy_creeper_heavy_${i}`])), files: v => [`fence_po2_${v}_web.glb`, `fence_po2_${v}_lod1_web.glb`, `fence_po2_${v}_lod2_web.glb`], variants: ["A", "B", "C", "D"] },   // грязная, ржавая, мох, облезлая краска
};
const LOD_DIST = [25, 70];   // м

function hash(x, z) {
	const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return s - Math.floor(s);
}

/** Плиты по краям прямоугольника: [{x, z, rotY}] — лицом наружу, с пропуском под калитку. */
function panelsAround(rect, gate, step) {
	const [x0, z0, x1, z1] = rect, out = [];
	// края по часовой (Z вниз на карте); наружу — нормаль края
	const edges = [
		{ a: [x0, z0], b: [x1, z0], out: [0, -1] },
		{ a: [x1, z0], b: [x1, z1], out: [1, 0] },
		{ a: [x1, z1], b: [x0, z1], out: [0, 1] },
		{ a: [x0, z1], b: [x0, z0], out: [-1, 0] },
	];
	for (const e of edges) {
		const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
		const n = Math.max(1, Math.round(len / step));
		const s = len / n;   // плиты встык по всей длине края (на 1–2 см длиннее/короче шага — незаметно)
		const dx = (e.b[0] - e.a[0]) / len, dz = (e.b[1] - e.a[1]) / len;
		for (let i = 0; i < n; i++) {
			const x = e.a[0] + dx * s * (i + 0.5), z = e.a[1] + dz * s * (i + 0.5);
			if (gate && Math.hypot(x - gate[0], z - gate[1]) < s * 0.6) continue;   // калитка
			// +Z модели → наружу: поворот, переводящий (0, 1) в out
			out.push({ x, z, rotY: Math.atan2(e.out[0], e.out[1]), scaleX: s / step });
		}
	}
	return out;
}

// weather: false — без шейдера износа, с запечёнными вариантами A–D (проверки в headless:
// там набор износа через ImageBitmapLoader не грузится)
export async function loadFences(d, { weather = true } = {}) {
	const group = new THREE.Group();
	group.name = "Fences";
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const cache = {};
	const load = f => cache[f] ||= loader.loadAsync(DIR + f).then(g => {
		g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return g.scene;
	});
	let count = 0, kit = null;
	const ivy = [];   // плющ HoudiniCOP: [x, z, r, { tag, m }] — накладка на плиту в мировом масштабе
	for (const a of d.areas) {
		const kind = a.kind === "fenced" && a.fence && FENCES[a.fence];
		if (!kind || !a.rect) continue;
		const scenes = Object.fromEntries(await Promise.all(kind.variants.map(async v => [v, await Promise.all(kind.files(v).map(load))])));
		if (weather) kit ||= await loadConcreteKit(KIT, { half: false });
		for (const p of panelsAround(a.rect, a.gate, kind.step)) {
			const h = hash(p.x, p.z);
			const lods = scenes[kind.variants[Math.floor(h * kind.variants.length) % kind.variants.length]];
			const lod = new THREE.LOD();
			// смесь плиты: основа по хешу + разброс ±0.15 на каждый слой
			const base = MIXES[Math.floor(hash(p.x + 3.1, p.z) * MIXES.length) % MIXES.length];
			const w = base.map((v, i) => Math.min(1, Math.max(0, v + (hash(p.x + i * 7.3, p.z - i) - 0.5) * 0.3)));
			const mat = kit && makeWeatheredConcrete(kit, { wHang: w.slice(0, 4), wTile: w.slice(4, 8), wExtra: w.slice(8, 12), wallSize: kind.wall });
			lods.forEach((s, i) => {
				const c = s.clone();
				if (mat) c.traverse(o => { if (o.isMesh && o.geometry.getAttribute("uv1")) { prepareWallGeometry(o.geometry); o.material = mat; } });
				lod.addLevel(c, i ? LOD_DIST[i - 1] : 0, 0.1);
			});
			lod.position.set(p.x, 0, p.z);
			lod.rotation.y = p.rotY;
			lod.scale.set(p.scaleX * kind.scale, kind.scale, kind.scale);
			// каждая пятая плита чуть завалена (1–2°) — вдоль или поперёк
			const t = hash(p.z, p.x);
			if (t < 0.2) { lod.rotation.x = (t < 0.1 ? 1 : -1) * (1 + t * 10) * Math.PI / 180; }
			group.add(lod);
			// Плющ: ~70 % плит, вариант по хешу; стороны у плиты равноправны — иногда
			// разворот на 180°, чтобы соседние накладки не повторялись. Масштаб накладки —
			// мировой (8 × 4.24 м): от плиты берётся только поворот, место и растяжка по X.
			const hi = hash(p.x - 5.7, p.z + 2.3);
			if (kind.ivy && hi < 0.7) {
				const tag = kind.ivy[Math.floor(hash(p.x + 9.1, p.z - 4.4) * kind.ivy.length) % kind.ivy.length];
				const o = new THREE.Object3D();
				o.position.copy(lod.position); o.rotation.copy(lod.rotation);
				if (hi < 0.3) o.rotation.y += Math.PI;
				o.scale.set(p.scaleX, 1, 1); o.updateMatrix();
				ivy.push([p.x, p.z, 4, { tag, m: o.matrix.clone(), health: "healthy" }]);
			}
			count++;
		}
	}
	console.log(`[улица] заборы: плит ${count}, с плющом ${ivy.length}`);
	return { group, count, ivy };
}
