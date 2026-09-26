import * as THREE from "three";
import { rectsOf, streetRect, areaById, treePositions, trashPiles, accessPaths } from "./district.js";
import { houseTiles, boxify } from "./facades.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Статичные коробки блок-аута (дороги, тротуары, площадки, заборы…) — сотни
// отрисовок. Сливаются в один меш на материал; здания (свои группы — их прячет
// кнопка «дома»), экземпляры и всё с userData — не трогаются.
function mergeStatic(g) {
	const byMat = new Map(), gone = [];
	for (const o of g.children) {
		if (!o.isMesh || o.isInstancedMesh || Object.keys(o.userData).length) continue;
		o.updateMatrix();
		const geo = o.geometry.clone().applyMatrix4(o.matrix);
		for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
		const key = o.material.uuid + (o.castShadow ? "s" : "");
		if (!byMat.has(key)) byMat.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
		byMat.get(key).geos.push(geo.index ? geo.toNonIndexed() : geo);
		gone.push(o);
	}
	for (const o of gone) g.remove(o);
	for (const { mat, cast, geos } of byMat.values()) {
		const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
		m.castShadow = cast; m.receiveShadow = true;
		g.add(m);
	}
	return { before: gone.length, after: byMat.size };
}

// Квартал габаритными коробками (блок-аут) по game/district.json. Каждая вещь —
// её bounding box в метрах: так проверяются масштаб, расстояния и то, что
// откуда видно, до того как заказывать хоть одну модель. Цвет — по роли.

const FLOOR_H = 3.0;     // как в building.gd
const KERB_H = 0.14;
// Скругление углов тротуара на перекрёстках — радиус по лицу бордюра, как у дугового
// камня БР R3 (curbs.js). Тротуары укорочены на R, угол — сектор круга, асфальт
// заворачивает под ним.
export const CORNER_R = 3.0;
/** Углы перекрёстков: центр скругления C и знаки квадранта (sx, sz). */
export function streetCorners(d) {
	const out = [];
	for (const a of d.streets) if (a.axis === "x") for (const b of d.streets) if (b.axis === "z") {
		if (b.at < a.from || b.at > a.to || a.at < b.from || a.at > b.to) continue;
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
			const px = b.at + sx * b.roadHalf, pz = a.at + sz * a.roadHalf;   // угол проезжих частей
			out.push({ px, pz, cx: px + sx * CORNER_R, cz: pz + sz * CORNER_R, sx, sz });
		}
	}
	return out;
}     // как в street.js

const COLORS = {
	ground: 0x6f7560, green: 0x56663f, road: 0x3e4245, walk: 0x8e8f8a, drive: 0x55595a,
	path: 0x9a978c, parking: 0x4d5153, sand: 0xa8976e, sportFloor: 0x5b6f7d, board: 0xd8d4c8,
	fence: 0x3a3d3a, mark: 0xe8e6de,
	slab: 0xc9c4b8, tower: 0xd6d1c4, shop: 0x9fb4bf, public: 0xd9b98f, utility: 0x9a5a48,
	garages: 0x7b766c, entrance: 0x2a2c2e, canopy: 0x6b6f72, shopBand: 0xc98a2a,
	trunk: 0x4b3a2c, crown: 0x4f7a3c,
	trash: 0x6b5238,
	car: 0x7d8a95, bus: 0xb8a55a, obj: 0x8a857a,
	danger: 0xd0402c, contested: 0xd69a1c, camp: 0x3d7fc2, shelter: 0x33b36b,
};

const mats = {};
function mat(key, extra) {
	if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ color: COLORS[key], roughness: 0.92, ...extra });
	return mats[key];
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/** Коробка по центру низа: (x, z) — середина в плане, y0 — низ. */
function box(g, key, w, h, d, x, y0, z, rotY = 0) {
	const m = new THREE.Mesh(unitBox, mat(key));
	m.scale.set(w, h, d);
	m.position.set(x, y0 + h / 2, z);
	m.rotation.y = rotY;
	m.castShadow = h > 0.3;
	m.receiveShadow = true;
	g.add(m);
	return m;
}

