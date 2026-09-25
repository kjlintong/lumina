/**
 * 活动区可视化测试（P4）
 *
 * 覆盖：
 *  - 10 种类型全覆盖构造不抛错
 *  - pos / rotY 反映到 group.position / group.rotation
 *  - size 反映到工作面 PlaneGeometry 尺寸
 *  - planeH 反映到工作面与边框的 y 高度
 *  - 选中态边框颜色与未选中不同
 */

import { describe, expect, it } from 'vitest';
import { LineSegments, Mesh } from 'three';
import type { Group, LineBasicMaterial, PlaneGeometry } from 'three';

import { ACTIVITY_ZONE_TYPES } from '../../core/types.js';
import { makeZone } from '../../core/zoneTypes.js';
import { buildActivityZone } from '../activityZone.js';

/** 取工作面填充 Mesh（group 内唯一的 Mesh 子节点） */
function planeOf(group: Group): Mesh {
  const mesh = group.children.find((c) => c instanceof Mesh);
  if (!mesh) throw new Error('工作面 Mesh 未找到');
  return mesh as Mesh;
}

/** 取边框 LineSegments（group 内唯一的 LineSegments 子节点） */
function borderOf(group: Group): LineSegments {
  const lines = group.children.find((c) => c instanceof LineSegments);
  if (!lines) throw new Error('边框 LineSegments 未找到');
  return lines as LineSegments;
}

function borderColorHex(group: Group): number {
  return (borderOf(group).material as LineBasicMaterial).color.getHex();
}

describe('buildActivityZone — 活动区可视化', () => {
  it('10 种类型全覆盖：构造不抛错，且都有工作面 + 边框', () => {
    for (const type of ACTIVITY_ZONE_TYPES) {
      const zone = makeZone(type, [0, 0]);
      const group = buildActivityZone(zone, false);
      expect(planeOf(group)).toBeInstanceOf(Mesh);
      expect(borderOf(group)).toBeInstanceOf(LineSegments);
    }
  });

  it('pos 反映到 group.position（x/z，y 恒为 0）', () => {
    const zone = makeZone('work', [1.5, -2.25]);
    const group = buildActivityZone(zone, false);
    expect(group.position.x).toBeCloseTo(1.5);
    expect(group.position.y).toBe(0);
    expect(group.position.z).toBeCloseTo(-2.25);
  });

  it('rotY 反映到 group.rotation.y', () => {
    const zone = makeZone('work', [0, 0], { rotY: Math.PI / 3 });
    const group = buildActivityZone(zone, false);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 3);
  });

  it('size 反映到工作面 PlaneGeometry 尺寸（宽×深）', () => {
    const zone = makeZone('dining', [0, 0], { size: [2.2, 1.1] });
    const group = buildActivityZone(zone, false);
    const geo = planeOf(group).geometry as PlaneGeometry;
    expect(geo.parameters.width).toBeCloseTo(2.2);
    expect(geo.parameters.height).toBeCloseTo(1.1);
  });

  it('planeH 反映到工作面与边框的 y（工作面高度必须可视化）', () => {
    const zone = makeZone('dining', [0, 0]); // 模板 planeH = 0.78
    const group = buildActivityZone(zone, false);
    expect(planeOf(group).position.y).toBeCloseTo(0.78);
    expect(borderOf(group).position.y).toBeCloseTo(0.78);
  });

  it('工作面半透明且不参与阴影（可视化辅助，非物理表面）', () => {
    const group = buildActivityZone(makeZone('lounge', [0, 0]), false);
    const mesh = planeOf(group);
    const mat = mesh.material as { transparent: boolean; opacity: number };
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeLessThan(0.5);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
  });

  it('选中态边框颜色与未选中不同', () => {
    const zone = makeZone('lounge', [0, 0]);
    const unselected = buildActivityZone(zone, false);
    const selected = buildActivityZone(zone, true);
    expect(borderColorHex(selected)).not.toBe(borderColorHex(unselected));
  });

  it('不同类型取不同边框色（类型区分色）', () => {
    const a = buildActivityZone(makeZone('sleep', [0, 0]), false);
    const b = buildActivityZone(makeZone('kitchen', [0, 0]), false);
    expect(borderColorHex(a)).not.toBe(borderColorHex(b));
  });
});
