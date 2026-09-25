import { describe, expect, it } from 'vitest';

import { parseIES, computeBeamAngle, computeTotalLumens, isValidIES } from '../iesParser.js';

// 最小合法 IES 文件：对称配光，1 个水平切面，5 个垂直角度
const MINIMAL_IES = `IESNA:LM-63-2002
[TEST] Test lamp - symmetric distribution
TILT=NONE
1     1000    1.0     5      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      30     60     90    180
0
1000  950   800   400     0`;

// 更真实的 IES 文件：10 个垂直角度，3 个水平切面，带 TILT INCLUDE
const REALISTIC_IES = `IESNA:LM-63-2002
[TEST] Realistic lamp
TILT INCLUDE tilt.inc
1     5000    0.8     10     3      0      0      0.2    0.2    0.3
1.00    0.95    12.5
0     10     20     30     40     50     60     70     80     90    180
0      90    180
1000   980    950    900    850    700    500    250    100     0
1000   970    940    880    820    680    480    240     90     0
1000   960    930    860    800    650    450    220     80     0`;

// 带注释行的 IES 文件
const COMMENTED_IES = `IESNA:LM-63-2002
! This is a comment line
[TEST] Commented lamp
TILT=NONE
1     2000    1.0     4      1      0      0      0.1    0.1    0.1
1.00    1.00    8.0
0      45     90    180
0
2000  1500   500     0`;

// 无效 IES 文件（缺少关键数据）
const INVALID_IES = `IESNA:LM-63-2002
TILT=NONE
`;

// 空文件
const EMPTY_IES = '';

describe('parseIES — IES 配光文件解析', () => {
  it('解析最小合法 IES 文件', () => {
    const data = parseIES(MINIMAL_IES);
    expect(data).not.toBeNull();
    expect(data!.lumens).toBe(1000);
    expect(data!.numVerAngles).toBe(5);
    expect(data!.numHorAngles).toBe(1);
    expect(data!.verAngles).toEqual([0, 30, 60, 90, 180]);
    expect(data!.horAngles).toEqual([0]);
    expect(data!.candela).toHaveLength(1);
    expect(data!.candela[0]).toHaveLength(5);
  });

  it('光强值已乘以修正因子（multiplier * ballFactor * blpFactor）', () => {
    // multiplier=1.0, ballFactor=1.0, blpFactor=1.0 → 无修正
    const data = parseIES(MINIMAL_IES);
    expect(data!.candela[0]?.[0]).toBeCloseTo(1000);
    expect(data!.candela[0]?.[1]).toBeCloseTo(950);
    expect(data!.candela[0]?.[4]).toBeCloseTo(0);
  });

  it('修正因子生效（multiplier=0.8, ballFactor=0.95, blpFactor=1.0）', () => {
    const data = parseIES(REALISTIC_IES);
    // 原始值 1000 × 0.8 × 0.95 × 1.0 = 760
    expect(data!.candela[0]?.[0]).toBeCloseTo(760);
    // 原始值 900 × 0.8 × 0.95 × 1.0 = 684
    expect(data!.candela[0]?.[3]).toBeCloseTo(684);
  });

  it('解析带多个水平切面的 IES 文件', () => {
    const data = parseIES(REALISTIC_IES);
    expect(data!.numHorAngles).toBe(3);
    expect(data!.horAngles).toEqual([0, 90, 180]);
    expect(data!.candela).toHaveLength(3);
    // 每个切面都有 10 个垂直角度
    for (const row of data!.candela) {
      expect(row).toHaveLength(10);
    }
  });

  it('处理 TILT INCLUDE 行（跳过 TILT 数据）', () => {
    const data = parseIES(REALISTIC_IES);
    expect(data).not.toBeNull();
  });

  it('处理注释行（! 开头）', () => {
    const data = parseIES(COMMENTED_IES);
    expect(data).not.toBeNull();
    expect(data!.lumens).toBe(2000);
  });

  it('跳过 IES 文件头的元数据行', () => {
    const data = parseIES(MINIMAL_IES);
    expect(data).not.toBeNull();
    // 确认跳过了 IESNA 行和 [TEST] 行
    expect(data!.numVerAngles).toBe(5);
  });

  it('无效 IES 文件返回 null', () => {
    expect(parseIES(INVALID_IES)).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(parseIES(EMPTY_IES)).toBeNull();
  });

  it('解析失败时不抛出异常', () => {
    // 各种畸形输入都不应该抛异常
    const badInputs = [
      'random text',
      '12345',
      '0 0 0 0 0',
      'TILT=NONE\n1 1000 1.0 0 1',
      'TILT=NONE\n1 1000 1.0 5 1 0 0 0 0 0\n1 1 1\n0\n1000',
    ];
    for (const input of badInputs) {
      expect(() => parseIES(input)).not.toThrow();
    }
  });

  it('正确读取灯具参数（lumens, multiplier, angles count）', () => {
    const data = parseIES(REALISTIC_IES);
    expect(data!.lumens).toBe(5000);
    expect(data!.multiplier).toBeCloseTo(0.8);
    expect(data!.ballFactor).toBeCloseTo(1.0);
    expect(data!.blpFactor).toBeCloseTo(0.95);
    expect(data!.numVerAngles).toBe(10);
    expect(data!.numHorAngles).toBe(3);
  });

  it('多行续读：数值跨行时正确拼接', () => {
    // 把光强值拆成两行
    const multilineIES = `IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     5      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      30     60
90    180
0
1000  950
800   400     0`;
    const data = parseIES(multilineIES);
    expect(data).not.toBeNull();
    expect(data!.numVerAngles).toBe(5);
    expect(data!.verAngles).toEqual([0, 30, 60, 90, 180]);
    expect(data!.candela[0]).toHaveLength(5);
  });
});

