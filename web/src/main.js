import * as THREE from "three";
import { buildStreet } from "./street.js";
import { buildGround } from "./ground.js";
import { setSurfaceUniform } from "./surface.js";
import { loadProps } from "./props.js";
import { buildBlockout, groundMaterial, hardMaterials, dressBoxes } from "./blockout.js";
import { undergrowthPositions } from "./district.js";
import { loadHouses } from "./houses.js";
import { loadFences } from "./fences.js";
import { loadPlayground } from "./playground.js";
import { loadPoles } from "./poles.js";
import { loadStreetProps } from "./streetprops.js";
import { loadCurbs } from "./curbs.js";
import { buildSlabs, jointGrass } from "./slabs.js";
import { buildPaving } from "./paving.js";
import { loadRocks } from "./rocks.js";
import { buildSky, skyUniforms } from "./sky.js";
import { MOODS, installAerialFog, addVignette } from "./atmos.js";
import { breakdown, infoLine, applyOff, runBench } from "./perf.js";
import { buildGrassMap, setGrassMap, buildGrassBlades, updateGrass } from "./grass.js";
import { buildGroundMap, setupGround, hardify, loadPitGrass } from "./floor.js";
import { spawnRobots } from "./robot.js";
import { spawnDrones } from "./drones.js";
import { instanceLods } from "./instlod.js";
import { createInteriors } from "./furnish.js";
import { createPlayer } from "./player.js";
import { buildHoudiniTrees } from "./trees.js";
import { windUniforms, setWind } from "./wind.js";

/* Начальное состояние из хеша — так скриншот-харнесс задаёт ракурс и режим
   отладки, не эмулируя нажатия клавиш, которых в headless нет.
   Пример: #view=3&debug=1&bump=0; квартал — #level=district */
const q = new URLSearchParams(location.hash.slice(1));
const LEVEL = q.get("level") === "district" ? "district" : "street";

const hud = {
	fps: document.getElementById("fps"),
	res: document.getElementById("res"),
	status: document.getElementById("status"),
	pos: document.getElementById("pos"),
	perf: document.getElementById("perf"),
	perfTable: document.getElementById("perf-table"),
};

function say(text, bad) {
	hud.status.textContent = text;
	hud.status.classList.toggle("bad", !!bad);
	if (bad) console.error("[улица]", text);
}

// Ошибки обязаны попадать В КАДР. Проверка идёт снимком headless-браузера, и
// если шейдер не собрался, кадр должен сказать почему, а не быть чёрным.
addEventListener("error", (e) => say("ошибка: " + e.message, true));
addEventListener("unhandledrejection", (e) => say("ошибка: " + e.reason, true));

/* ── рендер ─────────────────────────────────────────────────────────── */
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// настроение квартала: закат по умолчанию, #mood=day — дневной свет
const MOOD = LEVEL === "district" ? (MOODS[new URLSearchParams(location.hash.slice(1)).get("mood")] || MOODS.sunset) : null;
renderer.toneMappingExposure = MOOD ? MOOD.exposure : 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// Ошибка компиляции шейдера в three.js по умолчанию уходит только в консоль,
// а на экране остаётся чёрный материал без объяснений. Ловим и показываем.
// Вызывается, только если программа НЕ собралась. Причина — в журнале программы
// (ошибка линковки) или строка ERROR в журнале шейдера; предупреждения (WARNING)
// причиной не бывают — их не показываем, иначе они заслоняют настоящую ошибку.
renderer.debug.onShaderError = (gl, prog, vs, fs) => {
	const logs = [gl.getProgramInfoLog(prog) || "", gl.getShaderInfoLog(vs) || "", gl.getShaderInfoLog(fs) || ""];
	const err = logs.join("\n").split("\n").map(l => l.trim()).filter(l => l && !/WARNING|warning X/.test(l));
	say("шейдер не собрался: " + (err.slice(0, 3).join(" · ") || "причина не указана драйвером"), true);
	console.error("[улица] шейдер не собрался\n" + logs.join("\n----\n"));
};

const scene = new THREE.Scene();

// Туман закрывает горизонт: концы полос в него уходят, и где покрытие
// кончается — не видно ни с какого ракурса.
const FOG = new THREE.Color(0x9fa3a2);
scene.fog = new THREE.Fog(FOG, 55, 150);
scene.background = FOG;

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);   // угол — FOV / RIDE_FOV (в дроне)

// Квартал в сотни метров: туман отодвигается, иначе дальний край тонет в нём
// целиком, а тень должна накрывать весь кадр общего вида, а не 80 м вокруг.
if (LEVEL === "district") {
	// небо-купол (sky.js); туман — цвета горизонта, дальнее тонет в дымке
	FOG.copy(skyUniforms.uHorizon.value);
	scene.background = null;
	scene.fog.near = 220;
	scene.fog.far = 850;
	camera.far = 2000;
	camera.near = 0.3;   // точность глубины на дальнем краю квартала; ближе 30 см смотреть не на что
}

