import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { rectsOf, inRect } from "./district.js";

// Опоры, фонари и провода (blend, game/assets/models/props/poles/) по правилам
// district.json → poles. Модель: корень на земле в центре стойки, линия проводов
// вдоль +Z модели, траверсы поперёк (X); вылет фонаря — в +X (над дорогой).
// Узлы Wire_<n> — точки крепления проводов, по ярусам сверху вниз.
//
// Линия — цепочка опор вдоль улицы (или проезда) с шагом не больше step у кромки
// со стороны двора. Её рвут перекрёстки и дома; на концах линии — концевая
// опора с подкосом (подкос — в сторону линии, +Z). Провода — цепной линией
// между соседними опорами одной линии.

const DIR = "../game/assets/models/props/poles/";
const LOD_DIST = [25, 80];   // м
const KERB = 0.14;

function subtract(a, b, cuts) {
	let parts = [[a, b]];
	for (const [c0, c1] of cuts) parts = parts.flatMap(([p0, p1]) =>
		c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, c0], [c1, p1]].filter(([u, v]) => v - u > 0.01));
	return parts;
}

/** Точки вдоль отрезка [u0, u1] с шагом ≤ step, концы включены. */
function spaced(u0, u1, step) {
	const n = Math.max(1, Math.ceil((u1 - u0) / step));
	return Array.from({ length: n + 1 }, (_, i) => u0 + (u1 - u0) * i / n);
}

