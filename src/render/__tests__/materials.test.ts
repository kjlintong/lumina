import { describe, expect, it } from 'vitest';

import { hexToRgb, mulberry32, wallNormalColor, woodFloorColor } from '../materials.js';

// 注意：jsdom 里 canvas.getContext('2d') 返回 null，因此这里**只测纯函数**，
// 不调用 makeWoodFloorTexture / makeWallNormalTexture / makeFabricTexture
// （那些工厂在 jsdom 返回 null，贴图像素主路径只在真实浏览器渲染时执行）。

describe('mulberry32 — 种子随机数', () => {
  it('同 seed 产出完全相同的序列（贴图确定性）', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('不同 seed 产出不同序列', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('输出在 [0, 1) 区间', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('woodFloorColor — 木地板颜色（纯函数）', () => {
  const BASE = 0x9c7048;

  it('返回值各通道都在 [0, 255] 范围内', () => {
    for (let plank = 0; plank < 5; plank++) {
      for (let u = 0; u <= 1; u += 0.1) {
        for (let v = 0; v <= 1; v += 0.1) {
          const { r, g, b } = woodFloorColor(u, v, plank, BASE);
          for (const c of [r, g, b]) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(255);
          }
        }
      }
    }
  });

  it('相邻板（plank 0 vs 1）在同一 (u,v) 处颜色不同（板间色差）', () => {
    // 取板中央 (0.5, 0.5)，避开板缝（gapShade 相同），差异来自每板明度差
    const p0 = woodFloorColor(0.5, 0.5, 0, BASE);
    const p1 = woodFloorColor(0.5, 0.5, 1, BASE);
    expect(p0).not.toEqual(p1);
  });

  it('板缝处（v≈0）比板中央（v=0.5）更暗（板间深色线）', () => {
    const edge = woodFloorColor(0.5, 0.0, 2, BASE);
    const center = woodFloorColor(0.5, 0.5, 2, BASE);
    expect(edge.r).toBeLessThan(center.r);
  });
});

describe('wallNormalColor — 墙面法线（纯函数）', () => {
  it('b 通道恒在 [230, 255]（法线贴图 B 接近 1 的约定）', () => {
    for (let y = 0; y < 64; y += 7) {
      for (let x = 0; x < 64; x += 7) {
        const { b } = wallNormalColor(x, y);
        expect(b).toBeGreaterThanOrEqual(230);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });

  it('r/g 围绕 128 中性值小幅波动（轻微起伏，非浮雕）', () => {
    for (let y = 0; y < 64; y += 11) {
      for (let x = 0; x < 64; x += 11) {
        const { r, g } = wallNormalColor(x, y);
        expect(Math.abs(r - 128)).toBeLessThanOrEqual(12);
        expect(Math.abs(g - 128)).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('hexToRgb — hex 颜色拆分', () => {
  it('0x9c7048 → { r: 156, g: 112, b: 72 }', () => {
    expect(hexToRgb(0x9c7048)).toEqual({ r: 156, g: 112, b: 72 });
  });

  it('0x000000 → 全 0；0xffffff → 全 255', () => {
    expect(hexToRgb(0x000000)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb(0xffffff)).toEqual({ r: 255, g: 255, b: 255 });
  });
});
