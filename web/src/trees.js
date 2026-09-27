import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { windify } from "./wind.js";
import { lodManifest, texUrl, texPx } from "./texlod.js";

// Кора по породам (HoudiniCOP, textures/bark-<набор>/, тайл 0.5 м): порода → набор;
// сухое дерево — bark-dead. Кусты (сирень, бузина, шиповник) развёртки не имеют.
const BARK_OF = { birch: "birch", linden: "linden", poplar: "poplar", poplar_row: "poplar", elm: "elm", oak: "oak", maple: "maple", sapling: "maple", rowan: "rowan" };
const barkSets = {};
function barkSet(name) {
	return barkSets[name] ||= (async () => {
		const base = `../game/assets/textures/bark-${name}/`, f = `bark_${name}`;
		const [r, M] = await Promise.all([fetch(base + "tile.txt"), lodManifest()]);
		if (!r.ok) return null;
		const cd = ((await r.text()).match(/cd=#?([0-9a-fA-F]{6})/) || [])[1];
		const L = new THREE.TextureLoader();
		const ld = (s, srgb) => {
			const t = L.load(texUrl(M, `bark-${name}`, s, texPx, "1k"));   // ступень под устройство
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
// Один BatchedMesh на (LOD, часть, набор атрибутов, материал) — все варианты с общим
// атласом рисуются одним вызовом, независимо от числа вариантов и деревьев. LOD
// выбирается каждый кадр по дистанции до камеры, делённой на размер дерева.
//
// Грузится поэтапно: сначала все LOD2 (~4 МБ на 50 вариантов) — и деревья уже
// стоят; LOD1 и LOD0 (~15 и ~42 МБ) догружаются фоном и включаются, когда ступень
// собрана у всех вариантов. До того дерево рисуется более грубой.

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
// дополняющими пикселями (см. wind.js, vLodFade), скачка нет.
const FADE_S = 1.2;

// Общие текстуры по URI картинки. Все варианты набора ссылаются на один атлас
// (leaf_atlas.png), но GLTFLoader на каждый файл заводит свою текстуру — и в
// видеопамять уходила копия атласа на каждый файл ступени (75 кустов × 3 ступени,
// ~5.6 МБ на копию с мипами). Здесь копия заменяется первой загруженной.
const sharedTex = new Map();
const SHARE = new URLSearchParams(location.hash.slice(1)).get("sharetex") !== "0";   // #sharetex=0 — как было (A/B)
function shareTextures(g, base) {
	const P = g.parser, json = P.json;
	const uriOf = t => {
		const a = P.associations.get(t);
		const src = a && a.textures !== undefined ? json.textures[a.textures].source : undefined;
		const uri = src !== undefined ? json.images[src].uri : null;
		return uri ? base + uri : null;
	};
	g.scene.traverse(o => {
		if (!o.isMesh) return;
		for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) {
			const t = o.material[k];
			if (!t) continue;
			const key = uriOf(t);
			if (!key) continue;
			const full = key + "|" + t.colorSpace + "|" + t.flipY;
			const have = sharedTex.get(full);
			if (have && have !== t) { o.material[k] = have; t.dispose(); }
			else sharedTex.set(full, t);
		}
	});
}

async function loadLod(loader, base, tag, l) {
	const g = await loader.loadAsync(`${base}${tag}_lod${l}.glb`);
	if (SHARE) shareTextures(g, base);
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
// viewCull = false — без отсечения экземпляров по кадру и камере тени (A/B, #cull=0).
export async function buildHoudiniTrees(trees, { onProgress, base = BASE, name = "Trees", minH = 0, autumn = null, cull = null, lodDist = LOD_DIST, viewCull = true } = {}) {
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
	const variants = {}, items = [];
	const partsOf = Object.fromEntries(tags.map(t => [t, [null, null, null]]));
	const ready = [false, false, false];   // ступень собрана
	const batches = [];

	// Ступень l всех вариантов → BatchedMesh на группу «часть × набор атрибутов ×
	// материал». Вариантов десятки (кустов 75), и по InstancedMesh на вариант, ступень
	// и часть выходило ~130 объектов в кадре и столько же в тени: цена была не в
	// пикселях, а в процессоре — three.js на каждый объект ставит программу и шлёт
	// униформы (~15 мкс). Все варианты делят один атлас листвы — значит, их можно
	// рисовать одним вызовом. Отсечение по кадру и по камере тени BatchedMesh делает
	// сам, по каждому экземпляру.
	function buildLod(l) {
		const groups = new Map();
		for (const t of tags) {
			const parts = partsOf[t][l];
			if (!parts) continue;
			for (const [k, { geo, mat }] of Object.entries(parts)) {
				// кора: текстура породы, если у ступени есть развёртка
				let barkCd = null, barkKey = "plain";
				if (k === "bark" && geo.attributes.uv && bark[t]) {
					const b = bark[t];
					mat.map = b.map; mat.normalMap = b.normal; mat.roughnessMap = b.orm;
					mat.roughness = 1; mat.metalness = 0;   // шероховатость — из карты (кора матовая)
					barkCd = b.cd; barkKey = b.map.uuid;
				}
				if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
				// Касательные не нужны (базис карты нормалей — по производным). Были битые у
				// травы в швах (486 значений на 324 вершины, ROP gltf писал их на вершину
				// треугольника) — BatchedMesh на таком падает. HoudiniCOP их больше не пишет;
				// проверка остаётся: атрибут с чужим числом значений выбрасывается.
				geo.deleteAttribute("tangent");
				for (const [n, a] of Object.entries(geo.attributes)) if (a.count !== geo.attributes.position.count) {
					console.warn(`[улица] ${t} LOD${l} ${k}: атрибут ${n} — ${a.count} значений на ${geo.attributes.position.count} вершин, убран`);
					geo.deleteAttribute(n);
				}
				const attrSig = Object.entries(geo.attributes).map(([n, a]) => `${n}:${a.itemSize}`).sort().join(",");
				const matSig = k === "leaf" ? `${mat.map?.uuid}|${mat.normalMap?.uuid}|${mat.alphaTest}|${mat.side}` : `${barkKey}|${mat.vertexColors}`;
				const key = `${k}|${attrSig}|${matSig}`;
				let g = groups.get(key);
				if (!g) groups.set(key, g = { k, mat, barkCd, attr: !!geo.attributes._wind, crownAttr: !!geo.attributes._crown, list: new Map() });
				// крона для объёма и просвета — эллипсоид по габариту листвы (если нет _crown)
				let crown = null;
				if (k === "leaf") {
					geo.computeBoundingBox();
					const bb = geo.boundingBox;
					crown = { c: bb.getCenter(new THREE.Vector3()), r: bb.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3)) };
				}
				g.list.set(t, { geo, crown });
			}
			partsOf[t][l] = null;   // геометрия уходит в батч, исходник не нужен
		}
		for (const g of groups.values()) {
			const its = items.filter(it => g.list.has(it.tag) && (g.k !== "leaf" || it.leaves));
			if (!its.length) continue;
			let nv = 0, ni = 0;
			for (const { geo } of g.list.values()) { nv += geo.attributes.position.count; ni += geo.index.count; }
			const cap = its.length;
			const bm = new THREE.BatchedMesh(cap, nv, ni, g.mat);
			const gid = new Map([...g.list].map(([t, { geo }]) => [t, bm.addGeometry(geo)]));
			// параметры варианта на экземпляр (см. wind.js, VEG_BATCH)
			const rowsD = Math.ceil(cap / 256), D = new Float32Array(1536 * rowsD * 4);
			const rowsF = Math.ceil(cap / 1024), F = new Float32Array(1024 * rowsF).fill(1);
			const dataTex = new THREE.DataTexture(D, 1536, rowsD, THREE.RGBAFormat, THREE.FloatType);
			const fadeTex = new THREE.DataTexture(F, 1024, rowsF, THREE.RedFormat, THREE.FloatType);
			dataTex.needsUpdate = fadeTex.needsUpdate = true;
			const rec = { bm, F, fadeTex, dirty: false };
			for (const it of its) {
				const id = bm.addInstance(gid.get(it.tag));
				bm.setMatrixAt(id, it.m);
				bm.setVisibleAt(id, false);
				const o = ((id % 256) * 6 + Math.floor(id / 256) * 1536) * 4;
				const e = g.list.get(it.tag), aut = g.k === "leaf" ? autumnOf(it.tag) : null;
				D[o] = variants[it.tag].height; D[o + 1] = aut ? aut.amount : 0;
				if (e.crown) { e.crown.c.toArray(D, o + 4); e.crown.r.toArray(D, o + 8); }
				if (aut) aut.colors.forEach((c, j) => c.toArray(D, o + 12 + j * 4));
				it.slots[l].push({ rec, id, vis: false });
			}
			bm.castShadow = true; bm.receiveShadow = true;
			bm.perObjectFrustumCulled = viewCull;
			// карта нормалей листа (жилки, выгиб): на дальней ступени жилки — только рябь
			if (g.k === "leaf" && g.mat.normalMap) g.mat.normalScale.setScalar(l === 2 ? 0.5 : 1);
			bm.customDepthMaterial = windify(g.mat, {
				barkCd: g.barkCd, leaf: g.k === "leaf", attr: g.attr, crownAttr: g.crownAttr,
				batch: { data: dataTex, fade: fadeTex },
			});
			group.add(bm);
			batches.push(rec);
		}
		ready[l] = true;
	}

	// 1) все LOD2 — габарит из манифеста, без него — замер по LOD2
	const lod2 = await Promise.all(tags.map(t => loadLod(loader, base, t, 2)));
	tags.forEach((t, i) => {
		const m = meta[t] && meta[t].crown ? meta[t] : measure(lod2[i]);
		variants[t] = { tag: t, crown: m.crown, height: m.height };
		partsOf[t][2] = lod2[i];
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
		items.push({ tag, m, pos: new THREE.Vector3(x, hr * 0.5, z), h: Math.max(minH, hr),
			far: cull ? cull[0] + cull[1] * hr : Infinity,   // дальше — не рисуется
			// листву прячем, только если сухому экземпляру достался живой вариант;
			// у сухого варианта листва — это само растение (сухая осока — одна «листва»)
			leaves: !(p.health === "dead" && (meta[tag] ? meta[tag].health : "healthy") !== "dead"),
			slots: [[], [], []] });   // экземпляры в батчах каждой ступени
	}
	buildLod(2);

	// 2) фоном: LOD1 всех вариантов, потом LOD0; ступень включается, когда собрана целиком
	const stats = { lod: [0, 0, 0], loaded: [0, 0, tags.length], total: tags.length };
	(async () => {
		for (const l of [1, 0]) {
			for (const t of tags) {
				try { partsOf[t][l] = await loadLod(loader, base, t, l); stats.loaded[l]++; }
				catch (e) { console.warn(`[улица] дерево ${t} LOD${l} не загрузилось: ${e}`); }
				if (onProgress) onProgress(stats);
			}
			buildLod(l);
		}
	})();

	// Показ ступени l экземпляра с растворением f (null — скрыт). Видимость и
	// растворение трогаются, только если поменялись: в видеокарту — лишь изменения.
	function show(it, l, f) {
		for (const s of it.slots[l]) {
			const vis = f !== null;
			if (s.vis !== vis) { s.vis = vis; s.rec.bm.setVisibleAt(s.id, vis); }
			if (vis && s.rec.F[s.id] !== f) { s.rec.F[s.id] = f; s.rec.dirty = true; }
		}
	}

	const fl = [null, null, null];
	function update(camera, time = performance.now() / 1000) {
		stats.lod = [0, 0, 0, 0];
		stats.fading = 0;
		for (const it of items) {
			const dist = it.pos.distanceTo(camera.position), k = dist / (it.h / LOD_REF_H);
			// желаемая ступень от текущей, с запасом между порогами; 3 — не рисуется
			let want = it.cur ?? (k < lodDist[0] ? 0 : k < lodDist[1] ? 1 : 2);
			if (want === 3) want = 2;
			while (want < 2 && k > lodDist[want] * (1 + HYST)) want++;
			while (want > 0 && k < lodDist[want - 1] * (1 - HYST)) want--;
			while (want < 2 && !ready[want]) want++;   // нужной ступени ещё нет — грубее
			if (dist > it.far * (it.cur === 3 ? 1 - HYST : 1 + HYST)) want = 3;
			if (it.cur === undefined) it.cur = want;
			else if (want !== it.cur && !it.fade) {
				it.fade = { from: it.cur, start: time };
				it.cur = want;
			}
			fl[0] = fl[1] = fl[2] = null;
			const f = it.fade ? (time - it.fade.start) / FADE_S : 1;
			if (it.fade && f >= 1) it.fade = null;
			if (it.fade) {
				if (it.cur < 3) fl[it.cur] = Math.max(0, f);                 // проявляется
				if (it.fade.from < 3) fl[it.fade.from] = 2 + Math.max(0, f);  // исчезает в дополняющих пикселях
				stats.fading++;
			} else if (it.cur < 3) fl[it.cur] = 1;
			for (let l = 0; l < 3; l++) show(it, l, fl[l]);
			stats.lod[it.cur]++;
		}
		for (const r of batches) if (r.dirty) { r.dirty = false; r.fadeTex.needsUpdate = true; }
	}

	const counts = {};
	for (const it of items) counts[it.tag] = (counts[it.tag] || 0) + 1;
	return { group, update, stats, counts, variants };
}
