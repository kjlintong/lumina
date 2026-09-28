/**
 * @vitest-environment jsdom
 *
 * P35 Part C：HDRI loader 测试。
 *
 * 覆盖：
 * - loadHdri 加载失败（文件缺失 / 网络失败）返回 null，不抛异常（降级策略）
 * - loadHdri 成功路径写 cache：第二次同 key 调用不重新 loadAsync（缓存命中）
 * - pickHdriBySunElevation 三档分档正确
 * - getHdriUrl 路径符合规格
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import {
  HDRI_LIST,
  getHdriUrl,
  loadHdri,
  pickHdriBySunElevation,
  _resetHdriCacheForTest,
} from '../hdriLoader.js';

vi.mock('three/addons/loaders/HDRLoader.js', () => ({
  HDRLoader: vi.fn().mockImplementation(() => ({
    loadAsync: vi.fn(),
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

/**
 * 用 vi.spyOn 让 PMREMGenerator.fromEquirectangular 返回一个假 envMap Texture，
 * 让 loadHdri 在 jsdom 下也能走完整成功路径（PMREM 真实实现需要 WebGL）。
 */
function mockPmrem(): THREE.Texture {
  const fakeEnvMap = new THREE.DataTexture();
  vi.spyOn(THREE.PMREMGenerator.prototype, 'fromEquirectangular').mockReturnValue({
    texture: fakeEnvMap,
  } as unknown as THREE.WebGLRenderTarget);
  return fakeEnvMap;
}

describe('getHdriUrl', () => {
  it('返回 Vite public/ 下的静态路径', () => {
    expect(getHdriUrl('venice_sunset_2k')).toBe('/assets/hdris/venice_sunset_2k.hdr');
    expect(getHdriUrl('quarry_2k')).toBe('/assets/hdris/quarry_2k.hdr');
    expect(getHdriUrl('venice_night_2k')).toBe('/assets/hdris/venice_night_2k.hdr');
  });
});

describe('pickHdriBySunElevation', () => {
  it('elevation < 0 → venice_night_2k', () => {
    expect(pickHdriBySunElevation(-0.01)).toBe('venice_night_2k');
    expect(pickHdriBySunElevation(-1.0)).toBe('venice_night_2k');
  });

  it('elevation ∈ [0, π/12) → venice_sunset_2k', () => {
    expect(pickHdriBySunElevation(0)).toBe('venice_sunset_2k');
    expect(pickHdriBySunElevation(Math.PI / 12 - 0.001)).toBe('venice_sunset_2k');
    expect(pickHdriBySunElevation(0.1)).toBe('venice_sunset_2k');
  });

  it('elevation ≥ π/12 → quarry_2k', () => {
    expect(pickHdriBySunElevation(Math.PI / 12)).toBe('quarry_2k');
    expect(pickHdriBySunElevation(Math.PI / 4)).toBe('quarry_2k');
    expect(pickHdriBySunElevation(Math.PI / 2)).toBe('quarry_2k');
  });
});

describe('loadHdri', () => {
  beforeEach(() => {
    _resetHdriCacheForTest();
    vi.restoreAllMocks();
    // 默认所有 loadAsync 都 reject（模拟文件缺失）
    (HDRLoader.prototype as unknown as { loadAsync: () => Promise<unknown> }).loadAsync = vi.fn(
      () => Promise.reject(new Error('file not found')),
    );
  });

  it('HDRI_LIST 覆盖三档', () => {
    expect(HDRI_LIST).toContain('venice_sunset_2k');
    expect(HDRI_LIST).toContain('quarry_2k');
    expect(HDRI_LIST).toContain('venice_night_2k');
  });

  it('加载失败（文件缺失 / 网络失败）返回 null，不抛异常', async () => {
    const result = await loadHdri('venice_sunset_2k', mockRenderer());
    expect(result).toBeNull();
  });

  it('缓存命中：loadHdri 第二次同 key 调用不重复 loadAsync', async () => {
    // 模拟成功路径：loadAsync resolve 假 Texture + PMREM 返回假 envMap
    const fakeTex = new THREE.DataTexture();
    const loadAsyncSpy = vi.fn(() => Promise.resolve(fakeTex));
    (HDRLoader.prototype as unknown as { loadAsync: typeof loadAsyncSpy }).loadAsync = loadAsyncSpy;
    const fakeEnvMap = mockPmrem();

    const r1 = await loadHdri('quarry_2k', mockRenderer());
    const r2 = await loadHdri('quarry_2k', mockRenderer());
    // 两次都返回同一 envMap（第二次命中 cache）
    expect(r1).toBe(fakeEnvMap);
    expect(r2).toBe(fakeEnvMap);
    // loadAsync 只被调用一次
    expect(loadAsyncSpy).toHaveBeenCalledTimes(1);
    const calls = loadAsyncSpy.mock.calls as unknown[][];
    expect(calls[0]?.[0]).toBe('/assets/hdris/quarry_2k.hdr');
    fakeTex.dispose();
    fakeEnvMap.dispose();
  });
});
