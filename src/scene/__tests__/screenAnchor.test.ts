/**
 * @vitest-environment jsdom
 *
 * projectToScreenUV 边界用例（P9 交付物 2 / 规格 §3）。
 *
 * 只测纯几何计算，不真实渲染（jsdom 无 WebGL）。用真实 PerspectiveCamera
 * + updateMatrixWorld() 构造，避免依赖 mock。
 *
 * 相机约定：位于 (0, 0, 10)、朝向 -Z（默认 lookAt 原点方向），
 * 因此正前方视野中心的点在 (0, 0, 0)；左侧是 -X；背后是 +Z（> 10）。
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';

import { projectToScreenUV } from '../sceneEngine.js';

/** 构造一台朝向 -Z 的标准相机，matrixWorld / projectionMatrix 都已刷新。 */
function setupCamera(fov = 60, aspect = 1): PerspectiveCamera {
  const cam = new PerspectiveCamera(fov, aspect, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('projectToScreenUV', () => {
  it('目标点在相机正前方视野中心 → UV = (0.5, 0.5)，z < 1', () => {
    const cam = setupCamera();
    const uv = projectToScreenUV(new Vector3(0, 0, 0), cam);
    expect(uv).not.toBeNull();
    if (!uv) return;
    expect(uv.x).toBeCloseTo(0.5, 5);
    expect(uv.y).toBeCloseTo(0.5, 5);
    expect(uv.z).toBeLessThan(1);
    // 近平面 0.1、远平面 1000，点 z=0 距相机 10m → NDC z 明显 < 1
    expect(uv.z).toBeGreaterThan(0);
  });

  it('目标点在相机视野左侧（uv.x < 0）→ 返回 null', () => {
    const cam = setupCamera();
    // 相机在 z=10 朝 -Z，视野中心 x=0；把点推到左侧 x=-100，远超出视野
    const uv = projectToScreenUV(new Vector3(-100, 0, 0), cam);
    expect(uv).toBeNull();
  });

  it('目标点在相机背后（z >= 1）→ 返回 null', () => {
    const cam = setupCamera();
    // 相机在 z=10 朝 -Z，z=20 在相机背后 10m
    const uv = projectToScreenUV(new Vector3(0, 0, 20), cam);
    expect(uv).toBeNull();
  });
});
