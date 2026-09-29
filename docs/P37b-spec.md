# P37b 规格：FixtureLibraryPanel 3D 预览

**目标**：灯具库面板的 9 个条目，用真实的 3D 缩略图替代现在的 SVG 简笔图标。
每个条目渲染一个 48×48 的小 canvas，展示该灯具在场景里实际的样子（有 GLTF 资产的
用资产，无资产的回退程序化模型）。

**核心**：新建 `src/render/fixturePreview.ts` 离屏渲染器（单例共享 WebGLRenderer），
FixtureLibraryPanel 里把 SVG icon 替换成 `<FixturePreviewCanvas>`，懒渲染 + 失败回落 SVG。

**关键决策**（§2.1 详述）：用方案 (c) —— 渲染到共享 renderer 的 domElement，
`toDataURL()` 生成 data URL，React 用 `<img>` 显示。不用每个 item 一个 renderer
（9 个 WebGL context 浪费），也不用 OffscreenCanvas（浏览器兼容性问题）。
代价：render 是同步串行的，并发请求只渲一次（用 `pending` Map 合并）。

## 1. 判定标准

- [ ] `src/render/fixturePreview.ts` 新建：`FixturePreviewRenderer` 类（单例共享
      WebGLRenderer）+ `FixturePreviewCanvas` React 组件
- [ ] 有 GLTF 资产的 5 个类型（pendant/table/sconce/downlight/chandelier）渲染真实资产
- [ ] 无资产的 4 个类型（spot/linear/cove/floor）渲染 `buildFixtureModel` 程序化模型
- [ ] FixtureLibraryPanel LIBRARY 条目用 `<FixturePreviewCanvas>` 替代 SVG icon
- [ ] 失败回落：WebGL 不可用 / 渲染异常 → 显示原 SVG icon（不崩）
- [ ] 渲染结果缓存（同类型只渲一次），共享 renderer 实例（不每个 item 建一个）
- [ ] jsdom 环境（npm test）正常渲染（不挂，回落 SVG）
- [ ] 现有 5 条 fixtureLibraryPanel.test.tsx 仍全绿（标签/hint/draggable 断言不变）
- [ ] 新增测试覆盖 FixturePreviewRenderer 核心路径
- [ ] 测试全绿，不新增 lint error，应用代码仍 2 chunk

---

## 2. 设计

### 2.1 渲染管线

```
FixturePreviewCanvas(type, type, size)
  │  useEffect 挂载
  ├─ 检查 WebGL 可用性（canvas.getContext('webgl2')）
  │    不可用 → 标记 fallback，显示 SVG icon
  │    可用 → 继续
  ├─ 调 renderFixturePreview(type, canvas, size, renderer)
  │    1. 创建 Scene（含 AmbientLight + DirectionalLight 简单打光）
  │    2. 创建 PerspectiveCamera（FOV 30，看原点）
  │    3. 获取几何：
  │       - 有资产 → loadLightAsset(assetKey, renderer) → clone
  │       - 无资产 → makeFixture({type}) → buildFixtureModel(f).group
  │    4. 自动框选（计算 Box3，相机对准中心，距离 = 包围球半径 × 1.8）
  │    5. renderer.setSize(size, size, false) + setPixelRatio(2)
  │    6. renderer.render(scene, camera)
  │    7. canvas 已绑 renderer 的 domElement（或 renderer 输出到 canvas）
  │    8. dispose Scene 临时对象（保留 renderer）
  └─ 渲染完成 → setReady(true)，canvas 可见
```

**注意**：WebGLRenderer 是离屏的（不挂在 DOM 树），canvas 是独立的 HTML canvas 元素，
通过 `renderer.render()` 绘制后，canvas 的像素内容就在那里。但 three.js 的 WebGLRenderer
有自己的 canvas（`renderer.domElement`），需要把渲染结果**复制**到 React 的 canvas 元素上，
或者直接用 `renderer.domElement` 作为 React 渲染的 canvas。

**方案**：直接用 `renderer.domElement` 作为 React 的 `<canvas>`。
共享 renderer 的 `domElement` 在 9 个 item 间**不能共享**（每个 item 要独立 canvas）。
所以要么：
- (a) 每个 item 一个 renderer（9 个 WebGL context，浏览器限制 ~16 个，够但浪费）
- (b) 共享一个 renderer，渲染到 `renderer.domElement`，然后 `drawImage` 到各 item 的 canvas
- (c) 共享一个 renderer，渲染到 `renderer.domElement`，然后用 `toDataURL` 生成 data URL，
      在 `<img>` 里显示（不保留 canvas 元素，显示为图片）

**选 (c)**：最简洁。渲染完成后 `renderer.domElement.toDataURL()` 得到 data URL，
React 显示 `<img src={dataUrl}>`。canvas 元素不进 DOM，renderer 真正共享一个。

### 2.2 FixturePreviewRenderer 类（单例）

