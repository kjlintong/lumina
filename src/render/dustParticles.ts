/**
 * 尘埃粒子系统（P8b 渲染层）
 *
 * 体积光柱里漂浮的尘埃——「画面高级感」的核心来源之一。
 *
 * 实现要点（规格 P8b §交付物 1 / 红线）：
 * - `PointsMaterial`（**不是**自定义 ShaderMaterial），`sizeAttenuation` +
 *   `AdditiveBlending` + `transparent` + `depthWrite=false`，贴图是程序化
 *   64×64 径向渐变（白芯→透明），否则粒子是硬边正方形、一眼假。
 * - `Points.frustumCulled = false`：体积小，省掉边界框计算，且漂移 wrap 后
 *   粒子可能短暂越出静态包围球，关掉剔除避免闪烁。
 * - 分布用 P8a 的 `mulberry32`（同 seed 必同分布，单测可断言确定性）。
 * - jsdom 无 canvas：`makeDustTexture` 返回 `null`，材质不挂 map（主路径
 *   不进单测；单测只断言材质属性与位置数学）。
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
} from 'three';
import { mulberry32 } from './materials.js';

/** 尘埃粒子参数 */
export interface DustSettings {
  /** 粒子数，默认 350 */
  count?: number;
  /** 粒子分布体积（米，宽高深），默认 [5, 2.2, 3.5] */
  volumeSize?: [number, number, number];
  /** 漂移速度量级（m/s），默认 0.05 */
  driftSpeed?: number;
  /** 粒子尺寸（世界单位，sizeAttenuation 开启），默认 0.018 */
  size?: number;
  /** 不透明度，默认 0.45 */
  opacity?: number;
  /** 颜色（暖白，落日里的尘埃），默认 0xffe6b0 */
  color?: number;
  /** 随机种子，默认 7 */
  seed?: number;
}

/** 贴在 Points.userData 上的运行期状态（漂移相位 / 频率 / 包裹边界） */
interface DustUserData {
  volumeSize: [number, number, number];
  driftSpeed: number;
  /** 每粒子每轴的漂移相位（count*3） */
  phases: Float32Array;
  /** 每粒子每轴的漂移角频率（count*3，rad/s） */
  freqs: Float32Array;
}

/** 默认值集中一处，build / update 共用同一份 */
const DEFAULTS = {
  count: 350,
  volumeSize: [5, 2.2, 3.5] as [number, number, number],
  driftSpeed: 0.05,
  size: 0.018,
  opacity: 0.45,
  color: 0xffe6b0,
  seed: 7,
};

/**
 * 生成 64×64 径向渐变贴图（白芯 → 透明）。
 * jsdom / 无 canvas 环境返回 `null`，调用方判空后跳过 map 赋值。
 */
function makeDustTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** 把分量 v toroidal 包裹进 [-half, half]（漂移量远小于体积，单次回绕足够） */
function wrapAxis(v: number, half: number): number {
  if (v > half) return v - half * 2;
  if (v < -half) return v + half * 2;
  return v;
}

/**
 * 构建尘埃粒子云。
 *
 * 粒子分布在以局部原点为中心的 `volumeSize` 体积内（x∈±w/2、y∈±h/2、
 * z∈±d/2）。把返回的 `Points` 摆到目标高度（如 `points.position.y = 1.2`）
 * 即可让尘埃浮在半空。
 *
 * 每粒子的漂移相位/频率在构建时一次性写入 `userData`，
 * `updateDustPoints` 每帧原地改 position，**不 new 对象**。
 */
