import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  assetKeyForType,
  normalizeAndAnchor,
  findEmissiveMeshes,
  LIGHT_ASSET_DEFS,
  loadLightAsset,
  attachGlowMesh,
  _resetLightAssetCacheForTest,
  type LightAssetKey,
} from '../lightAssets.js';
import { makeFixture } from '../../core/makeFixture.js';
import type { FixtureType } from '../../core/types.js';

describe('lightAssets: assetKeyForType (P37)', () => {
  it('有资产的类型映射到对应 key', () => {
    expect(assetKeyForType('pendant')).toBe('pendant');
    expect(assetKeyForType('table')).toBe('desk_lamp');
    expect(assetKeyForType('sconce')).toBe('wall_sconce');
    expect(assetKeyForType('downlight')).toBe('ceiling_lamp');
  });

  it('无资产的类型返回 null', () => {
    for (const t of ['spot', 'linear', 'cove', 'floor'] as FixtureType[]) {
      expect(assetKeyForType(t)).toBeNull();
    }
  });
});

describe('lightAssets: normalizeAndAnchor (P37a-fix)', () => {
  it('vertical + anchor=top，不对称几何：顶端对齐原点，向下延伸 targetSize', () => {
    // 模拟 pendant 的不对称：y 从 -1.340 到 0.015（高 1.355）
    // 中心 y = (-1.340 + 0.015) / 2 = -0.6625
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.355, 0.5));
    m.position.y = -0.6625;
    scene.add(m);
    scene.updateMatrixWorld(true);

    const targetSize = 0.45;
    normalizeAndAnchor(scene, 'vertical', targetSize, 'top');
    scene.updateMatrixWorld(true);

    const result = new THREE.Box3().setFromObject(scene);
    // 顶端在原点（anchor=top）
    expect(result.max.y).toBeCloseTo(0, 5);
    // 底端向下延伸 targetSize
    expect(result.min.y).toBeCloseTo(-targetSize, 5);
  });

  it('vertical + anchor=bottom：底端对齐原点，向上延伸 targetSize', () => {
    // 模拟 desk_lamp：底端不在原点（真实 desk_lamp y=-0.088..0.805）
    // 中心 y = (-0.088 + 0.805) / 2 = 0.3585
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.893, 0.6));
    m.position.y = 0.3585;
    scene.add(m);
    scene.updateMatrixWorld(true);

    const targetSize = 0.55;
    normalizeAndAnchor(scene, 'vertical', targetSize, 'bottom');
    scene.updateMatrixWorld(true);

    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(0, 5);
    expect(result.max.y).toBeCloseTo(targetSize, 5);
  });

  it('anchor=center：中心对齐原点', () => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    m.position.y = 2.5; // 远离原点
    scene.add(m);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.5, 'center');
    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(-0.25, 5);
    expect(result.max.y).toBeCloseTo(0.25, 5);
  });

  it('horizontal + anchor=center：中心对齐原点，向两侧延伸 targetSize/2', () => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1));
    m.position.x = 3;
    scene.add(m);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'horizontal', 1.0, 'center');
    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.x).toBeCloseTo(-0.5, 5);
    expect(result.max.x).toBeCloseTo(0.5, 5);
  });

  it('空 Box（无子节点）不抛错，原样返回', () => {
    const scene = new THREE.Group();
    expect(normalizeAndAnchor(scene, 'vertical', 1, 'top')).toBe(scene);
  });
});

describe('lightAssets: findEmissiveMeshes (P37a-fix)', () => {
  it('找到 emissive 非黑且 emissiveIntensity>0 的 Mesh', () => {
    const root = new THREE.Group();
    // mesh1：emissive 黑色，应被排除
    const m1 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0x000000) }),
    );
    // mesh2：emissiveIntensity=0，应被排除
    const m2 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 }),
    );
    // mesh3：emissive 亮 + intensity>0，应被找到
    const m3 = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.9, 0.7), emissiveIntensity: 1 }),
    );
    // 非 mesh（Group）应被忽略
    const grp = new THREE.Group();
    root.add(m1, m2, m3, grp);

    const found = findEmissiveMeshes(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(m3);
  });

  it('遍历嵌套子节点', () => {
    const root = new THREE.Group();
    const child = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5 }),
    );
    child.add(m);
    root.add(child);

    const found = findEmissiveMeshes(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(m);
  });
});

