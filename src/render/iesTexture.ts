/**
 * IES 配光纹理生成（P6）
 *
 * 从解析后的 IES 光强矩阵生成纹理，供光源使用。
 *
 * 两种纹理：
 * 1. createSpotlightPatternTexture — 256×256 圆形投影纹理，供 WebGL SpotLight.map
 *    用于在光锥内按 IES 分布调制光强。
 *    UV 中心 (0.5,0.5) = 光轴方向（0° 垂直角）
 *    UV 边缘 = 光锥边缘（90° 垂直角）
 *    UV 角度 = 水平角（0-360°）
 *
 * 2. createIESTexture — 180×1 DataTexture，供 WebGPU IESSpotLight.iesMap（P8）
 *    u 轴 = 垂直角（0-180°），v 轴 = 水平角（1 texel = 360°）
 *
 * 架构依据：工程方案 §5.2、ADR-18
 */

import { DataTexture, FloatType, RedFormat, LinearFilter } from 'three';
import type { IESData } from './iesParser.js';

// ---------------------------------------------------------------------------
// WebGL: 2D 圆形投影纹理（SpotLight.map）
// ---------------------------------------------------------------------------

/** 圆形纹理尺寸（texel 数） */
const SPOT_PATTERN_SIZE = 256;

/**
 * 从 IES 数据生成 2D 圆形投影纹理，供 WebGL SpotLight.map 使用。
 *
 * 算法：
 * - 对 256×256 纹理的每个 texel，计算其 UV 坐标
 * - 将 UV 转为极坐标（r, θ）
 * - r 映射到垂直角（0° = 光轴中心，90° = 光锥边缘）
 * - θ 映射到水平角（0°-360°）
 * - 查找 IES 光强矩阵，得到该方向的光强值
 * - 存入纹理的 R 通道
 *
 * @param data IES 解析数据
 * @returns DataTexture（256×256，RedFormat，FloatType）
 */
export function createSpotlightPatternTexture(data: IESData): DataTexture {
  const size = SPOT_PATTERN_SIZE;
  const texels = new Float32Array(size * size);

  // 归一化半径：UV 从中心到边缘的距离
  // SQRT1_2 = sqrt(0.5² + 0.5²)，即中心到四角的精确距离
  const maxR = Math.SQRT1_2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // UV 坐标，中心为 (0.5, 0.5)
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;

      // 极坐标
      const r = Math.sqrt(u * u + v * v);
      const theta = Math.atan2(v, u) * (180 / Math.PI);

      if (r > maxR) {
        // 超出光锥（四角区域），光强为 0
        texels[y * size + x] = 0;
        continue;
      }

      // 映射到角度
      const verAngle = (r / maxR) * 90; // 0-90°
      const horAngle = ((theta + 180) % 360 + 360) % 360; // 0-360°

      texels[y * size + x] = lookupCandela(data, horAngle, verAngle);
    }
  }

  const texture = new DataTexture(texels, size, size, RedFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 从 IES 数据查找给定方向的光强值。
 *
 * 支持对称（1 切面）、半对称（horAngles 到 180°，镜像扩展）和非对称（多切面插值）。
 *
 * @param data IES 解析数据
 * @param horAngle 水平角（0-360°）
 * @param verAngle 垂直角（0-180°）
 * @returns 光强值（cd）
 */
export function lookupCandela(data: IESData, horAngle: number, verAngle: number): number {
  const horAngles = data.horAngles;
  const numHor = data.numHorAngles;
  const numVer = data.numVerAngles;

  if (numHor === 0 || numVer === 0) return 0;

  // 对称配光（1 切面）
  if (numHor === 1) {
    return interpolateVer(data.candela[0], data.verAngles, verAngle);
  }

  // 确定对称范围
  const startTheta = horAngles[0] ?? 0;
  const endTheta = horAngles[numHor - 1] ?? 180;

  // 半对称/对称：超出范围时镜像
  let symTheta = horAngle;
  if (endTheta - startTheta !== 0 && (horAngle < startTheta || horAngle >= endTheta)) {
    symTheta = horAngle % (endTheta * 2);
    if (symTheta > endTheta) {
      symTheta = endTheta * 2 - symTheta;
    }
  }

  // 在水平切面间插值：找 symTheta 落在哪两个水平切面之间
  let hIdx = 0;
  let t = 0;
  for (let i = 0; i < numHor - 1; i++) {
    const h1 = horAngles[i] ?? 0;
    const h2 = horAngles[i + 1] ?? 0;
    if (symTheta < h2 || i === numHor - 2) {
      hIdx = i;
      t = h2 === h1 ? 0 : (symTheta - h1) / (h2 - h1);
      break;
    }
  }

  const v1 = interpolateVer(data.candela[hIdx], data.verAngles, verAngle);
  const v2 = interpolateVer(data.candela[hIdx + 1], data.verAngles, verAngle);

  return v1 + (v2 - v1) * Math.max(0, Math.min(1, t));
}

// ---------------------------------------------------------------------------
// WebGPU: 1D IES 纹理（IESSpotLight.iesMap，P8 使用）
// ---------------------------------------------------------------------------

/** 纹理宽度（texel 数），对应 180° 垂直角范围 */
export const IES_TEXEL_WIDTH = 180;

/** 纹理高度（texel 数），1 行 = 全 360° 水平角 */
export const IES_TEXEL_HEIGHT = 1;

/**
 * 生成 WebGPU IESSpotLight 用的 1D IES 纹理。
 *
 * @param data IES 解析数据
 * @returns DataTexture（180×1，RedFormat，FloatType）
 */
export function createIESTexture(data: IESData): DataTexture {
  const width = IES_TEXEL_WIDTH;
  const height = IES_TEXEL_HEIGHT;
  const texels = new Float32Array(width * height);

  const horAngles = data.horAngles;
  const startTheta = horAngles[0] ?? 0;
  const endTheta = horAngles[horAngles.length - 1] ?? 180;

  for (let i = 0; i < width; i++) {
    const theta = i * 180 / (width - 1);

    let symTheta = theta;
    if (endTheta - startTheta !== 0 && (theta < startTheta || theta >= endTheta)) {
      symTheta = theta % (endTheta * 2);
      if (symTheta > endTheta) {
        symTheta = endTheta * 2 - symTheta;
      }
    }

    // 对称配光：取第一个切面
    texels[i] = interpolateVer(data.candela[0], data.verAngles, symTheta);
  }

  const texture = new DataTexture(texels, width, height, RedFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 在单个水平切面的垂直角度数组中线性插值光强 */
function interpolateVer(row: number[] | undefined, verAngles: number[], angle: number): number {
  if (!row) return 0;
  const n = verAngles.length;
  if (n === 0) return 0;
  if (n === 1) return row[0] ?? 0;

  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (angle < (verAngles[i + 1] ?? 0) || i === n - 2) {
      idx = i;
      break;
    }
  }

  const v1 = verAngles[idx] ?? 0;
  const v2 = verAngles[idx + 1] ?? 0;
  const t = v2 === v1 ? 0 : (angle - v1) / (v2 - v1);

  return lerp(row[idx] ?? 0, row[idx + 1] ?? 0, t);
}

/** 线性插值 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
