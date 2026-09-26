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
};

/**
 * Цена кадра: frames раз render + gl.finish (ждём GPU, иначе меряется только
 * отправка команд, а vsync прячет всё, что быстрее 16.7 мс). Медиана — устойчива
 * к редким сборкам мусора.
 */
function frameMs(renderer, scene, camera, frames) {
	const gl = renderer.getContext(), t = [];
	renderer.render(scene, camera); gl.finish();   // прогрев: программы, загрузка буферов
	for (let i = 0; i < frames; i++) {
		const t0 = performance.now();
		renderer.render(scene, camera);
		gl.finish();
		t.push(performance.now() - t0);
	}
	t.sort((a, b) => a - b);
	return t[t.length >> 1];
}

/**
 * Замер: весь кадр, затем без каждого слоя по очереди. Возвращает строки
 * { слой, мс_без, экономия_мс }. Видимость и тени возвращаются как были.
 */
export async function runBench(scene, renderer, camera, { frames = 30, onStep } = {}) {
	const groups = name => { const out = []; scene.traverse(o => { if (BENCH[name] && BENCH[name].includes(o.name)) out.push(o); }); return out; };
	const pause = () => new Promise(r => setTimeout(r, 30));
	const all = frameMs(renderer, scene, camera, frames);
	const rows = [{ слой: "всё", мс: all.toFixed(2), экономия: "" }];
	for (const name of Object.keys(BENCH)) {
		if (onStep) onStep(name);
		await pause();
		let ms;
		if (name === "тени") {
			const was = renderer.shadowMap.enabled;
			renderer.shadowMap.enabled = false;
			scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
			ms = frameMs(renderer, scene, camera, frames);
			renderer.shadowMap.enabled = was;
			scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
		} else {
			const gs = groups(name).filter(o => o.visible);
			if (!gs.length) continue;   // слоя нет или он выключен кнопкой
			gs.forEach(o => { o.visible = false; });
			ms = frameMs(renderer, scene, camera, frames);
			gs.forEach(o => { o.visible = true; });
		}
		rows.push({ слой: "без: " + name, мс: ms.toFixed(2), экономия: (all - ms).toFixed(2) });
	}
	return rows;
}