/* ── свет ───────────────────────────────────────────────────────────── */
// Солнце низкое и сбоку: скользящий свет — единственное, на чём вообще
// читается микрорельеф покрытия. В зенит его ставить нельзя, иначе вся
// работа с нормалями пропадает.
// осень: солнце ниже и теплее (в квартале)
const sun = new THREE.DirectionalLight(MOOD ? MOOD.sunColor : 0xfff3e6, MOOD ? MOOD.sunIntensity : 3.4);
const SUN_AZ = MOOD ? MOOD.sunAz : 52, SUN_EL = MOOD ? MOOD.sunEl : 32;
// Солнце ставится на SUN_DIST от точки взгляда; в квартале башни по 37 м и
// кадр на 300 м, поэтому и дистанция, и охват тени другие.
const SUN_DIST = LEVEL === "district" ? 420 : 60;
const SHADOW_HALF = LEVEL === "district" ? 190 : 40;
{
	const az = SUN_AZ * Math.PI / 180, el = SUN_EL * Math.PI / 180;
	sun.position.set(
		Math.cos(el) * Math.cos(az) * SUN_DIST,
		Math.sin(el) * SUN_DIST,
		Math.cos(el) * Math.sin(az) * SUN_DIST,
	);
}
sun.castShadow = true;
sun.shadow.mapSize.set(LEVEL === "district" ? 4096 : 2048, LEVEL === "district" ? 4096 : 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = SUN_DIST * 2.2;
sun.shadow.camera.left = -SHADOW_HALF;
sun.shadow.camera.right = SHADOW_HALF;
sun.shadow.camera.top = SHADOW_HALF;
sun.shadow.camera.bottom = -SHADOW_HALF;
sun.shadow.bias = -0.0006;
// тексель тени в квартале ~9 см против 4 см на улице — смещение растёт вместе с ним
sun.shadow.normalBias = LEVEL === "district" ? 0.12 : 0.03;
// Мягкий край тени бесплатно: фильтр PCF берёт 5 выборок по диску при любом радиусе,
// радиус — в текселях карты (4096 на квартал: 4 текселя ≈ 30 см полутени). #shadowsoft=
sun.shadow.radius = +(new URLSearchParams(location.hash.slice(1)).get("shadowsoft") || 4);
scene.add(sun);
scene.add(sun.target);
const sunDir = sun.position.clone().normalize();   // на солнце (солнце за сеанс не двигается)
// #cull=0 — растения без отсечения по кадру (A/B замер)
const plantCull = new URLSearchParams(location.hash.slice(1)).get("cull") === "0" ? { viewCull: false } : {};
let skyDome = null;
if (LEVEL === "district") {
	skyDome = buildSky();
	scene.add(skyDome.mesh);
	skyUniforms.uSunDir.value.copy(sun.position).normalize();
	skyUniforms.uSunCol.value.copy(sun.color);
	skyUniforms.uZenith.value.set(MOOD.zenith);
	skyUniforms.uHorizon.value.set(MOOD.fogColor);
	skyUniforms.uGlow.value.set(MOOD.fogSun);
	installAerialFog(MOOD, skyUniforms.uSunDir.value);   // до первой сборки шейдеров
	if (new URLSearchParams(location.hash.slice(1)).get("vignette") !== "0") addVignette();
	if (new URLSearchParams(location.hash.slice(1)).has("clouds")) skyUniforms.uCloud.value = +new URLSearchParams(location.hash.slice(1)).get("clouds");
}

const sky = MOOD ? new THREE.HemisphereLight(MOOD.hemiSky, MOOD.hemiGround, MOOD.hemiIntensity) : new THREE.HemisphereLight(0x9fb4c6, 0x4a4436, 1.6);
scene.add(sky);

/* ── улица ──────────────────────────────────────────────────────────── */
/**
 * Окружение для отражений: небо того же тона, что туман, сверху; тёплая
 * земля снизу; пятно солнца по азимуту и высоте направленного света. Не
 * scene.environment — отдаётся точечно материалам, которым без отражений
 * нельзя (хром робота), чтобы не перекрасить свет всего квартала.
 */
function skyEnvMap() {
	const env = new THREE.Scene();
	const geo = new THREE.SphereGeometry(10, 32, 16);
	const col = [], top = new THREE.Color(0xb9c7d2), mid = new THREE.Color(FOG), low = new THREE.Color(0x4a4436);
	const p = geo.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const y = p.getY(i) / 10;
		const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(low, Math.min(1, -y * 3));
		col.push(c.r, c.g, c.b);
	}
	geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
	env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
	const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3e6).multiplyScalar(6) }));
	const az = SUN_AZ * Math.PI / 180, el = SUN_EL * Math.PI / 180;
	sunDisc.position.set(Math.cos(el) * Math.cos(az) * 9, Math.sin(el) * 9, Math.cos(el) * Math.sin(az) * 9);
	env.add(sunDisc);
	const pm = new THREE.PMREMGenerator(renderer);
	const rt = pm.fromScene(env, 0.02);
	pm.dispose();
	return rt.texture;
}

let street = null;
let gameLayer = null;
let houdiniTrees = null;
// Слои для кнопок: что показать при включении и что спрятать (коробки под домами)
const layerObjs = {};
let loadTrees = null;   // догрузка больших деревьев по клавише T
let undergrowth = null;

