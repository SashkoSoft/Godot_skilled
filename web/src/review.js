import * as THREE from "three";

// Режим отзывов (компьютер): ` или кнопка «✎ отзыв».
//  • перед камерой подсвечиваются объекты — рамка и короткая подпись (что это: модель,
//    материал/набор текстур, дом); большие (стены, земля) — кольцом в точке, куда смотрит луч;
//  • клик по объекту — окно комментария; сохранённые копятся в браузере (localStorage);
//  • «Скачать JSON» — файл со всеми отзывами: текст, что за объект (путь узлов, материал,
//    текстуры, модель, экземпляр), где (точка, нормаль, дом/этаж/комната, камера) и снимок.
// Файл кладётся в репозиторий (feedback/) или путь к нему — в чат; разбирается по полям.

const STORE = "kvartal.review";
const SKIP = /^(Sky|GrassBlades|LootMap|Rocks|PitGrass|Wires|Player)$/;
const BIG = 8;   // габарит больше — не рамкой, а кольцом в точке попадания

function load() { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } }
function save(list) { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* без памяти — останутся до перезагрузки */ } }

/** Что за объект под лучом: подпись и подробности. */
function describe(hit) {
	const o = hit.object, path = [];
	for (let p = o; p && path.length < 8; p = p.parent) if (p.name) path.push(p.name);
	const mats = [].concat(o.material || []);
	const mat = mats[hit.face && hit.face.materialIndex !== undefined && mats.length > 1 ? hit.face.materialIndex : 0] || mats[0];
	const texName = t => t ? (t.name || (t.image && (t.image.currentSrc || t.image.src) || "").split("/").pop() || "текстура") : null;
	const tex = mat ? ["map", "normalMap", "roughnessMap", "aoMap"].map(k => mat[k] ? `${k}: ${texName(mat[k])}` : null).filter(Boolean) : [];
	let house = null;
	for (let p = o; p; p = p.parent) if (/^house-|^tunnel-|^Interior-/.test(p.name || "")) { house = p.name; break; }
	const model = o.userData.model || null;
	const matName = mat ? (mat.name || mat.type) : null;
	const title = model ? model.replace(/^clutter:/, "") : (matName && matName !== "MeshStandardMaterial" ? matName.replace(/^zone:/, "") : null) || path[0] || o.type;
	return {
		title, house, path, model, material: matName, textures: tex,
		instance: hit.instanceId ?? hit.batchId ?? null,
		kind: o.isInstancedMesh ? "InstancedMesh" : o.isBatchedMesh ? "BatchedMesh" : o.isSkinnedMesh ? "SkinnedMesh" : o.isPoints ? "Points" : o.type,
		triangles: o.geometry && o.geometry.index ? o.geometry.index.count / 3 : o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : null,
	};
}

/** Габарит объекта (или его экземпляра) в мире. */
const _m = new THREE.Matrix4();
function boxOf(hit) {
	const o = hit.object, g = o.geometry;
	if (!g) return null;
	if (!g.boundingBox) g.computeBoundingBox();
	const b = g.boundingBox.clone();
	if (o.isInstancedMesh && hit.instanceId !== undefined) { o.getMatrixAt(hit.instanceId, _m); b.applyMatrix4(_m); }
	else if (o.isBatchedMesh) return null;
	return b.applyMatrix4(o.matrixWorld);
}

