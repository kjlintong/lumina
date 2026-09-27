import { describe, expect, it } from 'vitest';
import { CanvasTexture, Mesh, MeshPhysicalMaterial } from 'three';

import { buildRoom } from '../room.js';

describe('buildRoom — 房间外壳构建', () => {
  it('拒绝非正尺寸（width/depth/height <= 0 抛出）', () => {
    expect(() => buildRoom(0, 4, 2.8)).toThrow();
    expect(() => buildRoom(-1, 4, 2.8)).toThrow();
    expect(() => buildRoom(5, 0, 2.8)).toThrow();
    expect(() => buildRoom(5, -2, 2.8)).toThrow();
    expect(() => buildRoom(5, 4, 0)).toThrow();
    expect(() => buildRoom(5, 4, -0.5)).toThrow();
  });

  it('group 内含 6 个 Mesh（1 地板 + 4 墙 + 1 天花板）', () => {
    const { group } = buildRoom(5, 4, 2.8);
    expect(group.children).toHaveLength(6);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('地板：receiveShadow=true，castShadow=false（最低面，投影零收益且产生 acne）', () => {
    const { floor } = buildRoom(5, 4, 2.8);
    expect(floor.receiveShadow).toBe(true);
    expect(floor.castShadow).toBe(false);
  });

  it('天花板：receiveShadow=true，castShadow=true（否则光泄漏到屋顶以上）', () => {
    const { ceiling } = buildRoom(5, 4, 2.8);
    expect(ceiling.receiveShadow).toBe(true);
    expect(ceiling.castShadow).toBe(true);
  });

  it('墙体：全部 receiveShadow=true，castShadow=true（否则光穿透墙体）', () => {
    const { walls } = buildRoom(5, 4, 2.8);
    expect(walls).toHaveLength(4);
    for (const wall of walls) {
      expect(wall.receiveShadow).toBe(true);
      expect(wall.castShadow).toBe(true);
    }
  });

  it('地板 rotation.x === -PI/2（法线朝上）', () => {
    const { floor } = buildRoom(5, 4, 2.8);
    expect(floor.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it('天花板 position.y === height', () => {
    const { ceiling } = buildRoom(5, 4, 2.8);
    expect(ceiling.position.y).toBe(2.8);
  });

  // ---------------------------------------------------------------------------
  // P8a：落地窗（北墙）
  // ---------------------------------------------------------------------------

  it('默认（withWindow 缺省 = false）不建窗：windows / windowFrame 均为空', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8);
    expect(windows).toHaveLength(0);
    expect(windowFrame).toHaveLength(0);
  });

  it('withWindow: false 时不产生玻璃 mesh', () => {
    const { group, windows } = buildRoom(5, 4, 2.8, { withWindow: false });
    expect(windows).toHaveLength(0);
    // 无窗时仍是 6 个 Mesh 直接子节点（1 地板 + 4 墙 + 1 天花板）
    expect(group.children).toHaveLength(6);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('withWindow: true 时产生 ≥1 面玻璃，玻璃用 transmission 物理透光（室外可见）', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windowFrame.length).toBeGreaterThanOrEqual(1);
    const glass = windows[0]!;
    const mat = glass.material as MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(MeshPhysicalMaterial);
    // transmission 走独立 transmissionRenderTarget（WebGLMaterials.refreshUniformsPhysical），
    // 与 transparent 完全无关——渲染器先把场景渲到 RT，物理材质再采样该 RT 做折射。
    // P8a「死白窗」的根因是当时**没用 transmission**、只用 opacity 0.12 的半透明白板，
    // 那是「没用 transmission」的后果，而非它的副作用。P14 推翻旧的 transmission===0 断言。
    expect(mat.transmission).toBe(1.0);
    expect(mat.ior).toBe(1.5);
    expect(mat.thickness).toBe(0.01);
    expect(mat.roughness).toBe(0.05);
    // transparent 保留（无害，保证 transparent pass 正确排序），但 opacity 必须为 1.0——
    // 低 opacity 会把折射结果再按 alpha 压淡一遍。
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(1.0);
    // renderOrder > 0：后画，保证混合时室外内容不被室内物体盖住
    expect(glass.renderOrder).toBeGreaterThan(0);
  });

  it('withWindow: true 时玻璃不投影（否则窗框阴影被整面玻璃吃掉）', () => {
    const { windows, windowFrame } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(windows[0]!.castShadow).toBe(false);
    for (const bar of windowFrame) {
      expect(bar.castShadow).toBe(true); // 窗框投出窗格阴影
    }
  });

  it('withWindow: true 时房间组仍是 6 个直接子节点（窗体收进 window-north 子组）', () => {
    // sceneEngine 的「房间组 6 子节点」断言依赖此结构：窗体构件（墙体分段 +
    // 窗框 + 玻璃）收进一个子 Group，而不是平铺成十几个直接子节点。
    const { group } = buildRoom(5, 4, 2.8, { withWindow: true });
    expect(group.children).toHaveLength(6);
    expect(group.getObjectByName('window-north')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // P14：橡木地板三件套（map + normalMap + roughnessMap）+ clearcoat
  // ---------------------------------------------------------------------------

  it('地板：MeshPhysicalMaterial，roughness ∈ [0.35, 0.45]，clearcoat === 0.15（清漆层）', () => {
    const { floor } = buildRoom(5, 4, 2.8);
    const mat = floor.material as MeshPhysicalMaterial;
    // MeshPhysicalMaterial extends MeshStandardMaterial：既有 instanceof
    // MeshStandardMaterial 的用法不受影响；但必须是 Physical 才有 clearcoat。
    expect(mat).toBeInstanceOf(MeshPhysicalMaterial);
    expect(mat.roughness).toBeGreaterThanOrEqual(0.35);
    expect(mat.roughness).toBeLessThanOrEqual(0.45);
    expect(mat.clearcoat).toBe(0.15);
    expect(mat.clearcoatRoughness).toBe(0.4);
  });

  it('地板：注入 normalMap / roughnessMap 后接线生效（jsdom 工厂返回 null，故用注入测接线）', () => {
    // jsdom 里 canvas.getContext('2d') 返回 null，makeWoodFloorNormalTexture 等
    // 工厂返回 null——因此这里注入 mock CanvasTexture 来验证「贴图被接到材质上」，
    // 而非断言工厂产物（红线 #8：贴图生成不进单测主路径）。
    const normalTex = new CanvasTexture(document.createElement('canvas'));
    const roughnessTex = new CanvasTexture(document.createElement('canvas'));
    const { floor } = buildRoom(5, 4, 2.8, {
      withWindow: true,
      floorNormalTexture: normalTex,
      floorRoughnessTexture: roughnessTex,
    });
    const mat = floor.material as MeshPhysicalMaterial;
    expect(mat.normalMap).toBe(normalTex);
    expect(mat.roughnessMap).toBe(roughnessTex);
    expect(mat.normalScale.x).toBeCloseTo(0.6);
    expect(mat.normalScale.y).toBeCloseTo(0.6);
  });
});
