import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { walkLines } from "./district.js";
import { addHouseToGraph, addTunnelsToGraph } from "./housenav.js";
import { inPlace, stairsPose } from "./stairs.js";
import { lootSequence } from "./lootui.js";

// Роботы бродят по кварталу: сеть проездов и троп из district.json превращается
// в граф, на развилке выбирается случайный путь, в тупике — разворот.

// Веб-версия от blend: meshopt + квантование, три LOD на одном скелете (53 кости,
// клипы одинаковые) — меш переключается на лету, скелет и миксер общие.
const DIR = "../game/assets/models/characters/";
const LOD_FILES = ["robot_web.glb", "robot_lod1_web.glb", "robot_lod2_web.glb"];
const LOD_DIST = [14, 35];   // м: дальше 14 — LOD1, дальше 35 — LOD2; гистерезис 10%

/* ── граф дорожек ───────────────────────────────────────────────────── */

function segIntersect(a, b, c, d) {
	const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
	const den = r[0] * s[1] - r[1] * s[0];
	if (Math.abs(den) < 1e-9) return null;
	const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
	const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
	return t > 1e-6 && t < 1 - 1e-6 && u > -1e-6 && u < 1 + 1e-6 ? t : null;
}

function project(p, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
	const q = [a[0] + t * dx, a[1] + t * dz];
	return { t, q, dist: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/**
 * Узлы — вершины ломаных и все пересечения; ребро — кусок отрезка между
 * соседними узлами. Конец тропы, не дотянутый до проезда (тропа кончается у
 * его кромки, а не на оси), пристёгивается к ближайшей точке оси.
 */
export function buildWalkGraph(d) {
	const lines = walkLines(d);   // проезды, тропы и тротуары — см. district.js
	const segs = [];
	for (const l of lines) for (let i = 1; i < l.path.length; i++) segs.push({ a: l.path[i - 1], b: l.path[i], cuts: [0, 1], half: l.half });

	for (let i = 0; i < segs.length; i++)
		for (let j = 0; j < segs.length; j++) {
			if (i === j) continue;
			const t = segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
			if (t !== null) segs[i].cuts.push(t);
		}

	const links = [];
	for (const l of lines) for (const end of [l.path[0], l.path[l.path.length - 1]]) {
		let best = null;
		for (const s of segs) {
			if (s.a === end || s.b === end) continue;
			const pr = project(end, s.a, s.b);
			if (pr.dist > 1e-3 && pr.dist <= s.half + 1.0 && (!best || pr.dist < best.pr.dist)) best = { s, pr };
		}
		if (best) { best.s.cuts.push(best.pr.t); links.push([end, best.pr.q]); }
	}

	const nodes = [];
	const nodeAt = p => {
		for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].p[0] - p[0], nodes[i].p[1] - p[1]) < 0.6) return i;
		nodes.push({ p: [p[0], p[1]], nb: [] });
		return nodes.length - 1;
	};
	const link = (i, j) => { if (i !== j && !nodes[i].nb.includes(j)) { nodes[i].nb.push(j); nodes[j].nb.push(i); } };
	for (const s of segs) {
		const ts = [...new Set(s.cuts)].sort((x, y) => x - y);
		let prev = null;
		for (const t of ts) {
			const id = nodeAt([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
			if (prev !== null) link(prev, id);
			prev = id;
		}
	}
	for (const [p, q] of links) link(nodeAt(p), nodeAt(q));
	return nodes;
}

/* ── скорость шага из самой анимации ────────────────────────────────── */

/**
 * Ходьба снята на месте, поэтому тело должно ехать вперёд с той скоростью,
 * с какой ступня едет назад. Порог «стопа на земле» здесь не годится: в этом
 * клипе ступня в опоре не стоит, а разгоняется (0.7 → 2.0 м/с за опору), и
 * среднее по порогу гуляет от 0.2 до 1.3 м/с в зависимости от порога.
 * Без порогов: ступня уходит назад на размах R за время T_назад, пока она
 * движется назад (dz < 0), — скорость R / T_назад, среднее по двум ногам.
 * Проскальзывание в опоре выводится отдельно, чтобы его было видно числом.
 */
// dir = −1 — ходьба назад: там стопа в опоре едет вперёд, замер тот же, ось навстречу.
function measureWalkSpeed(root, mixer, clip, dir = 1) {
	const feet = ["LeftFoot", "RightFoot"].map(n => root.getObjectByName(n));
	if (feet.some(f => !f)) return null;
	const N = 96, dt = clip.duration / N, v = new THREE.Vector3();
	const samples = [];
	for (let i = 0; i <= N; i++) {
		mixer.setTime(i * dt);
		root.updateMatrixWorld(true);
		samples.push(feet.map(f => f.getWorldPosition(v).clone()));
	}
	mixer.setTime(0);
	const speeds = [], contact = [];
	for (let k = 0; k < 2; k++) {
		const zs = samples.map(s => dir * s[k].z), ys = samples.map(s => s[k].y);
		let back = 0;
		for (let i = 1; i <= N; i++) if (zs[i] < zs[i - 1]) back++;
		if (!back) return null;
		speeds.push((Math.max(...zs) - Math.min(...zs)) / (back * dt));
		// скорость ступни, пока она у самой земли (в 1 см от нижней точки)
		const minY = Math.min(...ys);
		for (let i = 1; i <= N; i++) {
			if (ys[i] > minY + 0.01 || ys[i - 1] > minY + 0.01) continue;
			contact.push(-(zs[i] - zs[i - 1]) / dt);
		}
	}
	const rough = (speeds[0] + speeds[1]) / 2;
	// Чистая опора (ноги на IK): пока стопа на земле, она едет ровно со скоростью
	// тела — скорости собраны в узкий пучок, берём медиану. Отсчёты касания и
	// отрыва (почти ноль) отбрасываем. Пучок широкий — опора «плывёт», как в
	// старых клипах, — тогда размах / время хода назад.
	const top = Math.max(...contact, 0);
	const planted = contact.filter(v => v > 0.2 * top).sort((a, b) => a - b);
	const q = f => planted[Math.min(planted.length - 1, Math.floor(f * planted.length))];
	// Плато опоры: при мягкой постановке стопы у касания есть медленные отсчёты
	// (стопа доезжает), а дальше — ровная полка на скорости тела. Её и берём,
	// если она занимает заметную долю опоры.
	const plateau = planted.filter(v => v >= 0.85 * top);
	const med = plateau.length ? plateau[Math.floor(plateau.length / 2)] : 0;
	const clean = plateau.length >= 6 && plateau.length >= 0.4 * planted.length;
	const speed = clean ? med : rough;
	console.log(`[улица] робот: ${clip.name} ${speed.toFixed(2)} м/с ${clean ? "по стопе в опоре (опора чистая)" : "по размаху (опора плывёт)"}; ` +
		`стопа на земле ${planted.length ? `${q(0.1).toFixed(2)}…${q(0.9).toFixed(2)}` : "—"} м/с, по размаху ${rough.toFixed(2)}`);
	return speed;
}

/* ── робот ──────────────────────────────────────────────────────────── */

function rng(seed) {
	return () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
}

/**
 * Толпа роботов. Файл грузится и меряется один раз; каждый робот — клон со
 * своим скелетом, миксером, цветом полос (материал Glow) и характером:
 * своя фаза шага, свои длительности шага/стояния/бега и склонность бегать.
 */
// houses — [{ info }] описания домов hou: их комнаты, двери и марши продолжают граф улицы (housenav.js)
export async function spawnRobots(d, { count = 1, seed = 7, start = null, envMap = null, houses = [], tunnels = [] } = {}) {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const gltfs = await Promise.all(LOD_FILES.map(f => loader.loadAsync(DIR + f)));
	const gltf = gltfs[0], proto = gltf.scene;
	// меши дальних LOD — только геометрия и материалы, скелет берётся у клона LOD0
	const lodMeshes = gltfs.slice(1).map(g => { const m = []; g.scene.traverse(o => { if (o.isSkinnedMesh) m.push(o); }); return m; });
	const prep = o => {
		if (!o.isMesh) return;
		o.castShadow = true; o.receiveShadow = true;
		// Хромированные шарниры (metallic 1, roughness 0.06) без окружения чёрные:
		// металлу нечего отражать. Окружение — только им, не всей сцене.
		if (envMap && o.material.metalness > 0.5) o.material.envMap = envMap;
	};
	proto.traverse(prep);
	lodMeshes.flat().forEach(prep);

	// Клипы по точным именам: по подстроке «walk» нашлись бы и переходы.
	const byName = n => gltf.animations.find(a => a.name.toLowerCase() === n.toLowerCase());
	const C = {
		idle: byName("Idle-loop"), walk: byName("Walk-loop") || gltf.animations[0], run: byName("Run-loop"),
		idle_walk: byName("IdleToWalk"), walk_idle: byName("WalkToIdle"),
		walk_run: byName("WalkToRun"), run_walk: byName("RunToWalk"),
		idle_run: byName("IdleToRun"), run_idle: byName("RunToIdle"),   // рывок с места и торможение — без шага посередине
		// присед и крадущийся шаг вприсядку: в них и из них — только через стойку
		crouch: byName("Crouch-loop"), sneak: byName("CrouchWalk-loop"),
		idle_crouch: byName("IdleToCrouch"), crouch_idle: byName("CrouchToIdle"),
		crouch_sneak: byName("CrouchToCrouchWalk"), sneak_crouch: byName("CrouchWalkToCrouch"),
		// пятится: испугался и отступает — в стойку и из неё
		back: byName("WalkBack-loop"), idle_back: byName("StartleToWalkBack") || byName("IdleToWalkBack"), back_idle: byName("WalkBackToIdle"),
	};
	// Айдл-вариации: однократные, начинаются и кончаются позой Idle-loop.
	C.idleVars = gltf.animations.filter(a => /^(idle|jump|emote)_|^(duck|startle)$/i.test(a.name));   // прыжки, эмоции, «пригнуться» — из стойки в стойку
	// Спотыкания и прыжки с ходу: однократные, начинаются и кончаются позой своего цикла.
	C.walkTrips = gltf.animations.filter(a => /^walk_(trip|stagger|jump|duck)$/i.test(a.name));
	C.runTrips = gltf.animations.filter(a => /^run_(trip|jump)$/i.test(a.name));
	// Повороты на месте: клип сам доворачивает корпус на 90° и не сдвигается.
	C.turnL = byName("Turn_Left_90"); C.turnR = byName("Turn_Right_90");
	// Падение: упал вперёд → лежит → встаёт. Кость Root в этих клипах сама уезжает
	// вперёд; в конце подъёма тело стоит на FALL_SHIFT впереди места падения.
	C.fall = byName("Fall_Forward"); C.lie = byName("Lie-loop"); C.getup = byName("GetUp");
	// Лестница (blend, под ступени hou 0.1667×0.267): в цикле кость Root сама уезжает на две
	// ступени (0.534 м вперёд, 0.333 вверх). Движение из клипа вынимается, тело ведёт граф
	// по маршу с той же скоростью — ноги попадают на ступени.
	C.stairsUp = inPlace(byName("StairsUp-loop")); C.stairsDown = inPlace(byName("StairsDown-loop"));
	// Шаг в сторону на ходу (уступить дорогу): 25° от курса, 0.71 м/с вперёд и 0.33 вбок
	C.strafeL = byName("WalkStrafe-L-loop"); C.strafeR = byName("WalkStrafe-R-loop");
	// Лут (blend): из стойки к мебели → порыться → достать в сумку или «пусто» → отойти в стойку.
	// Отдельно от C: у C каждый клип становится действием автоматически.
	const LC = {};
	for (const n of ["LootCabinet-open-L", "LootCabinet-open-R", "LootCabinet-search-loop", "LootCabinet-take", "LootCabinet-empty", "LootCabinet-leave",
		"LootDrawer-open", "LootDrawer-search-loop", "LootDrawer-take", "LootDrawer-empty", "LootDrawer-leave",
		"LootLowDoor-open-L", "LootLowDoor-open-R", "LootLowDoor-search-loop", "LootLowDoor-take", "LootLowDoor-leave",
		"LootFloor-enter", "LootFloor-search-loop", "LootFloor-take", "LootFloor-empty", "LootFloor-leave",
		"Notice", "Watch-loop", "Point", "Call", "Watch-end", "Call-R", "Point-L",
		"Point-start", "Point-hold-loop", "Point-end", "Point-L-start", "Point-L-hold-loop", "Point-L-end"]) LC[n] = byName(n);   // и «заметил игрока»
	// сумка на поясе: вершины — в пространстве модели робота, вешается на кость Hips
	const bagG = await loader.loadAsync(DIR + "loot_bag_web.glb").catch(() => null);
	console.log(`[улица] робот: клипы ${gltf.animations.map(a => `${a.name} ${a.duration.toFixed(2)}с`).join(", ")}`);

	// Скорость каждого цикла — замером по его же анимации. Клип обязан играть
	// во время замера: без активного действия mixer.setTime ничего не двигает.
	const probe = new THREE.AnimationMixer(proto);
	function measure(clip, dir = 1) {
		probe.stopAllAction();
		const a = probe.clipAction(clip);
		a.play();
		const v = measureWalkSpeed(proto, probe, clip, dir);
		a.stop();
		return v > 0.1 ? v : null;
	}
	const measured = measure(C.walk);
	// скорость по маршу (по горизонтали) — из смещения Root за цикл
	const stairV = c => { const t = c && byName(c.name)?.tracks.find(t => t.name === "Root.position"); return t ? Math.abs(t.values[t.values.length - 1] - t.values[2]) / c.duration : null; };
	if (!measured) console.warn("[улица] робот: скорость шага не измерена, беру 1.2 м/с");
	const V = { idle: 0, walk: measured || 1.2, run: C.run ? measure(C.run) : null, crouch: 0 };
	V.sneak = C.sneak ? (measure(C.sneak) || 0.42) : null;
	V.back = C.back ? -(measure(C.back, -1) || 0.56) : null;   // назад: скорость со знаком минус
	V.stairsUp = stairV(C.stairsUp); V.stairsDown = stairV(C.stairsDown);
	probe.stopAllAction();
	// Режимы, для которых есть и цикл, и оба перехода. Нет — робот просто ходит.
	const can = {
		idle: !!(C.idle && C.idle_walk && C.walk_idle),
		run: !!(C.run && C.walk_run && C.run_walk && V.run),
		crouch: !!(C.crouch && C.idle_crouch && C.crouch_idle),
		sneak: !!(C.sneak && C.crouch_sneak && C.sneak_crouch && V.sneak),
		back: !!(C.back && C.idle_back && C.back_idle && V.back),
	};

	// лут: откуда брать места (furnish.js lootAt) — задаётся, когда мебель построена
	let lootFn = null;
	const graph = buildWalkGraph(d);
	const roomNodes = {};
	for (const H of houses) roomNodes[H.info.id] = addHouseToGraph(graph, H.info, H).roomNode;
	addTunnelsToGraph(graph, tunnels, roomNodes);   // подвалы соседних домов — под землёй
	// Дом без маршей в описании (старые b1, b5, b6) — острова квартир, с улицы в них не попасть:
	// такие узлы закрыты (cut), в них не стартуют и не ходят.
	const reach = new Uint8Array(graph.length), st = [];
	graph.forEach((n, j) => { if (!n.house) { reach[j] = 1; st.push(j); } });
	while (st.length) for (const v of graph[st.pop()].nb) if (!reach[v]) { reach[v] = 1; st.push(v); }
	const houseNodes = [], streetNodes = [];
	graph.forEach((n, j) => { if (!reach[j]) n.cut = true; else (n.house ? houseNodes : streetNodes).push(j); });
	if (houses.length) console.log(`[улица] роботы: в домах доступно узлов ${houseNodes.length}, закрыто ${graph.length - houseNodes.length - streetNodes.length}`);
	const robots = [];
	for (let i = 0; i < count; i++) {
		// каждый — клон нетронутого образца: в клон добавляются меши LOD1/LOD2, и если бы
		// первым роботом был сам образец, следующие клоны унаследовали бы его LOD-меши
		// как часть LOD0 (при возврате к LOD0 горели бы все три модели сразу)
		const root = SkeletonUtils.clone(proto);
		const rand = rng(seed + i * 7919);
		// LOD: меши LOD1/LOD2 садятся на скелет этого клона (кости одни, позы бинда одни)
		const lods = [[]];
		root.traverse(o => { if (o.isSkinnedMesh) lods[0].push(o); });
		const skinned = lods[0][0];
		for (const set of lodMeshes) {
			lods.push(set.map(src => {
				const m = new THREE.SkinnedMesh(src.geometry, src.material);
				m.name = src.name; m.castShadow = src.castShadow; m.receiveShadow = src.receiveShadow;
				skinned.parent.add(m);
				m.bind(skinned.skeleton, skinned.bindMatrix);
				m.visible = false;
				return m;
			}));
		}
		// Полосы — свой материал на робота, иначе перекрасились бы все сразу.
		const hue = i === 0 ? 0.55 : rand();
		for (const o of lods.flat()) {
			if (o.material.name !== "Glow") continue;
			o.material = o.material.clone();
			o.material.color.setHSL(hue, 0.85, 0.6);
			o.material.emissive.setHSL(hue, 0.9, 0.5);
		}
		// не в userData: three копирует userData через JSON при клонировании — меши с текстурами
		// сериализовались бы у каждого следующего робота (спам «Unable to serialize Texture»)
		root.lodSets = lods; root.lodCur = 0;
		let startNode;
		// каждый третий (кроме первого — за ним камера F) — обходчик домов, стартует внутри
		// все — обходчики (ищут лут), кроме первого: за ним камера F на улице
		const indoor = houseNodes.length > 0 && i > 0;
		if (i === 0 && start) {
			let best = Infinity;
			graph.forEach((n, j) => { if (n.house) return; const dd = Math.hypot(n.p[0] - start[0], n.p[1] - start[1]); if (dd < best) { best = dd; startNode = j; } });
		} else if (indoor) startNode = houseNodes[Math.floor(rand() * houseNodes.length)];
		else startNode = streetNodes[Math.floor(rand() * streetNodes.length)];
		if (indoor && bagG) {
			const hips = root.getObjectByName("Hips");
			if (hips) {
				root.updateMatrixWorld(true);
				const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(hips.matrixWorld);   // Hips в позе покоя, в осях модели
				const bag = bagG.scene.clone(true);
				bag.matrixAutoUpdate = false; bag.matrix.copy(rel).invert();
				bag.traverse(o => { if (o.isMesh) { o.castShadow = true; if (envMap && o.material.metalness > 0.5) o.material.envMap = envMap; } });
				hips.add(bag);
			}
		}
		robots.push(makeAgent(root, C, V, can, graph, rand, startNode, indoor, LC, () => lootFn));
	}
	// LOD по расстоянию до камеры, с гистерезисом — на границе не мигает
	const cp = new THREE.Vector3();
	function updateLod(camera) {
		camera.getWorldPosition(cp);
		for (const r of robots) {
			const u = r.object, dd = r.object.position.distanceTo(cp);
			let want = dd > LOD_DIST[1] ? 2 : dd > LOD_DIST[0] ? 1 : 0;
			if (want < u.lodCur && dd > LOD_DIST[want] * 0.9) want = u.lodCur;   // ближе порога на 10% — только тогда вверх
			if (want === u.lodCur) continue;
			u.lodSets[u.lodCur].forEach(m => { m.visible = false; });
			u.lodSets[want].forEach(m => { m.visible = true; m.castShadow = want === 0; });   // тень — только у ближних
			u.lodCur = want;
		}
	}
	// Толпа: встречные расходятся вбок (до 0.7 м от оси), лоб в лоб ближе метра —
	// изредка испуг и шаг назад. O(n²) на 50 роботах — пустяк.
	// others — ещё препятствия, которые сами не уступают (игрок): { position, heading }
	function crowdStep(others = []) {
		const n = robots.length, all = others.length ? robots.concat(others) : robots;
		for (let i = 0; i < n; i++) {
			const a = robots[i], pa = a.object.position, ha = a.heading;
			const fx = Math.sin(ha), fz = Math.cos(ha), rx = Math.cos(ha), rz = -Math.sin(ha);
			let push = 0;
			for (let j = 0; j < all.length; j++) {
				if (i === j) continue;
				const pb = all[j].object ? all[j].object.position : all[j].position, dx = pb.x - pa.x, dz = pb.z - pa.z, dd = Math.hypot(dx, dz);
				if (dd > 2.4 || dd < 1e-3 || Math.abs(pb.y - pa.y) > 1.2) continue;   // другой этаж / марш — не встречный
				const ahead = dx * fx + dz * fz, side = dx * rx + dz * rz;
				if (ahead < -0.5) continue;                        // сзади — не наша забота
				push -= Math.sign(side || (i < j ? 1 : -1)) * (2.4 - dd) / 2.4;
				const facing = Math.cos(all[j].heading - ha) < -0.6;
				if (facing && dd < 1.0 && Math.random() < 0.004) a.startle();
			}
			a.setAvoid(Math.max(-0.7, Math.min(0.7, push * 0.9)));
		}
	}
	return { robots, V, measured: !!measured, nodes: graph.length, updateLod, crowdStep, setLoot(fn) { lootFn = fn; } };
}

// indoor — «обходчик»: ходит и по домам (реже всего посещённые узлы — значит, рано или
// поздно каждая комната каждого этажа); иначе — только улица.
const ACT_RU = {
	walk: "идёт", run: "бежит", idle: "стоит", crouch: "присел", sneak: "крадётся", back: "пятится",
	Idle_LookAround: "оглядывается", Idle_LookAtHand: "разглядывает руку", Idle_Stretch: "потягивается", Idle_Wave: "машет",
	Idle_Wobble: "покачивается", Emote_Happy: "радуется", Emote_No: "качает головой", Emote_Nod: "кивает", Emote_Shrug: "пожимает плечами",
	Duck: "пригнулся", Startle: "вздрогнул", Jump_InPlace: "прыгает", Jump_Forward: "прыгает вперёд", Idle_Jump: "подпрыгивает",
	Walk_Trip: "споткнулся", Walk_Stagger: "пошатнулся", Walk_Jump: "перепрыгивает", Walk_Duck: "пригибается на ходу",
	Run_Trip: "споткнулся на бегу", Run_Jump: "прыгает на бегу",
	"LootCabinet-open": "открывает шкаф", "LootCabinet-search-loop": "роется в шкафу", "LootCabinet-take": "достаёт находку в сумку",
	"LootCabinet-empty": "пусто — разводит руками", "LootCabinet-leave": "отходит от шкафа",
	"LootDrawer-open": "выдвигает ящик", "LootDrawer-search-loop": "роется в ящике", "LootDrawer-take": "достаёт находку в сумку",
	"LootDrawer-empty": "пусто — разводит руками", "LootDrawer-leave": "встаёт от ящика",
	"LootLowDoor-open": "открывает тумбочку", "LootLowDoor-search-loop": "роется в тумбочке", "LootLowDoor-take": "достаёт находку в сумку",
	"LootLowDoor-leave": "встаёт от тумбочки",
	"LootFloor-enter": "склоняется к куче", "LootFloor-search-loop": "роется в куче вещей", "LootFloor-take": "достаёт находку в сумку",
	"LootFloor-empty": "пусто — выпрямляется", "LootFloor-leave": "выпрямляется",
};
function makeAgent(root, C, V, can, graph, rand, startNode, indoor = false, LC = {}, getLoot = () => null) {
	const mixer = new THREE.AnimationMixer(root);
	const A = {};
	const once = clip => {
		const a = mixer.clipAction(clip);
		a.setLoop(THREE.LoopOnce, 1);
		a.clampWhenFinished = true;
		return a;
	};
	const VARS = (C.idleVars || []).map(once);
	const TRIPS = { walk: (C.walkTrips || []).map(once), run: (C.runTrips || []).map(once) };
	const TURN = { [1]: C.turnL && once(C.turnL), [-1]: C.turnR && once(C.turnR) };   // +1 — налево (к +X при взгляде в +Z)
	for (const [k, clip] of Object.entries(C)) {
		if (!clip || Array.isArray(clip) || k === "turnL" || k === "turnR") continue;   // однократные — отдельно
		const a = mixer.clipAction(clip);
		const loop = !k.includes("_");
		a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
		a.clampWhenFinished = !loop;
		A[k] = a;
	}

	let cur = startNode, prev = -1;
	const pos = new THREE.Vector2(...graph[cur].p);
	let heading = 0;
	// Радиус поворота постоянный на любой скорости: ω = v / R. С постоянной ω
	// бегущий (3 м/с) описывал дугу втрое шире шагающего и срезал углы по газону.
	const TURN_R = 0.8;
	// в доме узлы в 0.3–0.8 м друг от друга (дверь, точка за ней, марш) — радиус меньше,
	// иначе робот описывает круги вокруг проёма
	const TURN_R_IN = 0.15;
	const indoors = () => !!(graph[target]?.house || (prev >= 0 && graph[prev].house));

	// Прогулка: цель — узел, где робот бывал реже всего во всём квартале
	// (среди равных — наугад), путь к ней — кратчайший по графу. Выбор соседа
	// на развилке, даже «реже посещённого», топчется у тупиков у кромки улиц.
	const visits = new Array(graph.length).fill(0);
	let route = [];
	const dist = (a, b) => Math.hypot(graph[a].p[0] - graph[b].p[0], graph[a].p[1] - graph[b].p[1]);
	// Дейкстра на двоичной куче: с домами в графе тысячи узлов, перебор за O(n²) дёргал кадр.
	// Уличный робот в дом не заходит — узлы дома для него закрыты.
	const allowed = i => !graph[i].cut && (indoor || !graph[i].house);
	// цели обходчика — только в домах: по улице он лишь переходит из дома в дом
	const goal = i => allowed(i) && (!indoor || graph[i].house);
	let home = null;   // дом, который обходчик сейчас обходит
	function shortest(from, to) {
		const dd = new Float64Array(graph.length).fill(Infinity), back = new Int32Array(graph.length).fill(-1);
		const heap = [[0, from]];
		dd[from] = 0;
		const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= e[0]) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
		const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
		while (heap.length) {
			const [du, u] = pop();
			if (du > dd[u]) continue;
			if (u === to) break;
			for (const v of graph[u].nb) {
				if (!allowed(v)) continue;
				const nd = du + dist(u, v);
				if (nd < dd[v]) { dd[v] = nd; back[v] = u; push([nd, v]); }
			}
		}
		const path = [];
		for (let v = to; v !== -1 && v !== from; v = back[v]) path.unshift(v);
		return dd[to] < Infinity ? path : [];
	}
	function nextNode() {
		// не дольше 12 попыток: цель недостижима — ей +1 посещение (в пул больше не попадёт);
		// раньше +1 шло самому роботу, и пул не менялся — вечный цикл, игра висла
		for (let tries = 0; !route.length && tries < 12; tries++) {
			// обходчик доделывает свой дом: в другой — только когда в своём всё обойдено не реже
			if (graph[cur].hid) home = graph[cur].hid;
			const leastOf = f => { let m = Infinity; for (let i = 0; i < graph.length; i++) if (i !== cur && f(i) && visits[i] < m) m = visits[i]; return m; };
			const inHome = i => goal(i) && graph[i].hid === home;
			const pick = home && leastOf(inHome) <= leastOf(goal) ? inHome : goal;
			const least = leastOf(pick);
			const pool = [];
			for (let i = 0; i < graph.length; i++) if (i !== cur && pick(i) && visits[i] === least) pool.push(i);
			if (!pool.length) break;
			const tgt = pool[Math.floor(rand() * pool.length)];
			route = shortest(cur, tgt);
			if (!route.length) visits[tgt]++;
		}
		// некуда идти — ближайший сосед (или стоим на месте)
		if (!route.length) route = graph[cur].nb.length ? [graph[cur].nb[Math.floor(rand() * graph[cur].nb.length)]] : [cur];
		prev = cur;
		cur = route.shift();
		visits[cur]++;
		return cur;
	}
	let target = nextNode();
	heading = Math.atan2(graph[target].p[0] - pos.x, graph[target].p[1] - pos.y);   // лицом к первой цели

	/* ── смена походки: шаг ⇄ стоит, шаг ⇄ бег ─────────────────────────
	   Как просила blend: переход запускается, когда текущий цикл проходит
	   фазу 0, плюс короткий crossfade. Переход кончается ровно на первом
	   кадре целевого цикла, туда и перетекаем. Стоять ⇄ бежать — только
	   через шаг. Скорость тела во время перехода — от скорости исходного
	   цикла к скорости целевого, по доле пройденного клипа.
	   Характер: у каждого робота свои пределы длительностей и склонность
	   к бегу — иначе толпа меняет походку синхронно и читается как один. */
	const range = (lo, hi) => lo + rand() * (hi - lo);
	const HOLD = {
		walk: [range(4, 10), range(12, 30)],
		idle: [range(1.5, 3), range(4, 10)],
		run: [range(2, 4), range(5, 12)],
		crouch: [range(2, 4), range(5, 12)],
		sneak: [range(3, 6), range(6, 14)],
		back: [range(0.8, 1.5), range(1.6, 3)],   // пятится недолго — с дорожки не уходит
	};
	const crouchBias = rand() * 0.3;   // кто-то почти не садится, кто-то любит посидеть на корточках
	const runBias = rand();   // 0 — домосед, 1 — бегун
	let mode = "walk", pending = null, trans = null;
	let modeTime = 0, modeHold = range(...HOLD.walk), lastT = 0;
	let active = A.walk;
	active.play();
	active.time = rand() * C.walk.duration;   // разная фаза шага с первого кадра
	let speed = V.walk;

	let lat = 0, latTarget = 0, scare = false;
	function chooseNext() {
		if (scare && mode === "idle") { scare = false; return "back"; }
		// Прямо из стойки в бег и из бега в стойку — если есть такие клипы; иначе через шаг.
		if (mode === "idle") {
			if (indoors()) return "walk";
			if (can.back && rand() < 0.06) return "back";
			if (can.crouch && rand() < crouchBias) return "crouch";
			return A.idle_run && V.run && rand() < runBias * 0.5 ? "run" : "walk";
		}
		if (mode === "crouch") return can.sneak && rand() < 0.5 ? "sneak" : "idle";
		if (mode === "sneak") return "crouch";
		if (mode === "back") return "idle";
		if (mode === "run") return A.run_idle && can.idle && rand() < 0.3 ? "idle" : "walk";
		if (indoors()) return can.idle && rand() < 0.5 ? "idle" : null;   // в доме не бегают
		if (can.run && can.idle) return rand() < runBias ? "run" : "idle";
		return can.run ? "run" : can.idle ? "idle" : null;
	}

	// Стоя — иногда жест (оглядеться, помахать, потянуться…). Жест начинается
	// и кончается позой Idle-loop, поэтому запускается на фазе 0 цикла и
	// перетекает обратно в цикл; пока жест идёт, робот не трогается с места.
	// Жест — однократный клип поверх цикла: айдл-вариации и прыжки из стояния,
	// спотыкания из шага и бега. Кончается позой своего цикла — в него и
	// перетекает. Скорость во время жеста задаёт сам жест.
	let gesture = null, gestureBack = "idle";
	const gestureChance = 0.35 + rand() * 0.4;   // у кого-то жестов больше
	const tripChance = 0.01 + rand() * 0.04;      // неуклюжесть: доля циклов шага со спотыканием
	// Прыжок вперёд: клип на месте, тело — на 1.2 м равномерно за полёт (1.00…1.58 с)
	const JUMP_FWD = { from: 1.0, to: 1.58, dist: 1.2 };

	function gestureSpeed(a) {
		const name = a.getClip().name;
		if (/^jump_forward$/i.test(name))
			return a.time >= JUMP_FWD.from && a.time <= JUMP_FWD.to ? JUMP_FWD.dist / (JUMP_FWD.to - JUMP_FWD.from) : 0;
		return V[gestureBack] || 0;   // спотыкание — на скорости своего цикла, стояние — 0
	}

	function startGesture(a, back) {
		gesture = a; gestureBack = back;
		a.reset().play();
		active.crossFadeTo(a, 0.15, false);
		lastT = 0;
	}

	// Поворот на месте: клип доворачивает корпус на 90°. В его конце курс тела
	// разом получает те же 90°, а поза — стойку без плавного перехода: последний
	// кадр поворота и есть стойка, повёрнутая на 90°. Плавный переход смешал бы
	// позу «уже повернулся» с «ещё нет» при уже повёрнутом теле — рывок.
	let turnSign = 0;
	// падение: этапы fall → lie → up; скорость тела 0 — тело двигает кость Root
	const FALL_SHIFT = 0.74;
	const FALL = C.fall && C.lie && C.getup ? { fall: once(C.fall), lie: mixer.clipAction(C.lie), up: once(C.getup) } : null;
	let fall = null;
	function startFall() {
		fall = { stage: "fall", t: 0, lie: range(2, 5) };
		FALL.fall.reset().play();
		(gesture || active).crossFadeTo(FALL.fall, 0.2, false);
		gesture = null; trans = null; pending = null;
	}
	function fallStep(dt) {
		speed = 0; fall.t += dt;
		const cur = FALL[fall.stage === "fall" ? "fall" : fall.stage === "lie" ? "lie" : "up"];
		const done = a => a.paused || a.time >= a.getClip().duration - 1e-4;
		if (fall.stage === "fall" && done(cur)) {
			FALL.lie.reset().play(); cur.crossFadeTo(FALL.lie, 0.2, false); fall.stage = "lie"; fall.t = 0;
		} else if (fall.stage === "lie" && fall.t > fall.lie) {
			FALL.up.reset().play(); cur.crossFadeTo(FALL.up, 0.2, false); fall.stage = "up";
		} else if (fall.stage === "up" && done(cur)) {
			// конец подъёма: тело уже на FALL_SHIFT впереди — переносим туда и ставим стойку
			pos.x += Math.sin(heading) * FALL_SHIFT; pos.y += Math.cos(heading) * FALL_SHIFT;
			A.idle.reset().play(); cur.stop(); FALL.lie.stop();
			active = A.idle; mode = "idle"; modeTime = 0; modeHold = range(...HOLD.idle); lastT = 0; fall = null;
		}
	}
	function wantDiff() {
		const tp = graph[target].p;
		const want = Math.atan2(tp[0] - pos.x, tp[1] - pos.y);
		return Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
	}

	function gait(dt) {
		if (fall) { fallStep(dt); return; }
		if (gesture) {
			const dur = gesture.getClip().duration;
			speed = gestureSpeed(gesture);
			if (turnSign && (gesture.paused || gesture.time >= dur - 1e-4)) {
				heading += turnSign * Math.PI / 2;
				A.idle.reset().play();
				gesture.stop();
				active = A.idle; gesture = null; turnSign = 0; lastT = 0;
				return;
			}
			if (gesture.paused || gesture.time >= dur - 1e-4) {
				const back = A[gestureBack];
				back.reset().play();
				gesture.crossFadeTo(back, 0.15, false);
				active = back; gesture = null; lastT = 0;
			}
			modeTime += dt;
			return;
		}
		if (trans) {
			const a = trans.action, dur = a.getClip().duration;
			const k = Math.min(1, a.time / dur);
			speed = V[trans.from] + (V[trans.to] - V[trans.from]) * k;
			if (a.paused || a.time >= dur - 1e-4) {
				const next = A[trans.to];
				next.reset().play();
				a.crossFadeTo(next, 0.1, false);
				active = next; mode = trans.to; trans = null;
				modeTime = 0; modeHold = range(...HOLD[mode]); lastT = 0;
			}
			return;
		}
		speed = V[mode];
		modeTime += dt;
		if (!pending && modeTime > modeHold) {
			pending = chooseNext();
			if (!pending) modeTime = 0;
		}
		const t = active.time;
		// Цикл стояния перевалил через фазу 0, уходить ещё рано — может, жест.
		if (mode === "idle" && !pending && t < lastT && VARS.length && rand() < gestureChance) {
			startGesture(VARS[Math.floor(rand() * VARS.length)], "idle");
			// Жест досматривается целиком: стоять не меньше, чем он длится.
			modeHold = Math.max(modeHold, modeTime + gesture.getClip().duration + 0.5);
			return;
		}
		// Шаг или бег перевалил через фазу 0 — изредка спотыкается (руины под ногами).
		const trips = TRIPS[mode];
		if (trips && trips.length && !pending && t < lastT && rand() < tripChance) {
			if (FALL && rand() < 0.2 && !indoors()) { startFall(); return; }   // иногда не удержался — упал
			startGesture(trips[Math.floor(rand() * trips.length)], mode);
			return;
		}
		// Трогаться, когда цель сбоку или сзади: сначала повернуться на месте
		// (дважды — для разворота), иначе робот уходит дугой в старую сторону.
		if (mode === "idle" && (pending === "walk" || pending === "run") && t < lastT) {
			const diff = wantDiff(), sgn = Math.sign(diff);
			if (Math.abs(diff) > Math.PI / 3 && TURN[sgn]) {
				turnSign = sgn;
				gesture = TURN[sgn]; gestureBack = "idle";
				gesture.reset().play();
				active.crossFadeTo(gesture, 0.15, false);
				lastT = 0;
				return;
			}
		}
		if (pending && t < lastT) {           // цикл перевалил через фазу 0
			const a = A[`${mode}_${pending}`];
			a.reset().play();
			active.crossFadeTo(a, 0.15, false);
			trans = { action: a, from: mode, to: pending };
			pending = null;
		}
		lastT = t;
	}

	// Марш: ребро между низом и верхом одного марша (housenav: flight). На нём — цикл
	// лестницы вверх или вниз поверх любой походки; сошёл — обратно в шаг.
	let stairs = null, strafe = null;
	const onFlight = () => prev >= 0 && graph[prev].flight && graph[prev].flight === graph[target].flight;
	function stairsStep() {
		const up = (graph[target].y || 0) > (graph[prev].y || 0), want = up ? A.stairsUp : A.stairsDown;
		if (stairs !== want) {
			const from = stairs || gesture || (trans && trans.action) || active;
			gesture = null; trans = null; pending = null; turnSign = 0; strafe = null;
			want.reset().play(); from.crossFadeTo(want, 0.25, false);
			stairs = want;
		}
		// две ступени за цикл — по проступи этого марша (у крыльца она шире)
		speed = 2 * graph[target].flight.tread / want.getClip().duration;
	}
	// Привязка клипа к ступеням (профили blend, stairs_profiles.json): в начале цикла вверх
	// подступенок — в 0.116 м впереди Root, проступь за ним — на 0.103 выше Root; вниз — край
	// в 0.054 м впереди, проступь под ногами — на 0.063 выше Root. Высота тела — прямая через
	// эти точки, фаза клипа — от пройденного по маршу (две ступени на цикл).
	function stairsY(NA, NB, f) {
		const st = stairsPose(NB.flight, NB.y > NA.y, f, NA.y, NB.y);
		stairs.time = st.phase * stairs.getClip().duration;
		return st.y;
	}
	function leaveStairs() {
		A.walk.reset().play(); stairs.crossFadeTo(A.walk, 0.25, false);
		active = A.walk; mode = "walk"; modeTime = 0; modeHold = range(...HOLD.walk); lastT = 0; stairs = null;
	}

	/* ── лут: крюк к мебели ───────────────────────────────────────────────
	   Войдя в комнату (дошёл до узла), обходчик иногда сворачивает к мебели с лутом: путь по
	   сетке комнаты (furnish.js), у мебели — лицом к ней, цепочка клипов blend, и тем же
	   путём назад на маршрут. Пока идёт крюк, походку не меняет. */
	const LOOT_P = 0.5;
	const bag = {};   // собранный лут: { gold, silver, bronze }
	let ex = null;   // { spot, pts, i, y, phase: go | loot | back, seq, step, t }
	const lootAction = (n, loop) => { const c = LC[n]; if (!c) return null; const a = mixer.clipAction(c); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; return a; };
	function lootSeq(kind) {
		const side = rand() < 0.5 ? "L" : "R", found = !!ex.spot.item;   // находит то, что лежит (карта лута)
		return lootSequence(kind, found, rand, n => !!LC[n]);
	}
	function exStart(res) {
		ex = { spot: res.spot, pts: res.pts, i: 0, y: res.y, phase: "go", seq: null, step: -1, t: 0, cur: null };
		gesture = null; trans = null; pending = null; turnSign = 0; strafe = null;
		if (active !== A.walk) { A.walk.reset().play(); (active || A.idle).crossFadeTo(A.walk, 0.2, false); active = A.walk; }
		mode = "walk";
	}
	function exPlay(k) {
		const [n, dur] = ex.seq[k], a = lootAction(n, dur !== undefined);
		a.reset().play();
		(ex.cur || active).crossFadeTo(a, 0.2, false);
		ex.cur = a; ex.step = k; ex.t = dur || a.getClip().duration;
	}
	function exTick(dt) {
		if (ex.phase === "loot") {
			speed = 0;
			// лицом к мебели
			let d = ex.spot.heading - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
			heading += Math.sign(d) * Math.min(Math.abs(d), dt * 4);
			if (ex.step < 0) { if (Math.abs(d) < 0.1) exPlay(0); return; }
				// дверца или ящик — по кадрам клипа открывания: от касания ручки до «открыто»
			if (ex.step === 0 && ex.spot.open) {
				const el = ex.cur.getClip().duration - ex.t, [t0, t1] = ex.spot.openT;
				ex.spot.open(Math.min(1, Math.max(0, (el - t0) / (t1 - t0))));
			}
			if ((ex.t -= dt) > 0) return;
			if (ex.step + 1 < ex.seq.length) { exPlay(ex.step + 1); return; }
			// отошёл — назад на маршрут тем же путём
			const it = ex.spot.item; ex.spot.item = null; ex.spot.looted = true; ex.spot.busy = false;
			if (it) bag[it] = (bag[it] || 0) + 1;
			A.walk.reset().play(); ex.cur.crossFadeTo(A.walk, 0.25, false); active = A.walk; mode = "walk";
			ex.pts = ex.pts.slice().reverse(); ex.i = 1; ex.phase = "back"; ex.cur = null;
			return;
		}
		speed = V.walk;
		const [tx, tz] = ex.pts[ex.i], dx = tx - pos.x, dz = tz - pos.y;
		if (Math.hypot(dx, dz) < 0.12) {
			ex.i++;
			if (ex.i >= ex.pts.length) {
				if (ex.phase === "go") { ex.phase = "loot"; ex.seq = lootSeq(ex.spot.kind); ex.step = -1; pos.set(tx, tz); }
				else { ex = null; target = nextNode(); }
				return;
			}
		}
		const want = Math.atan2(tx - pos.x, tz - pos.y);
		let d = want - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
		heading += Math.sign(d) * Math.min(Math.abs(d), dt * 5);
		pos.x += Math.sin(heading) * speed * dt; pos.y += Math.cos(heading) * speed * dt;
	}

	/* ── заметил игрока ──────────────────────────────────────────────────
	   setWatch(p, point): p — точка (Vector3, живая: позиция игрока), point — показать на неё.
	   Клипы blend: Notice (вздрогнул → стойка наблюдения) → Watch-loop; показывающий —
	   Point (рука на цель), потом Call (обернулся влево, машет «сюда»); потерял — Watch-end
	   в стойку. Голова (Neck) ведёт за целью поверх клипа; вес головы: в Notice растёт к
	   кадру готовности, в Call — отпущена (голова в клипе своя), в Watch-end — спадает.
	   Корпус доворачивается, если цель сбоку больше 60° (в Point — точно на цель). */
	let watchP = null, wPhase = null, wAct = null, wT = 0, pointPending = false, headW = 0;
	const neck = root.getObjectByName("Neck");
	const _up = new THREE.Vector3(0, 1, 0), _pq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion();
	const alert = n => { const c = LC[n]; if (!c) return null; const a = mixer.clipAction(c); const loop = /-loop$/.test(n); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; return a; };
	let hand = "", callSide = "", holdT = 0;   // рука указания ("" — правая, "-L" — левая); куда звать: "" — влево, "-R" — вправо
	function wPlay(n, fade = 0.25) {
		const a = alert(n);
		if (!a) return false;
		a.reset().play();
		(wAct || gesture || (trans && trans.action) || active).crossFadeTo(a, fade, false);
		gesture = null; trans = null; pending = null; strafe = null;
		wAct = a; wPhase = n; wT = 0;
		return true;
	}
	function setWatch(p, point = false, side = null) {
		if (side) callSide = side === "right" ? "-R" : "";
		if (!p) {
			if (watchP && wPhase !== "Watch-end") { if (!wPlay("Watch-end")) wEnd(); }
			watchP = null;
			return;
		}
		if (!watchP && wPhase !== "Watch-end") { pointPending = point; if (!wPlay("Notice", 0.2)) { wPhase = "Watch-loop"; } }
		else if (point) pointPending = true;
		watchP = p;
	}
	function startPoint() {
		pointPending = false;
		// рука — со стороны цели: у модели +X — левый бок (смотрит в +Z)
		const dx = watchP.x - pos.x, dz = watchP.z - pos.y, lx = Math.cos(heading) * dx - Math.sin(heading) * dz;
		hand = lx > 0.4 && LC["Point-L-start"] ? "-L" : "";
		if (!wPlay(`Point${hand}-start`) && !wPlay(`Point${hand}`)) wPlay("Watch-loop");
	}
	function wEnd() {
		A.idle.reset().play(); (wAct || active).crossFadeTo(A.idle, 0.25, false);
		active = A.idle; mode = "idle"; modeTime = 0; modeHold = range(...HOLD.idle); lastT = 0;
		wAct = null; wPhase = null; headW = 0;
	}
	function watchTick(dt) {
		wT += dt;
		speed = 0;
		const dur = wAct ? wAct.getClip().duration : 0, done = wAct && wAct.loop === THREE.LoopOnce && wT >= dur - 1e-3;
		// вес процедурной головы
		if (/^Call/.test(wPhase) || wPhase === "Notice") {}
		if (wPhase === "Notice") headW = Math.min(1, wT / 1.29);
		else if (/^Call/.test(wPhase)) headW = Math.max(0, headW - dt * 4);
		else if (wPhase === "Watch-end") headW = Math.max(0, 1 - wT / (dur * 0.7));
		else headW = Math.min(1, headW + dt * 3);
		if (wPhase === "Watch-end") { if (done) wEnd(); return; }
		if (done || !wAct) {
			if (/^Point.*-start$/.test(wPhase)) { holdT = 0; wPlay(`Point${hand}-hold-loop`); }
			else if (/^Point/.test(wPhase) && LC["Call" + callSide]) wPlay("Call" + callSide);
			else if (wPhase === "Notice" || /^Call/.test(wPhase) || !wAct) {
				if (pointPending) startPoint(); else wPlay("Watch-loop");
			}
		} else if (wPhase === "Watch-loop" && pointPending) startPoint();
		// держит руку, пока видит игрока (живая точка), но не дольше 6 с
		if (/-hold-loop$/.test(wPhase) && ((holdT += dt) > 6 || !watchP)) wPlay(`Point${hand}-end`);
		// корпус к цели: в Point — точно, иначе — если цель сбоку больше 60°
		if (!/^Call/.test(wPhase)) {
			const want = Math.atan2(watchP.x - pos.x, watchP.z - pos.y);
			const d = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
			const lim = /^Point/.test(wPhase) ? 0.02 : 1.05;
			if (Math.abs(d) > lim) heading += Math.sign(d) * Math.min(Math.abs(d) - lim * 0.6, dt * 1.8);
		}
	}
	function lookAtWatch() {
		const p = watchP || lastWatchP;
		if (!neck || !p || headW <= 0.01) return;
		const want = Math.atan2(p.x - root.position.x, p.z - root.position.z);
		const yaw = headW * Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(want - heading), Math.cos(want - heading))));
		const dy = p.y + 1.3 - (root.position.y + 2.1), dh = Math.hypot(p.x - root.position.x, p.z - root.position.z);
		const pitch = headW * Math.max(-0.5, Math.min(0.5, Math.atan2(dy, dh)));
		neck.parent.updateWorldMatrix(true, false);
		neck.parent.getWorldQuaternion(_pq).invert();
		_ax.copy(_up).applyQuaternion(_pq);
		neck.quaternion.premultiply(_q.setFromAxisAngle(_ax, yaw));
		_ax.set(Math.cos(want), 0, -Math.sin(want)).applyQuaternion(_pq);
		neck.quaternion.premultiply(_q.setFromAxisAngle(_ax, -pitch));
	}
	let lastWatchP = null;

	function update(dt) {
		mixer.update(dt);
		if ((watchP || wPhase) && !ex && !stairs) {
			if (watchP) lastWatchP = watchP;
			watchTick(dt);
			root.position.set(pos.x, root.position.y, pos.y); root.rotation.y = heading;
			root.updateMatrixWorld(true); lookAtWatch();
			return;
		}
		if (ex) {
			exTick(dt);
			if (ex) { root.position.set(pos.x, ex.y, pos.y); root.rotation.y = heading; return; }
		}
		if (A.stairsUp && A.stairsDown && V.stairsUp && onFlight()) stairsStep();
		else { if (stairs) leaveStairs(); gait(dt); }
		// Уступить дорогу — шаг в сторону на ходу (клип), а не скольжение вбок
		const dl = latTarget - lat;
		if (!stairs && mode === "walk" && !trans && !gesture && A.strafeL && A.strafeR) {
			const want = Math.abs(dl) > 0.1 ? (dl > 0 ? A.strafeL : A.strafeR) : null;   // +lat — влево (к +X при взгляде в +Z)
			if (want !== strafe) {
				const to = want || A.walk;
				to.reset().play(); (strafe || A.walk).crossFadeTo(to, 0.25, false);
				active = to; strafe = want;
			}
		} else if (strafe && active === strafe) {   // походку сменили не мы — вернуть шаг
			A.walk.reset().play(); strafe.crossFadeTo(A.walk, 0.2, false); active = A.walk; strafe = null;
		} else strafe = null;
		if (strafe) speed = V.walk * 0.91;   // по курсу 0.71 из 0.78
		const tp = graph[target].p;
		let dx = tp[0] - pos.x, dz = tp[1] - pos.y;
		// в доме узлы тесные (двери, марши) — подходим ближе, чем на улице
		if (Math.hypot(dx, dz) < (graph[target].r ?? 0.9)) {
			// в комнате — может свернуть к мебели с лутом
			const lf = indoor && !stairs && getLoot();
			if (lf && graph[target].house && rand() < LOOT_P) {
				const res = lf({ x: pos.x, y: graph[target].y || 0, z: pos.y }, rand);
				if (res) { exStart(res); return; }
			}
			target = nextNode();
			dx = graph[target].p[0] - pos.x; dz = graph[target].p[1] - pos.y;
		}
		// Идём туда, куда смотрим, и доворачиваем к цели: тело не едет боком.
		// Стоя не крутится: ω = v / R, при нулевой скорости поворота нет.
		const want = Math.atan2(dx, dz);
		const diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
		// пятясь, не рулит: доворот при отрицательной скорости крутил бы в обратную сторону
		const turn = speed > 0 ? speed / (indoors() ? TURN_R_IN : TURN_R) : 0;
		heading += Math.sign(diff) * Math.min(Math.abs(diff), turn * dt);
		pos.x += Math.sin(heading) * speed * dt;
		pos.y += Math.cos(heading) * speed * dt;
		// расхождение со встречными: плавный сдвиг вбок от оси дорожки (crowdStep задаёт цель)
		if (strafe) lat += Math.sign(dl) * Math.min(Math.abs(dl), 0.33 * dt);   // вбок — со скоростью клипа
		else lat += (latTarget - lat) * Math.min(1, dt * 2.5);
		// высота: между предыдущим узлом и целью — по пройденной доле (марши, крыльцо)
		const NA = graph[prev >= 0 ? prev : target], NB = graph[target];
		const segL = Math.hypot(NB.p[0] - NA.p[0], NB.p[1] - NA.p[1]), left = Math.hypot(NB.p[0] - pos.x, NB.p[1] - pos.y);
		const k = segL > 1e-3 ? Math.min(1, Math.max(0, 1 - left / segL)) : 1;
		const y = stairs && NA.flight && NA.flight === NB.flight ? stairsY(NA, NB, segL - left) : (NA.y || 0) + ((NB.y || 0) - (NA.y || 0)) * k;
		// в доме сдвиг вбок меньше: прихожие в метр шириной
		const la = indoors() ? Math.max(-0.25, Math.min(0.25, lat)) : lat;
		root.position.set(pos.x + Math.cos(heading) * la, y, pos.y - Math.sin(heading) * la);
		root.rotation.y = heading;
	}
	update(0);

	// Расстояние от ближайшей оси проезда/тропы — проверка, что робот не срезает по газону
	function offPath() {
		let best = Infinity;
		for (const n of graph) for (const j of n.nb) best = Math.min(best, project([pos.x, pos.y], n.p, graph[j].p).dist);
		return best;
	}

	return {
		object: root, update, offPath, indoor,
		/** Что делает сейчас — словами (подпись в режиме наблюдения). */
		get action() {
			if (wPhase && !ex) return (/^Point/.test(wPhase) ? "показывает на игрока" : /^Call/.test(wPhase) ? "зовёт остальных" : { Notice: "заметил игрока", "Watch-end": "отворачивается" }[wPhase]) || "следит за игроком";
			if (ex) return ex.phase === "loot" ? (ex.cur ? ACT_RU[ex.cur.getClip().name.replace(/-(L|R)$/, "")] || "обыскивает" : "подходит к мебели") : ex.phase === "go" ? "идёт к мебели" : "возвращается";
			if (fall) return "упал";
			if (stairs) return stairs === A.stairsUp ? "поднимается по лестнице" : "спускается по лестнице";
			if (strafe) return "уступает дорогу";
			if (gesture) return turnSign ? "поворачивается" : (ACT_RU[gesture.getClip().name] || "жест");
			if (trans) return ACT_RU[trans.to] || trans.to;
			return ACT_RU[mode] || mode;
		}, bag, setWatch, get watching() { return !!watchP; }, get onStairs() { return !!stairs; }, get looting() { return ex ? ex.phase : null; }, get strafing() { return !!strafe; },
		get heading() { return heading; }, get speed() { return speed; }, get mode() { return mode; },
		setAvoid(v) { latTarget = v; },
		// испуг от встречного: только стоя или на ходу, с шансом — отшатнуться и попятиться
		startle() { if (mode === "walk" && !gesture && !trans && !pending && can.back) pending = "idle", scare = true; },
		get state() { return fall ? "fall:" + fall.stage : gesture ? gesture.getClip().name : trans ? `${trans.from}→${trans.to}` : mode; },
	};
}
