/**
 * 天空 / 室外与背景渐变（P8a 渲染层）
 *
 * 两件事：
 * 1. `skyColors(elevation)` —— 纯函数，根据太阳高度角返回一组颜色
 *    （天顶 / 地平线 / 半球光天地 / 场景背景），用线性插值在关键帧之间过渡。
 *    无任何 Three.js 依赖（返回 plain {r,g,b}，0..1 sRGB），便于单测。
 * 2. `buildSkyScene(...)` —— 在落地窗外放一个远景 group（太阳圆盘 + 远景色块），
 *    让「窗外」不是黑洞，并把太阳圆盘作为 bloom / 体积光的光源视觉锚点。
 *
 * 设计依据（规格 P8 §2 交付物 3）：
 * - 关键帧色温参考真实日落：正午冷蓝 → 日落橙红 → 夜晚深暗蓝。
 * - **夜晚 horizon 不为纯黑**：保留一点蓝（#0a1020），否则 ACES 会把整屏压死。
 */

import { BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry } from 'three';
import type { Vector3 } from 'three';

/** 0..1 sRGB 颜色（plain object，便于纯函数测试） */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** skyColors 返回的一组颜色 */
export interface SkyColors {
  /** 天顶色 */
  top: Rgb;
  /** 地平线色 */
  horizon: Rgb;
  /** 半球光天空色 */
  ambientSky: Rgb;
  /** 半球光地面色 */
  ambientGround: Rgb;
  /** 场景背景色 */
  background: Rgb;
}

/** hex → 0..1 sRGB（纯） */
function hex(h: number): Rgb {
  return { r: ((h >> 16) & 0xff) / 255, g: ((h >> 8) & 0xff) / 255, b: (h & 0xff) / 255 };
}

/** 线性插值两个颜色（纯） */
function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** smoothstep 缓动（让关键帧过渡更自然，纯） */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 关键帧（按高度角升序）。elevation 单位：弧度。 */
interface SkyKeyframe extends SkyColors {
  e: number;
}

const NIGHT_E = -Math.PI / 12; // 夜晚关键帧放在地平线以下 15°，黄昏→夜晚平滑过渡
const KEYFRAMES: SkyKeyframe[] = [
  {
    // 夜晚（elevation < 0 的锚点）
    e: NIGHT_E,
    top: hex(0x05080f),
    horizon: hex(0x0a1020), // 不为纯黑，保留一点蓝
    ambientSky: hex(0x0a0f1a),
    ambientGround: hex(0x05070c),
    background: hex(0x070a14),
  },
  {
    // 黄昏（elevation ≈ 0）
    e: 0,
    top: hex(0x0d1830),
    horizon: hex(0xc44a1a),
    ambientSky: hex(0x141c30),
    ambientGround: hex(0x241a14),
    background: hex(0x0f1428),
  },
  {
    // 日落（elevation ≈ π/30 ≈ 6°）
    e: Math.PI / 30,
    top: hex(0x1a2a4a),
    horizon: hex(0xff6a2a),
    ambientSky: hex(0x2a3450),
    ambientGround: hex(0x3a2a22),
    background: hex(0x22203a),
  },
  {
    // 傍晚（elevation ≈ π/8 ≈ 22.5°）
    e: Math.PI / 8,
    top: hex(0x2a4a7a),
    horizon: hex(0xff9a4d),
    ambientSky: hex(0x4a5a7a),
    ambientGround: hex(0x4a3a2e),
    background: hex(0x3a4a6a),
  },
  {
    // 正午（elevation ≥ π/3）
    e: Math.PI / 3,
    top: hex(0x4a90d9),
    horizon: hex(0xcfe8ff),
    ambientSky: hex(0xbcd8f0),
    ambientGround: hex(0x7a6a55),
    background: hex(0x9fc5e8),
  },
];

/**
 * 根据太阳高度角返回一组天空颜色。纯函数、无副作用。
 *
 * 在关键帧之间用 smoothstep 线性插值；低于夜晚锚点 / 高于正午锚点时截断。
 *
 * @param elevation 太阳高度角（弧度），0 = 地平线，π/2 = 天顶，<0 = 地下
 */
