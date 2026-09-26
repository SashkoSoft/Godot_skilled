import * as THREE from "three";
import { rectsOf, inRect, accessPaths, streetRect } from "./district.js";
import { textureSet } from "./facades.js";

// Дорожки из бетонных плит — процедурно, по правилам district.json → slabs.
// Плиты кладутся рядами вдоль каждого отрезка дорожки: поперёк — сколько влезает
// целых плит, вдоль — с шагом плита + шов. У каждой плиты своя судьба (от хеша
// её ряда и места, раскладка повторяется):
//  • шов 1.2…3.5 см — чем «старее» участок (пятнами), тем шире;
//  • просадка до sink и перекос до tilt°;
//  • у дерева корни вздувают плиту: подъём до roots.lift и наклон от ствола;
//  • выпавшая (пусто — видна земля пола), расколотая (две половинки врозь).
// Под плитами коробки дорожки нет (blockout.js) — в швах и проёмах земля пола.
// Рисуется одним InstancedMesh; поверхность — пока бетон по мировой проекции,
// текстуры плит от HoudiniCOP лягут сюда же.

function hash(x, z) {
	const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return s - Math.floor(s);
}

/** Плиты: [{ x, z, y, sx, sz, rotY, tiltX, tiltZ, tone }] */
export function slabLayout(d, trees = []) {
	let S = d.slabs;
	// #broken=0.4 — доля битых плит для проверки (по умолчанию из district.json)
	const qb = typeof location !== "undefined" && new URLSearchParams(location.hash.slice(1)).get("broken");
	if (qb) S = { ...S, broken: +qb };
	if (!S) return [];
	const lines = [];
	if (S.on.includes("paths")) for (const p of d.paths) if (!p.trail) lines.push(p);
	if (S.on.includes("access")) lines.push(...accessPaths(d));
	// плиты не лежат на домах, асфальте проездов и улиц, на площадках с покрытием
	const segDist = (x, z, a, b) => {
		const dx = b[0] - a[0], dz = b[1] - a[1];
		const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
		return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
	};
	const HARD = ["parking", "sport", "playground", "bins"];
	const blocked = (x, z) => d.buildings.some(b => rectsOf(b).some(r => inRect([x, z], r, 0.2)))
		|| d.streets.some(s => inRect([x, z], streetRect(s), 0.3))
		|| d.driveways.some(w => w.path.some((a, i) => i > 0 && segDist(x, z, w.path[i - 1], a) < w.width / 2 + 0.3))
		|| d.areas.some(a => HARD.includes(a.kind) && a.rect && inRect([x, z], a.rect, 0.2));
	const out = [], taken = [];
	const occupied = (x, z, r) => taken.some(t => Math.hypot(t[0] - x, t[1] - z) < r);
	for (const [li, l] of lines.entries()) {
		const size = l.width < S.narrowBelow ? S.narrowSize : S.size;
		const across = Math.max(1, Math.floor(l.width / size + 0.2));
		for (let k = 1; k < l.path.length; k++) {
			const a = l.path[k - 1], b = l.path[k];
			const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
			if (len < 0.3) continue;
			const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
			const rotY = -Math.atan2(dz, dx);
			let t = 0, row = 0;
			while (t + size * 0.5 <= len) {
				// шов: пятнами «старости» участка
				const age = hash(Math.floor((a[0] + ux * t) / 7), Math.floor((a[1] + uz * t) / 7) + li);
				const joint = S.joint[0] + (S.joint[1] - S.joint[0]) * age * age;
				const cx = a[0] + ux * (t + size / 2), cz = a[1] + uz * (t + size / 2);
				for (let c = 0; c < across; c++) {
					const off = (c - (across - 1) / 2) * (size + joint);
					const x = cx + nx * off, z = cz + nz * off;
					// угол ломаной: плиты предыдущего отрезка уже лежат здесь
					if (occupied(x, z, size * 0.7) || blocked(x, z)) continue;
					taken.push([x, z]);
					const h1 = hash(x * 3.1, z * 1.7), h2 = hash(z * 2.3, x * 4.1), h3 = hash(x + z * 7.7, row + c);
					if (h3 < S.missing) continue;                       // выпала — видна земля
					let y = -(h1 * h1) * S.sink, tx = (h2 - 0.5) * 2 * S.tilt, tz = (h1 - 0.5) * 2 * S.tilt;
					// корни: ближнее дерево вздувает плиту и наклоняет от ствола
					let best = null;
					for (const tr of trees) {
						const dd = Math.hypot(tr[0] - x, tr[1] - z);
						if (dd < S.roots.dist && (!best || dd < best.dd)) best = { dd, tr };
					}
					if (best) {
						const k2 = 1 - best.dd / S.roots.dist;
						y += S.roots.lift * k2 * (0.6 + 0.4 * h2);
						const ax = (x - best.tr[0]) / (best.dd || 1), az = (z - best.tr[1]) / (best.dd || 1);
						tx += az * S.roots.tilt * k2; tz -= ax * S.roots.tilt * k2;
					}
					const tone = 0.88 + 0.2 * hash(x * 9.3, z * 5.9);
					const s = size - joint;
					// битая плита 1×1 — целая по геометрии, трещины и выбоины из маски
					// удара (HoudiniCOP, impact-*-1m-vN): номер маски в crack
					if (h3 < S.missing + S.broken && size >= 1.0) {
						out.push({ x, z, y: y - 0.004, sx: s, sz: s, rotY: rotY + Math.floor(h1 * 4) * Math.PI / 2, tiltX: tx, tiltZ: tz, tone, crack: Math.floor(h2 * 15) });
						continue;
					}
					// битая плита 1×1 — целая по геометрии, трещины и выбоины из маски удара
				// (HoudiniCOP, impact-*-1m-vN): номер маски в crack
				if (h3 < S.missing + S.broken && size >= 1.0) {
					out.push({ x, z, y: y - 0.004, sx: s, sz: s, rotY: rotY + Math.floor(h1 * 4) * Math.PI / 2, tiltX: tx, tiltZ: tz, tone, crack: Math.floor(h2 * 15) % 15 });
					continue;
				}
				if (h3 < S.missing + S.broken) {
						// расколота: две половинки вдоль, раздвинуты и перекошены по-разному
						for (const side of [-1, 1]) {
							const sh = side * (s / 4 + joint * 0.8);
							out.push({ x: x + ux * sh, z: z + uz * sh, y: y - 0.01 * (side + 1), sx: s / 2 - joint, sz: s, rotY: rotY + side * 0.03,
								tiltX: tx + side * 1.5, tiltZ: tz - side * 2, tone });
						}
						continue;
					}
					out.push({ x, z, y, sx: s, sz: s, rotY, tiltX: tx, tiltZ: tz, tone });
				}
				t += size + joint; row++;
			}
		}
	}
	return out;
}

