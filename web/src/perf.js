import * as THREE from "three";
import { setWindEnabled } from "./wind.js";

// Учёт цены кадра. Два источника, и важно не путать, что каждый значит:
//  - renderer.info — что реально ушло в GPU за кадр (вызовы и треугольники,
//    ВКЛЮЧАЯ проход теней). Честно по содержанию, ничего не говорит о времени.
//  - разбивка по слоям — оценка обходом сцены: сколько вызовов и треугольников
//    даёт каждый слой и сколько из этого повторяет проход теней. По ней видно,
//    КТО дорогой; сколько это в миллисекундах — только замером на устройстве
//    (A/B через #off=…, секундомер — см. скил measurement-sanity).

// Слои, которые считаем отдельно; объект относится к ближайшему такому предку.
const LAYERS = ["Trees", "Undergrowth", "UndergrowthBoxes", "GrassBlades", "Houses", "Robots",
	"Trash", "Gameplay", "District", "Street", "Ground", "Curbs", "Poles", "Slabs", "Rocks", "Fences", "Playground"];

function layerOf(o) {
	for (let p = o; p; p = p.parent) if (LAYERS.includes(p.name)) return p.name;
	return "прочее";
}

function tris(mesh) {
	const g = mesh.geometry;
	const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
	const inst = mesh.isInstancedMesh ? mesh.count : 1;
	return (n / 3) * inst;
}

/** Разбивка по слоям: вызовы, треугольники, из них в тени. Только видимое. */
export function breakdown(scene) {
	const rows = {};
	scene.traverseVisible(o => {
		if (!o.isMesh || (o.isInstancedMesh && o.count === 0)) return;
		// у LOD виден только текущий уровень — traverseVisible его и обходит
		const L = layerOf(o);
		const r = rows[L] || (rows[L] = { слой: L, вызовов: 0, треуг: 0, "в тени вызовов": 0, "в тени треуг": 0 });
		const mats = Array.isArray(o.material) ? o.material.length : 1;
		const t = tris(o);
		r.вызовов += mats;
		r.треуг += t;
		if (o.castShadow) { r["в тени вызовов"] += mats; r["в тени треуг"] += t; }
	});
	return Object.values(rows).sort((a, b) => b.треуг - a.треуг)
		.map(r => ({ ...r, треуг: Math.round(r.треуг), "в тени треуг": Math.round(r["в тени треуг"]) }));
}

/** Короткая строка для HUD из renderer.info. */
export function infoLine(renderer) {
	const i = renderer.info;
	const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);
	return `вызовов ${i.render.calls} · треуг ${k(i.render.triangles)} · текстур ${i.memory.textures} · геом ${i.memory.geometries} · программ ${i.programs ? i.programs.length : "?"}`;
}

/**
 * #off=grass,bushes,trees,houses,robots,trash,shadows — выключить слои для
 * замера «с фичей / без фичи». Возвращает, что выключено.
 */
