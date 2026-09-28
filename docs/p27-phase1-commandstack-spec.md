# P27 · Phase 1 · 命令栈基础设施

> 来源：`/home/ryan/project/Lumina项目审查与后续工作方案.md` §二 Phase 1 第 1 项（SceneDoc + 命令栈）。
> HEAD 基线：`c23f377`（P26a/P26b/文档已提交，774 测试全绿）。
> 本阶段**只做**命令栈与快捷键；**不做** SceneDoc 独立类型（把现有 `LuminaProject` 当作 SceneDoc 用，避免大规模迁移牵连 774 个既有测试）。
> 场景：设计工具没有撤销重做不可用；方案 §Phase 1 明确说「**没有撤销重做的设计工具不可用**」。

---

## 1. 目标（判定标准）

1. 全局 `Ctrl+Z` / `Ctrl+Shift+Z` 快捷键生效，可撤销/重做**所有**编辑：
   - 描墙 / 提交房间（modelingStore 现有能力，需接全局快捷键）
   - 新增 / 删除 / 移动 / 改参灯具（projectStore 需接入命令栈）
   - 修改活动区参数（同上）
2. 撤销栈跨模块统一：一条 undo 能把「上一个编辑」完整回滚，无论它来自哪个 store。
3. 键盘快捷键**不打断输入框**：焦点在 `input` / `textarea` 时 Ctrl+Z 交给浏览器默认行为（编辑文本自己的 undo）。
4. `Ctrl+Y` 作为重做别名（Windows 惯例）。
5. UI 上「撤销 / 重做」按钮显示当前可用性（灰/亮），并在 hover 时提示最后一条动作的 label（若可用）。
6. `npm run verify` 全绿（typecheck + 测试全绿；lint 允许既有 core/** 的 7 个 error，不新增）。
7. 至少 5 个新增单元测试覆盖命令栈核心行为。

---

## 2. 交付物

### 2.1 `src/core/commandStack.ts` —— 通用命令栈

新建文件，纯逻辑无副作用：

```ts
/**
 * 通用命令栈（Phase 1 地基）。
 *
 * 与 `confidence.UndoStack<T>` 的关系：
 * - `UndoStack<T>` 只存 `ModelGeometry` 的编辑，服务描墙 / 提交房间场景
 *   （P22 定型，见 docs/p22-spec.md §3.2）。它存的是完整快照（before/after），
 *   适合「一个元素的字段修改」。
 * - 本文件是**跨模块**命令栈：命令可以来自 modelingStore、projectStore（灯具、
 *   活动区）、未来的 fixtureDrag / transform 等。命令结构是 `{execute, undo, label}`，
 *   不是「快照对」——execute 应用一次编辑，undo 反向撤回。
 *
 * 为什么不直接扩 UndoStack？
 * - UndoStack 的快照对结构对「新增元素」表达很别扭（before = undefined？）
 * - UndoStack 只 push 快照，不做 execute 幂等；命令栈支持「execute 后立即推入」的
 *   惰性模式，与 TransformControls 的 drag-during 场景更契合（P28 会用到）。
 *
 * 语义约定：
 * - `push` 追加命令，**清空 redo 分支**（与 UndoStack 一致）。
 * - `undo` 弹出栈顶，调用其 `undo()`，返回 label（可能为 undefined）。
 * - `redo` 弹出 redo 栈顶，调用其 `execute()`。
 * - `executeAndPush` 立即执行命令，然后推入栈顶（用于「用户点击按钮」类动作，
 *   一步完成）。
 * - `size` 返回 undo 栈深度。
 * - `label` 返回栈顶命令的 label（用于 UI 显示「可撤销：新增吊灯」）。
 */

