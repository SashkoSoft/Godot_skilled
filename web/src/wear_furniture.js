// Износ и оттенки мебели для three.js (r152+). Формулы — как apply() в wear.py и wear_furniture.gdshader.
//
//   import { loadWearNoise, makeWearMaterial, randomWear } from "./wear_furniture.js";
//   const noise = await loadWearNoise("textures/wear_noise.png");
//   gltf.scene.traverse(o => { if (o.isMesh && !o.material.transparent) {
//       const mask = await texLoader.loadAsync("textures/baked/chair_leather_lod0_mask.png");
//       o.material = makeWearMaterial(o.material, mask, noise, randomWear(seed)); } });
// Параметры экземпляра — в material.userData.wear.value.* (можно менять на лету).
// Карта цвета из glb остаётся sRGB и общей для всех экземпляров (не клонируется).
// МАСКА: A — класс материала, её нельзя премультиплицировать и нельзя переворачивать (атлас из glb не перевёрнут,
// flipY = false ставится внутри makeWearMaterial). TextureLoader — подходит; ImageBitmapLoader — с
// { premultiplyAlpha: "none", colorSpaceConversion: "none" } БЕЗ imageOrientation: "flipY".
import * as THREE from "three";

export async function loadWearNoise(url) {
  const bl = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none",
    colorSpaceConversion: "none" });
  const t = new THREE.Texture(await bl.loadAsync(url));
  t.flipY = false; t.premultiplyAlpha = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

const FABRIC = [[0.50, 0.50, 0.49], [0.30, 0.22, 0.15], [0.25, 0.33, 0.22], [0.62, 0.48, 0.18], [0.40, 0.10, 0.10],
  [0.22, 0.30, 0.45], [0.55, 0.30, 0.15]];
const PAINT = [[0.84, 0.84, 0.81], [0.86, 0.80, 0.64], [0.62, 0.72, 0.50], [0.56, 0.70, 0.78], [0.36, 0.58, 0.55],
  [0.74, 0.58, 0.28], [0.40, 0.25, 0.15]];
const LEATHER = [[0.06, 0.065, 0.06], [0.20, 0.11, 0.06], [0.24, 0.05, 0.05], [0.42, 0.07, 0.06], [0.06, 0.13, 0.09],
  [0.52, 0.43, 0.32]];

// как random_params() в wear.py (распределения те же, генератор другой)
export function randomWear(seed = Math.random() * 1e9) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const beta = () => { const a = rnd() ** (1 / 2.2), b = rnd() ** (1 / 1.8); return a / (a + b); };   // ~Beta(2.2,1.8)
  const wear = beta();
  return {
    wear, dust: wear * (0.2 + 0.5 * rnd()), grime: Math.min(1, wear * (0.5 + 0.6 * rnd())),
    value: 0.6 + 0.7 * rnd(), warm: -0.2 + 0.9 * rnd(), sat: 0.8 + 0.5 * rnd(),
    fabric: rnd() < 0.25 ? null : FABRIC[Math.floor(rnd() * FABRIC.length)],
    leather: LEATHER[Math.floor(rnd() * LEATHER.length)],
    paint: rnd() < 0.3 ? null : PAINT[Math.floor(rnd() * PAINT.length)],
    noiseOffset: [rnd(), rnd()],
  };
}