/** Кусты габаритными коробками — пока нет моделей подлеска. Сухие — бурые. */
function bushBoxes(bushes) {
	const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ roughness: 0.95 }), Math.max(1, bushes.length));
	const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), c = new THREE.Color();
	bushes.forEach(([x, z, r, p], i) => {
		qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p.seed % 628) / 100);
		im.setMatrixAt(i, m.compose(new THREE.Vector3(x, p.h / 2, z), qq, new THREE.Vector3(r * 1.6, p.h, r * 1.6)));
		im.setColorAt(i, c.set(p.health === "dead" ? 0x7a6a45 : 0x3f5f2a));
	});
	im.count = bushes.length;
	im.castShadow = true; im.receiveShadow = true;
	im.name = "UndergrowthBoxes";
	return im;
}
let grassBlades = null, grassNearHalf = 20;
const grassCenter = new THREE.Vector3(), grassRay = new THREE.Vector3(), bottomRay = new THREE.Vector3();
let robot = null;          // тот, за кем камера
let drones = null, fenceIvy = null, interiors = null;
// игра: герой бегает по кварталу и в домах (player.js); world — что берём в коллизию
let player = null, playing = false;
const world = { bo: null, fences: null, playground: null, houses: null, boxes: [], sig: "" };
const FOV = 55, RIDE_FOV = 100;   // угол камеры: обычный и в дроне (setRide)
let ride = -1, rideHeading = 0;
const cpuMs = { anim: 0, plants: 0, render: 0 };
const instLods = [];
let crowd = [], followIdx = 0, robotLod = null, crowdStep = null, playground = null, curbs = null, slabs = null, rocks = null, jointGrassL = null;
// Камера за роботом: держит текущие поворот и наклон, дистанция — колесом мыши
let follow = false, followDist = 34;
if (LEVEL === "district") {
	// Квартал — отдельный уровень: улица-стенд покрытий тянется на 440 м по
	// оси X и прошла бы сквозь дома, поэтому её здесь нет.
	const d = await (await fetch("../game/district.json", { cache: "no-store" })).json();
	// Большие деревья: по умолчанию спрятаны и не грузятся (пользователь попросил
	// убрать, пока работаем с дорожками). #trees=on — модели HoudiniCOP с LOD,
	// #trees=box — коробками; клавиша T — показать/спрятать (догрузит при первом нажатии).
	const treeMode = q.get("trees") || "off";
	// пороги LOD деревьев и кустов, м для дерева высотой 14 м (#treelod=25,70 — для замера)
	const treeLod = q.has("treelod") ? q.get("treelod").split(",").map(Number) : undefined;
	const treeBoxes = treeMode === "box";
	const bo = buildBlockout(d, { treeBoxes });
	scene.add(bo.group);
	world.bo = bo;
	dressBoxes().catch(e => console.error("[улица] материалы коробок:", e));
	// Настоящие дома (от hou) — вместо коробок тех зданий, у которых есть model.
	// По умолчанию выключены и не грузятся (пользователь: «верни пока коробки»):
	// загрузка — при первом нажатии кнопки «дома» или сразу с #houses=on.
	// заборы-модели по данным — фоном, коробочные заборы там не строятся
	// заборы и плющ на них (HoudiniCOP: накладки на плиту, тот же конвейер растений, что кусты)
	loadFences(d).then(P => {
		scene.add(P.group); world.fences = P.group;
		if (P.ivy.length) return buildHoudiniTrees(P.ivy, { ...plantCull, base: "../game/assets/models/ivy_fence/", name: "FenceIvy",
			minH: 4, lodDist: [30, 90], cull: [70, 0], autumn: d.trees.autumn }).then(I => { scene.add(I.group); fenceIvy = I; });
	}).catch(e => console.error("[улица] заборы:", e, e.stack));
	loadPlayground(d).then(P => { scene.add(P.group); playground = P; world.playground = P.group; }).catch(e => console.error("[улица] площадки:", e));
	// опоры и уличные мелочи — экземплярами (instlod.js): вызов на деталь, а не на предмет; #inst=0 — как было (A/B)
	const toInst = (P, what) => { if (!P) return; scene.add(P.group); if (q.get("inst") === "0") return; const I = instanceLods(P.group, { sun: sunDir }); if (I) { instLods.push(I); console.log(`[улица] ${what}: ${I.stats.items} предметов → ${I.stats.calls} вызовов`); } };
	loadPoles(d).then(P => toInst(P, "опоры")).catch(e => console.error("[улица] опоры:", e));
	loadStreetProps(d).then(P => toInst(P, "уличные мелочи")).catch(e => console.error("[улица] уличные мелочи:", e));
	loadCurbs(d).then(C => { scene.add(C.group); curbs = C; }).catch(e => console.error("[улица] бордюр:", e));
	{ const S = buildSlabs(d, bo.trees); if (S) { scene.add(S.group); slabs = S; } }
	const paving = buildPaving(d);
	if (paving) scene.add(paving.mesh);
	// трава в швах плит — экземплярами с LOD и ветром (как подлесок), рисуется только вблизи
	if (slabs) buildHoudiniTrees(jointGrass(slabs.list), { ...plantCull, base: "../game/assets/models/joint_grass/", name: "JointGrass",
		minH: 1, lodDist: [80, 250], cull: [22, 0] }).then(J => { scene.add(J.group); jointGrassL = J; })
		.catch(e => console.error("[улица] трава в швах:", e, e.stack));
	// Слой «дома»: выключен — зданий нет вовсе (пользователь: «дома пока уберём»);
	// включён — модели hou там, где они есть, и коробки остальных зданий.
	const buildingBoxes = [];
	bo.group.traverse(o => { if (o.userData.building) buildingBoxes.push(o); });
	for (const o of buildingBoxes) o.visible = false;
	layerObjs.houses = { show: [], hide: [], load: async () => {
		const H = await loadHouses(d);
		scene.add(H.group); world.houses = H;
		const rest = buildingBoxes.filter(o => !H.ids.includes(o.userData.building));
		layerObjs.houses.show = [H.group, ...rest]; layerObjs.houses.load = null;
		if (H.ids.length) console.log(`[улица] дома-модели: ${H.ids.join(", ")}`);
		// мебель в квартирах — по описанию дома hou (<id>.json), строится при подходе; #interiors=0 — без неё
		if (q.get("interiors") !== "0") {
			interiors = createInteriors(scene, { wear: 0.5 });
			for (const b of d.buildings.filter(b => b.model && H.ids.includes(b.id))) {
				fetch(`../game/assets/models/houses/${b.model}/${b.model}.json`).then(r => r.ok ? r.json() : null)
					.then(info => { if (info && info.rooms) interiors.addHouse(b, info); }).catch(() => {});
			}
		}
	} };
	// Трава: карта «где растёт» из данных квартала → цвет земли + травинки у камеры.
	// #grass=0 — без травинок (A/B и слабые устройства), цвет земли остаётся.
	{
		const t0 = performance.now();
		// пол: слои по правилам ground в JSON; трава берёт из него, где её вытеснили
		const groundMap = buildGroundMap(d, { piles: bo.piles, trees: bo.trees });
		// твёрдые покрытия отражают небо — в лужах (шероховатость ~0) это и видно
		const roadMats = hardMaterials();
		{ const env = skyEnvMap(); for (const [mm] of roadMats) { mm.envMap = env; mm.envMapIntensity = 0.45; } }
		setGrassMap(buildGrassMap(d, bo.piles, groundMap));
		const gRes = +(q.get("gtex") || (matchMedia("(pointer: coarse)").matches ? 512 : 1024));
		setupGround(d, groundMaterial(), groundMap, { res: gRes, debug: q.get("ground") === "debug", hard: roadMats, trees: bo.trees })
			.then(r => {
				if (slabs) hardify(slabs.material, 0, { lite: true });
				if (paving) hardify(paving.material, 0, { lite: true });
				if (r && r.pits) loadPitGrass(r.pits).then(g => scene.add(g));
			})   // опад и камешки и на плитах
			.catch(e => console.error("[улица] пол:", e));
		loadRocks(groundMap, slabs ? slabs.list : []).then(R => { scene.add(R.group); rocks = R; }).catch(e => console.error("[улица] камешки:", e));
		if (q.get("grass") !== "0") {
			const phone = matchMedia("(pointer: coarse)").matches;
			// LOD: ближний участок + кольцо реже и шире; дальше — только цвет земли.
			// GRASS_DENS — во сколько раз гуще базовой сетки при той же площади участков
			// (шаг / √k, рядов × √k); #grassdens= — подобрать.
			const GRASS_DENS = +(q.get("grassdens") || 2), k = Math.sqrt(GRASS_DENS);
			const dense = ({ grid, spacing, ...o }) => ({ grid: Math.round(grid * k), spacing: grid * spacing / Math.round(grid * k), ...o });
			const nearCfg = dense(phone ? { grid: 120, spacing: 0.22 } : { grid: 200, spacing: 0.2 });
			const nearHalf = nearCfg.grid * nearCfg.spacing / 2;
			const gb = buildGrassBlades(nearCfg);
			const gr = buildGrassBlades(dense(phone ? { grid: 110, spacing: 0.6, ring: true, nearHalf, widthMul: 2.8 }
				: { grid: 180, spacing: 0.6, ring: true, nearHalf, widthMul: 2.8 }));
			scene.add(gb.mesh, gr.mesh);
			grassBlades = gb; grassNearHalf = nearHalf;
			layerObjs.grass = { show: [gb.mesh, gr.mesh], hide: [] };
			console.log(`[улица] трава: ${gb.blades} травинок до ${nearHalf.toFixed(0)} м + кольцо ${gr.blades} до ${(gr.extent / 2).toFixed(0)} м, карта за ${(performance.now() - t0).toFixed(0)} мс`);
		}
	}
	// ветер из данных уровня; #wind=0.3 — сила для проверки
	setWind({
		...(d.wind || {}),
		...(q.has("wind") ? { strength: parseFloat(q.get("wind")) || 0 } : {}),
		...(q.has("flutter") ? { flutter: parseFloat(q.get("flutter")) || 0 } : {}),
	});
if (q.has("sss")) windUniforms.uSSS.value = +q.get("sss");   // сила просвета листвы, 1 — по умолчанию
	loadTrees = async () => {
		const T = await buildHoudiniTrees(bo.trees, { ...plantCull, autumn: d.trees.autumn, lodDist: treeLod,
			onProgress: (s) => {
				if (s.loaded[0] === s.total) say(`деревья загружены целиком: ${s.total} вариантов × 3 LOD`);
				else if (s.loaded[1] % 10 === 0 || s.loaded[0] % 10 === 0)
					say(`деревья: LOD1 ${s.loaded[1]}/${s.total}, LOD0 ${s.loaded[0]}/${s.total}`);
			},
		});
		scene.add(T.group);
		houdiniTrees = T;
		console.log(`[улица] деревья HoudiniCOP: ${Object.keys(T.variants).length} вариантов на ${bo.trees.length} деревьев`);
	};
	if (treeMode === "on") await loadTrees();
	// Подлесок: раскладка правилами; модели — из game/assets/models/undergrowth/,
	// пока их нет — габаритные коробки, как весь блок-аут.
	{
		const bushes = undergrowthPositions(d, bo.trees, bo.piles)
			// на площадках плитки у входов кусты не растут
			.filter(([x, z]) => !(paving && paving.pads.some(r => x > r[0] - 0.5 && x < r[2] + 0.5 && z > r[1] - 0.5 && z < r[3] + 0.5)));
		const UB = "../game/assets/models/undergrowth/";
		let kit = null;
		try { const r = await fetch(UB + "kit.json", { cache: "no-store" }); if (r.ok) kit = await r.json(); } catch { /* ещё нет */ }
		if (kit && (kit.trees || []).some(t => t.species && t.age)) {
			const U = await buildHoudiniTrees(bushes, { ...plantCull, base: UB, name: "Undergrowth", minH: 4, autumn: d.trees.autumn, cull: [45, 20], lodDist: treeLod });
			scene.add(U.group);
			undergrowth = U;
			layerObjs.bushes = { show: [U.group], hide: [] };
		} else {
			const bb = bushBoxes(bushes);
			scene.add(bb);
			layerObjs.bushes = { show: [bb], hide: [] };
		}
		console.log(`[улица] подлесок: ${bushes.length} кустов, ${kit ? "модели" : "пока коробками"}`);
	}
	gameLayer = bo.game;
	// #robots=N — сколько роботов; по умолчанию 50
	const count = Math.max(1, parseInt(q.get("robots") || "50", 10) || 1);
	// #env=0 — без отражений на хроме (A/B и проверка, что тормозит именно оно)
	const envMap = q.get("env") === "0" ? null : skyEnvMap();
	const R = await spawnRobots(d, { count, start: [77, -26], envMap });
	crowd = R.robots; robotLod = R.updateLod; crowdStep = R.crowdStep;
	const robotsGroup = new THREE.Group();
	robotsGroup.name = "Robots";   // отдельный слой в разбивке цены кадра и в #off=robots
	for (const r of crowd) robotsGroup.add(r.object);
	scene.add(robotsGroup);
	layerObjs.robots = { show: [robotsGroup], hide: [] };
	robot = crowd[0];
	// #drones=N — военные разведчики над кварталом; по умолчанию 3
	spawnDrones(d, { count: Math.max(0, parseInt(q.get("drones") ?? "3", 10) || 0), robots: () => crowd })
		.then(D => {
		drones = D; scene.add(D.group);
		if (q.get("ride")) setRide(+q.get("ride") - 1);   // #ride=N — сразу в дроне N (снимки)
	}).catch(e => console.error("[дроны]", e));
	console.log(`[улица] роботов ${crowd.length}: шаг ${R.V.walk.toFixed(3)} м/с ${R.measured ? "измерен по анимации" : "ПО УМОЛЧАНИЮ"}, ` +
		`бег ${R.V.run ? R.V.run.toFixed(2) + " м/с" : "нет"}, узлов в графе ${R.nodes}`);
	say(`квартал: ${bo.stats.buildings} зданий, ${bo.stats.trees} деревьев, ${bo.stats.trash} куч мусора · роботов ${crowd.length} · F — камера за роботом, R — следующий, T — большие деревья`);
} else {
	const glsl = await (await fetch("./src/shaders/surface.glsl")).text();
	street = buildStreet(glsl);
	scene.add(street);
	const ground = buildGround(glsl);
	scene.add(ground);
	say("улица собрана");
}