export function skyColors(elevation: number): SkyColors {
  const first = KEYFRAMES[0]!;
  const last = KEYFRAMES[KEYFRAMES.length - 1]!;

  if (elevation <= first.e) {
    const { top, horizon, ambientSky, ambientGround, background } = first;
    return { top, horizon, ambientSky, ambientGround, background };
  }
  if (elevation >= last.e) {
    const { top, horizon, ambientSky, ambientGround, background } = last;
    return { top, horizon, ambientSky, ambientGround, background };
  }

  // 找 bracketing 关键帧
  let lo = first;
  let hi = last;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]!;
    const b = KEYFRAMES[i + 1]!;
    if (elevation >= a.e && elevation <= b.e) {
      lo = a;
      hi = b;
      break;
    }
  }
  const t = smoothstep((elevation - lo.e) / (hi.e - lo.e));
  return {
    top: lerpColor(lo.top, hi.top, t),
    horizon: lerpColor(lo.horizon, hi.horizon, t),
    ambientSky: lerpColor(lo.ambientSky, hi.ambientSky, t),
    ambientGround: lerpColor(lo.ambientGround, hi.ambientGround, t),
    background: lerpColor(lo.background, hi.background, t),
  };
}

// ---------------------------------------------------------------------------
// 室外场景（视觉锚点，纯 Three.js 对象构建，无 WebGL 调用 → jsdom 可测）
// ---------------------------------------------------------------------------

/** 天空背板分段数（与 buildSkyScene 内的 BACKDROP_SEG 一致） */
const BACKDROP_SEG = 16;

/**
 * 把天空背板的顶点色更新为「天顶色 → 地平线色」的纵向渐变。
 * 纯 buffer 写入，零分配、零贴图重建。
 *
 * **色彩空间**：Three.js 顶点色按**线性**值解释（`color_pars_fragment.glsl.js` 里
 * vertexColors 分支不做 sRGB→linear），而 `material.color` 的 sRGB hex 会被转换。
 * 因此这里必须先把 skyColors 的 sRGB 值转成线性，否则渐变会比 material.color
 * 渲出来的颜色暗一档。
 *
 * PlaneGeometry(w, h, 1, seg) 顶点按行排列：i=0 在最上方（+h/2），每行 2 顶点。
 * t = i/seg 时 i=0 是天顶、i=seg 是地平线。
 *
 * @param backdrop buildSkyScene 返回的背板 mesh
 * @param top 天顶色（0..1 sRGB）
 * @param horizon 地平线色（0..1 sRGB）
 */
export function setSkyBackdropColors(backdrop: Mesh, top: Rgb, horizon: Rgb): void {
  const attr = backdrop.geometry.getAttribute('color');
  if (!(attr instanceof BufferAttribute)) return;
  const arr = attr.array as Float32Array;

  // sRGB → 线性（逐分量）
  const toLin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const tl = { r: toLin(top.r), g: toLin(top.g), b: toLin(top.b) };
  const hl = { r: toLin(horizon.r), g: toLin(horizon.g), b: toLin(horizon.b) };

  for (let i = 0; i <= BACKDROP_SEG; i++) {
    const t = i / BACKDROP_SEG;
    // 底部 12% 保持地平线暖色形成明显暖色带，其余平滑过渡到天顶
    const w = t > 0.12 ? 1 : 0;
    const r = hl.r + (tl.r - hl.r) * w;
    const g = hl.g + (tl.g - hl.g) * w;
    const b = hl.b + (tl.b - hl.b) * w;
    // 每行两顶点（左右）同色
    const base = i * 2 * 3;
    arr[base] = r;
    arr[base + 1] = g;
    arr[base + 2] = b;
    arr[base + 3] = r;
    arr[base + 4] = g;
    arr[base + 5] = b;
  }
  attr.needsUpdate = true;
}

/** 室外场景构建结果 */
export interface SkySceneResult {
  /** 放在窗外的远景 group（命名 'sky-scene'，不参与阴影） */
  group: Group;
  /** 太阳圆盘（toneMapped=false，触发 bloom；引擎每帧移动它） */
  sun: Mesh;
  /**
   * 天空背板（最远一层，MeshBasicMaterial + 纵向渐变贴图）。
   * **必须存在**：玻璃不采样环境贴图，窗外若无背板会显示成空白/发白。
   * 引擎每帧用 skyColors 更新其 `topColor` / `bottomColor`。
   */
  backdrop: Mesh;
}

