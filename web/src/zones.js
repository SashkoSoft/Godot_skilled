import * as THREE from "three";
import { texPx } from "./texlod.js";

// Отделка домов hou по зонам (b3/b4: <id>.json → "zones"). Наборы и правила — от blend
// (game/assets/textures/building/zones_table.json): зона материала glTF → набор текстур,
// вариант — по комнате (_room, индекс в rooms) или панели фасада (_panel).
//
// Как устроено: треугольники меша зоны раскладываются по группам — одна группа на набор
// (обои в цветочек, паркет, краска подъезда…), у каждой свой материал, общий на весь дом.
// Разброс внутри набора (тон панели, сила грязи) — вершинный атрибут zv, по хешу
// панели/комнаты. Масляная краска подъезда и кухни — полоса от пола каждого этажа:
// V текстуры считается от высоты вершины, а не из UV.

const DIR = "../game/assets/textures/building/";
const RES = texPx <= 512 ? "512" : "1k";

// шаг тайла, м (UV hou — в метрах)
const TILE = {
	concrete_panel_smooth_v0: 3, concrete_panel_smooth_v1: 3, concrete_panel_smooth_v2: 3,
	concrete_monolith: 2, concrete_slab_under: 3, concrete_stair: 1.2,
	stair_green: 1.5, stair_blue: 1.5, stair_beige: 1.5, stair_brownred: 1.5, stair_ceiling: 3,
	wallpaper_flowers: 0.53, wallpaper_stripes: 0.53, wallpaper_diamond: 0.53,
	tile22_white: 1.1, tile22_blue: 1.1, floor_metlakh: 1.2,
	earth: 2, timber: 1.2, concrete_pipe: 2, basement_floor: 2, storage_mesh: 1, storage_boards: 1.2,
	room_paint_beige: 1.5, room_paint_blue: 1.5, room_paint_green: 1.5,
	parquet_herring: 1, linoleum_wood: 2, linoleum_tiles: 2, roof_roll: 4, rubble: 1.5, concrete_fracture: 1.5,
};
const TILE_V = { wallpaper_flowers: 1.06, wallpaper_stripes: 1.06, wallpaper_diamond: 1.06 };
const PAINT = /^(stair|room_paint)_(green|blue|beige|brownred)$/;   // полоса краски до 1.5 м от пола этажа
const STAIR_TYPES = /^(ploshchadka|lestnica|lift)$/;
const NO_MASK = new Set(["tile22_white", "tile22_blue"]);   // у плитки маски нет — грязь не рисуется
const CUTOUT = new Set(["storage_mesh", "storage_boards"]);   // сетка и штакетник кладовок: вырез по альфе, двусторонние

