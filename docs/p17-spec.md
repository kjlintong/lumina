# P17 规格：阴影策略（审查报告 §4 Day 5）

## 目标

按审查报告 §4 Day 5 i「阴影策略」：
1. 太阳：`castShadow`，**2048×2048**（当前 1024），`shadow.camera` **收紧到房间包围盒**，`bias -0.0005`，`normalBias 0.02`
2. 人工灯：只给 **1–2 盏重点灯（餐桌吊灯）** 开 shadow，**1024**；其余全关
3. 兜底：家具底部假接触阴影贴片

## 已核实的现状

- `sceneEngine.ts:96`：`SUN_SHADOW_MAP_SIZE = 1024`（要改 2048）
- `sceneEngine.ts:332-338`：太阳 shadow camera 是 `±10` 米（太大，房间实际 6×4.5 米）
- `sceneEngine.ts:352-353`：`bias = -0.0005`（已对），`normalBias = 0.03`（要改 0.02）
- `lightBuilder.ts:70-73`：`SHADOW_MAP_SIZE = 1024`（SpotLight），`POINT_SHADOW_MAP_SIZE = 512`（PointLight，要改 1024）
- `lightBuilder.ts:96`：`fixtureCastsShadow(type)` 函数——所有灯都可能开 shadow
- `lightBuilder.ts:351, 381`：`point.castShadow = fixtureCastsShadow(f.type)`

## 交付物

### 1. `src/scene/sceneEngine.ts` — 太阳 shadow 升级

**line 96**：
```ts
const SUN_SHADOW_MAP_SIZE = 2048;  // P17：1024 → 2048（审查报告 §4 Day 5 i）
```

**line 332-338**：shadow camera 收紧到房间包围盒。房间是 6×4.5×2.8 米，太阳从北墙外射入，所以 shadow camera 不需要覆盖整个 ±10 米范围。

```ts
this.sunLight.shadow.mapSize.set(SUN_SHADOW_MAP_SIZE, SUN_SHADOW_MAP_SIZE);
// P17：shadow camera 从 ±10 收紧到房间包围盒 ±6 米。旧 ±10 让 2048 分辨率
// 覆盖 20×20 米范围（每像素 1cm），新 ±6 让 2048 覆盖 12×12 米（每像素 5mm），
// 阴影边缘更锐利，且太阳从北墙射入时不需要覆盖东/西/南的远处。
// 代价：太阳方位偏斜时（比如日落西北角），房间边缘可能被 shadow camera 裁掉。
// 取折中值 ±6，覆盖对角线 8.5 米的房间 + 2 米余量。
this.sunLight.shadow.camera.near = 0.5;
this.sunLight.shadow.camera.far = 50;
this.sunLight.shadow.camera.left = -6;
this.sunLight.shadow.camera.right = 6;
this.sunLight.shadow.camera.top = 6;
this.sunLight.shadow.camera.bottom = -6;
```

**line 352-353**：
```ts
this.sunLight.shadow.bias = -0.0005;   // 保持不变
this.sunLight.shadow.normalBias = 0.02; // P17：0.03 → 0.02（审查报告 §4 Day 5 i）
```

### 2. `src/render/lightBuilder.ts` — 人工灯只给 1–2 盏开 shadow

**line 73**：
```ts
const POINT_SHADOW_MAP_SIZE = 1024;  // P17：512 → 1024（审查报告 §4 Day 5 i）
```

**line 96 的 `fixtureCastsShadow`**：改成「只给餐桌吊灯开 shadow」。

先读当前 `fixtureCastsShadow` 实现，然后改：

```ts
/**
 * 人工灯是否投射阴影。
 *
 * P17（审查报告 §4 Day 5 i）：只给「餐桌吊灯」开 shadow，其余全关。
 * 旧实现所有 PointLight/SpotLight 都开 shadow，每盏 PointLight 是立方体贴图
 * （6 面），场景里 6 盏 PointLight = 36 张阴影贴图，撑不住性能预算。
 * 新策略：只保留 1-2 盏重点灯的 shadow，其余关掉。
 *
 * 判定「餐桌吊灯」：type === 'pendant' 且 fixture 名包含 'dining' 或 'table'。
 * 但 fixtureCastsShadow 只接 type 字符串，无法判断具体是哪盏——所以需要
 * 扩展签名或加一个白名单机制。
 *
 * @param type fixture 类型
 * @param isDiningPendant 是否为餐桌吊灯（由调用方按 fixture.id 判断）
 */
export function fixtureCastsShadow(type: string, isDiningPendant = false): boolean {
  // P17：只有餐桌吊灯开 shadow
  if (isDiningPendant) return true;
  // 其他类型（pendant/dining 以外的吊灯、table 台灯、floor 落地灯等）全关
  return false;
}
```

