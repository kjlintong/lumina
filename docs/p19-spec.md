# P19 规格：UI 收口 — 专业模式门禁（审查报告 §4 Day 6 j）

> 依据 `../LUMINA_两周执行规格_hermes.md` §4 Day 6 j 与 §2 硬伤 #6：
> 「JSON 导入导出 / lux / XYZ 坐标 / 置信度调试开关，全部收进"开发者"折叠区
> 或"专业模式"开关后，默认关闭」。本规格取**专业模式开关**这一条实现路径。

## 1. 目标

把当前主界面上暴露的工程/专业控件收进「专业模式」开关后，默认关闭。
判定标准是**默认视图**（未打开专业模式时）不出现以下四类信息：

1. **JSON 导入导出**（`RenderPanel` 项目管理分区）
2. **lux 数值**（`IlluminancePanel` 整个面板）
3. **XYZ 坐标编辑**（`FixturePanel` 的 X/Y/Z `NumberField`）
4. **渲染/后处理调参**（Bloom / Godrays / 氛围层 / 体积光参数，`RenderPanel` 其余分区）

保留在默认视图的：`FloorPlan`、`ZonePanel`、`ScenePanel`、`CameraPanel`、
`TimeAxis`、`HudStats`、`BuildBadge`、通知 toast、日落提示、dev-only 降级提示
（后者本就只在 `import.meta.env.DEV` 下渲染，不受本开关影响）。

## 2. 交付物

### 2.1 `src/store/professionalMode.ts`（新增，无外部依赖）

```ts
/**
 * 「专业模式」开关的持久化存取。
 *
 * 依据 LUMINA 两周执行规格 §4 Day 6 j：JSON 导入导出 / lux / XYZ 坐标 /
 * 渲染调参属工程控件，默认对 C 端用户不可见，收进「专业模式」开关后。
 *
 * 用 localStorage 持久化而非 session：一次开启后跨刷新保留，避免用户
 * 反复手动开一次、刷一次。key 带 `lumina.` 前缀，与 projectStore 的
 * 项目自动保存 key 分家，互不干扰。
 *
 * 无持久化能力（SSR / 隐私模式 / localStorage 抛错）时**静默兜底 false**，
 * 不 throw —— 本模块只服务 UI 可见性，不能因为一个开关把整个 App 打挂。
 */

const STORAGE_KEY = 'lumina.professionalMode';

/** 读当前状态。读取失败/缺失返回 false。 */
export function readProfessionalMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 写当前状态。写入失败静默忽略（同上）。 */
export function writeProfessionalMode(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 静默
  }
}
```

**为什么不用 Zustand**：本状态只被 App 一个组件读、一个开关写，
放进 `useProjectStore` 会污染 ADR-08 定义的「需求侧/供给侧」数据模型
（专业模式不是场景数据、不是灯具、不是活动区）。独立模块 + 一个
`useState` 更诚实。

### 2.2 `src/App.tsx` — 接线

新增状态（与 `leftOpen` / `rightOpen` 同级）：

```tsx
const [professional, setProfessional] = useState(readProfessionalMode);
```

用 `readProfessionalMode` 作为 **lazy initializer**（不是函数调用），
保证只在首次渲染读一次 localStorage。切换时：

```tsx
const handleProfessionalToggle = (on: boolean) => {
  setProfessional(on);
  writeProfessionalMode(on);
};
```

右侧 sidebar 按开关条件渲染。改后结构：

```tsx
{rightOpen && (
  <div className="sidebar-content">
    <ScenePanel onApplyScene={(key) => controllerRef.current?.applyScene(key)} />
    <CameraPanel
      onPresetChange={(key) => engineRef.current?.setCameraPreset(key)}
    />
    {professional && <IlluminancePanel />}
    {professional && (
      <RenderPanel
        postProcessing={backendType === 'webgl2'}
        bloom={bloom}
        onBloomChange={handleBloomChange}
        godrays={godrays}
        onGodraysChange={handleGodraysChange}
        dustVisible={dustVisible}
        onDustVisibleChange={handleDustVisibleChange}
        lightShaftVisible={lightShaftVisible}
        onLightShaftVisibleChange={handleLightShaftVisibleChange}
      />
    )}
  </div>
)}
```

