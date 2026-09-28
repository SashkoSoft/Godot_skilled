import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { MeshBVH } from "../vendor/three-mesh-bvh/index.module.js";

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
	const glow = new THREE.PointLight(0xffe2c0, 2.2, 7, 2);
	glow.position.set(0, 2.2, 0.6); root.add(glow);
	const mixer = new THREE.AnimationMixer(root);
	const clip = n => gltf.animations.find(a => a.name.toLowerCase() === n.toLowerCase());
	const A = { idle: clip("Idle-loop"), walk: clip("Walk-loop"), run: clip("Run-loop"), jump: clip("Idle_Jump") || clip("Walk_Jump") };
	const act = {};
	for (const [k, c] of Object.entries(A)) if (c) { act[k] = mixer.clipAction(c); if (k === "jump") { act[k].setLoop(THREE.LoopOnce, 1); act[k].clampWhenFinished = true; } }
	// скорости клипов (м/с) — замеры робота из толпы (robot.js): шаг 0.78, бег 2.68
	const V = { walk: 0.78, run: 2.68 };
	let cur = act.idle; cur.play();
	const fade = (a, t = 0.25) => { if (!a || a === cur) return; a.reset().play(); cur.crossFadeTo(a, t, false); cur = a; };

	const pos = new THREE.Vector3(...(spawn || [0, 0, 0])), vel = new THREE.Vector3();
	let heading = 0, onGround = false, bvh = null, colGeo = null;
	const seg = new THREE.Line3(), box = new THREE.Box3(), triPt = new THREE.Vector3(), segPt = new THREE.Vector3();
	const ray = new THREE.Ray(), down = new THREE.Vector3(0, -1, 0);

	/** Собрать коллизию из объектов (Object3D — всё, что внутри; Box3 — коробка). */
	function setColliders(objs, boxes = []) {
		const parts = [];
		for (const o of objs) {
			o.updateMatrixWorld(true);
			o.traverse(m => {
				if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.geometry.attributes.position) return;
				const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
				const pg = new THREE.BufferGeometry(); pg.setAttribute("position", g.attributes.position.clone());
				pg.applyMatrix4(m.matrixWorld); parts.push(pg);
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
		colGeo?.dispose();
		colGeo = new THREE.BufferGeometry(); colGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
		bvh = new MeshBVH(colGeo);
		console.log(`[игрок] коллизия: ${(n / 3) | 0} треугольников`);
	}

	function groundAt(p, maxDrop) {
		ray.origin.set(p.x, p.y + STEP + R, p.z); ray.direction.copy(down);
		const hit = bvh && bvh.raycastFirst(ray, THREE.DoubleSide);
		return hit && hit.distance <= STEP + R + maxDrop ? hit.point.y : null;
	}

	const input = new THREE.Vector3();
	/** move — направление в мире (длина 0..1), run — бег, jump — прыжок. */
	function update(dt, move, { run = true, jump = false } = {}) {
		if (!bvh) return;
		const speed = move.lengthSq() > 1e-4 ? (run ? V.run : V.walk) : 0;
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
		// пол
		const g = groundAt(pos, vel.y <= 0 ? 0.25 : -1);
		if (g !== null && vel.y <= 0 && pos.y <= g + 0.05) { pos.y = g; vel.y = 0; onGround = true; }
		else if (g !== null && vel.y <= 0 && onGround && pos.y - g < 0.3) { pos.y = g; vel.y = 0; }   // вниз по ступеням
		else onGround = false;
		if (pos.y < -30) { pos.set(...(spawn || [0, 0, 0])); vel.set(0, 0, 0); }   // провалился — назад
		// поворот корпуса к движению (−Z модели — лицо)
		const hs = Math.hypot(vel.x, vel.z);
		if (hs > 0.2) {
			const want = Math.atan2(-vel.x, -vel.z);   // лицо модели — −Z
			let da = want - heading; da = Math.atan2(Math.sin(da), Math.cos(da));
			heading += da * Math.min(1, dt * 12);
		}
		root.position.copy(pos); root.rotation.y = heading;
		// анимация по скорости: клип под фактическую скорость — ноги не скользят
		if (onGround && cur !== act.jump) {
			if (hs < 0.15) fade(act.idle);
			else if (hs < 1.4 || !act.run) { fade(act.walk); act.walk.timeScale = hs / V.walk; }
			else { fade(act.run); act.run.timeScale = hs / V.run; }
		} else if (onGround && cur === act.jump && vel.y <= 0) fade(act.idle, 0.15);
		mixer.update(dt);
	}

	/** Камера за спиной: yaw/pitch в градусах; стена между — придвигает. */
	const head = new THREE.Vector3(), camPos = new THREE.Vector3(), dirV = new THREE.Vector3();
	function cameraAt(camera, yaw, pitch, dist) {
		head.set(pos.x, pos.y + 1.45, pos.z);
		const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
		dirV.set(Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p));   // от головы к камере
		let d = dist;
		if (bvh) { ray.origin.copy(head); ray.direction.copy(dirV); const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (hit && hit.distance < d + 0.2) d = Math.max(0.4, hit.distance - 0.25); }
		camPos.copy(head).addScaledVector(dirV, d);
		camera.position.copy(camPos); camera.lookAt(head);
	}

	return { root, pos, setColliders, update, cameraAt, get onGround() { return onGround; }, get bvh() { return bvh; } };
}
