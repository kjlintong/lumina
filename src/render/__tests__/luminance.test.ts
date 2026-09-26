import { describe, expect, it } from 'vitest';

import { averageLuminanceFromRGBA, halfToFloat } from '../luminance.js';

// ---------------------------------------------------------------------------
// halfToFloat（P9 新增：HalfFloat 位型 → float32）
// ---------------------------------------------------------------------------

describe('halfToFloat — IEEE 754 binary16 解码', () => {
  it('0 → 0', () => {
    expect(halfToFloat(0)).toBe(0);
  });

  it('0x3C00 → 1.0', () => {
    expect(halfToFloat(0x3c00)).toBe(1.0);
  });

  it('0x7BFF → 65504（binary16 最大有限值）', () => {
    expect(halfToFloat(0x7bff)).toBeCloseTo(65504, 0);
  });

  it('0x3400 → 0.25', () => {
    expect(halfToFloat(0x3400)).toBeCloseTo(0.25, 5);
  });

  it('0x3800 → 0.5', () => {
    expect(halfToFloat(0x3800)).toBe(0.5);
  });

  it('0x4000 → 2.0', () => {
    expect(halfToFloat(0x4000)).toBe(2.0);
  });

  it('0x4200 → 3.0', () => {
    expect(halfToFloat(0x4200)).toBe(3.0);
  });

  it('负数：0xBC00 → -1.0', () => {
    expect(halfToFloat(0xbc00)).toBe(-1.0);
  });

  it('次正规数：0x0001 = 2^-24', () => {
    expect(halfToFloat(0x0001)).toBeCloseTo(2 ** -24, 12);
  });

  it('0x7C00 → +Infinity', () => {
    expect(halfToFloat(0x7c00)).toBe(Infinity);
  });

  it('0x7E00 → NaN', () => {
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
  });

  it('与 float32 → binary16 → float32 的往返一致', () => {
    const enc = (f: number): number => {
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, f, true);
      const f32 = view.getUint32(0, true);
      const sign = (f32 >>> 31) & 1;
      const exp = (f32 >>> 23) & 0xff;
      const mant = f32 & 0x7fffff;
      let e: number;
      let m: number;
      if (exp === 0) {
        e = 0;
        m = (mant >>> 13) & 0x3ff;
      } else if (exp === 0xff) {
        e = 31;
        m = (mant >>> 13) & 0x3ff;
      } else {
        e = exp - 127 + 15;
        m = (mant >>> 13) & 0x3ff;
        if (e >= 31) e = 31;
        else if (e <= 0) {
          m = (mant + (1 << 13)) >>> (15 - e);
          e = 0;
        }
      }
      return (sign << 15) | (e << 10) | m;
    };
    for (const v of [0, 0.5, 1.0, 2.5, 100, 65504]) {
      expect(halfToFloat(enc(v))).toBeCloseTo(v, v === 65504 ? 0 : 3);
    }
  });
});

// ---------------------------------------------------------------------------
// averageLuminanceFromRGBA（P9：输入改为 Uint16Array / HalfFloat）
// ---------------------------------------------------------------------------

/** 构造 HalfFloat RGBA 像素：给线性分量值，编码成 4 个 uint16 */
function px16(r: number, g: number, b: number, a = 1.0): number[] {
  // 复用上面 enc 的算法——这里直接内联，避免跨 describe 共享闭包
  const enc = (f: number): number => {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, f, true);
    const f32 = view.getUint32(0, true);
    const sign = (f32 >>> 31) & 1;
    const exp = (f32 >>> 23) & 0xff;
    const mant = f32 & 0x7fffff;
    let e: number;
    let m: number;
    if (exp === 0) {
      e = 0;
      m = (mant >>> 13) & 0x3ff;
    } else if (exp === 0xff) {
      e = 31;
      m = (mant >>> 13) & 0x3ff;
    } else {
      e = exp - 127 + 15;
      m = (mant >>> 13) & 0x3ff;
      if (e >= 31) e = 31;
      else if (e <= 0) {
        m = (mant + (1 << 13)) >>> (15 - e);
        e = 0;
      }
    }
    return (sign << 15) | (e << 10) | m;
  };
  return [enc(r), enc(g), enc(b), enc(a)];
}

/** 直接用 binary16 位型构造 RGBA 像素（用于测试 Inf/NaN 等特例） */
function bits(r: number, g: number, b: number, a = 1.0): number[] {
  return [r, g, b, a];
}

