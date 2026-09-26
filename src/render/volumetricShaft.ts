/**
 * 假体积光锥（P8b 渲染层）
 *
 * 落日穿过落地窗，在空气中形成可见的光柱。不用屏幕空间 godrays shader
 * （P7 的 GodraysPass 保留为可选开关），改用一个从窗外射向地板的
 * 半透明渐变平面 + `AdditiveBlending`——在室内设计这个尺度和视角下足够
 * 以假乱真，且零 shader 风险、零深度精度问题（规格 P8b §交付物 3）。
 *
 * 实现要点（红线）：
 * - `MeshBasicMaterial`（**不是** ShaderMaterial）：暖橙 + `transparent` +
 *   `AdditiveBlending` + `depthWrite=false` + `side=DoubleSide` + `toneMapped=true`
 *   （让它能被 bloom 抓到，形成「发亮的光柱」）。
 * - **必须有 alpha 渐隐**：`material.map` 是一张沿长度方向「窗端不透明 →
 *   地板端透明」的 CanvasTexture。硬边光锥一眼就假。
 * - 渐变计算抽成纯函数 `shaftGradientAlpha`（jsdom 无 canvas，单测只测纯函数与
 *   几何属性，不碰贴图工厂）。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

/** 光柱参数 */
export interface ShaftSettings {
  /** 颜色（暖橙），默认 0xffc080 */
  color?: number;
  /** 基准不透明度（0.10~0.20），默认 0.15 */
  opacity?: number;
  /** 光柱宽度（米），默认 1.6 */
  width?: number;
}

/** 默认值集中一处 */
const DEFAULTS = {
  color: 0xffc080,
  opacity: 0.15,
  width: 1.6,
};

/** 数值截断到 [0, 1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 光柱沿长度方向的 alpha 渐隐曲线。纯函数、无 DOM。
 *
 * @param t 0 = 地板端（远端），1 = 窗端（近端 / 光源端）
 * @returns alpha 0..1：窗端接近 1（不透明），地板端渐隐到 0。
 *   用平方让渐变更「收」——靠近地板端衰减更快，避免光柱硬插进地板。
 */
export function shaftGradientAlpha(t: number): number {
  const x = clamp01(t);
  return x * x;
}

/**
 * 生成「窗端不透明 → 地板端透明」的纵向渐变 CanvasTexture。
 * 白色贴图（颜色交给 material.color），只编码 alpha。jsdom 返回 null。
 */
function makeShaftTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 4;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  // canvas 行 0 在顶部；PlaneGeometry 的 v=1 在顶部（+Y，将朝向窗端）。
  // 让 v=1（顶部/窗端）alpha=1，v=0（底部/地板端）alpha=0。
  for (let y = 0; y < h; y++) {
    const t = 1 - y / (h - 1); // y=0(顶) → t=1(窗端)；y=h-1(底) → t=0(地板端)
    const a = Math.round(shaftGradientAlpha(t) * 255);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(canvas);
}

// 复用临时向量（构建期一次，非每帧，但保持零多余分配的习惯）
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);

/**
 * 构建一道从窗外射向地板的假体积光柱。
 *
 * 几何：`PlaneGeometry(width, length)`，长轴（局部 +Y）对齐「地板端 → 窗端」
 * 方向，网格定位在两端中点。贴图沿长轴渐隐（窗端不透明、地板端透明）。
 *
 * 退化防御：两端重合时方向长度为 0，回退到竖直向下、长度 1，避免 NaN。
 *
 * @param windowCenter 窗中心世界坐标
 * @param floorTarget 光柱落在地板上的目标点
 */
export function buildLightShaft(
  windowCenter: Vector3,
  floorTarget: Vector3,
  settings: ShaftSettings = {},
): Mesh {
  const color = settings.color ?? DEFAULTS.color;
  const opacity = settings.opacity ?? DEFAULTS.opacity;
  const width = settings.width ?? DEFAULTS.width;

  // 方向：地板端 → 窗端（平面 +Y 将朝此方向，即贴图不透明的一端）
  _dir.subVectors(windowCenter, floorTarget);
  let length = _dir.length();
  if (length < 1e-4) {
    // 退化：两端重合。回退到竖直向上、单位长度，避免 normalize 出 NaN。
    _dir.set(0, 1, 0);
    length = 1;
  } else {
    _dir.divideScalar(length);
  }

  const geometry = new PlaneGeometry(width, length);
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: true,
  });
  const map = makeShaftTexture();
  if (map) material.map = map;

  const mesh = new Mesh(geometry, material);
  mesh.name = 'light-shaft';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // 定位到两端中点，并把局部 +Y 旋到「地板端→窗端」方向
  mesh.position.copy(windowCenter).add(floorTarget).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(_up, _dir);
  mesh.quaternion.copy(q);

  return mesh;
}