/** 远景剪影参数（远山 / 中景 / 近景城市天际线） */
interface Silhouette {
  width: number;
  height: number;
  /** 沿 windowNormal 外推的距离（米） */
  depth: number;
  /** 中心高度（米） */
  y: number;
  color: number;
}

const SILHOUETTES: Silhouette[] = [
  { width: 70, height: 14, depth: 28, y: 3.0, color: 0x1a2030 }, // 远山
  { width: 50, height: 9, depth: 19, y: 1.8, color: 0x141824 }, // 中景
  { width: 34, height: 6, depth: 12, y: 1.0, color: 0x0e1220 }, // 近景城市
];

/**
 * 在窗外构建一个室外远景 group。
 *
 * group 平移到 `windowWorldPos`（窗中心），**无旋转**（局部系 = 世界系偏移），
 * 便于引擎每帧用世界方向的太阳位置换算局部坐标。所有室外物体沿
 * `windowNormal`（窗的外法线）方向外推放置，保证从室内看窗能看到室外。
 *
 * 全部 Mesh 不参与阴影（castShadow = receiveShadow = false），
 * MeshBasicMaterial 不受光照影响，始终可见（剪影）。
 *
 * @param windowWorldPos 窗中心世界坐标
 * @param windowNormal 窗外法线（单位向量，指向室外）
 */
export function buildSkyScene(windowWorldPos: Vector3, windowNormal: Vector3): SkySceneResult {
  const group = new Group();
  group.name = 'sky-scene';
  group.position.copy(windowWorldPos);

  // 天空背板：最远一层，单片 + **逐顶点颜色**（天顶冷色 → 地平线暖色）。
  // **关键**：MeshPhysicalMaterial.transmission 的玻璃采样的是不含自身也不含
  // scene.environment 的场景缓冲，因此窗外若只有 environment 贴图，玻璃会显示成
  // 纯白。必须有实体几何体在窗外才会被看见。
  // 为什么用顶点色而不是贴图：引擎每帧要按太阳高度改色，改顶点色只需写 1 个
  // buffer（~72 顶点），零贴图重建、零 GC。material.color 恒白，顶点色即最终色。
  const backdropGeo = new PlaneGeometry(300, 150, 1, BACKDROP_SEG);
  const vCount = (BACKDROP_SEG + 1) * 2;
  const backdropColors = new Float32Array(vCount * 3);
  backdropGeo.setAttribute('color', new BufferAttribute(backdropColors, 3));
  const backdropMat = new MeshBasicMaterial({
    vertexColors: true,
    fog: false,
  });
  const backdrop = new Mesh(backdropGeo, backdropMat);
  backdrop.castShadow = false;
  backdrop.receiveShadow = false;
  backdrop.position.set(windowNormal.x * 100, 40, windowNormal.z * 100);
  group.add(backdrop);

  // 太阳圆盘：toneMapped=false 保证它是画面里最亮的点、触发 bloom。
  // 位置由引擎每帧根据太阳角度写入（这里先放到窗外 15m 占位）。
  const sunMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  const sun = new Mesh(new SphereGeometry(1.4, 24, 24), sunMat);
  sun.castShadow = false;
  sun.receiveShadow = false;
  sun.position.set(windowNormal.x * 15, windowNormal.y * 15, windowNormal.z * 15);
  group.add(sun);

  // 远景色块：大而扁的 Plane 排在窗外不同深度，代表远山 / 城市剪影。
  // PlaneGeometry 默认面朝 +z；北窗外法线是 (0,0,-1)，平面无需旋转即朝室内。
  for (const s of SILHOUETTES) {
    const plane = new Mesh(
      new PlaneGeometry(s.width, s.height),
      new MeshBasicMaterial({ color: s.color, fog: false }),
    );
    plane.castShadow = false;
    plane.receiveShadow = false;
    plane.position.set(
      windowNormal.x * s.depth,
      s.y,
      windowNormal.z * s.depth,
    );
    group.add(plane);
  }

  return { group, sun, backdrop };
}