export function applyOff(scene, renderer, list) {
	const off = new Set(list.split(",").map(s => s.trim()).filter(Boolean));
	const NAMES = {
		grass: ["GrassBlades"], bushes: ["Undergrowth", "UndergrowthBoxes"], trees: ["Trees"],
		houses: ["Houses"], robots: ["Robots"], trash: ["Trash"], blockout: ["District"],
		curbs: ["Curbs"], poles: ["Poles"], slabs: ["Slabs"], rocks: ["Rocks"], fences: ["Fences"], playground: ["Playground"],
	};
	for (const [k, names] of Object.entries(NAMES)) {
		if (!off.has(k)) continue;
		scene.traverse(o => { if (names.includes(o.name)) o.visible = false; });
	}
	if (off.has("shadows")) { renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
	return [...off];
}

/* ── замер «со слоем / без» ──────────────────────────────────────────── */

// Слои замера: имя в таблице → имена групп в сцене (особый — тени).
export const BENCH = {
	"трава": ["GrassBlades"], "кусты": ["Undergrowth", "UndergrowthBoxes"], "деревья": ["Trees"],
	"роботы": ["Robots"], "дома": ["Houses"], "мусор": ["Trash"], "бордюр": ["Curbs"],
	"опоры": ["Poles"], "плиты": ["Slabs"], "камешки": ["Rocks"], "заборы": ["Fences"],
	"площадка": ["Playground"], "мелочи": ["StreetProps"], "плиты-трава": ["JointGrass"], "тени": null,
	"пол": null,   // шейдер пола (floor.js): на время замера — простой материал того же цвета
	// карта теней не перерисовывается (читается прежняя) — цена прохода в тень
	"перерисовка теней": null,
	"ветер": null,   // смещение вершин растений не считается (в кадре и в тени)
};
// «тень X» (только в #benchonly) — слой X не отбрасывает тень: его доля в проходе теней.
// Слои, которые прятать целиком бессмысленно (блок-аут — это и земля), — только для тени.
const SHADOW_ONLY = { "блок-аут": ["District"], "дроны": ["Drones"] };

/**
 * Цена кадра, медиана по frames кадрам. Если есть таймер GPU
 * (EXT_disjoint_timer_query_webgl2) — время самой видеокарты: без CPU-части
 * three.js, которая шумит на миллисекунды и прячет цену шейдеров. Иначе —
 * render + gl.finish (ждём GPU, иначе меряется только отправка команд).
 */
// cpu — время самого вызова render на процессоре (обход сцены, вызовы WebGL,
// кости): таймер GPU его не видит, а при сотнях вызовов оно и есть узкое место.
// Медиана — в lastCpu после каждого frameMs.
let timerExt, lastCpu = 0;
const cpu = [];
async function frameMs(renderer, scene, camera, frames) {
	const gl = renderer.getContext();
	if (timerExt === undefined) timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
	renderer.render(scene, camera); gl.finish();   // прогрев: программы, загрузка буферов
	const t = [];
	cpu.length = 0;
	if (timerExt) {
		const qs = [];
		for (let i = 0; i < frames; i++) {
			const q = gl.createQuery();
			gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
			const c0 = performance.now();
			renderer.render(scene, camera);
			cpu.push(performance.now() - c0);
			gl.endQuery(timerExt.TIME_ELAPSED_EXT);
			qs.push(q);
		}
		gl.finish();
		// результаты приходят не сразу (ANGLE отдаёт их к следующим кадрам): ждём последний
		const last = qs[qs.length - 1];
		for (let k = 0; k < 60 && !gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => requestAnimationFrame(r));
		const ok = gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timerExt.GPU_DISJOINT_EXT);
		for (const q of qs) {
			if (ok && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) t.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
			gl.deleteQuery(q);
		}
		if (!ok) { console.warn("[замер] таймер GPU не отвечает — меряю render + finish"); timerExt = null; }
	}
	if (!t.length) for (let i = 0; i < frames; i++) {
		const t0 = performance.now();
		renderer.render(scene, camera);
		gl.finish();
		t.push(performance.now() - t0);
	}
	t.sort((a, b) => a - b);
	cpu.sort((a, b) => a - b);
	lastCpu = cpu.length ? cpu[cpu.length >> 1] : 0;
	return t[t.length >> 1];
}

// Разница «со слоем / без»: попеременно rounds раз (частоты GPU и фон плавают —
// два замера подряд в разное время дают разброс больше самого эффекта), медианы.
async function abMs(renderer, scene, camera, frames, off, on, rounds = 5) {
	const a = [], b = [], ca = [], cb = [];
	for (let i = 0; i < rounds; i++) {
		a.push(await frameMs(renderer, scene, camera, frames)); ca.push(lastCpu);
		off(); b.push(await frameMs(renderer, scene, camera, frames)); cb.push(lastCpu); on();
	}
	const med = v => v.sort((x, y) => x - y)[v.length >> 1];
	return [med(a), med(b), med(ca), med(cb)];
}

/**
 * Замер: весь кадр, затем без каждого слоя по очереди. Возвращает строки
 * { слой, мс_без, экономия_мс }. Видимость и тени возвращаются как были.
 */
