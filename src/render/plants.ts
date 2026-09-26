/**
 * 室内绿植（P8d 装饰层）
 *
 * 参考项目「日落收藏家」的关键点缀之一：室内角落有绿植，把冷色室内家具
 * 与暖色夕照之间做出色彩对比、增加生活气息。本模块纯参数化几何（圆台花盆 +
 * 圆锥灌木层 + 球体树冠），**不用任何贴图**，所以也不受 jsdom 无 canvas 影响。
 *
 * 架构（与 materials.ts 同一思路）：布局数学抽成纯函数，工厂函数只是「纯函数
 * 求值 + 造 mesh」的薄壳。单测只测纯函数，jsdom 下可安全 import 而不崩。
 *
 * 遮挡上下文红线（ADR）：绿植同属「会挡光遮挡上下文」的实体，必须
 * castShadow = receiveShadow = true，否则与 furniture.ts 的家具规则不一致。
 */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { mulberry32 } from './materials.js';

/** 灌木层圆锥数量 */
export const FOLIAGE_CONES = 5;

export interface PlantOptions {
  /** 整体高度（默认 0.75m，盆栽观感） */
  heightScale?: number;
  /** 盆径（默认 0.34m） */
  potDiameter?: number;
  /** 盆高（默认 0.22m） */
  potHeight?: number;
  /** 盆色（默认陶土红 0x8a4a3a） */
  potColor?: number;
  /** 灌木主色（默认深绿 0x3a6b35） */
  foliageColor?: number;
  /** 种子：决定叶丛形状与每层色相偏移。同 seed 产出同一株，便于确定性渲染 */
  seed?: number;
  /** 世界坐标 x（默认 0） */
  x?: number;
  /** 世界坐标 z（默认 0） */
  z?: number;
}

/** 绿植尺寸：纯函数，单测目标 */
export function plantHeights(opts: PlantOptions = {}): { potHeight: number; foliageHeight: number } {
  const potHeight = opts.potHeight ?? 0.22;
  const foliageHeight = (opts.heightScale ?? 0.75) * 0.68;
  return { potHeight, foliageHeight };
}

/**
 * 第 i 层灌木圆锥的位置与半径。纯函数，单测目标。
 * i 从 0（最低、最粗）到 FOLIAGE_CONES-1（最高、最细）。
 *
 * 叠放模型：base[i] = potHeight + i·s、apex[i] = base[i] + coneH，两端对齐为
 * base[0] = potHeight（最底层底端贴住盆口）、apex[N-1] = potHeight +
 * foliageHeight（最顶层顶端到顶）。由 (N-1)·s = foliageHeight - coneH 且要
 * 相邻层重叠（step < coneH）解得 coneH = 1.5·foliageHeight/N、
 * s = (foliageHeight/N)·(1 - 1/1.5)，重叠 = coneH - s ≈ 0.33·coneH。
 *
 * y 为圆锥**中心**的 y 坐标（ConeGeometry 以中心为原点）。
 */
export function foliagePosition(
  i: number,
  potHeight: number,
  foliageHeight: number,
): { y: number; radius: number; height: number } {
  const N = FOLIAGE_CONES;
  const coneH = (foliageHeight / N) * 1.5;
  const s = (foliageHeight - coneH) / (N - 1);
  const y = potHeight + i * s + coneH / 2;
  const radius = coneH * 0.62 * (0.52 + ((N - 1 - i) / (N - 1)) * 0.48);
  return { y, radius, height: coneH };
}

/**
 * 木箱绿植：立方体木箱 + 一个叶丛球。比盆栽更粗粝、更像现代家居装饰。
 */
export function buildPlanter(
  opts: { x?: number; z?: number; boxSize?: number } = {},
): Group {
  const group = new Group();
  group.name = 'planter';
  const size = opts.boxSize ?? 0.5;

  const boxMat = new MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, metalness: 0.0 });
  const box = new Mesh(new BoxGeometry(size, size, size), boxMat);
  box.position.set(0, size / 2, 0);
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);

  const foliageMat = new MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.95, metalness: 0.0 });
  const crown = new Mesh(new ConeGeometry(size * 0.62, size * 1.05, 7), foliageMat);
  crown.position.set(0, size + size * 0.45, 0);
  crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(crown);

  group.position.set(opts.x ?? 0, 0, opts.z ?? 0);
  return group;
}

/**
 * 盆栽绿植（默认形态）。
 *
 * 返回的 group 已设置 position，直接 `scene.add()` 即可。
 * canvas 不参与，jsdom / WebGPU / WebGL2 均可用。
 */
export function buildPlant(opts: PlantOptions = {}): Group {
  const group = new Group();
  group.name = 'plant';
  const { potHeight, foliageHeight } = plantHeights(opts);
  const potDia = opts.potDiameter ?? 0.34;
  const seed = opts.seed ?? 7;

  // 陶土盆：上口略大、底口略小的圆台（truncated cone）
  const potMat = new MeshStandardMaterial({
    color: opts.potColor ?? 0x8a4a3a,
    roughness: 0.85,
    metalness: 0.0,
  });
  const pot = new Mesh(
    new CylinderGeometry(potDia * 0.5, potDia * 0.4, potHeight, 16),
    potMat,
  );
  pot.position.y = potHeight / 2;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  // 叶丛：5 层圆锥从粗到细叠加，每层颜色在 mulberry32(seed) 下确定偏移
  const base = opts.foliageColor ?? 0x3a6b35;
  for (let i = 0; i < FOLIAGE_CONES; i++) {
    const { y, radius, height } = foliagePosition(i, potHeight, foliageHeight);
    const rnd = mulberry32(seed * 101 + i * 17);
    const lightness = 1 - rnd() * 0.28; // 0.72..1.0 的明度抖动
    const foliageMat = new MeshStandardMaterial({
      color: new Color(base).multiplyScalar(lightness),
      roughness: 0.95,
      metalness: 0.0,
    });
    const cone = new Mesh(new ConeGeometry(radius, height, 7), foliageMat);
    cone.position.y = y;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }

  // group.position 由 PlantOptions.x/z 设置（缺省 0），父级再按需整体移动
  group.position.set(opts.x ?? 0, 0, opts.z ?? 0);
  return group;
}
