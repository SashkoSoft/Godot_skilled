import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { houseTiles, textureSet } from "./facades.js";
import { dressZones } from "./zones.js";
import { extractDoors } from "./doors.js";

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
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);   // руины сжаты (tools/ruin_import.py)
	const group = new THREE.Group();
	group.name = "Houses";
	const ids = [], colliders = [], doors = [];   // doors — управление створками (doors.js), по дому   // коллизия домов (<id>_col.glb) — в мировых координатах, для игрока
	for (const b of d.buildings.filter(b => b.model)) {
		try {
			const dir = `${BASE}${b.model}/${b.model}`;
			const [l0, l1, l2] = await Promise.all([0, 1, 2].map(l => loader.loadAsync(`${dir}_lod${l}.glb`)));
			// дома с зонами материалов (b3, b4) — отделка по комнатам и панелям (zones.js, наборы blend)
			const info = await fetch(`${dir}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
			// руина: стёкла — отдельными файлами по ступеням
			if (info && info.glass_lods) {
				const gl = await Promise.all([0, 1, 2].map(l => loader.loadAsync(`${dir}_glass_lod${l}.glb`).catch(() => null)));
				gl.forEach((g, i) => { if (g) [l0, l1, l2][i].scene.add(g.scene); });
			}
			if (info && info.zones) {
				const z = [l0, l1, l2].map(g => dressZones(g.scene, info));
				console.log(`[улица] дом ${b.id}: зоны отделки на ступенях LOD ${z.join("/")} мешей`);
			}
			const lod = new THREE.LOD();
			lod.name = "house-" + b.id;
			for (const [i, g] of [l0, l1, l2].entries()) {
				dress(g.scene, T);
				lod.addLevel(g.scene, [0, 90, 200][i], 0.1);
			}
			// Геометрия может прийти уже в мировых координатах (так приходят дома hou),
			// а может — вокруг пивота в центре rect. Смотрим габарит: если его центр внутри
			// rect — дом уже на месте, не двигаем. (Раньше порог был 2 м от центра rect —
			// крыльцо и козырёк башни сдвигали центр габарита на 2.1 м, и башню переносили
			// второй раз, за край квартала.)
			const r = b.rect, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
			const bb = new THREE.Box3().setFromObject(l0.scene), c = bb.getCenter(new THREE.Vector3());
			// мировые координаты — если габарит накрывает центр участка (центр габарита не годится:
			// обломки руины b3 уходят к улице, и центр выезжал за rect — руину сдвигали второй раз)
			const inRect = bb.min.x < cx && bb.max.x > cx && bb.min.z < cz && bb.max.z > cz;
			if (!inRect) lod.position.set(cx, 0, cz);
			else {
				// Модель в мировых координатах: точка LOD — в центре дома, а ступени сдвинуты
				// обратно. Иначе LOD мерит расстояние от начала координат (башня b3 — в 100 м
				// от него): у дома рисовалась дальняя ступень без внутренних стен и перекрытий.
				lod.position.set(cx, 0, cz);
				for (const g of [l0, l1, l2]) g.scene.position.set(-cx, 0, -cz);
			}
			group.add(lod);
			ids.push(b.id);
			// Подвал — отдельной моделью (<id>_basement.glb, мировые оси): один и тот же под целым
			// домом и под руиной (удар его не задел), лежит в папке целого дома. Виден с ближней
			// ступенью LOD — снаружи его всё равно не видно.
			if (info && info.basement) {
				const bg = await loader.loadAsync(`${BASE}${b.id}/${b.id}_basement.glb`).catch(() => null);
				if (bg) { dressZones(bg.scene, info); dress(bg.scene, T); l0.scene.add(bg.scene); }
			}
			// створки — отдельными узлами у hou: в один BatchedMesh, открываются сами
			lod.updateMatrixWorld(true);
			const D = extractDoors(l0.scene);
			if (D) doors.push(D);
			// коллизия — фоном; её нет — игрок упирается в коробку габарита (см. player.js)
			loader.loadAsync(`${dir}_col.glb`).then(g => {
				g.scene.position.copy(lod.position); if (inRect) g.scene.position.set(0, 0, 0);
				if (!inRect) g.scene.position.set(cx, 0, cz);
				g.scene.updateMatrixWorld(true); colliders.push({ id: b.id, scene: g.scene });
			}).catch(() => {});
		} catch (e) {
			console.warn(`[улица] дом ${b.id}: модель ${b.model} не загрузилась — остаётся коробка (${e})`);
		}
	}
	// туннели между подвалами (tunnels.json hou): мировые оси, рисуются всегда (под землёй)
	const tunnels = await fetch(`${BASE}tunnels/tunnels.json`).then(r => r.ok ? r.json() : null).catch(() => null);
	for (const t of (tunnels && tunnels.tunnels) || []) {
		if (!t.houses.every(h => ids.includes(h))) continue;
		const g = await loader.loadAsync(`${BASE}tunnels/${t.file}`).catch(() => null);
		if (!g) continue;
		g.scene.name = "tunnel-" + t.id;
		// двусторонний: порода вокруг хода — оболочка с нормалями внутрь, обход граней не гарантирован
		g.scene.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.material.side = THREE.DoubleSide; } });
		group.add(g.scene);
	}
	return { group, ids, colliders, doors, tunnels: (tunnels && tunnels.tunnels) || [] };
}
