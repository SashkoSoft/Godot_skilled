import * as THREE from "three";

// Лут (тестовый): три вида — золото, серебро, бронза. Где лежит — furnish.js (места у мебели),
// кто собрал — счёт у роботов и инвентарь героя. Здесь — только показ.

export const LOOT_KINDS = ["gold", "silver", "bronze"];
export const LOOT_RU = { gold: "золото", silver: "серебро", bronze: "бронза" };
export const LOOT_COLOR = { gold: "#f2c14e", silver: "#c9d1d9", bronze: "#c07a45" };

/** Табличка над роботом: три кружка со счётом. Холст перерисовывается только при изменении. */
export function makeBagLabel() {
	const cv = document.createElement("canvas");
	cv.width = 256; cv.height = 64;
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
	sp.scale.set(1.2, 0.3, 1);
	sp.renderOrder = 10;
	let last = "";
	sp.userData.set = bag => {
		const key = LOOT_KINDS.map(k => bag[k] || 0).join(",");
		if (key === last) return;
		last = key;
		const g = cv.getContext("2d");
		g.clearRect(0, 0, 256, 64);
		g.fillStyle = "rgba(10,12,14,0.72)";
		g.beginPath(); g.roundRect(4, 6, 248, 52, 14); g.fill();
		LOOT_KINDS.forEach((k, i) => {
			const x = 22 + i * 80;
			g.fillStyle = LOOT_COLOR[k]; g.beginPath(); g.arc(x, 32, 12, 0, Math.PI * 2); g.fill();
			g.fillStyle = "#f1ece2"; g.font = "bold 30px system-ui, sans-serif"; g.textBaseline = "middle";
			g.fillText(String(bag[k] || 0), x + 18, 33);
		});
		tex.needsUpdate = true;
	};
	sp.userData.set({});
	return sp;
}

/**
 * Карта лута: точки над местами у мебели, видны сквозь стены. Цвет — что лежит;
 * пустое — тёмно-серое, обысканное — почти прозрачное (серое мелкое).
 */
export function makeLootMap() {
	const geo = new THREE.BufferGeometry();
	const mat = new THREE.PointsMaterial({ size: 0.45, sizeAttenuation: true   /* м: вблизи крупнее, над кварталом — мелкой россыпью */, vertexColors: true, depthTest: false, transparent: true });
	const pts = new THREE.Points(geo, mat);
	pts.name = "LootMap"; pts.renderOrder = 20; pts.frustumCulled = false; pts.visible = false;
	const c = new THREE.Color();
	pts.userData.set = spots => {
		const pos = new Float32Array(spots.length * 3), col = new Float32Array(spots.length * 3);
		spots.forEach((s, i) => {
			pos.set(s.at, i * 3);
			c.set(s.looted ? "#3a3f45" : s.item ? LOOT_COLOR[s.item] : "#6b7078");
			col.set([c.r, c.g, c.b], i * 3);
		});
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
		geo.computeBoundingSphere();
	};
	return pts;
}
