// Ступени текстур. У наборов HoudiniCOP, кроме исходника в корне (…_2k.png или
// …_1k.png), есть lod/ — 1k и 512, альбедо ещё и в .webp (в разы легче PNG).
// Манифест game/assets/textures/lod.json пишет tools/tex_sync.py.
//
// Раньше пол качал асфальт и плитку в 2k и сам ужимал до 1024 — вчетверо больше
// байтов, чем нужно кадру. Теперь файл берётся ровно нужного размера:
//   texPx — сколько пикселей нужно: телефон 512, компьютер 1024; #tex=512|1024|2048;
//   texUrl(набор, карта, px) — файл этой ступени (или ближайшей большей, если такой нет).
// У наборов с высотой в синем канале ORM (ormHeight) отдельный *_height_* не нужен.
// Мипмапы строит three.js (generateMipmaps) — у всех текстур и массивов.

export const TEX = "../game/assets/textures/";
const PHONE = matchMedia("(pointer: coarse)").matches;
export const texPx = +(new URLSearchParams(location.hash.slice(1)).get("tex") || (PHONE ? 512 : 1024));

let manifest = null;
/** Манифест ступеней (один раз на страницу). Нет его — всё берётся из корня набора, как раньше. */
export function lodManifest() {
	return manifest ||= fetch(TEX + "lod.json").then(r => r.ok ? r.json() : {}).catch(() => ({}));
}

const PX = { "256": 256, "512": 512, "1k": 1024, "2k": 2048, "05k": 512 };   // 05k — старое имя 512-исходника плит 0.5 м
const tierOf = px => px <= 256 ? "256" : px <= 512 ? "512" : px <= 1024 ? "1k" : "2k";

/**
 * URL карты набора для px пикселей. suffix — ступень исходника, если набора нет в
 * манифесте (старые наборы без lod/). Альбедо — .webp, где он есть.
 */
export function texUrl(M, set, map, px, suffix = "1k") {
	const e = M[set], file = set.replace(/-/g, "_");
	const root = `${TEX}${set}/${file}_${map}_${e?.src || suffix}.png`;
	if (!e) return root;
	// ступени по возрастанию: lod/ и исходник; первая не меньше нужной, иначе самая большая
	const all = [...e.tiers.filter(t => e.maps[t]?.includes(map)).map(t => ({ t, lod: true })), ...(e.src ? [{ t: e.src, lod: false }] : [])]
		.sort((a, b) => PX[a.t] - PX[b.t]);
	const pick = all.find(x => PX[x.t] >= px) || all[all.length - 1];
	if (!pick || !pick.lod) return root;
	const ext = map === "albedo" && e.webp ? "webp" : "png";
	return `${TEX}${set}/lod/${file}_${map}_${pick.t}.${ext}`;
}

/** Высота в синем канале ORM — отдельный файл высоты не качать. */
export const ormHeight = (M, set) => !!M[set]?.ormHeight;
export { tierOf };
