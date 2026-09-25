/**
 * 基础家具上下文测试（P4）
 *
 * 覆盖：
 *  - 10 种类型全覆盖构造返回非空 group
 *  - 所有子 mesh castShadow === true 且 receiveShadow === true
 *    （遮挡上下文红线：否则光穿模、照度场失真，必须断言）
 *  - 家具 group 整体位置 / 朝向与 zone.pos / zone.rotY 一致
 *  - 家具落在区范围内（局部坐标不超出 size/2）
 */

import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import type { BoxGeometry, Group } from 'three';

import { ACTIVITY_ZONE_TYPES } from '../../core/types.js';
import { makeZone } from '../../core/zoneTypes.js';
import { buildFurniture } from '../furniture.js';

/** 收集 group 内所有 Mesh 子节点 */
function meshesOf(group: Group): Mesh[] {
  const meshes: Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o as Mesh);
  });
  return meshes;
}

describe('buildFurniture — 基础家具上下文', () => {
  it('10 种类型全覆盖：构造不抛错，返回非空 group', () => {
    for (const type of ACTIVITY_ZONE_TYPES) {
      const zone = makeZone(type, [0, 0]);
      const group = buildFurniture(zone);
      expect(group.children.length).toBeGreaterThan(0);
      expect(meshesOf(group).length).toBeGreaterThan(0);
    }
  });

  it('所有子 mesh castShadow === true 且 receiveShadow === true（遮挡红线）', () => {
    for (const type of ACTIVITY_ZONE_TYPES) {
      const group = buildFurniture(makeZone(type, [0, 0]));
      for (const mesh of meshesOf(group)) {
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
      }
    }
  });

  it('家具 group 位置与 zone.pos 一致（y 恒为 0）', () => {
    const zone = makeZone('lounge', [-1.2, 0.8]);
    const group = buildFurniture(zone);
    expect(group.position.x).toBeCloseTo(-1.2);
    expect(group.position.y).toBe(0);
    expect(group.position.z).toBeCloseTo(0.8);
  });

  it('家具 group 朝向与 zone.rotY 一致（区旋转 → 家具整体旋转）', () => {
    const zone = makeZone('sleep', [0, 0], { rotY: Math.PI / 2 });
    const group = buildFurniture(zone);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('家具落在区范围内：子 mesh 局部 x/z 不超出 size/2（留半个身位裕量）', () => {
    for (const type of ACTIVITY_ZONE_TYPES) {
      const zone = makeZone(type, [0, 0]);
      const [w, d] = zone.size;
      const group = buildFurniture(zone);
      for (const mesh of meshesOf(group)) {
        const geo = mesh.geometry as BoxGeometry;
        const halfW = geo.parameters.width / 2;
        const halfD = geo.parameters.depth / 2;
        expect(Math.abs(mesh.position.x) + halfW).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(Math.abs(mesh.position.z) + halfD).toBeLessThanOrEqual(d / 2 + 1e-6);
      }
    }
  });
});