/* ── обстановка из принятой библиотеки ──────────────────────────────────
   По умолчанию ВЫКЛЮЧЕНА. Библиотека — интерьер квартир, и на улице такие
   вещи оказываются не где попало, а у подъездов. Дома в веб-версии пока
   нет, поэтому раскладывать их сейчас — наряжать пустоту: расстановку всё
   равно придётся делать заново от дома. Включается `#props=1`. */
if (new URLSearchParams(location.hash.slice(1)).get("props") === "1") {
	loadProps(say).then((props) => scene.add(props));
}

/* ── камера: те же ракурсы, что были в игре ─────────────────────────── */
const VIEWS = LEVEL === "district" ? {
	Digit1: { p: [-175, 120, 165], yaw: -45, pitch: -24, name: "весь квартал" },
	Digit5: { p: [-39, 26, 37], yaw: -45, pitch: -27, name: "сквер (стартовый)" },
	Digit2: { p: [58, 45, 8.5], yaw: -45, pitch: -38, name: "игровая камера у башни 1" },
	Digit3: { p: [-145, 1.7, -95], yaw: -90, pitch: -3, name: "с проспекта глазами" },
	Digit4: { p: [0, 330, 0], yaw: 0, pitch: -89.9, name: "сверху" },
} : {
	Digit1: { p: [-16, 10, 16], yaw: -45, pitch: -26, name: "общий" },
	Digit2: { p: [-24, 1.70, 5.0], yaw: -78, pitch: -7, name: "с глаз" },
	Digit3: { p: [-3, 1.20, 6.2], yaw: -37, pitch: -16, name: "бордюр" },
	Digit4: { p: [0, 60, 6], yaw: 0, pitch: -84, name: "сверху" },
};
const cam = { p: new THREE.Vector3(-16, 10, 16), yaw: -45, pitch: -26, speed: 5 };

function applyView(v) {
	cam.p.set(...v.p);
	cam.yaw = v.yaw;
	cam.pitch = v.pitch;
}

// Камера смотрит вдоль своего −Z: yaw = 0 — взгляд в −Z, yaw = −90 — вдоль +X.
function updateCamera() {
	camera.position.copy(cam.p);
	camera.rotation.order = "YXZ";
	camera.rotation.set(cam.pitch * Math.PI / 180, cam.yaw * Math.PI / 180, 0);
	sun.target.position.set(cam.p.x, 0, cam.p.z);
	sun.position.set(
		cam.p.x + Math.cos(SUN_EL * Math.PI / 180) * Math.cos(SUN_AZ * Math.PI / 180) * SUN_DIST,
		Math.sin(SUN_EL * Math.PI / 180) * SUN_DIST,
		cam.p.z + Math.cos(SUN_EL * Math.PI / 180) * Math.sin(SUN_AZ * Math.PI / 180) * SUN_DIST,
	);
}

