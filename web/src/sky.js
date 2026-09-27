import * as THREE from "three";

// Небо: купол вокруг камеры со своим шейдером — градиент от дымки у горизонта к
// синеве в зените, ореол солнца, процедурные облака (fbm по проекции направления на
// плоскость облаков), плывут по ветру. Туман — цвета горизонта: дальнее тонет в
// дымке, а не в сером прямоугольнике. Купол без тумана и без записи глубины,
// рисуется первым.

export const skyUniforms = {
	uSunDir: { value: new THREE.Vector3(0, 1, 0) },
	uZenith: { value: new THREE.Color(0x4a76a8) },
	uHorizon: { value: new THREE.Color(0x9fa9b0) },
	uSunCol: { value: new THREE.Color(0xffe1b8) },
	uGlow: { value: new THREE.Color(0xffb27a) },   // цвет горизонта у солнца (как у дымки к солнцу)
	uCloud: { value: 0.55 },          // облачность 0…1 (#clouds=)
	uTime: { value: 0 },
	uWind: { value: new THREE.Vector2(1, 0) },
};

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
	vDir = normalize(position);
	vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = p.xyww;   // на дальней плоскости — за всем
}`;

const FRAG = /* glsl */`
uniform vec3 uSunDir, uZenith, uHorizon, uSunCol, uGlow;
uniform float uCloud, uTime;
uniform vec2 uWind;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	float s = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
	return s;
}
void main() {
	vec3 d = normalize(vDir);
	float up = max(d.y, 0.0);
	// градиент: у горизонта дымка, выше синева
	// горизонт: у солнца тёплое зарево, от солнца — холодный воздух (как у дымки)
	vec3 sh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z)), dh = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
	float toward = pow(max(dot(dh, sh), 0.0), 3.0);
	vec3 hor = mix(uHorizon, uGlow, toward * 0.9);
	vec3 col = mix(hor, uZenith, pow(smoothstep(0.0, 0.45 + 0.25 * toward, up), 0.6));
	// солнце: ореол и диск
	float sd = max(dot(d, normalize(uSunDir)), 0.0);
	col += uSunCol * (pow(sd, 8.0) * 0.25 + pow(sd, 64.0) * 0.4);
	col = mix(col, uSunCol * 3.0, smoothstep(0.9994, 0.9998, sd));
	// облака: проекция на плоскость, дальние сжаты к горизонту и тонут в дымке
	if (d.y > 0.01) {
		vec2 cp = d.xz / (d.y + 0.08) * 1.2 + uWind * uTime * 0.004;
		float n = fbm(cp) * 0.75 + fbm(cp * 3.1 + 4.0) * 0.25;
		float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.35, n);
		float lit = 0.75 + 0.35 * pow(sd, 3.0) + 0.15 * (fbm(cp * 2.0 + 1.3) - 0.5);
		// облака: снизу/в тени — холодные, к солнцу — подсвечены зарёй
		vec3 cc = mix(uHorizon * 0.8, mix(vec3(1.0, 0.97, 0.92), uGlow * 1.3, 0.6), clamp(lit - 0.4 + toward * 0.4, 0.0, 1.0));
		c *= smoothstep(0.01, 0.2, d.y);   // у горизонта облака растворяются в дымке
		col = mix(col, cc, c * 0.9);
	}
	// ниже горизонта — цвет дымки (туман земли)
	col = mix(col, hor, smoothstep(0.02, -0.05, d.y));
	gl_FragColor = vec4(col, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export function buildSky() {
	const mat = new THREE.ShaderMaterial({
		uniforms: skyUniforms, vertexShader: VERT, fragmentShader: FRAG,
		side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
	});
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
	mesh.name = "Sky";
	mesh.frustumCulled = false;
	mesh.renderOrder = -1;
	return {
		mesh,
		update(camera, t) { mesh.position.copy(camera.position); skyUniforms.uTime.value = t; },
	};
}
