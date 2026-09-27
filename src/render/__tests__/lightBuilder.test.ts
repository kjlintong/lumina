import { describe, expect, it } from 'vitest';
import { PointLight, RectAreaLight, SpotLight } from 'three';

import { buildLightFromFixture, cctToRGB, fixtureCastsShadow } from '../lightBuilder.js';
import { makeFixture } from '../../core/makeFixture.js';

describe('cctToRGB — 色温 → sRGB（Tanner Helland 近似）', () => {
  it('cctToRGB(1000)：r=1，b=0（极暖，几乎无蓝分量）', () => {
    const { r, b } = cctToRGB(1000);
    expect(r).toBe(1);
    expect(b).toBe(0);
  });

  it('cctToRGB(6600)：r=1，g 接近 1（中性白）', () => {
    const { r, g } = cctToRGB(6600);
    expect(r).toBe(1);
    expect(g).toBeCloseTo(1, 1);
  });

  it('cctToRGB(40000)：b=1（极冷/蓝）', () => {
    const { b } = cctToRGB(40000);
    expect(b).toBe(1);
  });

  it('所有输出分量都在 [0, 1] 区间', () => {
    for (const k of [1000, 1800, 2700, 4000, 5600, 6600, 8000, 12000, 25000, 40000]) {
      const { r, g, b } = cctToRGB(k);
      for (const v of [r, g, b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('buildLightFromFixture — Fixture → Three.js 光源', () => {
  it("type='downlight' → SpotLight", () => {
    const { light } = buildLightFromFixture(makeFixture({ type: 'downlight' }));
    expect(light).toBeInstanceOf(SpotLight);
  });

  it("type='pendant' → PointLight", () => {
    const { light } = buildLightFromFixture(makeFixture({ type: 'pendant' }));
    expect(light).toBeInstanceOf(PointLight);
  });

  it("type='linear' → RectAreaLight", () => {
    const { light } = buildLightFromFixture(makeFixture({ type: 'linear' }));
    expect(light).toBeInstanceOf(RectAreaLight);
  });

  it('无 IES 声明 → isIES=false，approximated=false', () => {
    const { isIES, approximated } = buildLightFromFixture(makeFixture({ type: 'downlight' }));
    expect(isIES).toBe(false);
    expect(approximated).toBe(false);
  });

  it('声明 IES → isIES=true，approximated=true（本阶段不解析真实配光，UI 必须标注近似）', () => {
    const { isIES, approximated } = buildLightFromFixture(
      makeFixture({ type: 'downlight', ies: 'ies/test.ies' }),
    );
    expect(isIES).toBe(true);
    expect(approximated).toBe(true);
  });

  it('创建灯罩 Mesh（group 至少含光源 + 灯罩两个子节点）', () => {
    const { object } = buildLightFromFixture(makeFixture({ type: 'pendant' }));
    expect(object.children.length).toBeGreaterThanOrEqual(2);
  });

  it('光色来自 CCT 转换（归一化分量），不是把开尔文当 hex', () => {
    const kelvin = 2700;
    const { light } = buildLightFromFixture(makeFixture({ type: 'pendant', cct: kelvin }));
    expect(light).toBeInstanceOf(PointLight);
    const point = light as PointLight;
    const expected = cctToRGB(kelvin);
    expect(point.color.r).toBeCloseTo(expected.r, 5);
    expect(point.color.g).toBeCloseTo(expected.g, 5);
    expect(point.color.b).toBeCloseTo(expected.b, 5);
    // 2700K 暖光：r 满量程、b 明显偏低；若误用原始开尔文值分量会远超 1
    expect(point.color.r).toBe(1);
    expect(point.color.b).toBeLessThan(0.5);
  });
});

describe('fixtureCastsShadow (P17)', () => {
  it('所有 PointLight 类型都不投阴影（P9 预算，P17 确认）', () => {
    // P9 已把 PointLight 全关掉（立方体贴图 6 面/盏成本高、视觉收益低）。
    // P17 显式化：`SHADOW_CASTING_FIXTURE_TYPES` 为空集合，本函数对所有
    // PointLight 类型恒 false。包括 RectAreaLight 类型（linear / cove，
    // 引擎本身也不支持阴影）和未识别类型。
    for (const t of ['pendant', 'sconce', 'floor', 'table', 'linear', 'cove', 'unknown']) {
      expect(fixtureCastsShadow(t)).toBe(false);
    }
  });

  it('downlight/spot 不由 fixtureCastsShadow 决定（走 SpotLight 分支恒 true）', () => {
    // 明确记录：downlight/spot 不在 SHADOW_CASTING_FIXTURE_TYPES 集合内
    // （P17 已从集合中删除，避免误导读者以为它们依赖此函数）。
    // 它们的 castShadow 由 buildLightFromFixture 的 SpotLight 分支硬编码
    // 为 true，与 fixtureCastsShadow 完全无关。
    expect(fixtureCastsShadow('downlight')).toBe(false);
    expect(fixtureCastsShadow('spot')).toBe(false);
  });
});
