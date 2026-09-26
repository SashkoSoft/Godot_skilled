import * as THREE from "three";
import { rectsOf, inRect, accessPaths, streetRect } from "./district.js";

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
					// Поверхность плиты — вариант HoudiniCOP (slab-<размер>-<вариант>): 0 свежая,
					// 1 стёртая, 2 треснувшая, 3 со сколом (дыра — земля), 4 в пятнах. Битые —
					// «треснувшая», редко «со сколом»; остальные — свежая/стёртая/в пятнах.
					const hv = hash(x * 7.7 + 1.3, z * 3.9);
					const v = h3 < S.missing + S.broken ? (hv < 0.8 ? 2 : 3)
						: hv < 0.06 ? 3 : hv < 0.36 ? 0 : hv < 0.78 ? 1 : 4;
					out.push({ x, z, y: v === 2 ? y - 0.004 : y, sx: s, sz: s, rotY, tiltX: tx, tiltZ: tz, tone,
						v, size, rot: Math.floor(h1 * 4) });
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

/* ── поверхности плит (HoudiniCOP: slab-1m-*, slab-05m-*) ──────────────── */
// Одна плита на картинку, кромка по краю. Массивы: A albedo+height, B normal.xy +
// roughness + AO, M маска (R трещина, G пятна, B лишайник, A выбито). Слой =
// размер×5 + вариант. Разрешение 512 — ~1–2 мм/пиксель, вблизи хватает.
const SLAB_VARS = ["fresh", "worn", "cracked", "chipped", "stained"];
const SLAB_SIZES = [["1m", "1k"], ["05m", "05k"]];
const emptyArr = () => { const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1); t.needsUpdate = true; return t; };
async function loadSlabSets(res = 512) {
	const img = u => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
	const gl = document.createElement("canvas").getContext("webgl2");
	// сырые байты без премультипликации (альфа — «выбито» и высота, не прозрачность)
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
			let v = 0;
			for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) v += src[((j * f + y) * im.width + i * f + x) * 4 + c];
			out[(j * res + i) * 4 + c] = v / (f * f);
		}
		return out;
	};
	const N = SLAB_SIZES.length * SLAB_VARS.length, S = res * res * 4;
	const A = new Uint8Array(S * N), B = new Uint8Array(S * N), M = new Uint8Array(S * N);
	let li = 0;
	for (const [sz, tag] of SLAB_SIZES) for (const v of SLAB_VARS) {
		const base = `../game/assets/textures/slab-${sz}-${v}/slab_${sz}_${v}_`;
		const [a, n, o, h, m] = await Promise.all(["albedo", "normal", "orm", "height", "mask"].map(k => img(`${base}${k}_${tag}.png`).then(raw)));
		const off = li * S;
		for (let k = 0; k < S; k += 4) {
			A[off + k] = a[k]; A[off + k + 1] = a[k + 1]; A[off + k + 2] = a[k + 2]; A[off + k + 3] = h[k];
			B[off + k] = n[k]; B[off + k + 1] = n[k + 1]; B[off + k + 2] = o[k + 1]; B[off + k + 3] = o[k];
			M[off + k] = m[k]; M[off + k + 1] = m[k + 1]; M[off + k + 2] = m[k + 2]; M[off + k + 3] = m[k + 3];
		}
		li++;
	}
	const arr = (data, srgb) => {
		const t = new THREE.DataArrayTexture(data, res, res, N);
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
		t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
		return t;
	};
	console.log(`[улица] плиты: поверхности ${N} (${SLAB_VARS.join(",")})`);
	return { A: arr(A, true), B: arr(B, false), M: arr(M, false) };
}