export interface Command {
  /** 应用命令 */
  execute: () => void;
  /** 反向撤回命令 */
  undo: () => void;
  /** 用户可见的操作标签（用于 UI 与 undo 栈展示） */
  label?: string;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack = [];
  }

  undo(): string | undefined {
    const cmd = this.undoStack.pop();
    if (cmd === undefined) return undefined;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd.label;
  }

  redo(): string | undefined {
    const cmd = this.redoStack.pop();
    if (cmd === undefined) return undefined;
    cmd.execute();
    this.undoStack.push(cmd);
    return cmd.label;
  }

  executeAndPush(cmd: Command): string | undefined {
    cmd.execute();
    this.push(cmd);
    return cmd.label;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  get size(): number { return this.undoStack.length; }

  /** 栈顶命令的 label（用于 UI 提示） */
  get lastLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.label; }

  /** redo 栈顶命令的 label */
  get nextRedoLabel(): string | undefined { return this.redoStack[this.redoStack.length - 1]?.label; }

  clear(): void { this.undoStack = []; this.redoStack = []; }

  snapshot(): { undo: Command[]; redo: Command[] } {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }
}
```

### 2.2 `src/store/commandBus.ts` —— 模块级单例 + store 桥接

命令栈实例**不放**进 zustand state（会被 immer draft 化，导致命令对象被冻结）。用模块级单例：

```ts
/**
 * 全局命令栈单例（Phase 1）。
 *
 * 单例而非放入 Zustand store：Command 里的 execute/undo 是闭包函数，immer
 * 会 draft-化对象导致行为异常。参考 modelingStore.undoStack 的处理（P22 已定）。
 *
 * 暴露 `useCommandStackAvailable()` 供 UI 组件订阅（Zustand 只做可用性标记）。
 */
import { CommandStack, type Command } from '../core/commandStack.js';
import { create } from 'zustand';

export const commandStack = new CommandStack();

/** UI 订阅命令栈可用性状态（不订阅命令本身） */
interface CommandBusState {
  canUndo: boolean;
  canRedo: boolean;
  lastLabel: string | undefined;
  bump: () => void;
}

export const useCommandBus = create<CommandBusState>((set) => ({
  canUndo: false,
  canRedo: false,
  lastLabel: undefined,
  bump: () => set({
    canUndo: commandStack.canUndo(),
    canRedo: commandStack.canRedo(),
    lastLabel: commandStack.lastLabel,
  }),
}));

export type { Command };
```

**约束**：`commandStack` 的所有 push/undo/redo 调用后，必须调一次 `useCommandBus.getState().bump()` 同步 UI 状态。写一个 helper：

```ts
/** 推送命令后同步 UI 状态（避免调用方漏掉 bump） */
export function pushCommand(cmd: Command): string | undefined {
  const label = commandStack.executeAndPush(cmd);
  useCommandBus.getState().bump();
  return label;
}

export function undoCommand(): string | undefined {
  const label = commandStack.undo();
  useCommandBus.getState().bump();
  return label;
}

