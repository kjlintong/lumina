# P25 规格：自动墙体提取

> 上游：`LUMINA_两周执行规格_hermes.md` §6 范围 4
> 前置：P23 上传 + 标定已完成（importImage → confirmCalibration → ModelGeometry.calibration）
> 范围：图像预处理升级（边缘检测 + 霍夫变换）+ 线段合并 + 轮廓提取 + ModelGeometry 构造 + UI 集成
> 约束：纯 TypeScript，无外部依赖；扫描图路径不承诺统一误差，但必须有置信度

---

## 0. 当前状态

| 项 | 状态 | 说明 |
|---|---|---|
| 上传入口 | ✅ | ImportPanel.tsx 299 行，JPG/PNG 上传+预览 |
| 标定 | ✅ | scale.ts calibrate() + confirmCalibration 写入 model.calibration |
| 预处理 | ⚠️ 最小 | imagePreprocess.ts 140 行，仅灰度化+二值化+水平/垂直暗像素扫描 |
| 自动提取 | ❌ | 无边缘检测、无霍夫变换、无线段合并、无轮廓提取 |
| 描墙兜底 | ✅ | ModelCanvas.tsx 交互描墙 |
| 3D 挤出 | ✅ | modelRoomBuilder.ts + rebuildFromModel |

**当前 detectLines 的问题**：
- 只扫描水平/垂直方向的暗像素（二进制 === 0），无法检测斜线
- 没有边缘检测（Sobel/Canny），直接拿二值图扫描
- 没有霍夫变换（Hough Transform），无法检测任意角度的直线
- 没有线段合并（近共线线段应合并成一条）
- 没有轮廓提取（从线段中找首尾相连的多边形）
- 没有坐标转换（像素 → 米）
- 没有构造 ModelGeometry（WallSegment + RoomPolygon + calibration）

---

## 1. 技术方案

### 1.1 预处理升级（imagePreprocess.ts）

保留现有灰度化 + 二值化，新增：

#### 1.1.1 Otsu 自动阈值

```typescript
export function otsuThreshold(gray: Uint8ClampedArray): number;
```

- 遍历灰度直方图（0-255）
- 计算类间方差
- 返回最大类间方差对应的阈值
- 替代当前固定 threshold=128

#### 1.1.2 Sobel 边缘检测

```typescript
export function sobelEdges(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray;
```

- 计算 x/y 方向的 Sobel 梯度
- 合成梯度幅值（sqrt(gx² + gy²)）
- 返回边缘强度图（0-255）

Sobel 核：
```
Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]
```

#### 1.1.3 霍夫变换（Hough Transform）

```typescript
export function houghLines(
  edges: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    threshold?: number;      // 累加器阈值，默认 100
    minSegmentLength?: number; // 最短线段长度（像素），默认 50
    maxAngleDiff?: number;   // 线段合并角度差（度），默认 5
  }
): HoughLine[];
```

- 极坐标累加器（ρ, θ）
- ρ 范围：0 到 max(width, height) * 1.5
- θ 范围：0 到 180 度，步长 1 度
- 对边缘像素投票
- 找局部峰值
- 从峰值反推线段端点

返回值：
```typescript
export interface HoughLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;    // 度，0-180
  votes: number;    // 累加器票数
}
```

### 1.2 线段合并（lineMerging.ts）

```typescript
export function mergeLines(
  lines: HoughLine[],
  options?: {
    maxAngleDiff?: number;   // 最大角度差（度），默认 5
    maxEndpointDist?: number; // 最大端点距离（像素），默认 10
    maxGap?: number;         // 最大间隙（像素），默认 5
  }
): MergedLine[];
```

- 按角度分组
- 同角度组内，找端点接近的线段
- 合并近似共线的线段（延长或截断到端点中点）
- 移除短于 minSegmentLength 的线段

返回值：
```typescript
export interface MergedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;
  votes: number;
}
```

### 1.3 轮廓提取（contourExtraction.ts）

```typescript
export function extractContours(
  lines: MergedLine[],
  options?: {
    maxEndpointDist?: number; // 端点匹配距离（像素），默认 10
    maxGap?: number;          // 最大间隙（像素），默认 10
  }
): Contour[];
```

- 构建线段图（节点 = 端点，边 = 线段）
- 找端点距离 < maxEndpointDist 的线段对
- DFS/BFS 搜索闭合路径（首尾相连）
- 过滤面积过小（< minArea）的多边形
- 过滤顶点数过少（< 3）的多边形

返回值：
```typescript
export interface Contour {
  points: [number, number][]; // 像素坐标
  area: number;              // 像素²
  isClosed: boolean;
}
```

### 1.4 坐标转换 + ModelGeometry 构造（wallExtractor.ts）

```typescript
export function extractWalls(
  image: ImageBitmap,
  calibration: ScaleCalibration,
  options?: {
    minWallLength?: number;  // 最短墙体长度（米），默认 0.3
    minRoomArea?: number;    // 最小房间面积（米²），默认 1.0
  }
): Promise<ExtractResult>;
```

流程：
1. ImageBitmap → ImageData → Uint8ClampedArray
2. 灰度化 → Otsu 阈值 → 二值化
3. Sobel 边缘检测
4. 霍夫变换
5. 线段合并
6. 轮廓提取
7. 像素 → 米坐标转换（用 calibration.toMeters）
8. 构造 WallSegment + RoomPolygon
9. 构造 ModelGeometry（calibration + track='scan'）