`RenderPanel` **整体隐藏**（不是只隐藏它的 JSON 分区）：它除了项目管理，
还含 Bloom / Godrays 全套调参，全部属于「开发/专业」语义。

左侧 sidebar 同样条件渲染 `FixturePanel`：

```tsx
{leftOpen && (
  <div className="sidebar-content">
    <FloorPlan />
    <ZonePanel />
    {professional && <FixturePanel />}
  </div>
)}
```

**开关 UI**：放在右侧 sidebar 顶部、`ScenePanel` 之前，一个 `Panel`
容器 + 一个 checkbox：

```tsx
<Panel title="专业模式">
  <label className="field">
    <span className="field-label">工程与专业参数</span>
    <input
      type="checkbox"
      checked={professional}
      onChange={(e) => handleProfessionalToggle(e.target.checked)}
    />
  </label>
  <div className="field-note">
    开启后显示照度数值、灯具坐标与渲染调参
  </div>
</Panel>
```

`Panel` 的 `defaultOpen={false}`（默认收起），避免面板标题常驻。

### 2.3 `index.html` — CSS

复用 `dev-only` / `text-muted` 的语义色，**不新增 token**：

```css
.field-note { color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.4; }
```

放在现有 `.info.dev-only` 规则附近（`index.html` 第 113 行一带）。

### 2.4 不做的事（明确排除）

- **不动「阅读」场景色温 4000K**（硬伤 #4）—— 那是 §5 色温矩阵的事，
  另一个规格，本轮不碰 `sceneSystem.ts` / `zoneTypes.ts`。
- **不动 FloorPlan / TimeAxis / HudStats / BuildBadge** —— 这些是产品 UI，
  不在硬伤 #6 的清单里。
- **不新增 store 字段**、**不加 Zustand persist**、**不改 `lockedFields` 机制**。
- **不删除任何控件**：所有面板代码原地保留，只是默认不渲染。
  回退只需把三处 `{professional && ...}` 去掉。

## 3. 测试

