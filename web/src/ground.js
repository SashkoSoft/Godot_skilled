import * as THREE from "three";
import { makeSurfaceMaterial, PRESETS } from "./surface.js";
import { LAYOUT } from "./street.js";

// Земля за тротуаром — настоящей геометрией, а не плоской плитой.
//
// Это честный предел процедурной раскраски: сколько шума ни клади на
// плоскость, она остаётся крашеным картоном. Комковатость читается только
// тогда, когда её видно в силуэте и она по-разному ловит скользящий свет,
// а для этого нужна форма, а не пиксели.
//
// Поле высот считается ТЕМ ЖЕ шумом, что в шейдере: одинаковые h21/vnoise на
// одинаковых мировых координатах. Тогда вытоптанные проплешины, которые
// шейдер рисует от `stain`, ложатся во впадины, а не сами по себе.

/* ── тот же шум, что в surface.glsl ──────────────────────────────────── */
function fract(x) { return x - Math.floor(x); }

function h21(x, y) {
	let qx = fract(x * 0.1031), qy = fract(y * 0.1030), qz = fract(x * 0.0973);
	const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
	qx += d; qy += d; qz += d;
	return fract((qx + qy) * qz);
}

function vnoise(x, y) {
	const ix = Math.floor(x), iy = Math.floor(y);
	let fx = x - ix, fy = y - iy;
	fx = fx * fx * (3 - 2 * fx);
	fy = fy * fy * (3 - 2 * fy);
	const a = h21(ix, iy), b = h21(ix + 1, iy);
	const c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
	return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

function fbm(x, y, oct) {
	let s = 0, a = 0.5;
	for (let i = 0; i < oct; i++) {
		s += a * vnoise(x, y);
		x *= 2.03; y *= 2.03;
		a *= 0.5;
	}
	return s;
}

const L = LAYOUT;
const WALK_OUT = L.roadHalf + L.kerbW + L.walkW;

export const GROUND = {
	near: 30.0,      // полоса с настоящим рельефом
	step: 0.8,       // шаг сетки, м
	lenHalf: 170.0,  // вдоль X
	top: L.yWalk - 0.02,
};

/**
 * Высота земли в точке. Многомасштабно намеренно: один шум любого размаха
 * читается как одна волна, а не как земля. Свелл держит крупную форму,
 * рябь — средние бугры, мелочь — комья.
 *
 * @param {number} x,z мировые координаты
 * @param {number} d   расстояние от кромки тротуара, м
 */
export function groundHeight(x, z, d) {
	// У самого тротуара земля обязана совпадать с плитой, иначе вдоль всей
	// улицы пойдёт щель или ступенька. Размах поднимается от нуля.
	const grow = Math.min(1, Math.max(0, (d - 0.3) / 6.0));
	// И к дальнему краю тоже: за ним лежит плоская дальняя полоса, и если
	// рельеф не сойти на нет, на стыке останется щель до метра высотой —
	// сквозь неё видно небо ровной белой полосой через весь кадр.
	const taper = Math.min(1, Math.max(0, (GROUND.near - d) / 7.0));

	const swell = (fbm(x * 0.037, z * 0.037, 2) / 0.75 - 0.5) * 1.90;
	const ripple = (fbm(x * 0.125, z * 0.125, 2) / 0.75 - 0.5) * 0.90;
	const lumps = (fbm(x * 0.40, z * 0.40, 2) / 0.75 - 0.5) * 0.24;

	// Насыпь у самой кромки: земля годами наметается к плите, и ровная
	// линия стыка — главное, по чему тротуар читается вклеенным в грунт.
	const berm = Math.exp(-Math.pow((d - 0.9) / 0.8, 2)) * 0.12
			* (0.55 + 0.45 * vnoise(x * 0.9, z * 0.9));

	return (swell + ripple + lumps) * grow * taper + berm * Math.min(1, d / 0.35);
}

function nearStrip(glsl, side) {
	const nx = Math.round(GROUND.lenHalf * 2 / GROUND.step);
	const nz = Math.round(GROUND.near / GROUND.step);
	const geo = new THREE.PlaneGeometry(GROUND.lenHalf * 2, GROUND.near, nx, nz);
	geo.rotateX(-Math.PI / 2);          // из XY в XZ, нормалью вверх

	const pos = geo.attributes.position;
	const z0 = WALK_OUT;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		// после rotateX локальный z идёт от −near/2 до +near/2
		const d = pos.getZ(i) + GROUND.near / 2;
		const zw = side * (z0 + d);
		pos.setY(i, groundHeight(x, zw, d));
		pos.setZ(i, side * (z0 + d));
	}
	pos.needsUpdate = true;

	// Зеркальная сторона: переписав Z на отрицательный, мы развернули обход
	// треугольников, и нормали ушли ВНИЗ — полоса освещается с изнанки и
	// читается плоским светлым клином. Меняем местами две вершины каждого
	// треугольника, и намотка возвращается.
	if (side < 0) {
		const idx = geo.index.array;
		for (let i = 0; i < idx.length; i += 3) {
			const t = idx[i + 1];
			idx[i + 1] = idx[i + 2];
			idx[i + 2] = t;
		}
		geo.index.needsUpdate = true;
	}
	geo.computeVertexNormals();

	const mat = makeSurfaceMaterial(glsl, {
		...PRESETS.earth,
		latCenter: side * (z0 + GROUND.near / 2),
		latHalf: GROUND.near / 2,
	});
	const m = new THREE.Mesh(geo, mat);
	m.position.y = GROUND.top;
	m.name = "GroundNear";
	m.receiveShadow = true;
	m.castShadow = true;
	return m;
}

/** Дальний план: плоско и дёшево — туман съедает его целиком. */
function farStrip(glsl, side) {
	const inner = WALK_OUT + GROUND.near;
	const w = L.verge - GROUND.near;
	const geo = new THREE.PlaneGeometry(L.lenHalf * 2, w, 1, 1);
	geo.rotateX(-Math.PI / 2);
	const mat = makeSurfaceMaterial(glsl, {
		...PRESETS.earth,
		latCenter: side * (inner + w / 2),
		latHalf: w / 2,
	});
	const m = new THREE.Mesh(geo, mat);
	m.position.set(0, GROUND.top - 0.02, side * (inner + w / 2));
	m.name = "GroundFar";
	m.receiveShadow = true;
	return m;
}

export function buildGround(glsl) {
	const g = new THREE.Group();
	g.name = "Ground";
	for (const s of [-1, 1]) {
		g.add(nearStrip(glsl, s));
		g.add(farStrip(glsl, s));
	}
	return g;
}
