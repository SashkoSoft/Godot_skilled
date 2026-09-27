import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { houseTiles, textureSet } from "./facades.js";

// Дома квартала от сессии hou: game/assets/models/houses/<id>/<id>_lod{0,1,2}.glb.
// Пивот — центр прямоугольника rect из district.json на уровне тротуара, оси
// наши (X восток, Z юг). Узлы поэтажные: b5_<part>_fNN + extras.floor — под
// срез по этажам. Материалы в GLB — заглушки по имени; общие наборы текстур
// кладутся здесь. UV у hou в метрах (1 = 1 м), поэтому повтор = 1 / шаг набора.

const BASE = "../game/assets/models/houses/";
const TEX = "../game/assets/textures/";

// Имя материала в GLB → набор и шаг тайла — из таблицы HoudiniCOP (house_tiles.json),
// одной на дома и на коробки блок-аута. Кирпич там пока черновик (до сверки с hou).
// UV у hou в метрах, поэтому повтор = 1 / шаг.
const repCache = {};
function tiled(dir, tile) {
	const key = dir + tile;
	if (repCache[key]) return repCache[key];
	const s = textureSet(dir), rep = t => { const c = t.clone(); c.repeat.set(1 / tile, 1 / tile); c.needsUpdate = true; return c; };
	return (repCache[key] = { map: rep(s.map), normalMap: rep(s.normal), orm: rep(s.orm), ormHeight: s.ormHeight });
}

function dress(root, T) {
	root.traverse(o => {
		if (!o.isMesh) return;
		o.castShadow = true; o.receiveShadow = true;
		const mats = Array.isArray(o.material) ? o.material : [o.material];
		for (const m of mats) {
			const dir = T.set[m.name], tile = T.tile_m[m.name];
			if (!dir || !tile || !m.isMeshStandardMaterial) continue;
			const t = tiled(dir, tile);
			m.map = t.map; m.normalMap = t.normalMap;
			m.aoMap = t.orm; m.roughnessMap = t.orm;
			// у наборов с высотой в ORM.B металла в карте нет — и металличность 0 (в glTF по умолчанию 1)
			m.metalnessMap = t.ormHeight ? null : t.orm;
			if (t.ormHeight) m.metalness = 0;
			m.color.set(0xffffff);
			m.needsUpdate = true;
		}
	});
}

/**
 * Загрузить модели домов, у которых в district.json есть поле model.
 * Возвращает группу и список id — их коробки в блок-ауте надо спрятать.
 * LOD — штатный THREE.LOD с запасом 10 % на порогах (дом целиком, не по кускам).
 */
export async function loadHouses(d) {
	const T = await houseTiles();
	T.set.brick_silicate ??= T.set.blocks; T.tile_m.brick_silicate ??= T.tile_m.blocks;   // старое имя силикатного кирпича в GLB
	const loader = new GLTFLoader();
	const group = new THREE.Group();
	group.name = "Houses";
	const ids = [];
	for (const b of d.buildings.filter(b => b.model)) {
		try {
			const dir = `${BASE}${b.model}/${b.model}`;
			const [l0, l1, l2] = await Promise.all([0, 1, 2].map(l => loader.loadAsync(`${dir}_lod${l}.glb`)));
			const lod = new THREE.LOD();
			lod.name = "house-" + b.id;
			for (const [i, g] of [l0, l1, l2].entries()) {
				dress(g.scene, T);
				lod.addLevel(g.scene, [0, 90, 200][i], 0.1);
			}
			// Геометрия может прийти уже в мировых координатах (так пришёл b5),
			// а может — вокруг пивота в центре rect. Смотрим габарит: если он уже
			// стоит на месте дома — не двигаем, иначе переносим в центр rect.
			const r = b.rect, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
			const bb = new THREE.Box3().setFromObject(l0.scene), c = bb.getCenter(new THREE.Vector3());
			if (Math.hypot(c.x - cx, c.z - cz) > 2) lod.position.set(cx, 0, cz);
			group.add(lod);
			ids.push(b.id);
		} catch (e) {
			console.warn(`[улица] дом ${b.id}: модель ${b.model} не загрузилась — остаётся коробка (${e})`);
		}
	}
	return { group, ids };
}
