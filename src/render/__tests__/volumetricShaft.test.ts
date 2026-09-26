import { describe, expect, it } from 'vitest';
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';

import { buildLightShaft, shaftGradientAlpha } from '../volumetricShaft.js';

describe('shaftGradientAlpha — 纯函数渐隐曲线', () => {
  it('端点：地板端 t=0 → alpha=0，窗端 t=1 → alpha=1', () => {
    expect(shaftGradientAlpha(0)).toBe(0);
    expect(shaftGradientAlpha(1)).toBe(1);
  });

  it('单调递增（窗端更不透明）', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const a = shaftGradientAlpha(i / 20);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('始终落在 [0, 1]', () => {
    for (const t of [-5, -1, 0, 0.2, 0.5, 0.8, 1, 1.01, 3]) {
      const a = shaftGradientAlpha(t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('是平方曲线（凹形）：midpoint 低于线性中值 0.5', () => {
    // t=0.5 时平方 = 0.25，明显低于线性 0.5 → 靠近地板端衰减更快
    expect(shaftGradientAlpha(0.5)).toBeLessThan(0.5);
  });

  it('越界输入被 clamp，不产生 NaN', () => {
    expect(Number.isFinite(shaftGradientAlpha(-Infinity))).toBe(true);
    expect(Number.isFinite(shaftGradientAlpha(Infinity))).toBe(true);
  });
});

describe('buildLightShaft — 几何与材质', () => {
  it('返回 Mesh，材质为 MeshBasicMaterial', () => {
    const m = buildLightShaft(new Vector3(0, 2, -2), new Vector3(0, 0, 0));
    expect(m).toBeInstanceOf(Mesh);
    expect(m.material).toBeInstanceOf(MeshBasicMaterial);
  });

  it('材质关键属性：AdditiveBlending / depthWrite=false / transparent / DoubleSide / toneMapped', () => {
    const mat = (buildLightShaft(new Vector3(0, 2, -2), new Vector3(0, 0, 0)).material) as MeshBasicMaterial;
    expect(mat.blending).toBe(AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.side).toBe(DoubleSide);
    // toneMapped=true 让它能被 bloom 抓到，形成「发亮的光柱」
    expect(mat.toneMapped).toBe(true);
  });

  it('不参与阴影（光柱是氛围层，不该投出暗影）', () => {
    const m = buildLightShaft(new Vector3(0, 2, -2), new Vector3(0, 0, 0));
    expect(m.castShadow).toBe(false);
    expect(m.receiveShadow).toBe(false);
  });

  it('位置在两端中点，长度等于两端距离', () => {
    const win = new Vector3(0, 2, -2.25);
    const floor = new Vector3(0, 0, 0);
    const m = buildLightShaft(win, floor);
    // 中点
    expect(m.position.x).toBeCloseTo(0, 5);
    expect(m.position.y).toBeCloseTo(1, 5);
    expect(m.position.z).toBeCloseTo(-1.125, 5);
    // 长轴长度 = 两点距离
    expect(m.geometry).toBeInstanceOf(PlaneGeometry);
    const len = Math.hypot(win.x - floor.x, win.y - floor.y, win.z - floor.z);
    const ySize = (m.geometry as PlaneGeometry).parameters.height;
    expect(ySize).toBeCloseTo(len, 4);
  });

  it('settings 覆盖生效（color / opacity / width）', () => {
    const m = buildLightShaft(new Vector3(0, 2, -2), new Vector3(0, 0, 0), {
      color: 0x123456,
      opacity: 0.3,
      width: 2.5,
    });
    const mat = m.material as MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x123456);
    expect(mat.opacity).toBe(0.3);
    expect((m.geometry as PlaneGeometry).parameters.width).toBe(2.5);
  });

  it('退化：两端重合时不抛错、不产生 NaN（回退竖直向上、单位长度）', () => {
    const v = new Vector3(1, 1.5, -1);
    const m = buildLightShaft(v, v.clone());
    expect(m).toBeInstanceOf(Mesh);
    // 定位无 NaN
    expect(Number.isFinite(m.position.x)).toBe(true);
    expect(Number.isFinite(m.position.y)).toBe(true);
    expect(Number.isFinite(m.position.z)).toBe(true);
    // 长度回退为 1
    expect((m.geometry as PlaneGeometry).parameters.height).toBeCloseTo(1, 5);
  });

  it('默认 opacity 落在 0.10~0.20 区间', () => {
    const mat = (buildLightShaft(new Vector3(0, 2, -2), new Vector3(0, 0, 0)).material) as MeshBasicMaterial;
    expect(mat.opacity).toBeGreaterThanOrEqual(0.1);
    expect(mat.opacity).toBeLessThanOrEqual(0.2);
  });
});
