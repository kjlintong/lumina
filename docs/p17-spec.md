# P17 规格：阴影策略（审查报告 §4 Day 5，已按代码核实改写）

## 目标

改善太阳阴影的像素密度（清晰度）。

## ⚠️ 原审查报告前提已被推翻，本规格已改写

原审查报告要求「太阳 1024² → 2048²」「人工灯只给 1–2 盏重点灯开 shadow」。
**逐条 grep 核实后，这两条前提都不成立**，不要按原报告实现：

1. **「人工灯 PointLight 都开 shadow = 36 张立方体贴图」是错的**。
   `lightBuilder.ts:87-90` 的 `SHADOW_CASTING_FIXTURE_TYPES` 只含 `{'downlight','spot'}`，
   而这两种走 SpotLight 分支（`:301-339`），**从不调用 `fixtureCastsShadow`**。
   PointLight 分支（`:341-357`）对 `pendant/sconce/floor/table` 调 `fixtureCastsShadow`，
   但集合里没有它们，所以 `castShadow` 恒为 `false`（`:347` 注释已写明 P9 已关）。
   当前场景投阴影的灯 = 1 太阳 + N 个筒灯/射灯。**没有 36 张立方体贴图。**
2. **`POINT_SHADOW_MAP_SIZE`（`:73`，512）是死常量，从未被读取**。
   唯一引用在 `:353` 的 `if (point.castShadow) { ... }` 块内，该块恒不可达。
3. **太阳 2048² 是 P9 记录的 5FPS 头号成本**（见 `docs/P9-shadows-exposure-perf-spec.md:93-95`、`:122-132`）。
   升回 2048² = 回滚 P9 已验收的「≥30 FPS」。**用户已确认：不升 2048²。**

## 实际交付物（只有 3 项）

### 1. `src/scene/sceneEngine.ts` — shadow camera 收紧到房间包围盒

**line 334-339**，把视锥从 ±10 收紧到 ±6：

```ts
this.sunLight.shadow.camera.near = 0.5;
this.sunLight.shadow.camera.far = 50;
this.sunLight.shadow.camera.left = -6;
this.sunLight.shadow.camera.right = 6;
this.sunLight.shadow.camera.top = 6;
this.sunLight.shadow.camera.bottom = -6;
```

**为什么 ±6 够**：房间 6×4.5×2.8m，对角线 √(6²+4.5²) = 7.5m，一半 3.75m。
±6 覆盖 12×12m，含 ~2m 余量。太阳 DirectionalLight 的 target 恒在原点附近
（`:347` `target.position.set(0, 0.5, 0)`），shadow camera 沿 target 方向投影。

**收益量化**（必须写进注释）：
- 旧：1024² 覆盖 20×20m → 每像素 **19.5mm**
- 新：1024² 覆盖 12×12m → 每像素 **11.7mm**（清晰度提升 67%）
- 若走 2048²@±10m：9.8mm，但阴影贴图填充量 4× —— 正是 P9 记录的 5FPS 元凶。
  本方案以 1/4 成本拿到 2048²@±10m 的 **85%** 像素密度。

`SUN_SHADOW_MAP_SIZE`（`:97`）**保持 1024 不动**。

### 2. `src/scene/sceneEngine.ts` — normalBias 0.03 → 0.02

**line 354**：

```ts
this.sunLight.shadow.bias = -0.0005;   // 不动
this.sunLight.shadow.normalBias = 0.02; // P17：0.03 → 0.02
```

**必须同步更新 `:350-352` 的注释**：原注释把 0.03 归因于旧的 19.5mm 视锥；
现在视锥收紧到 11.7mm，采样密度变了，0.02 对应新密度。注释要说明是配合视锥
收紧一起调的，否则后人会当成独立的经验值。

### 3. `src/render/lightBuilder.ts` — 删除死代码

原报告这半段的**真实有效含义**是「关掉人工灯的 PointLight 阴影预算」，而这个
在 P9 已经完成（见上）。剩下的只是清理死代码，让 P9 的事实显式化：

- **删除 `:73` 的 `POINT_SHADOW_MAP_SIZE`**（无引用）
- **删除 `:352-354` 的 `if (point.castShadow) { ... }` 块**（恒不可达）
- **删除 `:376-385` 的 default 兜底分支里的 `point.castShadow = fixtureCastsShadow(f.type)`**
  （该分支 `castShadow` 恒 false，赋值无意义）
