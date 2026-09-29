import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { loadWearNoise, makeWearMaterial } from "./wear_furniture.js";

// Мебель в квартирах домов hou — правилами по описанию дома (<id>.json: rooms —
// прямоугольники по осям сетки, тип, отметка пола; doors; windows).
//
// Раскладка — как на стенде квартиры (rooms.js), только без ручного плана:
//  • занятое место — габариты (Box3): проходы у дверей (0.9 м в обе комнаты), место
//    перед окном — для высокого (выше подоконника), уже поставленное;
//  • предмет «у стены» перебирает стены комнаты с шагом 0.1 м — спиной к стене,
//    первое свободное место; стол — у середины комнаты, стулья — к его сторонам;
//  • набор — по типу и площади комнаты, варианты — по семени квартиры: соседние
//    квартиры обставлены по-разному, одна квартира — в одном вкусе.
// Рисуется экземплярами: InstancedMesh на деталь модели (вызов на деталь, не на
// предмет — в башне их тысячи). Модели — ступень LOD1 blend (атлас 512), тени не
// кладут (солнце в квартиру почти не попадает), износ — общий на дом.
// Строится лениво: когда камера подходит к дому ближе NEAR м; дальше FAR — прячется.

const FURN = "../game/assets/models/furniture/";
const CLUT = "../game/assets/models/clutter/";   // разбросанные вещи blend: «clutter:<имя>» в плане

// Хлам после мародёров (вещи blend, низ на полу, пивот в центре опоры):
//  • перед шкафами, стенками, сервантами — веером вывернутое содержимое;
//  • у кроватей — тапки, раскрытая книга, будильник, чашка;
//  • на низкой мебели (комод, сервант, стол) — 1–2 вещи сверху;
//  • по комнате — немного вразброс, по типу комнаты (кухня — посуда, прихожая — обувь).
// Вещь не пересекает мебель, проходы у дверей и другие вещи; в руине хлама больше.
// Плотность — #clutter (1 по умолчанию, 0 — без хлама).
const CLUTTER = {
	storage: ["book_closed", "book_open", "book_stack", "newspaper", "magazine_pile", "box_open", "drawer_floor_empty", "drawer_floor_full",
		"photo_frame", "vinyl_records", "casket", "suitcase", "iron", "slippers", "cable_coil"],
	bed: ["slippers", "book_open", "magazine_pile", "alarm_clock", "cup", "newspaper", "photo_frame", "bottle", "tablet_broken"],
	top: ["alarm_clock", "radio", "phone_rotary", "photo_frame", "cup", "book_closed", "jar", "flower_pot_dead", "casket", "battery_lamp", "ar_glasses"],
	kitchen: ["plate", "plate_broken", "cup", "pot", "kettle", "frying_pan", "jar", "jar_3l", "can_open", "bottle", "bucket", "box_soggy"],
	room: ["book_closed", "newspaper", "newspaper_bundle", "vinyl_records", "radio", "tv_portable", "flower_pot_dead", "magazine_pile", "bottle",
		"box_closed", "box_crushed_top", "box_crushed_side", "box_flattened", "box_torn_flap", "box_crushed_open", "toy_blocks", "ball", "cable_bundle", "drone_debris", "robot_arm", "robot_head"],
	hall: ["boots", "slippers", "suitcase", "box_closed", "box_crushed_side", "box_flattened", "newspaper_bundle", "bucket"],
	bath: ["bucket", "bottle", "jar"],
};
const STORAGE = /wardrobe|stenka|sideboard|bookcase|dresser|hall_shoe/, BED = /^bed_/;

// Лут: мебель, которую роботы (и потом игрок) открывают и обыскивают. Тип — какой клип
// робота: шкаф (дверца на высоте 1 м), ящик (0.36 м), нижняя дверца (0.38 м).
const LOOT = [
	[/wardrobe|stenka|sideboard_tall|bookcase_glass_doors/, "cabinet"],
	[/dresser|desk_pedestal|desk_side_cabinet|desk_drawers/, "drawer"],
	[/^sideboard$|sideboard_bar|sink_cabinet|hall_shoe_bench|nightstand/, "lowdoor"],
];
// что лежит (тест): золото редко, серебро чаще, бронза чаще всего, остальное — пусто
const LOOT_ROLL = [["gold", 0.05], ["silver", 0.2], ["bronze", 0.45]];
const rollItem = r => { let x = r(); for (const [k, p] of LOOT_ROLL) { if (x < p) return k; x -= p; } return null; };
const USE_D = 0.55;   // от лица мебели до Root робота — ручка на 0.55 м впереди (клипы blend)
const CELL = 0.2, BODY = 0.32;   // сетка проходимости комнаты и радиус робота

