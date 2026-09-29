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
	kitchen: ["plate", "plate_broken", "cup", "pot", "kettle", "frying_pan", "jar", "jar_3l", "can_open", "bottle", "bucket", "box_crushed"],
	room: ["book_closed", "newspaper", "newspaper_bundle", "vinyl_records", "radio", "tv_portable", "flower_pot_dead", "magazine_pile", "bottle",
		"box_closed", "box_crushed", "toy_blocks", "ball", "cable_bundle", "drone_debris", "robot_arm", "robot_head"],
	hall: ["boots", "slippers", "suitcase", "box_closed", "box_crushed", "newspaper_bundle", "bucket"],
	bath: ["bucket", "bottle", "jar"],
};
const STORAGE = /wardrobe|stenka|sideboard|bookcase|dresser|hall_shoe/, BED = /^bed_/;
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
				parts.push({ geo: o.geometry, mat, rel: o.matrixWorld.clone() });
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
			const placed = [];   // поставленная мебель комнаты: { n, bx, face } — у неё ляжет хлам
			const put = (n, fp, cx, cz, dy = 0, face = null) => {
				const bx = new THREE.Box3(new THREE.Vector3(cx - fp.sx / 2, y, cz - fp.sz / 2), new THREE.Vector3(cx + fp.sx / 2, y + fp.h, cz + fp.sz / 2));
				occ.push(bx); plan.push({ n, x: cx, y: y + dy, z: cz, rotY: fp.rotY, box: bx }); placed.push({ n, bx, face }); return bx;
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
			for (const part of M.parts) {
				const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
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
		// коробки предметов — в столкновения игрока (низкое, ниже шага, капсула и так не задевает)
		H.boxes = plan.map(p => p.box).filter(Boolean);
		console.log(`[улица] мебель ${b.id}: предметов ${plan.length}, моделей ${Object.keys(byModel).length}, вызовов ${calls}`);
		return group;
	}

	function update(camera) {
		for (const H of houses) {
			const d = H.center.distanceTo(camera.position);
			if (!H.built && d < NEAR) H.built = build(H).then(g => (H.group = g)).catch(e => console.error("[улица] мебель", H.b.id, e));
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

	/** Коробки расставленной мебели во всех построенных домах (мир). */
	const boxes = () => houses.flatMap(H => H.boxes || []);
	return { addHouse, update, boxes };
}

function rectOf(rm) {
	const xs = rm.polygon_xz.map(p => p[0]), zs = rm.polygon_xz.map(p => p[1]);
	return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
