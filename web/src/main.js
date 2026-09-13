import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildStreet, LAYOUT } from "./street.js";
import { setSurfaceUniform } from "./surface.js";

const hud = {
	fps: document.getElementById("fps"),
	res: document.getElementById("res"),
	status: document.getElementById("status"),
	pos: document.getElementById("pos"),
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
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// Ошибка компиляции шейдера в three.js по умолчанию уходит только в консоль,
// а на экране остаётся чёрный материал без объяснений. Ловим и показываем.
renderer.debug.onShaderError = (gl, prog, vs, fs) => {
	for (const sh of [vs, fs]) {
		const log = gl.getShaderInfoLog(sh) || "";
		if (!log.trim()) continue;
		const first = log.split("\n").find((l) => l.includes("ERROR")) || log;
		say("шейдер: " + first.trim(), true);
		console.error(log);
	}
};

const scene = new THREE.Scene();

// Туман закрывает горизонт: концы полос в него уходят, и где покрытие
// кончается — не видно ни с какого ракурса.
const FOG = new THREE.Color(0x9fa3a2);
scene.fog = new THREE.Fog(FOG, 55, 150);
scene.background = FOG;

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);

/* ── свет ───────────────────────────────────────────────────────────── */
// Солнце низкое и сбоку: скользящий свет — единственное, на чём вообще
// читается микрорельеф покрытия. В зенит его ставить нельзя, иначе вся
// работа с нормалями пропадает.
const sun = new THREE.DirectionalLight(0xfff3e6, 3.4);
const SUN_AZ = 52, SUN_EL = 32;
{
	const az = SUN_AZ * Math.PI / 180, el = SUN_EL * Math.PI / 180;
	sun.position.set(
		Math.cos(el) * Math.cos(az) * 60,
		Math.sin(el) * 60,
		Math.cos(el) * Math.sin(az) * 60,
	);
}
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

const sky = new THREE.HemisphereLight(0x9fb4c6, 0x4a4436, 1.6);
scene.add(sky);

/* ── улица ──────────────────────────────────────────────────────────── */
let street = null;
const glsl = await (await fetch("./src/shaders/surface.glsl")).text();
street = buildStreet(glsl);
scene.add(street);
say("улица собрана");

/* ── один принятый ассет: доказательство всей цепочки ────────────────
   Перила лестничного марша (task-0007, принято 28 августа) — сдача,
   которая до сих пор не стояла нигде. Если она грузится и освещается тем же
   светом, что процедурный тротуар, — значит библиотека из 41 модели и 27
   наборов текстур переезжает в веб как есть, без конвертации. */
const ASSET = "../game/assets/models/stairs/railing_flight.glb";
new GLTFLoader().load(
	ASSET,
	(gltf) => {
		const railing = gltf.scene;
		railing.traverse((n) => {
			if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
		});
		// вдоль тротуара, лицом к проезду
		const L = LAYOUT;
		const z = L.roadHalf + L.kerbW + L.walkW - 0.25;
		for (let i = 0; i < 6; i++) {
			const c = railing.clone(true);
			c.position.set(-9 + i * 3.0, L.yWalk, z);
			scene.add(c);
		}
		const box = new THREE.Box3().setFromObject(railing);
		const s = box.getSize(new THREE.Vector3());
		say(`ассет загружен: railing_flight.glb — ${s.x.toFixed(2)} × ` +
			`${s.y.toFixed(2)} × ${s.z.toFixed(2)} м`);
	},
	undefined,
	() => say(`не открылся ${ASSET} — сервер отдаёт корень репозитория?`, true),
);

/* ── камера: те же ракурсы, что были в игре ─────────────────────────── */
const VIEWS = {
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
		cam.p.x + Math.cos(SUN_EL * Math.PI / 180) * Math.cos(SUN_AZ * Math.PI / 180) * 60,
		Math.sin(SUN_EL * Math.PI / 180) * 60,
		cam.p.z + Math.cos(SUN_EL * Math.PI / 180) * Math.sin(SUN_AZ * Math.PI / 180) * 60,
	);
}

const keys = new Set();
addEventListener("keydown", (e) => {
	if (VIEWS[e.code]) { applyView(VIEWS[e.code]); say("ракурс: " + VIEWS[e.code].name); return; }
	if (e.code === "KeyN") {
		debugMode = (debugMode + 1) % 3;
		setSurfaceUniform(street, "debugMode", debugMode);
		say(["покрытие", "нормаль цветом", "поле высот"][debugMode]);
		return;
	}
	if (e.code === "KeyB") {
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

let dragging = false;
canvas.addEventListener("pointerdown", (e) => {
	dragging = true;
	canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
	dragging = false;
	canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
	if (!dragging) return;
	cam.yaw -= e.movementX * 0.16;
	cam.pitch = Math.max(-89, Math.min(60, cam.pitch - e.movementY * 0.16));
});
canvas.addEventListener("wheel", (e) => {
	e.preventDefault();
	cam.speed = Math.max(0.5, Math.min(60, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
}, { passive: false });

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
	if (acc > 0.5) { hud.fps.textContent = Math.round(frames / acc); acc = 0; frames = 0; }

	resize();

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
		const sp = cam.speed * (keys.has("ShiftLeft") ? 3.5 : 1) * dt;
		cam.p.addScaledVector(move.normalize(), sp);
	}

	updateCamera();
	hud.pos.textContent =
		`${cam.p.x.toFixed(1)} ${cam.p.y.toFixed(1)} ${cam.p.z.toFixed(1)}`;
	renderer.render(scene, camera);
	requestAnimationFrame(tick);
}

/* Начальное состояние из хеша — так скриншот-харнесс задаёт ракурс и режим
   отладки, не эмулируя нажатия клавиш, которых в headless нет.
   Пример: #view=3&debug=1&bump=0 */
const q = new URLSearchParams(location.hash.slice(1));
applyView(VIEWS["Digit" + (q.get("view") || "1")] || VIEWS.Digit1);
if (q.has("debug")) {
	debugMode = parseInt(q.get("debug"), 10) || 0;
	setSurfaceUniform(street, "debugMode", debugMode);
}
if (q.get("bump") === "0") {
	bumpOn = false;
	setSurfaceUniform(street, "bump", 0);
}

requestAnimationFrame(tick);
