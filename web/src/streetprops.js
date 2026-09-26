import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { rectsOf, entrancePoint } from "./district.js";

// Уличные мелочи (blend, game/assets/models/props/street/) правилами от данных:
//  • контейнеры 0.75 м³ на мусорных площадках (bins) — рядом, 2–4 шт., часть ржавые,
//    надпись (+Z модели) к проезду; вместо коробки блок-аута;
//  • скамейки из objects (bench): у подъездов бетонные, у магазина — парковые;
//    сиденье (+X модели) спиной к стене дома — лицом во двор;
//  • урна у каждой скамейки, часть опрокинута (узел Urn_Bin);
//  • люки по оси дворовых проездов через 30–60 м;
//  • телефонная будка у остановки (дверь +Z — к тротуару).

const DIR = "../game/assets/models/props/street/";
const LOD_DIST = [20, 60];
const KERB_H = 0.14;

function hash(x, z) {
	const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return s - Math.floor(s);
}

export async function loadStreetProps(d) {
	const group = new THREE.Group();
	group.name = "StreetProps";
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), cache = {};
	const load = f => cache[f] ||= loader.loadAsync(DIR + f).then(g => {
		g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return g.scene;
	});
	let count = 0;
	async function put(name, x, y, z, rotY, tweak) {
		const lods = await Promise.all(["", "_lod1", "_lod2"].map(s => load(`${name}${s}_web.glb`)));
		const lod = new THREE.LOD();
		lods.forEach((s, i) => { const c = s.clone(); if (tweak) tweak(c); lod.addLevel(c, i ? LOD_DIST[i - 1] : 0, 0.1); });
		lod.position.set(x, y, z);
		lod.rotation.y = rotY;
		group.add(lod);
		count++;
	}

	// контейнеры на мусорных площадках
	for (const a of d.areas) if (a.kind === "bins" && a.rect) {
		const [x0, z0, x1, z1] = a.rect, n = 2 + Math.floor(hash(x0, z0) * 3);
		const alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0;
		for (let i = 0; i < n; i++) {
			const t = (i + 0.5) / n, h = hash(x0 + i, z0 - i);
			const x = alongX ? x0 + len * t : (x0 + x1) / 2, z = alongX ? (z0 + z1) / 2 : z0 + len * t;
			await put(h < 0.5 ? "container075_rusty" : "container075", x, 0, z, (alongX ? 0 : Math.PI / 2) + (h - 0.5) * 0.3);
		}
	}

	// скамейки: лицом от ближайшей стены дома; бетонные у жилых, парковые у магазина
	for (const o of d.objects) if (o.kind === "bench") {
		const [x, z] = o.at;
		let best = null;
		for (const b of d.buildings) for (const r of rectsOf(b)) {
			const cx = Math.max(r[0], Math.min(x, r[2])), cz = Math.max(r[1], Math.min(z, r[3]));
			const dd = Math.hypot(x - cx, z - cz);
			if (!best || dd < best.dd) best = { dd, nx: x - cx, nz: z - cz, kind: b.kind };
		}
		const face = best ? Math.atan2(best.nx, best.nz) : 0;   // направление «во двор»
		const rot = face - Math.PI / 2;                          // +X модели → во двор
		await put(best && best.kind === "shop" ? "bench_park" : "bench_concrete", x, 0, z, rot);
		// урна сбоку, иногда опрокинута
		const ux = x + Math.cos(face) * 1.3, uz = z - Math.sin(face) * 1.3, h = hash(x, z);
		await put(h < 0.5 ? "urn_post" : "urn_post_green", ux, 0, uz, face, h < 0.3 ? (c => {
			c.traverse(n => { if (/^Urn_Bin/.test(n.name)) n.rotation.x += (40 + h * 200) * Math.PI / 180; });
		}) : null);
	}

	// люки по оси дворовых проездов
	for (const w of d.driveways) for (let k = 1; k < w.path.length; k++) {
		const a = w.path[k - 1], b = w.path[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		for (let u = 15 + hash(a[0], a[1]) * 20; u < len - 5; u += 30 + hash(u, k) * 30) {
			const t = u / len;
			await put("manhole", a[0] + (b[0] - a[0]) * t, -KERB_H, a[1] + (b[1] - a[1]) * t, hash(u, a[0]) * Math.PI * 2);
		}
	}

	// телефонная будка у остановки, дверью к тротуару
	for (const o of d.objects) if (o.kind === "stop") {
		const s = d.streets.find(st => st.axis === "x" ? Math.abs(o.at[1] - st.at) < st.roadHalf + st.walk + 4 : Math.abs(o.at[0] - st.at) < st.roadHalf + st.walk + 4);
		const side = s ? Math.sign((s.axis === "x" ? o.at[1] : o.at[0]) - s.at) : 1;
		const x = o.at[0] + (s && s.axis === "x" ? (o.size ? o.size[0] / 2 + 2 : 5) : 0);
		const z = o.at[1] + (s && s.axis === "z" ? (o.size ? o.size[1] / 2 + 2 : 5) : 0);
		const rot = s && s.axis === "x" ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
		await put("phone_booth", x, 0, z, rot);
	}
	console.log(`[улица] уличные мелочи: ${count}`);
	return { group, count };
}
