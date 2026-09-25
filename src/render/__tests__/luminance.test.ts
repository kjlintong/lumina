import { describe, expect, it } from 'vitest';

import { averageLuminanceFromRGBA } from '../luminance.js';

/** 构造 RGBA8 像素：每个像素 4 字节 */
function px(r: number, g: number, b: number, a = 255): number[] {
  return [r, g, b, a];
}

describe('averageLuminanceFromRGBA — 平均亮度采样', () => {
  it('空数组返回 0', () => {
    expect(averageLuminanceFromRGBA(new Uint8Array(0))).toBe(0);
  });

  it('长度不足一像素时忽略尾部字节', () => {
    // 6 字节 = 1 像素 + 2 尾部字节，应只算第 1 像素
    expect(averageLuminanceFromRGBA(new Uint8Array([255, 255, 255, 255, 0, 0]))).toBeCloseTo(
      averageLuminanceFromRGBA(new Uint8Array([255, 255, 255, 255])),
      5,
    );
  });

  it('纯白 (255,255,255) 平均亮度 = 1.0', () => {
    expect(averageLuminanceFromRGBA(Uint8Array.from([...px(255, 255, 255)]))).toBeCloseTo(1.0, 5);
  });

  it('纯黑 (0,0,0) 平均亮度 = 0', () => {
    expect(averageLuminanceFromRGBA(Uint8Array.from([...px(0, 0, 0)]))).toBe(0);
  });

  it('纯红 (255,0,0) 亮度 = W_R = 0.2126', () => {
    expect(averageLuminanceFromRGBA(Uint8Array.from([...px(255, 0, 0)]))).toBeCloseTo(0.2126, 4);
  });

  it('纯绿 (0,255,0) 亮度 = W_G = 0.7152', () => {
    expect(averageLuminanceFromRGBA(Uint8Array.from([...px(0, 255, 0)]))).toBeCloseTo(0.7152, 4);
  });

  it('纯蓝 (0,0,255) 亮度 = W_B = 0.0722', () => {
    expect(averageLuminanceFromRGBA(Uint8Array.from([...px(0, 0, 255)]))).toBeCloseTo(0.0722, 4);
  });

  it('sRGB→线性：sRGB 128 (0.502) 对应的线性亮度 < 0.5', () => {
    // sRGB 128/255 ≈ 0.502，反 gamma 后线性值 ≈ 0.216
    const lin = averageLuminanceFromRGBA(Uint8Array.from([...px(128, 128, 128)]));
    expect(lin).toBeLessThan(0.5);
    expect(lin).toBeGreaterThan(0.2);
  });

  it('多像素取平均：半白半黑 = 0.5', () => {
    const rgba = Uint8Array.from([...px(255, 255, 255), ...px(0, 0, 0)]);
    expect(averageLuminanceFromRGBA(rgba)).toBeCloseTo(0.5, 5);
  });

  it('alpha 通道不影响亮度', () => {
    const opaque = Uint8Array.from([...px(255, 255, 255, 255)]);
    const transparent = Uint8Array.from([...px(255, 255, 255, 0)]);
    expect(averageLuminanceFromRGBA(opaque)).toBeCloseTo(averageLuminanceFromRGBA(transparent), 5);
  });

  it('均匀中等亮度值：(64,64,64) 全块平均 = 单像素亮度', () => {
    const one = Uint8Array.from([...px(64, 64, 64)]);
    const many = Uint8Array.from([...px(64, 64, 64), ...px(64, 64, 64), ...px(64, 64, 64), ...px(64, 64, 64)]);
    expect(averageLuminanceFromRGBA(many)).toBeCloseTo(averageLuminanceFromRGBA(one), 5);
  });
});