- **重写 `:80-98` 的 `fixtureCastsShadow` 与 `SHADOW_CASTING_FIXTURE_TYPES` 注释**：
  明确写「当前 PointLight 全部不投阴影，`fixtureCastsShadow` 对所有已知 PointLight
  类型返回 false，集合实际只用于『将来若有类型需投阴影』的显式声明点」。
  不要删这个函数——`:351` 还在用，删了会留下死分支。

### 不要做

- **不要新增「餐桌吊灯白名单」或 counter 机制**（`:121-128` 那套）。
  没有需求：PointLight 已经全关，吊灯（pendant）本就不投阴影。
- **不要动 SpotLight 的 shadow 逻辑**（`:308-309`、`:331-332`）。
  筒灯/射灯是重点照明，保持开阴影。
- **不要改 `SUN_SHADOW_MAP_SIZE`**。

## 测试

### `src/scene/__tests__/sceneEngine.test.ts` 新增

```ts
describe('sun shadow camera (P17)', () => {
  it('shadow camera 收紧到 ±6（房间包围盒 + 余量）', () => {
    const engine = new SceneEngine(backend);
    const sun = /* DirectionalLight 查找 */;
    expect(sun.shadow.camera.left).toBe(-6);
    expect(sun.shadow.camera.right).toBe(6);
    expect(sun.shadow.camera.top).toBe(6);
    expect(sun.shadow.camera.bottom).toBe(-6);
  });

  it('mapSize 保持 1024（不升 2048²，P9 性能预算）', () => {
    expect(sun.shadow.mapSize.x).toBe(1024);
    expect(sun.shadow.mapSize.y).toBe(1024);
  });

  it('normalBias 0.02（配合 ±6 视锥的新像素密度）', () => {
    expect(sun.shadow.normalBias).toBeCloseTo(0.02);
  });

  it('shadow camera 覆盖房间对角线 7.5m', () => {
    // 12×12 覆盖对角线 7.5m 的房间 + 余量
    const halfDiag = Math.sqrt(6 * 6 + 4.5 * 4.5) / 2; // 3.75
    expect(halfDiag).toBeLessThan(6);
  });
});
```

### `src/render/__tests__/lightBuilder.test.ts` 新增

```ts
describe('fixtureCastsShadow (P17)', () => {
  it('所有 PointLight 类型都不投阴影（P9 预算，P17 确认）', () => {
    for (const t of ['pendant', 'sconce', 'floor', 'table', 'linear', 'cove', 'unknown']) {
      expect(fixtureCastsShadow(t)).toBe(false);
    }
  });

  it('SpotLight 类型不由 fixtureCastsShadow 决定（走 SpotLight 分支恒 true）', () => {
    // 明确记录：downlight/spot 不被 fixtureCastsShadow 读取
    expect(fixtureCastsShadow('downlight')).toBe(false);
    expect(fixtureCastsShadow('spot')).toBe(false);
  });
});
```

**注意**：`lightBuilder.test.ts` 现有 11 个测试，先读一遍确认没有测试
`POINT_SHADOW_MAP_SIZE` 或依赖那个死分支的断言。若有，一并更新。

## 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做，`?debug` + 控制台 `window.__luminaDebug`）：
1. 遍历 scene 的 `isLight && castShadow`，应 = 1 太阳 + N 筒灯/射灯（**没有 PointLight**）
2. 太阳 `shadow.camera.left === -6`、`mapSize.x === 1024`、`normalBias === 0.02`
3. 太阳阴影边缘应比之前锐利（19.5mm → 11.7mm）
4. **HUD 帧率应 ≥ 30**（与 P9 基线一致——本改动不增阴影贴图填充量）

## 红线

1. **不要升 `SUN_SHADOW_MAP_SIZE` 到 2048**（用户已确认，回滚 P9 已验收性能）
2. **不要动 SpotLight 的 shadow 逻辑**
3. **不要动 P16 的 Bloom 分档**
4. **不要动 godrays**（P13 已定版）
5. **不要动曝光分档逻辑**
6. **不要动 P14 的材质**
7. **不要动 `PRESET_SCENES`**
8. **不要新增未验证的白名单/counter 机制**（无需求，纯复杂度）

## 提交

commit message 风格参考 `ddde017`（中文标题 + 要点）。**不要 push**。
