/**
 * render/shadeScale.ts（P31）
 *
 * P29 定义的灯具视觉与发光缩放常量。
 * 独立文件，避免 fixtureModels.ts ↔ lightBuilder.ts 循环依赖
 * （fixtureModels 用 SHADE_VISUAL_SCALE 缩放几何，lightBuilder 用
 * SHADE_EMISSIVE_SCALE 计算 emissive 强度）。
 */

/**
 * 灯具灯罩的**可视化缩放倍数**。
 *
 * 演进：
 *   P8 初版 2.5（视觉直径 ~0.45m，肉眼勉强可见）
 *   P29    6.0（视觉直径 ~1.32m，"看得见"，但过大压场）
 *   P31    3.0（视觉直径 ~0.66m，物理合理，配合 P30 独立几何造型清晰可辨）
 *
 * P30 之后每类灯具已有独立造型（吊灯吊线+球罩、落地灯底座+杆+球罩等），
 * 不再依赖"把几何整体放大"来让人认出——3.0 是**物理合理**（真实筒灯
 * 直径 0.2m，视觉 0.6m 略夸张但符合室内设计预览尺度），且不会把房间
 * 塞满导致 raycast 挡视线、拖放新灯被塞进旧灯罩内部。
 *
 * 这个值只影响灯具**替身**的视觉大小，不影响光数据的物理尺度
 * （SpotLight/PointLight 的 intensity 与衰减半径不变）。
 */
export const SHADE_VISUAL_SCALE = 3.0;

/**
 * emissive 强度缩放系数（用于 applyFixtureIntensity）。
 *
 * 在 THREE r182 后 emissiveIntensity=1 与 ACES tonemap 组合下
 * Mesh 发光不够醒目——需要 2-3x 才能达到 "亮得像灯泡"的观感。
 */
export const SHADE_EMISSIVE_SCALE = 3.0;
