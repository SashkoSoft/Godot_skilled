import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Россыпь камешков (blend, game/assets/models/props/rocks/) — объёмно только
// вблизи камеры: до 12 м LOD0, до 25 м LOD1, дальше не рисуется (там текстуры пола).
// Где лежат — по той же карте пола (floor.js buildGroundMap): галька — щебень и
// камешки на стыках; колотые камни — строительная крошка и куски у куч и фасадов.
// Точки раскладываются один раз (детерминированно), в корзины 8 м; раз в кадр —
// только из корзин рядом с камерой.

const DIR = "../game/assets/models/props/rocks/";
const NEAR = 12, FAR = 25, BUCKET = 8, CAP = 2500;
const PALETTE = ["#9E9991", "#8C786B", "#B39E80", "#5C5957", "#A88C78", "#807F75", "#94755C", "#C7BFAD", "#4D4745", "#9E8566"];
// каналы карты пола → [галька, камни] на ячейку 0.5 м при весе 1
const SOURCES = { gravel: [0.7, 0.08], pebbles: [0.5, 0.04], rubble: [0.12, 0.3], chunks: [0.06, 0.25] };
const SHAPES = { pebble: ["Pebble_00", "Pebble_02", "Pebble_04", "Pebble_06"], rock: ["Rock_00", "Rock_02", "Rock_04", "Rock_06"] };

function rng(seed) {
	return () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
}