// only — имена строк через запятую (#benchonly=…): замер только их
export async function runBench(scene, renderer, camera, { frames = 30, onStep, only = null } = {}) {
	const groups = name => { const L = BENCH[name] || SHADOW_ONLY[name], out = []; scene.traverse(o => { if (L && L.includes(o.name)) out.push(o); }); return out; };
	const pause = () => new Promise(r => setTimeout(r, 30));
	// Прогрев: видеокарта в простое сбрасывает частоту (у RTX — до 210 МГц) и
	// разгоняется секунды; без прогрева первые замеры втрое дольше последних.
	const gl = renderer.getContext();
	for (const t0 = performance.now(); performance.now() - t0 < 3000;) { renderer.render(scene, camera); gl.finish(); }
	const all = await frameMs(renderer, scene, camera, frames);
	const rows = [{ слой: "всё", мс: all.toFixed(2), экономия: "", "cpu мс": lastCpu.toFixed(2), таймер: timerExt ? "GPU" : "CPU+finish",
		вызовов: renderer.info.render.calls, программ: renderer.info.programs.length, текстур: renderer.info.memory.textures, геометрий: renderer.info.memory.geometries,
		// видимых мешей — столько объектов three.js обходит и готовит (программа, униформы)
		// в каждом проходе, даже если рисовать им нечего (count = 0)
		мешей: (() => { let n = 0; scene.traverseVisible(o => { if (o.isMesh) n++; }); return n; })() }];
	const shadowOf = n => /^тень /.test(n) && (BENCH[n.slice(5)] || SHADOW_ONLY[n.slice(5)]) ? n.slice(5) : null;
	const names = only ? only.split(",").map(s => s.trim()).filter(n => n in BENCH || shadowOf(n)) : Object.keys(BENCH);
	for (const name of names) {
		if (onStep) onStep(name);
		await pause();
		let off, on;
		if (name === "тени") {
			const was = renderer.shadowMap.enabled;
			const touch = () => scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
			off = () => { renderer.shadowMap.enabled = false; touch(); };
			on = () => { renderer.shadowMap.enabled = was; touch(); };
		} else if (name === "ветер") {
			off = () => setWindEnabled(false);
			on = () => setWindEnabled(true);
		} else if (name === "перерисовка теней") {
			off = () => { renderer.shadowMap.autoUpdate = false; };
			on = () => { renderer.shadowMap.autoUpdate = true; };
		} else if (shadowOf(name)) {
			const ms = []; for (const g of groups(shadowOf(name))) g.traverse(o => { if (o.isMesh && o.castShadow) ms.push(o); });
			if (!ms.length) continue;
			off = () => ms.forEach(o => { o.castShadow = false; });
			on = () => ms.forEach(o => { o.castShadow = true; });
		} else if (name === "пол") {
			// материалы пола опознаются по ключу программы (groundify / hardify)
			const swap = [];
			scene.traverse(o => {
				if (!o.isMesh) return;
				const m = o.material, key = m && m.customProgramCacheKey ? m.customProgramCacheKey() : "";
				if (/^ground-/.test(key)) swap.push([o, m, new THREE.MeshStandardMaterial({ color: m.color, roughness: 1 })]);
			});
			if (!swap.length) continue;
			off = () => swap.forEach(([o, , p]) => { o.material = p; });
			on = () => swap.forEach(([o, m]) => { o.material = m; });
		} else {
			const gs = groups(name).filter(o => o.visible);
			if (!gs.length) continue;   // слоя нет или он выключен кнопкой
			off = () => gs.forEach(o => { o.visible = false; });
			on = () => gs.forEach(o => { o.visible = true; });
		}
		const [a, b, ca, cb] = await abMs(renderer, scene, camera, frames, off, on);
		rows.push({ слой: "без: " + name, мс: b.toFixed(2), экономия: (a - b).toFixed(2), "cpu экономия": (ca - cb).toFixed(2) });
	}
	return rows;
}