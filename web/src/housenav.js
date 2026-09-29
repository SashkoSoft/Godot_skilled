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

import { flightShape } from "./stairs.js";

const INNER = 0.8;

// Руина (<id>_ruin.json, состояние комнат от hou): без пола или недостижимая — не для
// роботов; мебель — только где пол цел (floor_ok > 0.6). У целого дома полей нет — всё можно.
export const roomWalkable = r => r.state !== "gone" && r.reachable !== false;
export const roomFurnishable = r => roomWalkable(r) && (r.floor_ok == null || r.floor_ok > 0.6);

function rectOf(rm) {
	const xs = rm.polygon_xz.map(p => p[0]), zs = rm.polygon_xz.map(p => p[1]);
	return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/**
 * Добавить дом в граф. nodes — массив узлов улицы (изменяется: дописываются узлы дома).
 * roomOk(room) — фильтр (руина: только уцелевшие); по умолчанию все.
 */
export function addHouseToGraph(nodes, info, { roomOk = () => true, entrances = [] } = {}) {
	const first = nodes.length;
	const add = (x, y, z, r = 0.35) => { nodes.push({ p: [x, z], y, nb: [], r, house: true, hid: info.id }); return nodes.length - 1; };
	const link = (i, j) => { if (i !== j && i >= 0 && j >= 0 && !nodes[i].nb.includes(j)) { nodes[i].nb.push(j); nodes[j].nb.push(i); } };
	const byId = Object.fromEntries(info.rooms.map(r => [r.id, r]));
	for (const L of info.landings_mid || []) if (L.kind === "vestibule") byId["vestibule_" + L.section] = { id: "vestibule_" + L.section, type: "vestibule", y: L.y, polygon_xz: L.polygon_xz };
	// дверь в подвал — только если есть и марш вниз (у руины его пока нет — тамбур не пересчитан)
	const hasBasementFlight = (info.flights || []).some(f => f.kind === "basement");
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
		if (d.kind === "basement" && !hasBasementFlight) continue;
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
	const landings = [], roomNode = {};   // roomNode — узел помещения (подвал: для связи с туннелем)
	for (const rm of info.rooms) {
		if (!(LAND.test(rm.type) || rm.floor === -1 || rm.type === "shop") || !roomOk(rm)) continue;
		const [x0, z0, x1, z1] = rectOf(rm), n = add((x0 + x1) / 2, rm.y, (z0 + z1) / 2, 0.4);
		for (const p of roomPts[rm.id] || []) link(n, p);
		landings.push({ n, rect: [x0, z0, x1, z1], y: rm.y });
		roomNode[rm.id] = n;
	}
	for (const L of info.landings_mid || []) {
		const [x0, z0, x1, z1] = rectOf(L), n = add((x0 + x1) / 2, L.y, (z0 + z1) / 2, 0.4);
		landings.push({ n, rect: [x0, z0, x1, z1], y: L.y, kind: L.kind });
		if (L.kind === "vestibule") for (const p of roomPts["vestibule_" + L.section] || []) link(n, p);
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
	// входы с улицы (district: точки на стене) — в помещение за стеной, если оно — зал с узлом
	for (const [ex, ez] of entrances) {
		for (const rm of info.rooms) {
			if (rm.floor !== 0 || roomNode[rm.id] === undefined) continue;
			const [x0, z0, x1, z1] = rectOf(rm);
			if (ex < x0 - 0.6 || ex > x1 + 0.6 || ez < z0 - 0.6 || ez > z1 + 0.6) continue;
			const cx = Math.max(x0 + 1, Math.min(x1 - 1, ex)), cz = Math.max(z0 + 1, Math.min(z1 - 1, ez));
			const out = add(ex + Math.sign(ex - cx) * 0.8, rm.y, ez + Math.sign(ez - cz) * 0.8, 0.4), inn = add(cx, rm.y, cz, 0.4);
			link(out, inn); link(inn, roomNode[rm.id]); link(out, nearStreet(nodes[out].p[0], nodes[out].p[1]));
		}
	}
	let flights = 0;
	for (const f of info.flights || []) {
		if (f.passable === false) continue;
		// у концов марша подходим вплотную (0.2): раньше свернуть — клип лестницы начнётся до ступеней
		const a = add(f.a[0], f.a[1], f.a[2], 0.2), b = add(f.b[0], f.b[1], f.b[2], 0.2);
		link(a, b);
		// ребро a–b — марш (клипы лестницы). a — у первого подступенка; b у маршей — на проступь
		// дальше последнего, у крыльца — на нём самом (замер лучом): d1 — от b до первого спуска
		nodes[a].flight = nodes[b].flight = flightShape(f);
		link(b, nearLanding(f.b[0], f.b[1], f.b[2]));
		if (f.kind === "porch" || f.kind === "pit") link(a, nearStreet(f.a[0], f.a[2]));   // крыльцо, приямок — с улицы
		else link(a, nearLanding(f.a[0], f.a[1], f.a[2]));
		flights++;
	}
	console.log(`[улица] граф дома: узлов ${nodes.length - first}, маршей ${flights}`);
	return { count: nodes.length - first, roomNode };
}

/**
 * Туннели между подвалами (tunnels.json hou): ход — цепочка узлов по станциям polyline
 * (y по длине), комнаты хода — подряд; из пролома в полу подвала — земляная лестница
 * (flights kind tunnel_stair: a — пол подвала, b — начало хода), связь — links (house, room).
 * roomNodes — { id дома: roomNode из addHouseToGraph }.
 */
export function addTunnelsToGraph(nodes, tunnels, roomNodes) {
	for (const T of tunnels) {
		const add = (x, y, z, r = 0.4) => { nodes.push({ p: [x, z], y, nb: [], r, house: true, hid: T.id }); return nodes.length - 1; };
		const link = (i, j) => { if (i !== j && i >= 0 && j >= 0 && !nodes[i].nb.includes(j)) { nodes[i].nb.push(j); nodes[j].nb.push(i); } };
		const stations = [];
		let last = -1;
		for (const rm of T.rooms) for (const [x, y, z] of rm.polyline) { const n = add(x, y, z); link(last, n); last = n; stations.push(n); }
		const nearStation = (x, y, z) => {
			let best = -1, bd = 3;
			for (const s of stations) { const d = Math.hypot(nodes[s].p[0] - x, nodes[s].p[1] - z) + Math.abs(nodes[s].y - y); if (d < bd) { bd = d; best = s; } }
			return best;
		};
		let n = 0;
		for (const L of T.links || []) {
			const f = (T.flights || [])[L.stair], rn = roomNodes[L.house] && roomNodes[L.house][L.room];
			if (!f || rn === undefined) continue;
			const a = add(f.a[0], f.a[1], f.a[2], 0.2), b = add(f.b[0], f.b[1], f.b[2], 0.2);
			link(a, b);
			nodes[a].flight = nodes[b].flight = flightShape(f);
			link(a, rn); link(b, nearStation(f.b[0], f.b[1], f.b[2]));
			n++;
		}
		console.log(`[улица] туннель ${T.id}: узлов ${stations.length}, выходов в подвалы ${n}`);
	}
}