// slabs — плиты дорожек (slabs.js list): камешки вдоль кромки дорожки (до 25 см
// от края) и мелкие в швах между плитами — у плит им самое место.
export async function loadRocks(map, slabs = []) {
	const { names, weights, W, H, origin } = map, CELL = map.size.x / W;
	const rnd = rng(9173);
	const pts = { pebble: [], rock: [] };
	for (const [ch, [pk, rk]] of Object.entries(SOURCES)) {
		const li = names.indexOf(ch);
		if (li < 0) continue;
		const wl = weights[li];
		for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
			const w = wl[j * W + i];
			if (w < 0.08) continue;
			for (const [kind, k] of [["pebble", pk], ["rock", rk]]) {
				let n = w * k;
				while (n > 0) {
					if (rnd() < Math.min(1, n)) pts[kind].push([origin.x + (i + rnd()) * CELL, origin.y + (j + rnd()) * CELL, rnd(), rnd(), rnd()]);
					n -= 1;
				}
			}
		}
	}
	for (const s of slabs) {
		const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
		// оси плиты в мире: вдоль (u) и поперёк (v); rotY — поворот вокруг Y
		const ux = c, uz = -sn, vx = sn, vz = c;
		for (let k = 0; k < 16; k++) {
			const r1 = rnd(), r2 = rnd(), side = rnd() < 0.5 ? -1 : 1;
			// точка на краю плиты: половина — поперёк (кромка дорожки), половина — вдоль (шов)
			let du, dv, joint;
			if (k % 2) { du = (r1 - 0.5) * s.sx; dv = side * (s.sz / 2 + 0.02 + 0.23 * r2 * r2); joint = false; }
			else { du = side * (s.sx / 2 + 0.008); dv = (r1 - 0.5) * s.sz; joint = true; }
			if (rnd() > (joint ? 0.3 : 0.7)) continue;
			const x = s.x + ux * du + vx * dv, z = s.z + uz * du + vz * dv;
			pts.pebble.push([x, z, joint ? 0.1 + 0.2 * rnd() : 0.35 + 0.5 * rnd(), rnd(), rnd()]);
		}
	}
	// корзины по 8 м
	const buckets = new Map();
	for (const kind of Object.keys(pts)) for (const p of pts[kind]) {
		const key = Math.floor(p[0] / BUCKET) + "," + Math.floor(p[1] / BUCKET);
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push([kind, p]);
	}

	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const [g0, g1] = await Promise.all(["rocks_lod0_web.glb", "rocks_lod1_web.glb"].map(f => loader.loadAsync(DIR + f)));
	const group = new THREE.Group();
	group.name = "Rocks";
	const meshOf = (scene, name) => { const n = scene.getObjectByName(name); return n && (n.isMesh ? n : n.getObjectsByProperty("isMesh", true)[0]); };
	// Геометрия формы: преобразование узлов (масштаб, поворот осей, раскладка в ряд)
	// запекается и нормируется по габариту — наибольший размер 1 м, начало снизу по центру.
	// Голая geometry без узла выходила огромной и висела над головой.
	const shapeGeo = (scene, name) => {
		scene.updateMatrixWorld(true);
		const src = meshOf(scene, name), geo = src.geometry.clone();
		for (const [n, a] of Object.entries(geo.attributes)) {
			if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized) continue;
			const f = new Float32Array(a.count * a.itemSize);
			for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
			geo.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize));
		}
		geo.applyMatrix4(src.matrixWorld);
		geo.computeBoundingBox();
		const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
		geo.translate(-c.x, -bb.min.y, -c.z);
		geo.scale(...Array(3).fill(1 / Math.max(size.x, size.y, size.z)));
		return { geo, mat: src.material };
	};
	const ims = {};   // kind → [lod] → [InstancedMesh по форме]
	for (const kind of Object.keys(SHAPES)) {
		ims[kind] = [g0, g1].map((g, l) => SHAPES[kind].map(nm => {
			const { geo, mat } = shapeGeo(g.scene, nm);
			const im = new THREE.InstancedMesh(geo, mat, CAP);
			im.count = 0;
			im.castShadow = l === 0; im.receiveShadow = true;
			im.frustumCulled = false;
			im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
			group.add(im);
			return im;
		}));
	}

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), v = new THREE.Vector3(), sc = new THREE.Vector3();
	const last = new THREE.Vector3(1e9, 0, 0);
	function place(im, p, kind) {
		if (im.count >= CAP) return;
		const s = kind === "pebble" ? 0.02 + 0.1 * p[2] * p[2] : 0.05 + 0.3 * p[2] * p[2] * p[2];
		q.setFromAxisAngle(up, p[3] * Math.PI * 2);
		v.set(p[0], -s * (0.05 + 0.15 * p[4]), p[1]);
		sc.set(s * (0.85 + 0.3 * p[4]), s, s * (0.85 + 0.3 * p[3]));
		m.compose(v, q, sc);
		im.setMatrixAt(im.count, m);
		im.setColorAt(im.count, col.set(PALETTE[Math.floor(p[3] * 97) % PALETTE.length]).multiplyScalar(0.85 + 0.3 * p[2]));
		im.count++;
	}
	function update(camera) {
		const cp = camera.position;
		if (Math.hypot(cp.x - last.x, cp.z - last.z) < 1 && Math.abs(cp.y - last.y) < 1) return;
		last.copy(cp);
		for (const kind in ims) for (const lv of ims[kind]) for (const im of lv) im.count = 0;
		// выше 25 м над землёй — камешков не видно вовсе
		if (cp.y < FAR) {
			const b0x = Math.floor((cp.x - FAR) / BUCKET), b1x = Math.floor((cp.x + FAR) / BUCKET);
			const b0z = Math.floor((cp.z - FAR) / BUCKET), b1z = Math.floor((cp.z + FAR) / BUCKET);
			for (let bx = b0x; bx <= b1x; bx++) for (let bz = b0z; bz <= b1z; bz++) {
				const list = buckets.get(bx + "," + bz);
				if (!list) continue;
				for (const [kind, p] of list) {
					// над подвалами и приямками земли нет — камешков тоже (иначе висят в воздухе подвала)
					if (api.holes.some(r => p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3])) continue;
					const dd = Math.hypot(p[0] - cp.x, p[1] - cp.z, cp.y);
					if (dd > FAR) continue;
					const shape = Math.floor(p[4] * 4) % 4;
					place(ims[kind][dd < NEAR ? 0 : 1][shape], p, kind);
				}
			}
		}
		for (const kind in ims) for (const lv of ims[kind]) for (const im of lv) {
			im.instanceMatrix.needsUpdate = true;
			if (im.instanceColor) im.instanceColor.needsUpdate = true;
		}
	}
	console.log(`[улица] камешки: галька ${pts.pebble.length}, камни ${pts.rock.length}, рисуются до ${FAR} м`);
	const api = { group, update, holes: [] };   // holes — вырезы в земле [x0, z0, x1, z1] (main.js)
	return api;
}