const hashApt = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 100000; };
// целое → 0..1, одинаково на всех машинах
function hash(n) {
	let x = (n | 0) * 374761393 + 668265263;
	x = Math.imul(x ^ (x >>> 13), 1274126177);
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Правило зоны: набор, тон и грязь для треугольника с комнатой room и панелью panel. */
function rule(zone, room, panel, info, stairColor) {
	const rm = room >= 0 ? info.rooms[room] : null, type = rm ? rm.type : null;
	switch (zone) {
		case "facade_panel":
			return { set: `concrete_panel_smooth_v${Math.floor(hash(panel) * 3)}`, tone: 1 + 0.03 * (hash(panel + 1) * 2 - 1), grime: 0.3 + 0.7 * hash(panel + 2) };
		case "plinth":
			return { set: "concrete_monolith", tone: 0.92 + 0.03 * (hash(panel + 1) * 2 - 1), grime: 1.3 };
		case "monolith":   // марши, площадки, крыльцо: гладкий бетон (с опалубкой читались досками)
			return { set: "concrete_panel_smooth_v2", tone: 0.78, grime: 1 };
		case "slab_edge":
			return { set: "concrete_panel_smooth_v1", tone: 0.9, grime: 0.6 };
		case "slab_top": {
			// пол площадок — метлахская плитка (monolith — бетон с отпечатком опалубки, для стен)
			if (!type || STAIR_TYPES.test(type)) return { set: "floor_metlakh", tone: 1, grime: 1 };
			if (type === "sanuzel" || type === "tualet") return { set: "linoleum_tiles", tone: 1, grime: 0.6 };
			if (type === "shop") return { set: "floor_metlakh", tone: 1, grime: 1 };   // торговый зал — метлахская плитка
			if (type === "zhilaya") return { set: hash(room + 7) < 0.7 ? "parquet_herring" : "linoleum_wood", tone: 0.92 + 0.16 * hash(room + 3), grime: 0.5 };
			return { set: "linoleum_wood", tone: 0.92 + 0.16 * hash(room + 3), grime: 0.6 };
		}
		case "slab_under":
			// копоть на потолке подъезда — в полную силу, в квартирах едва
			return !type || STAIR_TYPES.test(type) ? { set: "stair_ceiling", tone: 1, grime: 1 } : { set: "concrete_slab_under", tone: 1, grime: 0.2 };
		case "stairwell_wall":
			return { set: stairColor, tone: 1, grime: 1 };
		case "wall_room": {
			if (type && STAIR_TYPES.test(type)) return { set: stairColor, tone: 1, grime: 1 };
			if (type === "shop") return { set: "room_paint_green", tone: 1, grime: 0.8 };   // торговый зал — масляная панель
			// кухня — чистая масляная панель до 1.5 м; санузел — панель или плитка
			if (type === "kuhnya") return { set: hash(room + 19) < 0.5 ? "room_paint_beige" : "room_paint_green", tone: 1, grime: 0.6 };
			if (type === "sanuzel" || type === "tualet") {
				const h = hash(room + 17);
				return { set: h < 0.4 ? "room_paint_blue" : h < 0.7 ? "tile22_white" : "tile22_blue", tone: 1, grime: h < 0.4 ? 0.6 : 0 };
			}
			// прихожая нарезана кусками — обои одни на всю квартиру, не по куску
			const k = rm && rm.apartment && type === "prihozhaya" ? hashApt(rm.apartment) : room >= 0 ? room : 0;
			return { set: ["wallpaper_flowers", "wallpaper_stripes", "wallpaper_diamond"][Math.floor(hash(k + 11) * 3)], tone: 0.9 + 0.2 * hash(k + 5), grime: 0.5 };
		}
		case "roof": return { set: "roof_roll", tone: 1, grime: 1 };
		case "rubble": return { set: "rubble", tone: 1, grime: 1 };
		case "fracture": return { set: "concrete_fracture", tone: 1, grime: 0.4 };   // свежий скол руины
		// подвал: голый бетон стен и столбов, стяжка пола — темнее и грязнее
		case "basement_wall": return { set: "concrete_panel_smooth_v2", tone: 0.82, grime: 1 };
		case "basement_floor": return { set: "basement_floor", tone: 1, grime: 0.8 };
		case "storage_grid": return { set: hash(room + 23) < 0.5 ? "storage_mesh" : "storage_boards", tone: 1, grime: 0.6 };
		// туннели: порода, крепь, бетонный коллектор
		case "earth": return { set: "earth", tone: 1, grime: 0.8 };
		case "timber": return { set: "timber", tone: 0.95 + 0.1 * hash(panel + 31), grime: 0.8 };
		case "concrete_pipe": return { set: "concrete_pipe", tone: 1, grime: 0.8 };
		case "column": return { set: "concrete_monolith", tone: 0.85, grime: 0.9 };
	}
	return null;
}
export const ZONES = new Set(["facade_panel", "plinth", "monolith", "slab_edge", "slab_top", "slab_under", "stairwell_wall", "wall_room", "roof", "rubble", "fracture", "basement_wall", "basement_floor", "column", "storage_grid", "earth", "timber", "concrete_pipe"]);

const loader = new THREE.TextureLoader();
const texCache = {};
function tex(set, ch) {
	const key = set + ch;
	if (texCache[key]) return texCache[key];
	const t = loader.load(`${DIR}${set}_${ch}_${RES}.${ch === "albedo" ? "webp" : "png"}`);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 4;
	t.colorSpace = ch === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	const tu = TILE[set] || 2, tv = TILE_V[set] || tu;
	t.repeat.set(1 / tu, 1 / tv);
	return (texCache[key] = t);
}

let blankTex = null;
const blank = () => blankTex ||= Object.assign(new THREE.DataTexture(new Uint8Array(4), 1, 1), { needsUpdate: true });

const matCache = {};
// uvM — сколько метров в единице UV модели (у целого дома 1, у руины hou 2);
// double — двусторонний (сейчас не нужен: развёрнутые грани руины hou исправила)
function material(set, floor, uvM = 1, double = false) {
	const band = PAINT.test(set);
	const key = set + (band ? `@${floor.base}/${floor.pitch}` : "") + `*${uvM}` + (double ? "d" : "");   // вырез (CUTOUT) — по имени набора
	if (matCache[key]) return matCache[key];
	const orm = tex(set, "orm");
	const m = new THREE.MeshStandardMaterial({
		name: "zone:" + set, map: tex(set, "albedo"), normalMap: tex(set, "normal"),
		aoMap: orm, roughnessMap: orm, metalness: 0, side: double || CUTOUT.has(set) ? THREE.DoubleSide : THREE.FrontSide,
		alphaTest: CUTOUT.has(set) ? 0.5 : 0,
	});
	const mask = NO_MASK.has(set) ? blank() : tex(set, "mask");
	m.onBeforeCompile = sh => {
		sh.uniforms.zMask = { value: mask };
		sh.uniforms.zBand = { value: new THREE.Vector3(band ? 1 : 0, floor.base, floor.pitch) };
		sh.uniforms.zUvM = { value: uvM };
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec2 zv;\nvarying vec2 vZv;\nuniform vec3 zBand;\nuniform float zUvM;")
			.replace("#include <uv_vertex>", `#include <uv_vertex>
	vZv = zv;
	// UV модели не в метрах (руина: 2 м на единицу) — повтор тайла считан в метрах
	vMapUv *= zUvM;
	#ifdef USE_NORMALMAP
	vNormalMapUv *= zUvM;
	#endif
	#ifdef USE_AOMAP
	vAoMapUv *= zUvM;
	#endif
	#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv *= zUvM;
	#endif
	if (zBand.x > 0.5) {
		// краска: V от пола своего этажа (панель до 1.5 м, выше побелка), по всем картам
		float wy = (modelMatrix * vec4(position, 1.0)).y;
		float vb = mod(wy - zBand.y, zBand.z) / 2.8;
		vMapUv.y = vb;
		#ifdef USE_NORMALMAP
		vNormalMapUv.y = vb;
		#endif
		#ifdef USE_AOMAP
		vAoMapUv.y = vb;
		#endif
		#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv.y = vb;
		#endif
	}`);
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying vec2 vZv;\nuniform sampler2D zMask;")
			.replace("#include <map_fragment>", `#include <map_fragment>
	// тон панели/комнаты и грязь по маске набора (G), сила — по панели/комнате
	vec4 zm = texture2D(zMask, vMapUv);
	diffuseColor.rgb *= vZv.x * (1.0 - 0.45 * clamp(zm.g * vZv.y, 0.0, 1.0));`);
	};
	m.customProgramCacheKey = () => "zone" + (band ? "b" : "");
	return (matCache[key] = m);
}

/**
 * Разложить зоны дома по наборам. root — сцена LOD (любая ступень), info — <id>.json.
 * Без атрибутов _room/_panel (дальние ступени) — вариант по умолчанию для всей зоны.
 */
export function dressZones(root, info) {
	if (!info || !info.zones) return 0;
	// отметка пола 1-го этажа и шаг этажей — из комнат
	const ys = [...new Set(info.rooms.filter(r => r.floor >= 0).map(r => r.y))].sort((a, b) => a - b);
	const floor = { base: ys[0] ?? 1.5, pitch: ys.length > 1 ? ys[1] - ys[0] : 3 };
	const ents = (info.entrances || []).map(e => e.pos);
	const colors = ["stair_green", "stair_blue", "stair_beige", "stair_brownred"];
	const stairAt = (x, z) => {
		let best = 0, bd = Infinity;
		ents.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[2] - z); if (d < bd) { bd = d; best = i; } });
		return colors[Math.floor(hash(best + 101 + (info.id || "").length * 13) * 4)];
	};
	let n = 0;
	const meshes = [];
	root.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && ZONES.has(o.material.name)) meshes.push(o); });
	root.updateMatrixWorld(true);
	const v = new THREE.Vector3();
	for (const o of meshes) {
		const zone = o.material.name, g = o.geometry;
		const room = g.attributes._room, panel = g.attributes._panel, pos = g.attributes.position;
		const sgn = a => a ? (i => { const x = a.getX(i); return x >= 2147483648 ? x - 4294967296 : x; }) : () => -1;   // -1 записан как uint32
		// после сжатия (tools/attr2uv.py) комната и панель — в uv2: x — комната, y — панель
		const u2 = !room && g.attributes.uv2;
		const R = u2 ? (i => Math.round(u2.getX(i))) : sgn(room), P = u2 ? (i => Math.round(u2.getY(i))) : sgn(panel);
		const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
		const zv = new Float32Array(pos.count * 2);
		const bySet = new Map();
		for (let t = 0; t < idx.length; t += 3) {
			const i0 = idx[t];
			v.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
			const r = rule(zone, R(i0), P(i0), info, stairAt(v.x, v.z));
			if (!r) continue;
			for (let k = 0; k < 3; k++) { const i = idx[t + k]; zv[i * 2] = r.tone; zv[i * 2 + 1] = r.grime; }
			if (!bySet.has(r.set)) bySet.set(r.set, []);
			const list = bySet.get(r.set);
			list.push(idx[t], idx[t + 1], idx[t + 2]);
		}
		if (!bySet.size) continue;
		const out = [], mats = [];
		g.clearGroups();
		for (const [set, list] of bySet) {
			g.addGroup(out.length, list.length, mats.length);
			mats.push(material(set, floor, info.uv_m || 1));
			for (const i of list) out.push(i);
		}
		g.setIndex(out);
		g.setAttribute("zv", new THREE.BufferAttribute(zv, 2));
		o.material = mats.length === 1 ? mats[0] : mats;
		if (mats.length === 1) g.clearGroups();
		n++;
	}
	return n;
}
