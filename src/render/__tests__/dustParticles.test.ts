import { describe, expect, it } from 'vitest';
import { AdditiveBlending, Points, PointsMaterial } from 'three';

import { buildDustParticles, updateDustPoints } from '../dustParticles.js';

// jsdom 无 canvas：makeDustTexture 返回 null，材质不挂 map。
// 因此这里只断言材质属性与位置数学，不依赖贴图存在。

describe('buildDustParticles — 构建', () => {
  it('返回 Points，position 顶点数 = count', () => {
    const p = buildDustParticles({ count: 350 });
    expect(p).toBeInstanceOf(Points);
    const attr = p.geometry.getAttribute('position');
    expect(attr).toBeDefined();
    expect(attr.count).toBe(350);
  });

  it('默认 count 为 350', () => {
    const p = buildDustParticles();
    expect(p.geometry.getAttribute('position').count).toBe(350);
  });

  it('PointsMaterial 关键属性：AdditiveBlending / depthWrite=false / transparent / sizeAttenuation', () => {
    const mat = (buildDustParticles({ count: 10 }).material) as PointsMaterial;
    expect(mat).toBeInstanceOf(PointsMaterial);
    expect(mat.blending).toBe(AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.sizeAttenuation).toBe(true);
  });

  it('frustumCulled=false（体积小，关闭剔除避免漂移后闪烁）', () => {
    expect(buildDustParticles({ count: 10 }).frustumCulled).toBe(false);
  });

  it('同名 seed 两次构建产出**完全相同**的 position 数组（确定性）', () => {
    const a = buildDustParticles({ count: 60, seed: 7 });
    const b = buildDustParticles({ count: 60, seed: 7 });
    const pa = a.geometry.getAttribute('position').array as Float32Array;
    const pb = b.geometry.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    for (let i = 0; i < pa.length; i++) expect(pa[i]).toBe(pb[i]);
  });

  it('不同 seed 产出**不同**分布', () => {
    const a = buildDustParticles({ count: 60, seed: 7 });
    const b = buildDustParticles({ count: 60, seed: 99 });
    const pa = a.geometry.getAttribute('position').array as Float32Array;
    const pb = b.geometry.getAttribute('position').array as Float32Array;
    let same = true;
    for (const [i, a] of Array.from(pa).entries()) if (a !== pb[i]) { same = false; break; }
    expect(same).toBe(false);
  });
});

describe('buildDustParticles — 分布边界', () => {
  it('所有粒子落在 volumeSize 体积内（x∈±w/2, y∈±h/2, z∈±d/2）', () => {
    const vol: [number, number, number] = [5, 2.2, 3.5];
    const p = buildDustParticles({ count: 500, volumeSize: vol });
    const attr = p.geometry.getAttribute('position');
    const arr = attr.array as Float32Array;
    const hx = vol[0] / 2, hy = vol[1] / 2, hz = vol[2] / 2;
    for (let i = 0; i < arr.length; i += 3) {
      expect(arr[i]!).toBeGreaterThanOrEqual(-hx);
      expect(arr[i]!).toBeLessThanOrEqual(hx);
      expect(arr[i + 1]!).toBeGreaterThanOrEqual(-hy);
      expect(arr[i + 1]!).toBeLessThanOrEqual(hy);
      expect(arr[i + 2]!).toBeGreaterThanOrEqual(-hz);
      expect(arr[i + 2]!).toBeLessThanOrEqual(hz);
    }
  });
});

describe('updateDustPoints — 漂移', () => {
  it('更新后所有坐标仍为有限数（无 NaN / Infinity）', () => {
    const p = buildDustParticles({ count: 200 });
    updateDustPoints(p, 1 / 60, 5);
    const arr = p.geometry.getAttribute('position').array as Float32Array;
    for (const v of arr) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('多帧累积后坐标仍落在 volume 内（toroidal wrap 生效）', () => {
    const vol: [number, number, number] = [2, 2, 2];
    const p = buildDustParticles({ count: 120, volumeSize: vol, driftSpeed: 0.05 });
    const hx = vol[0] / 2, hy = vol[1] / 2, hz = vol[2] / 2;
    let t = 0;
    for (let f = 0; f < 2000; f++) {
      updateDustPoints(p, 1 / 60, t);
      t += 1 / 60;
    }
    const arr = p.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      expect(arr[i]!).toBeGreaterThanOrEqual(-hx);
      expect(arr[i]!).toBeLessThanOrEqual(hx);
      expect(arr[i + 1]!).toBeGreaterThanOrEqual(-hy);
      expect(arr[i + 1]!).toBeLessThanOrEqual(hy);
      expect(arr[i + 2]!).toBeGreaterThanOrEqual(-hz);
      expect(arr[i + 2]!).toBeLessThanOrEqual(hz);
    }
  });

  it('漂移会改变位置（不是原地不动）', () => {
    const p = buildDustParticles({ count: 80 });
    const before = Float32Array.from(p.geometry.getAttribute('position').array as Float32Array);
    updateDustPoints(p, 1 / 60, 1.0);
    const after = p.geometry.getAttribute('position').array as Float32Array;
    let moved = false;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { moved = true; break; }
    expect(moved).toBe(true);
  });

  it('deltaSeconds=0 时位置不变（冻结帧安全）', () => {
    const p = buildDustParticles({ count: 40 });
    const before = Float32Array.from(p.geometry.getAttribute('position').array as Float32Array);
    updateDustPoints(p, 0, 1.0);
    const after = p.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < before.length; i++) expect(before[i]).toBe(after[i]);
  });
});
