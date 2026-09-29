/**
 * cameraPresets 测试（P18）
 *
 * 纯数据 + 纯函数（easeInOutQuad / lerp）。插值数学在这里完整覆盖，
 * 所以 sceneEngine 侧的 tween 测试只需验证接线，不必重复测数学。
 */
import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRESETS,
  cameraPresetByKey,
  easeInOutQuad,
  lerp,
} from '../cameraPresets.js';

describe('CAMERA_PRESETS', () => {
  it('5 个预设，key 不重复，name 非空', () => {
    expect(CAMERA_PRESETS).toHaveLength(5);
    const keys = CAMERA_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(5);
    expect(keys).toEqual(['window', 'sofa', 'dining', 'overview', 'plan']);
    for (const p of CAMERA_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('所有 position 在房间 6×4.5×2.8m 内（x∈(-3,3), z∈(-2.25,2.25), y∈(0,2.8)）', () => {
    for (const p of CAMERA_PRESETS) {
      // P36 例外：plan 顶视机位故意放在房间正上方（y=6 > 2.8），垂直俯视。
      // 天花板是单面 PlaneGeometry（法线 -Y 朝室内，render/room.ts:301-304），
      // 从上方看是背面被剔除，不会遮挡俯视视野。
      if (p.key === 'plan') continue;
      const [px, py, pz] = p.position;
      // 严格不等号：相机必须在房间**内部**。四面墙是 BoxGeometry 全封闭体积，
      // 相机落在 x=±3 / z=±2.25 上就是贴着墙面，落在外面会被完全挡住
      // （见 sceneEngine 构造函数相机注释、render/room.ts:311-365）。
      // 这条断言守住了 p18-spec.md 里 overview.z=2.5 的越界错误（已修正为 2.25）。
      expect(px, `${p.key}.x=${px}`).toBeGreaterThan(-3);
      expect(px, `${p.key}.x=${px}`).toBeLessThan(3);
      expect(py, `${p.key}.y=${py}`).toBeGreaterThan(0);
      expect(py, `${p.key}.y=${py}`).toBeLessThan(2.8);
      expect(pz, `${p.key}.z=${pz}`).toBeGreaterThan(-2.25);
      expect(pz, `${p.key}.z=${pz}`).toBeLessThan(2.25);
    }
  });

  it('position 与 target 不重合（否则相机朝向未定义）', () => {
    for (const p of CAMERA_PRESETS) {
      const [ax, ay, az] = p.position;
      const [bx, by, bz] = p.target;
      const d = Math.hypot(ax - bx, ay - by, az - bz);
      expect(d, `${p.key} dist=${d}`).toBeGreaterThan(0.5);
    }
  });

  it('camera-to-target 距离在 OrbitControls.minDistance=1 之上（否则被控制器夹紧）', () => {
    for (const p of CAMERA_PRESETS) {
      const [ax, ay, az] = p.position;
      const [bx, by, bz] = p.target;
      expect(Math.hypot(ax - bx, ay - by, az - bz), p.key).toBeGreaterThan(1);
    }
  });

  it('cameraPresetByKey 命中与未命中', () => {
    expect(cameraPresetByKey('sofa')?.name).toBe('沙发位');
    expect(cameraPresetByKey('overview')?.position).toEqual([2.0, 2.2, 2.0]);
    expect(cameraPresetByKey('nope')).toBeUndefined();
    expect(cameraPresetByKey('')).toBeUndefined();
    expect(cameraPresetByKey('SOFA')).toBeUndefined(); // key 大小写敏感
  });
});

describe('cameraPresets (P36 plan preset)', () => {
  it('plan preset exists with key=plan', () => {
    const p = cameraPresetByKey('plan');
    expect(p).toBeDefined();
    expect(p!.key).toBe('plan');
  });

  it('plan preset is top-down (y=6, z≈0)', () => {
    const p = cameraPresetByKey('plan')!;
    expect(p.position[1]).toBeGreaterThan(3); // 高
    expect(Math.abs(p.position[2])).toBeLessThan(0.01); // z 近 0（防 lookAt 除零）
    expect(p.target).toEqual([0, 0, 0]);
  });

  it('plan preset is included in CAMERA_PRESETS array', () => {
    expect(CAMERA_PRESETS.some((p) => p.key === 'plan')).toBe(true);
  });

  it('plan preset name is 顶视', () => {
    expect(cameraPresetByKey('plan')!.name).toBe('顶视');
  });
});

describe('easeInOutQuad', () => {
  it('端点与中点', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5);
  });

  it('[0,1] 内单调递增', () => {
    // 函数本身不钳位（钳位在 stepCameraTween 里），所以只在 [0,1] 内取样。
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    for (let i = 1; i < samples.length; i++) {
      expect(
        easeInOutQuad(samples[i]!),
        `ease(${samples[i]}) < ease(${samples[i - 1]})`,
      ).toBeGreaterThanOrEqual(easeInOutQuad(samples[i - 1]!));
    }
    // 严格递增在中段（端点 0/1 处导数为 0，只保证非降）
    expect(easeInOutQuad(0.5)).toBeGreaterThan(easeInOutQuad(0.25));
  });

  it('起步慢、收尾慢：中段斜率大于两端（缓动确实缓）', () => {
    const mid = (easeInOutQuad(0.6) - easeInOutQuad(0.4)) / 0.2;
    const start = (easeInOutQuad(0.1) - easeInOutQuad(0.0)) / 0.1;
    const end = (easeInOutQuad(1.0) - easeInOutQuad(0.9)) / 0.1;
    expect(mid).toBeGreaterThan(start);
    expect(mid).toBeGreaterThan(end);
  });

  it('越界不外插成 NaN（函数不钳位，但输出应为有限数）', () => {
    for (const k of [-1, 1.1, 2]) {
      expect(Number.isFinite(easeInOutQuad(k))).toBe(true);
    }
  });
});

describe('lerp', () => {
  it('端点与中点', () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
    expect(lerp(2, 8, 0.5)).toBe(5);
  });

  it('起点=终点时任意 t 都是同一值', () => {
    expect(lerp(3, 3, 0.37)).toBe(3);
  });

  it('负区间与外插都按线性公式算', () => {
    expect(lerp(-4, 2, 0.5)).toBe(-1);
    expect(lerp(2, 8, 1.5)).toBe(11); // 外插：2 + 6*1.5
  });
});
