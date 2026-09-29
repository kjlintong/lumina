/**
 * 灯具库面板 3D 预览（P37b）。
 *
 * 离屏渲染器：单例共享一个 WebGLRenderer（preserveDrawingBuffer=true 供
 * toDataURL 用），把每个灯具类型渲染成 48×48 的 data URL，React 用 <img> 显示。
 *
 * 有 GLTF 资产的 5 个类型（pendant/table/sconce/downlight/chandelier）渲染
 * 真实资产；无资产的 4 个类型（spot/linear/cove/floor）渲染 buildFixtureModel
 * 程序化模型。
 *
 * 失败回落：WebGL 不可用 / 渲染异常 → 返回 null → FixturePreviewCanvas 显示
 * fallbackIcon（原 SVG）。jsdom 环境（npm test）自动走回落路径。
 *
 * 并发合并：9 个 item 同时 mount 时，pending Map 确保同一 type 只跑一次。
 */

import * as THREE from 'three';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FixtureType } from '../core/types.js';
import { makeFixture } from '../core/makeFixture.js';
import { buildFixtureModel } from './fixtureModels.js';
import { loadLightAsset, assetKeyForType } from './lightAssets.js';

const PREVIEW_SIZE = 48;
const PIXEL_RATIO = 2; // 高分屏

/**
 * 离屏渲染器（单例）。
 *
 * 缓存：cache Map 存渲染结果（含失败的 null），同一 type 只渲一次。
 * 并发：pending Map 合并并发请求，避免 9 个 item 同时 mount 时重复渲染。
 */
class FixturePreviewRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private cache = new Map<FixtureType, string | null>();
  private pending = new Map<FixtureType, Promise<string | null>>();

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      this.renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
      this.renderer.setPixelRatio(PIXEL_RATIO);
      this.renderer.setClearColor(0x000000, 0);
      return this.renderer;
    } catch {
      return null;
    }
  }

  async render(type: FixtureType): Promise<string | null> {
    const cached = this.cache.get(type);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(type);
    if (pending) return pending;

    const promise = (async () => {
      const renderer = this.ensureRenderer();
      if (!renderer) return null;

      try {
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(2, 3, 2);
        scene.add(dir);

        const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

        let obj: THREE.Object3D;
        const assetKey = assetKeyForType(type);
        if (assetKey) {
          const asset = await loadLightAsset(assetKey, renderer);
          if (!asset) return null;
          obj = asset.clone(true);
        } else {
          const f = makeFixture({ type });
          obj = buildFixtureModel(f).group;
        }
        scene.add(obj);

        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return null;
        const center = box.getCenter(new THREE.Vector3());
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = Math.max(0.3, sphere.radius * 1.8);
        camera.position.set(center.x + dist, center.y + dist * 0.5, center.z + dist);
        camera.lookAt(center);

        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        scene.traverse((o) => {
          const mesh = o as THREE.Object3D & {
            isMesh?: boolean;
            geometry?: THREE.BufferGeometry | null;
            material?: THREE.Material | THREE.Material[] | null;
          };
          if (!mesh.isMesh) return;
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });

        return dataUrl;
      } catch {
        return null;
      } finally {
        this.pending.delete(type);
      }
    })();

    this.pending.set(type, promise);
    const result = await promise;
    this.cache.set(type, result);
    return result;
  }

  /** 测试用：清空缓存（不影响 renderer 单例）。 */
  _resetForTest(): void {
    this.cache.clear();
    this.pending.clear();
  }
}

let _instance: FixturePreviewRenderer | null = null;

export function getFixturePreviewRenderer(): FixturePreviewRenderer {
  if (!_instance) _instance = new FixturePreviewRenderer();
  return _instance;
}

/** 测试用：重置单例（不影响已有 renderer 的 cache）。 */
export function _resetFixturePreviewForTest(): void {
  _instance?._resetForTest();
}

/**
 * React 组件：懒渲染 3D 预览，失败回落 SVG icon。
 *
 * 初始状态 dataUrl=null、failed=false → 显示 fallbackIcon（SVG）。
 * useEffect 异步渲染完成后：
 *   - 成功 → setDataUrl(url) → 显示 <img>
 *   - 失败 → setFailed(true) → 仍显示 fallbackIcon
 *
 * jsdom 环境：WebGL 不可用 → render 返回 null → failed=true → 显示 SVG。
 */
export function FixturePreviewCanvas({
  type,
  size = PREVIEW_SIZE,
  fallbackIcon,
}: {
  type: FixtureType;
  size?: number;
  fallbackIcon: ReactNode;
}): ReactNode {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const r = getFixturePreviewRenderer();
    requestAnimationFrame(() => {
      void r.render(type).then((url) => {
        if (cancelled) return;
        if (url) setDataUrl(url);
        else setFailed(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [type]);

  if (failed || !dataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {fallbackIcon}
      </div>
    );
  }
  return <img src={dataUrl} width={size} height={size} alt="" style={{ display: 'block' }} />;
}
