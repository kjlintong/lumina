# P23 规格：上传户型图 → 比例尺标定 → 3D 墙体挤出

> 前置：P21 数据契约（modeling.ts）、P22 描墙画布 + 户型库模板 + 拓扑校验
> 范围：LUMINA_两周执行规格_hermes.md §6 范围 1/2/3/5（本周不做 4 的自动提取部分）

---

## 1. 上传入口（§6 范围 1）

**UI 组件**：`src/ui/panels/ImportPanel.tsx`
- `<input type="file" accept="image/*">` 拖拽或点击上传
- 支持 JPG/PNG；PDF 显示「本期仅支持图片格式」提示
- 上传后显示缩略图预览（max 400px 宽）
- 显示分档 SLA 提示（来自 `importers.ts` 的 `describeImporter`）
- 上传的图片存入 store 的 `importedImage: ImageBitmap | null`

**Store 扩展**：`modelingStore.ts` 增加：
- `importedImage: ImageBitmap | null`
- `calibrationPoints: [x, y][]`（SVG 坐标，用于两点标定）
- `calibration: ScaleCalibration | null`
- `calibrateScale(measuredPx: number, realDistance: number, unit: LengthUnit)`
- `clearImport()`（清空图片和标定）

---

## 2. 比例尺标定（§6 范围 2，P0 门禁）

**交互流程**：
1. 上传图片后进入「标定模式」
2. 在图片上点击两点（标注一段已知长度的线段，如「这段 = 3m」）
3. 输入实际距离 + 选择单位（m/mm/cm/in/ft）
4. `scale.ts` 的 `calibrate()` 计算 `toMeters`，`confirmScale()` 门禁验证
5. 标定成功 → `importedImage.calibration` 挂上，`model.track` 更新为 `'scan'`
6. 标定失败（超出合理区间）→ 显示错误提示，不继续

**UI**：
- 两点标定画布（与 `ModelCanvas` 同构，但坐标系是图片像素）
- 标定状态指示器：未标定 / 已标定 / 标定失败
- 单位选择器 + 距离输入框 + 确认按钮

**红线**：`unitConfirmed === true` 是门禁字段，`confirmScale()` 返回 false 时不得继续。

---

## 3. 图像预处理（§6 范围 3）

**最小实现**：`src/core/imagePreprocess.ts`
- `toGrayscale(imageData)`: RGB → 灰度
- `binarize(imageData, threshold)`: 灰度 → 二值（Otsu 或固定阈值）
- `detectLines(imageData)`: 返回简单线段列表（`{ x1, y1, x2, y2, confidence }`）
- `preprocessForCalibration(imageData)`: 组合以上步骤

**不做**（本阶段）：透视校正、去阴影、OCR 提取标注文字

---

## 4. 3D 墙体挤出（§6 范围 5，核心交付）

**新文件**：`src/render/modelRoomBuilder.ts`

从 `ModelGeometry` 构建完整 3D 房间组（替换 P22 的 `rebuildRoom` 简化实现）：

```
ModelGeometry
  ├── walls[] → BoxGeometry 挤出（保留 thickness + height）
  ├── openings[] → 沿墙布尔切割（门=缺口，窗=玻璃面）
  ├── rooms[] → 房间标签（可选地面区域着色）
  ├── slab → 地板 + 天花（PlaneGeometry）
  └── calibration → 世界坐标缩放系数
```

**函数签名**：
```ts
export function buildModelRoom(model: ModelGeometry): Group {
  // 1. 地板：PlaneGeometry，按包围盒尺寸
  // 2. 天花：PlaneGeometry，y = slab.ceilingH
  // 3. 墙体：每条 WallSegment → BoxGeometry(wallLength, height, thickness)
  //    - 位置：段中点，y = height/2
  //    - 旋转：沿 a→b 方向的 atan2
  //    - 墙段端点连通处理（T 形/十字交叉）
  // 4. 开口：沿墙切割（门=移除一段墙 + 门框；窗=玻璃 MeshPhysicalMaterial）
  // 5. 材质分配：地板=木地板、墙=涂料、天花=白色
}
```

**材质**（复用 `materials.ts` 的参数）：
- 地板：roughness 0.35–0.45，albedo #8B7355
- 墙面：roughness 0.90，color #F5F5F0
- 天花：roughness 0.95，color #FFFFFF
- 门：color #6B4423，roughness 0.6
- 窗玻璃：MeshPhysicalMaterial，transmission 1.0, ior 1.5, roughness 0.05

**App.tsx 集成**：
- `rebuildRoom` 改为调用 `buildModelRoom(model)`
- 无 model 时回退到既有 `buildRoom(6, 4.5, 2.8)`

---

## 5. 测试要求

| 文件 | 必测点 |
|---|---|
| `imagePreprocess.test.ts` | ① toGrayscale 输出正确灰度值；② binarize 在阈值 128 时正确二值化；③ detectLines 对已知线段图像返回 ≥1 条线 |
| `modelRoomBuilder.test.ts` | ① buildModelRoom 对空 model 返回空 Group；② 有 walls 时返回的 Group 含 Mesh；③ 有 openings 时返回含玻璃材质 Mesh；④ 材质参数符合规格值 |
| `importPanel.test.tsx` | ① 渲染上传按钮；② 选择文件后显示预览；③ 标定模式下点击两点记录坐标；④ confirmScale 返回 false 时显示错误；⑤ clearImport 清空状态 |

---

## 6. 红线

1. **内部 SI 单位**：所有几何体坐标以米为权威（`modeling.ts` 铁律 1）
2. **未标定不参与判定**：`calibration: null` 时 `topology.ts` 的 `scale_self_consistent` 判违规
3. **`unitConfirmed === true` 是门禁**：`confirmScale()` 返回 false 时不得继续（红线不可绕过）
4. **CAD/IFC 本期不做**：UI 显示「敬请期待」，数据层 `available: false`
5. **tsc --noEmit 0 error + npm test 全绿**
