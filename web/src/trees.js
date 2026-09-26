import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { windify } from "./wind.js";

// Кора по породам (HoudiniCOP, textures/bark-<набор>/, тайл 0.5 м): порода → набор;
// сухое дерево — bark-dead. Кусты (сирень, бузина, шиповник) развёртки не имеют.
const BARK_OF = { birch: "birch", linden: "linden", poplar: "poplar", poplar_row: "poplar", elm: "elm", oak: "oak", maple: "maple", sapling: "maple", rowan: "rowan" };
const barkSets = {};
function barkSet(name) {
	return barkSets[name] ||= (async () => {
		const base = `../game/assets/textures/bark-${name}/`, f = `bark_${name}`;
		const r = await fetch(base + "tile.txt");
		if (!r.ok) return null;
		const cd = ((await r.text()).match(/cd=#?([0-9a-fA-F]{6})/) || [])[1];
		const L = new THREE.TextureLoader();
		const ld = (s, srgb) => {
			const t = L.load(`${base}${f}_${s}_1k.png`);
			t.wrapS = t.wrapT = THREE.RepeatWrapping;
			t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
			t.anisotropy = 4;
			return t;
		};
		// cd — средний цвет текстуры (sRGB в файле) → линейный, как COLOR_0
		return { map: ld("albedo", true), normal: ld("normal", false), orm: ld("orm", false), cd: new THREE.Color("#" + (cd || "808080")) };
	})().catch(() => null);
}


// Деревья квартала из библиотеки HoudiniCOP: у каждого варианта три LOD
// отдельными файлами, в каждом узлы <tag>_lodN_bark и <tag>_lodN_leaf.
// Одна InstancedMesh на (вариант, LOD, часть) — отрисовок столько, сколько
// вариантов × 3 × 2, независимо от числа деревьев. LOD выбирается каждый кадр
// по дистанции до камеры, делённой на размер дерева.
//
// Грузится поэтапно: сначала все LOD2 (~4 МБ на 50 вариантов) — и деревья уже
// стоят; LOD1 и LOD0 (~15 и ~42 МБ) догружаются фоном. Пока нужной ступени
// нет, дерево рисуется ближайшей загруженной, более грубой.

const BASE = "../game/assets/models/trees/houdinicop/";

// Запасная таблица на случай, если в kit.json нет вариантов под наши породы.
const VARIANT_OF = {
	poplar: "tree_poplar_02",
	linden: "tree_elm_03", birch: "tree_elm_03", rowan: "tree_elm_03",
	maple: "tree_oak_01", lilac: "tree_oak_01",
};

// Дистанции переключения — прикидка HoudiniCOP для дерева ~14 м (LOD0 до 25 м,
// LOD1 до 70 м), пересчитанные на высоту конкретного дерева.
// Отодвинуты от прикидки (25/70) — смена ступени заметна, пусть случается дальше.
const LOD_REF_H = 14, LOD_DIST = [40, 110];
// Запас между порогами: на грубую ступень — на 10 % дальше порога, обратно —
// на 10 % ближе. Без него дерево на самой границе мигает от дрожи камеры.
const HYST = 0.1;
// Смена ступени — растворением за полсекунды: обе ступени рисуются
// дополняющими пикселями (см. wind.js, aFade), скачка нет.
const FADE_S = 1.2;

async function loadLod(loader, base, tag, l) {
	const g = await loader.loadAsync(`${base}${tag}_lod${l}.glb`);
	const parts = {};
	g.scene.traverse(o => {
		if (!o.isMesh) return;
		o.updateWorldMatrix(true, false);
		// Квантованные атрибуты (KHR_mesh_quantization) — во float до матрицы
		// узла: иначе после её масштаба значения выйдут за [-1, 1] нормализованного
		// целого и обрежутся, дерево развалится.
		const geo = o.geometry.clone();
		for (const [name, a] of Object.entries(geo.attributes)) {
			if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized) continue;
			const f = new Float32Array(a.count * a.itemSize);
			for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
			geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
		}
		geo.applyMatrix4(o.matrixWorld);
		parts[/_leaf$/.test(o.name) ? "leaf" : "bark"] = { geo, mat: o.material };
	});
	return parts;
}

function measure(parts) {
	const box = new THREE.Box3();
	for (const p of Object.values(parts)) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
	const size = box.getSize(new THREE.Vector3());
	return { crown: Math.max(size.x, size.z), height: size.y };
}

/**
 * Какой вариант библиотеки ставить на дерево. Если в kit.json есть варианты с
 * породой/возрастом/состоянием (ключи как в district.json) — берём оттуда:
 * точное сочетание, иначе та же порода и возраст (сухое без своего варианта —
 * живое без листвы), иначе та же порода. Среди равных — по seed дерева, чтобы
 * соседи не были копиями. Нет таких вариантов — запасная таблица VARIANT_OF.
 */
function makePicker(kit) {
	const list = (kit && kit.trees || []).filter(t => t.species && t.age && t.lods);
	const tagOf = t => t.lods[0].glb.replace(/^.*\//, "").replace(/_lod\d+\.glb$/, "");
	const meta = Object.fromEntries(list.map(t => [tagOf(t), { crown: t.crown_d_m, height: t.height_m, health: t.health, species: t.species }]));
	if (!list.length) return { pick: p => VARIANT_OF[p.species] || "tree_elm_03", meta };
	const by = (f) => { const m = {}; for (const t of list) (m[f(t)] ||= []).push(tagOf(t)); return m; };
	const exact = by(t => `${t.species}/${t.age}/${t.health}`);
	const sa = by(t => `${t.species}/${t.age}`), sp = by(t => t.species);
	return {
		meta,
		pick: p => {
			const pool = exact[`${p.species}/${p.age}/${p.health}`] || sa[`${p.species}/${p.age}`] || sp[p.species];
			return pool ? pool[p.seed % pool.length] : (VARIANT_OF[p.species] || tagOf(list[0]));
		},
	};
}

/**
 * trees — [[x, z, r, params], ...] из treePositions. Возвращает группу и
 * update(camera) — раз в кадр раскладывает экземпляры по LOD. Промис
 * разрешается, когда стоят все LOD2; остальное догружается само.
 */
// autumn — district.json trees.autumn: { порода: { amount, colors: [sRGB ×3] } }
// cull — [база м, м на метр высоты]: дальше растение не рисуется вовсе (растворяется,
// как между ступенями). Для подлеска: метровый бурьян вдали — пятнышко в пиксель.
export async function buildHoudiniTrees(trees, { onProgress, base = BASE, name = "Trees", minH = 0, autumn = null, cull = null, lodDist = LOD_DIST } = {}) {
	const loader = new GLTFLoader();
	let kit = null;
	try { kit = await (await fetch(base + "kit.json", { cache: "no-store" })).json(); } catch { /* манифеста нет — таблица */ }
	const { pick, meta } = makePicker(kit);
	const barkName = t => {
		if (meta[t]?.health === "dead" || /_dead_/.test(t)) return "dead";
		return BARK_OF[meta[t]?.species || (t.match(/^tree_([a-z_]+?)_(young|mature|old)/) || [])[1]];
	};
	// осень породы варианта: палитра в линейный цвет один раз
	const autumnCache = {};
	const autumnOf = t => {
		const sp = meta[t]?.species || (t.match(/^tree_([a-z]+)_/) || [])[1];
		const a = autumn && autumn[sp];
		if (!a || !a.colors) return null;
		return autumnCache[sp] ||= { amount: a.amount ?? 0.5, colors: a.colors.map(c => new THREE.Color(c)) };
	};
	const chosen = trees.map(t => pick(t[3]));
	const tags = [...new Set(chosen)];
	const bark = {};
	await Promise.all(tags.map(async t => { const n = barkName(t); bark[t] = n ? await barkSet(n) : null; }));

	const group = new THREE.Group();
	group.name = name;
	const variants = {}, meshes = {}, inst = {};
	for (const t of tags) { meshes[t] = [null, null, null]; inst[t] = []; }

	// Ступень LOD варианта → InstancedMesh коры и листвы с ветром.
	function addLod(t, l, parts) {
		const out = {};
		for (const [k, { geo, mat }] of Object.entries(parts)) {
			const cap = Math.max(1, inst[t].length);
			geo.setAttribute("aFade", new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1));
			const im = new THREE.InstancedMesh(geo, mat, cap);
			im.count = 0;
			im.castShadow = true; im.receiveShadow = true;
			// Ветер: маски _wind из генератора, если есть, иначе оценка по высоте.
			// Крона для объёма и просвета: атрибут _crown из генератора, иначе эллипсоид
			// по габариту листвы этой ступени.
			let crown = null;
			// карта нормалей листа (жилки, выгиб): на дальней ступени жилки — только рябь
			if (k === "leaf" && mat.normalMap) mat.normalScale.setScalar(l === 2 ? 0.5 : 1);
			if (k === "leaf") {
				geo.computeBoundingBox();
				const bb = geo.boundingBox;
				crown = { c: bb.getCenter(new THREE.Vector3()), r: bb.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3)) };
			}
			// кора: текстура породы, если у ступени есть развёртка
			let barkCd = null;
			if (k === "bark" && geo.attributes.uv && bark[t]) {
				const b = bark[t];
				mat.map = b.map; mat.normalMap = b.normal; mat.roughnessMap = b.orm;
				mat.roughness = 1; mat.metalness = 0;   // шероховатость — из карты (кора матовая)
				barkCd = b.cd;
			}
			im.customDepthMaterial = windify(mat, {
				barkCd,
				leaf: k === "leaf", height: variants[t].height, attr: !!geo.attributes._wind,
				crown, crownAttr: !!geo.attributes._crown,
				autumn: k === "leaf" ? autumnOf(t) : null,
			});
			im.frustumCulled = false;   // экземпляры переезжают между LOD каждый кадр
			group.add(im);
			out[k] = im;
		}
		meshes[t][l] = out;
	}

	// 1) все LOD2 — габарит из манифеста, без него — замер по LOD2
	const lod2 = await Promise.all(tags.map(t => loadLod(loader, base, t, 2)));
	tags.forEach((t, i) => {
		const m = meta[t] && meta[t].crown ? meta[t] : measure(lod2[i]);
		variants[t] = { tag: t, crown: m.crown, height: m.height };
	});

	// Экземпляры: матрица и «масштаб дерева» для LOD, по варианту.
	const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), ql = new THREE.Quaternion();
	for (const [i, [x, z, r, p]] of trees.entries()) {
		const tag = chosen[i], v = variants[tag];
		// Вписываем крону в наш диаметр; варианты под квартал уже почти в размер.
		const s = (2 * r) / v.crown;
		// rotY — заданный поворот (трава вдоль шва плит), иначе случайный по seed
		q.setFromAxisAngle(up, p.rotY ?? ((p.seed % 3600) / 3600) * Math.PI * 2);
		const dir = p.leanDir * Math.PI / 180;
		ql.setFromAxisAngle(new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), p.lean * Math.PI / 180);
		const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), ql.multiply(q), new THREE.Vector3(s, s, s));
		// minH — нижняя граница высоты для LOD: метровый куст иначе грубел бы уже с 5 м
		const hr = v.height * s;
		inst[tag].push({ m, pos: new THREE.Vector3(x, hr * 0.5, z), h: Math.max(minH, hr),
			far: cull ? cull[0] + cull[1] * hr : Infinity,   // дальше — не рисуется
			// листву прячем, только если сухому экземпляру достался живой вариант;
			// у сухого варианта листва — это само растение (сухая осока — одна «листва»)
			leaves: !(p.health === "dead" && (meta[tag] ? meta[tag].health : "healthy") !== "dead") });
	}
	tags.forEach((t, i) => addLod(t, 2, lod2[i]));

	// 2) фоном: LOD1 всех вариантов, потом LOD0
	const stats = { lod: [0, 0, 0], loaded: [0, 0, tags.length], total: tags.length };
	(async () => {
		for (const l of [1, 0]) {
			for (const t of tags) {
				try { addLod(t, l, await loadLod(loader, base, t, l)); stats.loaded[l]++; }
				catch (e) { console.warn(`[улица] дерево ${t} LOD${l} не загрузилось: ${e}`); }
				if (onProgress) onProgress(stats);
			}
		}
	})();

	// Поставить дерево в ступень l с растворением f (1 — целиком).
	function put(L, l, it, f) {
		if (l === 3) return;   // ступень «нет» — за дальней границей
		for (const [k, im] of Object.entries(L[l])) {
			if (k === "leaf" && !it.leaves) continue;
			const i = im.count++;
			im.setMatrixAt(i, it.m);
			im.geometry.attributes.aFade.array[i] = f;
		}
	}

	function update(camera, time = performance.now() / 1000) {
		stats.lod = [0, 0, 0, 0];
		stats.fading = 0;
		for (const t of tags) {
			const L = meshes[t];
			for (const l of L) if (l) for (const im of Object.values(l)) im.count = 0;
			for (const it of inst[t]) {
				const dist = it.pos.distanceTo(camera.position), k = dist / (it.h / LOD_REF_H);
				// желаемая ступень от текущей, с запасом между порогами; 3 — не рисуется
				let want = it.cur ?? (k < lodDist[0] ? 0 : k < lodDist[1] ? 1 : 2);
				if (want === 3) want = 2;
				while (want < 2 && k > lodDist[want] * (1 + HYST)) want++;
				while (want > 0 && k < lodDist[want - 1] * (1 - HYST)) want--;
				while (want < 2 && !L[want]) want++;   // нужной ступени ещё нет — грубее
				if (dist > it.far * (it.cur === 3 ? 1 - HYST : 1 + HYST)) want = 3;
				if (it.cur === undefined) it.cur = want;
				else if (want !== it.cur && !it.fade) {
					it.fade = { from: it.cur, start: time };
					it.cur = want;
				}
				if (it.fade) {
					const f = (time - it.fade.start) / FADE_S;
					if (f >= 1) it.fade = null;
					else {
						put(L, it.cur, it, Math.max(0, f));        // проявляется
						put(L, it.fade.from, it, 2 + Math.max(0, f)); // исчезает в дополняющих пикселях
						stats.fading++;
						stats.lod[it.cur]++;
						continue;
					}
				}
				put(L, it.cur, it, 1);
				stats.lod[it.cur]++;
			}
			for (const l of L) if (l) for (const im of Object.values(l)) {
				im.instanceMatrix.needsUpdate = true;
				im.geometry.attributes.aFade.needsUpdate = true;
			}
		}
	}

	const counts = Object.fromEntries(tags.map(t => [t, inst[t].length]));
	return { group, update, stats, counts, variants };
}
