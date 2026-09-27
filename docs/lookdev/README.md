# Lumina Lookdev 截图流程

本目录用于存放**每日画面质量对比截图**，是 `LUMINA_两周执行规格_hermes.md` Day 7 验收的产物。

> **硬红线**（规格 §1）：禁止在 SwiftShader / 软件渲染下验收画面。所有截图必须在**真实 GPU**（RTX 3060 / Apple M2 同级或更高）上跑，1920×1080，确认 60fps 稳定后再截。

---

## 1. 截图流程

### 1.1 启动

```bash
# 在真实 GPU 的机器上（不是 WSL 软渲染）
cd lumina
pnpm install
pnpm dev
```

### 1.2 准备场景

1. 用 1 个标准户型（6×4.5×2.8m 默认房间，或 P22/P23 导入的户型图）
2. 摆 1 套灯（建议：客厅 downlight + 餐厅 pendant + 角落 floor，共 3 盏，与 `createInitialProject()` 默认一致）
3. 时间轴拨到 **17:45**（日落，帧 A 时段）

### 1.3 截 4 机位 × 2 时段 = 8 张

机位名来自 `src/scene/cameraPresets.ts`，时段来自 `TimeAxis`：

| 机位 key | 中文名 | 视角描述 |
|---|---|---|
| `window` | 窗景位 | 南侧朝北窗看，看天空渐变 + 光柱 |
| `sofa` | 沙发位 | 起居区坐着，看餐厅/窗户（日常视角） |
| `dining` | 餐桌位 | 餐桌西侧斜上俯视，桌面居中 |
| `overview` | 全景位 | 房间对角俯视，完整布局 |

时段：
- **日落 17:45** —— 帧 A，产品门面（太阳 2200K 暖金 + 天光 9000K 冷侧）
- **夜间 21:00** —— 帧 B，纯人工光（太阳归零，全靠灯具 + 屏幕光）

### 1.4 保存

文件名约定：`YYYY-MM-DD_<机位>_<时段>.png`

例：
```
2026-09-27_window_sunset.png
2026-09-27_sofa_sunset.png
2026-09-27_dining_sunset.png
2026-09-27_overview_sunset.png
2026-09-27_window_night.png
2026-09-27_sofa_night.png
2026-09-27_dining_night.png
2026-09-27_overview_night.png
```

保存到 `docs/lookdev/YYYY-MM-DD/` 子目录（按日期分组）。

---

## 2. 验收标准

8 张截图必须能回答：

1. **冷暖分级**：日落帧里太阳（2200K 暖金）和天光（9000K 冷侧）有明显对比，不是全白。
2. **太阳是主光**：17:45 帧里太阳是主光源，有明确光柱穿过洞口，不是纯人工光白盒子。
3. **材质不死平**：木地板有板缝 + 木纹高光带，墙面有微 normal 起伏，玻璃有折射（不是死白板）。
4. **阴影正确**：太阳投 2048² PCFSoft 阴影，无阴影闪烁/漏光。
5. **Bloom 不糊**：threshold 0.85 只让真 HDR 高光源（灯体 emissive > 1、太阳圆盘）溢，白墙不溢。
6. **无调试可视化泄漏**：3D 主画面无绿/黄活动区线框、无 JSON/lux 控件。

逐条对照 `frames.md` 记录差距，不写「感觉不错」，写「差在哪 3 条 + 怎么补」。

---

## 3. 文件结构

```
docs/lookdev/
├── README.md              ← 本文件，截图流程
├── frames.md              ← 帧 A/帧 B 目标描述 + 差距记录模板
└── <YYYY-MM-DD>/          ← 按日期分组的截图
    ├── window_sunset.png
    ├── sofa_sunset.png
    ├── dining_sunset.png
    ├── overview_sunset.png
    ├── window_night.png
    ├── sofa_night.png
    ├── dining_night.png
    └── overview_night.png
```

> `templates/` 目录用于放**空目录占位**，方便在真实 GPU 机器上直接 `cp -r templates/ <日期>`。本目录不提交实际 PNG（避免仓库膨胀），截图提交到对应日期目录后自行 push。
