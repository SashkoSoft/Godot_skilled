import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { walkLines } from "./district.js";

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
export async function spawnRobots(d, { count = 1, seed = 7, start = null, envMap = null } = {}) {
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
	if (!measured) console.warn("[улица] робот: скорость шага не измерена, беру 1.2 м/с");
	const V = { idle: 0, walk: measured || 1.2, run: C.run ? measure(C.run) : null, crouch: 0 };
	V.sneak = C.sneak ? (measure(C.sneak) || 0.42) : null;
	V.back = C.back ? -(measure(C.back, -1) || 0.56) : null;   // назад: скорость со знаком минус
	probe.stopAllAction();
	// Режимы, для которых есть и цикл, и оба перехода. Нет — робот просто ходит.
	const can = {
		idle: !!(C.idle && C.idle_walk && C.walk_idle),
		run: !!(C.run && C.walk_run && C.run_walk && V.run),
		crouch: !!(C.crouch && C.idle_crouch && C.crouch_idle),
		sneak: !!(C.sneak && C.crouch_sneak && C.sneak_crouch && V.sneak),
		back: !!(C.back && C.idle_back && C.back_idle && V.back),
	};

	const graph = buildWalkGraph(d);
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
		if (i === 0 && start) {
			let best = Infinity;
			graph.forEach((n, j) => { const dd = Math.hypot(n.p[0] - start[0], n.p[1] - start[1]); if (dd < best) { best = dd; startNode = j; } });
		} else startNode = Math.floor(rand() * graph.length);
		robots.push(makeAgent(root, C, V, can, graph, rand, startNode));
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
			u.lodSets[want].forEach(m => { m.visible = true; });
			u.lodCur = want;
		}
	}
	return { robots, V, measured: !!measured, nodes: graph.length, updateLod };
}

function makeAgent(root, C, V, can, graph, rand, startNode) {
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

	// Прогулка: цель — узел, где робот бывал реже всего во всём квартале
	// (среди равных — наугад), путь к ней — кратчайший по графу. Выбор соседа
	// на развилке, даже «реже посещённого», топчется у тупиков у кромки улиц.
	const visits = new Array(graph.length).fill(0);
	let route = [];
	const dist = (a, b) => Math.hypot(graph[a].p[0] - graph[b].p[0], graph[a].p[1] - graph[b].p[1]);
	function shortest(from, to) {
		const dd = new Array(graph.length).fill(Infinity), back = new Array(graph.length).fill(-1), done = new Set();
		dd[from] = 0;
		while (done.size < graph.length) {
			let u = -1;
			for (let i = 0; i < graph.length; i++) if (!done.has(i) && (u < 0 || dd[i] < dd[u])) u = i;
			if (u < 0 || dd[u] === Infinity) break;
			done.add(u);
			if (u === to) break;
			for (const v of graph[u].nb) if (dd[u] + dist(u, v) < dd[v]) { dd[v] = dd[u] + dist(u, v); back[v] = u; }
		}
		const path = [];
		for (let v = to; v !== -1 && v !== from; v = back[v]) path.unshift(v);
		return dd[to] < Infinity ? path : [];
	}
	function nextNode() {
		while (!route.length) {
			const least = Math.min(...visits.filter((_, i) => i !== cur));
			const pool = graph.map((_, i) => i).filter(i => i !== cur && visits[i] === least);
			route = shortest(cur, pool[Math.floor(rand() * pool.length)]);
			if (!route.length) visits[cur]++;   // недостижимо — не зацикливаться
		}
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

	function chooseNext() {
		// Прямо из стойки в бег и из бега в стойку — если есть такие клипы; иначе через шаг.
		if (mode === "idle") {
			if (can.back && rand() < 0.06) return "back";
			if (can.crouch && rand() < crouchBias) return "crouch";
			return A.idle_run && V.run && rand() < runBias * 0.5 ? "run" : "walk";
		}
		if (mode === "crouch") return can.sneak && rand() < 0.5 ? "sneak" : "idle";
		if (mode === "sneak") return "crouch";
		if (mode === "back") return "idle";
		if (mode === "run") return A.run_idle && can.idle && rand() < 0.3 ? "idle" : "walk";
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
			if (FALL && rand() < 0.2) { startFall(); return; }   // иногда не удержался — упал
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

	function update(dt) {
		mixer.update(dt);
		gait(dt);
		const tp = graph[target].p;
		let dx = tp[0] - pos.x, dz = tp[1] - pos.y;
		if (Math.hypot(dx, dz) < 0.9) {
			target = nextNode();
			dx = graph[target].p[0] - pos.x; dz = graph[target].p[1] - pos.y;
		}
		// Идём туда, куда смотрим, и доворачиваем к цели: тело не едет боком.
		// Стоя не крутится: ω = v / R, при нулевой скорости поворота нет.
		const want = Math.atan2(dx, dz);
		const diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
		// пятясь, не рулит: доворот при отрицательной скорости крутил бы в обратную сторону
		const turn = speed > 0 ? speed / TURN_R : 0;
		heading += Math.sign(diff) * Math.min(Math.abs(diff), turn * dt);
		pos.x += Math.sin(heading) * speed * dt;
		pos.y += Math.cos(heading) * speed * dt;
		root.position.set(pos.x, 0, pos.y);
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
		object: root, update, offPath,
		get state() { return fall ? "fall:" + fall.stage : gesture ? gesture.getClip().name : trans ? `${trans.from}→${trans.to}` : mode; },
	};
}
