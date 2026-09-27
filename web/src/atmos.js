import * as THREE from "three";

// Атмосфера: настроение (закат / день) и воздушная перспектива.
//
// Туман three.js — плоская линейная заливка одним цветом. Здесь его куски шейдера
// (fog_*) подменяются для ВСЕХ материалов разом:
//  • плотность экспоненциальная и зависит от высоты — у земли дымка гуще, вверх
//    редеет (интеграл плотности вдоль луча, а не по одной точке);
//  • цвет по направлению взгляда: к солнцу — тёплое свечение, от солнца — холодная
//    синева; так появляется глубина планов (дальнее не просто светлеет, а уходит в воздух).
// Направление взгляда в вершинном шейдере — из mvPosition (после матрицы экземпляра),
// поэтому работает и для травы, деревьев, экземпляров.
// Параметры — константами в куске (солнце за сеанс не двигается); после смены
// настроения нужна перезагрузка.

export const MOODS = {
	sunset: {
		sunColor: 0xffa860, sunIntensity: 2.9, sunAz: -38, sunEl: 7,
		hemiSky: 0x8f9cc0, hemiGround: 0x5a4432, hemiIntensity: 1.15,
		fogColor: 0x8d96ad, fogSun: 0xffb27a, fogDensity: 0.0042, fogFalloff: 0.045,
		zenith: 0x3d5c92, horizon: 0xc79a86, exposure: 1.3,
	},
	day: {
		sunColor: 0xffe2c0, sunIntensity: 3.4, sunAz: 52, sunEl: 27,
		hemiSky: 0x9fb4c6, hemiGround: 0x4a4436, hemiIntensity: 1.6,
		fogColor: 0xa4acb4, fogSun: 0xf2e6d2, fogDensity: 0.0022, fogFalloff: 0.035,
		zenith: 0x4a76a8, horizon: 0x9fa9b0, exposure: 1.35,
	},
};

const f = v => v.toFixed(5);
const c3 = hex => { const c = new THREE.Color(hex); return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`; };

/** Подменить куски тумана. sunDir — единичный вектор на солнце (мир). */
export function installAerialFog(mood, sunDir) {
	const C = THREE.ShaderChunk;
	C.fog_pars_vertex = `#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogDir;
#endif`;
	C.fog_vertex = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;   // от камеры к точке, мир
#endif`;
	C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogDir;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
	C.fog_fragment = `#ifdef USE_FOG
	{
		float fDist = length(vFogDir);
		vec3 fDir = vFogDir / max(fDist, 1e-4);
		// дымка у земли: плотность a·exp(−b·y); интеграл вдоль луча от камеры до точки
		float y0 = cameraPosition.y, dy = vFogDir.y;
		const float A = ${f(mood.fogDensity)}, B = ${f(mood.fogFalloff)};
		float ey = exp(-B * max(y0, 0.0));
		float integ = abs(dy) > 0.01 ? A * fDist * ey * (1.0 - exp(-B * dy)) / (B * dy) : A * fDist * ey;
		float fogFactor = 1.0 - exp(-max(integ, 0.0));
		// цвет: к солнцу тёплое свечение, от солнца холодный воздух
		float sunA = pow(max(dot(fDir, ${`vec3(${f(sunDir.x)}, ${f(sunDir.y)}, ${f(sunDir.z)})`}), 0.0), 5.0);
		vec3 fCol = mix(${c3(mood.fogColor)}, ${c3(mood.fogSun)}, sunA);
		gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
	}
#endif`;
}

/** Виньетка — затемнение краёв кадра (CSS, бесплатно для GPU). */
export function addVignette() {
	const v = document.createElement("div");
	v.id = "vignette";
	v.style.cssText = "position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(20,10,5,0.38) 100%);";
	document.body.appendChild(v);
	return v;
}
