# P35 家具资产占位（未提供 CC0 GLB）

**本目录当前为空**，家具走程序化 fallback（`src/render/furniture.ts` 的
`buildFurniture`），覆盖所有 `zone.type`（sleep/work/dining/lounge/kitchen/
bathroom/reading/nursery/wardrobe/entry）。视觉不会退化——每件家具都有独立
造型（沙发=座+靠背+扶手，床=床垫+床头板，餐桌=桌面+四腿等），且都
`castShadow = receiveShadow = true`。

## 为什么没放 GLB

- P35 执行规格要求「5 件核心家具 GLB，全部 CC0，可商用无需署名」。
- WSL2 侧实测连通性（2026-09-29）：
  - `dl.polyhaven.org` → HTTP 521（Cloudflare 拦 curl）
  - `quaternius.com` / `ambientcg.com` → 站点首页可访问，但家具 GLB 直链
    走 itch.io 或需要登录才能下载
  - `sketchfab` → 需要 access token
  - `raw.githubusercontent.com` → 大文件 404（dev 分支被清理）
  - `cdn.jsdelivr.net/gh/mrdoob/three.js` → **可用**（HDRI 就是从这抓的）
- 结论：CC0 家具 GLB 没有免登录的公开 CDN 源。程序化 fallback 是当前的
  合理降级路径。

## 如果后续要放真实 GLB

放在这个目录，文件名对齐 `FurnitureKey`（`src/render/furnitureAssets.ts`）：

```
public/assets/furniture/
├── sofa.glb      # 沙发
├── bed.glb       # 双人床
├── table.glb     # 餐桌
├── chair.glb     # 餐椅
└── cabinet.glb   # 柜子
```

建议来源（需要登录下载）：
- Quaternius Modern Furniture 合集（itch.io，个人免费层可下载）
- Sketchfab 上带「CC0」或「Commercial Use」标签的家具模型
- ambientCG 3D Models 页（`ambientcg.com/view?id=...`，USDZ/GLTF 格式）

loader 逻辑（`src/render/furnitureAssets.ts:68` `loadFurniture`）已经写好：
- 归一化高度到 1m
- Draco / KTX2 支持已接入
- 失败自动回落 `buildFurniture`

## 与 HDRIs 的区别

`../hdris/*.hdr` 里的 3 张 HDRI **已经落地**（three.js 示例 CC0，通过
jsdelivr CDN 下载），所以环境反射走真实 HDR，不是 `RoomEnvironment` fallback。
