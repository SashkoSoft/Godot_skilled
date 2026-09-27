import * as THREE from "three";
import { entrancePoint } from "./district.js";

// Тротуарная плитка 0.5×0.5 (HoudiniCOP paving-05m-v0/v1: тайл 2 м = 4×4 плитки,
// у каждой своя просадка, скол, пятна) — площадки у входов:
//  • у подъездов — крыльцо 3.5 × 2.5 м;
//  • у магазина (kind "shop") — площадка 10 × 5 м.
// Сетка плиток выровнена по мировым осям (входы — на сторонах N/S/E/W, дома по осям),
// вариант v0/v1 — пятнами. Поверх — те же накладки, что на асфальте (hardify lite).

const TEX = "../game/assets/textures/";

/** Прямоугольники площадок [x0, z0, x1, z1] — их же обходят плиты подходов (slabs.js). */
export function pavingPads(d) {
	const out = [];
	for (const b of d.buildings) for (const e of [].concat(b.entrances || [])) {
		const { p, n } = entrancePoint(b, e);
		const shop = b.kind === "shop";
		const w = shop ? 10 : 3.5, dep = shop ? 5 : 2.5;
		// вдоль стены — w, от стены наружу — dep; сетка кратна 0.5 м
		const snap = v => Math.round(v * 2) / 2;
		const cx = p[0] + n[0] * dep / 2, cz = p[1] + n[1] * dep / 2;
		const hx = n[0] ? dep / 2 : w / 2, hz = n[0] ? w / 2 : dep / 2;
		out.push([snap(cx - hx), snap(cz - hz), snap(cx + hx), snap(cz + hz)]);
	}
	return out;
}

function tex(path, srgb) {
	const t = new THREE.TextureLoader().load(TEX + path);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 4;
	t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	return t;
}

export function buildPaving(d) {
	const pads = pavingPads(d);
	if (!pads.length) return null;
	// плита толщиной 4 см, верх на +3.5 см (чуть выше плит подходов — не спорят глубиной)
	const geos = pads.map(([x0, z0, x1, z1]) => {
		const g = new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0);
		g.translate((x0 + x1) / 2, 0.015, (z0 + z1) / 2);
		return g;
	});
	const pos = [], nrm = [];
	for (const g of geos) {
		const gi = g.toNonIndexed();
		pos.push(...gi.attributes.position.array); nrm.push(...gi.attributes.normal.array);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
	// две раскладки плиток — пятнами; UV — мировые xz / 2 м (сетка на всех площадках одна)
	const v0 = ["albedo", "normal", "orm"].map((k, i) => tex(`paving-05m-v0/paving_05m_v0_${k}_2k.png`, i === 0));
	const v1 = ["albedo", "normal", "orm"].map((k, i) => tex(`paving-05m-v1/paving_05m_v1_${k}_2k.png`, i === 0));
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
	mat.onBeforeCompile = sh => {
		Object.assign(sh.uniforms, { uPA0: { value: v0[0] }, uPN0: { value: v0[1] }, uPO0: { value: v0[2] },
			uPA1: { value: v1[0] }, uPN1: { value: v1[1] }, uPO1: { value: v1[2] } });
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPvW;\nvarying float vPvUp;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPvW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPvUp = step(0.5, normalize(mat3(modelMatrix) * objectNormal).y);");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
				varying vec3 vPvW;
				varying float vPvUp;
				uniform sampler2D uPA0, uPN0, uPO0, uPA1, uPN1, uPO1;
				float pvH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
			.replace("#include <map_fragment>", `
				vec2 pvUv = vPvW.xz / 2.0;
				float pvK = step(0.5, pvH(floor(vPvW.xz / 6.0)));   // раскладка — кусками 6 м
				vec4 pvA = mix(texture2D(uPA0, pvUv), texture2D(uPA1, pvUv), pvK);
				vec4 pvO = mix(texture2D(uPO0, pvUv), texture2D(uPO1, pvUv), pvK);
				vec3 pvN = mix(texture2D(uPN0, pvUv), texture2D(uPN1, pvUv), pvK).xyz * 2.0 - 1.0;
				diffuseColor.rgb *= pvA.rgb * mix(1.0, pvO.r, 0.7);
				#include <map_fragment>`)
			.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = pvO.g;")
			// верх площадки: T = +X, B = +Z (uv = xz / 2), N = +Y — нормаль плитки в вид
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
				{
					vec3 wn = normalize(vec3(pvN.x, pvN.z, pvN.y));
					normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), vPvUp));
				}`);
	};
	mat.customProgramCacheKey = () => "paving";
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = "Paving";
	mesh.receiveShadow = true;
	console.log(`[улица] плитка: площадок ${pads.length}`);
	return { mesh, material: mat, pads };
}
