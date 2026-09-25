# Lumina P4 — 活动区可视化 + 基础家具上下文 实施规格

> 交给 Claude Code 执行。先读 `CLAUDE.md`（ADR 与红线），再读本文件。
> 现状：`npm run verify` 全绿（226 测试），工作树干净，已推送 origin/master。

## 背景：为什么做这个

用户反馈「场景中没有家具」。核实方案与代码：

- `src/render/room.ts` 只建地板+天花板+四面墙，无家具。
- `src/scene/sceneEngine.ts` 只往场景加房间、灯具、太阳、环境光/半球光——**活动区（需求侧实体）在 3D 里完全没有表示**。
- 方案 §4.5.5 明确点名这个坑：「避免无家具场景渲染成『白盒子』，保证画面仍有说服力」。
- 方案 §4.5.8：家具按「功能槽位」组织（睡眠/工作/用餐/休闲），同一套几何构造器由参数驱动尺寸与形态。

## 范围（本阶段只做这两块）

### 交付物 1：活动区可视化（M1.6 内，必须）

需求侧实体必须在 3D 里可见——否则用户增删改活动区、调 `planeH`/`size`/`rotY` 都看不出效果，M1.6「活动区增删改」的验收判据就不完整。

- 每个 ActivityZone 渲染为一个**贴地的半透明工作面包 + 边框线**：
  - 位置：`zone.pos`（世界坐标 x,z）
  - 尺寸：`zone.size`（宽×深，定义在局部坐标系，需按 `rotY` 旋转）
  - 高度：`zone.planeH`（工作面高度——这是需求侧的核心物理量，必须可视化，不能只画一个贴地平面）
  - 朝向：`zone.rotY`
  - 半透明填充（低透明度，别挡视线）+ 更亮的边框线，让用户能清楚看到「这个区有多大、工作面多高、朝哪边」
  - 类型区分色：不同类型用不同边框色（10 种类型，可用 HSL 按 type 索引取色）
- 选中活动区时高亮（边框更亮/更粗），与 ZonePanel 的选中态呼应。

### 交付物 2：按活动区类型的基础家具槽位（遮挡上下文）

方案 §2.4 说家具「只作为照明的遮挡与反射上下文存在」，不做软装电商。所以只做**几何位置占位**，不做品牌、不做材质细节。

- 按活动区类型生成 1-3 件简单位置几何（BoxGeometry 组合即可，不要过度精细）：
  - `sleep`：床（床垫+床头板，靠墙）
  - `work`：书桌（桌面+桌腿+椅子）
  - `dining`：餐桌（桌面+四腿）
  - `lounge`：沙发（座+靠背+扶手）+ 茶几
  - `kitchen`：操作台（台面+柜体）
  - `bathroom`：洗手台（台面+柜体）
  - `reading`：扶手椅 + 小边几
  - `nursery`：矮床 + 收纳柜
  - `wardrobe`：衣柜（开放框）
  - `entry`：换鞋凳 + 鞋柜
- 家具放在活动区**局部坐标系**内，跟随 `zone.pos` / `zone.rotY` / `zone.size`：
  - 区移动 → 家具整体平移（注意：家具是活动区的一部分，不是 Fixture，不受 ADR-13 绑定跟随机制约束）
  - 区旋转 → 家具整体旋转
  - 区删除 → 家具一并移除
- 材质：木色/布色的 MeshStandardMaterial（有粗糙度，能接收阴影、产生漫反射）——方案 §4.5.2 说家具反射率 0.2-0.7，深色家具会拉低局部亮度。取中间值即可。
- **必须 `castShadow = receiveShadow = true`**（否则不是遮挡上下文，光会穿过去，照度场失真）。

## 架构约束