返回值：
```typescript
export interface ExtractResult {
  model: ModelGeometry;
  lines: MergedLine[];        // 提取的线段（供 UI 预览）
  contours: Contour[];        // 提取的轮廓（供 UI 预览）
  stats: {
    edgePixels: number;       // 边缘像素数
    houghLines: number;       // 霍夫线段数
    mergedLines: number;      // 合并后线段数
    contours: number;         // 轮廓数
    walls: number;            // 墙体数
    rooms: number;            // 房间数
    totalWallLength: number;  // 总墙长（米）
    totalRoomArea: number;    // 总面积（米²）
  };
}
```

构造 ModelGeometry：
- walls：从合并后的线段构造 WallSegment
  - id：`auto_w${index}`
  - a, b：像素坐标 × calibration.toMeters
  - thickness：0.15（DEFAULT_WALL_THICKNESS）
  - height：2.8（默认层高）
  - confidence：LOW_CONFIDENCE_THRESHOLD（扫描图路径）
  - provenance：{ source: 'scan', method: 'hough' }

- rooms：从轮廓构造 RoomPolygon
  - id：`auto_r${index}`
  - name：`房间 ${index + 1}`
  - vertices：像素坐标 × calibration.toMeters
  - labeledArea：shoelace 面积（米²）
  - confidence：LOW_CONFIDENCE_THRESHOLD
  - provenance：{ source: 'scan', method: 'contour' }

- calibration：传入的 calibration
- track：{ track: 'scan', guaranteesUniformError: false }

### 1.5 UI 集成（ImportPanel.tsx）

标定完成后，新增「自动提取」按钮：

```typescript
// ImportPanel.tsx 新增
const [extracting, setExtracting] = useState(false);
const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);

async function handleAutoExtract() {
  const { importedImage, calibrationPoints } = useModelingStore.getState();
  if (!importedImage || calibrationPoints.length < 2) return;

  setExtracting(true);
  try {
    // 用现有标定信息构造 ScaleCalibration
    const p1 = calibrationPoints[0];
    const p2 = calibrationPoints[1];
    const measuredPx = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
    const calibration = calibrate(measuredPx, realDistance, unit);
    
    const result = await extractWalls(importedImage, calibration);
    setExtractResult(result);
    
    // 写入 store
    useModelingStore.setState({ model: result.model });
  } finally {
    setExtracting(false);
  }
}
```

UI：
- 标定完成后显示「自动提取」按钮
- 提取中显示 loading 状态
- 提取完成后显示统计（线段数、轮廓数、墙体数、房间数、总面积）
- 显示提取置信度（LOW_CONFIDENCE）
- 提供「描墙修正」按钮（回到手动描墙模式）

---

## 2. 测试

### 2.1 单元测试（纯算法）

- `otsuThreshold`：给定灰度数组，返回合理阈值
- `sobelEdges`：给定灰度图，返回边缘强度图
- `houghLines`：给定边缘图，检测出主要线条
- `mergeLines`：近似共线的线段合并成一条
- `extractContours`：从线段中提取闭合多边形
- `extractWalls`：给定 ImageBitmap + calibration，返回 ModelGeometry

### 2.2 集成测试

- 标定后提取：上传 → 标定 → 自动提取 → ModelGeometry 构造正确
- 置信度：扫描图路径 confidence = LOW_CONFIDENCE_THRESHOLD
- track：扫描图路径 track = 'scan'
- 坐标转换：像素坐标 × toMeters = 米坐标

### 2.3 边界测试

- 空图像：返回空 ModelGeometry
- 无边缘：返回空 ModelGeometry
- 无轮廓：返回空 ModelGeometry（只有墙体）
- 单线段：不构造轮廓（顶点数 < 3）
- 过小面积：过滤掉（< minRoomArea）

---

## 3. 分档承诺

### 扫描图路径（track='scan'）

- **不承诺统一误差**：户型图质量参差不齐（拍照角度、光照、分辨率）
- **必须有置信度**：LOW_CONFIDENCE_THRESHOLD，UI 明确显示「低置信度，建议描墙修正」
- **必须有描墙兜底**：自动提取是草稿，用户可以手动修正

### CAD 路径（track='cad'，后续迭代）

- 承诺统一误差（< 1%）
- 高精度提取（矢量化 PDF/SVG）
- 不需要描墙兜底

---

## 4. 不做（明确排除）

| 项 | 理由 |
|---|---|
| PDF/SVG 矢量导入 | CAD 路径，后续迭代 |
| 透视校正 | 最小实现，不承诺扫描图质量 |
| 去阴影 | 最小实现，不承诺扫描图质量 |
| OCR 识别房间名 | 最小实现，不承诺扫描图质量 |
| 自动识别门窗开口 | 墙体提取先做对，开口后续迭代 |
| 自动分配材质 | 材质手动选，规格第 1 周 |

---

## 5. 验收清单

### 核心算法
- [ ] otsuThreshold：Otsu 自动阈值
- [ ] sobelEdges：Sobel 边缘检测
- [ ] houghLines：霍夫变换检测直线
- [ ] mergeLines：线段合并
- [ ] extractContours：轮廓提取
- [ ] extractWalls：完整提取流程

### ModelGeometry 构造
- [ ] WallSegment：id, a, b, thickness, height, confidence, provenance
- [ ] RoomPolygon：id, name, vertices, labeledArea, confidence, provenance
- [ ] calibration：传入的 ScaleCalibration
- [ ] track：{ track: 'scan', guaranteesUniformError: false }

### UI 集成
- [ ] ImportPanel 新增「自动提取」按钮
- [ ] 提取中显示 loading
- [ ] 提取完成后显示统计
- [ ] 显示置信度（LOW_CONFIDENCE）
- [ ] 提供「描墙修正」按钮

### 测试
- [ ] 单元测试：6 个算法函数
- [ ] 集成测试：标定后提取
- [ ] 边界测试：空图像、无边缘、无轮廓
- [ ] tsc --noEmit 0 error
- [ ] vitest run 全绿（基线 742 + 新增）