### `src/store/__tests__/professionalMode.test.ts`（新增）

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { readProfessionalMode, writeProfessionalMode } from '../professionalMode.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('professionalMode', () => {
  it('未写入时默认 false', () => {
    expect(readProfessionalMode()).toBe(false);
  });

  it('写 true 后读回 true；写 false 后读回 false', () => {
    writeProfessionalMode(true);
    expect(readProfessionalMode()).toBe(true);
    writeProfessionalMode(false);
    expect(readProfessionalMode()).toBe(false);
  });

  it('localStorage 中残留非 '1' 值（如 '0'、'true'、'yes'、''）均为 false', () => {
    for (const bad of ['0', 'true', 'yes', '1 ', '']) {
      window.localStorage.setItem('lumina.professionalMode', bad);
      expect(readProfessionalMode()).toBe(false);
    }
  });

  it('localStorage 不可用时静默兜底（不 throw）', () => {
    // 通过覆盖 getItem/setItem 抛错来模拟隐私模式
    const origGet = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = () => { throw new Error('denied'); };
    window.localStorage.setItem = () => { throw new Error('denied'); };
    try {
      expect(readProfessionalMode()).toBe(false);
      writeProfessionalMode(true); // 不应 throw
    } finally {
      window.localStorage.getItem = origGet;
    }
  });
});
```

**注意**：Vitest 环境下 `window.localStorage.getItem` 的覆盖写法要在
`try/finally` 里恢复，否则会污染后续测试文件。

### `src/App.test.tsx` 新增用例

沿用现有 mock 模式（`vi.mock` 引擎 + `setDev` 助手 + `renderApp` + `flushEffects`）。
新增一个 describe，验证开关行为：

```ts
describe('App：专业模式门禁（P19，§4 Day 6 j）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setDev(true);
  });

  afterEach(() => {
    window.localStorage.clear();
    setDev(true);
  });

  it('默认（未开启）不渲染 照度估算 / 灯具参数 / 渲染与项目 面板', async () => {
    const { container } = await renderApp();
    await flushEffects();
    expect(container.textContent).not.toContain('照度估算');
    expect(container.textContent).not.toContain('灯具参数');
    expect(container.textContent).not.toContain('渲染与项目');
    // 用户可见的产品 UI 仍在
    expect(container.textContent).toContain('场景');
    expect(container.textContent).toContain('相机机位');
  });

  it('勾选专业模式后三个面板出现', async () => {
    const { container } = await renderApp();
    await flushEffects();
    // 找到「工程与专业参数」checkbox 并勾选
    const checkbox = container.querySelector(
      'input[type="checkbox"][aria-label="专业模式"]',
    ) as HTMLInputElement | null;
    expect(checkbox, '应当能定位专业模式开关').not.toBeNull();
    await userEvent.click(checkbox!);
    expect(container.textContent).toContain('照度估算');
    expect(container.textContent).toContain('渲染与项目');
  });

  it('开关状态跨实例持久化（写 localStorage 后再渲染）', async () => {
    window.localStorage.setItem('lumina.professionalMode', '1');
    const { container } = await renderApp();
    await flushEffects();
    expect(container.textContent).toContain('照度估算');
  });
});
```

**定位策略**：给 checkbox 加 `aria-label="专业模式"`（在 2.2 的 label 里补），
避免按文本路径查找（文本可能被后续改动）。若 `userEvent` 已在 App.test.tsx
可用则直接用；没有的话用 `checkbox.click()` + `await act(...)` 也行，
**但不要用 `fireEvent` 后再立刻断言**（React 19 的 state 更新需要一次 act）。

**先读 App.test.tsx 已有的 mock 结构**（引擎 mock、`flushEffects`），
保持一致；不要在同一个文件里引入第二套 mock 方式。

**若 FixturePanel 在当前 mock 下因「未选中灯具」根本不渲染标题**
（`FixturePanel.tsx:196-202` 有 `selectedFixtureId === null` 的分支），
第二个用例不要断言「灯具参数」文本，只断言 照度估算 / 渲染与项目 即可，
并在测试注释里写清原因。

## 4. 验证

```bash
npm run verify
npm run build
```

**运行时验证**（父级做，需真实 GPU 机器，本环境 SwiftShader 不判定画面）：
1. 首次打开，右侧 sidebar 只有「专业模式 / 场景 / 相机机位」，无 lux、无渲染参数
2. 左侧 sidebar 只有「2D 户型图 / 活动区」，无灯具坐标输入
3. 勾「工程与专业参数」→ 三个面板出现，X/Y/Z 输入框可见
4. 取消勾选 → 面板消失；刷新页面后仍处于关闭状态
5. 再打开一次 → 仍是关闭（localStorage 持久化正确）

## 5. 红线

1. **不要删除任何面板代码** —— 只加条件渲染。回退成本必须接近 0。
2. **不要动 `useProjectStore`**（不加字段、不加 persist、不改 action）。
3. **不要动 `sceneSystem.ts` / `zoneTypes.ts` / `lightBuilder.ts`**
   —— 色温矩阵是另一个规格。
4. **不要动 ADR-17 的 `lockedFields` 语义**（隐藏坐标编辑不等于解锁）。
5. **不要新增依赖**（不引 zustand/persist、不引 UI 库）。
6. **不要改 `index.html` 的 `:root` token**，只加 `.field-note` 一条规则。
7. **不要改 `Panel` 组件的 API**（用 `defaultOpen` 已有的 prop）。
8. **不要改时间轴 / 相机机位 / 场景预设**（Day 6 k 已交付，P18）。
9. **不要 push**（父级统一处理提交与推送）。

## 6. 提交

一个 commit，中文标题 + 要点，风格参考 `ddde017` / `b630db0`：

```
P19: 专业模式门禁 — JSON/lux/XYZ/渲染调参默认收起（§4 Day 6 j）

- 新增 src/store/professionalMode.ts：localStorage 持久化 + 异常静默兜底
- App.tsx：照度估算 / 灯具参数 / 渲染与项目 三面板条件渲染
- 右侧 sidebar 顶部新增「专业模式」开关（Panel defaultOpen=false）
- App.test.tsx 新增 3 条门禁用例；新增 professionalMode.test.ts 4 条
```

**不要 push**。
