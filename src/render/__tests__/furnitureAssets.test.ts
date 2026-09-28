/**
 * @vitest-environment jsdom
 *
 * P35 Part D：GLTF furniture loader 测试。
 *
 * 覆盖：
 * - loadFurniture 加载失败（文件缺失）返回 null，不抛异常（降级策略）
 * - loadFurniture 成功路径写 cache：第二次同 key 调用不重新 loadAsync（缓存命中）
 * - snapToWall：obj 靠近墙时贴墙 + 对齐法线
 * - snapToWall：obj 远离墙（>threshold）时不动
 * - snapToWall：墙方向不同（沿 x 沿 z）时正确对齐
 *
 * GLTFLoader/DRACOLoader/KTX2Loader 通过 vi.mock 拦下，避免 jsdom 下真的走 fetch/parse。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  FURNITURE_LIST,
  loadFurniture,
  snapToWall,
  _resetFurnitureCacheForTest,
} from '../furnitureAssets.js';

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn().mockImplementation(() => ({
    loadAsync: vi.fn(),
    setDRACOLoader: vi.fn(),
    setKTX2Loader: vi.fn(),
  })),
}));
vi.mock('three/addons/loaders/DRACOLoader.js', () => ({
  DRACOLoader: vi.fn().mockImplementation(() => ({
    setDecoderPath: vi.fn(),
  })),
}));
vi.mock('three/addons/loaders/KTX2Loader.js', () => ({
  KTX2Loader: vi.fn().mockImplementation(() => ({
    detectSupport: vi.fn(),
  })),
}));

function mockRenderer(): THREE.WebGLRenderer {
  return {
    isWebGLRenderer: true,
    getContext: () => ({ getParameter: () => null }),
    extensions: {
      get: () => null,
      has: () => false,
    },
  } as unknown as THREE.WebGLRenderer;
}

/** 让 ensureLoader 使用指定的 loadAsync mock */
function setGLTFLoadAsyncMock(mock: () => Promise<unknown>): void {
  (GLTFLoader as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    () => ({
      loadAsync: mock,
      setDRACOLoader: vi.fn(),
      setKTX2Loader: vi.fn(),
    }) as unknown as InstanceType<typeof GLTFLoader>,
  );
}

/** 让 ensureLoader 使用的 KTX2Loader.detectSupport 变成 no-op mock */
function stubKTX2DetectSupport(): void {
  (KTX2Loader as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    () => ({
      detectSupport: vi.fn(),
    }),
  );
}

/** 让 ensureLoader 使用的 DRACOLoader.setDecoderPath 变成 no-op mock */
function stubDracoDecoderPath(): void {
  (DRACOLoader as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    () => ({
      setDecoderPath: vi.fn(),
    }),
  );
}

/**
 * 构造一个 1×1×1 立方体 Group（作为"家具"替代物）用于 snapToWall 测试。
 * 底面 y=0，中心 y=0.5。
 */
function unitCuboidGroup(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.5;
  g.add(mesh);
  return g;
}

describe('FURNITURE_LIST', () => {
  it('覆盖 5 件核心家具', () => {
    expect(FURNITURE_LIST).toContain('sofa');
    expect(FURNITURE_LIST).toContain('bed');
    expect(FURNITURE_LIST).toContain('table');
    expect(FURNITURE_LIST).toContain('chair');
    expect(FURNITURE_LIST).toContain('cabinet');
    expect(FURNITURE_LIST).toHaveLength(5);
  });
});

describe('loadFurniture', () => {
  beforeEach(() => {
    _resetFurnitureCacheForTest();
    vi.restoreAllMocks();
    stubKTX2DetectSupport();
    stubDracoDecoderPath();
  });

  it('加载失败（文件缺失）返回 null，不抛异常', async () => {
    const loadAsyncSpy = vi.fn(() => Promise.reject(new Error('file not found')));
    setGLTFLoadAsyncMock(loadAsyncSpy);

    const result = await loadFurniture('sofa', mockRenderer());
    expect(result).toBeNull();
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it('缓存命中：第二次同 key 调用不重复 loadAsync', async () => {
    const fakeScene = unitCuboidGroup();
    const loadAsyncSpy = vi.fn(() => Promise.resolve({ scene: fakeScene }));
    setGLTFLoadAsyncMock(loadAsyncSpy);

    const r1 = await loadFurniture('sofa', mockRenderer());
    const r2 = await loadFurniture('sofa', mockRenderer());
    expect(r1).toBe(fakeScene);
    expect(r2).toBe(fakeScene);
    // loadAsync 只调用一次（第二次命中 cache）
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
  });
});

describe('snapToWall', () => {
  it('obj 靠近墙（<0.08m）时贴到距墙 0.05m，并对齐墙法线', () => {
    const g = unitCuboidGroup();
    // 墙 a=(1,0), b=(2,0)：沿 x 方向
    // 左侧法线 nx=0, nz=-1，指向 -z
    // obj 中心放在 (1.5, 0.5, 0.03)：距墙 0.03m（<0.08 threshold）
    g.position.set(1.5, 0, 0.03);
    g.updateMatrixWorld(true);

    const wall = { a: [1, 0] as const, b: [2, 0] as const };
    snapToWall(g, wall);

    // 目标距墙 0.05m，方向 -z：obj 中心应移到 (1.5, 0.5, -0.05)
    expect(g.position.x).toBeCloseTo(1.5, 4);
    expect(g.position.z).toBeCloseTo(-0.05, 4);
    // 绕 Y 旋转到法线方向：targetYaw = atan2(0, -1) = π
    expect(g.rotation.y).toBeCloseTo(Math.PI, 4);
  });

  it('obj 远离墙（>0.08m）时不动', () => {
    const g = unitCuboidGroup();
    // 墙 a=(1,0), b=(2,0)：沿 x 方向，法线 -z
    // obj 中心放在 (1.5, 0.5, 0.5)：距墙 0.5m（>0.08 threshold）
    g.position.set(1.5, 0, 0.5);
    g.rotation.y = 0.4;
    g.updateMatrixWorld(true);

    const wall = { a: [1, 0] as const, b: [2, 0] as const };
    const beforePos = g.position.clone();
    const beforeRot = g.rotation.y;

    snapToWall(g, wall);

    // 远离墙 → 不改动
    expect(g.position).toEqual(beforePos);
    expect(g.rotation.y).toBe(beforeRot);
  });

  it('沿 z 方向的墙：法线朝向正确', () => {
    const g = unitCuboidGroup();
    // 墙 a=(0,1), b=(0,2)：沿 z 方向
    // 左侧法线 (wuz, -wux) = (1, 0) 指向 +x
    // obj 中心放在 (0.03, 0.5, 1.5)：距墙 0.03m（在 +x 侧）
    g.position.set(0.03, 0, 1.5);
    g.updateMatrixWorld(true);

    const wall = { a: [0, 1] as const, b: [0, 2] as const };
    snapToWall(g, wall);

    // 目标距墙 0.05m，方向 +x
    expect(g.position.x).toBeCloseTo(0.05, 4);
    expect(g.position.z).toBeCloseTo(1.5, 4);
    // targetYaw = atan2(1, 0) = π/2
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 4);
  });
});