const keys = new Set();
addEventListener("keydown", (e) => {
	if (VIEWS[e.code]) { applyView(VIEWS[e.code]); say("ракурс: " + VIEWS[e.code].name); return; }
	if (e.code === "KeyR" && crowd.length) { nextRobot(1); return; }
	if (e.code === "KeyF" && robot) { toggleFollow(); return; }
	if (e.code === "KeyV") { nextRide(); return; }
	if (e.code === "Enter") { playing ? stopPlay() : startPlay(); return; }
	if (e.code === "KeyT" && loadTrees) { toggleLayer("trees"); return; }
	if (e.code === "KeyP" && hud.perfTable) {
		// разбивка цены кадра по слоям — что дорогое; время — только A/B на устройстве
		const shown = !hud.perfTable.hidden;
		hud.perfTable.hidden = shown;
		if (!shown) {
			const rows = breakdown(scene);
			console.table(rows);
			hud.perfTable.innerHTML = "<b>слой · вызовов · треуг · из них в тени</b><br>" + rows.map(r =>
				`${r.слой} · ${r.вызовов} · ${(r.треуг / 1000).toFixed(0)}k · ${r["в тени вызовов"]}/${(r["в тени треуг"] / 1000).toFixed(0)}k`).join("<br>");
		}
		return;
	}
	if (e.code === "KeyM") { doBench(); return; }
	if (e.code === "KeyG" && gameLayer) {
		gameLayer.visible = !gameLayer.visible;
		say(gameLayer.visible ? "игровые зоны показаны" : "игровые зоны скрыты");
		return;
	}
	if (e.code === "KeyN" && street) {
		debugMode = (debugMode + 1) % 3;
		setSurfaceUniform(street, "debugMode", debugMode);
		say(["покрытие", "нормаль цветом", "поле высот"][debugMode]);
		return;
	}
	if (e.code === "KeyB" && street) {
		bumpOn = !bumpOn;
		setSurfaceUniform(street, "bump", bumpOn ? 1 : 0);
		say(bumpOn ? "микрорельеф вкл" : "микрорельеф выкл");
		return;
	}
	keys.add(e.code);
});
addEventListener("keyup", (e) => keys.delete(e.code));

let debugMode = 0;
let bumpOn = true;

/* ── слои: деревья, трава, кусты, дома — кнопки справа вверху и клавиша T ── */
const layerOn = { trees: false, grass: true, bushes: true, houses: false, robots: true };
function syncLayerButtons() {
	for (const b of document.querySelectorAll("#layers button[data-layer]"))
		b.setAttribute("aria-pressed", String(!!layerOn[b.dataset.layer]));
}
async function toggleLayer(name) {
	const on = !layerOn[name];
	if (name === "trees") {
		if (!loadTrees) return;
		layerOn.trees = on;
		syncLayerButtons();
		if (on && !houdiniTrees) { say("деревья загружаются…"); await loadTrees(); }
		if (houdiniTrees) houdiniTrees.group.visible = layerOn.trees;
	} else {
		const L = layerObjs[name];
		if (!L) return;
		layerOn[name] = on;
		if (on && L.load) { syncLayerButtons(); say("загружается…"); await L.load(); }
		for (const o of L.show) o.visible = on;
		for (const o of L.hide) o.visible = !on;   // дома выключены — снова видны коробки
		syncLayerButtons();
	}
	say(`${({ trees: "деревья", grass: "трава", bushes: "кусты", houses: "дома", robots: "роботы" })[name]}: ${layerOn[name] ? "вкл" : "выкл"}`);
	saveLayers();
}
// Выбор слоёв помнится между перезагрузками (в этом браузере). Хеш адреса сильнее:
// #trees=…, #houses=on, #off=… — для замеров, они не перетираются памятью.
const LAYER_KEY = "district-layers";
function saveLayers() {
	try { localStorage.setItem(LAYER_KEY, JSON.stringify(layerOn)); } catch { /* без памяти — просто не помним */ }
}
function savedLayers() {
	try { return JSON.parse(localStorage.getItem(LAYER_KEY)) || {}; } catch { return {}; }
}
for (const b of document.querySelectorAll("#layers button[data-layer]"))
	b.addEventListener("click", () => toggleLayer(b.dataset.layer));

/* ── замер цены кадра «со слоем / без» (клавиша M, кнопка «замер», #bench=1) ── */
let benching = false;
async function doBench() {
	if (benching || !hud.perfTable) return;
	benching = true;
	hud.perfTable.hidden = false;
	hud.perfTable.innerHTML = "замер…";
	const rows = await runBench(scene, renderer, camera, { only: q.get("benchonly"), onStep: n => { hud.perfTable.innerHTML = "замер: без " + n + "…"; console.log("[улица] замер: без " + n); } });
	console.table(rows);
	for (const r of rows) console.log("[улица] BENCH " + JSON.stringify(r));
	console.log(`[улица] CPU кадра, мс: анимация ${cpuMs.anim.toFixed(2)} · раскладка растений/LOD ${cpuMs.plants.toFixed(2)} · отправка рендера ${cpuMs.render.toFixed(2)}`);
		for (const r of breakdown(scene)) console.log("[улица] PERF " + JSON.stringify(r));
	hud.perfTable.innerHTML = "<b>цена кадра, мс (медиана 30 кадров с ожиданием GPU)</b><br>" +
		rows.map(r => `${r.слой} · ${r.мс}${r.экономия !== "" ? ` · −${r.экономия}` : ""}`).join("<br>");
	benching = false;
}
{
	const b = document.getElementById("btn-bench");
	if (b) b.addEventListener("click", doBench);
}

/* ── действия камеры: общие для клавиш и кнопок на экране ─────────────── */
function nextRobot(step) {
	if (!crowd.length) return;
	followIdx = (followIdx + step + crowd.length) % crowd.length;
	robot = crowd[followIdx];
	if (!follow) { follow = true; cam.yaw = -45; cam.pitch = -35; }
	say(`камера за роботом №${followIdx + 1} из ${crowd.length}`);
}
// Сесть в дрон: камера под турелью, поворачивается вместе с дроном, мышью —
// оглядеться; широкий угол, как у настоящей курсовой камеры. V / кнопка «дрон»:
// первый → второй → … → выйти. Свой дрон прячем — иначе смотрим изнутри корпуса.
function setRide(i) {
	const list = drones ? drones.drones : [];
	if (ride >= 0 && list[ride]) list[ride].lod.visible = true;
	ride = i < list.length ? i : -1;
	if (ride >= 0) {
		const D = list[ride];
		D.lod.visible = false;
		follow = false;
		rideHeading = D.heading;
		cam.yaw = D.heading * 180 / Math.PI; cam.pitch = -25;
	}
	camera.fov = ride >= 0 ? RIDE_FOV : FOV;
	camera.updateProjectionMatrix();
}
function nextRide() {
	if (!drones || !drones.drones.length) { say("дронов нет"); return; }
	setRide(ride + 1);
	say(ride >= 0 ? `в дроне №${ride + 1} из ${drones.drones.length} · мышь — оглядеться, V — следующий, WASD — выйти` : "свободная камера");
}
const rideSeat = new THREE.Vector3();
function toggleFollow() {
	if (!robot) return;
	if (ride >= 0) setRide(-1);
	follow = !follow;
	if (follow) { cam.yaw = -45; cam.pitch = -35; }
	say(follow ? "камера за роботом" : "свободная камера");
}
function overview() {
	follow = false;
	if (ride >= 0) setRide(-1);
	applyView(VIEWS.Digit1);
	say("весь квартал");
}

