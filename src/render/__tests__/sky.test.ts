import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Vector3 } from 'three';

import { buildSkyScene, skyColors } from '../sky.js';

// skyColors 是纯函数（返回 plain {r,g,b}），可直接测；
// buildSkyScene 只构建 Three.js 对象（无 WebGL 调用），断言其结构即可。

describe('skyColors — 天空颜色关键帧插值', () => {
  it('黄昏（elevation=0）地平线偏暖：horizon.r > horizon.b', () => {
    // 规格断言「日落方向偏暖」。注意：黄昏的暖色在**地平线**（#c44a1a）而非
    // 整片背景（背景关键帧 #0f1428 偏蓝，代表夜幕降临的天顶侧），因此这里
    // 断 horizon 而非 background —— 与 P8 规格 §2 的暖色日落关键帧一致。
    const c = skyColors(0);
    expect(c.horizon.r).toBeGreaterThan(c.horizon.b);
  });

  it('正午（elevation=π/2）背景偏冷：background.b > background.r', () => {
    const c = skyColors(Math.PI / 2);
    expect(c.background.b).toBeGreaterThan(c.background.r);
  });

  it('top.b 随 elevation 从 0 升到 π/2 单调不减', () => {
    let prev = -Infinity;
    for (let e = 0; e <= Math.PI / 2; e += 0.05) {
      const b = skyColors(e).top.b;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('夜晚（elevation<0）背景暗（亮度<0.1）但不为纯黑（>0）', () => {
    const c = skyColors(-0.5);
    const lum = (c.background.r + c.background.g + c.background.b) / 3;
    expect(lum).toBeGreaterThan(0);
    expect(lum).toBeLessThan(0.1);
  });

  it('夜晚 horizon 不为纯黑（保留一点蓝，避免 ACES 压死整屏）', () => {
    const c = skyColors(-0.5);
    expect(c.horizon.b).toBeGreaterThan(0);
  });
});

describe('buildSkyScene — 窗外远景', () => {
  it('返回的 group 含 ≥1 个 Mesh，命名为 sky-scene', () => {
    const { group } = buildSkyScene(new Vector3(0, 1.4, -2.25), new Vector3(0, 0, -1));
    expect(group.name).toBe('sky-scene');
    const meshes = group.children.filter((c) => c instanceof Mesh);
    expect(meshes.length).toBeGreaterThanOrEqual(1);
  });

  it('太阳圆盘用 MeshBasicMaterial 且 toneMapped=false（触发 bloom）', () => {
    const { sun } = buildSkyScene(new Vector3(0, 1.4, -2.25), new Vector3(0, 0, -1));
    expect(sun).toBeInstanceOf(Mesh);
    expect(sun.material).toBeInstanceOf(MeshBasicMaterial);
    expect((sun.material as MeshBasicMaterial).toneMapped).toBe(false);
  });

  it('所有室外物体不参与阴影，且沿窗外法线（-z）外推', () => {
    const { group } = buildSkyScene(new Vector3(0, 1.4, -2.25), new Vector3(0, 0, -1));
    for (const child of group.children) {
      expect(child.castShadow).toBe(false);
      expect(child.receiveShadow).toBe(false);
      // 都在窗外（局部 z < 0，组原点即窗中心）
      expect(child.position.z).toBeLessThan(0);
    }
  });
});
