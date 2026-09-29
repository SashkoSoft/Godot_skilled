import * as THREE from "three";

// Двери домов hou: каждая створка — узел <id>_door_NNN (extras.part = "door_leaf"), пивот на
// оси петли, extras: hinge (мир), swing (+1/−1 — знак поворота вокруг +Y при открывании),
// width, floor, broken (руина). Рисуются одним BatchedMesh на дом (полотна) и одним — на
// стёкла подъездных: 540 отдельных узлов — это 540 вызовов отрисовки.
//
// Открываются сами: кто-то (игрок, робот) ближе OPEN_R к середине закрытой створки на том же
// этаже — поворот на swing·OPEN_ANGLE за OPEN_T; никого нет CLOSE_AFTER секунд — закрывается.
// Для героя закрытая и приоткрытая створка твёрдая: отрезок от петли до края (segments()).

const OPEN_R = 1.4, OPEN_ANGLE = THREE.MathUtils.degToRad(95), OPEN_T = 0.6, CLOSE_AFTER = 3;

function floatGeometry(g, m) {
	// только позиция, нормаль, uv — у всех створок одинаковый набор (BatchedMesh требует);
	// сжатые (int16) — во float
	const out = new THREE.BufferGeometry();
	for (const [name, n] of [["position", 3], ["normal", 3], ["uv", 2]]) {
		const a = g.attributes[name]; if (!a) continue;
		const f = new Float32Array(a.count * n);
		for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) f[i * n + c] = a.getComponent(i, c);
		out.setAttribute(name, new THREE.BufferAttribute(f, n));
	}
	if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
	if (!out.attributes.normal) out.computeVertexNormals();
	// индекс у всех (в одном BatchedMesh — либо у всех, либо ни у кого)
	out.setIndex(g.index ? Array.from(g.index.array) : Array.from({ length: out.attributes.position.count }, (_, i) => i));
	out.applyMatrix4(m);
	return out;
}

/**
 * Вынуть створки из сцены LOD0 дома (root) в BatchedMesh; вернуть управление дверями.
 * root должен быть уже на месте в мире (updateMatrixWorld).
 */
