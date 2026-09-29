import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { rectsOf, heightOf } from "./district.js";

// Военные дроны-разведчики (blend, drone_recon, 3 LOD) патрулируют квартал:
//  • облёт по кругу маршрутных точек на высоте 15–25 м, крен по ускорению;
//  • время от времени — к ближайшему роботу: зависает над ним на ~10 м, турель
//    (узел Turret: рыскание Y, наклон X) следит за целью;
//  • винты: FL и RR против часовой (сверху), FR и RL — по часовой; ~25 об/с — для глаза;
//  • красный огонь — строб.
// Нос модели — −Z.

const DIR = "../game/assets/models/props/drone/";
const LOD_DIST = [30, 90];
const SPEED = 7;            // м/с на маршруте
const PROP_RPS = 25;

function rng(seed) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function spawnDrones(d, { count = 3, robots = () => [] } = {}) {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const scenes = await Promise.all(["", "_lod1", "_lod2"].map(s => loader.loadAsync(`${DIR}drone_recon${s}_web.glb`).then(g => g.scene)));
	const group = new THREE.Group();
	group.name = "Drones";
	const [bx0, bz0, bx1, bz1] = d.bounds;
	const drones = [];

	for (let k = 0; k < count; k++) {
		const R = rng(1000 + k * 77);
		const lod = new THREE.LOD();
		const props = [], turrets = [], strobes = [];
		const strobeMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 0 });
		scenes.forEach((s, i) => {
			const c = s.clone();
			c.traverse(o => {
				if (o.isMesh) {
					o.castShadow = i === 0; o.receiveShadow = false;
					if (o.material && o.material.name === "led_red") o.material = strobeMat;
				}
				const m = /^Prop_(FL|FR|RL|RR)$/.exec(o.name);
				if (m) props.push({ o, dir: m[1] === "FL" || m[1] === "RR" ? 1 : -1 });   // +Y поворот = против часовой сверху
				if (o.name === "Turret") turrets.push({ o, base: o.quaternion.clone() });
			});
			lod.addLevel(c, i ? LOD_DIST[i - 1] : 0, 0.1);
		});
		// маршрут: 5–7 точек по кольцу вокруг центра квартала
		const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, rx = (bx1 - bx0) * 0.38, rz = (bz1 - bz0) * 0.38;
		const n = 5 + Math.floor(R() * 3), a0 = R() * Math.PI * 2, spin = k % 2 ? 1 : -1;
		const route = [];
		for (let i = 0; i < n; i++) {
			const a = a0 + spin * (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5, s = 0.55 + R() * 0.45;
			route.push(new THREE.Vector3(cx + Math.cos(a) * rx * s, 15 + R() * 10, cz + Math.sin(a) * rz * s));
		}
		lod.position.copy(route[0]);
		group.add(lod);
		drones.push({
			lod, props, turrets, strobeMat, route, wp: 1,
			vel: new THREE.Vector3(), vdes: new THREE.Vector3(), tilt: new THREE.Vector2(), yawRate: 0, heading: 0, state: "patrol", timer: 8 + R() * 12, target: null,
			phase: R() * 10, R,
		});
	}

	// Облёт домов: башни по 37 м выше маршрута (15–25 м). Высота над точкой — крыша
	// ближайшего дома (с запасом 8 м по плану) + 6 м; смотрим на 14 и 28 м вперёд к цели.
	// Ниже нужного — сначала подъём на месте, потом вперёд.
	const roofs = d.buildings.flatMap(b => rectsOf(b).map(r => [r[0] - 8, r[1] - 8, r[2] + 8, r[3] + 8, heightOf(b) + 6]));
	const clearAt = (x, z) => { let h = 0; for (const r of roofs) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) h = Math.max(h, r[4]); return h; };
	const want = new THREE.Vector3(), tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
	const euler = new THREE.Euler(0, 0, 0, "YXZ"), inv = new THREE.Matrix4();

	// Поле зрения камеры дрона — пятно на земле: куда смотрит подвес, с раствором FOV_HALF.
	// Эллипс (наклонный луч вытягивает пятно), мягкий край, кольцо-развёртка бежит от центра;
	// следит за целью — пятно краснеет. Плоскость чуть над землёй, видна сквозь траву.
	const FOV_HALF = 0.32;
	const fovMat = new THREE.ShaderMaterial({
		transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
		uniforms: { uT: { value: 0 } },
		vertexShader: `attribute float aLock; varying vec2 vUv; varying float vLock; void main() { vUv = uv * 2.0 - 1.0; vLock = aLock;
			gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
		fragmentShader: `uniform float uT; varying vec2 vUv; varying float vLock; void main() {
			float r = length(vUv); if (r > 1.0) discard;
			float edge = smoothstep(1.0, 0.93, r) * (1.0 - smoothstep(0.93, 0.8, r));      // кромка
			float fill = (1.0 - r) * 0.10;
			float scan = smoothstep(0.06, 0.0, abs(r - fract(uT * 0.45))) * 0.35;
			vec3 c = mix(vec3(1.0, 0.72, 0.25), vec3(1.0, 0.18, 0.12), vLock);
			gl_FragColor = vec4(c * (edge * 0.9 + fill + scan), 1.0); }`,
	});
	const fovGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
	const fov = new THREE.InstancedMesh(fovGeo, fovMat, Math.max(1, drones.length));
	fov.geometry.setAttribute("aLock", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, drones.length)), 1));
	fov.name = "DroneFOV"; fov.frustumCulled = false; fov.renderOrder = 5;
	group.add(fov);
	const _fd = new THREE.Vector3(), _fp = new THREE.Vector3(), _fm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _fs = new THREE.Vector3();

	function update(dt, t) {
		fovMat.uniforms.uT.value = t;
		for (const D of drones) {
			const p = D.lod.position;
			D.timer -= dt;
			// выбор поведения
			if (D.state === "patrol" && D.timer <= 0) {
				let best = null, bd = 80;
				for (const r of robots()) { const dd = r.object.position.distanceTo(p); if (dd < bd) { bd = dd; best = r; } }
				if (best) { D.state = "watch"; D.target = best; D.timer = 8 + D.R() * 6; }
				else D.timer = 5;
			} else if (D.state === "watch" && D.timer <= 0) {
				D.state = "patrol"; D.target = null; D.timer = 15 + D.R() * 15;
			}
			// куда лететь
			if (D.state === "watch") {
				const tp = D.target.object.position;
				want.set(tp.x + Math.sin(t * 0.3 + D.phase) * 3, tp.y + 9, tp.z + Math.cos(t * 0.3 + D.phase) * 3);
			} else {
				want.copy(D.route[D.wp]);
				if (want.distanceTo(p) < 6) D.wp = (D.wp + 1) % D.route.length;
			}
			// «впереди» — к цели, а не по скорости: зависнув, дрон иначе решил бы, что путь свободен
			const ax = want.x - p.x, az = want.z - p.z, al = Math.hypot(ax, az) || 1, ux = ax / al, uz = az / al;
			const need = Math.max(clearAt(p.x, p.z), clearAt(p.x + ux * Math.min(al, 14), p.z + uz * Math.min(al, 14)), clearAt(p.x + ux * Math.min(al, 28), p.z + uz * Math.min(al, 28)));
			want.y = Math.max(want.y, need, clearAt(want.x, want.z));
			// впереди крыша выше нас — зависнуть и сначала подняться (вперёд лететь, набирая
			// высоту, не успевает: упирается в стену)
			if (p.y < need - 1) { want.x = p.x; want.z = p.z; }
			// Инерция. Желаемая скорость — к цели, у цели торможение; само «желание»
			// сглажено (смена цели не дёргает). Разгон — пружиной к желаемой скорости с
			// пределом тяги: вбок 2.5 м/с², по вертикали 1.8. Наклон — как у квадрокоптера:
			// тяга наклонена на atan(a / g), и корпус догоняет его с запаздыванием.
			tmp.subVectors(want, p);
			const dist = tmp.length();
			tmp.setLength(Math.min(SPEED, dist * 0.45));
			D.vdes.lerp(tmp, Math.min(1, dt * 0.9));
			const acc = tmp.subVectors(D.vdes, D.vel).multiplyScalar(1.1);
			const ah = Math.hypot(acc.x, acc.z);
			if (ah > 2.5) { acc.x *= 2.5 / ah; acc.z *= 2.5 / ah; }
			acc.y = Math.max(-1.8, Math.min(1.8, acc.y));
			D.vel.addScaledVector(acc, dt);
			p.addScaledVector(D.vel, dt);
			p.y += Math.sin(t * 1.7 + D.phase) * 0.05 * dt;   // лёгкое покачивание
			// курс: по скорости; зависая — носом к цели. Поворот — с разгоном и
			// торможением угловой скорости (до 0.7 рад/с), не доворотом за кадр.
			const hv = Math.hypot(D.vel.x, D.vel.z);
			let aim = D.heading;
			if (D.state === "watch") { const tp = D.target.object.position; aim = Math.atan2(-(tp.x - p.x), -(tp.z - p.z)); }
			else if (hv > 0.5) aim = Math.atan2(-D.vel.x, -D.vel.z);
			let da = aim - D.heading; da = Math.atan2(Math.sin(da), Math.cos(da));
			D.yawRate += (Math.max(-0.7, Math.min(0.7, da * 0.9)) - D.yawRate) * Math.min(1, dt * 1.4);
			D.heading += D.yawRate * dt;
			// крен и тангаж по ускорению (в собственных осях) + крен в вираж
			const ch = Math.cos(D.heading), sh = Math.sin(D.heading);
			const fwdA = -(acc.x * sh + acc.z * ch), sideA = acc.x * ch - acc.z * sh;
			const G = 9.8;
			const tp0 = -Math.atan(fwdA / G) - Math.min(hv, SPEED) * 0.015;               // нос вниз при разгоне и на ходу
			const tr0 = -Math.atan((sideA + D.yawRate * hv) / G);                           // вбок и центростремительное
			D.tilt.x += (tp0 - D.tilt.x) * Math.min(1, dt * 2.5);
			D.tilt.y += (tr0 - D.tilt.y) * Math.min(1, dt * 2.5);
			euler.set(D.tilt.x, D.heading, D.tilt.y);
			D.lod.quaternion.setFromEuler(euler);
			// винты, строб
			for (const P of D.props) P.o.rotation.y += P.dir * PROP_RPS * Math.PI * 2 * dt;
			D.strobeMat.emissiveIntensity = ((t + D.phase) % 1.2) < 0.08 ? 40 : 0;
			// турель — на цель (или вниз-вперёд в патруле)
			D.lod.updateMatrixWorld();
			for (const T of D.turrets) {
				if (D.target) {
					inv.copy(T.o.parent.matrixWorld).invert();
					tmp.copy(D.target.object.position).add(up).applyMatrix4(inv).sub(T.o.position);
					euler.set(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), Math.atan2(-tmp.x, -tmp.z), 0);
				} else euler.set(-0.5 + Math.sin(t * 0.4 + D.phase) * 0.2, Math.sin(t * 0.25 + D.phase) * 0.8, 0);
				q.setFromEuler(euler).premultiply(T.base);
				T.o.quaternion.slerp(q, Math.min(1, dt * 2));   // подвес плавный — из него смотрят
			}
			// пятно обзора: луч подвеса (−Z) до земли
			const i = drones.indexOf(D), T0 = D.turrets[0];
			let shown = false;
			if (T0) {
				T0.o.updateWorldMatrix(true, false);
				T0.o.getWorldPosition(_fp);
				_fd.set(0, 0, -1).transformDirection(T0.o.matrixWorld);
				if (_fd.y < -0.08) {
					const k = -(_fp.y - 0.08) / _fd.y, hx = _fp.x + _fd.x * k, hz = _fp.z + _fd.z * k;
					const dist = k, r = dist * Math.tan(FOV_HALF), stretch = Math.min(3, 1 / Math.max(0.33, -_fd.y));
					_fq.setFromAxisAngle(up, Math.atan2(_fd.x, _fd.z));
					_fm.compose(_fs.set(hx, 0.08, hz), _fq, _fp.set(r, 1, r * stretch));
					fov.setMatrixAt(i, _fm);
					fov.geometry.attributes.aLock.array[i] = D.state === "watch" ? 1 : 0;
					shown = true;
				}
			}
			if (!shown) { _fm.makeScale(0, 0, 0); fov.setMatrixAt(i, _fm); }
			fov.instanceMatrix.needsUpdate = true; fov.geometry.attributes.aLock.needsUpdate = true;
		}
	}
	console.log(`[дроны] разведчиков: ${drones.length}`);
	return { group, update, drones };
}