// Плита с фаской: верх утоплен на bevel по периметру, скос вниз до боковин.
// Нормали плоские (по граням) — фаска ловит свет отдельной гранью.
function slabGeometry(sx, sz, h, bevel) {
	const x = sx / 2, z = sz / 2, b = bevel, top = 0.03, mid = top - b, bot = top - h;
	const P = {
		t: [[-x + b, top, -z + b], [x - b, top, -z + b], [x - b, top, z - b], [-x + b, top, z - b]],
		m: [[-x, mid, -z], [x, mid, -z], [x, mid, z], [-x, mid, z]],
		d: [[-x, bot, -z], [x, bot, -z], [x, bot, z], [-x, bot, z]],
	};
	const tri = [];
	const quad = (a, b2, c, d2) => tri.push(a, c, b2, a, d2, c);
	quad(P.t[0], P.t[1], P.t[2], P.t[3]);                                  // верх
	for (let i = 0; i < 4; i++) {
		const j = (i + 1) % 4;
		quad(P.t[i], P.m[i], P.m[j], P.t[j]);                             // фаска
		quad(P.m[i], P.d[i], P.d[j], P.m[j]);                             // боковина
	}
	quad(P.d[3], P.d[2], P.d[1], P.d[0]);                                  // низ
	// uv — метры в плоскости грани: верх/низ — (x, z); боковины и фаски — вдоль кромки
	// и по высоте (иначе на них текстура тянется полосами: x или z по высоте не меняются)
	const pos = new Float32Array(tri.flat()), uv = new Float32Array(tri.length * 2);
	for (let k = 0; k < tri.length; k += 3) {
		const [A, B, C] = [tri[k], tri[k + 1], tri[k + 2]];
		const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
		const ny = Math.abs(uz * vx - ux * vz), nx = Math.abs(uy * vz - uz * vy), nz = Math.abs(ux * vy - uy * vx);
		for (let j = 0; j < 3; j++) {
			const v = tri[k + j], o = (k + j) * 2;
			if (ny >= nx && ny >= nz) { uv[o] = v[0]; uv[o + 1] = v[2]; }         // верх, низ (и пологая фаска)
			else if (nx >= nz) { uv[o] = v[2]; uv[o + 1] = v[1] * 3; }           // боковина вдоль Z
			else { uv[o] = v[0]; uv[o + 1] = v[1] * 3; }                         // боковина вдоль X
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
	g.computeVertexNormals();
	return g;
}

/* ── маски удара и трава в трещинах (HoudiniCOP) ───────────────────── */
const CRACK_SIZE = 1.0;
const CRACK_SETS = [];
for (const k of ["few", "web", "vor"]) for (let v = 0; v < 5; v++) CRACK_SETS.push(`${k}-1m-v${v}`);
const emptyArr = () => { const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1); t.needsUpdate = true; return t; };
async function loadCracks() {
	const img = u => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
	try {
		const res = 512, S = res * res * 4, M = new Uint8Array(S * CRACK_SETS.length), N = new Uint8Array(S * CRACK_SETS.length);
		const gl = document.createElement("canvas").getContext("webgl2");
		// без премультипликации: альфа маски — «выбито», не прозрачность
		const raw = (im, keepMax) => {
			const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
			gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, im.width, im.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, im);
			const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
			const src = new Uint8Array(im.width * im.height * 4); gl.readPixels(0, 0, im.width, im.height, gl.RGBA, gl.UNSIGNED_BYTE, src);
			gl.deleteFramebuffer(fb); gl.deleteTexture(t);
			// 1k → 512: у маски максимум по блоку (тонкая трещина не пропадает), у нормали — среднее
			const out = new Uint8Array(S), f = im.width / res;
			for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) for (let c = 0; c < 4; c++) {
				let v = 0;
				for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) {
					const s = src[((j * f + y) * im.width + i * f + x) * 4 + c];
					v = keepMax ? Math.max(v, s) : v + s / (f * f);
				}
				out[(j * res + i) * 4 + c] = v;
			}
			return out;
		};
		for (const [i, s] of CRACK_SETS.entries()) {
			const base = `../game/assets/textures/impact-${s}/impact_${s.replace(/-/g, "_")}_`;
			const [m, n] = await Promise.all([img(base + "mask_1k.png"), img(base + "normal_1k.png")]);
			M.set(raw(m, true), i * S); N.set(raw(n, false), i * S);
		}
		const arr = data => { const t = new THREE.DataArrayTexture(data, res, res, CRACK_SETS.length); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
		console.log(`[улица] трещины плит: ${CRACK_SETS.length} масок`);
		return { m: arr(M), n: arr(N) };
	} catch (e) { console.warn("[улица] трещины плит: нет масок", e); return null; }
}
// Кустики в трещинах: glb на маску, пивот — центр плиты на уровне верха, оси — как у маски.
async function loadCrackGrass(group, broken) {
	if (!broken.length) return;
	const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
	const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
	const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), cache = {};
	let n = 0;
	for (const p of broken) {
		const f = `../game/assets/models/joint_grass/grass_crack_${CRACK_SETS[p.crack]}_lod1.glb`;
		try {
			const g = await (cache[f] ||= L.loadAsync(f));
			const o = g.scene.clone();
			o.position.set(p.x, p.y + 0.03, p.z);
			o.rotation.set(p.tiltX * Math.PI / 180, p.rotY, p.tiltZ * Math.PI / 180, "YXZ");
			o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
			group.add(o); n++;
		} catch { /* нет файла — плита без травы */ }
	}
	console.log(`[улица] трава в трещинах: ${n} плит`);
}

