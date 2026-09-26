import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LAYOUT } from "./street.js";

// Что из принятой библиотеки стоит на улице.
//
// Библиотека — обстановка опустевшей пятиэтажки, и это не мешает: когда дом
// бросают, мебель оказывается снаружи. Ванна в палисаднике, холодильник на
// проезжей части, батареи у бордюра — это не «поставить что нашлось», это
// ровно тот сюжет, который у нас в CONCEPT.
//
// Ставится с фиксированным сидом: улица должна быть одинаковой между
// запусками, иначе нельзя сравнить два кадра.

const BASE = "../game/assets/models/";

/** `zone`: verge — земля за тротуаром, walk — тротуар, road — проезд.
 *  `tip` — доля предметов, лежащих на боку. */
const PROPS = [
	{ file: "furniture/fridge.glb", n: 3, zone: "road", tip: 0.7 },
	{ file: "fixtures/bathtub.glb", n: 3, zone: "verge", tip: 0.3 },
	{ file: "furniture/wardrobe.glb", n: 2, zone: "verge", tip: 0.9 },
	{ file: "furniture/dresser.glb", n: 3, zone: "verge", tip: 0.5 },
	{ file: "furniture/nightstand.glb", n: 4, zone: "verge", tip: 0.6 },
	{ file: "furniture/kitchen_chair.glb", n: 6, zone: "walk", tip: 0.7 },
	{ file: "furniture/kitchen_table.glb", n: 2, zone: "walk", tip: 0.4 },
	{ file: "furniture/radiator.glb", n: 5, zone: "walk", tip: 0.8 },
	{ file: "fixtures/stove.glb", n: 2, zone: "verge", tip: 0.4 },
	{ file: "fixtures/washbasin.glb", n: 2, zone: "verge", tip: 0.6 },
	{ file: "fixtures/toilet.glb", n: 2, zone: "verge", tip: 0.5 },
	{ file: "furniture/kitchen_counter.glb", n: 2, zone: "walk", tip: 0.5 },
	{ file: "doors/door_broken.glb", n: 3, zone: "verge", tip: 0.9 },
	{ file: "doors/door_flat.glb", n: 2, zone: "road", tip: 1.0 },
	{ file: "windows/window_broken.glb", n: 3, zone: "verge", tip: 0.8 },
	// Перила лестничного марша — единственное, что стоит не мусором:
	// вдоль кромки тротуара они читаются уличным ограждением.
	{ file: "stairs/railing_flight.glb", n: 8, zone: "fence", tip: 0.0 },
];

/** Генератор с сидом: нужен воспроизводимый мир, а не каждый раз новый. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const L = LAYOUT;
const WALK_IN = L.roadHalf + L.kerbW;
const WALK_OUT = WALK_IN + L.walkW;

// Мебель не рассыпается ровным слоем по улице: её выносят из подъездов и
// сваливают кучами. Равномерный разброс читается мусором, высыпанным с
// самолёта, а кучи — жизнью, которая тут была.
const DUMPS = [-34, -19, -6, 8, 23, 37];

function spot(zone, r) {
	const side = r() < 0.5 ? -1 : 1;
	// В куче или сам по себе: каждый пятый предмет отбился в сторону.
	const x = r() < 0.8
		? DUMPS[Math.floor(r() * DUMPS.length)] + (r() + r() - 1) * 4.0
		: (r() * 2 - 1) * 44.0;
	switch (zone) {
		case "road":
			return [x, L.yWalk - L.kerbH, (r() * 2 - 1) * (L.roadHalf - 0.8)];
		case "walk":
			return [x, L.yWalk, side * (WALK_IN + 0.4 + r() * (L.walkW - 0.8))];
		case "fence":
			return [x, L.yWalk, side * (WALK_OUT - 0.22)];
		default:
			return [x, L.yWalk - 0.02, side * (WALK_OUT + 0.7 + r() * 7.0)];
	}
}

export async function loadProps(onStatus) {
	const loader = new GLTFLoader();
	const group = new THREE.Group();
	group.name = "Props";
	const r = rng(20260914);

	const loaded = await Promise.all(PROPS.map((p) =>
		loader.loadAsync(BASE + p.file)
			.then((g) => ({ p, scene: g.scene }))
			.catch(() => ({ p, scene: null }))));

	let placed = 0;
	const missing = [];
	for (const { p, scene } of loaded) {
		if (!scene) { missing.push(p.file); continue; }
		scene.traverse((n) => {
			if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
		});
		for (let i = 0; i < p.n; i++) {
			const o = scene.clone(true);
			const [x, y, z] = spot(p.zone, r);
			o.rotation.y = p.zone === "fence"
				? (z > 0 ? 0 : Math.PI)
				: r() * Math.PI * 2;
			// Опрокинутые падают ВПЕРЁД или НАЗАД (поворот вокруг X), а не
			// набок вокруг Z: от Z шкаф и дверное полотно встают на узкое
			// ребро и балансируют, как карта. Пивот после поворота уже не в
			// основании, поэтому высоту берём по коробке.
			if (r() < p.tip) {
				o.rotation.x = (r() < 0.5 ? 1 : -1) * Math.PI * 0.5;
				o.rotation.z = (r() - 0.5) * 0.28;
			}
			o.position.set(x, y, z);
			o.updateMatrixWorld(true);
			const box = new THREE.Box3().setFromObject(o);
			// Сажаем на поверхность и слегка топим: предмет, лежащий ровно
			// на плоскости, читается приклеенным.
			o.position.y += y - box.min.y - r() * 0.03;
			group.add(o);
			placed++;
		}
	}

	if (onStatus) {
		onStatus(missing.length
			? `предметов ${placed}, не открылись: ${missing.join(", ")}`
			: `расставлено ${placed} предметов из ${PROPS.length} моделей`,
			missing.length > 0);
	}
	return group;
}
