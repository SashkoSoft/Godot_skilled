// Лестница: общая привязка клипов blend (StairsUp/Down-loop) к маршам hou — для роботов
// (robot.js) и героя (player.js).
//
// Профили blend (stairs_profiles.json): в начале цикла вверх подступенок — в 0.116 м впереди
// Root, проступь за ним — на 0.103 выше Root; вниз — край в 0.054 м впереди, проступь под
// ногами — на 0.063 выше Root (ступени 0.1667×0.267, у других — в пропорции). Цикл — две
// ступени. Марш hou (замер лучом): a — у первого подступенка; b у маршей — на проступь дальше
// последнего, у крыльца — на нём самом; d1 — от b до первого спуска.

/** Клип без движения Root: тело двигает игра, клип — только позу. */
export function inPlace(clip) {
	if (!clip) return null;
	const k = clip.clone();
	k.tracks = k.tracks.filter(t => t.name !== "Root.position");
	return k;
}

/** Марш hou (<id>.json → flights) → { rise, tread, d1 }. */
export function flightShape(f) {
	const len = Math.hypot(f.b[0] - f.a[0], f.b[2] - f.a[2]);
	return { rise: f.rise, tread: f.tread, d1: Math.max(0, len - (f.steps - 1) * f.tread), len };
}

/**
 * Поза на марше: f — пройдено по горизонтали от начала (вверх — от a, вниз — от b),
 * y0 — высота начала. Возвращает высоту Root (зажатую между концами) и фазу цикла 0..1.
 */
export function stairsPose(F, up, f, y0, y1) {
	const k = F.tread / 0.267, sc = F.rise / 0.1667, s = F.rise / F.tread;
	let y, f0;
	if (up) { f0 = -0.116 * k; y = y0 + F.rise - 0.103 * sc + (f - f0) * s; }
	else { f0 = F.d1 - 0.054 * k; y = y0 - 0.063 * sc - (f - f0) * s; }
	const p = (f - f0) / (2 * F.tread);
	return { y: Math.min(Math.max(y0, y1), Math.max(Math.min(y0, y1), y)), phase: p - Math.floor(p) };
}
