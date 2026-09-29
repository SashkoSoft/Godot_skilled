import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { MeshBVH } from "../vendor/three-mesh-bvh/index.module.js";
import { inPlace, flightShape, stairsPose } from "./stairs.js";

// Игрок: робот-герой от третьего лица, бегает по кварталу и внутри домов.
//
// Столкновения — «парящая капсула» по одной BVH из всей неподвижной геометрии
// (земля и коробки блок-аута, заборы, площадка, коллизии домов hou, коробки мебели):
//  • капсула (радиус 0.3) висит на STEP над ногами — всё ниже STEP она не задевает;
//  • стены и мебель выталкивают капсулу вбок (ближайшая точка треугольника к оси);
//  • пол — лучом вниз: попал в пределах STEP — стоим на нём (ступени, бордюр, крыльцо
//    берутся сами), дальше — падаем. Прыжок — скорость вверх, пока не оторвались от пола.
// Анимация — клипы того же робота: стойка, шаг, бег; скорость клипа = скорости тела
// (ноги не скользят). Камера — за спиной, мышь/палец вращают; стена между игроком и
// камерой её придвигает.

const DIR = "../game/assets/models/characters/";
const R = 0.3, STEP = 0.42, HEIGHT = 1.7, GRAV = -18, JUMP = 5.2;

/** Коллизия мира одной BVH (Object3D — все меши внутри; Box3 — коробка): герою и камерам.
 *  cut — вырезы в земле: у объектов из cut.objs выкидываются треугольники, центр которых над
 *  прямоугольником cut.rects ([x0, z0, x1, z1]) на высоте −1.1…0.6 (плиты земли над подвалом). */
export function buildCollision(objs, boxes = [], cut = null) {
	const parts = [];
	const cutTri = (pg) => {
		const a = pg.attributes.position.array, keep = [];
		for (let i = 0; i < a.length; i += 9) {
			const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
			if (cy > -1.1 && cy < 0.6 && cut.rects.some(r => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3])) continue;
			for (let k = 0; k < 9; k++) keep.push(a[i + k]);
		}
		pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(keep), 3));
	};
	for (const o of objs) {
		const doCut = cut && cut.rects.length && cut.objs.has(o);
		o.updateMatrixWorld(true);
		o.traverse(m => {
			if (!m.isMesh || m.isInstancedMesh || m.isBatchedMesh || m.isSkinnedMesh || !m.geometry.attributes.position) return;
			const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
			// вершины — во float: у сжатых моделей (руина, meshopt) они в int16 с нормализацией,
			// и applyMatrix4 записал бы мировые координаты обратно в int16 — пол руины пропадал
			const src = g.attributes.position, fa = new Float32Array(src.count * 3);
			for (let i = 0; i < src.count; i++) { fa[i * 3] = src.getX(i); fa[i * 3 + 1] = src.getY(i); fa[i * 3 + 2] = src.getZ(i); }
			const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(fa, 3));
			pg.applyMatrix4(m.matrixWorld);
			if (doCut) cutTri(pg);
			parts.push(pg);
		});
	}
	for (const b of boxes) {
		const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
		const g = new THREE.BoxGeometry(s.x, s.y, s.z).toNonIndexed(); g.translate(c.x, c.y, c.z);
		const pg = new THREE.BufferGeometry(); pg.setAttribute("position", g.attributes.position); parts.push(pg);
	}
	let n = 0; for (const p of parts) n += p.attributes.position.count;
	const arr = new Float32Array(n * 3); let o = 0;
	for (const p of parts) { arr.set(p.attributes.position.array, o); o += p.attributes.position.array.length; }
	const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
	console.log(`[игрок] коллизия: ${(n / 3) | 0} треугольников`);
	return new MeshBVH(geo);
}

/** Камера вокруг точки head: yaw/pitch в градусах, dist — отлёт; стена между — придвигает.
 *  bvh — одна BVH или список (стены; окна и стёкла — отдельно: герою не мешают, камеру держат в комнате). */
const _ray = new THREE.Ray(), _dir = new THREE.Vector3();
export function cameraOrbit(camera, bvh, head, yaw, pitch, dist) {
	const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
	_dir.set(Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p));   // от головы к камере
	let d = dist;
	_ray.origin.copy(head); _ray.direction.copy(_dir);
	for (const b of [].concat(bvh || [])) {
		const hit = b && b.raycastFirst(_ray, THREE.DoubleSide);
		if (hit && hit.distance < d + 0.2) d = Math.max(0.4, hit.distance - 0.25);
	}
	camera.position.copy(head).addScaledVector(_dir, d);
	camera.lookAt(head);
}