export async function loadPoles(d) {
	const P = d.poles;
	if (!P) return null;
	const group = new THREE.Group();
	group.name = "Poles";
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const cache = {};
	const load = f => cache[f] ||= loader.loadAsync(DIR + f).then(g => {
		g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return g.scene;
	});
	const [ix, iz] = [(d.interior[0] + d.interior[2]) / 2, (d.interior[1] + d.interior[3]) / 2];
	const blocked = (x, z) => d.buildings.some(b => rectsOf(b).some(r => inRect([x, z], r, 1.0)));

	// поставить опору: модель, точка, направление линии (dx, dz), куда вылет фонаря (+X модели)
	const wires = [];   // линии проводов: [[мировые точки крепления опоры 1], [опоры 2], …]
	async function place(name, x, z, dir, lampSide) {
		const lods = await Promise.all(["", "_lod1", "_lod2"].map(s => load(`${name}${s}_web.glb`)));
		const lod = new THREE.LOD();
		lods.forEach((s, i) => lod.addLevel(s.clone(), i ? LOD_DIST[i - 1] : 0, 0.1));
		// +Z модели → dir; при этом +X модели → (dir.z, −dir.x). Если вылет надо в другую сторону — разворот
		let rot = Math.atan2(dir[0], dir[1]);
		if (lampSide && (dir[1] * lampSide[0] - dir[0] * lampSide[1]) < 0) rot += Math.PI;
		lod.position.set(x, 0, z);
		lod.rotation.y = rot;
		lod.updateMatrixWorld(true);
		group.add(lod);
		// точки крепления — у ступени LOD0
		const pts = [];
		lod.levels[0].object.traverse(o => { const m = o.name.match(/^Wire_(\d+)/); if (m) pts[+m[1]] = o.getWorldPosition(new THREE.Vector3()); });
		return pts.filter(Boolean);
	}

	// Линия опор по отрезку оси: точки вдоль, концевые на концах, фонарь каждый lampEvery-й.
	async function line(pts, dir, lampSide, R, withWires) {
		const attach = [];
		for (const [i, [x, z]] of pts.entries()) {
			const end = i === 0 || i === pts.length - 1;
			let name = R.pole;
			if (end && R.anchor) name = R.anchor;
			else if (R.lamp && i % (R.lampEvery || 2) === 0) name = R.lamp;
			// концевая: подкос в сторону линии — у последней опоры линия уходит назад
			const d0 = i === pts.length - 1 && pts.length > 1 ? [-dir[0], -dir[1]] : dir;
			attach.push(await place(name, x, z, d0, lampSide));
		}
		if (withWires) wires.push({ attach, sag: R.sag || 0.015 });
	}

	const cutsOf = s => d.streets.filter(o => o.axis !== s.axis).map(o => [o.at - o.roadHalf - KERB - o.walk - 1.5, o.at + o.roadHalf + KERB + o.walk + 1.5]);
	// улицы: сторона двора — к центру квартала
	async function alongStreet(s, R, withWires) {
		const side = s.axis === "x" ? Math.sign(iz - s.at) : Math.sign(ix - s.at);
		const off = s.at + side * (s.roadHalf + (R.offset || 0.7));
		const dir = s.axis === "x" ? [1, 0] : [0, 1];
		const toRoad = s.axis === "x" ? [0, -side] : [-side, 0];
		for (const [u0, u1] of subtract(s.from, s.to, cutsOf(s))) {
			// дома рвут линию: разбить точки на куски без заблокированных
			let run = [];
			for (const u of spaced(u0, u1, R.step)) {
				const [x, z] = s.axis === "x" ? [u, off] : [off, u];
				if (blocked(x, z)) { if (run.length > 1) await line(run, dir, toRoad, R, withWires); run = []; continue; }
				run.push([x, z]);
			}
			if (run.length > 1) await line(run, dir, toRoad, R, withWires);
		}
	}
	if (P.streets) for (const s of d.streets) if (!(P.streets.except || []).includes(s.id)) await alongStreet(s, P.streets, true);
	if (P.masts) for (const s of d.streets) if (P.masts.streets.includes(s.id)) await alongStreet(s, { pole: P.masts.pole, step: P.masts.step, offset: P.masts.offset }, false);

	// дворы: деревянные опоры вдоль проездов, сбоку от оси
	if (P.yards) for (const w of d.driveways) for (let k = 1; k < w.path.length; k++) {
		const a = w.path[k - 1], b = w.path[k], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
		if (len < 8) continue;
		const dir = [dx / len, dz / len], nx = -dir[1], nz = dir[0], off = w.width / 2 + P.yards.offset;
		let run = [];
		for (const t of spaced(0, len, P.yards.step)) {
			const x = a[0] + dir[0] * t + nx * off, z = a[1] + dir[1] * t + nz * off;
			if (blocked(x, z)) { if (run.length > 1) await line(run, dir, null, P.yards, true); run = []; continue; }
			run.push([x, z]);
		}
		if (run.length > 1) await line(run, dir, null, P.yards, true);
	}

	// провода: цепная линия (парабола хватает при провисе 1–2 %) между соседними опорами
	const seg = [];
	for (const { attach, sag } of wires) for (let i = 1; i < attach.length; i++) {
		const A = attach[i - 1], B = attach[i], n = Math.min(A.length, B.length);
		if (!n) continue;
		const dirL = new THREE.Vector3().subVectors(B[0], A[0]).setY(0).normalize();
		const side = (v, o) => Math.sign(new THREE.Vector3().subVectors(v, o).cross(dirL).y);
		for (let w = 0; w < n; w++) {
			const p = A[w];
			// пара — точка того же яруса по ту же сторону линии (концевая в конце развёрнута)
			const tier = B.filter(c => Math.abs(c.y - p.y) < 0.05);
			const q = tier.find(c => side(c, B[0]) === side(p, A[0])) || tier[0] || B[w];
			const span = p.distanceTo(q), S = 12;
			for (let k = 0; k < S; k++) {
				const t0 = k / S, t1 = (k + 1) / S;
				const at = t => new THREE.Vector3().lerpVectors(p, q, t).setY(p.y + (q.y - p.y) * t - 4 * sag * span * t * (1 - t));
				seg.push(at(t0), at(t1));
			}
		}
	}
	// Провода — крест из двух тонких лент (вертикальной и горизонтальной) шириной
	// 2R: виден под любым углом и освещается, в отличие от линии в пиксель.
	if (seg.length) {
		const R = 0.008, pos = [], nrm = [], up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), side = new THREE.Vector3();
		const quad = (a, b, off, n) => {
			const a0 = a.clone().sub(off), a1 = a.clone().add(off), b0 = b.clone().sub(off), b1 = b.clone().add(off);
			for (const v of [a0, b0, b1, a0, b1, a1]) { pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z); }
		};
		for (let i = 0; i < seg.length; i += 2) {
			const a = seg[i], b = seg[i + 1];
			dir.subVectors(b, a).normalize();
			side.crossVectors(dir, up).normalize();
			quad(a, b, up.clone().multiplyScalar(R), side);             // вертикальная лента
			quad(a, b, side.clone().multiplyScalar(R), up);             // горизонтальная
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
		const wireMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
		wireMesh.name = "Wires";
		wireMesh.castShadow = true;
		group.add(wireMesh);
	}
	const count = group.children.filter(o => o.isLOD).length;
	console.log(`[улица] опоры: ${count}, отрезков провода ${seg.length / 2}`);
	return { group, count };
}
