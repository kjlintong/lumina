/**
 * 窗外城市天际线（P8e 室外层）
 *
 * 对标参考 2「日落收藏家」的窗外景观：低多边形风格的水岸城市——高低错落的
 * 米色/沙色楼群 + 水面 + 吊桥。替换 P8a 里三块扁平米的剪影色块（那几个 plane
 * 只是「有东西」的占位，没有任何城市形态）。
 *
 * 架构（与 materials.ts / plants.ts 同一思路）：布局数学抽成纯函数，工厂
 * 函数只是「纯函数求值 + 造 mesh」的薄壳。单测只测纯函数。
 *
 * 与天空背板的关系：本模块**只盖住地平线以上的城市形态**。天空的昼夜渐变仍由
 * sky.ts 的 `setSkyBackdropColors` 每帧驱动；建筑是静态 MeshBasicMaterial
 * 剪影，不受访光影响、始终可见（与 SILHOUETTES 一致）。所以「日落→夜晚」
 * 时建筑不会跟着变暗——但窗内光/家具会变，整体氛围仍在变。这是「剪影远景」
 * 的固有取舍：要让建筑也变，需要把它们接到 updateSunPosition 里改 material
 * 颜色，成本更高，留作后续。
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import type { Vector3 } from 'three';
import { mulberry32 } from './materials.js';

/** 默认建筑数量（沿横向铺开） */
export const BUILDING_COUNT = 14;

export interface SkylineOptions {
  /** 建筑总数（默认 14） */
  buildingCount?: number;
  /** 种子：决定楼群的高低错落与配色，同 seed 产出同一城市，便于确定性渲染 */
  seed?: number;
}

/** 单栋楼的布局描述 */
export interface BuildingLayout {
  /** 横向位置（米） */
  x: number;
  /** 楼宽（米） */
  w: number;
  /** 楼深（米） */
  d: number;
  /** 楼高（米） */
  h: number;
  /** 立面色 */
  color: number;
  /** 楼前窗灯排数 */
  windowRows: number;
}

/** 低多边形建筑配色板：日落暖光下的米色 / 沙色 / 浅褐 / 暖灰 */
export const BUILDING_COLORS: number[] = [
  0x8a7a6a, // 暖灰褐
  0xa8967c, // 沙色
  0x7a6856, // 浅褐
  0x9a8870, // 米黄褐
  0x6a5c4e, // 深暖灰
  0xb8a890, // 浅米色
];

/** 水面基色（日落时的暖色反光） */
export const WATER_COLOR = 0x2a3a4a;

/**
 * 生成第 i 栋楼的布局。纯函数，单测目标。
 *
 * 用 mulberry32 把楼群摊开：每栋楼取一个横向位置、随机宽度/高度，
 * 颜色在 BUILDING_COLORS 里确定性选取。横向位置用 i / n 均分再加小幅抖动，
 * 避免楼群全部堆在一侧。
 */
export function buildingLayout(i: number, total: number, seed: number): BuildingLayout {
  const rnd = mulberry32(seed * 104729 + i * 2654435761);
  const t = total <= 1 ? 0 : i / (total - 1);
  // 横向铺满 [-8, 8]，两端留 0.4 余量避免贴边
  const spread = 16;
  const x = -spread / 2 + spread * (0.05 + t * 0.9) + (rnd() - 0.5) * 0.8;
  const w = 0.9 + rnd() * 1.4; // 0.9..2.3
  const d = 0.9 + rnd() * 1.2; // 0.9..2.1
  // 高度：两端稍矮、中间高的抛物线 + 抖动，避免整齐划一
  const arch = Math.sin(Math.PI * t); // 0..1..0
  const h = 2.2 + rnd() * 4.6 + arch * 2.0; // 2.2..8.8
  const color = BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)] ?? 0x8a7a6a;
  const windowRows = Math.max(2, Math.round(h / 0.55));
  return { x, w, d, h, color, windowRows };
}

/** 吊桥塔高（米） */
export const BRIDGE_TOWER_H = 3.0;
/** 吊桥跨径（米） */
export const BRIDGE_SPAN = 7.0;

/** 水面深度参数：返回 [width, height, depth] */
export function waterDims(): readonly [number, number, number] {
  return [40, 6, 14];
}

/**
 * 在窗外构建城市天际线 group。
 *
 * group 平移到 `windowWorldPos`（窗中心），**无旋转**（局部系 = 世界系偏移），
 * 与 buildSkyScene 一致。所有物体沿 `windowNormal` 外推放置。
 *
 * 全部 Mesh 不参与阴影（castShadow = receiveShadow = false），
 * MeshBasicMaterial 不受光照影响，始终可见。
 *
 * @param windowWorldPos 窗中心世界坐标
 * @param windowNormal 窗外法线（单位向量，指向室外）
 */
export function buildSkyline(
  windowWorldPos: Vector3,
  windowNormal: Vector3,
  opts: SkylineOptions = {},
): Group {
  const group = new Group();
  group.name = 'skyline';
  group.position.copy(windowWorldPos);
  const seed = opts.seed ?? 13;
  const n = opts.buildingCount ?? BUILDING_COUNT;

  // 楼群：排在窗外 22..34m，远于 P8a 剪影（12..28m）以免重叠
  const depthRange = { min: 22, max: 34 };
  for (let i = 0; i < n; i++) {
    const L = buildingLayout(i, n, seed);
    const depth = depthRange.min + (n <= 1 ? 0 : (i / (n - 1)) * (depthRange.max - depthRange.min));
    const b = new Mesh(new BoxGeometry(L.w, L.h, L.d), new MeshBasicMaterial({ color: L.color }));
    b.castShadow = false;
    b.receiveShadow = false;
    b.position.set(L.x, L.h / 2, windowNormal.z * depth);
    group.add(b);
  }

  // 水面：楼群前的一条横向水面，承载「倒影」观感（低多边形风不做真反射，
  // 用一块暖色半透明平面近似）
  const [ww, , wd] = waterDims();
  const water = new Mesh(
    new PlaneGeometry(ww, wd),
    new MeshBasicMaterial({ color: WATER_COLOR, transparent: true, opacity: 0.85 }),
  );
  water.castShadow = false;
  water.receiveShadow = false;
  // 水平面：PlaneGeometry 默认 XY，绕 X 轴 -90° 变水平
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.02, windowNormal.z * 18);
  group.add(water);

  // 吊桥：两座塔 + 一跨主缆（简化为两根细 BoxGeometry 当桥面 + 两根塔）
  const towerMat = new MeshBasicMaterial({ color: 0x5a4a3a });
  const deckMat = new MeshBasicMaterial({ color: 0x4a3a2c });
  for (const tx of [-BRIDGE_SPAN / 2, BRIDGE_SPAN / 2]) {
    const tower = new Mesh(new CylinderGeometry(0.08, 0.12, BRIDGE_TOWER_H, 6), towerMat);
    tower.castShadow = false;
    tower.receiveShadow = false;
    tower.position.set(tx, BRIDGE_TOWER_H / 2, windowNormal.z * 14);
    group.add(tower);
  }
  const deck = new Mesh(new BoxGeometry(BRIDGE_SPAN + 0.4, 0.1, 0.4), deckMat);
  deck.castShadow = false;
  deck.receiveShadow = false;
  deck.position.set(0, 0.25, windowNormal.z * 14);
  group.add(deck);

  return group;
}
