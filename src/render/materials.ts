/**
 * 程序化材质贴图（P8a 渲染层）
 *
 * 用 CanvasTexture 在运行时生成全部贴图，**不引入任何图片资源、不依赖网络**。
 *
 * 架构要点（规格 P8 §2 交付物 1）：
 * - jsdom（Vitest 测试环境）里 `canvas.getContext('2d')` 返回 `null`，因此
 *   贴图生成的主路径**不进单测**。所有可测逻辑抽成纯函数（mulberry32 /
 *   woodFloorColor / wallNormalColor / hexToRgb），canvas 工厂只是
 *   「纯函数逐像素求值 + putImageData」的薄壳。
 * - canvas 不可用时工厂**不抛错**，返回 `null`，由调用方判空后跳过 map 赋值。
 *   这样 jsdom 能安全 import 本模块而不崩，真实浏览器则生成真实贴图。
 */

import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';

/** 颜色通道截断到 [0, 255] 并取整 */
function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** fract 小数部分（用于确定性 hash / 周期扰动） */
function fract(v: number): number {
  return v - Math.floor(v);
}

// ---------------------------------------------------------------------------
// 纯逻辑（单测目标，不触碰 canvas / DOM）
// ---------------------------------------------------------------------------

/**
 * 种子随机数（mulberry32）。同 seed 产出同一序列，保证贴图确定性。
 * 返回一个 [0, 1) 均匀分布的伪随机函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0; // 归一到 uint32，允许任意数值种子
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hex 颜色拆分（工具函数，纯） */
export function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

/** 木地板贴图参数 */
export interface WoodFloorSettings {
  /** 板宽（米），默认 0.16 */
  plankWidth?: number;
  /** 基准木色，默认 0x9c7048 */
  baseColor?: number;
  /** 贴图分辨率（边长，px），默认 512 */
  resolution?: number;
  /** UV 重复次数，默认 3 */
  repeat?: number;
  /** 随机种子，默认 12345 */
  seed?: number;
}

/**
 * 计算木地板某一点的颜色。纯函数、确定性（同色板同 (u,v) 必同色）。
 *
 * 结构：
 * - 每块板一个 ±8% 明度差（由板索引确定性 hash，保证板间有色差但可复现）。
 * - 沿板长方向（u）的细木纹：多层正弦叠加，主要随 v（跨板宽）变化。
 * - 板缝：靠近板边缘（v≈0 / v≈1）压暗成深色线。
 *
 * @param u 板内横向坐标 0..1（沿板长 / 纹理走向）
 * @param v 板内纵向坐标 0..1（跨板宽，0 与 1 为板缝）
 * @param plank 当前板索引
 * @param baseColor 基准木色 hex
 * @returns { r, g, b } 0..255
 */
export function woodFloorColor(
  u: number,
  v: number,
  plank: number,
  baseColor: number,
): { r: number; g: number; b: number } {
  const base = hexToRgb(baseColor);

  // 板间色差：±8% 明度，由板索引确定性 hash（mulberry32(plank) 首值）
  const plankShade = 0.92 + mulberry32(plank)() * 0.16;

  // 木纹：多层正弦沿板长（u）扰动、跨板宽（v）成纹，幅度小避免脏乱
  const grain =
    Math.sin(v * 40 + Math.sin(u * 8) * 2) * 0.5 +
    Math.sin(v * 90 + u * 5) * 0.3 +
    Math.sin(v * 160 + u * 12) * 0.2;
  const grainShade = 1 + grain * 0.06;

  // 板缝：v 靠近 0 / 1 时压暗（板与板之间的深色线）
  const edgeDist = Math.min(v, 1 - v);
  const gapShade = edgeDist < 0.045 ? 0.45 : 1.0;

  const shade = plankShade * grainShade * gapShade;
  return {
    r: clamp255(base.r * shade),
    g: clamp255(base.g * shade),
    b: clamp255(base.b * shade),
  };
}

/**
 * 计算墙面法线贴图某一点的颜色。纯函数。
 *
 * 法线贴图约定：R/G 编码法线的 x/y 偏移（0.5 = 中性），B 恒接近 1（朝外）。
 * 这里用多层低频正弦产生极轻微的乳胶漆/石膏起伏，幅度 ±0.03（映射到
 * 0..255 约 ±8），配合材质 normalScale=0.4，只取「不是死平一块色」的观感，
 * 不做浮雕。
 *
 * @param x 像素 x 坐标  @param y 像素 y 坐标
 * @returns { r, g, b } 0..255，b 恒接近 255
 */
