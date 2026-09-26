import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Бортовой камень БР 100.30.15 (blend, game/assets/models/props/curb/) вдоль
// кромки проезжей части — правилами от улиц district.json:
//  • обычные камни bare a/b/c вперемешку, ±0.5° и 0–1 см — «гуляющая» бровка;
//  • изредка камень со сколом;
//  • у переходов и остановок — побелка: белый/чёрный через один;
//  • на въездах во дворы (конец проезда у тротуара): ramp_down → low×N → ramp_up;
//  • перекрёстки: бровка кончается у кромки поперечной дороги.
// Модель: начало — лицо камня на уровне дороги в начале куска, кусок вдоль +X,
// тротуар в −Z. Камней тысячи — рисуются экземплярами: InstancedMesh на
// (вид, ступень LOD, часть меша); ступень у каждого камня своя, по расстоянию.

const DIR = "../game/assets/models/props/curb/";
const KERB_H = 0.14;             // как в blockout.js: дорога на −KERB_H
const LOD_DIST = [25, 70];       // м
const LODS = ["", "_lod1", "_lod2"];

function hash(x, z) {
	const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return s - Math.floor(s);
}
function subtract(a, b, cuts) {
	let parts = [[a, b]];
	for (const [c0, c1] of cuts) parts = parts.flatMap(([p0, p1]) =>
		c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, c0], [c1, p1]].filter(([u, v]) => v - u > 0.01));
	return parts;
}

/** Раскладка: [{ name, len, x, z, rot }] — rot так, что тротуар в сторону от дороги. */
function layout(d) {
	const out = [];
	const walkBand = s => s.roadHalf + KERB_H + s.walk + 2;
	// въезды: конец проезда в полосе тротуара улицы → интервал вдоль улицы
	const mouths = d.streets.map(() => []);
	for (const w of d.driveways) for (const p of [w.path[0], w.path[w.path.length - 1]]) {
		d.streets.forEach((s, si) => {
			const across = s.axis === "x" ? p[1] - s.at : p[0] - s.at;
			if (Math.abs(across) > walkBand(s)) return;
			const u = s.axis === "x" ? p[0] : p[1];
			mouths[si].push({ side: Math.sign(across), u0: u - w.width / 2 - 1, u1: u + w.width / 2 + 1 });
		});
	}
	// побелка: переходы и остановки — по стороне и интервалу вдоль улицы
	const white = d.streets.map(() => []);
	for (const o of d.objects) if (o.kind === "crossing" || o.kind === "stop") d.streets.forEach((s, si) => {
		const across = s.axis === "x" ? o.at[1] - s.at : o.at[0] - s.at;
		if (Math.abs(across) > walkBand(s) + 2) return;
		const u = s.axis === "x" ? o.at[0] : o.at[1], half = (o.size ? (s.axis === "x" ? o.size[0] : o.size[1]) : 4) / 2 + 3;
		for (const side of o.kind === "crossing" ? [-1, 1] : [Math.sign(across) || 1]) white[si].push({ side, u0: u - half, u1: u + half });
	});

	d.streets.forEach((s, si) => {
		const cuts = d.streets.filter(o => o.axis !== s.axis).map(o => [o.at - o.roadHalf, o.at + o.roadHalf]);
		for (const side of [-1, 1]) {
			const face = s.at + side * s.roadHalf;
			// тротуар в сторону side; модель −Z → туда. +X модели при этом:
			const rot = s.axis === "x" ? (side > 0 ? Math.PI : 0) : -side * Math.PI / 2;
			const mx = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
			const along = s.axis === "x" ? Math.round(mx.x) : Math.round(mx.z);   // ±1
			const mine = (list) => list.filter(m => m.side === side);
			for (const [u0, u1] of subtract(s.from, s.to, cuts)) {
				// идём по +X модели: от начала к концу в её направлении
				let u = along > 0 ? u0 : u1;
				const end = along > 0 ? u1 : u0;
				let k = 0;
				while (along > 0 ? end - u >= 0.49 : u - end >= 0.49) {
					const rest = Math.abs(end - u), mid = u + along * 0.5;
					const inMouth = mine(mouths[si]).find(m => mid >= m.u0 && mid <= m.u1);
					const inWhite = mine(white[si]).some(m => mid >= m.u0 && mid <= m.u1);
					let name, len = 1;
					if (rest < 0.99) { name = inWhite ? (k % 2 ? "curb_half_black" : "curb_half_white") : "curb_half"; len = 0.5; }
					else if (inMouth) {
						const first = Math.abs(u - (along > 0 ? inMouth.u0 : inMouth.u1)) < 1.0;
						const lastEdge = along > 0 ? inMouth.u1 : inMouth.u0;
						const last = Math.abs(lastEdge - (u + along)) < 1.0;
						name = first ? "curb_ramp_down" : last ? "curb_ramp_up" : "curb_low";
					} else if (inWhite) name = k % 2 ? "curb_straight_black" : "curb_straight_white";
					else {
						const h = hash(u * 1.3 + side, face);
						name = h < 0.03 ? "curb_broken" : h < 0.36 ? "curb_straight" : h < 0.68 ? "curb_straight_bare_b" : "curb_straight_bare_c";
					}
					const [x, z] = s.axis === "x" ? [u, face] : [face, u];
					out.push({ name, x, z, rot, jitter: !inMouth && !name.includes("ramp") });
					u += along * len; k++;
				}
			}
		}
	});
	return out;
}