/** Сетка комнаты: свободна ли клетка (мебель, раздутая на радиус робота, и стены — заняты). */
function roomGrid(rect, obst) {
	const [x0, z0, x1, z1] = rect, W = Math.max(1, Math.ceil((x1 - x0) / CELL)), H = Math.max(1, Math.ceil((z1 - z0) / CELL));
	const free = new Uint8Array(W * H);
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL;
		if (x < x0 + BODY || x > x1 - BODY || z < z0 + BODY || z > z1 - BODY) continue;
		if (obst.some(b => x > b.min.x - BODY && x < b.max.x + BODY && z > b.min.z - BODY && z < b.max.z + BODY)) continue;
		free[j * W + i] = 1;
	}
	return { x0, z0, W, H, free };
}
const cellOf = (G, x, z) => [Math.floor((x - G.x0) / CELL), Math.floor((z - G.z0) / CELL)];
const isFree = (G, i, j) => i >= 0 && j >= 0 && i < G.W && j < G.H && G.free[j * G.W + i] === 1;
/** Путь по сетке от (ax, az) до (bx, bz): точки-повороты [x, z] или null, если не дойти. */
function gridPath(G, ax, az, bx, bz) {
	// старт — ближайшая свободная клетка (точка входа бывает у самой стены)
	let [si, sj] = cellOf(G, ax, az);
	if (!isFree(G, si, sj)) {
		let best = null, bd = 1e9;
		for (let j = 0; j < G.H; j++) for (let i = 0; i < G.W; i++) if (G.free[j * G.W + i]) { const d = (i - si) ** 2 + (j - sj) ** 2; if (d < bd) { bd = d; best = [i, j]; } }
		if (!best || bd > 16) return null;
		[si, sj] = best;
	}
	const [ti, tj] = cellOf(G, bx, bz);
	if (!isFree(G, ti, tj)) return null;
	const prev = new Int32Array(G.W * G.H).fill(-2), q = [sj * G.W + si];
	prev[q[0]] = -1;
	for (let h = 0; h < q.length; h++) {
		const c = q[h], ci = c % G.W, cj = (c / G.W) | 0;
		if (ci === ti && cj === tj) break;
		for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
			const ni = ci + di, nj = cj + dj;
			if (!isFree(G, ni, nj) || (di && dj && (!isFree(G, ci + di, cj) || !isFree(G, ci, cj + dj)))) continue;
			const n = nj * G.W + ni;
			if (prev[n] !== -2) continue;
			prev[n] = c; q.push(n);
		}
	}
	const end = tj * G.W + ti;
	if (prev[end] === -2) return null;
	const cells = [];
	for (let c = end; c !== -1; c = prev[c]) cells.unshift([G.x0 + (c % G.W + 0.5) * CELL, G.z0 + (((c / G.W) | 0) + 0.5) * CELL]);
	// спрямление: из точки — сразу в самую дальнюю видимую по свободным клеткам
	const sees = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1); for (let k = 1; k < n; k++) { const [i, j] = cellOf(G, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (!isFree(G, i, j)) return false; } return true; };
	const out = [cells[0]];
	for (let k = 0; k < cells.length - 1;) {
		let far = k + 1;
		for (let m = cells.length - 1; m > k + 1; m--) if (sees(cells[k], cells[m])) { far = m; break; }
		out.push(cells[far]); k = far;
	}
	out[out.length - 1] = [bx, bz];
	return out;
}
const TOP = /^(sideboard|dresser|desk_|table_|hall_shoe_bench)/;   // на что можно положить сверху (низкое)
const NEAR = 70, FAR = 110;
const INSET_IN = 0.08, INSET_OUT = 0.33;   // от оси сетки до грани: внутренняя стена, наружная

