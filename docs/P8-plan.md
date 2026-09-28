# P8 — 视觉升级总体规划（对标两个参考项目）

> 本文件是总规划。Claude Code 只看单个阶段规格（P8a / P8b / P8c），
> 本文件只给我自己跟踪进度用。

## 目标视觉（从两个参考项目提炼）

参考 1「溪谷别墅」：低多边形建筑 + 木格栅 + 落地玻璃 + 低策略 UI + 数字 HUD
（三角面/部件/帧率）、编号导航、图层开关、2D 户型图。

参考 2「日落收藏家」：室内落日，落地玻璃窗，**体积光束穿过玻璃落在木地板上**，
暖色夕照 vs 冷色室内家具，绿植点缀，底部 17:00–20:00 渐变时间轴，
「18:10」文字投影在地板上，点太阳收藏，右下角 build 版本号。

Lumina 是**室内灯光设计工具**，取参考 2 的视觉语言（室内 + 落日 + 体积光 + 时间轴），
保留 Lumina 自己的产品 UI（活动区/灯具/场景/照度面板）。

## 三阶段

### P8a — 可见的、有氛围的房间（docs/P8-visual-upgrade-spec.md）✅ 进行中
材质（程序化木纹/法线）+ 北墙落地窗（MeshPhysicalMaterial transmission）+
天空/室外 group（太阳圆盘 + 远景剪影）+ 背景色渐变（skyColors 纯函数）+
PMREM RoomEnvironment 环境反射 + timeSpeed 默认 0 + 时间轴收到 16:00–21:00。

验收：首屏可读、时间不跑、材质可信、窗洞可见、夜间不黑死。

### P8b — 体积光与尘埃粒子（docs/P8b-spec.md）
1. 审计 P7 GodraysPass 真实效果（当前只在太阳 NDC z<1 时喂光源位置，且
   bloom threshold 0.85，可能完全看不见）。若无效则重写。
2. `src/render/dustParticles.ts`（新建）：Points 系统，~400 粒，随机分布在
   窗内光柱体积里，`PointsMaterial` + `AdditiveBlending` + `depthWrite=false`
   + `sizeAttenuation=true`；不用自定义 shader；每帧沿光方向缓慢漂移（sin 相位）。
3. 灯具发光可视化：灯罩 Mesh 加 `emissive`（按 CCT 颜色 × 亮度），
   让灯本身是个亮点，能被 bloom 抓到（这是"室内可见灯具"的关键）。
4. 阴影质量：contact 阴影或阴影 bias 调优，地板光斑边缘不发硬。

验收：夕照时段截图里**能肉眼看到光柱**（不是只有光斑）；灯光在室内形成
明确的光源感；粒子在光柱里漂浮但不抢戏。

### P8c — HUD 与时间轴重做（docs/P8c-spec.md）
1. 底部时间轴：16:00–21:00 渐变轨道（黄→橙→蓝紫），圆球发光手柄，
   小时刻度 16/17/18/19/20/21，左侧药丸形显示「17:45」。
2. 左上角 HUD：项目名 + 实时数字（三角面/部件/FPS）—— 数字要真实统计
   （renderer.info.render.triangles / scene 遍历 objectCount / 帧率采样）。
3. 场景预设按钮组视觉升级（当前是普通按钮，参考项目是暖色渐变药丸）。
4. 右下角 build 版本号 + 后端标识（`build <date> · webgl2`）。
5. 面板统一玻璃质感：`backdrop-filter: blur()`、1px 亮边、暖色 accent（`#f0a040`）。
6. 「时段」滑杆与场景预设联动提示（拖时间轴时给出当前是否日落时段）。

验收：截图与参考 2 的 UI 观感接近；HUD 数字真实且每秒刷新；玻璃面板不挡视线。

## 进度

| 阶段 | 状态 | commit |
|---|---|---|
| P8a 材质+窗+天空+环境反射+时间冻结 | ✅ 完成 | `dd227f2`, `1c2dc8a`(白窗修复), `7d7b0ff`(天空渐变) |
| P8b 体积光+尘埃粒子+灯具发光 | ✅ 完成 | `1ab5454`, `2ffd8c3` |
| P8c 渐变时间轴+真实数字HUD+玻璃UI | ✅ 完成 | `e235d9d`, `cd1dd95`(时间轴改24h) |
| P8d 装饰绿植（窗角点缀） | ✅ 完成 | `1e16bf0` |
| P8e 窗外城市天际线（替代平面剪影） | ✅ 完成 | `f5f44a1` |
| P8f 2D 户型图（SVG，与 store 联动） | ✅ 完成 | `829762f` |