export function buildSlabs(d, trees = []) {
	const S = d.slabs;
	const list = slabLayout(d, trees);
	if (!list.length) return null;
	const joint = (S.joint[0] + S.joint[1]) / 2;
	const group = new THREE.Group();
	group.name = "Slabs";
	// Материал: верх плиты — её вариант (своя картинка на плиту, поворот ×90°),
	// боковины — тот же вариант по развёртке граней. Оттенок экземпляра — поверх.
	const U = { uSA: { value: emptyArr() }, uSB: { value: emptyArr() }, uSM: { value: emptyArr() }, uSOn: { value: 0 } };
	loadSlabSets().then(s => { U.uSA.value = s.A; U.uSB.value = s.B; U.uSM.value = s.M; U.uSOn.value = 1; })
		.catch(e => console.warn("[улица] плиты: нет поверхностей", e));
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, U);
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec4 aSlab;\nvarying vec3 vSUv;\nvarying float vSTop;")
			.replace("#include <uv_vertex>", `#include <uv_vertex>
				{
					// aSlab = (размер плиты, 0, поворот 0…3, слой массива)
					vec2 su = uv;
					vSTop = step(0.9, normal.y);
					if (vSTop > 0.5) {
						int r = int(aSlab.z + 0.5);
						if (r == 1) su = vec2(-su.y, su.x); else if (r == 2) su = -su; else if (r == 3) su = vec2(su.y, -su.x);
						su = su / aSlab.x + 0.5;
					} else su = su / aSlab.x;
					vSUv = vec3(su, aSlab.w);
				}`);
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vSUv;\nvarying float vSTop;\nuniform highp sampler2DArray uSA, uSB, uSM;\nuniform float uSOn;")
			// до map_fragment: накладки (hardify) ложатся поверх цвета плиты
			.replace("#include <map_fragment>", `
				vec4 sA = vec4(0.55, 0.53, 0.5, 0.5), sB = vec4(0.5, 0.5, 0.9, 1.0);
				if (uSOn > 0.5) {
					sA = texture(uSA, vSUv); sB = texture(uSB, vSUv);
					vec4 sM = texture(uSM, vSUv);
					if (vSTop > 0.5 && sM.a > 0.5) discard;          // скол насквозь — видна земля
				}
				diffuseColor.rgb *= sA.rgb * mix(1.0, sB.w, 0.7);
				#include <map_fragment>`)
			.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
				roughnessFactor = sB.z;`)
			// нормаль плиты: базис по производным uv (у каждой плиты свой поворот)
			.replace("#include <normal_fragment_maps>", `{
					vec3 mapN = vec3(sB.xy * 2.0 - 1.0, 0.0);
					mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
					vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
					vec2 st0 = dFdx(vSUv.xy), st1 = dFdy(vSUv.xy);
					vec3 Nn = normal, q1p = cross(q1, Nn), q0p = cross(Nn, q0);
					vec3 T = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
					float det = max(dot(T, T), dot(Bt, Bt));
					float sc = det == 0.0 ? 0.0 : inversesqrt(det);
					if (uSOn > 0.5) normal = normalize(T * sc * mapN.x + Bt * sc * mapN.y + Nn * mapN.z);
				}
				#include <normal_fragment_maps>`);
	};
	mat.customProgramCacheKey = () => "slab-surface";
	const meshes = [];
	for (const near of [true, false]) {
		const bySize = {};
		list.forEach((p, i) => (bySize[p.size] ||= []).push(i));
		for (const [k, idx] of Object.entries(bySize)) {
			const size = parseFloat(k), sx = size - joint;
			const geo = near ? slabGeometry(sx, sx, S.thick, 0.015) : slabGeometry(sx, sx, S.thick, 0.0005);
			const a = new Float32Array(idx.length * 4);
			const im = new THREE.InstancedMesh(geo, mat, idx.length);
			const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
			const layerBase = size >= 1 ? 0 : SLAB_VARS.length;
			idx.forEach((li, n) => {
				const p = list[li];
				e.set(p.tiltX * Math.PI / 180, p.rotY, p.tiltZ * Math.PI / 180, "YXZ");
				q.setFromEuler(e);
				m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx / sx, 1, p.sz / sx));
				im.setMatrixAt(n, m);
				// оттенок: светлее/темнее и чуть теплее/холоднее
				const h2 = hash(p.z * 3.3, p.x * 6.1);
				im.setColorAt(n, col.setRGB(p.tone * (1.02 + 0.06 * (h2 - 0.5)), p.tone, p.tone * (0.98 - 0.08 * (h2 - 0.5))));
				a.set([sx, 0, p.rot, layerBase + p.v], n * 4);
			});
			geo.setAttribute("aSlab", new THREE.InstancedBufferAttribute(a, 4));
			im.castShadow = near; im.receiveShadow = true;
			im.userData.near = near;
			im.userData.pos = idx.map(li => new THREE.Vector3(list[li].x, 0, list[li].z));
			im.userData.mats = idx.map((_, n) => { const mm = new THREE.Matrix4(); im.getMatrixAt(n, mm); return mm; });
			im.frustumCulled = false;
			group.add(im); meshes.push(im);
		}
	}
	// LOD: ближе NEAR_M — плита с фаской, дальше — брусок. Экземпляры не
	// переставляются: в ненужной ступени матрица нулевая.
	const NEAR_M = 30, last = new THREE.Vector3(1e9, 0, 0);
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