/* ── мышь и пальцы ───────────────────────────────────────────────────────
   Мышь: тащить — осмотреться (как было). Палец, как в картах:
   за роботом — один палец вращает вокруг него, щипок — ближе/дальше;
   свободно — один палец двигает по земле, два — щипок и поворот. */
const touches = new Map();   // pointerId → {x, y}
let mouseDrag = false;
const pinch = () => {
	const [a, b] = [...touches.values()];
	return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
};
let lastPinch = null;

// Сдвиг камеры по земле на экранные пиксели: чем выше камера, тем дальше шаг.
function panGround(dx, dy) {
	const k = Math.max(2, cam.p.y) * 0.0025;
	const yaw = cam.yaw * Math.PI / 180;
	// «вправо» и «вперёд» камеры в плане (камера смотрит вдоль −Z при yaw = 0)
	const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
	cam.p.x -= (rx * dx - fx * dy) * k;
	cam.p.z -= (rz * dx - fz * dy) * k;
}
function orbit(dx, dy, k = 0.25) {
	cam.yaw -= dx * k;
	const lo = follow ? -85 : -89, hi = follow ? -5 : 60;
	cam.pitch = Math.max(lo, Math.min(hi, cam.pitch - dy * k));
}

canvas.addEventListener("pointerdown", (e) => {
	canvas.setPointerCapture(e.pointerId);
	if (e.pointerType === "mouse") { mouseDrag = true; return; }
	touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
	lastPinch = touches.size === 2 ? pinch() : null;
});
const release = (e) => {
	mouseDrag = false;
	touches.delete(e.pointerId);
	lastPinch = touches.size === 2 ? pinch() : null;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointermove", (e) => {
	if (e.pointerType === "mouse") {
		if (mouseDrag) orbit(e.movementX, e.movementY, 0.16);
		return;
	}
	const t = touches.get(e.pointerId);
	if (!t) return;
	const dx = e.clientX - t.x, dy = e.clientY - t.y;
	t.x = e.clientX; t.y = e.clientY;
	if (touches.size === 1) {
		if (follow) orbit(dx, dy);
		else panGround(dx, dy);
	} else if (touches.size === 2 && lastPinch) {
		const p = pinch();
		const zoom = lastPinch.d / Math.max(1, p.d);          // >1 — пальцы сошлись, отдаляем
		if (follow) followDist = Math.max(4, Math.min(200, followDist * zoom));
		else {
			// свободно: ближе/дальше вдоль взгляда, шаг от высоты
			const f = new THREE.Vector3();
			camera.getWorldDirection(f);
			cam.p.addScaledVector(f, (1 - zoom) * Math.max(5, cam.p.y) * 1.5);
			cam.p.y = Math.max(1.2, cam.p.y);
			panGround((p.mx - lastPinch.mx) / 2, (p.my - lastPinch.my) / 2);
		}
		cam.yaw -= (p.ang - lastPinch.ang) * 180 / Math.PI;   // поворот двумя пальцами
		lastPinch = p;
	}
});

// Кнопки на экране (для телефона; на компьютере те же действия на клавишах)
for (const [id, fn] of [["btn-prev", () => nextRobot(-1)], ["btn-next", () => nextRobot(1)],
	["btn-follow", toggleFollow], ["btn-all", overview], ["btn-drone", nextRide], ["btn-play", () => playing ? stopPlay() : startPlay()]]) {
	const b = document.getElementById(id);
	if (b) b.addEventListener("click", fn);
}
canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	if (playing) { playDist = Math.max(1.5, Math.min(12, playDist * (e.deltaY > 0 ? 1.12 : 0.89))); return; }
	if (follow) { followDist = Math.max(4, Math.min(200, followDist * (e.deltaY > 0 ? 1.12 : 0.89))); return; }
	cam.speed = Math.max(0.5, Math.min(60, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
}, { passive: false });

/* ── игра: герой бегает по кварталу и в домах ───────────────────────────
   Enter / кнопка «играть» — вход и выход. WASD — бег относительно камеры, Shift — шагом,
   пробел — прыжок, мышь (тащить) — осмотреться, колесо — ближе/дальше.
   Коллизия — земля и коробки блок-аута, заборы, площадка, коллизии домов hou;
   пересобирается, когда догрузилось новое (дома, их коллизии). */
