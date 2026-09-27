import * as THREE from "three";
import { entrancePoint } from "./district.js";
import { lodManifest, texUrl, texPx } from "./texlod.js";

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

// 4 раскладки (HoudiniCOP paving-05m-v0..v3): сетка и швы по краю у всех общие —
// раскладка выбирается на каждый блок 2×2 м без шва. Массивы (цвет, нормаль, ORM) —
// три сэмплера на все четыре (лимит 16 текстур под D3D).
async function pavingArrays(res = 1024) {
	const img = u => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
	const gl = document.createElement("canvas").getContext("webgl2");
	const raw = im => {
		const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, im.width, im.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, im);
		const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
		const src = new Uint8Array(im.width * im.height * 4); gl.readPixels(0, 0, im.width, im.height, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.deleteFramebuffer(fb); gl.deleteTexture(t);
		if (im.width === res) return src;
		const out = new Uint8Array(res * res * 4), f = im.width / res;
		for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) for (let c = 0; c < 4; c++) {
			let s = 0;
			for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) s += src[((j * f + y) * im.width + i * f + x) * 4 + c];
			out[(j * res + i) * 4 + c] = s / (f * f);
		}
		return out;
	};
	const S = res * res * 4, N = 4, K = ["albedo", "normal", "orm"];
	const data = K.map(() => new Uint8Array(S * N));
	const M = await lodManifest();
	await Promise.all([0, 1, 2, 3].map(async v => {
		const px = await Promise.all(K.map(k => img(texUrl(M, `paving-05m-v${v}`, k, res, "2k")).then(raw)));
		px.forEach((p, k) => data[k].set(p, v * S));
	}));
	return data.map((d, k) => {
		const t = new THREE.DataArrayTexture(d, res, res, N);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
		t.colorSpace = k === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		t.needsUpdate = true;
		return t;
	});
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
	const empty = () => { const t = new THREE.DataArrayTexture(new Uint8Array([140, 136, 128, 255]), 1, 1, 1); t.needsUpdate = true; return t; };
	const PU = { uPA: { value: empty() }, uPN: { value: empty() }, uPO: { value: empty() } };
	// ступени: сначала 512 (быстро), затем texPx; прежние массивы — из видеопамяти
	const apply = ([a, n, o]) => { for (const [u, t] of [[PU.uPA, a], [PU.uPN, n], [PU.uPO, o]]) { const old = u.value; u.value = t; old.dispose(); } };
	pavingArrays(Math.min(512, texPx)).then(apply)
		.then(() => texPx > 512 ? pavingArrays(texPx).then(apply) : null)
		.catch(e => console.warn("[улица] плитка: нет текстур", e));
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
	mat.onBeforeCompile = sh => {
		Object.assign(sh.uniforms, PU);
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPvW;\nvarying float vPvUp;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPvW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPvUp = step(0.5, normalize(mat3(modelMatrix) * objectNormal).y);");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
				varying vec3 vPvW;
				varying float vPvUp;
				uniform highp sampler2DArray uPA, uPN, uPO;
				float pvH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
			.replace("#include <map_fragment>", `
				vec2 pvUv = vPvW.xz / 2.0;
				// блок 2×2 м: своя раскладка (4) и свой поворот на 90° (4) — 16 видов; сетка
				// квадратная, швы по краю блока — стыка нет. Производные поворачиваются с uv,
				// XY нормали — обратно в мир.
				vec2 pvC = floor(pvUv), pvF = fract(pvUv);
				float pvHs = pvH(pvC);
				float pvL = floor(pvHs * 4.0);
				int pvR = int(fract(pvHs * 7.13) * 4.0);
				vec2 pdx = dFdx(pvUv), pdy = dFdy(pvUv);
				vec2 pvT = pvF;
				if (pvR == 1) { pvT = vec2(1.0 - pvF.y, pvF.x); pdx = vec2(-pdx.y, pdx.x); pdy = vec2(-pdy.y, pdy.x); }
				else if (pvR == 2) { pvT = 1.0 - pvF; pdx = -pdx; pdy = -pdy; }
				else if (pvR == 3) { pvT = vec2(pvF.y, 1.0 - pvF.x); pdx = vec2(pdx.y, -pdx.x); pdy = vec2(pdy.y, -pdy.x); }
				vec4 pvA = textureGrad(uPA, vec3(pvT, pvL), pdx, pdy);
				vec4 pvO = textureGrad(uPO, vec3(pvT, pvL), pdx, pdy);
				vec3 pvN = textureGrad(uPN, vec3(pvT, pvL), pdx, pdy).xyz * 2.0 - 1.0;
				if (pvR == 1) pvN.xy = vec2(pvN.y, -pvN.x);
				else if (pvR == 2) pvN.xy = -pvN.xy;
				else if (pvR == 3) pvN.xy = vec2(-pvN.y, pvN.x);
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