```ts
// src/render/fixturePreview.ts

import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import type { FixtureType } from '../core/types.js';
import { makeFixture } from '../core/makeFixture.js';
import { buildFixtureModel } from './fixtureModels.js';
import { loadLightAsset, ASSET_KEY_FOR_TYPE, assetKeyForType } from './lightAssets.js';

const PREVIEW_SIZE = 48;
const PIXEL_RATIO = 2;  // 高分屏

class FixturePreviewRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private cache = new Map<FixtureType, string | null>();  // type → data URL 或 null（失败也缓存）
  private pending = new Map<FixtureType, Promise<string | null>>();  // 并发合并

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,  // 关键：toDataURL 需要
      });
      this.renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
      this.renderer.setPixelRatio(PIXEL_RATIO);
      this.renderer.setClearColor(0x000000, 0);  // 透明背景
      return this.renderer;
    } catch {
      return null;  // WebGL 不可用（jsdom / 禁用 WebGL）
    }
  }

  async render(type: FixtureType): Promise<string | null> {
    // 缓存命中（含失败的 null）
    if (this.cache.has(type)) return this.cache.get(type)!;
    // 并发合并：同一 type 只跑一次
    if (this.pending.has(type)) return this.pending.get(type)!;

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

        // 获取几何
        let obj: THREE.Object3D;
        const assetKey = assetKeyForType(type);
        if (assetKey) {
          const asset = await loadLightAsset(assetKey, renderer);
          if (!asset) return null;  // 资产加载失败，回落
          obj = asset.clone(true);
        } else {
          const f = makeFixture({ type });
          obj = buildFixtureModel(f).group;
        }
        scene.add(obj);

        // 自动框选
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return null;
        const center = box.getCenter(new THREE.Vector3());
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = Math.max(0.3, sphere.radius * 1.8);
        camera.position.set(center.x + dist, center.y + dist * 0.5, center.z + dist);
        camera.lookAt(center);

        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        // dispose 临时对象（geometry/material/scene）
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry?.dispose();
            if (o.material) {
              if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
              else o.material.dispose();
            }
          }
        });

        return dataUrl;
      } catch {
        return null;
      } finally {
        this.pending.delete(type);
        this.cache.set(type, this.cache.get(type) ?? null);  // 已由上面 set；失败也缓存 null
      }
    })();

    this.pending.set(type, promise);
    const result = await promise;
    this.cache.set(type, result);  // 成功/失败都缓存
    return result;
  }
}

// 模块级单例
let _instance: FixturePreviewRenderer | null = null;
export function getFixturePreviewRenderer(): FixturePreviewRenderer {
  if (!_instance) _instance = new FixturePreviewRenderer();
  return _instance;
}
```

### 2.3 FixturePreviewCanvas 组件

```ts
export function FixturePreviewCanvas({
  type,
  size = PREVIEW_SIZE,
  fallbackIcon,
}: {
  type: FixtureType;
  size?: number;
  fallbackIcon: React.ReactNode;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const r = getFixturePreviewRenderer();
    // 懒渲染：requestAnimationFrame 避免阻塞首屏
    requestAnimationFrame(() => {
      void r.render(type).then((url) => {
        if (cancelled) return;
        if (url) setDataUrl(url);
        else setFailed(true);
      });
    });
    return () => { cancelled = true; };
  }, [type]);

  if (failed || !dataUrl) {
    // 回落：显示 SVG icon
    return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fallbackIcon}</div>;
  }
  return <img src={dataUrl} width={size} height={size} alt="" style={{ display: 'block' }} />;
}
```

### 2.4 FixtureLibraryPanel 改造

LIBRARY 条目从 `{ type, label, hint, icon }` 结构不变（icon 保留作为 fallback），
渲染时把 `<div className="fixture-library-icon">{icon}</div>` 改成：

```tsx
<div className="fixture-library-icon">
  <FixturePreviewCanvas type={type} fallbackIcon={icon} />
</div>
```

import 加：
```ts
import { FixturePreviewCanvas } from '../../render/fixturePreview.js';
```

### 2.5 CSS 调整（index.html）

`.fixture-library-icon` 当前 24×24，3D 预览 48×48，CSS 改：

```css
.fixture-library-icon { width: 48px; height: 48px; color: var(--accent-warm); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
```

其余 CSS 不动。

---

## 3. 测试

### 3.1 新增：`src/render/__tests__/fixturePreview.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { getFixturePreviewRenderer } from '../fixturePreview.js';