export function makeWearMaterial(base, maskTex, noiseTex, p = {}) {
  const m = base.clone();
  // маска лежит в тех же UV, что атлас из glb (GLTFLoader: flipY = false) — поэтому всегда без переворота
  maskTex.colorSpace = THREE.NoColorSpace; maskTex.flipY = false; maskTex.needsUpdate = true;
  // карту НЕ клонируем (иначе атлас грузится в видеопамять на каждый экземпляр) — она sRGB, three отдаёт
  // линейное значение, в шейдере переводим обратно pow(c, 1/2.2) и считаем формулы в sRGB, как wear.py.
  const u = {
    uMask: { value: maskTex }, uNoise: { value: noiseTex }, uAlb: { value: m.map },
    uWear: { value: p.wear ?? 0 }, uDust: { value: p.dust ?? 0 }, uGrime: { value: p.grime ?? 0 },
    uValue: { value: p.value ?? 1 }, uWarm: { value: p.warm ?? 0 }, uSat: { value: p.sat ?? 1 },
    uFabric: { value: new THREE.Vector4(...(p.fabric || [0.5, 0.5, 0.5]), p.fabric ? 1 : 0) },
    uPaint: { value: new THREE.Vector4(...(p.paint || [0.84, 0.84, 0.81]), p.paint ? 1 : 0) },
    uLeather: { value: new THREE.Vector4(...(p.leather || [0.06, 0.065, 0.06]), p.leather ? 1 : 0) },
    uNoiseOff: { value: new THREE.Vector2(...(p.noiseOffset || [0, 0])) },
  };
  m.userData.wear = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uMask, uNoise, uAlb;
uniform float uWear, uDust, uGrime, uValue, uWarm, uSat;
uniform vec4 uFabric, uLeather, uPaint; uniform vec2 uNoiseOff;
float nearK(float k, float v) { return clamp(1.0 - abs(k - v) / 0.1, 0.0, 1.0); }
float lum3(vec3 c) { return (c.r + c.g + c.b) / 3.0; }
float gWearRough;`)
      .replace("#include <map_fragment>", `
vec2 uv = vMapUv;
vec3 c = pow(texture2D(uAlb, uv).rgb, vec3(1.0 / 2.2));
vec4 msk = texture2D(uMask, uv);
vec4 N = texture2D(uNoise, uv * 2.0 + uNoiseOff);
float scr = N.r, blot = N.g, chip = N.b, fine = N.a;
float E2 = clamp(textureLod(uMask, uv, 3.0).r * 4.0, 0.0, 1.0);
float A = msk.g, U = msk.b, K = msk.a;
float kw = nearK(K, 0.2), kp = nearK(K, 0.4), kl = nearK(K, 0.7), km = nearK(K, 0.8);
float kf = clamp(nearK(K, 0.6) - kl, 0.0, 1.0);
float kc = nearK(K, 0.3);
float live = clamp(kw + kp + kf + kl + km + kc, 0.0, 1.0);
float r = 0.0; float wr = uWear; float on = wr > 0.0 ? 1.0 : 0.0;
vec3 ct = c * uValue * vec3(1.0 + 0.12 * uWarm, 1.0 + 0.02 * uWarm, 1.0 - 0.14 * uWarm);
ct = vec3(lum3(ct)) + (ct - vec3(lum3(ct))) * uSat;
c = mix(c, clamp(ct, 0.0, 1.0), clamp(kw + kp + kf + kc, 0.0, 1.0));
if (uPaint.w > 0.5) { float lp = lum3(c); float avgp = max(lum3(pow(textureLod(uAlb, uv, 6.0).rgb, vec3(1.0 / 2.2))), 0.05);
  c = mix(c, uPaint.rgb * clamp(lp / avgp, 0.5, 1.4), kp * smoothstep(0.55, 0.8, lp / avgp) * 0.9); }
if (uFabric.w > 0.5) { float avg = max(lum3(pow(textureLod(uAlb, uv, 6.0).rgb, vec3(1.0 / 2.2))), 0.05);
  c = mix(c, uFabric.rgb * clamp(lum3(c) / avg, 0.3, 1.8), kf * 0.85); }
vec3 raw = c * 0.35 + vec3(0.72, 0.58, 0.42) * 0.65;
float ew = E2 * smoothstep(1.0 - wr * 0.7, 1.0 - wr * 0.7 + 0.2, blot * 0.8 + fine * 0.2) * on;
c = mix(c, raw, kw * ew * 0.6); c = mix(c, raw, kw * scr * wr * 0.55);
c = mix(c, c * vec3(1.04, 0.98, 0.82), kw * wr * 0.6);
float lac = smoothstep(0.45, 0.85, blot) * wr;
c = mix(c, (c * 0.6 + vec3(lum3(c)) * 0.4) * 1.25, kw * lac * 0.6);
r += kw * (0.45 * wr * smoothstep(0.4, 0.9, blot) + 0.3 * ew);
float pc = smoothstep(1.0 - wr * 0.55, 1.0 - wr * 0.55 + 0.04, clamp(E2 * 0.7 + chip * 0.55, 0.0, 1.3)) * on;
c = mix(c, vec3(0.34, 0.25, 0.16) * (0.8 + 0.4 * fine), kp * pc);
c = mix(c, c * 0.85 + 0.1, kp * scr * wr * 0.4); r += kp * (0.3 * pc + 0.2 * wr);
float lum = lum3(c);
c = mix(c, c * 0.55 + lum * 0.35 + 0.1, kf * wr * 0.7);
c = mix(c, c * 0.5 + vec3(0.08, 0.06, 0.03), kf * wr * smoothstep(0.55, 0.9, blot) * 0.9);
c = mix(c, c * 0.72, kf * smoothstep(0.8, 0.97, U) * wr * 0.5 * (0.6 + 0.4 * blot));
c *= 1.0 - kf * wr * 0.12 * (fine - 0.5);
if (uLeather.w > 0.5) { float det = clamp(lum3(c) / max(lum3(pow(textureLod(uAlb, uv, 2.0).rgb, vec3(1.0 / 2.2))), 0.01), 0.93, 1.07);
  c = mix(c, uLeather.rgb * det, kl); }
float seatz = smoothstep(0.75, 0.95, U) + E2 * 0.8;
float lw = max(fwidth(blot) * 1.5, 0.004); float crk = smoothstep(lw, 0.0, abs(blot - 0.5)) * clamp(seatz * 0.7 + E2 * 0.6, 0.0, 1.0)
  * smoothstep(0.3, 0.7, wr);
c = mix(c, c * 0.55, kl * crk * 0.5);
float rub = clamp(seatz * smoothstep(0.5, 0.8, blot) * wr, 0.0, 1.0);
c = mix(c, c * 0.6 + vec3(0.18, 0.17, 0.15), kl * rub * 0.7);
float tearT = blot * (0.3 + 0.7 * clamp(E2, 0.0, 1.0)) + (fine - 0.5) * 0.05;
float thr = 0.74 - (wr - 0.45) * 0.45; float old_ = wr > 0.5 ? 1.0 : 0.0;
float brk = smoothstep(0.46, 0.54, textureLod(uNoise, uv * 2.0 + uNoiseOff, 4.0).b);
float tear = smoothstep(thr, thr + 0.04, tearT) * old_ * brk * smoothstep(0.5, 0.7, blot);
float rim = clamp(smoothstep(thr - 0.07, thr, tearT) * old_ * brk - tear, 0.0, 1.0);
c = mix(c, c * 0.25, kl * rim * 0.9); c = mix(c, vec3(0.55, 0.45, 0.25) * (0.8 + 0.3 * fine), kl * tear);
r += kl * (0.35 * rub + 0.5 * tear + 0.2 * crk);
float salt = smoothstep(1.0 - wr * 0.6, 1.0 - wr * 0.6 + 0.15, blot * 0.7 + fine * 0.3) * on;
c = mix(c, vec3(0.86, 0.82, 0.76), kc * salt * 0.65); c = mix(c, c * 0.7, kc * smoothstep(0.6, 0.2, U) * wr * 0.4);
float mc = smoothstep(1.0 - wr * 0.22, 1.0 - wr * 0.22 + 0.03, clamp(E2 * 0.5 + chip * 0.45, 0.0, 1.3)) * on;
c = mix(c, vec3(0.06), km * mc); c = mix(c, c * 0.9 + 0.08, km * scr * wr * 0.3);
float crev = clamp((1.0 - A) * 1.6, 0.0, 1.0) * (0.6 + 0.4 * blot);
c = mix(c, c * 0.55, live * uGrime * 0.6 * crev);
float upm = smoothstep(0.85, 0.98, U) * (0.5 + 0.5 * fine);
c = mix(c, vec3(0.60, 0.58, 0.54), live * uDust * 0.4 * upm); r += live * uDust * 0.3 * upm;
gWearRough = r;
diffuseColor.rgb *= pow(clamp(c, 0.0, 1.0), vec3(2.2));`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + gWearRough, 0.03, 1.0);`);
  };
  return m;
}
