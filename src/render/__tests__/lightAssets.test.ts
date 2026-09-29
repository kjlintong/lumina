import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  assetKeyForType,
  normalizeAndAnchor,
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

describe('lightAssets: normalizeAndAnchor (P37)', () => {
  it('vertical + anchor=top：顶端对齐原点，资产向下延伸', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'top');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.max.y).toBeCloseTo(0, 5);   // 顶端在原点
    expect(result.min.y).toBeCloseTo(-0.8, 5); // 向下延伸 0.8
  });

  it('vertical + anchor=bottom：底端对齐原点，资产向上延伸', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'bottom');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(0, 5);    // 底端在原点
    expect(result.max.y).toBeCloseTo(0.8, 5);   // 向上延伸 0.8
  });

  it('vertical + anchor=center：中心对齐原点', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'vertical', 0.8, 'center');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.y).toBeCloseTo(-0.4, 5);
    expect(result.max.y).toBeCloseTo(0.4, 5);
  });

  it('horizontal + anchor=center：左端对齐原点', () => {
    const scene = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    scene.add(box);
    scene.updateMatrixWorld(true);

    normalizeAndAnchor(scene, 'horizontal', 1.2, 'center');

    scene.updateMatrixWorld(true);
    const result = new THREE.Box3().setFromObject(scene);
    expect(result.min.x).toBeCloseTo(-0.6, 5);
    expect(result.max.x).toBeCloseTo(0.6, 5);
  });

  it('空 Box（无子节点）不抛错，原样返回', () => {
    const scene = new THREE.Group();
    const out = normalizeAndAnchor(scene, 'vertical', 1, 'top');
    expect(out).toBe(scene);
  });
});

describe('lightAssets: attachGlowMesh (P37)', () => {
  it('glow mesh 沿主轴向放在 lightOffset 处，带 -shade 后缀', () => {
    const f = makeFixture({ type: 'pendant' });
    const def = LIGHT_ASSET_DEFS.pendant; // anchor=top, lightOffset=-0.60
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, def);
    expect(g.children).toContain(mesh);
    expect(mesh.name).toBe(`${f.id}-shade`);
    expect(mesh.name.endsWith('-shade')).toBe(true); // App.tsx:256 拖放命中判定依赖
    expect(mesh.position.y).toBeCloseTo(-0.60, 5);    // 光源在灯罩（资产下方 0.6m）
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.userData.fixtureId).toBe(f.id);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBe(0);
  });

  it('desk_lamp (anchor=bottom, lightOffset=+0.60) 光源在资产上方', () => {
    const f = makeFixture({ type: 'table' });
    const def = LIGHT_ASSET_DEFS.desk_lamp;
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, def);
    expect(mesh.position.y).toBeCloseTo(0.60, 5); // 底座在原点，灯罩在上方
  });

  it('glow mesh 材质 emissive 颜色跟 cct', () => {
    const f = makeFixture({ type: 'pendant', cct: 3000 });
    const g = new THREE.Group();
    const mesh = attachGlowMesh(f, g, LIGHT_ASSET_DEFS.pendant);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    // 3000K 偏暖，R > B
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
    // 同时 color 也跟随（applyFixtureCct 只改 emissive，color 保留初值）
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