export function createReview({ scene, camera, canvas, renderer, where = () => "", context = () => ({}), say = () => {} }) {
	let on = false, hover = null, pickT = 0, list = load();
	const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), mouse = new THREE.Vector2(0, 0);
	ray.far = 40;
	// подсветка: рамки (пул) и кольцо для больших
	const group = new THREE.Group(); group.name = "Review"; group.visible = false; scene.add(group);
	const lineMat = c => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 });
	const boxes = Array.from({ length: 24 }, () => { const h = new THREE.Box3Helper(new THREE.Box3(), 0x49d6ff); h.material = lineMat(0x49d6ff); h.renderOrder = 30; h.visible = false; group.add(h); return h; });
	const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 32), new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false, side: THREE.DoubleSide, transparent: true }));
	ring.renderOrder = 31; ring.visible = false; group.add(ring);
	// подписи — HTML над объектами
	const tagBox = document.createElement("div");
	tagBox.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20";
	tagBox.hidden = true; document.body.appendChild(tagBox);
	const tags = boxes.map(() => { const d = document.createElement("div"); d.style.cssText = "position:absolute;transform:translate(-50%,-100%);padding:2px 6px;border-radius:4px;background:rgba(8,20,28,.8);color:#bfefff;font:12px/1.3 system-ui,sans-serif;white-space:nowrap"; d.hidden = true; tagBox.appendChild(d); return d; });
	// панель режима и окно комментария
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:21;padding:10px 12px;border-radius:8px;background:rgba(10,12,14,.85);color:#e8e2d6;font:13px/1.5 system-ui,sans-serif;max-width:320px";
	panel.hidden = true; document.body.appendChild(panel);
	const dlg = document.createElement("div");
	dlg.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:22;width:min(480px,92vw);padding:14px;border-radius:10px;background:#15181c;color:#e8e2d6;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.6)";
	dlg.hidden = true; document.body.appendChild(dlg);
	const btn = "padding:5px 12px;margin:6px 6px 0 0;border-radius:6px;border:1px solid #3a4048;background:#23282e;color:#e8e2d6;font:inherit;cursor:pointer";

	function drawPanel() {
		panel.innerHTML = `<b>✎ Отзывы</b> · наведите и кликните по объекту<br>сохранено: ${list.length}<br>` +
			`<button data-a="dl" style="${btn}">Скачать JSON</button><button data-a="clr" style="${btn}">Очистить</button><button data-a="off" style="${btn}">Выйти</button>`;
	}
	panel.addEventListener("click", e => {
		const a = e.target.dataset && e.target.dataset.a;
		if (a === "dl") download();
		if (a === "clr") { if (panel.dataset.confirm) { list = []; save(list); delete panel.dataset.confirm; drawPanel(); say("отзывы очищены"); } else { panel.dataset.confirm = 1; e.target.textContent = "Точно очистить?"; } }
		if (a === "off") toggle(false);
	});

	function download() {
		const data = { made: new Date().toISOString(), page: location.href, count: list.length, comments: list };
		const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
		const a = Object.assign(document.createElement("a"), { href: url, download: `kvartal-review-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json` });
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		say(`скачано отзывов: ${list.length}`);
	}

	/** Снимок кадра с отметкой места: рендер тут же — буфер ещё не очищен. */
	function snapshot(px, py) {
		renderer.render(scene, camera);
		const src = renderer.domElement, w = 640, h = Math.round(640 * src.height / src.width);
		const c = document.createElement("canvas"); c.width = w; c.height = h;
		const g = c.getContext("2d"); g.drawImage(src, 0, 0, w, h);
		const x = px * w / canvas.clientWidth, y = py * h / canvas.clientHeight;
		g.strokeStyle = "#ffd24a"; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
		return c.toDataURL("image/jpeg", 0.72);
	}

	function openDialog(hit, px, py) {
		const info = describe(hit), p = hit.point, n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
		const shot = snapshot(px, py);
		const dir = camera.getWorldDirection(new THREE.Vector3());
		const rec = {
			id: Date.now().toString(36), time: new Date().toISOString(),
			object: info, where: where(p), point: p.toArray().map(v => +v.toFixed(3)), normal: n ? n.toArray().map(v => +v.toFixed(3)) : null,
			distance: +hit.distance.toFixed(2),
			camera: { pos: camera.position.toArray().map(v => +v.toFixed(2)), dir: dir.toArray().map(v => +v.toFixed(3)) },
			context: context(), screenshot: shot, text: "",
		};
		dlg.innerHTML = `<b>${info.title}</b><div style="color:#9aa4ad;font-size:12px;margin:4px 0 8px">${[info.house, rec.where, info.material, ...info.textures.slice(0, 2)].filter(Boolean).join(" · ")}</div>` +
			`<img src="${shot}" style="width:100%;border-radius:6px;margin-bottom:8px">` +
			`<textarea rows="4" style="width:100%;box-sizing:border-box;border-radius:6px;background:#0e1013;color:#e8e2d6;border:1px solid #3a4048;padding:8px;font:inherit" placeholder="Что не так / что поправить"></textarea>` +
			`<button data-a="ok" style="${btn}">Сохранить</button><button data-a="cancel" style="${btn}">Отмена</button>`;
		dlg.hidden = false;
		const ta = dlg.querySelector("textarea"); ta.focus();
		dlg.onclick = e => {
			const a = e.target.dataset && e.target.dataset.a;
			if (a === "ok") { rec.text = ta.value.trim(); list.push(rec); save(list); dlg.hidden = true; drawPanel(); say(`отзыв сохранён (${list.length}) — «Скачать JSON» в панели справа внизу`); }
			if (a === "cancel") dlg.hidden = true;
		};
	}

	function targets() { return scene.children.filter(o => o.visible && !SKIP.test(o.name) && o !== group); }
	function cast(x, y) {
		ndc.set(x, y); ray.setFromCamera(ndc, camera);
		const hits = ray.intersectObjects(targets(), true);
		// видимое по всей цепочке: скрытые ступени LOD, коробки блок-аута под домами — не в счёт
		const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
		return hits.find(h => shown(h.object) && !h.object.isSprite && !h.object.isLine && !SKIP.test(h.object.name)) || null;
	}

	// клик без перетаскивания — отзыв
	let down = null;
	canvas.addEventListener("pointerdown", e => { if (on && e.button === 0) down = [e.clientX, e.clientY]; });
	canvas.addEventListener("pointerup", e => {
		if (!on || !down || !dlg.hidden) return;
		const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
		if (moved > 5) return;
		const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1;
		const hit = cast(x, y);
		if (hit) openDialog(hit, e.clientX - r.left, e.clientY - r.top); else say("под курсором ничего нет");
	});
	canvas.addEventListener("pointermove", e => { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); });

	function toggle(v = !on) {
		on = v; group.visible = on; tagBox.hidden = !on; panel.hidden = !on; if (!on) dlg.hidden = true;
		if (on) { drawPanel(); say("режим отзывов: наведите на объект и кликните · ` — выйти"); }
	}

	const tmpV = new THREE.Vector3();
	/** Раз в 0.3 с: сетка лучей перед камерой + луч под курсором → рамки и подписи. */
	function update(dt) {
		if (!on) return;
		if ((pickT -= dt) < 0) {
			pickT = 0.3;
			const found = new Map();
			const add = (hit, key) => { if (hit && !found.has(key)) found.set(key, hit); };
			hover = cast(mouse.x, mouse.y);
			if (hover) add(hover, hover.object.uuid + ":" + (hover.instanceId ?? ""));
			for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) {
				const h = cast(-0.8 + i * 0.4, -0.6 + j * 0.4);
				if (h) add(h, h.object.uuid + ":" + (h.instanceId ?? ""));
			}
			let k = 0;
			ring.visible = false;
			for (const [key, h] of found) {
				if (k >= boxes.length) break;
				const b = boxOf(h), isHover = h === hover;
				const big = !b || b.getSize(tmpV).length() > BIG;
				const B = boxes[k], T = tags[k];
				if (big) {
					B.visible = false;
					if (isHover) { ring.visible = true; ring.position.copy(h.point); if (h.face) ring.lookAt(tmpV.copy(h.face.normal).transformDirection(h.object.matrixWorld).add(h.point)); }
				} else { B.box.copy(b); B.visible = true; B.material.color.set(isHover ? 0xffd24a : 0x49d6ff); }
				T.hidden = false; T.textContent = describe(h).title; T.style.color = isHover ? "#ffd24a" : "#bfefff";
				T.userData = big ? h.point.clone() : b.getCenter(new THREE.Vector3()).setY(b.max.y);
				k++;
			}
			for (; k < boxes.length; k++) { boxes[k].visible = false; tags[k].hidden = true; }
		}
		// подписи — к экрану каждый кадр
		const w = canvas.clientWidth, h = canvas.clientHeight;
		tags.forEach(T => {
			if (T.hidden || !T.userData || !T.userData.isVector3) return;
			tmpV.copy(T.userData).project(camera);
			const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
			T.style.display = vis ? "" : "none";
			T.style.left = `${(tmpV.x + 1) / 2 * w}px`; T.style.top = `${(1 - tmpV.y) / 2 * h}px`;
		});
	}
	return { toggle, update, get on() { return on; }, get typing() { return !dlg.hidden; } };
}
