// Старый бетон для three.js (r152+): база + 12 смешиваемых слоёв износа (props/concrete_kit).
// Формулы один в один с composite() в gen_kit.py и concrete_weathered.gdshader.
//
//   import { loadConcreteKit, makeWeatheredConcrete } from "./concrete_weathered.js";
//   const kit = await loadConcreteKit("kit/", { half: false });   // half: true → текстуры 1024×512
//   const mat = makeWeatheredConcrete(kit, {
//     wHang: [0.5, 0.2, 0.2, 0.5],   // grime, rust, wash, splash
//     wTile: [0.15, 0.3, 0.4, 0.4],  // moss, cracks, stains, chips
//     wExtra: [0.5, 0.0, 0.15, 0.0], // breakup, paint, lichen, soot
//     wallSize: [4, 2],              // сколько метров в uv1 0..1 (плита ПО-2)
//   });
//   prepareWallGeometry(mesh.geometry);  // uv1 → wallUv, убрать касательные (см. ниже)
//   mesh.material = mat;
// Каждой плите — свой материал (дёшево: текстуры общие) или те же веса: сдвиги берутся из позиции.
import * as THREE from "three";

export async function loadConcreteKit(dir, { half = false } = {}) {
  const tl = new THREE.TextureLoader();
  // Маски: в альфе лежат данные (splash, chips, soot), а не прозрачность. Браузер при обычной загрузке
  // может домножить RGB на альфу и испортить каналы там, где альфа ≈ 0, поэтому грузим ImageBitmap
  // без премультипликации и без цветовых преобразований. Переворот делается при декодировании
  // (у ImageBitmap flipY не работает) — ориентация та же, что у TextureLoader.
  const bl = new THREE.ImageBitmapLoader().setOptions({
    imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none",
  });
  const sz = half ? "1024x512" : "2048x1024";
  const setup = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const loadImg = async (name, srgb) => setup(await tl.loadAsync(dir + name), srgb);
  const loadMask = async (name) => {
    const t = new THREE.Texture(await bl.loadAsync(dir + name));
    t.flipY = false;
    t.premultiplyAlpha = false;
    return setup(t, false);
  };
  return {
    baseAlbedo: await loadImg("concrete_base_albedo_1024.jpg", true),
    baseNormal: await loadImg("concrete_base_normal_1024.jpg", false),
    hang: await loadMask(`kit_hang_${sz}.png`),
    tile: await loadMask(`kit_tile_${sz}.png`),
    extra: await loadMask(`kit_extra_${sz}.png`),
  };
}

// glTF TEXCOORD_1 приходит как атрибут uv1; кладём его под своим именем. Касательные из glb
// посчитаны по UV0 (атлас) — убираем, тогда three строит их по производным от uv1 сам.
export function prepareWallGeometry(geometry) {
  if (!geometry.getAttribute("wallUv")) geometry.setAttribute("wallUv", geometry.getAttribute("uv1"));
  if (geometry.getAttribute("tangent")) geometry.deleteAttribute("tangent");
}

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