describe('lightAssets: attachGlowMesh (P37a-fix)', () => {
  it('有 emissive mesh：直接复用（不合成圆片），-shade 后缀，emissive 跟 cct', () => {
    const f = makeFixture({ type: 'pendant', cct: 3000 });
    const def = LIGHT_ASSET_DEFS.pendant;
    const g = new THREE.Group();
    // 模拟资产自带 emissive mesh
    const bulbMat = new THREE.MeshStandardMaterial({
      emissive: new THREE.Color(1, 0.9, 0.6),
      emissiveIntensity: 1,
    });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), bulbMat);
    bulb.position.y = -0.4; // 模拟 pendant 的真实 bulb 位置
    g.add(bulb);

    const shade = attachGlowMesh(f, g, def);

    // 复用原 emissive mesh，不新增 mesh
    expect(shade).toBe(bulb);
    expect(g.children.length).toBe(1); // 只加了 bulb，没加合成圆片
    expect(shade.name).toBe(`${f.id}-shade`);
    expect(shade.castShadow).toBe(false);
    expect(shade.userData.fixtureId).toBe(f.id);

    const mat = shade.material as THREE.MeshStandardMaterial;
    // emissive 被覆写为 cct 颜色（3000K 偏暖）
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    expect(mat.emissiveIntensity).toBe(0); // 由 applyFixtureIntensity 更新
  });

  it('无 emissive mesh：回落合成小圆片，尺寸用资产坐标下计算值', () => {
    const f = makeFixture({ type: 'sconce' }); // sconce → wall_sconce
    const def = LIGHT_ASSET_DEFS.wall_sconce;
    const g = new THREE.Group();
    // 模拟 wall_sconce：只有普通 mesh，无 emissive
    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.3, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    ));

    const shade = attachGlowMesh(f, g, def);

    // 新增一个 mesh（合成圆片）
    expect(g.children.length).toBe(2);
    expect(shade).toBe(g.children[1]);
    expect(shade.name).toBe(`${f.id}-shade`);
    // 圆片尺寸：targetSize * 0.25 = 0.35 * 0.25 = 0.0875
    // CircleGeometry 的 radius 在几何里，不是 mesh.position
    const geo = shade.geometry as THREE.CircleGeometry;
    expect(geo.parameters.radius).toBeCloseTo(0.0875, 3);
    // 位置：anchor='top' + lightOffset=-0.18 → 圆片在 y=-0.18
    // 但注意：wall_sconce axis='vertical'，圆片 rotation.x=-PI/2 面朝 -Y
    expect(shade.position.y).toBeCloseTo(-0.18, 5);
  });

  it('glow mesh 的 emissive 颜色跟 cct（回落路径）', () => {
    const f = makeFixture({ type: 'sconce', cct: 2700 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const shade = attachGlowMesh(f, g, LIGHT_ASSET_DEFS.wall_sconce);
    const mat = shade.material as THREE.MeshStandardMaterial;
    // 2700K 极暖，R > B
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    expect(mat.color.r).toBeGreaterThan(mat.color.b);
  });
});

describe('lightAssets: loadLightAsset manifest 缺失分支 (P37)', () => {
  beforeEach(() => {
    _resetLightAssetCacheForTest();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetLightAssetCacheForTest();
  });

  it('manifest 加载失败返回 null', async () => {
    const fakeRenderer = {} as THREE.WebGLRenderer;
    const r = await loadLightAsset('pendant' as LightAssetKey, fakeRenderer);
    expect(r).toBeNull();
  });

  it('loadLightAsset 未缓存时触发 fetch 请求 loader-manifest.json', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const fakeRenderer = {} as THREE.WebGLRenderer;
    await loadLightAsset('pendant' as LightAssetKey, fakeRenderer);
    expect(fetchMock).toHaveBeenCalledWith('/assets/lights/loader-manifest.json');
  });
});
