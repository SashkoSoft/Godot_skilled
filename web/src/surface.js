import * as THREE from "three";

// Процедурное покрытие как ОБЫЧНЫЙ MeshStandardMaterial с инъекцией.
//
// Своего освещения у покрытия нет намеренно. Если считать свет внутри своего
// шейдера, улица и загруженные `.glb` окажутся под двумя разными моделями
// освещения и никогда не сойдутся: одна и та же стена будет разной на модели
// и на процедурной плите рядом. Через инъекцию покрытие получает тот же
// PBR-свет, те же тени, тот же туман и тот же тонемап, что и всё остальное,
// а от себя даёт только альбедо, шероховатость и нормаль.

const VERT_HEAD = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
`;

// `objectNormal` уже посчитан к моменту `begin_vertex`, `transformed` — тут же.
const VERT_BODY = /* glsl */ `
	vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
	vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
	vViewPos = (modelViewMatrix * vec4(transformed, 1.0)).xyz;
`;

/** Значения по умолчанию — те же, что стояли в игре на Godot. */
export const PRESETS = {
	walk:  { kind: 0, plate: 0.75, a: 0x7f7d76, b: 0x595854, j: 0x2b2b29 },
	road:  { kind: 1, plate: 1.00, a: 0x454546, b: 0x2a2a2b, j: 0x1a1a1b },
	kerb:  { kind: 0, plate: 1.00, a: 0x70706f, b: 0x545453, j: 0x2e2e2d },
	earth: { kind: 2, plate: 1.00, a: 0x45402d, b: 0x25241b, j: 0x1a1712 },
};

/**
 * @param {string} glsl  содержимое `shaders/surface.glsl`
 * @param {object} o     { kind, plate, joint, rough, a, b, j, latCenter, latHalf, marking, bump }
 */
export function makeSurfaceMaterial(glsl, o) {
	const mat = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		roughness: 1.0,
		metalness: 0.0,
	});

	// Держим свои uniform'ы на материале, а не в замыкании: `onBeforeCompile`
	// зовётся заново при пересборке программы, и ссылка должна пережить её.
	const u = {
		col_a: { value: new THREE.Color(o.a ?? 0x808080) },
		col_b: { value: new THREE.Color(o.b ?? 0x505050) },
		col_joint: { value: new THREE.Color(o.j ?? 0x282828) },
		plate: { value: o.plate ?? 0.75 },
		joint: { value: o.joint ?? 0.030 },
		rough_base: { value: o.rough ?? 0.92 },
		lat_center: { value: o.latCenter ?? 0.0 },
		lat_half: { value: Math.max(o.latHalf ?? 1.0, 0.05) },
		kind: { value: o.kind ?? 0 },
		marking: { value: o.marking ?? 0 },
		bump: { value: o.bump ?? 1.0 },
		debugMode: { value: 0 },
	};
	mat.userData.u = u;

	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, u);

		shader.vertexShader = VERT_HEAD + shader.vertexShader;
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			"#include <begin_vertex>\n" + VERT_BODY,
		);

		shader.fragmentShader = VERT_HEAD + glsl +
			"\nvec3 gAlb; float gRough; vec3 gNrmW;\n" +
			shader.fragmentShader;

		// Порядок в meshphysical_frag: map → roughnessmap → normal. Считаем всё
		// в первой точке и раскладываем по остальным через глобальные
		// переменные — они живут в пределах одного вызова main().
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			"surface(gAlb, gRough, gNrmW);\n\tdiffuseColor = vec4(gAlb, 1.0);",
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <roughnessmap_fragment>",
			"float roughnessFactor = gRough;",
		);
		// `normal` на этом месте — ВИДОВАЯ. Наша нормаль мировая.
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			"normal = normalize((viewMatrix * vec4(gNrmW, 0.0)).xyz);",
		);
	};

	// Все полосы делят одну программу: различаются только значения uniform'ов.
	mat.customProgramCacheKey = () => "surface";
	return mat;
}

/** Обойти все материалы покрытия разом — для отладочных режимов. */
export function setSurfaceUniform(root, name, value) {
	root.traverse((n) => {
		const u = n.material && n.material.userData && n.material.userData.u;
		if (u && u[name]) u[name].value = value;
	});
}
