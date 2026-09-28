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
 * P29 前的值 2.5 太保守——在 3-4m 视距下投影直径 <100px，画面"看不见灯"。
 * 提到 6.0 后 disc 视觉直径 ~1.32m，肉眼清晰可辨。
 *
 * 这个值只影响灯具**替身**的视觉大小，不影响光数据的物理尺度
 * （SpotLight/PointLight 的 intensity 与衰减半径不变）。
 */
export const SHADE_VISUAL_SCALE = 6.0;

/**
 * emissive 强度缩放系数（用于 applyFixtureIntensity）。
 *
 * 在 THREE r182 后 emissiveIntensity=1 与 ACES tonemap 组合下
 * Mesh 发光不够醒目——需要 2-3x 才能达到 "亮得像灯泡"的观感。
 */
export const SHADE_EMISSIVE_SCALE = 3.0;