**但这样需要调用方传 `isDiningPendant`**，改 `lightBuilder.ts:351, 381` 的调用点：

```ts
// 调用方需要判断 fixture 是否为餐桌吊灯
const isDiningPendant = f.type === 'pendant' && (f.id.includes('dining') || f.id.includes('table'));
point.castShadow = fixtureCastsShadow(f.type, isDiningPendant);
```

**但 fixture.id 可能是随机生成的，不包含 'dining'**。更稳妥的判断是按 fixture 的「位置」或「用途」。

**最简单的方案**：让 `fixtureCastsShadow` 只接受 type，并固定「pendant 类型开 shadow」，其余全关：

```ts
export function fixtureCastsShadow(type: string): boolean {
  // P17（审查报告 §4 Day 5 i）：只给餐桌吊灯（pendant 类型）开 shadow，
  // 其余人工灯全关。旧实现所有 PointLight 都开 shadow，每盏是 6 面立方体
  // 阴影贴图，撑不住性能预算。pendant 是餐厅吊灯的主要形态，开 shadow
  // 能在餐桌区域产生真实的投影。
  return type === 'pendant';
}
```

**问题**：这不是「只给 1–2 盏」，而是「所有 pendant 都开」。如果场景里有多盏 pendant（餐厅 + 卧室），就会多开。

**最佳方案**：在 `sceneEngine.ts` 里建一个「shadow 白名单」，只把餐桌吊灯加进去。

**但 fixture 注册表是 store 驱动的，sceneEngine 不直接管 fixture 列表**。

**实际方案**：先按 type 判断（pendant 开），如果场景里 pendant 数量 > 2，就在 lightBuilder 里加一个 counter，只让前 2 个开：

```ts
// lightBuilder.ts 内部加一个 counter
let shadowFixtureCount = 0;
const MAX_SHADOW_FIXTURES = 2;

export function fixtureCastsShadow(type: string): boolean {
  // P17：只给前 2 盏吊灯开 shadow，其余全关
  if (type !== 'pendant') return false;
  if (shadowFixtureCount >= MAX_SHADOW_FIXTURES) return false;
  shadowFixtureCount++;
  return true;
}
```

**但 counter 在多次重建光源时会累加，导致新加的 fixture 不开 shadow**。需要重置机制。

**最简单的可维护方案**：先不做 counter，直接按 type 判断（所有 pendant 开 shadow）。如果性能有问题，再细化。

```ts
export function fixtureCastsShadow(type: string): boolean {
  // P17（审查报告 §4 Day 5 i）：只给吊灯（pendant）开 shadow，其余人工灯全关。
  // 旧实现所有 PointLight 都开 shadow，每盏是 6 面立方体阴影贴图，撑不住
  // 性能预算。pendant 是餐厅吊灯的主要形态，开 shadow 能在餐桌区域产生
  // 真实的投影。SpotLight 类型（downlight/spot）已有自己的 shadow 逻辑
  // （line 308, 331），不受此函数影响。
  return type === 'pendant';
}
```

**注意**：SpotLight 的 shadow（line 308, 331）不受此函数影响，它们是独立判断的。SpotLight 是 downlight/spot 类型，属于重点照明，保持开 shadow。

### 3. 测试

- `sceneEngine.test.ts`：太阳 shadow.mapSize 应为 2048、shadow.camera.left/right/top/bottom 应为 ±6、normalBias 应为 0.02
- `lightBuilder.test.ts`：`fixtureCastsShadow('pendant') === true`、`fixtureCastsShadow('table') === false`、`fixtureCastsShadow('floor') === false`、`fixtureCastsShadow('sconce') === false`

## 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做）：
1. `?debug` 打开，数一下 scene 里有几个 `castShadow=true` 的 PointLight（应该 ≤ 2）
2. 太阳 shadow.mapSize 应为 [2048, 2048]
3. 用户硬刷新真 GPU，看太阳阴影边缘是否更锐利（2048 比 1024 细腻一倍）

## 红线

1. **不要动 SpotLight 的 shadow 逻辑**（line 308, 331 的 SpotLight 独立判断，不受 `fixtureCastsShadow` 影响）
2. **不要动 P16 的 Bloom 分档**
3. **不要动 godrays**（P13 已定版）
4. **不要动曝光分档逻辑**
5. **不要动 P14 的材质**
6. **不要动场景预设 PRESET_SCENES**

## 提交

commit message 风格参考 `ddde017`（中文标题 + 要点）。**不要 push**。