export function extractDoors(root) {
	root.updateMatrixWorld(true);
	const leaves = [];
	root.traverse(o => { if (o.userData && o.userData.part === "door_leaf") leaves.push(o); });
	if (!leaves.length) return null;
	const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const parts = { leaf: [], glass: [] };   // { geo, li }
	const items = [];
	for (const L of leaves) {
		const e = L.userData, li = items.length;
		const Linv = new THREE.Matrix4().copy(L.matrixWorld).invert();
		let leafMat = null, glassMat = null;
		L.traverse(m => {
			if (!m.isMesh) return;
			const kind = m.material.name === "glass" || (m.userData && m.userData.part === "glass") ? "glass" : "leaf";
			const rel = new THREE.Matrix4().multiplyMatrices(Linv, m.matrixWorld);   // меш → система петли
			parts[kind].push({ geo: floatGeometry(m.geometry, rel), li });
			if (kind === "glass") glassMat ||= m.material; else leafMat ||= m.material;
		});
		// пивот створки относительно корня дома и в мире
		const base = new THREE.Matrix4().multiplyMatrices(inv, L.matrixWorld);
		const hinge = new THREE.Vector3().setFromMatrixPosition(L.matrixWorld);
		// край створки в закрытом виде: самая дальняя от петли точка полотна по горизонтали
		let far = new THREE.Vector3(), fd = 0;
		for (const p of parts.leaf.filter(p => p.li === li)) {
			const a = p.geo.attributes.position;
			for (let i = 0; i < a.count; i++) {
				const d = Math.hypot(a.getX(i), a.getZ(i));
				if (d > fd) { fd = d; far.set(a.getX(i), 0, a.getZ(i)); }
			}
		}
		items.push({
			base, hinge, edge: far, floorY: hinge.y, swing: e.swing || 1, broken: !!e.broken || !e.hinge,
			angle: 0, target: 0, idle: 0, leafMat, glassMat,
		});
		L.parent.remove(L);
	}
	// BatchedMesh: полотна и стёкла
	const group = new THREE.Group(); group.name = "Doors";
	const batches = [];
	for (const kind of ["leaf", "glass"]) {
		const list = parts[kind]; if (!list.length) continue;
		let nv = 0, ni = 0;
		for (const p of list) { nv += p.geo.attributes.position.count; ni += p.geo.index.count; }
		const mat = items[list[0].li][kind === "leaf" ? "leafMat" : "glassMat"];
		const B = new THREE.BatchedMesh(list.length, nv, ni, mat);
		B.name = "doors-" + kind; B.castShadow = kind === "leaf"; B.receiveShadow = true;
		B.perObjectFrustumCulled = false;
		const ids = list.map(p => { const g = B.addGeometry(p.geo); const id = B.addInstance(g); B.setMatrixAt(id, items[p.li].base); return { id, li: p.li }; });
		group.add(B); batches.push({ B, ids });
	}
	root.add(group);
	for (const it of items) it.ids = [];
	for (const { B, ids } of batches) for (const x of ids) items[x.li].ids.push([B, x.id]);

	const rot = new THREE.Matrix4(), m = new THREE.Matrix4();
	function place(it) {
		rot.makeRotationY(it.angle * it.swing);
		m.multiplyMatrices(it.base, rot);
		for (const [B, id] of it.ids) B.setMatrixAt(id, m);
	}
	// раскладка по этажам и клеткам 4 м — искать ближних быстро
	const cell = new Map(), key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
	for (const it of items) {
		if (it.broken) continue;
		const cx = it.hinge.x + it.edge.x / 2, cz = it.hinge.z + it.edge.z / 2;
		it.center = new THREE.Vector3(cx, it.floorY, cz);
		const k = key(cx, cz); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(it);
	}
	const near = (x, z) => {
		const out = [], i = Math.floor(x / 4), j = Math.floor(z / 4);
		for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = cell.get(`${i + a},${j + b}`); if (l) out.push(...l); }
		return out;
	};

	const moving = new Set();
	/** agents — точки (Vector3) тех, кто ходит: игрок и роботы. */
	function update(dt, agents) {
		for (const p of agents) {
			for (const it of near(p.x, p.z)) {
				if (Math.abs(p.y - it.floorY) > 1.2) continue;
				if (Math.hypot(p.x - it.center.x, p.z - it.center.z) < OPEN_R) { it.target = 1; it.idle = 0; moving.add(it); }
			}
		}
		for (const it of moving) {
			if (it.target === 1) { it.idle += dt; if (it.idle > CLOSE_AFTER) it.target = 0; }
			const goal = it.target * OPEN_ANGLE, step = OPEN_ANGLE / OPEN_T * dt;
			it.angle += Math.sign(goal - it.angle) * Math.min(Math.abs(goal - it.angle), step);
			place(it);
			if (it.target === 0 && it.angle === 0) moving.delete(it);
		}
	}
	/** Твёрдые створки у точки: отрезки [x0, z0, x1, z1] (закрытые и в движении). */
	const e = new THREE.Vector3();
	function segments(p) {
		const out = [];
		for (const it of near(p.x, p.z)) {
			if (Math.abs(p.y - it.floorY) > 1.2) continue;
			e.copy(it.edge).applyAxisAngle(THREE.Object3D.DEFAULT_UP, it.angle * it.swing);
			out.push([it.hinge.x, it.hinge.z, it.hinge.x + e.x, it.hinge.z + e.z]);
		}
		return out;
	}
	console.log(`[улица] двери: створок ${items.length} (сломанных ${items.filter(i => i.broken).length}), вызовов ${batches.length}`);
	return { group, update, segments, count: items.length };
}
