import * as THREE from "three";

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
};

/**
 * Цена кадра, медиана по frames кадрам. Если есть таймер GPU
 * (EXT_disjoint_timer_query_webgl2) — время самой видеокарты: без CPU-части
 * three.js, которая шумит на миллисекунды и прячет цену шейдеров. Иначе —
 * render + gl.finish (ждём GPU, иначе меряется только отправка команд).
 */
let timerExt;
async function frameMs(renderer, scene, camera, frames) {
	const gl = renderer.getContext();
	if (timerExt === undefined) timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
	renderer.render(scene, camera); gl.finish();   // прогрев: программы, загрузка буферов
	const t = [];
	if (timerExt) {
		const qs = [];
		for (let i = 0; i < frames; i++) {
			const q = gl.createQuery();
			gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
			renderer.render(scene, camera);
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
	return t[t.length >> 1];
}

// Разница «со слоем / без»: попеременно rounds раз (частоты GPU и фон плавают —
// два замера подряд в разное время дают разброс больше самого эффекта), медианы.
async function abMs(renderer, scene, camera, frames, off, on, rounds = 5) {
	const a = [], b = [];
	for (let i = 0; i < rounds; i++) {
		a.push(await frameMs(renderer, scene, camera, frames));
		off(); b.push(await frameMs(renderer, scene, camera, frames)); on();
	}
	const med = v => v.sort((x, y) => x - y)[v.length >> 1];
	return [med(a), med(b)];
}

/**
 * Замер: весь кадр, затем без каждого слоя по очереди. Возвращает строки
 * { слой, мс_без, экономия_мс }. Видимость и тени возвращаются как были.
 */
export async function runBench(scene, renderer, camera, { frames = 30, onStep } = {}) {
	const groups = name => { const out = []; scene.traverse(o => { if (BENCH[name] && BENCH[name].includes(o.name)) out.push(o); }); return out; };
	const pause = () => new Promise(r => setTimeout(r, 30));
	// Прогрев: видеокарта в простое сбрасывает частоту (у RTX — до 210 МГц) и
	// разгоняется секунды; без прогрева первые замеры втрое дольше последних.
	const gl = renderer.getContext();
	for (const t0 = performance.now(); performance.now() - t0 < 3000;) { renderer.render(scene, camera); gl.finish(); }
	const all = await frameMs(renderer, scene, camera, frames);
	const rows = [{ слой: "всё", мс: all.toFixed(2), экономия: "", таймер: timerExt ? "GPU" : "CPU+finish" }];
	for (const name of Object.keys(BENCH)) {
		if (onStep) onStep(name);
		await pause();
		let off, on;
		if (name === "тени") {
			const was = renderer.shadowMap.enabled;
			const touch = () => scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
			off = () => { renderer.shadowMap.enabled = false; touch(); };
			on = () => { renderer.shadowMap.enabled = was; touch(); };
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
		const [a, b] = await abMs(renderer, scene, camera, frames, off, on);
		rows.push({ слой: "без: " + name, мс: b.toFixed(2), экономия: (a - b).toFixed(2) });
	}
	return rows;
}