export function buildSlabs(d, trees = []) {
	const S = d.slabs;
	const list = slabLayout(d, trees);
	if (!list.length) return null;
	const joint = (S.joint[0] + S.joint[1]) / 2;
	// размеры плит в раскладке: целая и половинка расколотой — на каждый размер своя геометрия
	const nominal = s => Math.abs(s - (S.size - joint)) < Math.abs(s - (S.narrowSize - joint)) ? S.size - joint : S.narrowSize - joint;
	const group = new THREE.Group();
	group.name = "Slabs";
	// Бетон: у каждой плиты свой кусок текстуры (сдвиг, поворот на 90°), свой оттенок.
	// aSlab = (сдвиг u, сдвиг v, поворот 0…3, вариант) — вариант выберет текстуру плиты,
	// когда придут наборы HoudiniCOP.
	const tex = textureSet("concrete"), TILE = 2.5;
	const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughnessMap: tex.orm, roughness: 1, metalness: 0 });
	// маски удара — массивом (15 вариантов 1 м), грузятся фоном
	const crackU = { uCrackM: { value: emptyArr() }, uCrackN: { value: emptyArr() }, uCrackOn: { value: 0 } };
	loadCracks().then(c => { if (c) { crackU.uCrackM.value = c.m; crackU.uCrackN.value = c.n; crackU.uCrackOn.value = 1; } });
	// трава в трещинах — готовые кустики той же маски (HoudiniCOP joint_grass)
	loadCrackGrass(group, list.filter(p => p.crack !== undefined));
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, crackU);
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec4 aSlab;\nattribute float aCrack;\nvarying vec3 vCrackUv;")
			.replace("#include <uv_vertex>", `#include <uv_vertex>
				{
					vec2 su = uv;
					int r = int(aSlab.z + 0.5);
					if (r == 1) su = vec2(-su.y, su.x); else if (r == 2) su = -su; else if (r == 3) su = vec2(su.y, -su.x);
					su = (su + aSlab.xy) / ${TILE.toFixed(1)};
					vMapUv = su; vNormalMapUv = su; vRoughnessMapUv = su;
					// маска удара: верх плиты 0..1 (uv — метры от центра), номер маски; −1 — целая
					vCrackUv = vec3(uv / ${CRACK_SIZE.toFixed(2)} + 0.5, aCrack);
				}`);
		// Трещины по маске HoudiniCOP: R трещина (темнее), B оседание куска (тень),
		// A выбито — пикселя нет, видна земля; нормаль с фаской по кромке куска.
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vCrackUv;\nuniform highp sampler2DArray uCrackM, uCrackN;\nuniform float uCrackOn;")
			.replace("#include <map_fragment>", `#include <map_fragment>
				vec4 ckM = vec4(0.0); float ckOn = 0.0;
				if (uCrackOn > 0.5 && vCrackUv.z > -0.5 && all(greaterThan(vCrackUv.xy, vec2(0.0))) && all(lessThan(vCrackUv.xy, vec2(1.0)))) {
					ckM = textureLod(uCrackM, vCrackUv, 0.0); ckOn = 1.0;
					if (ckM.a > 0.5) discard;
					diffuseColor.rgb *= (1.0 - 0.75 * smoothstep(0.1, 0.6, ckM.r)) * (1.0 - 0.25 * ckM.b);
				}`)
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
				if (ckOn > 0.5) {
					vec3 cn = textureLod(uCrackN, vCrackUv, 0.0).xyz * 2.0 - 1.0;
					normal = normalize(normal + vec3(cn.x, cn.y, 0.0) * 0.8);
				}`);
	};
	mat.customProgramCacheKey = () => "slab-concrete-crack";
	const meshes = [];
	for (const near of [true, false]) {
		const bySize = {};
		list.forEach((p, i) => { const k = nominal(Math.max(p.sx, p.sz)).toFixed(3) + (p.sx < p.sz * 0.75 ? "h" : ""); (bySize[k] ||= []).push(i); });
		for (const [k, idx] of Object.entries(bySize)) {
			const full = parseFloat(k), half = k.endsWith("h");
			const sx = half ? full / 2 : full, sz = full;
			const geo = near ? slabGeometry(sx, sz, S.thick, 0.015) : slabGeometry(sx, sz, S.thick, 0.0005);
			const a = new Float32Array(idx.length * 4), ck = new Float32Array(idx.length).fill(-1);
			const im = new THREE.InstancedMesh(geo, mat, idx.length);
			const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
			idx.forEach((li, n) => {
				const p = list[li];
				e.set(p.tiltX * Math.PI / 180, p.rotY, p.tiltZ * Math.PI / 180, "YXZ");
				q.setFromEuler(e);
				m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx / sx, 1, p.sz / sz));
				im.setMatrixAt(n, m);
				// оттенок: светлее/темнее и чуть теплее/холоднее
				const h1 = hash(p.x * 5.1, p.z * 2.7), h2 = hash(p.z * 3.3, p.x * 6.1);
				im.setColorAt(n, col.setRGB(p.tone * (1.02 + 0.06 * (h2 - 0.5)), p.tone, p.tone * (0.98 - 0.08 * (h2 - 0.5))));
				a.set([h1 * 10, h2 * 10, Math.floor(hash(p.x, p.z * 1.9) * 4), Math.floor(hash(p.z, p.x * 2.3) * 6)], n * 4);
				if (p.crack !== undefined && !half) ck[n] = p.crack;
			});
			geo.setAttribute("aSlab", new THREE.InstancedBufferAttribute(a, 4));
			geo.setAttribute("aCrack", new THREE.InstancedBufferAttribute(ck, 1));
			im.castShadow = near; im.receiveShadow = true;
			im.userData.near = near;
			im.userData.pos = idx.map(li => new THREE.Vector3(list[li].x, 0, list[li].z));
			im.userData.mats = idx.map((_, n) => { const mm = new THREE.Matrix4(); im.getMatrixAt(n, mm); return mm; });
			im.frustumCulled = false;
			group.add(im); meshes.push(im);
		}
	}
	// LOD: ближе NEAR_M — плита с фаской, дальше — брусок
	const NEAR_M = 30, last = new THREE.Vector3(1e9, 0, 0);
	// Экземпляры не переставляются (сдвиг текстуры и цвет привязаны к номеру):
	// в ступени, где плита сейчас не нужна, её матрица — нулевая.
	const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
	function update(camera) {
		if (camera.position.distanceToSquared(last) < 0.25) return;
		last.copy(camera.position);
		for (const im of meshes) {
			const { pos, mats, near } = im.userData;
			for (let n = 0; n < pos.length; n++)
				im.setMatrixAt(n, (pos[n].distanceTo(camera.position) < NEAR_M) === near ? mats[n] : ZERO);
			im.instanceMatrix.needsUpdate = true;
		}
	}
	console.log(`[улица] плиты: ${list.length}`);
	return { group, update, count: list.length, material: mat, list };
}