export function makeWeatheredConcrete(kit, o = {}) {
  const wallSize = o.wallSize || [4, 2];
  const baseTile = o.baseTileM || 2;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  // нормали базы через штатный normalMap по uv1 (метры / baseTile)
  mat.normalMap = kit.baseNormal.clone();
  mat.normalMap.channel = 1;
  mat.normalMap.repeat.set(wallSize[0] / baseTile, wallSize[1] / baseTile);
  mat.normalMap.needsUpdate = true;
  const u = {
    uBase: { value: kit.baseAlbedo }, uHang: { value: kit.hang }, uTile: { value: kit.tile },
    uExtra: { value: kit.extra },
    uWallSize: { value: new THREE.Vector2(...wallSize) }, uBaseTile: { value: baseTile },
    uAutoOffset: { value: o.autoOffset === false ? 0 : 1 },
    uOffset: { value: new THREE.Vector3(...(o.offset || [0, 0, 0])) },
    wHang: { value: new THREE.Vector4(...(o.wHang || [0.5, 0.2, 0.2, 0.5])) },
    wTile: { value: new THREE.Vector4(...(o.wTile || [0.15, 0.3, 0.4, 0.4])) },
    wExtra: { value: new THREE.Vector4(...(o.wExtra || [0.5, 0.0, 0.15, 0.0])) },
    cGrime: { value: srgb(0.20, 0.19, 0.17) }, cRust: { value: srgb(0.25, 0.16, 0.10) },
    cWash: { value: srgb(0.70, 0.69, 0.65) }, cSplash: { value: srgb(0.33, 0.30, 0.25) },
    cMossD: { value: srgb(0.17, 0.19, 0.11) }, cMossL: { value: srgb(0.33, 0.33, 0.21) },
    cChip: { value: srgb(0.62, 0.60, 0.56) }, cPaint: { value: srgb(...(o.paint || [0.40, 0.45, 0.39])) },
    cLichen: { value: srgb(0.60, 0.60, 0.51) }, cSoot: { value: srgb(0.07, 0.07, 0.07) },
  };
  mat.userData.uniforms = u;   // менять веса потом: mat.userData.uniforms.wHang.value.set(...)
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 wallUv;
uniform float uAutoOffset;
varying vec2 vWallUv;
varying vec3 vSeed;
varying float vBack;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWallUv = wallUv;
vec3 wp = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vSeed = uAutoOffset * fract(sin(vec3(dot(wp, vec3(12.9898, 78.233, 37.719)),
  dot(wp, vec3(39.346, 11.135, 83.155)), dot(wp, vec3(73.156, 52.235, 9.151)))) * 43758.5453)
  * vec3(4.0, 4.0, 2.0);
vBack = objectNormal.z < -0.5 ? 1.0 : 0.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uBase, uHang, uTile, uExtra;
uniform vec2 uWallSize; uniform float uBaseTile; uniform vec3 uOffset;
uniform vec4 wHang, wTile, wExtra;
uniform vec3 cGrime, cRust, cWash, cSplash, cMossD, cMossL, cChip, cPaint, cLichen, cSoot;
varying vec2 vWallUv; varying vec3 vSeed; varying float vBack;
float msk(float ch, float w, float soft) { return clamp((ch + w - 1.0) / soft, 0.0, 1.0); }
float gMoss;`)
      .replace("#include <map_fragment>", `
vec2 m = vWallUv * uWallSize;
float v = clamp(vWallUv.y, 0.0, 1.0);
vec3 off = uOffset + vSeed + vBack * vec3(1.7, 2.3, 0.9);
// three загружает картинки с flipY: v 0 = низ картинки — как в numpy, переворачивать не нужно
vec4 H = texture2D(uHang, vec2((m.x + off.x) / 4.0, clamp(v, 0.002, 0.998)));
vec4 T = texture2D(uTile, vec2((m.x + off.y) / 4.0, (m.y + off.z) / 2.0));
vec4 E = texture2D(uExtra, vec2((m.x + off.y + 1.3) / 4.0, (m.y + off.z + 0.7) / 2.0));
float k = clamp(1.0 + wExtra.x * (2.0 * E.r - 1.0) * 1.5, 0.0, 2.0);
vec4 wh = clamp(wHang * k, 0.0, 1.0);
vec4 wt = clamp(wTile * k, 0.0, 1.0);
vec3 we = clamp(wExtra.yzw * k, 0.0, 1.0);
vec3 c = texture2D(uBase, m / uBaseTile).rgb;
c *= 1.0 - 0.28 * msk(T.b, wt.z, 0.35);
c = mix(c, cPaint * (0.9 + 0.2 * T.b), 0.8 * msk(E.g, we.x, 0.06));
c = mix(c, cWash, 0.6 * msk(H.b, wh.z, 0.5));
c = mix(c, cGrime, 0.85 * msk(H.r, wh.x, 0.5));
c = mix(c, cSplash, 0.75 * msk(H.a, wh.w, 0.4));
float sootCh = clamp(E.a * 0.7 + (1.0 - v) * 0.5 - 0.2, 0.0, 1.0);
c = mix(c, cSoot, 0.85 * msk(sootCh, we.z, 0.4));
gMoss = 0.75 * msk(clamp(T.r + 0.3 * H.a - 0.1, 0.0, 1.0), wt.x, 0.12);
c = mix(c, mix(cMossD, cMossL, T.b), gMoss);
c = mix(c, cLichen, 0.6 * msk(E.b, we.y, 0.1));
c = mix(c, cRust, 0.85 * msk(H.g, wh.y, 0.3));
c *= 1.0 - 0.65 * msk(T.g, wt.y, 0.15);
float d = min(min(m.x, uWallSize.x - m.x), min(m.y, uWallSize.y - m.y));
float cw = 0.004 + 0.05 * wt.w * T.a;
c = mix(c, cChip, 0.7 * (1.0 - smoothstep(cw * 0.6, cw, d)));
c *= 0.72 + 0.28 * smoothstep(0.0, 0.3, m.y);
diffuseColor.rgb = c;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 1.0, gMoss);`);
  };
  return mat;
}