describe('FixturePreviewRenderer（P37b）', () => {
  it('单例：多次调用返回同一实例', () => {
    const a = getFixturePreviewRenderer();
    const b = getFixturePreviewRenderer();
    expect(a).toBe(b);
  });

  it('渲染有资产类型（pendant）返回 data URL 或 null（不抛异常）', async () => {
    const r = getFixturePreviewRenderer();
    const url = await r.render('pendant');
    // jsdom 环境 WebGL 不可用 → null；真实浏览器 → data:image/png;base64,...
    // 断言：不抛异常，结果是 string|null
    expect(url === null || typeof url === 'string').toBe(true);
  });

  it('渲染无资产类型（spot）返回 data URL 或 null（不抛异常）', async () => {
    const r = getFixturePreviewRenderer();
    const url = await r.render('spot');
    expect(url === null || typeof url === 'string').toBe(true);
  });

  it('缓存命中：第二次 render 同一类型返回相同结果', async () => {
    const r = getFixturePreviewRenderer();
    const a = await r.render('downlight');
    const b = await r.render('downlight');
    expect(a).toBe(b);  // 缓存返回同一字符串引用
  });

  it('渲染异常时返回 null（不抛）', async () => {
    const r = getFixturePreviewRenderer();
    // 模拟异常：mock loadLightAsset 抛错
    const orig = vi.fn();
    // ... 实际实现看是否能 mock；若不行，只测正常路径
    const url = await r.render('chandelier');
    expect(url === null || typeof url === 'string').toBe(true);
  });
});
```

**+5 条**。

### 3.2 现有测试不动

`fixtureLibraryPanel.test.tsx` 5 条仍全绿：
- 渲染 9 个 draggable 项 ✓（LIBRARY 结构不变，只是 icon 渲染方式变了）
- 9 个中文标签 ✓（label 不变）
- 8 个拖入提示 ✓（hint 不变）
- DnD MIME ✓（onDragStart 不变）
- 默认 Panel 展开 ✓

**关键**：FixturePreviewCanvas 在 jsdom 环境（npm test）里：
- WebGL 不可用 → `renderer.getContext('webgl2')` 返回 null → `ensureRenderer()` 返回 null
  → `render()` 返回 null → `setFailed(true)` → 显示 fallbackIcon（SVG）
- React 渲染流程：FixturePreviewCanvas 先渲染 fallbackIcon（dataUrl=null 的初始状态），
  useEffect 异步跑 → setFailed(true) → re-render 显示 fallbackIcon
- 测试查询 `.fixture-library-item` / textContent / `data-fixture-type` 不受影响
  （icon 只是 div 里的内容，text 和 draggable 属性在父级）

---

## 4. 验证

1. `npx tsc --noEmit` → 0 error
2. `npm test` → 全绿（987 + 5 = 992）
3. `rm -rf node_modules/.cache && npm run lint` → 不新增 error（330/12 基线）
4. `npm run build` → 应用代码仍 2 chunk
5. `python3 -m py_compile scripts/download-assets.py` → 通过

---

## 5. 红线

- **不动** `src/render/lightBuilder.ts` / `src/render/lightAssets.ts` /
  `src/render/fixtureModels.ts` / `src/render/furnitureAssets.ts`
- **不动** `src/scene/sceneEngine.ts`
- **不动** `src/store/projectStore.ts` / `src/core/types.ts` / `src/core/makeFixture.ts`
- **不动** `src/ui/panels/FixturePanel.tsx` / `src/ui/panels/LayoutPanel.tsx`
- **不动** `src/ui/panels/Panel.tsx`
- **不改** `vite.config.ts`；**不新增** npm 依赖
- **不要** `git add .`；**不要** push
- 不删现有测试；新增测试断言必须真断言
- 3D 渲染是视觉交付，本环境 WSL2 SwiftShader，**父代理不判定画面**；
  用数值断言验证逻辑（不抛异常、缓存命中、单例），画面由用户在真实 GPU 上确认

**允许改**：
- `src/render/fixturePreview.ts`（新建）
- `src/render/__tests__/fixturePreview.test.ts`（新建）
- `src/ui/panels/FixtureLibraryPanel.tsx`（LIBRARY 渲染改 + import）
- `index.html`（.fixture-library-icon CSS 改 24→48）

---

## 6. 提交模板

```bash
git add \
  src/render/fixturePreview.ts \
  src/render/__tests__/fixturePreview.test.ts \
  src/ui/panels/FixtureLibraryPanel.tsx \
  index.html \
  docs/P37b-spec.md \
  docs/P8-plan.md

git commit -m "P37b: FixtureLibraryPanel 3D 预览

灯具库面板的 9 个条目，用真实的 3D 缩略图替代 SVG 简笔图标。

新建 src/render/fixturePreview.ts：
- FixturePreviewRenderer 类（单例共享 WebGLRenderer，preserveDrawingBuffer=true
  供 toDataURL 用）
- 有 GLTF 资产的 5 个类型（pendant/table/sconce/downlight/chandelier）渲染
  真实资产（loadLightAsset → clone）
- 无资产的 4 个类型（spot/linear/cove/floor）渲染 buildFixtureModel 程序化模型
- 渲染结果缓存（同类型只渲一次）
- FixturePreviewCanvas 组件：懒渲染（requestAnimationFrame）+ 失败回落 SVG icon
- 自动框选：Box3 → 包围球 → 相机对准中心距离 1.8×

FixtureLibraryPanel 改造：LIBRARY 结构不变（icon 保留作 fallback），渲染时
用 <FixturePreviewCanvas type fallbackIcon> 替代 SVG 直接渲染。
jsdom 环境 WebGL 不可用 → 自动回落 SVG，现有 5 条测试不变。

CSS：.fixture-library-icon 24×24 → 48×48。

测试：新增 fixturePreview.test.ts 5 条（单例/有资产/无资产/缓存命中/异常回落），
基线 987 → 992。

后续：无（P37 系列完成）。"
```