export function redoCommand(): string | undefined {
  const label = commandStack.redo();
  useCommandBus.getState().bump();
  return label;
}
```

### 2.3 改造 `projectStore.ts` —— 灯具 / 活动区编辑走命令栈

现有 `addFixture / removeFixture / updateFixture / moveFixture / moveAndLockFixture` 是**直接改** `project` 对象的 store action。改成「构造命令 → 走 pushCommand」：

- **不改动** action 的对外签名（`addFixture(opts): string` 等），内部实现改成命令栈封装。
- 每个 action 内部构造一个 Command：
  - `addFixture`：`execute` = 把 fixture 加进 store；`undo` = 从 store 里移除
  - `removeFixture`：`execute` = 移除；`undo` = 加回来（需要保留被移除对象的完整快照）
  - `updateFixture`：`execute` = 应用 patch；`undo` = 恢复 before 快照
  - `moveFixture` / `moveAndLockFixture`：`execute` = 移动 + 解绑；`undo` = 恢复原位置与原绑定
- `binding` 层的纯函数（`binding.addFixture` 等）保持纯函数性质；命令栈在 store 层封装。
- **注意 immer 的 draft 处理**：命令对象里的闭包引用的 project 引用必须**深拷贝**（不能引用 live draft）。用 `structuredClone` 或 `JSON.parse(JSON.stringify(...))` 快照。

**关键实现示意**（`addFixture` 改造）：

```ts
addFixture: (opts) => {
  const fixtureId = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fixture = makeFixture({ id: fixtureId, ...opts });
  pushCommand({
    label: `新增${FIXTURE_TYPE_LABELS[fixture.fixtureType] ?? '灯具'}`,
    execute: () => {
      get().project = binding.addFixture(get().project, fixture);
    },
    undo: () => {
      get().project = binding.removeFixture(get().project, fixtureId);
    },
  });
  return fixtureId;
},
```

其余 action 类似，每个都构造 before/after 深拷贝快照。

### 2.4 改造 `modelingStore.ts` —— 复用统一命令栈

现有 `undoStack`（`UndoStack<ModelGeometry>`）保留在 modelingStore 内部（描墙的 before/after 快照结构复杂，暂不迁移），但**同时**在 modelingStore 的每个编辑动作里也调 `pushCommand`，把命令栈的 label 同步到 UI。

或者更简单的方案：把 `UndoStack<ModelGeometry>` 的 push 换成 `commandStack.push`，每条 entry 转为 Command：

```ts
const snapshot = structuredClone(get().model);
// ... apply edit ...
pushCommand({
  label: '描墙',
  execute: () => { set({ model: structuredClone(afterSnapshot) }); },
  undo: () => { set({ model: snapshot }); },
});
```

**推荐后者**，彻底统一到 commandStack。旧的 `undoStack` 从 modelingStore 移除；`undo/redo` action 改为调 `undoCommand()/redoCommand()`。

### 2.5 `src/ui/panels/UndoRedoBar.tsx` —— 撤销/重做 UI 按钮

新建小组件，放在 App 顶部工具栏区域（overlay 内，标题右侧或下方）：

```tsx
export function UndoRedoBar() {
  const { canUndo, canRedo, lastLabel, nextRedoLabel } = useCommandBus(s => s);
  const handleUndo = () => {
    const label = undoCommand();
    if (label) useProjectStore.getState().setNotice(`撤销：${label}`);
  };
  const handleRedo = () => {
    const label = redoCommand();
    if (label) useProjectStore.getState().setNotice(`重做：${label}`);
  };
  return (
    <div className="undo-redo-bar">
      <button type="button" disabled={!canUndo} title={`撤销${lastLabel ? '：' + lastLabel : ''}`} onClick={handleUndo}>↶ 撤销</button>
      <button type="button" disabled={!canRedo} title={`重做${nextRedoLabel ? '：' + nextRedoLabel : ''}`} onClick={handleRedo}>↷ 重做</button>
    </div>
  );
}
```

CSS（放在 index.html 的 style 块里）：

```css
.undo-redo-bar { display: flex; gap: 6px; margin-top: 6px; }
.undo-redo-bar button { background: var(--bg-panel); border: var(--border-subtle); border-radius: var(--radius-xs); padding: 2px 8px; font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer; }
.undo-redo-bar button:disabled { opacity: 0.4; cursor: default; }
```

在 `App.tsx` 里把 `<UndoRedoBar />` 塞进 overlay 内（第一个 hud-block 内）。

### 2.6 全局键盘快捷键 —— `src/ui/hooks/useUndoRedoShortcut.ts`

```ts
import { useEffect } from 'react';
import { undoCommand, redoCommand } from '../store/commandBus.js';
import { useProjectStore } from '../store/projectStore.js';

/**
 * 全局 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键。
 *
 * 输入框保护：焦点在 input / textarea / contentEditable 时跳过，
 * 让浏览器默认的文本 undo 生效。
 */
export function useUndoRedoShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const mod = e.ctrlKey || e.metaKey; // 兼容 Mac 的 Cmd
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = undoCommand();
        if (label) useProjectStore.getState().setNotice(`撤销：${label}`);
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        const label = redoCommand();
        if (label) useProjectStore.getState().setNotice(`重做：${label}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
```

在 `App.tsx` 顶层调 `useUndoRedoShortcut();`。

---

## 3. 测试

### 3.1 `src/core/__tests__/commandStack.test.ts`（新）

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandStack } from '../commandStack.js';