let playDist = 4.5, autoRoute = null, autoT = 0;
function collectColliders() {
	const objs = [], H = world.houses;
	if (world.bo) world.bo.group.traverse(o => {
		if (!o.isMesh) return;
		for (let p = o; p; p = p.parent) if (p === world.bo.game) return;   // контуры игровых зон — не стены
		for (let p = o; p; p = p.parent) if (p.userData.building && H && H.ids.includes(p.userData.building)) return;   // у дома есть своя коллизия
		objs.push(o);
	});
	for (const g of [world.fences, world.playground]) if (g) objs.push(g);
	// Дома: коллизия — сама ближняя ступень модели (полы, тамбур, ступени, стены), без
	// дверных полотен, стёкол и дверей лифта. Отдельная <id>_col.glb у hou упрощена:
	// в ней нет пола тамбура (+0.45) — игрок проваливался под крыльцом.
	if (H) H.group.traverse(o => {
		if (!o.isLOD) return;
		o.levels[0].object.traverse(m => { if (m.isMesh && !/doors|glass|lift_door|windows/i.test(m.name)) objs.push(m); });
	});
	if (q.get("coldbg")) { const pt = new THREE.Vector3(...q.get("coldbg").split(",").map(Number)); for (const o of objs) o.traverse(m => { if (m.isMesh && new THREE.Box3().setFromObject(m).expandByScalar(0.35).containsPoint(pt)) console.log("COLDBG " + m.name + " / " + (m.parent && m.parent.name) + " " + JSON.stringify(m.userData)); }); }
	return objs;
}
function worldSig() {
	const H = world.houses;
	return [!!world.bo, !!world.fences, !!world.playground, H ? H.ids.length : -1, world.boxes.length].join("|");
}
async function startPlay() {
	if (LEVEL !== "district") { say("игра — на уровне квартала (#level=district)"); return; }
	if (!layerOn.houses) await toggleLayer("houses");
	if (!player) {
		player = await createPlayer(scene, { spawn: [108.5, 0.1, -20], envMap: skyEnvMap() });
		cam.yaw = 0; cam.pitch = -12;
	}
	player.root.visible = true;
	follow = false; if (ride >= 0) setRide(-1);
	playing = true;
	say("игра: WASD — бег, Shift — шагом, пробел — прыжок, мышь — осмотреться · Enter — выйти");
}
function stopPlay() { playing = false; if (player) player.root.visible = false; say("свободная камера"); }
let sigTimer = 0;
function playTick(dt) {
	sigTimer -= dt;
	if (sigTimer <= 0) {   // раз в секунду: не догрузилось ли что-то в коллизию
		sigTimer = 1;
		const s = worldSig();
		if (s !== world.sig) { world.sig = s; player.setColliders(collectColliders(), world.boxes); }
	}
	const y = cam.yaw * Math.PI / 180, f = new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y)), r = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
	move.set(0, 0, 0);
	if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(f);
	if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(f);
	if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(r);
	if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(r);
	if (autoRoute && autoRoute.length) {   // проверка: бежать по точкам маршрута (#route=)
		const [tx, tz] = autoRoute[0], dx = tx - player.pos.x, dz = tz - player.pos.z, dd = Math.hypot(dx, dz);
		if (dd < 0.25) { autoRoute.shift(); console.log(`PLAYERDBG точка ${player.pos.toArray().map(v => v.toFixed(2)).join(",")}`); }
		else move.set(dx / dd, 0, dz / dd);
		autoT += dt; if (autoT > 1) { autoT = 0; console.log(`PLAYERDBG ${player.pos.toArray().map(v => v.toFixed(2)).join(",")} ground=${player.onGround}`); }
	}	player.update(dt, move, { run: !(keys.has("ShiftLeft") || keys.has("ShiftRight")), jump: keys.has("Space") });
	player.cameraAt(camera, cam.yaw, cam.pitch, playDist);
	cam.p.copy(camera.position);   // тени, трава, LOD — от камеры
}

/* ── цикл ───────────────────────────────────────────────────────────── */
function resize() {
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if (canvas.width === w * renderer.getPixelRatio() &&
		canvas.height === h * renderer.getPixelRatio()) return;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	hud.res.textContent = `${Math.round(w * renderer.getPixelRatio())}×` +
		`${Math.round(h * renderer.getPixelRatio())}`;
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
let last = performance.now(), acc = 0, frames = 0;

function tick(now) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	acc += dt; frames++;
	if (acc > 0.5) {
		hud.fps.textContent = Math.round(frames / acc);
		if (hud.perf) hud.perf.textContent = `${(1000 * acc / frames).toFixed(1)} мс · ${infoLine(renderer)}`;
		acc = 0; frames = 0;
	}

	resize();

	if (playing && player) { playTick(dt); } else {
	move.set(0, 0, 0);
	camera.getWorldDirection(fwd);
	right.crossVectors(fwd, camera.up).normalize();
	if (keys.has("KeyW")) move.add(fwd);
	if (keys.has("KeyS")) move.sub(fwd);
	if (keys.has("KeyD")) move.add(right);
	if (keys.has("KeyA")) move.sub(right);
	if (keys.has("KeyE")) move.y += 1;
	if (keys.has("KeyQ")) move.y -= 1;
	if (move.lengthSq() > 1e-6) {
		follow = false;   // пошёл сам — отпускаем робота
		if (ride >= 0) setRide(-1);   // и выходим из дрона
		const fast = keys.has("ShiftLeft") || keys.has("ShiftRight");
		const sp = cam.speed * (fast ? 10 : 1) * dt;
		cam.p.addScaledVector(move.normalize(), sp);
	}
	}

	const cpu0 = performance.now();
	for (const r of crowd) r.update(dt);
	if (robotLod) robotLod(camera);
	if (crowdStep) crowdStep();
	if (drones) drones.update(dt, now / 1000);
	const cpu1 = performance.now();
	if (ride >= 0 && drones) {
		// камера на 12 см под турелью; курс дрона добавляется к взгляду — поворачиваемся с ним
		const D = drones.drones[ride];
		D.turrets[0].o.getWorldPosition(rideSeat);
		cam.p.copy(rideSeat).y -= 0.12;
		let dh = D.heading - rideHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
		cam.yaw += dh * 180 / Math.PI;
		rideHeading = D.heading;
	}
	if (follow && robot) {
		updateCamera();
		camera.getWorldDirection(fwd);
		cam.p.copy(robot.object.position).add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(fwd, -followDist);
	}

	updateCamera();
	if (houdiniTrees) houdiniTrees.update(camera, now / 1000);
	if (undergrowth) undergrowth.update(camera, now / 1000);
	if (grassBlades) {
		// Участок — вокруг робота, за которым идёт камера. Иначе — от БЛИЖАЙШЕЙ видимой
		// земли: точка, где её касается нижний край кадра, плюс полуширина участка вперёд,
		// но не дальше точки, куда смотрит камера. Раньше центр ставился в точку взгляда
		// (до 60 м): поднятая камера уносила ближнюю траву вперёд, и под ней оставалось
		// кольцо — редкие широкие травинки.
		if (follow && robot) grassCenter.copy(robot.object.position);
		else {
			const hitDist = (dir) => dir.y < -0.02 ? -camera.position.y / dir.y : Infinity;
			camera.getWorldDirection(grassRay);
			const fwd = new THREE.Vector2(grassRay.x, grassRay.z);
			const fl = fwd.length();
			const tLook = Math.min(hitDist(grassRay), 60);
			const lookH = fl * tLook;   // по горизонтали до точки взгляда
			bottomRay.set(0, -1, 0.5).unproject(camera).sub(camera.position).normalize();
			const bottomH = Math.hypot(bottomRay.x, bottomRay.z) * Math.min(hitDist(bottomRay), 200);
			const off = Math.min(lookH, bottomH + grassNearHalf * 0.5);
			if (fl > 1e-3) fwd.multiplyScalar(off / fl); else fwd.set(0, 0);
			grassCenter.set(camera.position.x + fwd.x, 0, camera.position.z + fwd.y);
		}
		// отгибают траву ближайшие к участку роботы
		const near = crowd.map(r => r.object.position)
			.filter(p => Math.abs(p.x - grassCenter.x) < 25 && Math.abs(p.z - grassCenter.z) < 25).slice(0, 8);
		updateGrass(grassCenter, near);
	}
	windUniforms.uTime.value = now / 1000;
	if (skyDome) { skyDome.update(camera, now / 1000); skyUniforms.uWind.value.copy(windUniforms.uWindDir.value); }
	if (playground) playground.update(now / 1000, dt);
	if (curbs) curbs.update(camera);
	if (slabs) slabs.update(camera);
	if (rocks) rocks.update(camera);
	if (jointGrassL) jointGrassL.update(camera, now / 1000);
	if (fenceIvy) fenceIvy.update(camera, now / 1000);
	if (interiors && layerOn.houses) interiors.update(camera);
	for (const I of instLods) I.update(camera);
	const cpu2 = performance.now();
	// время процессора (скользящее среднее): анимация (роботы, дроны), раскладка
	// растений и предметов по LOD — GPU-таймер замера его не видит
	cpuMs.anim += (cpu1 - cpu0 - cpuMs.anim) * 0.05;
	cpuMs.plants += (cpu2 - cpu1 - cpuMs.plants) * 0.05;
	hud.pos.textContent =
		`${cam.p.x.toFixed(1)} ${cam.p.y.toFixed(1)} ${cam.p.z.toFixed(1)}` +
		(robot ? ` · робот: ${robot.state}` : "");
	const cpu3 = performance.now();
	renderer.render(scene, camera);
	cpuMs.render += (performance.now() - cpu3 - cpuMs.render) * 0.05;   // отправка команд three.js (обход сцены, вызовы)
	requestAnimationFrame(tick);
}