P8 六阶段全部完成，测试 310 → 435 条。时间轴经用户验收改为全天 0–24h。

## P9 与 P9b 状态

| 阶段 | 状态 | commit / spec |
|---|---|---|
| P9 真实阴影 + 自动曝光采样 + 阴影预算 + 窗洞修复 | ✅ 已提交（`6d79627`） | `docs/P9-shadows-exposure-perf-spec.md` |
| P9 视觉验收 | ✅ 已做（Hermes 浏览器驱动） | `docs/P9-visual-acceptance.md` |
| P9b 曝光曲线 + 光柱可见性 + 小 UI 清理 | ✅ 已提交（`76dd198`） | `docs/P9b-exposure-godrays-spec.md` |
| P9b 视觉验收 | ✅ 已做（Hermes 浏览器驱动） | `docs/P9b-visual-acceptance.md` |
| P10 UI 视觉统一（design tokens / HUD 精简 / dev-only 降级提示 / 2D 户型图美化） | ✅ 已提交（`45fc60a`） | `docs/P10-ui-polish-spec.md` |
| P10 视觉验收 | ✅ 已做（Hermes 浏览器驱动） | `docs/P10-visual-acceptance.md` |
| P11 灯罩可见性修复（双重偏移 bug + 正确几何） | ✅ 已提交（`736b82c`） | — |
| P12 相机视高 / 场景 CCT 矩阵 / 材质 / IBL 强度 / 光柱默认 | ✅ 已提交（`2a0ef2f`） | `docs/p12-spec.md` |
| P13 godrays 按规格定版 + jitter 采样 + exposure/boost 分工 + 修光柱开关锁存 | ✅ 已提交（`38b6df4`） | — |
| P14 材质最小包（木地板三件套 + 玻璃 transmission + 布艺布纹） | ✅ 已提交（`feb01c4`） | `docs/p14-spec.md` |
| P15 天空渐变方向修正 + 时间默认流逝 + 渐变方向防回归测试（P15c rotateSpeed 反转 `b630db0`） | ✅ 已提交（`ddde017`） | `docs/p15-spec.md` |
| P16 Bloom 按太阳高度分三档（日间 / 日落 / 夜间） | ✅ 已提交（`9bf4593`） | `docs/p16-spec.md` |
| P17 太阳阴影视锥收紧到 ±6m + 清理 PointLight 死代码 | ✅ 已提交（`afe219a`） | `docs/p17-spec.md` |
| P18 4 相机机位预设 + 引擎内 tween（餐桌位俯视桌面中心 `43ba548`） | ✅ 已提交（`84567fd`） | `docs/p18-spec.md` |
| P19 专业模式门禁（JSON / lux / XYZ / 渲染调参默认收起，§4 Day 6 j） | ✅ 已提交（`a679427`） | `docs/p19-spec.md` |
| P20 场景曝光矩阵（§5 toneMappingExposure 半块） | ✅ 已提交（`571f310`） | — |
| P21 导入建模地基（数据契约 + 比例尺标定 + 置信度 + 拓扑校验 + parser 预留，§6 范围 1/2/7/8） | ✅ 已提交 | `docs/p21-spec.md` |
| P26a Phase 0 止血 · 工程（冻结 WebGPU / 时间冻结 / 布局修 / dev 面板 / perfBill） | ✅ 已提交（`17d1c05` + `2765a04` vite 补丁 + `4ef725d` CLAUDE.md） | `docs/p26a-phase0-engineering-spec.md`（2026-09-28） |
| P26b Phase 0 止血 · 入夜画面（曝光 1.0→1.6 + 夜间 ambient/hemi 兜底） | ✅ 已提交（`590c1b3`，画面判定权在用户） | `docs/p26b-phase0-night-frames-spec.md`（2026-09-28） |
| P27 Phase 1 · 命令栈基础设施（CommandStack + Ctrl+Z/Y + UndoRedoBar） | ✅ 已提交（`159a5d4` + `54cefb1` 规格） | `docs/p27-phase1-commandstack-spec.md`（2026-09-28） |
| P28 Phase 1 · 灯具库 + 拖放 + TransformControls | ✅ 已提交（`a2c664b`） | `docs/p28-phase1-fixture-drag-spec.md`（2026-09-28） |
| P29 灯具可见性修复（法线判定反转 + 视觉放大 + 拖放修复） | ✅ 已提交（`97e2150` + `1ae3d31` + `dfdbc0a`） | `docs/p29-fixture-visibility-spec.md`（2026-09-28） |
| P30 灯具类型独立几何模型（8 类各有造型） | ✅ 已提交（`69cd721`） | `docs/p30-fixture-models-spec.md`（2026-09-28） |
| P31a 修复 fixtureModels ↔ lightBuilder 循环依赖导致黑屏 | ✅ 已提交（`1694de4`） | — |
| P31b 灯具视觉尺度 6.0 → 3.0（物理合理） | ✅ 已提交（`cfd24e8`） | — |
| P32a 拖放落点 NDC Y 轴误用 clientX + 清 debug log | ✅ 已提交（`1c70db1`） | — |
| P32a-fix 恢复无 face 命中的跳过（拖放新灯才落到墙上） | ✅ 已提交（`4866ab8` + `ff45a12`） | — |
| P32b Node 26 下 jsdom `window.localStorage` 变 undefined 的测试回归 | ✅ 已提交（`a353483`，vitest.setup.ts 补内存版 Storage polyfill） | — |