1. **数据源是 store 的 `project.zones`**，不是新建一份数据。ZonePanel 增删改活动区，3D 里的区和家具必须同步更新。
2. **活动区可视化是独立的渲染模块**，建议新建 `src/render/activityZone.ts`（构造单个区的可视化 Group）和 `src/render/furniture.ts`（按类型构造家具 Group）。纯几何构造，不碰 store。
3. **sync 逻辑走 App.tsx 已有的 store.subscribe 模式**（参照 `syncFixtures` 的 diff 写法）：对比前后 zones，新增的 add、删除的 remove、变更的 update（pos/size/rotY/planeH 任一变化即重建）。
4. **不得直接 import three 渲染器**（架构红线）：只走 `backend.ts`。`Group`/`Mesh`/`BoxGeometry`/`MeshStandardMaterial`/`LineSegments` 等非渲染器类可以从 `three` 主入口 import（与 `room.ts` 现状一致，这是允许的）。不引 `three/addons` 桶。
5. **活动区可视化不参与 raycasting 选灯**（App.tsx 的 `pickFixture`）——家具不应被当灯具点选。给 Group 设 name 前缀区分，或把家具加到不参与拾取的子 group。

## 实现要点

- `buildRoom` 不动（房间外壳）。活动区可视化和家具是叠加在房间之上的独立 group。
- 区的工作面包建议用 `PlaneGeometry`（水平面，y=planeH）+ `EdgesGeometry`/`LineSegments` 画边框；或 `BoxGeometry` 薄板。半透明：`material.transparent = true; material.opacity = 0.15`。
- 选中态：边框颜色/粗细切换。可以在 store 订阅里读 `selectedZoneKey`，选中时重建边框或改 material。
- 家具构造器建议签名：`buildFurniture(zone: ActivityZone): Group`，内部按 `zone.type` switch。
- 活动区可视化建议签名：`buildActivityZone(zone: ActivityZone, selected: boolean): Group`。

## 测试要求（必须新增，不得删改既有测试）

- `src/render/__tests__/activityZone.test.ts`：
  - 各类型都能构造（10 种 type 全覆盖，不抛错）
  - `pos`/`size`/`rotY`/`planeH` 反映到 group 的 position/rotation/子 mesh 尺寸
  - 选中态边框颜色与未选中不同
- `src/render/__tests__/furniture.test.ts`：
  - 各类型都能构造，返回的 group 非空
  - 所有子 mesh 的 `castShadow === true && receiveShadow === true`（遮挡上下文的关键，必须断言）
  - 家具 group 的整体位置与 zone.pos 一致
- App 层的 zone sync 若难单测，至少 `npm run verify` 全绿 + 手工跑通。

## 验收（Hermes 会验）

1. `npm run verify` 全绿（typecheck + lint 0 error + 测试全过）。
2. `npm run build` 成功。
3. 手工 `npm run dev`，浏览器确认：
   - 初始工程里的两个活动区（休闲/用餐）在 3D 里能看到工作面包 + 边框，且工作面包高度正确（休闲 0.45m、用餐 0.78m）。
   - 休闲区有沙发，用餐区有餐桌。
   - 新建一个「工作」活动区 → 3D 里出现书桌。
   - 删除一个活动区 → 3D 里的区和家具一起消失。
   - 选中活动区 → 3D 里对应区高亮。
   - 家具产生阴影（不是穿模的光）。

## 红线（违反即返工）

- **业务层不直接 import three 渲染器**（`WebGLRenderer`/`WebGPURenderer`），只走 `backend.ts`。
- **不引 `three/addons` 桶文件**。
- **家具必须 castShadow + receiveShadow**（否则失去遮挡意义，照度场失真）。
- **活动区可视化不得干扰选灯 raycasting**。
- TypeScript strict 无 any，named export，camelCase 文件名，ESLint 0 error。
- 不做风格切换、不做材质系统、不做软装密度、不做照片提取（那些是 M1.5 的完整范围，本阶段只做最小遮挡上下文）。

## 提交

一个逻辑增量一个 commit，信息风格参照 `git log`：`P4: ...`。提交后 `git push`（远端 origin 已配置，SSH）。