describe('averageLuminanceFromRGBA — HalfFloat 平均亮度采样', () => {
  it('空数组返回 0', () => {
    expect(averageLuminanceFromRGBA(new Uint16Array(0))).toBe(0);
  });

  it('长度不足一像素时忽略尾部', () => {
    const one = Uint16Array.from([...px16(1, 1, 1), 0, 0]);
    const exact = Uint16Array.from([...px16(1, 1, 1)]);
    expect(averageLuminanceFromRGBA(one)).toBeCloseTo(
      averageLuminanceFromRGBA(exact),
      5,
    );
  });

  it('纯白（线性 1.0,1.0,1.0）平均亮度 = 1.0', () => {
    expect(averageLuminanceFromRGBA(Uint16Array.from([...px16(1, 1, 1)]))).toBeCloseTo(
      1.0,
      5,
    );
  });

  it('纯黑（线性 0,0,0）平均亮度 = 0', () => {
    expect(averageLuminanceFromRGBA(Uint16Array.from([...px16(0, 0, 0)]))).toBe(0);
  });

  it('纯红（线性 1,0,0）亮度 = W_R = 0.2126', () => {
    expect(averageLuminanceFromRGBA(Uint16Array.from([...px16(1, 0, 0)]))).toBeCloseTo(
      0.2126,
      4,
    );
  });

  it('纯绿（线性 0,1,0）亮度 = W_G = 0.7152', () => {
    expect(averageLuminanceFromRGBA(Uint16Array.from([...px16(0, 1, 0)]))).toBeCloseTo(
      0.7152,
      4,
    );
  });

  it('纯蓝（线性 0,0,1）亮度 = W_B = 0.0722', () => {
    expect(averageLuminanceFromRGBA(Uint16Array.from([...px16(0, 0, 1)]))).toBeCloseTo(
      0.0722,
      4,
    );
  });

  it('不再做 sRGB 反变换：线性 0.5 灰度 → 亮度 = 0.5（P9 行为变化）', () => {
    // 旧实现（8-bit sRGB）会把 0.5 反 gamma 到 ~0.216；
    // P9 后输入已是线性 HDR 值，直接加权求和 → 0.5。
    const lin = averageLuminanceFromRGBA(Uint16Array.from([...px16(0.5, 0.5, 0.5)]));
    expect(lin).toBeCloseTo(0.5, 5);
  });

  it('多像素取平均：半白半黑 = 0.5', () => {
    const rgba = Uint16Array.from([...px16(1, 1, 1), ...px16(0, 0, 0)]);
    expect(averageLuminanceFromRGBA(rgba)).toBeCloseTo(0.5, 5);
  });

  it('alpha 通道不影响亮度', () => {
    const opaque = Uint16Array.from([...px16(1, 1, 1, 1)]);
    const transparent = Uint16Array.from([...px16(1, 1, 1, 0)]);
    expect(averageLuminanceFromRGBA(opaque)).toBeCloseTo(
      averageLuminanceFromRGBA(transparent),
      5,
    );
  });

  it('HDR 值（>1）可被采样，不会 clamp 到 1', () => {
    // 太阳圆盘类的高亮体在 HalfFloat RT 里会 > 1.0
    const bright = averageLuminanceFromRGBA(Uint16Array.from([...px16(3, 3, 3)]));
    expect(bright).toBeCloseTo(3.0, 4);
  });

  it('Infinity 分量被忽略（按 0 计），不会把整块结果拖成 Inf', () => {
    // 0x7C00 = +Infinity（binary16）。防御：HDR 采样的极端像素不应拖垮曝光。
    // 用位型直写（不走 float32 编码，0x7C00 不是 0x7FC0）。
    const white = bits(0x3c00, 0x3c00, 0x3c00); // (1,1,1)
    const infPx = bits(0x7c00, 0, 0);
    const lin = averageLuminanceFromRGBA(Uint16Array.from([...white, ...infPx]));
    expect(Number.isFinite(lin)).toBe(true);
    // 异常像素按 0 计 → 平均 = 1.0 / 2
    expect(lin).toBeCloseTo(0.5, 5);
  });

  it('均匀中等亮度：全块平均 = 单像素亮度', () => {
    const one = Uint16Array.from([...px16(0.25, 0.25, 0.25)]);
    const many = Uint16Array.from([
      ...px16(0.25, 0.25, 0.25),
      ...px16(0.25, 0.25, 0.25),
      ...px16(0.25, 0.25, 0.25),
      ...px16(0.25, 0.25, 0.25),
    ]);
    expect(averageLuminanceFromRGBA(many)).toBeCloseTo(
      averageLuminanceFromRGBA(one),
      5,
    );
  });
});