### Phase 0 止血（源自 `Lumina项目审查与后续工作方案.md` §二）

P26a 与 P26b 属于 6 周方案的 **Phase 0**（2–3 天，不做完不进 Phase 1），由两个并行子代理同时推进，
互不干涉：P26a 只碰工程（WebGPU 冻结、时间默认冻结、左上 HUD 与户型图布局重叠、
Bloom/Godrays 滑块收进 dev 面板、性能账单），P26b 只碰入夜画面（20:00 帧的天花/桌面/墙面/
地面四条达标）。**唯一 KPI** 是「上传户型图 → 3 分钟出可校正 3D → 拖灯 → 拖动调位 →
画面不崩」这条完整链路；Phase 0 的画面精修以门禁形式嵌在验收里，不设独立阶段。
验收画面必须在真实 GPU 上判定，WSL2 SwiftShader 截图不作数。

## 遗留问题（不阻塞，已记录）

1. **P8d 体积光光束偏淡**：太阳低于地平线时已正确隐藏（`shaft.ts` 用 `sinEl` 门控），
   白昼时段强度受 bloom threshold 0.85 限制，视觉偏弱。**P9b 修复中**。
2. **P9 自动曝光 targetLuminance=0.17 假设错误**：采样值全部 > 1（linear），
   算法算出中午和夜晚同一个 exposure=0.14，导致整个白天看起来像深夜。**P9b 修复中**。
3. **P9 压 bloom strength 到 0.22 顺带压死 godrays**：godrays shader 输出 ~0.05–0.2，
   远低于 0.85 阈值，bloom 不抓它，光柱看不见。**P9b 修复中**（走 `uBoost` uniform，不动 bloom 参数）。
4. **FPS 稳定值未重测**：本环境是 SwiftShader，rAF 不派发，5 FPS 是渲染开销而非稳态帧率。
   需用户在真实 GPU 机器上起 dev server 看 HUD 实测。
5. **装饰绿植与参考图仍有差距**：参考 2 的绿植体量更大、层数更多，当前 P8d 版本偏小巧。
   可后续增加变体或调高 `FOLIAGE_HEIGHT`。
6. **P11–P19 尚未产出 lookdev 金标准截图**：`docs/lookdev/` 目录尚不存在。按
   `LUMINA_两周执行规格_hermes.md` §8 的每日门禁要求，每个 P 阶段需附金标准截图。
   截图必须在真实 GPU 机器上导出 —— 本开发环境是 WSL2 SwiftShader，禁止在此验收画面
   （与第 4 条同源：SwiftShader 下 rAF 不派发、渲染开销不可作为画面依据）。

### Open questions（源自 `Lumina项目审查与后续工作方案.md` §四，待用户拍板）

7. **执行方式**：继续让 hermes 按 6 周方案逐阶段执行（用户做每阶段门禁审查），
   还是关键模块（SceneDoc / 描墙 / TransformControls）由用户直接实现？
8. **演示节点**：如果两周内需要对外演示，Phase 1 结束时即可演示「上传户型图 → 布灯 →
   调位」完整链路（白模画质）；若可等到 6 周后，画面与功能同时达标。
   演示时间点决定 Phase 2（资产与调色）是否可压缩。
