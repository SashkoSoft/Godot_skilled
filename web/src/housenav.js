// Граф путей по дому hou (<id>.json) для роботов — продолжение уличного графа
// (robot.js buildWalkGraph: узлы { p: [x, z], nb: [...] }; здесь добавляется y).
//
// Узлы:
//  • дверь — точка в проёме (pos из doors) и по точке в 0.8 м по обе стороны проёма
//    внутри комнат («заглянуть» — дойти до неё);
//  • внутри комнаты точки её дверей связаны между собой (комнаты — прямоугольники,
//    отрезок между точками у дверей в стену не утыкается);
//  • площадки: этажные (комнаты type ploshchadka), промежуточные, тамбур, крыльцо
//    (landings_mid) — узел в центре; соседние площадки одного этажа — связаны;
//  • марш (flights: a — низ, b — верх) — два узла, ребро между ними; концы — к ближней
//    площадке на своей высоте. Крыльцо (kind porch) низом — к ближнему узлу улицы.
// passable === false (руина) — марш не связывается. Лифт в граф не входит.

const INNER = 0.8;

function rectOf(rm) {
	const xs = rm.polygon_xz.map(p => p[0]), zs = rm.polygon_xz.map(p => p[1]);
	return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/**
 * Добавить дом в граф. nodes — массив узлов улицы (изменяется: дописываются узлы дома).
 * roomOk(room) — фильтр (руина: только уцелевшие); по умолчанию все.
 */
export function addHouseToGraph(nodes, info, { roomOk = () => true } = {}) {
	const first = nodes.length;
	const add = (x, y, z, r = 0.35) => { nodes.push({ p: [x, z], y, nb: [], r, house: true }); return nodes.length - 1; };
	const link = (i, j) => { if (i !== j && i >= 0 && j >= 0 && !nodes[i].nb.includes(j)) { nodes[i].nb.push(j); nodes[j].nb.push(i); } };
	const byId = Object.fromEntries(info.rooms.map(r => [r.id, r]));
	const roomPts = {};   // комната → её узлы (у дверей)
	// пол площадки — только ploshchadka: у lestnica y — отметка этажа, а в её прямоугольнике
	// марши и тамбур (центр «висел» бы над ступенями)
	const LAND = /^ploshchadka$/, SKIP = /^(lestnica|lift)$/;
	// проход между комнатами a и b в точке p (дверь или открытый)
	function passage(a, b, [px, py, pz]) {
		const mid = add(px, py, pz, 0.3);
		for (const rm of [a, b]) {
			const [x0, z0, x1, z1] = rectOf(rm), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
			// внутрь комнаты — поперёк стены, где дверь
			const alongX = Math.abs(pz - z0) < 0.15 || Math.abs(pz - z1) < 0.15;
			let ix = px, iz = pz;
			if (alongX) iz = pz + Math.sign(cz - pz) * Math.min(INNER, (z1 - z0) / 2);
			else ix = px + Math.sign(cx - px) * Math.min(INNER, (x1 - x0) / 2);
			const inner = add(ix, rm.y, iz, 0.4);
			link(mid, inner);
			(roomPts[rm.id] ||= []).push(inner);
		}
	}
	for (const d of info.doors) {
		const [a, b] = d.rooms.map(id => byId[id]);
		if (!a || !b || !roomOk(a) || !roomOk(b) || SKIP.test(a.type) || SKIP.test(b.type)) continue;
		passage(a, b, d.pos);
	}
	// Прихожая квартиры нарезана на несколько прямоугольников (коридор буквой Г/Т) — между
	// ними дверей нет, проход открытый: середина общего отрезка стены.
	const doorPair = new Set(info.doors.map(d => [...d.rooms].sort().join("|")));
	const halls = info.rooms.filter(r => r.type === "prihozhaya" && r.apartment && roomOk(r));
	for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) {
		const a = halls[i], b = halls[j];
		if (a.apartment !== b.apartment || doorPair.has([a.id, b.id].sort().join("|"))) continue;
		const A = rectOf(a), B = rectOf(b), e = 0.02;
		let p = null;
		if (Math.abs(A[2] - B[0]) < e || Math.abs(B[2] - A[0]) < e) {   // общая стена по x
			const x = Math.abs(A[2] - B[0]) < e ? A[2] : A[0], z0 = Math.max(A[1], B[1]), z1 = Math.min(A[3], B[3]);
			if (z1 - z0 > 0.7) p = [x, a.y, (z0 + z1) / 2];
		} else if (Math.abs(A[3] - B[1]) < e || Math.abs(B[3] - A[1]) < e) {   // общая стена по z
			const z = Math.abs(A[3] - B[1]) < e ? A[3] : A[1], x0 = Math.max(A[0], B[0]), x1 = Math.min(A[2], B[2]);
			if (x1 - x0 > 0.7) p = [(x0 + x1) / 2, a.y, z];
		}
		if (p) passage(a, b, p);
	}
	// внутри комнаты — точки у дверей между собой
	for (const pts of Object.values(roomPts)) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) link(pts[i], pts[j]);
	// площадки: этажные — центр комнаты (+ её точки у дверей), промежуточные/тамбур/крыльцо — центр
	const landings = [];
	for (const rm of info.rooms) {
		if (!LAND.test(rm.type) || !roomOk(rm)) continue;
		const [x0, z0, x1, z1] = rectOf(rm), n = add((x0 + x1) / 2, rm.y, (z0 + z1) / 2, 0.4);
		for (const p of roomPts[rm.id] || []) link(n, p);
		landings.push({ n, rect: [x0, z0, x1, z1], y: rm.y });
	}
	for (const L of info.landings_mid || []) {
		const [x0, z0, x1, z1] = rectOf(L), n = add((x0 + x1) / 2, L.y, (z0 + z1) / 2, 0.4);
		landings.push({ n, rect: [x0, z0, x1, z1], y: L.y, kind: L.kind });
	}
	// соседние площадки одной высоты (коридор, клетка) — связаны
	// допуск 0.3 м — толщина стены с проёмом (крыльцо ↔ тамбур: 0.12 м)
	const touch = (a, b) => a[0] <= b[2] + 0.3 && b[0] <= a[2] + 0.3 && a[1] <= b[3] + 0.3 && b[1] <= a[3] + 0.3;
	for (let i = 0; i < landings.length; i++) for (let j = i + 1; j < landings.length; j++)
		if (Math.abs(landings[i].y - landings[j].y) < 0.1 && touch(landings[i].rect, landings[j].rect)) link(landings[i].n, landings[j].n);
	// ближняя площадка на высоте y к точке
	const nearLanding = (x, y, z) => {
		let best = -1, bd = 4.0;
		for (const L of landings) {
			if (Math.abs(L.y - y) > 0.12) continue;
			const cx = Math.max(L.rect[0], Math.min(x, L.rect[2])), cz = Math.max(L.rect[1], Math.min(z, L.rect[3]));
			const dd = Math.hypot(x - cx, z - cz);
			if (dd < bd) { bd = dd; best = L.n; }
		}
		return best;
	};
	// ближний узел улицы (для крыльца)
	const nearStreet = (x, z) => {
		let best = -1, bd = 6;
		for (let i = 0; i < first; i++) { const dd = Math.hypot(nodes[i].p[0] - x, nodes[i].p[1] - z); if (dd < bd) { bd = dd; best = i; } }
		return best;
	};
	let flights = 0;
	for (const f of info.flights || []) {
		if (f.passable === false) continue;
		// у концов марша подходим вплотную (0.2): раньше свернуть — клип лестницы начнётся до ступеней
		const a = add(f.a[0], f.a[1], f.a[2], 0.2), b = add(f.b[0], f.b[1], f.b[2], 0.2);
		link(a, b);
		// ребро a–b — марш (клипы лестницы). a — у первого подступенка; b у маршей — на проступь
		// дальше последнего, у крыльца — на нём самом (замер лучом): d1 — от b до первого спуска
		const len = Math.hypot(f.b[0] - f.a[0], f.b[2] - f.a[2]);
		nodes[a].flight = nodes[b].flight = { rise: f.rise, tread: f.tread, d1: Math.max(0, len - (f.steps - 1) * f.tread) };
		link(b, nearLanding(f.b[0], f.b[1], f.b[2]));
		if (f.kind === "porch") link(a, nearStreet(f.a[0], f.a[2]));
		else link(a, nearLanding(f.a[0], f.a[1], f.a[2]));
		flights++;
	}
	console.log(`[улица] граф дома: узлов ${nodes.length - first}, маршей ${flights}`);
	return nodes.length - first;
}