/** Меши модели в координатах её корня; квантованные атрибуты — во float до матрицы. */
function partsOf(scene) {
	scene.updateMatrixWorld(true);
	const parts = [];
	scene.traverse(o => {
		if (!o.isMesh) return;
		const geo = o.geometry.clone();
		for (const [n, a] of Object.entries(geo.attributes)) {
			if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized) continue;
			const f = new Float32Array(a.count * a.itemSize);
			for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
			geo.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize));
		}
		geo.applyMatrix4(o.matrixWorld);
		parts.push({ geo, mat: o.material });
	});
	return parts;
}

export async function loadCurbs(d) {
	const items = layout(d);
	const group = new THREE.Group();
	group.name = "Curbs";
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const names = [...new Set(items.map(i => i.name))];
	const byName = Object.fromEntries(names.map(n => [n, items.filter(i => i.name === n)]));
	// матрицы экземпляров — один раз
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
	for (const it of items) {
		const j = it.jitter ? hash(it.x, it.z) : 0.5;
		q.setFromAxisAngle(up, it.rot + (j - 0.5) * 2 * 0.5 * Math.PI / 180);
		it.m = new THREE.Matrix4().compose(new THREE.Vector3(it.x, -KERB_H + (it.jitter ? hash(it.z, it.x) * 0.01 : 0), it.z), q, one);
		it.p = new THREE.Vector3(it.x, 0, it.z);
	}
	const meshes = {};   // name → [lod] → [InstancedMesh]
	await Promise.all(names.map(async n => {
		const scenes = await Promise.all(LODS.map(s => loader.loadAsync(`${DIR}${n}${s}_web.glb`).then(g => g.scene)));
		meshes[n] = scenes.map((sc, l) => partsOf(sc).map(({ geo, mat }) => {
			const im = new THREE.InstancedMesh(geo, mat, byName[n].length);
			im.count = 0;
			im.castShadow = l === 0; im.receiveShadow = true;
			im.frustumCulled = false;   // экземпляры по всему кварталу; bounding sphere геометрии одного камня
			group.add(im);
			return im;
		}));
	}));

	// Раз в кадр (если камера сдвинулась): каждый камень — в свою ступень.
	const last = new THREE.Vector3(1e9, 0, 0);
	function update(camera) {
		if (camera.position.distanceToSquared(last) < 0.25) return;
		last.copy(camera.position);
		for (const n of names) {
			const L = meshes[n];
			for (const lv of L) for (const im of lv) im.count = 0;
			for (const it of byName[n]) {
				const dd = it.p.distanceTo(camera.position);
				const l = dd < LOD_DIST[0] ? 0 : dd < LOD_DIST[1] ? 1 : 2;
				for (const im of L[l]) im.setMatrixAt(im.count++, it.m);
			}
			for (const lv of L) for (const im of lv) im.instanceMatrix.needsUpdate = true;
		}
	}
	console.log(`[улица] бордюр: ${items.length} камней, видов ${names.length}`);
	return { group, update, count: items.length };
}