// наборы по типу комнаты; [модели на выбор] — один из них по семени
const SETS = {
	bedroom: [
		{ wall: [["bed_double", "bed_polished", "bed_pine_metal", "bed_metal"]] },
		{ wall: [["wardrobe_legs", "wardrobe_mirror", "wardrobe_3door", "wardrobe_50s_glass"]] },
		{ wall: [["desk_legs", "desk_school", "table_book_closed", "sideboard", null]], chair: ["chair_bent", "chair_vienna", "chair_ladder"] },
		{ wall: [["floor_lamp_classic", "floor_lamp_duo", null, null]] },
		{ wall: [["nightstand"]] },
		{ wall: [["dresser_70s", null]] },
	],
	living: [
		{ wall: [["sofa_book_check", "sofa_book_floral", "sofa_book_red", "sofa_cushions_red", "sofa_tahta"]] },
		{ wall: [["stenka_red", "stenka_amber", "stenka_long", "stenka_glass", "sideboard_tall", "sideboard_bar"]] },
		{ table: ["table_round", "table_extending", "table_book"], chairs: ["chair_vienna", "chair_spindle", "chair_ladder", "chair_leather", "chair_bent"] },
		{ wall: [["armchair_box", "armchair_shell", "bookcase_glass", "bookcase_60s", null]] },
		{ wall: [["floor_lamp_classic", "floor_lamp_duo", null]] },
	],
	kitchen: [
		{ wall: [["stove_gas"]] },
		{ wall: [["sink_cabinet", "sink_backsplash"]] },
		{ table: ["table_kitchen"], chairs: ["stool_cream", "stool_green", "stool_marble"] },
		{ wall: [["sideboard", "sideboard_tall", null]] },
	],
	hall: [
		{ wall: [["hall_stand", "hall_hanger_panels", "hall_shelf_hooks"]], keepY: true },
		{ wall: [["hall_shoe_bench", null]], keepY: true },
	],
	bath: [
		{ wall: [["bath_cast", "bath_legs"]] },
		{ wall: [["sink_pedestal", "sink_wall_rect"]] },
	],
};
const TYPE = { zhilaya: "room", kuhnya: "kitchen", prihozhaya: "hall", sanuzel: "bath" };

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Габарит модели, повёрнутой лицом (−Z модели) в сторону face, на полу, центром в 0. */
function footprint(M, face) {
	const b = M.box, rot = Math.round(Math.atan2(-face[0], -face[1]) / (Math.PI / 2)) & 3;
	const swap = rot & 1, sx = swap ? b.max.z - b.min.z : b.max.x - b.min.x, sz = swap ? b.max.x - b.min.x : b.max.z - b.min.z;
	return { sx, sz, h: b.max.y - b.min.y, minY: b.min.y, rotY: Math.atan2(-face[0], -face[1]) };
}