/** Коробка по прямоугольнику плана [x0, z0, x1, z1]. */
function boxRect(g, key, r, y0, h) {
	return box(g, key, r[2] - r[0], h, r[3] - r[1], (r[0] + r[2]) / 2, y0, (r[1] + r[3]) / 2);
}

/** Полоса по отрезку a→b шириной w; концы продлены на полширины, чтобы стыки ломаной не зияли. */
function segment(g, key, a, b, w, y0, h) {
	const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
	return box(g, key, len + w, h, w, (a[0] + b[0]) / 2, y0, (a[1] + b[1]) / 2, -Math.atan2(dz, dx));
}

/** Интервал [a, b] минус набор интервалов. */
function subtract(a, b, cuts) {
	let parts = [[a, b]];
	for (const [c0, c1] of cuts) {
		parts = parts.flatMap(([p0, p1]) => {
			if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
			return [[p0, c0], [c1, p1]].filter(([u, v]) => v - u > 0.01);
		});
	}
	return parts;
}

function buildStreets(g, d) {
	for (const s of d.streets) {
		const h = s.roadHalf;
		const road = s.axis === "x" ? [s.from, s.at - h, s.to, s.at + h] : [s.at - h, s.from, s.at + h, s.to];
		boxRect(g, "road", road, -KERB_H - 0.3, 0.3);
		// Тротуар режется там, где его пересекает проезжая часть поперечной улицы,
		// иначе он лёг бы плитой поперёк перекрёстка.
		// тротуар кончается на радиус скругления раньше — угол закрывает сектор
		const cuts = d.streets.filter(o => o.axis !== s.axis).map(o => [o.at - o.roadHalf - CORNER_R, o.at + o.roadHalf + CORNER_R]);
		// первые 15 см от кромки занимает бортовой камень БР 100.30.15 (curbs.js) — тротуар вплотную к его тылу
		const CURB_W = 0.15;
		const walkW = KERB_H + s.walk - CURB_W;
		for (const side of [-1, 1]) {
			const c0 = s.at + side * (h + CURB_W + walkW / 2);
			for (const [u, v] of subtract(s.from, s.to, cuts)) {
				const r = s.axis === "x"
					? [u, c0 - walkW / 2, v, c0 + walkW / 2]
					: [c0 - walkW / 2, u, c0 + walkW / 2, v];
				boxRect(g, "walk", r, -0.3, 0.3);
			}
		}
		// осевая разметка — только внутри квартала, не через перекрёстки
		const [a, b] = s.axis === "x" ? [d.interior[0], d.interior[2]] : [d.interior[1], d.interior[3]];
		for (let t = a; t < b - 3; t += 6) {
			const r = s.axis === "x" ? [t, s.at - 0.07, t + 3, s.at + 0.07] : [s.at - 0.07, t, s.at + 0.07, t + 3];
			boxRect(g, "mark", r, -KERB_H, 0.01);
		}
	}
}

// Углы: асфальт квадратом до центра скругления, поверх — сектор тротуара радиусом
// R − толщина камня (камень дуговой, curbs.js).
function buildCorners(g, d) {
	for (const c of streetCorners(d)) {
		boxRect(g, "road", [Math.min(c.px, c.cx), Math.min(c.pz, c.cz), Math.max(c.px, c.cx), Math.max(c.pz, c.cz)], -KERB_H - 0.3, 0.3);
		// сектор: направления от C к углу — между (−sx, 0) и (0, −sz); θ в three: x = r·sinθ, z = r·cosθ
		const t1 = Math.atan2(-c.sx, 0), t2 = Math.atan2(0, -c.sz);
		let start = t1, len = Math.PI / 2;
		const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
		if (Math.abs(norm(t1 + Math.PI / 2) - norm(t2)) > 1e-3) start = t2;
		const geo = new THREE.CylinderGeometry(CORNER_R - 0.15, CORNER_R - 0.15, 0.3, 16, 1, false, start, len);
		const m = new THREE.Mesh(geo, mat("walk"));
		m.position.set(c.cx, -0.15, c.cz);
		m.receiveShadow = true;
		g.add(m);
	}
}

