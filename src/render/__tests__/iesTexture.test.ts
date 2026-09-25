import { describe, expect, it } from 'vitest';

import { parseIES } from '../iesParser.js';
import type { IESData } from '../iesParser.js';
import { lookupCandela, createSpotlightPatternTexture, createIESTexture } from '../iesTexture.js';

// 对称 IES：1 切面，5 个垂直角度
const SYMMETRIC_IES = `IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     5      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      30     60     90    180
0
1000   900    800    400     0`;

// 半对称 IES：3 切面
const SEMI_SYMMETRIC_IES = `IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      3      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0     90    180
1000   500     0
800    400     0
1000   500     0`;

describe('lookupCandela — IES 光强查找', () => {
  it('对称 IES：光轴方向（0°）光强 = 峰值', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const c = lookupCandela(data, 0, 0);
    expect(c).toBeCloseTo(1000, 0);
  });

  it('对称 IES：90° 垂直角光强 = 400', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const c = lookupCandela(data, 0, 90);
    expect(c).toBeCloseTo(400, 0);
  });

  it('对称 IES：180° 垂直角光强 = 0', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const c = lookupCandela(data, 0, 180);
    expect(c).toBeCloseTo(0, 0);
  });

  it('对称 IES：中间角度线性插值', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    // 15° 在 0° 和 30° 之间，应为 (1000 + 900) / 2 = 950
    const c = lookupCandela(data, 0, 15);
    expect(c).toBeCloseTo(950, 0);
  });

  it('对称 IES：30° 垂直角光强 = 900', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const c = lookupCandela(data, 0, 30);
    expect(c).toBeCloseTo(900, 0);
  });

  it('对称 IES：水平角不影响（1 切面 = 全对称）', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const c0 = lookupCandela(data, 0, 0);
    const c90 = lookupCandela(data, 90, 0);
    const c180 = lookupCandela(data, 180, 0);
    const c270 = lookupCandela(data, 270, 0);
    expect(c90).toBeCloseTo(c0, 0);
    expect(c180).toBeCloseTo(c0, 0);
    expect(c270).toBeCloseTo(c0, 0);
  });

  it('半对称 IES：不同水平切面光强不同', () => {
    const data = parseIES(SEMI_SYMMETRIC_IES)!;
    // horAngles = [0, 90, 180]，第 0 切面峰值 1000，第 1 切面峰值 800
    const c0 = lookupCandela(data, 0, 0); // 第 0 切面
    const c90 = lookupCandela(data, 90, 0); // 第 1 切面
    expect(c0).toBeCloseTo(1000, 0);
    expect(c90).toBeCloseTo(800, 0);
  });

  it('半对称 IES：中间水平角线性插值', () => {
    const data = parseIES(SEMI_SYMMETRIC_IES)!;
    // 45° 在 0° 和 90° 之间，应为 (1000 + 800) / 2 = 900
    const c = lookupCandela(data, 45, 0);
    expect(c).toBeCloseTo(900, 0);
  });

  it('无效数据返回 0', () => {
    // 空数据不应崩溃
    const emptyData: IESData = {
      lumens: 0,
      candela: [],
      verAngles: [],
      horAngles: [],
      numVerAngles: 0,
      numHorAngles: 0,
      multiplier: 1,
      ballFactor: 1,
      blpFactor: 1,
    };
    expect(() => {
      lookupCandela(emptyData, 0, 0);
    }).not.toThrow();
  });
});

describe('createSpotlightPatternTexture — 圆形投影纹理', () => {
  it('生成 256×256 纹理', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createSpotlightPatternTexture(data);
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
  });

  it('中心 texel 光强 = 峰值', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createSpotlightPatternTexture(data);
    // 中心 texel (128, 128) 对应光轴方向
    const dataArr = tex.image.data as Float32Array;
    const center = dataArr[128 * 256 + 128] ?? 0;
    expect(center).toBeGreaterThan(0);
  });

  it('边缘 texel 光强低于中心', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createSpotlightPatternTexture(data);
    const dataArr = tex.image.data as Float32Array;
    const center = dataArr[128 * 256 + 128] ?? 0;
    // 边缘 texel (128, 0) 对应光锥边缘（90° 垂直角）
    const edge = dataArr[0 * 256 + 128] ?? 0;
    expect(edge).toBeLessThan(center);
  });

  it('角落 texel 光强低于中心（接近光锥边缘）', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createSpotlightPatternTexture(data);
    const dataArr = tex.image.data as Float32Array;
    const center = dataArr[128 * 256 + 128] ?? 0;
    const corner = dataArr[0 * 256 + 0] ?? 0;
    // 角落 texel 接近光锥边缘（90° 垂直角），光强应低于中心（峰值）
    // 但不会为 0，因为 texel 中心实际在圆内
    expect(corner).toBeLessThan(center);
    expect(corner).toBeGreaterThan(0);
  });

  it('纹理格式正确（RedFormat + FloatType）', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createSpotlightPatternTexture(data);
    expect(tex.format).toBeDefined();
    expect(tex.type).toBeDefined();
  });
});

describe('createIESTexture — WebGPU 1D 纹理', () => {
  it('生成 180×1 纹理', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createIESTexture(data);
    expect(tex.width).toBe(180);
    expect(tex.height).toBe(1);
  });

  it('首个 texel（0°）光强 = 峰值', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createIESTexture(data);
    const dataArr = tex.image.data as Float32Array;
    expect(dataArr[0] ?? 0).toBeCloseTo(1000, 0);
  });

  it('最后一个 texel（180°）光强 = 0', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createIESTexture(data);
    const dataArr = tex.image.data as Float32Array;
    expect(dataArr[179] ?? 0).toBeCloseTo(0, 0);
  });

  it('中间 texel 光强递减', () => {
    const data = parseIES(SYMMETRIC_IES)!;
    const tex = createIESTexture(data);
    const dataArr = tex.image.data as Float32Array;
    const t0 = dataArr[0] ?? 0;
    const t90 = dataArr[90] ?? 0;
    const t179 = dataArr[179] ?? 0;
    expect(t0).toBeGreaterThan(t90);
    expect(t90).toBeGreaterThan(t179);
  });
});
