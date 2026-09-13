import * as THREE from "three";
import { makeSurfaceMaterial, PRESETS } from "./surface.js";

// Раскладка от осевой линии проезда наружу, в метрах — те же числа, что были
// в игре. Полосы уходят за дальность тумана, поэтому их концов не видно ни с
// какого ракурса: это дешевле, чем строить квартал, который всё равно не
// разглядеть.

export const LAYOUT = {
	yWalk: 0.0,        // уровень тротуара — ноль сцены
	kerbH: 0.14,       // бордюр над асфальтом
	roadHalf: 3.60,    // полуширина проезда, две полосы
	kerbW: 0.14,
	walkW: 2.40,
	verge: 220.0,      // земля за тротуаром, до самого тумана
	lenHalf: 220.0,    // вдоль X
	thick: 0.30,       // плита не бумажная, иначе на кромке течёт свет
};

/**
 * Полоса вдоль X. У каждой — своя копия материала, знающая поперечную ось
 * ИМЕННО этой полосы: общий материал означал бы один `lat_center` на всех, и
 * колеи с намывом считались бы от чужой середины.
 */
function strip(group, glsl, preset, { width, cz, top, name, marking = 0 }) {
	const L = LAYOUT;
	const mat = makeSurfaceMaterial(glsl, {
		...preset,
		latCenter: cz,
		latHalf: width * 0.5,
		marking,
	});
	const geo = new THREE.BoxGeometry(L.lenHalf * 2, L.thick, width);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(0, top - L.thick * 0.5, cz);
	mesh.name = name;
	mesh.receiveShadow = true;
	mesh.castShadow = false;
	group.add(mesh);
	return mesh;
}

export function buildStreet(glsl) {
	const L = LAYOUT;
	const g = new THREE.Group();
	g.name = "Street";

	strip(g, glsl, PRESETS.road, {
		width: L.roadHalf * 2, cz: 0, top: L.yWalk - L.kerbH,
		name: "Road", marking: 1,
	});

	for (const s of [-1, 1]) {
		strip(g, glsl, PRESETS.kerb, {
			width: L.kerbW, cz: s * (L.roadHalf + L.kerbW * 0.5),
			top: L.yWalk, name: "Kerb",
		});
		strip(g, glsl, PRESETS.walk, {
			width: L.walkW, cz: s * (L.roadHalf + L.kerbW + L.walkW * 0.5),
			top: L.yWalk, name: "Walk",
		});
		strip(g, glsl, PRESETS.earth, {
			width: L.verge,
			cz: s * (L.roadHalf + L.kerbW + L.walkW + L.verge * 0.5),
			top: L.yWalk - 0.02, name: "Verge",
		});
	}
	return g;
}
