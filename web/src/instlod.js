import * as THREE from "three";

// Однотипные предметы с LOD (опоры, урны, скамейки…) — в экземпляры.
//
// THREE.LOD на каждый предмет — это по вызову отрисовки на каждую деталь каждого
// предмета, и в кадре, и в тени: 86 опор давали 377 вызовов. Здесь предметы
// группы, собранные из одних и тех же моделей (клоны делят геометрию и материал),
// сворачиваются в одну InstancedMesh на (геометрия, материал) — вызовов столько,
// сколько разных деталей. Ступень LOD выбирается каждый кадр по дистанции (пороги
// берутся из самих LOD, с запасом от дрожи), предмет вне кадра не рисуется, если
// и тень его в кадр не падает.
//
// Годится для неподвижного: матрицы запекаются один раз. Подвижные узлы
// (качели, двери) — не сюда.

const HYST = 0.1;

/**
 * Свернуть все THREE.LOD — прямых детей group — в экземпляры. Остальных детей
 * не трогает. sun — единичный вектор на солнце (для отсечения с тенью).
 * Возвращает { update(camera), stats } или null, если LOD в группе нет.
 */
export function instanceLods(group, { sun = null } = {}) {
	const lods = group.children.filter(o => o.isLOD);
	if (!lods.length) return null;
	group.updateMatrixWorld(true);
	const buckets = new Map();   // "geo|mat" → { geo, mat, cast, recv, list: [] }
	const items = [];
	const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
	for (const lod of lods) {
		const levels = lod.levels.map(({ object, distance }) => {
			const parts = [];
			inv.copy(lod.matrixWorld).invert();
			object.traverse(o => {
				if (!o.isMesh || !o.visible) return;
				const key = o.geometry.uuid + "|" + o.material.uuid;
				let b = buckets.get(key);
				if (!b) buckets.set(key, b = { geo: o.geometry, mat: o.material, cast: o.castShadow, recv: o.receiveShadow, n: 0 });
				b.n++;
				rel.multiplyMatrices(inv, o.matrixWorld);   // деталь относительно корня предмета
				parts.push({ b, m: new THREE.Matrix4().multiplyMatrices(lod.matrixWorld, rel) });
			});
			return { distance, parts };
		});
		// габарит — по ближней ступени
		const box = new THREE.Box3().setFromObject(lod.levels[0].object);
		const sph = box.getBoundingSphere(new THREE.Sphere());
		items.push({ id: items.length, levels, center: sph.center, r: sph.radius, h: Math.max(box.max.y - box.min.y, 0.5), cur: -1 });
		group.remove(lod);
	}
	for (const b of buckets.values()) {
		b.im = new THREE.InstancedMesh(b.geo, b.mat, b.n);
		b.im.castShadow = b.cast; b.im.receiveShadow = b.recv;
		b.im.frustumCulled = false;   // отсечение — по предметам, в update
		b.im.count = 0;
		b.ids = new Int32Array(b.n).fill(-1);   // что лежит в ячейке: не поменялось — не отправляем
		group.add(b.im);
	}

	const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
	const shadowK = sun ? new THREE.Vector2(-sun.x, -sun.z).normalize().multiplyScalar(1 / Math.max(Math.tan(Math.asin(sun.y)), 0.05)) : null;
	const stats = { items: items.length, drawn: 0, calls: buckets.size };
	function inView(it) {
		sph.center.copy(it.center); sph.radius = it.r;
		if (frustum.intersectsSphere(sph)) return true;
		if (!shadowK) return false;
		sph.center.set(it.center.x + shadowK.x * it.h, 0, it.center.z + shadowK.y * it.h);
		sph.radius = Math.max(it.r * 0.5, it.h * 0.3);
		return frustum.intersectsSphere(sph);
	}

	function update(camera) {
		camera.updateMatrixWorld();
		frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
		for (const b of buckets.values()) b.im.count = 0;
		stats.drawn = 0;
		for (const it of items) {
			if (!inView(it)) continue;
			const d = it.center.distanceTo(camera.position), L = it.levels;
			let l = it.cur < 0 ? 0 : it.cur;
			if (it.cur < 0) while (l < L.length - 1 && d >= L[l + 1].distance) l++;
			while (l < L.length - 1 && d > L[l + 1].distance * (1 + HYST)) l++;
			while (l > 0 && d < L[l].distance * (1 - HYST)) l--;
			it.cur = l;
			for (const { b, m } of L[l].parts) {
				const i = b.im.count++, id = it.id * 4 + l;
				if (b.ids[i] !== id) { b.ids[i] = id; b.im.setMatrixAt(i, m); b.dirty = true; }
			}
			stats.drawn++;
		}
		for (const b of buckets.values()) {
			b.im.visible = b.im.count > 0;   // пустые — мимо рендера (программа, униформы)
			if (!b.dirty) continue;
			b.dirty = false;
			const a = b.im.instanceMatrix;
			a.clearUpdateRanges(); a.addUpdateRange(0, b.im.count * 16); a.needsUpdate = true;
		}
	}
	return { update, stats };
}