describe('CommandStack', () => {
  let stack: CommandStack;
  beforeEach(() => { stack = new CommandStack(); });

  it('push 追加命令；undo 弹出并调用 undo()', () => {
    const ops: string[] = [];
    stack.push({ label: 'a', execute: () => ops.push('a-ex'), undo: () => ops.push('a-undo') });
    stack.push({ label: 'b', execute: () => ops.push('b-ex'), undo: () => ops.push('b-undo') });
    expect(stack.canUndo()).toBe(true);
    expect(stack.size).toBe(2);
    expect(stack.lastLabel).toBe('b');
    stack.undo();
    stack.undo();
    expect(ops).toEqual(['b-undo', 'a-undo']);
    expect(stack.canUndo()).toBe(false);
  });

  it('undo 后 redo 恢复 execute；新 push 清空 redo 分支', () => {
    const ops: string[] = [];
    stack.push({ label: 'a', execute: () => ops.push('a-ex'), undo: () => ops.push('a-undo') });
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.redo();
    expect(ops).toEqual(['a-undo', 'a-ex']);
    stack.push({ label: 'c', execute: () => ops.push('c-ex'), undo: () => ops.push('c-undo') });
    expect(stack.canRedo()).toBe(false);
  });

  it('executeAndPush 立即执行再推入栈顶', () => {
    const ops: string[] = [];
    stack.executeAndPush({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    expect(ops).toEqual(['x-ex']);
    expect(stack.size).toBe(1);
    stack.undo();
    expect(ops).toEqual(['x-ex', 'x-undo']);
  });

  it('canUndo / canRedo 空栈返回 false；undo/redo 返回 undefined', () => {
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toBeUndefined();
    expect(stack.lastLabel).toBeUndefined();
    expect(stack.nextRedoLabel).toBeUndefined();
  });

  it('clear 清空 undo 与 redo 栈', () => {
    stack.push({ execute: () => {}, undo: () => {} });
    stack.undo();
    stack.clear();
    expect(stack.size).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });
});
```

### 3.2 `src/store/__tests__/commandBus.test.ts`（新）

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { commandStack, pushCommand, undoCommand, redoCommand, useCommandBus } from '../commandBus.js';

beforeEach(() => { commandStack.clear(); });

describe('commandBus', () => {
  it('pushCommand 立即执行并推入栈顶；UI 状态同步', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    expect(ops).toEqual(['x-ex']);
    const st = useCommandBus.getState();
    expect(st.canUndo).toBe(true);
    expect(st.canRedo).toBe(false);
    expect(st.lastLabel).toBe('x');
  });

  it('undoCommand 调用 undo 并同步 UI 状态', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    const label = undoCommand();
    expect(label).toBe('x');
    expect(ops).toEqual(['x-ex', 'x-undo']);
    expect(useCommandBus.getState().canUndo).toBe(false);
    expect(useCommandBus.getState().canRedo).toBe(true);
  });

  it('redoCommand 调用 execute 并同步 UI 状态', () => {
    const ops: string[] = [];
    pushCommand({ label: 'x', execute: () => ops.push('x-ex'), undo: () => ops.push('x-undo') });
    undoCommand();
    redoCommand();
    expect(ops).toEqual(['x-ex', 'x-undo', 'x-ex']);
  });
});
```

### 3.3 改造 `src/store/__tests__/modelingStore.test.ts`

若现有测试直接调 `modelingStore.getState().undoStack` 或依赖 `UndoStack` 的公开 API，改为通过命令栈接口验证。若测试通过 UI 层面的 `undo/redo` action 验证，保持不动（action 语义不变）。

### 3.4 若 projectStore 有测试

现有 `src/store/__tests__/projectStore.test.ts`（若有）需要在 beforeEach 里 `commandStack.clear()`。测试断言不变（action 语义不变）。

---

## 4. 验证

1. `npm run typecheck` 0 error
2. `npm test` 全绿（原 774 + 新至少 8 个用例）
3. `npm run build` 成功
4. `npm run dev` 后手动验证：
   - 添加一盏灯具 → Ctrl+Z → 灯具消失
   - Ctrl+Y → 灯具回来
   - 描墙时 Ctrl+Z → 上一步描的点消失
   - 焦点在「方案名称」input 里时 Ctrl+Z → 走的是文本框自己的 undo，不走应用
   - 撤销按钮在空栈时是 disabled 状态

---

## 5. 不做的事

- **不**引入新的 SceneDoc 类型：现有 `LuminaProject` + 可选 `model?: ModelGeometry` 就是 SceneDoc。方案里说的「SceneDoc 数据模型」本轮**只落命令栈半块**，SceneDoc 独立类型留到后续阶段（会牵动 774 测试）。
- **不**改 `LuminaProject` 结构（不动 types.ts 的字段定义）。
- **不**改 `serialize.ts` 的 schema 版本号。
- **不**实现 TransformControls / DragControls（P28 范围）。
- **不**实现灯具库面板（P28 范围）。
- **不**改 CSS 布局（除 `.undo-redo-bar` 新增两条规则）。
- **不**引入新 npm 依赖。
- **不**改 `vite.config.ts` / `tsconfig.json` / `eslint.config.js` / `CLAUDE.md`。
- **不**改 `docs/p26a-*` / `docs/p26b-*` / `docs/p25-*` 等已归档规格。

---

## 6. 红线

- `src/core/commandStack.ts` 与 `src/store/commandBus.ts` 是新文件，改动范围自洽。
- `src/store/projectStore.ts` **只改** `addFixture / removeFixture / updateFixture / moveFixture / moveAndLockFixture` 的内部实现，**不改**对外签名（`FixtureOptions`、返回值类型、`DeepPartial` 参数）。所有既有测试不改断言。
- `src/store/modelingStore.ts` **只改**：删除 `undoStack` 字段与 `UndoStack` import；`undo/redo/canUndo/canRedo` action 改为调 `undoCommand/redoCommand/useCommandBus` 派生值。其余 action（`addPendingVertex` 等）**不**改内部结构，只把「applyUserEdit 后」的 `undoStack.push(...)` 换成 `pushCommand(...)`（把整个 model 的 before/after 快照包进一个 Command）。
- `src/App.tsx` 只改：加 `useUndoRedoShortcut()` 调用、在 overlay 里挂 `<UndoRedoBar />`。
- `index.html` 只加 `.undo-redo-bar` 三条 CSS。
- **不**新增 `import.meta.env.XXX` 变量。
- **不**修改 `src/render/backend.ts` / `sceneEngine.ts`（P26a/P26b 冻结区）。
- **不**删除 `src/core/confidence.ts` 里的 `UndoStack`（虽然 modelingStore 不再用，但保留以防未来复用；本阶段不删）。
- 回退成本：命令栈基础设施是纯新增；projectStore/modelingStore 改动集中在 5 个 action 内部实现。回退 `git revert <P27-hash>` 即可。

---

## 7. 提交

一次 commit，格式：

```
P27: Phase 1 · 命令栈基础设施

- 新增 src/core/commandStack.ts（通用命令栈，纯逻辑）
- 新增 src/store/commandBus.ts（模块级单例 + Zustand UI 状态桥接）
- projectStore: 5 个 action（add/remove/update/move/moveAndLock fixture）走 pushCommand
- modelingStore: 移除内部 UndoStack，统一走 commandStack
- 新增 src/ui/hooks/useUndoRedoShortcut.ts（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，input 保护）
- 新增 src/ui/panels/UndoRedoBar.tsx（撤销/重做按钮 + 状态提示）
- App 挂 <UndoRedoBar />，overlay 内
- 新增 src/core/__tests__/commandStack.test.ts 与 src/store/__tests__/commandBus.test.ts
```

不 push。

---

## 8. 交付证据

回报时给出：
- `commit_hash`
- `npm run typecheck` 输出（应 0 error）
- `npm test` 结果（含测试总数与新增用例数）
- `git show --stat HEAD` 改动文件清单
- `deviations`（任何偏离规格 + 理由）