applyView(VIEWS["Digit" + (q.get("view") || (LEVEL === "district" ? "5" : "1"))] || VIEWS.Digit1);
// #cam=x,y,z,tx,ty,tz — ракурс точкой и целью (снимки)
if (q.has("cam")) { const c = q.get("cam").split(",").map(Number); cam.p.set(c[0], c[1], c[2]); const dx = c[3] - c[0], dy = c[4] - c[1], dz = c[5] - c[2]; cam.yaw = Math.atan2(-dx, -dz) * 180 / Math.PI; cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI; }
if (q.has("debug") && street) {
	debugMode = parseInt(q.get("debug"), 10) || 0;
	setSurfaceUniform(street, "debugMode", debugMode);
}
if (gameLayer && q.get("game") === "0") gameLayer.visible = false;
// #sim=N — прокрутить роботов на N секунд до первого кадра. Headless-браузер
// почти не крутит кадры, и без этого харнесс видит всех на старте.
// Путь пишется для первого; сход с дорожки и состояния — по всей толпе.
if (robot && q.has("sim")) {
	const T = parseFloat(q.get("sim")) || 0, h = 1 / 30;
	let off = 0, lenPath = 0;
	const trace = [], states = {};
	const prev = new THREE.Vector3();
	for (let t = 0, i = 0; t < T; t += h, i++) {
		for (const r of crowd) {
			r.update(h);
			states[r.state] = (states[r.state] || 0) + h;
			if (i % 15 === 0) off = Math.max(off, r.offPath());
		}
		if (i > 0) lenPath += prev.distanceTo(robot.object.position);
		prev.copy(robot.object.position);
		if (i % 900 === 0) trace.push(`(${prev.x.toFixed(0)},${prev.z.toFixed(0)})`);
	}
	const total = Object.values(states).reduce((a, b) => a + b, 0);
	console.log(`[улица] sim ${T} с: первый прошёл ${lenPath.toFixed(0)} м, путь каждые 30 с: ${trace.join(" ")}; ` +
		`дальше всего от оси дорожки (все) ${off.toFixed(2)} м; ` +
		`доля по состояниям (все): ${Object.entries(states).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(", ")}`);
}
if (robot && q.get("follow") === "1") {
	// #idx=N — за каким роботом следить (на телефоне нет клавиши R)
	if (q.has("idx")) { followIdx = (parseInt(q.get("idx"), 10) || 0) % crowd.length; robot = crowd[followIdx]; }
	follow = true; cam.yaw = -45; cam.pitch = -35;
	if (q.has("dist")) followDist = parseFloat(q.get("dist")) || followDist;
}
if (q.get("bump") === "0" && street) {
	bumpOn = false;
	setSurfaceUniform(street, "bump", 0);
}

// Кнопки слоёв — только на уровне квартала; деревья включены, если их загрузили по #trees=on
if (LEVEL === "district") {
	layerOn.trees = !!houdiniTrees;
	document.getElementById("layers").hidden = false;
	syncLayerButtons();
	console.log("[улица] кнопки слоёв: " + Object.entries(layerOn).map(([k, v]) => `${k}=${v ? "вкл" : "выкл"}`).join(" "));
}

if (q.get("houses") === "on" && layerObjs.houses) await toggleLayer("houses");
// восстановить выбор из памяти — кроме слоёв, заданных в адресе
if (LEVEL === "district") {
	const saved = savedLayers(), fromHash = { trees: q.has("trees"), houses: q.has("houses") };
	for (const name of Object.keys(layerOn))
		if (name in saved && !!saved[name] !== layerOn[name] && !fromHash[name]) await toggleLayer(name);
}

// #play=1 — сразу в игру; #drive=KeyW:4,Space:0.3,KeyA:1 — проверка: нажатия по очереди (с), лог позиции
if (q.get("play") === "1") {
	await startPlay();
	if (q.get("route")) autoRoute = q.get("route").split(";").map(s => s.split(",").map(Number));
	if (q.get("drive")) (async () => {
		await new Promise(r => setTimeout(r, 4000));
		for (const step of q.get("drive").split(",")) {
			const [k, s] = step.split(":"); keys.add(k);
			const t0 = performance.now();
			while (performance.now() - t0 < +s * 1000) { await new Promise(r => setTimeout(r, 500)); console.log(`PLAYERDBG ${k} ${player.pos.toArray().map(v => v.toFixed(2)).join(",")} ground=${player.onGround}`); }
			keys.delete(k);
		}
	})();
}// #off=grass,bushes,… — выключить слои для замера «с фичей / без фичи»
if (q.has("off")) say("выключено для замера: " + applyOff(scene, renderer, q.get("off")).join(", "));
// #perf=1 — цена кадра по слоям в консоль сразу, без рендера (для харнесса:
// headless первый тяжёлый кадр рисует ненадёжно, а обход сцены ему не нужен).
// LOD кустов и деревьев выбирается заранее — иначе у них 0 экземпляров.
if (q.get("perf") === "1") {
	updateCamera();
	if (undergrowth) undergrowth.update(camera, 0);
	if (houdiniTrees) houdiniTrees.update(camera, 0);
	camera.updateMatrixWorld();
	scene.traverse(o => { if (o.isLOD) o.update(camera); });   // дома: уровень выбирается при рендере, а рендера ещё не было
	for (const r of breakdown(scene)) console.log("[улица] PERF " + JSON.stringify(r));
}

requestAnimationFrame(tick);
// #clean=1 — без HUD и кнопок (снимки для показа)
if (q.get("clean") === "1") {
	for (const id of ["hud", "layers", "pad"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
	if (gameLayer) gameLayer.visible = false;   // контуры игровых зон
}
// #bench=1 — замер сам через 8 с, #bench=N (N > 1) — через N с (догрузка фоновых слоёв), таблица в консоль
if (q.get("bench")) setTimeout(doBench, (+q.get("bench") > 1 ? +q.get("bench") : 8) * 1000);