function fence(g, r, gate, h = 1.6) {
	const t = 0.08, gw = 3.0;
	const edges = [
		[[r[0], r[1]], [r[2], r[1]]], [[r[2], r[1]], [r[2], r[3]]],
		[[r[2], r[3]], [r[0], r[3]]], [[r[0], r[3]], [r[0], r[1]]],
	];
	for (const [a, b] of edges) {
		// калитка режет тот край, на котором лежит
		const horiz = a[1] === b[1];
		const onEdge = gate && (horiz ? Math.abs(gate[1] - a[1]) < 0.01 : Math.abs(gate[0] - a[0]) < 0.01);
		const lo = horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
		const hi = horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
		const g0 = onEdge ? (horiz ? gate[0] : gate[1]) : null;
		for (const [u, v] of subtract(lo, hi, g0 === null ? [] : [[g0 - gw / 2, g0 + gw / 2]])) {
			const p = horiz ? [[u, a[1]], [v, a[1]]] : [[a[0], u], [a[0], v]];
			const len = v - u;
			box(g, "fence", horiz ? len : t, h, horiz ? t : len, (p[0][0] + p[1][0]) / 2, 0, (p[0][1] + p[1][1]) / 2);
		}
	}
}

function buildAreas(g, d) {
	for (const a of d.areas) {
		// сквер (kind "green") своей плоскости не имеет: его рисует пол (floor.js) по карте травы
		if (a.kind === "parking") boxRect(g, "parking", a.rect, -0.1, 0.1);
		if (a.kind === "playground") {
			boxRect(g, "ground", a.rect, -0.1, 0.12);   // пол площадки — песок слоем ground
			if (!a.equipment) {   // оборудование-модели (a.equipment) ставит playground.js
				const [cx, cz] = [(a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2];
				box(g, "obj", 1.2, 2.2, 4.0, cx - 7, 0, cz - 4);
				box(g, "obj", 3.4, 2.4, 0.6, cx + 5, 0, cz - 5);
				box(g, "obj", 3.0, 1.0, 3.0, cx + 4, 0, cz + 5);
				box(g, "obj", 1.2, 3.0, 1.2, cx - 4, 0, cz + 6);
			}
		}
		if (a.kind === "sport") {
			boxRect(g, "sportFloor", a.rect, -0.1, 0.12);
			fence(g, a.rect, null, 1.2);
		}
		if (a.kind === "bins") boxRect(g, "obj", [a.rect[0] + 0.5, a.rect[1] + 0.8, a.rect[2] - 0.5, a.rect[3] - 0.8], 0, 1.5);
		if (a.kind === "fenced" && !a.fence) fence(g, a.rect, a.gate);   // забор-модель (a.fence) ставит fences.js
	}
}

function buildDriveways(g, d) {
	for (const w of d.driveways)
		for (let i = 1; i < w.path.length; i++) segment(g, "drive", w.path[i - 1], w.path[i], w.width, -0.3, 0.3 - 0.005);
	// тропы и подходы к дверям; где лежат плиты (slabs.js) — коробки нет: в швах земля пола
	const on = d.slabs ? d.slabs.on : [];
	const slabbed = w => !w.trail && (d.paths.includes(w) ? on.includes("paths") : on.includes("access"));
	for (const w of [...d.paths, ...accessPaths(d)]) if (!slabbed(w))
		for (let i = 1; i < w.path.length; i++) segment(g, "path", w.path[i - 1], w.path[i], w.width, -0.3, 0.3 + (w.trail ? -0.01 : 0.005));
}

function buildingHeight(b) {
	if (b.kind === "garages") return 2.6;
	if (b.kind === "shop") return 5.0;
	if (b.floors === 1) return 3.6;
	return b.floors * FLOOR_H + 0.6;   // парапет
}

function buildBuildings(root, d) {
	for (const b of d.buildings) {
		// Всё, что относится к дому (коробка, двери, козырьки, витрины), — в его
		// группе: пришла модель дома — коробку прячут одной строкой.
		const g = new THREE.Group();
		g.name = "bld-" + b.id;
		g.userData.building = b.id;
		root.add(g);
		const h = buildingHeight(b);
		const color = b.kind;
		for (const r of rectsOf(b)) {
			const m = boxRect(g, color, r, 0, h);
			m.name = b.name;
			m.userData.id = b.id;
		}
		// ворота гаражей — разделители боксов
		if (b.boxes) {
			const [x0, z0, x1, z1] = b.rect, w = (x1 - x0) / b.boxes;
			for (let i = 0; i < b.boxes; i++) box(g, "entrance", w - 0.6, 2.1, 0.05, x0 + (i + 0.5) * w, 0, z0 - 0.03);
		}
		// входы: дверь + козырёк, снаружи на своей стене
		for (const e of b.entrances) {
			if (b.boxes) continue;
			const r = rectsOf(b)[0];
			let x, z, nx = 0, nz = 0;
			if (e.side === "N") { x = e.at; z = e.z ?? r[1]; nz = -1; }
			if (e.side === "S") { x = e.at; z = e.z ?? r[3]; nz = 1; }
			if (e.side === "W") { x = e.x ?? r[0]; z = e.at; nx = -1; }
			if (e.side === "E") { x = e.x ?? r[2]; z = e.at; nx = 1; }
			const along = nz !== 0;
			box(g, "entrance", along ? 1.4 : 0.1, 2.2, along ? 0.1 : 1.4, x + nx * 0.05, 0, z + nz * 0.05);
			box(g, "canopy", along ? 2.4 : 1.3, 0.2, along ? 1.3 : 2.4, x + nx * 0.65, 2.6, z + nz * 0.65);
		}
		// магазины первого этажа — полоса витрины на фасаде
		const bb = rectsOf(b)[0];
		for (const s of b.shops || []) {
			const z = s.side === "N" ? bb[1] - 0.08 : bb[3] + 0.08;
			box(g, "shopBand", s.span[1] - s.span[0], 3.0, 0.16, (s.span[0] + s.span[1]) / 2, 0, z);
		}
	}
}

function buildTrees(g, d, meshes = true) {
	const trees = treePositions(d);
	if (!meshes) return trees;   // деревья ставит trees.js из библиотеки, здесь только раскладка
	const trunk = new THREE.InstancedMesh(unitBox, mat("trunk"), trees.length);
	const crown = new THREE.InstancedMesh(unitBox, mat("crown"), trees.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	trees.forEach(([x, z, r], i) => {
		q.setFromAxisAngle(up, (x * 12.9898 + z * 78.233) % Math.PI);
		const th = 2.2 + r * 0.3;                // ствол до кроны
		s.set(0.35, th, 0.35); p.set(x, th / 2, z);
		trunk.setMatrixAt(i, m.compose(p, q, s));
		const ch = r * 1.9;                      // крона чуть вытянута вверх
		s.set(r * 2, ch, r * 2); p.set(x, th + ch / 2 - 0.3, z);
		crown.setMatrixAt(i, m.compose(p, q, s));
	});
	for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; g.add(im); }
	return trees;
}

/**
 * Кучи мусора — по коробке-габариту на кучу, один цвет, одна InstancedMesh.
 * Раскладка из district.js — та же, что на карте. На проезжей части куча
 * стоит на асфальте (на 14 см ниже тротуара).
 */
function buildTrash(g, d, trees) {
	const piles = trashPiles(d, trees);
	const im = new THREE.InstancedMesh(unitBox, mat("trash"), piles.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const onRoad = (x, z) => d.streets.some(st => {
		const h = st.roadHalf;
		return st.axis === "x" ? Math.abs(z - st.at) < h : Math.abs(x - st.at) < h;
	});
	piles.forEach((t, i) => {
		const y0 = onRoad(t.x, t.z) ? -KERB_H : 0;
		q.setFromAxisAngle(up, -t.rot);   // на карте поворот по часовой при Z вниз
		s.set(t.w, t.h, t.d); p.set(t.x, y0 + t.h / 2, t.z);
		im.setMatrixAt(i, m.compose(p, q, s));
	});
	im.castShadow = true; im.receiveShadow = true;
	im.name = "Trash";   // отдельный слой в разбивке цены кадра и в #off=trash
	g.add(im);
	return piles;
}

// Роль коробки → имя материала в таблице домов HoudiniCOP (house_tiles.json).
// Пока модели домов выключены, коробки одеты в те же материалы, что и дома.
const BOX_MATERIALS = {
	slab: "concrete_panel", tower: "concrete_panel",
	shop: "gypsum", public: "gypsum",
	utility: "brick",            // кирпич — черновик HoudiniCOP, до сверки с hou
	garages: "metal_painted", fence: "metal_painted",
	obj: "concrete",             // горки, качели — нейтрально, пока нет моделей
	canopy: "concrete", entrance: "door_wood",
};
// Разметка: краска стёрта пятнами и вдоль колёс, пыльная — брошенная дорога.
function wornPaint(m) {
	m.color.setRGB(0.78, 0.77, 0.72);
	m.onBeforeCompile = sh => {
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPW;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
			varying vec3 vPW;
			float pH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
			float pN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
				return mix(mix(pH(i), pH(i + vec2(1.0, 0.0)), f.x), mix(pH(i + vec2(0.0, 1.0)), pH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
			.replace("#include <map_fragment>", `#include <map_fragment>
			{
				float n = pN(vPW.xz * 3.1) * 0.5 + pN(vPW.xz * 11.0) * 0.3 + pN(vPW.xz * 0.6) * 0.2;
				if (n < 0.36) discard;                                   // краска стёрлась до асфальта
				diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.36, 0.7, n));   // грязная, местами тонкая
			}`);
	};
	m.customProgramCacheKey = () => "worn-paint";
	m.needsUpdate = true;
}

/** Одеть коробки блок-аута в материалы зданий (трипланар по мировым осям). */
export async function dressBoxes() {
	wornPaint(mat("mark"));
	const T = await houseTiles();
	for (const [key, name] of Object.entries(BOX_MATERIALS)) {
		const dir = T.set[name], tile = T.tile_m[name];
		if (!dir || !tile) { console.warn("[улица] нет набора для", key, name); continue; }
		// крашеный металл на целой коробке — выцветший: краска и ржавчина приглушены
		boxify(mat(key), dir, tile, 0.3, name === "metal_painted" ? 0.35 : 1);
	}
}

/** Материалы твёрдых покрытий — на них ложатся накладки пола (floor.js hardify). */
export function hardMaterials() {
	// [материал, асфальт]: 1 — все варианты пятнами (дорога), 2 — только старый (пока нет своего)
	return [["road", 1], ["drive", 1], ["parking", 1], ["walk", 2], ["path", 2]].map(([k, a]) => [mat(k), a]);
}

/** Материал земли двора — трава красит его в grass.js. */
export function groundMaterial() {
	return mat("ground");
}

function buildObjects(g, d) {
	for (const o of d.objects) {
		const [x, z] = o.at;
		const rot = -(o.rot || 0) * Math.PI / 180;   // на карте поворот по часовой при Z вниз
		switch (o.kind) {
			case "car": box(g, "car", 4.5, 1.5, 1.9, x, -KERB_H, z, rot); break;
			case "bus": box(g, "bus", o.size[0], 3.0, o.size[1], x, -KERB_H, z); break;
			case "stop": box(g, "canopy", o.size[0], 2.6, o.size[1], x, 0, z); break;
			case "kiosk": box(g, "obj", o.size[0], 2.6, o.size[1], x, 0, z); break;
			case "bench": box(g, "obj", 1.8, 0.8, 0.6, x, 0, z); break;
			case "table": box(g, "obj", 1.2, 0.75, 1.2, x, 0, z); break;
			case "crossing":
				for (let t = -o.size[1] / 2; t < o.size[1] / 2; t += 1.2)
					box(g, "mark", o.size[0], 0.01, 0.6, x, -KERB_H, z + t + 0.3);
				break;
		}
	}
}

/** Игровой слой: зоны полупрозрачными плитами, убежище — рамкой. */
function buildGameLayer(d) {
	const g = new THREE.Group();
	g.name = "Gameplay";
	const pad = (r, p) => [r[0] - p, r[1] - p, r[2] + p, r[3] + p];
	const bbOf = rs => [Math.min(...rs.map(r => r[0])), Math.min(...rs.map(r => r[1])), Math.max(...rs.map(r => r[2])), Math.max(...rs.map(r => r[3]))];
	// Зона — лентой по границе, без заливки: полупрозрачная плита поверх двора
	// перекрашивала траву и тропы в бурый и читалась «песком».
	const outline = (pts, k) => {
		const m = new THREE.MeshBasicMaterial({ color: COLORS[k], transparent: true, opacity: 0.85, depthWrite: false });
		for (let i = 0; i < pts.length; i++) {
			const a = pts[i], b = pts[(i + 1) % pts.length];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			const s = new THREE.Mesh(unitBox, m);
			s.scale.set(len, 0.06, 0.5);
			s.position.set((a[0] + b[0]) / 2, 0.9, (a[1] + b[1]) / 2);   // над травой — лента видна
			s.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
			s.renderOrder = 2;
			g.add(s);
		}
	};
	const rectPts = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
	for (const z of d.gameplay.zones) {
		if (z.area) {
			const a = areaById(d, z.area);
			outline(a.poly ? a.poly : rectPts(a.rect), z.kind);
		} else if (z.building) {
			outline(rectPts(pad(bbOf(rectsOf(d.buildings.find(b => b.id === z.building))), 4)), z.kind);
		} else outline(rectPts(z.rect), z.kind);
	}
	const sh = d.buildings.find(b => b.id === d.gameplay.shelter);
	const r = pad(sh.rect, 2.5);
	const frame = new THREE.LineSegments(
		new THREE.EdgesGeometry(new THREE.BoxGeometry(r[2] - r[0], 6, r[3] - r[1])),
		new THREE.LineBasicMaterial({ color: COLORS.shelter }));
	frame.position.set((r[0] + r[2]) / 2, 3, (r[1] + r[3]) / 2);
	g.add(frame);
	const [ex, ez] = d.gameplay.entry.at;
	const beacon = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: COLORS.shelter }));
	beacon.scale.set(1, 12, 1); beacon.position.set(ex, 6, ez);
	g.add(beacon);
	return g;
}

export function buildBlockout(d, { treeBoxes = true } = {}) {
	const g = new THREE.Group();
	g.name = "District";
	const [bx0, bz0, bx1, bz1] = d.bounds;
	// Земля за улицами — ниже асфальта, иначе закрыла бы проезжую часть
	// (проезд на 14 см ниже тротуара). Газон двора — отдельная плита внутри улиц.
	// Зазор 25 см, а не сантиметр: на 250 м от камеры буфер глубины различает
	// лишь ~7 см, и плиты в сантиметре друг от друга рябят полосами.
	boxRect(g, "ground", [bx0, bz0, bx1, bz1], -1.0, 1.0 - KERB_H - 0.25);
	boxRect(g, "ground", d.interior, -0.5, 0.5 - 0.03);
	buildStreets(g, d);
	buildCorners(g, d);
	buildAreas(g, d);
	buildDriveways(g, d);
	buildBuildings(g, d);
	const trees = buildTrees(g, d, treeBoxes);
	buildObjects(g, d);
	const trash = buildTrash(g, d, trees);
	const game = buildGameLayer(d);
	g.add(game);
	const merged = mergeStatic(g);
	console.log(`[улица] блок-аут: ${merged.before} коробок слиты в ${merged.after} мешей`);
	return { group: g, game, trees, piles: trash, stats: { buildings: d.buildings.length, trees: trees.length, trash: trash.length } };
}
