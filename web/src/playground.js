import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { windUniforms } from "./wind.js";

// Оборудование детских площадок (blend, game/assets/models/props/playground/) по
// данным: у площадки список equipment — { item, at: [dx, dz] от центра, rot° }.
// Корень модели — на земле по центру. Подвижные узлы шевелятся сами: двор
// заброшен, карусель ползёт и качели покачиваются от ветра, балансир лежит на покрышке (сила и порывы —
// те же windUniforms, что у деревьев и травы).

const DIR = "../game/assets/models/props/playground/";
const LOD_DIST = [20, 60];   // м

export async function loadPlayground(d) {
	const group = new THREE.Group();
	group.name = "Playground";
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const cache = {};
	const load = f => cache[f] ||= loader.loadAsync(DIR + f).then(g => {
		g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return g.scene;
	});
	const movers = [];   // { node, kind, phase }
	let count = 0;
	for (const a of d.areas) {
		if (!a.equipment || !a.rect) continue;
		const cx = (a.rect[0] + a.rect[2]) / 2, cz = (a.rect[1] + a.rect[3]) / 2;
		for (const [n, e] of a.equipment.entries()) {
			const lods = await Promise.all(["", "_lod1", "_lod2"].map(s => load(`playground_${e.item}${s}_web.glb`)));
			const lod = new THREE.LOD();
			const phase = n * 1.7 + cx * 0.13;
			lods.forEach((s, i) => {
				const c = s.clone();
				c.traverse(o => {
					if (/^Carousel_Rotor/.test(o.name)) movers.push({ node: o, kind: "rotor", phase, base: o.rotation.y });
					if (/^Swing_Seat/.test(o.name)) movers.push({ node: o, kind: "swing", phase, base: o.rotation.x });
					// балансир ветром не качается — брошен, одним концом лежит на покрышке (±12°)
					if (/^Seesaw_Beam/.test(o.name)) o.rotation.z += (phase % 2 < 1 ? 1 : -1) * 12 * Math.PI / 180;
				});
				lod.addLevel(c, i ? LOD_DIST[i - 1] : 0, 0.1);
			});
			lod.position.set(cx + e.at[0], 0, cz + e.at[1]);
			lod.rotation.y = -(e.rot || 0) * Math.PI / 180;   // на карте поворот по часовой при Z вниз
			lod.scale.setScalar(e.scale || 1);
			group.add(lod);
			count++;
		}
	}
	console.log(`[улица] площадки: предметов ${count}, подвижных узлов ${movers.length}`);

	// Раз в кадр: карусель ползёт по ветру (с остановками), качели покачиваются.
	let rot = 0;
	function update(t, dt) {
		const s = windUniforms.uWindStrength.value;
		const gust = 0.55 + 0.45 * Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1.3);
		rot += dt * 0.12 * s * Math.max(0, gust - 0.35);
		for (const m of movers) {
			if (m.kind === "rotor") m.node.rotation.y = m.base + rot + m.phase;
			else m.node.rotation.x = m.base + Math.sin(t * 1.9 + m.phase) * 0.12 * s * gust;   // ±7° при сильном ветре
		}
	}
	return { group, update, count };
}
