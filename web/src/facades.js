import * as THREE from "three";

// Материалы зданий от HoudiniCOP (game/assets/textures/house_tiles.json:
// имя материала → набор и шаг тайла в метрах). Одна таблица на два применения:
//  • модели домов hou (houses.js) — у них UV в метрах;
//  • коробки блок-аута, пока дома выключены — у коробок UV нет в метрах,
//    поэтому проекция по мировым осям (трипланар по главной оси нормали):
//    шаг тайла одинаковый на любой коробке, как бы её ни растянули.

const TEX = "../game/assets/textures/";
let tablePromise = null;

/** { tile_m: {имя: м}, set: {имя: папка} } — одна загрузка на страницу. */
export function houseTiles() {
	return tablePromise || (tablePromise = fetch(TEX + "house_tiles.json").then(r => r.json()));
}

const cache = {};
/** Карты набора: albedo (sRGB), normal, ORM (R — затенение, G — шероховатость, B — металл). */
export function textureSet(dir) {
	if (cache[dir]) return cache[dir];
	const L = new THREE.TextureLoader(), name = dir.replace(/-/g, "_");
	const load = (suffix, srgb) => {
		const t = L.load(`${TEX}${dir}/${name}_${suffix}_1k.png`);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.anisotropy = 4;
		t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		return t;
	};
	return (cache[dir] = { map: load("albedo", true), normal: load("normal", false), orm: load("orm", false) });
}

/**
 * Коробка блок-аута в материале здания: проекция по мировым осям с шагом tile.
 * Цвет роли остаётся лёгким оттенком (tint 0…1), чтобы роли по-прежнему читались.
 */
/** sat — насыщенность альбедо (1 — как в наборе, 0 — серое): на большой коробке
 *  яркая краска с ржавчиной читается кислотным камуфляжем, её глушат. */
export function boxify(material, dir, tile, tint = 0.3, sat = 1) {
	const t = textureSet(dir);
	const role = material.color.clone();
	material.color.set(0xffffff).lerp(role, tint);
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			uBxMap: { value: t.map }, uBxNrm: { value: t.normal }, uBxOrm: { value: t.orm }, uBxTile: { value: tile }, uBxSat: { value: sat },
		});
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vBxPos;\nvarying vec3 vBxN;")
			.replace("#include <begin_vertex>", `#include <begin_vertex>
				vBxPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
				vBxN = normalize(mat3(modelMatrix) * objectNormal);`);
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>
				varying vec3 vBxPos;
				varying vec3 vBxN;
				uniform sampler2D uBxMap, uBxNrm, uBxOrm;
				uniform float uBxTile, uBxSat;
				// проекция по главной оси нормали: uv и касательный базис грани
				// (литералы только дробные: ANGLE под D3D считает vec3(int, int, float)
				// неоднозначным — программа «собрана», но не рисует, и ошибки не видно)
				void bxFrame(out vec2 uv, out vec3 T, out vec3 B, out vec3 N) {
					vec3 a = abs(vBxN);
					if (a.y >= a.x && a.y >= a.z) { uv = vBxPos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); N = vec3(0.0, sign(vBxN.y), 0.0); }
					else if (a.x >= a.z) { uv = vec2(vBxPos.z * sign(vBxN.x), vBxPos.y); T = vec3(0.0, 0.0, sign(vBxN.x)); B = vec3(0.0, 1.0, 0.0); N = vec3(sign(vBxN.x), 0.0, 0.0); }
					else { uv = vec2(-vBxPos.x * sign(vBxN.z), vBxPos.y); T = vec3(-sign(vBxN.z), 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); N = vec3(0.0, 0.0, sign(vBxN.z)); }
					uv /= uBxTile;
				}`)
			.replace("#include <map_fragment>", `#include <map_fragment>
				vec2 bxUv; vec3 bxT, bxB, bxN;
				bxFrame(bxUv, bxT, bxB, bxN);
				vec4 bxOrm = texture2D(uBxOrm, bxUv);
				vec3 bxAlb = texture2D(uBxMap, bxUv).rgb;
				bxAlb = mix(vec3(dot(bxAlb, vec3(0.3, 0.59, 0.11))), bxAlb, uBxSat);
				diffuseColor.rgb *= bxAlb * mix(1.0, bxOrm.r, 0.8);`)
			.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
				roughnessFactor = bxOrm.g;`)
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
				{
					vec3 tn = texture2D(uBxNrm, bxUv).xyz * 2.0 - 1.0;
					vec3 wn = normalize(bxT * tn.x + bxB * tn.y + bxN * tn.z);
					normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
				}`);
	};
	material.customProgramCacheKey = () => "box-" + dir;   // насыщенность — униформа, программа общая
	material.needsUpdate = true;
}
