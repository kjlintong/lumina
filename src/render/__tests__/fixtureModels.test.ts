/**
 * P30 · fixtureModels 独立几何测试
 *
 * 8 类灯具（downlight/spot/pendant/linear/cove/sconce/floor/table）每类
 * 断言：
 *   1) buildFixtureModel 返回 group + shade Mesh + type；
 *   2) group.children.length ≥ 2（外壳 + 灯罩至少 2 个 mesh）；
 *   3) shade 是 Mesh 且 material.emissive 存在（供 sceneEngine 选中高亮）；
 *   4) 各类型至少一个独特几何特征（TorusGeometry / SphereGeometry / 3+ children 等）。
 */

import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';

import { makeFixture } from '../../core/makeFixture.js';
import { buildFixtureModel } from '../fixtureModels.js';

const TYPES = [
  'downlight',
  'spot',
  'pendant',
  'linear',
  'cove',
  'sconce',
  'floor',
  'table',
] as const;

describe('buildFixtureModel (P30) — 每类灯具基本结构', () => {
  for (const type of TYPES) {
    it(`${type}: 返回 group + shade Mesh + type；group 至少 2 个 children`, () => {
      const f = makeFixture({ type });
      const { group, shade, type: returnedType } = buildFixtureModel(f);
      expect(returnedType).toBe(type);
      expect(group).toBeInstanceOf(Group);
      expect(group.children.length).toBeGreaterThanOrEqual(2);
      expect(shade).toBeInstanceOf(Mesh);
      // shade 必须在 group 内
      expect(group.children.includes(shade)).toBe(true);
    });
  }
});

describe('独立几何特征（P30）', () => {
  /** Group 的 children 是 Object3D 联合类型；这里统一 cast 成 Mesh 用于访问 geometry。 */
  function geomTypes(group: Group): string[] {
    return group.children
      .filter((c): c is Mesh => (c as Mesh).geometry !== undefined)
      .map((c) => (c.geometry as { type?: string }).type ?? '');
  }

  it('downlight 含 TorusGeometry（天花板嵌入圆环 trim）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'downlight' }));
    expect(geomTypes(group).includes('TorusGeometry')).toBe(true);
  });

  it('spot 含 TorusGeometry（嵌入圆环）+ 锥罩 CylinderGeometry（top/bottom 半径不等）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'spot' }));
    const types = geomTypes(group);
    expect(types.includes('TorusGeometry')).toBe(true);
    const hasTaperedCyl = group.children.some((c) => {
      const cyl = c as Mesh;
      if (!cyl.geometry) return false;
      const g = cyl.geometry as { type?: string; parameters?: { radiusTop: number; radiusBottom: number } };
      return g.type === 'CylinderGeometry' && g.parameters && g.parameters.radiusTop !== g.parameters.radiusBottom;
    });
    expect(hasTaperedCyl).toBe(true);
  });

  it('pendant 含 SphereGeometry（球形灯罩）+ 细长吊线（CylinderGeometry height/radius 比 >20）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'pendant' }));
    const types = geomTypes(group);
    expect(types.includes('SphereGeometry')).toBe(true);
    const hasLongWire = group.children.some((c) => {
      const m = c as Mesh;
      if (!m.geometry) return false;
      const g = m.geometry as { type?: string; parameters?: { radiusTop: number; height: number } };
      return (
        g.type === 'CylinderGeometry' &&
        g.parameters &&
        g.parameters.height / g.parameters.radiusTop > 20
      );
    });
    expect(hasLongWire).toBe(true);
  });

  it('linear 至少 4 个 children（灯管 + 发光面 + 两端端盖）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'linear' }));
    expect(group.children.length).toBeGreaterThanOrEqual(4);
  });

  it('cove 含两个 BoxGeometry（外壳槽 + 发光条）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'cove' }));
    const boxCount = geomTypes(group).filter((t) => t === 'BoxGeometry').length;
    expect(boxCount).toBeGreaterThanOrEqual(2);
  });

  it('sconce 至少 2 个 children（背板 + 半圆柱灯罩）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'sconce' }));
    expect(group.children.length).toBeGreaterThanOrEqual(2);
  });

  it('floor 至少 3 个 children（底座 + 杆 + 顶部球罩）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'floor' }));
    expect(group.children.length).toBeGreaterThanOrEqual(3);
    expect(geomTypes(group).includes('SphereGeometry')).toBe(true);
  });

  it('table 至少 3 个 children（底座 + 短杆 + 圆筒灯罩）', () => {
    const { group } = buildFixtureModel(makeFixture({ type: 'table' }));
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });
});

describe('shade material（P30）— 供 sceneEngine 选中高亮', () => {
  it('每类灯具 shade.material.emissive 存在且为 MeshStandardMaterial', () => {
    for (const type of TYPES) {
      const { shade } = buildFixtureModel(makeFixture({ type }));
      const mat = shade.material as MeshStandardMaterial;
      expect(mat.isMeshStandardMaterial, `type=${type}`).toBe(true);
      expect(mat.emissive, `type=${type}`).toBeDefined();
    }
  });

  it('makeGlowMaterial 初始 emissiveIntensity=0，由 sceneEngine/lightBuilder 后续设置', () => {
    for (const type of TYPES) {
      const { shade } = buildFixtureModel(makeFixture({ type }));
      const mat = shade.material as MeshStandardMaterial;
      expect(mat.emissiveIntensity, `type=${type}`).toBe(0);
    }
  });

  it('所有 shade Mesh 都 castShadow = false（由 buildLightFromFixture 负责设置，此处验证默认不投）', () => {
    // 直接调 buildFixtureModel 时，castShadow 保持默认 false（Three.js Mesh 默认）。
    // 这是"未污染"检查——防止后续有人在这里硬编码 castShadow=true。
    for (const type of TYPES) {
      const { shade } = buildFixtureModel(makeFixture({ type }));
      expect(shade.castShadow, `type=${type}`).toBe(false);
      expect(shade.receiveShadow, `type=${type}`).toBe(false);
    }
  });
});

describe('buildFixtureModel 兜底（P30）', () => {
  it('未识别类型回落 pendant（避免 shade=undefined）', () => {
    const f = makeFixture({ type: 'downlight' }) as Parameters<typeof buildFixtureModel>[0];
    // 造一个"未知"类型：TS 会警告，但 runtime 走 default
    const unknown = { ...f, type: 'unknown-type' as never };
    const { group, shade, type: returnedType } = buildFixtureModel(unknown);
    expect(returnedType).toBe('pendant');
    expect(group).toBeInstanceOf(Group);
    expect(shade).toBeInstanceOf(Mesh);
  });
});
