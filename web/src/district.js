// Квартал из game/district.json: геометрические помощники и раскладка деревьев.
// Модуль без three.js — его же берёт карта (web/map.html), и дерево на карте
// стоит ровно там, где оно будет стоять в игре.

/** Высота дома — как её строит блок-аут (этажи × 3 м, одноэтажные по типу). */
export function heightOf(b) {
	return b.kind === "garages" ? 2.6 : b.kind === "shop" ? 5 : b.floors === 1 ? 3.6 : b.floors * 3 + 0.6;
}

export function rectsOf(b) {
	return b.parts ? b.parts : [b.rect];
}

export function inRect(p, r, pad = 0) {
	return p[0] > r[0] - pad && p[0] < r[2] + pad && p[1] > r[1] - pad && p[1] < r[3] + pad;
}

export function inPoly(p, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, zi] = poly[i], [xj, zj] = poly[j];
		if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

function distToSeg(p, a, b) {
	const dx = b[0] - a[0], dz = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function distToPath(p, path) {
	let d = Infinity;
	for (let i = 1; i < path.length; i++) d = Math.min(d, distToSeg(p, path[i - 1], path[i]));
	return d;
}

/** Полоса улицы целиком (проезд + бордюр + тротуар) как прямоугольник. */
export function streetRect(s) {
	const h = s.roadHalf + 0.14 + s.walk;
	return s.axis === "x"
		? [s.from, s.at - h, s.to, s.at + h]
		: [s.at - h, s.from, s.at + h, s.to];
}

export function areaById(d, id) {
	return d.areas.find(a => a.id === id);
}

/**
 * Все пешеходные оси: проезды, тропы и тротуары улиц со стороны квартала.
 * Без тротуаров дворовая сеть распадается на две несвязные части (восток и
 * запад разделяет универсам) — пешеход обходит, как в жизни, по улице.
 * Тротуары тянутся чуть за угол, чтобы пересечься друг с другом.
 */
export function walkLines(d) {
	const lines = baseLines(d);
	for (const a of accessPaths(d)) lines.push({ path: a.path, half: a.width / 2, id: a.id });
	return lines;
}

// Проезды, тропы и тротуары — без подходов к дверям (из них подходы и строятся).
function baseLines(d) {
	const lines = [...d.driveways, ...d.paths].map(w => ({ path: w.path, half: w.width / 2, id: w.id }));
	const [ix0, iz0, ix1, iz1] = d.interior;
	for (const s of d.streets) {
		const half = (0.14 + s.walk) / 2, off = s.roadHalf + half;
		if (s.axis === "x") {
			const z = s.at + (s.at < 0 ? off : -off);
			lines.push({ path: [[ix0 - 8, z], [ix1 + 8, z]], half, id: "walk-" + s.id });
		} else {
			const x = s.at + (s.at < 0 ? off : -off);
			lines.push({ path: [[x, iz0 - 8], [x, iz1 + 8]], half, id: "walk-" + s.id });
		}
	}
	return lines;
}

/**
 * Подходы ко входам — правилом, а не руками: от каждой двери дальше метра от
 * сети идёт дорожка прямо наружу до ближайшей оси проезда/тропы/тротуара
 * (луч по нормали стены, не дальше 25 м); если луч ни во что не упёрся — к
 * ближайшей точке сети, выйдя сначала на 2 м от стены. Ворота гаражей
 * выходят прямо на проезд — им не нужно.
 */
let accessCache = null;
export function accessPaths(d) {
	if (accessCache && accessCache.d === d) return accessCache.list;
	const base = baseLines(d), list = [];
	const W = (d.access && d.access.width) || 1.6;
	const near = p => {
		let best = null;
		for (const l of base) for (let i = 1; i < l.path.length; i++) {
			const a = l.path[i - 1], b = l.path[i], dx = b[0] - a[0], dz = b[1] - a[1];
			const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
			const q = [a[0] + t * dx, a[1] + t * dz], dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
			if (!best || dd - l.half < best.dd - best.half) best = { q, dd, half: l.half };
		}
		return best;
	};
	const ray = (p, n) => {
		let best = null;
		for (const l of base) for (let i = 1; i < l.path.length; i++) {
			const a = l.path[i - 1], b = l.path[i];
			const rx = n[0], rz = n[1], sx = b[0] - a[0], sz = b[1] - a[1];
			const den = rx * sz - rz * sx;
			if (Math.abs(den) < 1e-9) continue;
			const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den;     // вдоль луча
			const u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / den;     // вдоль отрезка
			if (t > 0 && t < 25 && u >= 0 && u <= 1 && (!best || t < best)) best = t;
		}
		return best;
	};
	const fenced = d.areas.filter(a => a.kind === "fenced" && a.gate);
	for (const b of d.buildings) {
		if (b.kind === "garages") continue;
		for (const e of b.entrances) {
			const { p, n } = entrancePoint(b, e);
			const nb = near(p);
			if (!nb || nb.dd - nb.half <= 1.0) continue;
			// дверь за забором — через калитку: дверь → калитка → сеть
			const yard = fenced.find(a => inRect(p, a.rect, 1.0));
			if (yard) {
				const g = yard.gate, out = near(g);
				list.push({ id: `access-${b.id}-${e.label}`, path: [p, g, out.q], width: W, access: true });
				continue;
			}
			const t = ray(p, n);
			const path = t !== null
				? [p, [p[0] + n[0] * t, p[1] + n[1] * t]]
				: [p, [p[0] + n[0] * 2, p[1] + n[1] * 2], near([p[0] + n[0] * 2, p[1] + n[1] * 2]).q];
			list.push({ id: `access-${b.id}-${e.label}`, path, width: W, access: true });
		}
	}
	accessCache = { d, list };
	return list;
}

/** Точка входа на стене и внешняя нормаль. */
export function entrancePoint(b, e) {
	const r = rectsOf(b)[0];
	if (e.side === "N") return { p: [e.at, e.z ?? r[1]], n: [0, -1] };
	if (e.side === "S") return { p: [e.at, e.z ?? r[3]], n: [0, 1] };
	if (e.side === "W") return { p: [e.x ?? r[0], e.at], n: [-1, 0] };
	return { p: [e.x ?? r[2], e.at], n: [1, 0] };
}

function mulberry32(seed) {
	return () => {
		seed |= 0; seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

// Где дерево расти не может: дома, твёрдые площадки, проезды, улицы.
// Одно правило на ряды и на массивы — никаких исключений под конкретное место.
const HARD_AREAS = new Set(["parking", "sport", "playground", "bins"]);

function blocked(d, p) {
	for (const b of d.buildings) for (const r of rectsOf(b)) if (inRect(p, r, 1.5)) return true;
	for (const a of d.areas) if (HARD_AREAS.has(a.kind) && a.rect && inRect(p, a.rect, 1.0)) return true;
	for (const w of d.driveways) if (distToPath(p, w.path) < w.width / 2 + 1.2) return true;
	for (const w of [...d.paths, ...accessPaths(d)]) if (distToPath(p, w.path) < w.width / 2 + 0.6) return true;
	for (const s of d.streets) if (inRect(p, streetRect(s), 0.3)) return true;
	return false;
}

/* ── параметры экземпляров ───────────────────────────────────────────
   Порода, состояние, материалы — отдельным генератором от координат, а не
   из общего потока раскладки: добавь параметр — и ни одно дерево, ни одна
   куча не сдвинется с места. */

function rngAt(x, z, salt) {
	const s = (Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ salt) | 0;
	return mulberry32(s);
}

function pickWeighted(w, u) {
	const keys = Object.keys(w), total = keys.reduce((a, k) => a + w[k], 0);
	let t = u * total;
	for (const k of keys) { if ((t -= w[k]) <= 0) return k; }
	return keys[keys.length - 1];
}

/** Параметры дерева: порода, возраст, состояние, высота, наклон — по ним игра выберет вариант. */
function treeParams(d, x, z, r, src) {
	const T = d.trees, rnd = rngAt(x, z, 0x7ee);
	const species = pickWeighted(src.mix || T.mix, rnd());
	const sp = T.species[species];
	const age = T.ages.find(a => r < a.rBelow).id;
	const health = pickWeighted(src.health || T.health, rnd());
	const h = r * (sp.hPerR[0] + rnd() * (sp.hPerR[1] - sp.hPerR[0]));
	const leanMax = src.leanMax ?? T.leanMax;
	return {
		species, age, health,
		h: Math.round(h * 10) / 10,
		lean: Math.round(rnd() * leanMax), leanDir: Math.round(rnd() * 360),
		seed: Math.floor(rnd() * 1e6),
	};
}

/** Материалы кучи: 2–3 штуки с долями, ведущий по весам правила. */
function pileMaterials(T, rule, x, z) {
	const rnd = rngAt(x, z, 0x7a5);
	const w = { ...(rule.materials || T.materialMix) };
	const n = rnd() < 0.5 ? 2 : 3;
	const picked = [];
	for (let i = 0; i < n && Object.keys(w).length; i++) {
		const k = pickWeighted(w, rnd());
		picked.push(k); delete w[k];
	}
	const main = 0.5 + rnd() * 0.3;
	const mat = { [picked[0]]: main };
	const rest = picked.slice(1);
	let left = 1 - main;
	rest.forEach((k, i) => {
		const part = i === rest.length - 1 ? left : left * (0.4 + rnd() * 0.3);
		mat[k] = Math.round(part * 100) / 100; left -= mat[k];
	});
	mat[picked[0]] = Math.round(main * 100) / 100;
	return { mat, seed: Math.floor(rnd() * 1e6) };
}

// Габариты объектов без явного size — те же, что рисуют карта и блок-аут.
const OBJ_SIZE = { car: [4.5, 1.9], bench: [1.8, 0.6], table: [1.2, 1.2], crossing: [0, 0] };

/**
 * Кучи мусора по правилам из d.trash: [{x, z, w, d, h, rot}] — габаритная
 * коробка, rot в радианах (по часовой на карте, где Z смотрит вниз).
 * Куча не встаёт: в дом, на пешеходную ось (остаётся проход), на ствол
 * дерева, на другую кучу и в исключённые места (убежище, лагерь слепых).
 */
export function trashPiles(d, trees = []) {
	const T = d.trash;
	if (!T || !T.rules) return [];
	const rnd = mulberry32(T.seed || 1);
	const lerp = ([a, b]) => a + rnd() * (b - a);
	const classes = Object.keys(T.mix);
	const pickClass = size => {
		if (size !== "mix") return size;
		let u = rnd();
		for (const c of classes) { if ((u -= T.mix[c]) <= 0) return c; }
		return classes[classes.length - 1];
	};
	const lines = walkLines(d);
	const out = [];

	const excluded = p => (T.exclude || []).some(x => {
		if (x.building) {
			const b = d.buildings.find(b => b.id === x.building);
			return inRect(p, b.rect, x.radius || 0);
		}
		const a = areaById(d, x.area);
		return a.poly ? inPoly(p, a.poly) : inRect(p, a.rect, 0.5);
	});

	const doors = d.buildings.flatMap(b => b.entrances.map(e => entrancePoint(b, e).p));
	function fits(q, onRoad, overlap = 0.85) {
		const rad = Math.hypot(q.w, q.d) / 2;          // полудиагональ — круг, в который вписана коробка
		const p = [q.x, q.z];
		// к стене куча может привалиться — центр не ближе половины радиуса
		for (const b of d.buildings) for (const r of rectsOf(b)) if (inRect(p, r, rad * 0.5 + 0.1)) return false;
		// перед входами свободно: в дом должно быть можно войти
		for (const dp of doors) if (Math.hypot(dp[0] - q.x, dp[1] - q.z) < (T.doorClear || 0) + rad * 0.7) return false;
		for (const l of lines) if (distToPath(p, l.path) < l.half + rad + 0.2) return false;
		if (!onRoad) for (const s of d.streets) if (inRect(p, streetRect(s), rad)) return false;
		for (const t of trees) if (Math.hypot(t[0] - q.x, t[1] - q.z) < rad * 0.8 + 0.3) return false;
		// машины, лавочки, ларьки — по описанному кругу их габарита
		for (const o of d.objects) {
			const sz = o.size || OBJ_SIZE[o.kind] || [2, 2];
			if (Math.hypot(o.at[0] - q.x, o.at[1] - q.z) < rad + Math.hypot(sz[0], sz[1]) / 2) return false;
		}
		for (const o of out) if (Math.hypot(o.x - q.x, o.z - q.z) < (rad + Math.hypot(o.w, o.d) / 2) * overlap) return false;
		return !excluded(p);
	}

	function place(gen, n, size, onRoad = false, rule = {}) {
		let placed = 0;
		for (let tries = 0; placed < n && tries < n * 60; tries++) {
			const cls = pickClass(size), c = T.sizes[cls];
			const p = gen();
			const w = lerp(c.w);
			const q = { x: p[0], z: p[1], w, d: c.ratio ? w * lerp(c.ratio) : lerp(c.d), h: lerp(c.h), rot: rnd() * Math.PI };
			if (!fits(q, onRoad, rule.overlap ?? 0.85)) continue;
			q.size = cls;
			q.rule = rule.near || rule.area || (rule.road ? "road:" + rule.road : "rect");
			if (T.materials) Object.assign(q, pileMaterials(T, rule, q.x, q.z));
			out.push(q); placed++;
		}
	}

	const inR = r => () => [r[0] + rnd() * (r[2] - r[0]), r[1] + rnd() * (r[3] - r[1])];
	const count = c => Array.isArray(c) ? Math.round(lerp(c)) : c;


	for (const rule of T.rules) {
		if (rule.near === "facades") {
			// Обрушение фасадов: скопления вдоль стен, у высоких домов — больше и дальше.
			for (const b of d.buildings.filter(b => rule.buildings.includes(b.kind))) {
				const H = heightOf(b);
				for (const r of rectsOf(b)) {
					const W = r[2] - r[0], D = r[3] - r[1], P = 2 * (W + D);
					const clusters = Math.max(1, Math.round(P * rule.density * (0.5 + H / 30)));
					const R = 1.5 + 0.08 * H;
					for (let k = 0; k < clusters; k++) {
						// точка на периметре и внешняя нормаль стены
						let t = rnd() * P, e, n;
						if (t < W) { e = [r[0] + t, r[1]]; n = [0, -1]; }
						else if ((t -= W) < D) { e = [r[2], r[1] + t]; n = [1, 0]; }
						else if ((t -= D) < W) { e = [r[2] - t, r[3]]; n = [0, 1]; }
						else { t -= W; e = [r[0], r[3] - t]; n = [-1, 0]; }
						const off = 0.5 + rnd() * (1.5 + 0.2 * H);
						const c = [e[0] + n[0] * off, e[1] + n[1] * off];
						place(() => {
							const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
							return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr];
						}, count(rule.piles), rule.size, false, rule);
					}
				}
			}
		} else if (rule.near === "entrances") {
			for (const b of d.buildings.filter(b => rule.buildings.includes(b.kind)))
				for (const e of b.entrances) {
					const { p, n } = entrancePoint(b, e);
					place(() => {
						const k = lerp(rule.dist), t = (rnd() - 0.5) * 2 * rule.spread;
						return [p[0] + n[0] * k - n[1] * t, p[1] + n[1] * k + n[0] * t];
					}, count(rule.count), rule.size, false, rule);
				}
		} else if (rule.near === "areas") {
			for (const a of d.areas.filter(a => a.kind === rule.areaKind))
				place(inR([a.rect[0] - rule.spread, a.rect[1] - rule.spread, a.rect[2] + rule.spread, a.rect[3] + rule.spread]),
					count(rule.count), rule.size, false, rule);
		} else if (rule.area) {
			const a = areaById(d, rule.area);
			if (a.poly) {
				const bb = [Math.min(...a.poly.map(q => q[0])), Math.min(...a.poly.map(q => q[1])),
					Math.max(...a.poly.map(q => q[0])), Math.max(...a.poly.map(q => q[1]))];
				const g = inR(bb);
				place(() => { for (;;) { const p = g(); if (inPoly(p, a.poly)) return p; } }, count(rule.count), rule.size, false, rule);
			} else place(inR(a.rect), count(rule.count), rule.size, false, rule);
		} else if (rule.road) {
			const s = d.streets.find(s => s.id === rule.road), h = s.roadHalf - 1.0;
			const [a, b] = s.axis === "x" ? [d.interior[0], d.interior[2]] : [d.interior[1], d.interior[3]];
			const r = s.axis === "x" ? [a, s.at - h, b, s.at + h] : [s.at - h, a, s.at + h, b];
			place(inR(r), count(rule.count), rule.size, true, rule);
		} else if (rule.rect) {
			place(inR(rule.rect), count(rule.count), rule.size, false, rule);
		}
	}
	return out;
}

/**
 * Подлесок по правилам d.undergrowth: [[x, z, r, params], ...] — как деревья,
 * чтобы модели ставил тот же код. Куст не встаёт: в дом, на пешеходную ось,
 * перед дверью, на площадку, на ствол дерева, в середину кучи мусора (у края —
 * можно, там ему и место) и в исключённые места.
 */
export function undergrowthPositions(d, trees = [], piles = []) {
	const U = d.undergrowth;
	if (!U) return [];
	const rnd = mulberry32(U.seed || 1);
	const lerp = ([a, b]) => a + rnd() * (b - a);
	const lines = walkLines(d);
	const doors = d.buildings.flatMap(b => b.entrances.map(e => entrancePoint(b, e).p));
	const doorClear = (d.trash && d.trash.doorClear) || 2.5;
	const out = [];

	function fits(x, z, r) {
		const p = [x, z];
		if (!inRect(p, d.interior)) return false;
		for (const b of d.buildings) for (const rr of rectsOf(b)) if (inRect(p, rr, r * 0.3)) return false;
		for (const l of lines) if (distToPath(p, l.path) < l.half + r * 0.6) return false;
		for (const dp of doors) if (Math.hypot(dp[0] - x, dp[1] - z) < doorClear + r) return false;
		for (const a of d.areas) if (HARD_AREAS.has(a.kind) && a.rect && inRect(p, a.rect, r * 0.5)) return false;
		for (const t of trees) if (Math.hypot(t[0] - x, t[1] - z) < 0.6 + r * 0.5) return false;
		for (const q of piles) if (Math.hypot(q.x - x, q.z - z) < Math.hypot(q.w, q.d) * 0.3) return false;
		for (const o of out) if (Math.hypot(o[0] - x, o[1] - z) < (o[2] + r) * 0.6) return false;
		for (const ex of U.exclude || []) {
			const b = ex.building && d.buildings.find(b => b.id === ex.building);
			if (b && inRect(p, b.rect, ex.radius || 0)) return false;
		}
		return true;
	}

	// один куст: порода по весам правила, размер в диапазоне породы, возраст — треть диапазона
	function add(x, z, mix) {
		const species = pickWeighted(mix, rnd());
		const sp = U.species[species];
		const k = rnd();
		const r = sp.r[0] + k * (sp.r[1] - sp.r[0]);
		if (!fits(x, z, r)) return false;
		const pr = rngAt(x, z, 0xb5);
		out.push([x, z, r, {
			species, age: k < 1 / 3 ? "young" : k < 2 / 3 ? "mature" : "old",
			health: pr() < (U.deadShare[species] || 0) ? "dead" : "healthy",
			h: Math.round((sp.h[0] + k * (sp.h[1] - sp.h[0])) * 10) / 10,
			lean: Math.round(pr() * 8), leanDir: Math.round(pr() * 360), seed: Math.floor(pr() * 1e6),
		}]);
		return true;
	}
	// скопление вокруг точки: n кустов в радиусе spread
	function cluster(c, n, spread, mix) {
		for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
			const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * spread;
			if (add(c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, mix)) i++;
		}
	}
	// вдоль стороны прямоугольника наружу: per10m скоплений на 10 м
	function alongRect(r, rule) {
		const W = r[2] - r[0], D = r[3] - r[1], P = 2 * (W + D);
		const n = Math.round(P / 10 * rule.per10m);
		for (let k = 0; k < n; k++) {
			let t = rnd() * P, e, nn;
			if (t < W) { e = [r[0] + t, r[1]]; nn = [0, -1]; }
			else if ((t -= W) < D) { e = [r[2], r[1] + t]; nn = [1, 0]; }
			else if ((t -= D) < W) { e = [r[2] - t, r[3]]; nn = [0, 1]; }
			else { t -= W; e = [r[0], r[3] - t]; nn = [-1, 0]; }
			const off = lerp(rule.dist);
			cluster([e[0] + nn[0] * off, e[1] + nn[1] * off], Math.round(lerp(rule.cluster)), rule.spread, rule.mix);
		}
	}

	for (const rule of U.rules) {
		if (rule.near === "walls") for (const b of d.buildings) for (const r of rectsOf(b)) alongRect(r, rule);
		else if (rule.near === "fences") for (const a of d.areas.filter(a => a.kind === "fenced")) {
			alongRect(a.rect, rule);   // снаружи забора
			alongRect([a.rect[0] + 1.5, a.rect[1] + 1.5, a.rect[2] - 1.5, a.rect[3] - 1.5], { ...rule, dist: [0, 0.3] });   // и изнутри
		}
		else if (rule.near === "piles") for (const q of piles) {
			if (rnd() > rule.chance) continue;
			const rad = Math.hypot(q.w, q.d) / 2;
			const a = rnd() * Math.PI * 2;
			cluster([q.x + Math.cos(a) * rad, q.z + Math.sin(a) * rad], Math.round(lerp(rule.cluster)), rule.spread, rule.mix);
		}
		else if (rule.near === "trees") for (const t of trees) {
			if (rnd() > rule.chance) continue;
			cluster([t[0], t[1]], Math.round(lerp(rule.cluster)), rule.spread, rule.mix);
		}
		else if (rule.area) {
			const a = areaById(d, rule.area);
			const poly = a.poly, bb = poly
				? [Math.min(...poly.map(q => q[0])), Math.min(...poly.map(q => q[1])), Math.max(...poly.map(q => q[0])), Math.max(...poly.map(q => q[1]))]
				: a.rect;
			for (let i = 0, tries = 0; i < rule.count && tries < rule.count * 30; tries++) {
				const p = [bb[0] + rnd() * (bb[2] - bb[0]), bb[1] + rnd() * (bb[3] - bb[1])];
				if (poly && !inPoly(p, poly)) continue;
				if (add(p[0], p[1], rule.mix)) i++;
			}
		}
		else if (rule.rect) {
			const r = rule.rect;
			for (let i = 0, tries = 0; i < rule.count && tries < rule.count * 30; tries++)
				if (add(r[0] + rnd() * (r[2] - r[0]), r[1] + rnd() * (r[3] - r[1]), rule.mix)) i++;
		}
	}
	return out;
}

/** Все деревья квартала: [[x, z, r, params], ...], r — радиус кроны, params — см. treeParams. */
export function treePositions(d) {
	const out = [];
	// Зазор по размеру крон, а не фиксированный: кроны от 3.6 до 7.2 м в ширину,
	// и при старых 3.2 м между стволами коробки крон входили друг в друга.
	// Крона в игре — повёрнутая коробка, её угол торчит на √2·r от ствола;
	// 1.45 × сумма радиусов — коробки соседей не входят друг в друга при любом повороте.
	const far = (p, r) => out.every(t => Math.hypot(t[0] - p[0], t[1] - p[1]) > (t[2] + r) * 1.45);
	for (const row of d.trees.rows) {
		const [a, b] = [row.from, row.to];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		for (let s = 0; s <= len + 1e-6; s += row.step) {
			const p = [a[0] + (b[0] - a[0]) * s / len, a[1] + (b[1] - a[1]) * s / len];
			if (!blocked(d, p) && far(p, 2.6)) out.push([p[0], p[1], 2.6, treeParams(d, p[0], p[1], 2.6, row)]);
		}
	}
	for (const c of d.trees.clusters) {
		const rnd = mulberry32(c.seed);
		const poly = c.area ? areaById(d, c.area).poly : null;
		const r = poly
			? [Math.min(...poly.map(q => q[0])), Math.min(...poly.map(q => q[1])),
				Math.max(...poly.map(q => q[0])), Math.max(...poly.map(q => q[1]))]
			: c.rect;
		let placed = 0;
		for (let tries = 0; placed < c.count && tries < c.count * 40; tries++) {
			const p = [r[0] + rnd() * (r[2] - r[0]), r[1] + rnd() * (r[3] - r[1])];
			const size = 1.8 + rnd() * 1.8;
			if (poly && !inPoly(p, poly)) continue;
			if (blocked(d, p) || !far(p, size)) continue;
			out.push([p[0], p[1], size, treeParams(d, p[0], p[1], size, c)]);
			placed++;
		}
	}
	return out;
}