export async function createPlayer(scene, { spawn, envMap = null, tint = 0xff8a2a } = {}) {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const gltf = await loader.loadAsync(DIR + "robot_web.glb");
	const root = SkeletonUtils.clone(gltf.scene);
	root.traverse(o => {
		if (!o.isMesh) return;
		o.castShadow = true; o.receiveShadow = true;
		if (envMap && o.material.metalness > 0.5) o.material.envMap = envMap;
		if (o.material.name === "Glow") {   // полосы — свой цвет: герой отличается от толпы
			o.material = o.material.clone(); o.material.color.set(tint); o.material.emissive.set(tint);
		}
	});
	root.name = "Player";
	scene.add(root);
	// свет у героя: в квартирах и подъезде солнца почти нет — мягкий тёплый круг вокруг
	// (без тени: дёшево), снаружи днём его не видно
	const glow = new THREE.PointLight(0xffe2c0, 7, 10, 2);
	glow.position.set(0, 2.2, 0.6); root.add(glow);
	const mixer = new THREE.AnimationMixer(root);
	const clip = n => gltf.animations.find(a => a.name.toLowerCase() === n.toLowerCase());
	const A = { idle: clip("Idle-loop"), walk: clip("Walk-loop"), run: clip("Run-loop"), jump: clip("Idle_Jump") || clip("Walk_Jump"),
		stUp: inPlace(clip("StairsUp-loop")), stDown: inPlace(clip("StairsDown-loop")) };
	const act = {};
	for (const [k, c] of Object.entries(A)) if (c) { act[k] = mixer.clipAction(c); if (k === "jump") { act[k].setLoop(THREE.LoopOnce, 1); act[k].clampWhenFinished = true; } }
	// лестница: фазу клипа задаёт положение на марше, сам клип не идёт
	for (const k of ["stUp", "stDown"]) if (act[k]) act[k].timeScale = 0;
	// скорости клипов (м/с) — замеры робота из толпы (robot.js): шаг 0.78, бег 2.68
	const V = { walk: 0.78, run: 2.68 };
	let cur = act.idle; cur.play();
	const fade = (a, t = 0.25) => { if (!a || a === cur) return; a.reset().play(); cur.crossFadeTo(a, t, false); cur = a; };

	const pos = new THREE.Vector3(...(spawn || [0, 0, 0])), vel = new THREE.Vector3();
	let heading = 0, onGround = false, bvh = null, camBvh = null;
	const seg = new THREE.Line3(), box = new THREE.Box3(), triPt = new THREE.Vector3(), segPt = new THREE.Vector3();
	const ray = new THREE.Ray(), down = new THREE.Vector3(0, -1, 0);

	/** Собрать коллизию из объектов (Object3D — всё, что внутри; Box3 — коробка). */
	function setColliders(objs, boxes = []) { bvh = buildCollision(objs, boxes); }

	function groundAt(p, maxDrop) {
		ray.origin.set(p.x, p.y + STEP + R, p.z); ray.direction.copy(down);
		const hit = bvh && bvh.raycastFirst(ray, THREE.DoubleSide);
		return hit && hit.distance <= STEP + R + maxDrop ? hit.point.y : null;
	}

	// Марши домов (<id>.json → flights): на марше — клип лестницы, ноги по ступеням (stairs.js)
	let flights = [], onStairs = null, doorSegs = null;
	function setFlights(list) {
		flights = list.filter(f => f.passable !== false).map(f => {
			const F = flightShape(f);
			return { ...F, a: f.a, b: f.b, dx: (f.b[0] - f.a[0]) / F.len, dz: (f.b[2] - f.a[2]) / F.len, half: (f.width || 1.3) / 2 };
		});
	}
	function flightAt(p) {
		for (const F of flights) {
			const rx = p.x - F.a[0], rz = p.z - F.a[2], f = rx * F.dx + rz * F.dz;
			if (f < 0 || f > F.len || Math.abs(rx * F.dz - rz * F.dx) > F.half) continue;
			if (Math.abs(p.y - (F.a[1] + (F.b[1] - F.a[1]) * f / F.len)) > 0.5) continue;   // марш этажом выше/ниже
			return { F, f };
		}
		return null;
	}

	const input = new THREE.Vector3();
	/** move — направление в мире (длина 0..1), run — бег, jump — прыжок. */
	function update(dt, move, { run = true, jump = false } = {}) {
		if (!bvh) return;
		// по лестнице не разбежаться: бегом — через ступеньку быстрее, шагом — со скоростью клипа
		const speed = move.lengthSq() > 1e-4 ? (onStairs ? (run ? 1.3 : 0.45) : run ? V.run : V.walk) : 0;
		input.copy(move).setY(0); if (input.lengthSq() > 1) input.normalize();
		// разгон к нужной скорости (не мгновенно — меньше дрожи)
		const k = Math.min(1, dt * (onGround ? 12 : 2));
		vel.x += (input.x * speed - vel.x) * k; vel.z += (input.z * speed - vel.z) * k;
		if (onGround && jump) { vel.y = JUMP; onGround = false; if (act.jump) fade(act.jump, 0.1); }
		vel.y += GRAV * dt;
		pos.addScaledVector(vel, dt);
		// капсула над ногами: выталкивание из стен
		for (let it = 0; it < 3; it++) {
			seg.start.set(pos.x, pos.y + STEP + R, pos.z); seg.end.set(pos.x, pos.y + HEIGHT - R, pos.z);
			box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end); box.min.addScalar(-R); box.max.addScalar(R);
			let pushed = false;
			bvh.shapecast({
				intersectsBounds: b => b.intersectsBox(box),
				intersectsTriangle: tri => {
					const d = tri.closestPointToSegment(seg, triPt, segPt);
					if (d < R) {
						const dir = segPt.clone().sub(triPt); dir.y = 0;   // только вбок: пол — лучом
						if (dir.lengthSq() < 1e-8) return;
						dir.normalize().multiplyScalar(R - d);
						pos.add(dir); seg.start.add(dir); seg.end.add(dir); pushed = true;
					}
				},
			});
			if (!pushed) break;
		}
		// створки дверей (doors.js): твёрдые отрезки, круг капсулы выталкивается
		if (doorSegs) for (const [x0, z0, x1, z1] of doorSegs(pos)) {
			const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
			const t = Math.max(0, Math.min(1, ((pos.x - x0) * dx + (pos.z - z0) * dz) / L2));
			const cx = x0 + dx * t, cz = z0 + dz * t, ox = pos.x - cx, oz = pos.z - cz, d = Math.hypot(ox, oz);
			const need = R + 0.03;
			if (d < need && d > 1e-5) { pos.x = cx + ox / d * need; pos.z = cz + oz / d * need; }
		}
		// пол
		const g = groundAt(pos, vel.y <= 0 ? 0.25 : -1);
		if (g !== null && vel.y <= 0 && pos.y <= g + 0.05) { pos.y = g; vel.y = 0; onGround = true; }
		else if (g !== null && vel.y <= 0 && onGround && pos.y - g < 0.3) { pos.y = g; vel.y = 0; }   // вниз по ступеням
		else onGround = false;
		if (pos.y < -30) { pos.set(...(spawn || [0, 0, 0])); vel.set(0, 0, 0); }   // провалился — назад
		// поворот корпуса к движению (+Z модели — лицо, как у толпы в robot.js)
		const hs = Math.hypot(vel.x, vel.z);
		if (hs > 0.2) {
			const want = Math.atan2(vel.x, vel.z);
			let da = want - heading; da = Math.atan2(Math.sin(da), Math.cos(da));
			heading += da * Math.min(1, dt * 12);
		}
		root.rotation.y = heading;
		// на марше и идёт вдоль него — клип лестницы, высота тела — по ступеням, а не по лучу
		let visY = pos.y;
		const fl = onGround && act.stUp && flightAt(pos);
		const along = fl ? vel.x * fl.F.dx + vel.z * fl.F.dz : 0;
		onStairs = fl && Math.abs(along) > 0.1 ? fl.F : null;
		if (onStairs) {
			const F = fl.F, up = along > 0;
			const st = up ? stairsPose(F, true, fl.f, F.a[1], F.b[1]) : stairsPose(F, false, F.len - fl.f, F.b[1], F.a[1]);
			const a = up ? act.stUp : act.stDown;
			fade(a, 0.2);
			a.time = st.phase * a.getClip().duration;
			visY = st.y;
		}
		root.position.set(pos.x, visY, pos.z);
		// анимация по скорости: клип под фактическую скорость — ноги не скользят
		if (onStairs) { /* клип лестницы уже выбран */ }
		else if (onGround && cur !== act.jump) {
			if (hs < 0.15) fade(act.idle);
			else if (hs < 1.4 || !act.run) { fade(act.walk); act.walk.timeScale = hs / V.walk; }
			else { fade(act.run); act.run.timeScale = hs / V.run; }
		} else if (onGround && cur === act.jump && vel.y <= 0) fade(act.idle, 0.15);
		mixer.update(dt);
	}

	/** Камера за спиной: yaw/pitch в градусах; стена между — придвигает. */
	const head = new THREE.Vector3();
	function cameraAt(camera, yaw, pitch, dist) {
		head.set(pos.x, pos.y + 1.45, pos.z);
		cameraOrbit(camera, [bvh, camBvh], head, yaw, pitch, dist);
	}

	return { root, pos, setColliders, setBVH(b, cam = null) { bvh = b; camBvh = cam; }, setFlights, setDoors(fn) { doorSegs = fn; }, update, cameraAt, get onStairs() { return !!onStairs; }, get onGround() { return onGround; }, get bvh() { return bvh; } };
}