export function buildDustParticles(settings: DustSettings = {}): Points {
  const count = settings.count ?? DEFAULTS.count;
  const volumeSize = settings.volumeSize ?? DEFAULTS.volumeSize;
  const driftSpeed = settings.driftSpeed ?? DEFAULTS.driftSpeed;
  const seed = settings.seed ?? DEFAULTS.seed;

  const rnd = mulberry32(seed);

  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count * 3);
  const freqs = new Float32Array(count * 3);
  const [vx, vy, vz] = volumeSize;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // 均匀分布在整个体积（中心在原点）
    positions[i3] = (rnd() - 0.5) * vx;
    positions[i3 + 1] = (rnd() - 0.5) * vy;
    positions[i3 + 2] = (rnd() - 0.5) * vz;
    // 每轴独立的相位与角频率 → 各粒子漂移不同步，看起来「漂浮」而非「下雨」
    phases[i3] = rnd() * Math.PI * 2;
    phases[i3 + 1] = rnd() * Math.PI * 2;
    phases[i3 + 2] = rnd() * Math.PI * 2;
    // 角频率 0.2~0.6 rad/s：足够慢，呈现「缓缓浮动」
    freqs[i3] = 0.2 + rnd() * 0.4;
    freqs[i3 + 1] = 0.2 + rnd() * 0.4;
    freqs[i3 + 2] = 0.2 + rnd() * 0.4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

  const material = new PointsMaterial({
    color: settings.color ?? DEFAULTS.color,
    size: settings.size ?? DEFAULTS.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: settings.opacity ?? DEFAULTS.opacity,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  // 必须挂 map（径向渐变柔化），否则粒子是硬边正方形。jsdom 下为 null，跳过。
  const map = makeDustTexture();
  if (map) material.map = map;

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'dust-particles';

  const userData: DustUserData = { volumeSize, driftSpeed, phases, freqs };
  points.userData = userData as unknown as Record<string, unknown>;
  return points;
}

/**
 * 每帧更新尘埃漂移。
 *
 * 每粒子每轴做小幅正弦漂移（振幅 driftSpeed·dt 量级），越界时 toroidal
 * 包裹回对面。**不 new 任何对象**，原地改 position 数组后置 needsUpdate。
 *
 * 用真实墙钟 dt（**不**乘 timeSpeed）：粒子是物理漂浮，不随虚拟时间加速。
 *
 * @param points buildDustParticles 返回的 Points
 * @param deltaSeconds 本帧真实间隔（秒）
 * @param timeSeconds 累计时间（秒，用于正弦相位）
 */
export function updateDustPoints(points: Points, deltaSeconds: number, timeSeconds: number): void {
  const userData = points.userData as Partial<DustUserData>;
  const attr = points.geometry.getAttribute('position');
  if (!attr) return;
  const arr = attr.array as Float32Array;
  const count = arr.length / 3;

  const { volumeSize, driftSpeed, phases, freqs } = userData;
  // userData 由 buildDustParticles 一次性写入；缺失任一项则跳过本帧。
  // 解构后显式守卫，既防运行时崩溃，也让 TS 把各项收窄为 definite 类型。
  if (!volumeSize || !phases || !freqs || typeof driftSpeed !== 'number') return;
  const hx = volumeSize[0] / 2;
  const hy = volumeSize[1] / 2;
  const hz = volumeSize[2] / 2;

  for (let i = 0; i < count; i++) {
    // count = arr.length/3，phases/freqs 同为 count*3，索引 i3..i3+2 必在界内；
    // ! 仅消除 TS noUncheckedIndexedAccess 的 number|undefined（热循环不做 at() 调用开销）。
    const i3 = i * 3;
    const px = arr[i3]!;
    const py = arr[i3 + 1]!;
    const pz = arr[i3 + 2]!;
    arr[i3] = wrapAxis(
      px + Math.sin(timeSeconds * (freqs[i3]!) + phases[i3]!) * driftSpeed * deltaSeconds,
      hx,
    );
    arr[i3 + 1] = wrapAxis(
      py + Math.sin(timeSeconds * (freqs[i3 + 1]!) + phases[i3 + 1]!) * driftSpeed * deltaSeconds,
      hy,
    );
    arr[i3 + 2] = wrapAxis(
      pz + Math.sin(timeSeconds * (freqs[i3 + 2]!) + phases[i3 + 2]!) * driftSpeed * deltaSeconds,
      hz,
    );
  }
  attr.needsUpdate = true;
}