export function wallNormalColor(x: number, y: number): { r: number; g: number; b: number } {
  const nx =
    (Math.sin(x * 0.11) + Math.sin(x * 0.031 + 1.7) + Math.sin((x + y) * 0.017)) / 3;
  const ny =
    (Math.cos(y * 0.13) + Math.sin(y * 0.041 + 0.6) + Math.cos((x - y) * 0.023)) / 3;
  const tx = nx * 0.03;
  const ty = ny * 0.03;
  // 由 (tx, ty) 反推 z，保证 (r,g,b) 是单位法线的编码，b 自然接近 255
  const tz = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
  return {
    r: clamp255(128 + tx * 255),
    g: clamp255(128 + ty * 255),
    b: clamp255(tz * 255),
  };
}

// ---------------------------------------------------------------------------
// Canvas 工厂（浏览器运行时调用；jsdom 返回 null，调用方判空）
// ---------------------------------------------------------------------------

/** 创建 2D 上下文；jsdom / 极端环境返回 null（此时工厂整体返回 null） */
function create2D(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/**
 * 生成木地板 CanvasTexture（SRGB 颜色贴图，RepeatWrapping）。
 * canvas 不可用时返回 null。
 */
export function makeWoodFloorTexture(settings: WoodFloorSettings = {}): CanvasTexture | null {
  const {
    plankWidth = 0.16,
    baseColor = 0x9c7048,
    resolution = 512,
    repeat = 3,
    seed = 12345,
  } = settings;

  const made = create2D(resolution);
  if (!made) return null;
  const { canvas, ctx } = made;

  // 约定：一个贴图 tile 覆盖约 2m 进深，由此推每 tile 的板数与板高（px）。
  // 精确物理尺寸不重要（视觉贴图），只要板细长、数量合理即可。
  const tileMeters = 2.0;
  const planksPerTile = Math.max(1, Math.round(tileMeters / plankWidth));
  const plankHeightPx = resolution / planksPerTile;

  // 固定 seed → 同一贴图可复现；用于每块板的横向纹理相位偏移，避免板间纹理对齐
  const rnd = mulberry32(seed);
  const plankOffset: number[] = [];
  for (let p = 0; p < planksPerTile; p++) plankOffset.push(rnd());

  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  for (let py = 0; py < resolution; py++) {
    const plank = Math.min(planksPerTile - 1, Math.floor(py / plankHeightPx));
    const v = (py - plank * plankHeightPx) / plankHeightPx; // 跨板宽 0..1
    const uOff = plankOffset[plank] ?? 0;
    for (let px = 0; px < resolution; px++) {
      const u = fract(px / resolution + uOff); // 沿板长 0..1（带板相位偏移）
      const { r, g, b } = woodFloorColor(u, v, plank, baseColor);
      const i = (py * resolution + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = SRGBColorSpace; // 颜色贴图必须 SRGB
  tex.anisotropy = 4;
  return tex;
}

/**
 * 生成墙面法线 CanvasTexture（线性 NoColorSpace，RepeatWrapping）。
 * canvas 不可用时返回 null。
 */
export function makeWallNormalTexture(resolution = 256): CanvasTexture | null {
  const made = create2D(resolution);
  if (!made) return null;
  const { canvas, ctx } = made;

  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  for (let py = 0; py < resolution; py++) {
    for (let px = 0; px < resolution; px++) {
      const { r, g, b } = wallNormalColor(px, py);
      const i = (py * resolution + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace; // 法线贴图是数据贴图，用线性空间
  tex.anisotropy = 4;
  return tex;
}

/**
 * 生成布料颜色 CanvasTexture（细密织物噪声，SRGB）。供家具布艺使用。
 * canvas 不可用时返回 null。
 */
export function makeFabricTexture(baseColor: number, resolution = 256): CanvasTexture | null {
  const made = create2D(resolution);
  if (!made) return null;
  const { canvas, ctx } = made;

  const base = hexToRgb(baseColor);
  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  for (let py = 0; py < resolution; py++) {
    for (let px = 0; px < resolution; px++) {
      // 织物经纬纹：两组正交高频正弦 + 轻微 hash 扰动，幅度 ±5%
      const weave =
        Math.sin(px * 1.9) * 0.5 + Math.sin(py * 1.9) * 0.5 + (fract(Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) - 0.5);
      const shade = 1 + weave * 0.05;
      const i = (py * resolution + px) * 4;
      data[i] = clamp255(base.r * shade);
      data[i + 1] = clamp255(base.g * shade);
      data[i + 2] = clamp255(base.b * shade);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