export function createInteriors(scene, { wear = 0.5, clutter = 1 } = {}) {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const bmp = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
	const models = {};   // имя → промис { parts: [{geo, mat, rel}], box }
	let noiseP = null;
	const wearP = { wear, dust: wear * 0.45, grime: wear * 0.8, value: 1, warm: 0.1, sat: 1, noiseOffset: [0.2, 0.6] };
	function model(n) {
		return models[n] ||= (async () => {
			noiseP ||= loadWearNoise(`${FURN}textures/wear_noise.png`);
			const cl = n.startsWith("clutter:"), m = cl ? n.slice(8) : n;
			const [g, img, noise] = await Promise.all([loader.loadAsync(cl ? `${CLUT}${m}_lod1_web.glb` : `${FURN}${m}_lod1_web.glb`),
				bmp.loadAsync(cl ? `${CLUT}masks/clutter_${m}_lod1_mask.png` : `${FURN}textures/baked/lod/${m}_lod1_mask_256.png`).catch(() => null), noiseP]);
			const mask = img ? new THREE.Texture(img) : null;
			g.scene.updateMatrixWorld(true);
			const parts = [];
			g.scene.traverse(o => {
				if (!o.isMesh) return;
				let mat = o.material;
				if (mask && mat.map && !mat.transparent) mat = makeWearMaterial(mat, mask, noise, wearP);
				let a = o;
				while (a && a !== g.scene && !(a.userData && a.userData.part)) a = a.parent;
				const e = a && a !== g.scene ? a.userData : null;
				const anim = e && ["door", "drawer", "flap", "slide"].includes(e.part) ? {
					node: a.name, part: e.part, swing: e.swing || 1, rad: (e.max_deg || 90) * Math.PI / 180,
					axis: e.axis, travel: e.travel_m || 0, axisRot: e.axis_rot || [1, 0, 0],
					hinge: e.hinge_pos || a.getWorldPosition(new THREE.Vector3()).toArray(), pivot: a.getWorldPosition(new THREE.Vector3()).toArray(),
					handleY: e.handle_pos ? e.handle_pos[1] : a.getWorldPosition(new THREE.Vector3()).y,
				} : null;
				parts.push({ geo: o.geometry, mat, rel: o.matrixWorld.clone(), anim });
			});
			return { parts, box: new THREE.Box3().setFromObject(g.scene) };
		})();
	}

	const houses = [];
	/** Дом hou с описанием: b — запись district.json, info — <id>.json. rooms — фильтр (руина). */
	function addHouse(b, info, { roomFilter = null } = {}) {
		const r = b.rect;
		houses.push({ b, info, roomFilter, center: new THREE.Vector3((r[0] + r[2]) / 2, 10, (r[1] + r[3]) / 2), built: null, group: null });
	}

	async function build(H) {
		const { info, b } = H, R = b.rect;
		const byId = Object.fromEntries(info.rooms.map(x => [x.id, x]));
		const plan = [];   // { n, x, y, z, rotY }
		H.loot = [];   // комнаты с местами для лута: { rect, y, G — сетка проходимости, spots }
		// проходы у дверей — занятое место в обеих комнатах
		const doorBoxes = {};
		for (const d of info.doors) for (const rid of d.rooms) {
			const rm = byId[rid]; if (!rm) continue;
			const [x0, z0, x1, z1] = rectOf(rm), [px, , pz] = d.pos, hw = d.width / 2 + 0.05, dd = 0.9;
			const alongX = Math.abs(pz - z0) < 0.1 || Math.abs(pz - z1) < 0.1;   // дверь в стене вдоль X
			(doorBoxes[rid] ||= []).push(new THREE.Box3(new THREE.Vector3(px - (alongX ? hw : dd), -1, pz - (alongX ? dd : hw)), new THREE.Vector3(px + (alongX ? hw : dd), 3, pz + (alongX ? dd : hw))));
		}
		const winByFloor = {};
		for (const w of info.windows) (winByFloor[w.floor] ||= []).push(w);
		const apSeed = {};
		for (const rm of info.rooms) {
			const type = TYPE[rm.type];
			if (!type || (H.roomFilter && !H.roomFilter(rm))) continue;
			const [gx0, gz0, gx1, gz1] = rectOf(rm);
			// грань комнаты: наружная стена толще
			const ins = (v, edge) => Math.abs(v - edge) < 0.05 ? INSET_OUT : INSET_IN;
			const x0 = gx0 + ins(gx0, R[0]), x1 = gx1 - ins(gx1, R[2]), z0 = gz0 + ins(gz0, R[1]), z1 = gz1 - ins(gz1, R[3]);
			if (x1 - x0 < 0.8 || z1 - z0 < 0.8) continue;
			const y = rm.y, area = (x1 - x0) * (z1 - z0);
			const ap = rm.apartment || rm.id, rnd = rng(hashStr(rm.id));
			const apR = apSeed[ap] ||= rng(hashStr(ap))();   // вкус квартиры: один на все её комнаты
			const pickOf = list => list[Math.floor(((apR * 7.31 + rnd() * 0.5) % 1) * list.length)];
			const occ = [...(doorBoxes[rm.id] || [])];
			// окна комнаты: перед окном нельзя высокое
			const tall = [];
			for (const w of winByFloor[rm.floor] || []) {
				const [wx, , wz] = w.pos;
				if (wx < gx0 - 0.4 || wx > gx1 + 0.4 || wz < gz0 - 0.4 || wz > gz1 + 0.4) continue;
				const hw = w.width / 2 + 0.15, alongX = w.normal ? Math.abs(w.normal[2]) > 0.5
					: Math.min(Math.abs(wz - gz0), Math.abs(wz - gz1)) < Math.min(Math.abs(wx - gx0), Math.abs(wx - gx1));   // старые дома (b1, b5, b6): нормали нет — по ближней стене
				tall.push(new THREE.Box3(new THREE.Vector3(wx - (alongX ? hw : 0.6), -1, wz - (alongX ? 0.6 : hw)), new THREE.Vector3(wx + (alongX ? hw : 0.6), 3, wz + (alongX ? 0.6 : hw))));
			}
			const hit = (bx, isTall) => {
				const s = bx.clone().expandByScalar(-0.02);
				return occ.some(o => o.intersectsBox(s)) || (isTall && tall.some(o => o.intersectsBox(s)));
			};
			const inside = bx => bx.min.x >= x0 - 0.01 && bx.max.x <= x1 + 0.01 && bx.min.z >= z0 - 0.01 && bx.max.z <= z1 + 0.01;
			const kind = type === "room" ? (area < 13 || rnd() < 0.35 ? "bedroom" : "living") : type;
			const placed = [], planStart = plan.length;   // поставленная мебель комнаты: { n, bx, face } — у неё ляжет хлам
			const put = (n, fp, cx, cz, dy = 0, face = null) => {
				const bx = new THREE.Box3(new THREE.Vector3(cx - fp.sx / 2, y, cz - fp.sz / 2), new THREE.Vector3(cx + fp.sx / 2, y + fp.h, cz + fp.sz / 2));
				const entry = { n, x: cx, y: y + dy, z: cz, rotY: fp.rotY, box: bx };
				occ.push(bx); plan.push(entry); placed.push({ n, bx, face, entry }); return bx;
			};
			// у стены: стороны в случайном порядке, шаг 0.1 м
			const SIDES = [[0, 1, "N"], [0, -1, "S"], [1, 0, "W"], [-1, 0, "E"]];   // лицо в комнату
			const atWall = async (n, keepY) => {
				const M = await model(n);
				const order = SIDES.map(s => [s, rnd()]).sort((a, c) => a[1] - c[1]).map(a => a[0]);
				for (const [fx, fz] of order) {
					const fp = footprint(M, [fx, fz]);
					const dy = keepY ? 0 : -fp.minY;
					const alongX = fx === 0, L = alongX ? fp.sx : fp.sz, D = alongX ? fp.sz : fp.sx;
					const len = alongX ? x1 - x0 : z1 - z0;
					for (let s = 0; s + L <= len + 1e-6; s += 0.1) {
						const cx = alongX ? x0 + s + L / 2 : (fx > 0 ? x0 + D / 2 : x1 - D / 2);
						const cz = alongX ? (fz > 0 ? z0 + D / 2 : z1 - D / 2) : z0 + s + L / 2;
						const bx = new THREE.Box3(new THREE.Vector3(cx - fp.sx / 2, y, cz - fp.sz / 2), new THREE.Vector3(cx + fp.sx / 2, y + fp.h, cz + fp.sz / 2));
						if (!inside(bx) || hit(bx, fp.h > 1.0)) continue;
						return { bx: put(n, fp, cx, cz, dy, [fx, fz]), face: [fx, fz] };
					}
				}
				return null;
			};
			for (const item of SETS[kind] || []) {
				if (item.wall) {
					const n = pickOf(item.wall[0]);
					if (!n) continue;
					const got = await atWall(n, item.keepY);
					if (got && item.chair) {   // стул перед столом у стены
						const c = pickOf(item.chair), CM = await model(c), f = got.face, fp = footprint(CM, [-f[0], -f[1]]);
						const cx = f[0] ? (f[0] > 0 ? got.bx.max.x + fp.sx * 0.25 : got.bx.min.x - fp.sx * 0.25) : (got.bx.min.x + got.bx.max.x) / 2;
						const cz = f[1] ? (f[1] > 0 ? got.bx.max.z + fp.sz * 0.25 : got.bx.min.z - fp.sz * 0.25) : (got.bx.min.z + got.bx.max.z) / 2;
						put(c, fp, cx, cz, -fp.minY);
					}
				} else if (item.table) {
					const n = pickOf(item.table), M = await model(n), fp = footprint(M, [0, 1]);
					// у середины комнаты; не влез — чуть в сторону
					let bx = null;
					for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.6, 0.6], [-0.6, -0.6]]) {
						const cx = (x0 + x1) / 2 + ox, cz = (z0 + z1) / 2 + oz;
						const t = new THREE.Box3(new THREE.Vector3(cx - fp.sx / 2 - 0.45, y, cz - fp.sz / 2 - 0.45), new THREE.Vector3(cx + fp.sx / 2 + 0.45, y + fp.h, cz + fp.sz / 2 + 0.45));
						if (!inside(t) || hit(t, false)) continue;
						bx = put(n, fp, cx, cz, -fp.minY); break;
					}
					if (!bx) continue;
					const c = pickOf(item.chairs), CM = await model(c), k = 2 + Math.floor(rnd() * 3);
					const spots = [[0, 1], [0, -1], [1, 0], [-1, 0]].slice(0, k);
					for (const [sx, sz] of spots) {   // стул лицом к столу, наполовину задвинут
						const fp2 = footprint(CM, [-sx, -sz]);
						const cx = sx ? (sx > 0 ? bx.max.x + fp2.sx * 0.1 : bx.min.x - fp2.sx * 0.1) : (bx.min.x + bx.max.x) / 2;
						const cz = sz ? (sz > 0 ? bx.max.z + fp2.sz * 0.1 : bx.min.z - fp2.sz * 0.1) : (bx.min.z + bx.max.z) / 2;
						const cb = new THREE.Box3(new THREE.Vector3(cx - fp2.sx / 2, y, cz - fp2.sz / 2), new THREE.Vector3(cx + fp2.sx / 2, y + fp2.h, cz + fp2.sz / 2));
						plan.push({ n: c, x: cx, y: y - fp2.minY, z: cz, rotY: fp2.rotY, box: cb });
					}
				}
			}
			// места для лута: встать перед мебелью можно и дойти туда от двери — проверено сеткой
			const obst = plan.slice(planStart).filter(p => p.box).map(p => p.box);
			const G = roomGrid([x0, z0, x1, z1], obst), spots = [];
			for (const P of placed) {
				const L = LOOT.find(([re]) => re.test(P.n));
				if (!L || !P.face) continue;
				const f = P.face, bx = P.bx, cx = (bx.min.x + bx.max.x) / 2, cz = (bx.min.z + bx.max.z) / 2;
				const ux = f[0] ? (f[0] > 0 ? bx.max.x : bx.min.x) + f[0] * USE_D : cx, uz = f[1] ? (f[1] > 0 ? bx.max.z : bx.min.z) + f[1] * USE_D : cz;
				const [ui, uj] = cellOf(G, ux, uz);
				if (!isFree(G, ui, uj)) continue;   // перед мебелью не встать — не лут
				// какую деталь открывать: дверцу или ящик на высоте руки клипа (шкаф 1.0, тумбочка 0.38, ящик 0.36)
				const M = await model(P.n), want = L[1] === "drawer" ? ["drawer", 0.36] : ["door", L[1] === "cabinet" ? 1.0 : 0.38];
				let node = null, nd = 1e9;
				for (const pt of M.parts) if (pt.anim && (pt.anim.part === want[0] || (want[0] === "door" && pt.anim.part === "flap"))) {
					const d = Math.abs(pt.anim.handleY - want[1]); if (d < nd) { nd = d; node = pt.anim.node; }
				}
				spots.push({ kind: L[1], n: P.n, use: [ux, uz], y, heading: Math.atan2(-f[0], -f[1]), looted: false, busy: false,
					item: rollItem(rnd), at: [cx, Math.min(bx.max.y, y + 1.3), cz], entry: P.entry, node, open: null,
					// кадры клипа: рука на ручке → дверца/ящик открыты (robot_clip_extras blend)
					openT: L[1] === "cabinet" ? [0.667, 1.958] : L[1] === "drawer" ? [1.792, 2.333] : [1.458, 2.542] });
			}
			if (spots.length) H.loot.push({ rect: [gx0, gz0, gx1, gz1], y, G, spots, room: rm.id });
			if (clutter > 0) await scatter(rm, kind, placed, occ, inside, y, rnd, (info.kind === "ruin" ? 1.6 : 1) * clutter, plan);
		}
		// экземпляры: по детали модели на всё здание
		const group = new THREE.Group(); group.name = "Interior-" + b.id;
		const byModel = {};
		for (const p of plan) (byModel[p.n] ||= []).push(p);
		const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
		let calls = 0;
		for (const [n, list] of Object.entries(byModel)) {
			const M = await model(n);
			list.forEach((p, i) => { p.inst = i; p.ims = []; });
			for (const part of M.parts) {
				const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
				if (part.anim) list.forEach(p => p.ims.push({ im, part }));
				list.forEach((p, i) => {
					q.setFromAxisAngle(up, p.rotY);
					m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, one).multiply(part.rel);
					im.setMatrixAt(i, m4);
				});
				im.castShadow = false; im.receiveShadow = true;
				im.computeBoundingSphere();   // отсечение — по дому целиком
				group.add(im); calls++;
			}
		}
		scene.add(group);
		// открывание дверцы/ящика экземпляра: k 0…1 (0 — закрыто)
		for (const R of H.loot) for (const s of R.spots) s.open = k => openPart(s, k);
		// коробки предметов — в столкновения игрока (низкое, ниже шага, капсула и так не задевает)
		H.boxes = plan.map(p => p.box).filter(Boolean);
		console.log(`[улица] мебель ${b.id}: предметов ${plan.length}, моделей ${Object.keys(byModel).length}, вызовов ${calls}`);
		return group;
	}

	let building = null;
	function update(camera) {
		for (const H of houses) {
			const d = H.center.distanceTo(camera.position);
			// строится сразу во всех домах (лут для роботов — везде), по одному дому за раз; виден — ближе FAR
			if (!H.built && !building) {
				H.built = building = build(H).then(g => { H.group = g; g.visible = H.center.distanceTo(camera.position) < FAR; })
					.catch(e => console.error("[улица] мебель", H.b.id, e)).finally(() => { building = null; });
			}
			if (H.group) H.group.visible = d < FAR;
		}
	}
	/** Хлам в комнате: у шкафов, у кроватей, сверху на низкой мебели и вразброс. */
	async function scatter(rm, kind, placed, occ, inside, y, rnd, k, plan) {
		const items = [];   // габариты уже брошенных вещей
		const pick = list => list[Math.floor(rnd() * list.length)];
		const fits = bx => {
			const s = bx.clone().expandByScalar(-0.01);
			return inside(bx) && !occ.some(o => o.intersectsBox(s)) && !items.some(o => o.intersectsBox(s));
		};
		// бросить вещь n около точки (cx, cz) с разбросом r; на высоте y0 (пол или верх мебели)
		const drop = async (n, cx, cz, r, y0 = y, onTop = null) => {
			const M = await model("clutter:" + n), b = M.box, rot = rnd() * Math.PI * 2;
			const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
			const sx = (b.max.x - b.min.x) * c + (b.max.z - b.min.z) * s, sz = (b.max.x - b.min.x) * s + (b.max.z - b.min.z) * c;
			for (let tries = 0; tries < 6; tries++) {
				const a = rnd() * Math.PI * 2, d = r * Math.sqrt(rnd());
				const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
				const bx = new THREE.Box3(new THREE.Vector3(x - sx / 2, y0, z - sz / 2), new THREE.Vector3(x + sx / 2, y0 + (b.max.y - b.min.y), z + sz / 2));
				if (onTop) { if (bx.min.x < onTop.min.x || bx.max.x > onTop.max.x || bx.min.z < onTop.min.z || bx.max.z > onTop.max.z || items.some(o => o.intersectsBox(bx))) continue; }
				else if (!fits(bx)) continue;
				items.push(bx);
				plan.push({ n: "clutter:" + n, x, y: y0 - b.min.y, z, rotY: rot });
				return true;
			}
			return false;
		};
		const count = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * k);
		for (const P of placed) {
			const { bx } = P, cx = (bx.min.x + bx.max.x) / 2, cz = (bx.min.z + bx.max.z) / 2;
			const f = P.face || [0, 0], half = Math.max(bx.max.x - bx.min.x, bx.max.z - bx.min.z) / 2;
			if (STORAGE.test(P.n)) {
				// перед шкафом веером: центр — на 0.6 м от лица, разброс по ширине шкафа
				const fx = f[0] ? (f[0] > 0 ? bx.max.x : bx.min.x) + f[0] * 0.6 : cx, fz = f[1] ? (f[1] > 0 ? bx.max.z : bx.min.z) + f[1] * 0.6 : cz;
				for (let i = count(2, 6); i > 0; i--) await drop(pick(CLUTTER.storage), fx, fz, Math.max(0.6, half));
			} else if (BED.test(P.n)) {
				for (let i = count(1, 3); i > 0; i--) await drop(pick(CLUTTER.bed), cx, cz, half + 0.7);
			}
			if (TOP.test(P.n) && bx.max.y - y < 1.2) {
				for (let i = count(0, 2); i > 0; i--) await drop(pick(CLUTTER.top), cx, cz, half, bx.max.y, bx);
			}
		}
		// вразброс по комнате
		const [x0, z0, x1, z1] = rectOf(rm), list = CLUTTER[kind === "bedroom" || kind === "living" ? "room" : kind] || CLUTTER.room;
		for (let i = count(1, 4); i > 0; i--) await drop(pick(list), x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0), 0.5);
	}

	/**
	 * Лут рядом с точкой p (робот вошёл в комнату): свободное место в той же комнате и путь
	 * к нему по сетке. Место бронируется (busy), пока робот не закончит; looted — обыскано.
	 */
	function lootAt(p, rand = Math.random) {
		for (const H of houses) for (const R of H.loot || []) {
			if (Math.abs(p.y - R.y) > 0.5 || p.x < R.rect[0] - 0.2 || p.x > R.rect[2] + 0.2 || p.z < R.rect[1] - 0.2 || p.z > R.rect[3] + 0.2) continue;
			const free = R.spots.filter(s => !s.looted && !s.busy);
			if (!free.length) return null;
			const s = free[Math.floor(rand() * free.length)];
			const pts = gridPath(R.G, p.x, p.z, s.use[0], s.use[1]);
			if (!pts) return null;
			s.busy = true;
			return { spot: s, pts, y: R.y };
		}
		return null;
	}
	const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
	function openPart(s, k) {
		const e = s.entry;
		if (!e || !e.ims || !s.node) return;
		_b.compose(_v.set(e.x, e.y, e.z), _q.setFromAxisAngle(_up, e.rotY), _one);
		for (const { im, part } of e.ims) {
			const A = part.anim;
			if (A.node !== s.node) continue;
			if (A.part === "door") _m.makeTranslation(...A.hinge).multiply(_r.makeRotationY(A.swing * A.rad * k)).multiply(_t.makeTranslation(-A.hinge[0], -A.hinge[1], -A.hinge[2]));
			else if (A.part === "flap") _m.makeTranslation(...A.pivot).multiply(_r.makeRotationAxis(_v.set(...A.axisRot).normalize(), A.swing * A.rad * k)).multiply(_t.makeTranslation(-A.pivot[0], -A.pivot[1], -A.pivot[2]));
			else _m.makeTranslation(A.axis[0] * A.travel * k, A.axis[1] * A.travel * k, A.axis[2] * A.travel * k);
			_m.premultiply(_b).multiply(part.rel);
			im.setMatrixAt(e.inst, _m);
			im.instanceMatrix.needsUpdate = true;
		}
	}
	/** Все места лута в построенных домах (карта лута). */
	const lootSpots = () => houses.flatMap(H => (H.loot || []).flatMap(R => R.spots));
	/** Ближайшее к p свободное место, у которого можно встать (герой): до 1.1 м от точки «встать». */
	function lootNear(p) {
		let best = null, bd = 1.1;
		for (const s of lootSpots()) {
			if (s.looted || s.busy || Math.abs(p.y - s.y) > 0.6) continue;
			const d = Math.hypot(p.x - s.use[0], p.z - s.use[1]);
			if (d < bd) { bd = d; best = s; }
		}
		return best;
	}
	/** Забрать содержимое места: вернуть вид лута (или null — пусто), место — обыскано. */
	function take(s) { const it = s.item; s.item = null; s.looted = true; s.busy = false; return it; }
	/** Сколько мест для лута и сколько обыскано (подпись, проверки). */
	const lootStats = () => { let n = 0, done = 0; for (const H of houses) for (const R of H.loot || []) for (const s of R.spots) { n++; if (s.looted) done++; } return { n, done }; };

	/** Коробки расставленной мебели во всех построенных домах (мир). */
	const boxes = () => houses.flatMap(H => H.boxes || []);
	return { addHouse, update, boxes, lootAt, lootStats, lootSpots, lootNear, take };
}

function rectOf(rm) {
	const xs = rm.polygon_xz.map(p => p[0]), zs = rm.polygon_xz.map(p => p[1]);
	return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