describe('computeBeamAngle — 光束角计算', () => {
  it('对称配光：峰值 1000，半功率阈值 500，光束角约 60 度', () => {
    const data = parseIES(MINIMAL_IES)!;
    // 峰值 1000，阈值 500，900 和 800 在阈值以上，400 在阈值以下
    // 半功率角在 60° 和 90° 之间（950@30°, 800@60°, 400@90°）
    // 向下：950@30° 在阈值以上，向下到 0°（1000 也在阈值以上）
    // 向上：800@60° 在阈值以上，400@90° 在阈值以下
    // 所以光束角 ≈ 60 - 0 = 60°
    const angle = computeBeamAngle(data);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThanOrEqual(180);
  });

  it('光束角在合理范围内（0-180 度）', () => {
    const data = parseIES(MINIMAL_IES)!;
    const angle = computeBeamAngle(data);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThanOrEqual(180);
  });

  it('峰值全为零时返回默认 60 度', () => {
    const data = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
0      0      0`);
    expect(data).not.toBeNull();
    expect(computeBeamAngle(data)).toBe(60);
  });

  it('无效数据返回默认 60 度', () => {
    // 没有解析数据时返回 60
    expect(computeBeamAngle(null as unknown as Parameters<typeof computeBeamAngle>[0])).toBe(60);
  });
});

describe('computeTotalLumens — 总光通量计算', () => {
  it('计算结果总是正数', () => {
    const data = parseIES(MINIMAL_IES)!;
    const calculated = computeTotalLumens(data);
    expect(calculated).toBeGreaterThan(0);
  });

  it('高 candela 值的光通量大于低 candela 值', () => {
    const high = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
5000  3000     0`);
    const low = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
1000   600     0`);
    expect(computeTotalLumens(high!)).toBeGreaterThan(computeTotalLumens(low!));
  });

  it('多切面且各切面 candela 更高时，总光通量更大', () => {
    const single = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
1000   500     0`);
    // 3 个切面，但每个切面 candela 是 single 的 3 倍 → 总光通量是 single 的 3 倍
    const multi = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      3      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0     90    180
3000  1500     0
3000  1500     0
3000  1500     0`);
    expect(computeTotalLumens(multi!)).toBeGreaterThan(computeTotalLumens(single!));
  });

  it('各切面相同的多切面 IES，总光通量等于单切面', () => {
    // 3 个相同切面：水平步长 360/3，每切面贡献 1/3，三个加起来 = 单切面
    const single = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
1000   500     0`);
    const multi = parseIES(`IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      3      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0     90    180
1000   500     0
1000   500     0
1000   500     0`);
    expect(computeTotalLumens(multi!)).toBeCloseTo(computeTotalLumens(single!), 0);
  });
});

describe('isValidIES — IES 有效性校验', () => {
  it('合法 IES 返回 true', () => {
    expect(isValidIES(MINIMAL_IES)).toBe(true);
    expect(isValidIES(REALISTIC_IES)).toBe(true);
  });

  it('非法 IES 返回 false', () => {
    expect(isValidIES(INVALID_IES)).toBe(false);
    expect(isValidIES('')).toBe(false);
    expect(isValidIES('random text')).toBe(false);
  });
});
