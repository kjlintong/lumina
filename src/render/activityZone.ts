/**
 * 活动区可视化（P4 渲染层）
 *
 * 需求侧实体必须在 3D 里可见，否则用户增删改活动区、调 planeH/size/rotY
 * 都看不出效果（方案 §4.5.5「避免白盒子」）。
 *
 * 每个 ActivityZone 渲染为：
 *  - 半透明工作面包：PlaneGeometry 位于 y = zone.planeH（工作面高度是需求侧
 *    的核心物理量，必须可视化，不能只画贴地平面）
 *  - 边框线：EdgesGeometry + LineSegments，按 zone.type 取 HSL 区分色
 *  - 选中态：边框更亮、填充略浓，与 ZonePanel 选中态呼应
 *
 * 渲染口径：
 *  - 这是**可视化辅助**，不是物理表面：castShadow / receiveShadow 均为 false，
 *    不参与光照与遮挡（家具才承担遮挡上下文，见 furniture.ts）。
 *  - depthWrite = false：半透明叠加面不写深度，避免遮挡排序伪影。
 *  - 不参与选灯 raycasting：group 名带 `zoneviz:` 前缀，App 的 findFixtureId
 *    只匹配 fixtures 表里的灯具 id，命中本 group 时会继续向后找。
 */

import {
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { ACTIVITY_ZONE_TYPES } from '../core/types.js';
import type { ActivityZone } from '../core/types.js';

/** 类型区分色：按类型在类型库中的索引取 HSL 色相（自定义类型落到最后一个槽位） */
function typeHue(type: string): number {
  const slots = ACTIVITY_ZONE_TYPES.length + 1;
  const idx = (ACTIVITY_ZONE_TYPES as readonly string[]).indexOf(type);
  return (idx >= 0 ? idx : ACTIVITY_ZONE_TYPES.length) / slots;
}

/**
 * 构建单个活动区的可视化 Group。
 *
 * group 自身携带 zone.pos（y=0）与 zone.rotY；子 mesh 用局部坐标。
 * size 反映在 PlaneGeometry 的宽高上，planeH 反映在子 mesh 的 y 上。
 */
export function buildActivityZone(zone: ActivityZone, selected: boolean): Group {
  const group = new Group();
  group.name = `zoneviz:${zone.key}`;
  group.position.set(zone.pos[0], 0, zone.pos[1]);
  group.rotation.y = zone.rotY;

  const [w, d] = zone.size;
  const hue = typeHue(zone.type);
  const fillColor = new Color().setHSL(hue, 0.55, 0.5);
  // 选中态：更高饱和度 + 更高明度，与未选中明显区分（测试断言两者不同）
  const borderColor = selected
    ? new Color().setHSL(hue, 1.0, 0.85)
    : new Color().setHSL(hue, 0.7, 0.55);

  // 半透明工作面包（水平面，法线朝上）
  const planeGeo = new PlaneGeometry(w, d);
  const fill = new Mesh(
    planeGeo,
    new MeshStandardMaterial({
      color: fillColor,
      transparent: true,
      opacity: selected ? 0.22 : 0.15,
      roughness: 1.0,
      metalness: 0.0,
      depthWrite: false,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = zone.planeH;
  // 可视化辅助不是物理表面：不投影、不接收阴影
  fill.castShadow = false;
  fill.receiveShadow = false;
  group.add(fill);

  // 边框线（与填充同平面）
  const edges = new LineSegments(
    new EdgesGeometry(planeGeo),
    new LineBasicMaterial({ color: borderColor }),
  );
  edges.rotation.x = -Math.PI / 2;
  edges.position.y = zone.planeH;
  group.add(edges);

  return group;
}
