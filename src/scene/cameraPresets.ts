/**
 * 相机机位预设（P18，审查报告 §4 Day 6 k）。
 *
 * 4 个可复现机位：窗景位 / 沙发位 / 餐桌位 / 全景位。
 * 纯数据 + 纯函数（easeInOutQuad / lerp），供 sceneEngine 的 tween 插值使用，
 * 也便于单测直接测插值数学而不用构造引擎实例。
 *
 * 红线：机位是纯相机操作，不进 store（见 p18-spec.md）。
 */

/** 相机机位预设 */
export interface CameraPreset {
  key: 'window' | 'sofa' | 'dining' | 'overview';
  name: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    // 窗景位：站在南侧，朝北窗看 —— 看天空渐变 + 窗外天际线 + 光柱
    key: 'window',
    name: '窗景位',
    position: [0.6, 1.5, 1.2],
    target: [0, 1.6, -3],
  },
  {
    // 沙发位：起居区坐着，看向餐厅/窗户（家庭日常视角）
    key: 'sofa',
    name: '沙发位',
    position: [-1.5, 1.2, 1.2],
    target: [0, 1.2, -1],
  },
  {
    // 餐桌位：餐桌边，看向对面（用餐视角）
    key: 'dining',
    name: '餐桌位',
    position: [1.5, 1.3, 1.0],
    target: [0, 1.0, -0.5],
  },
  {
    // 全景位：房间一角高角度，俯瞰全屋（户型展示）
    // 原 p18-spec.md 给的 [2.5, 2.2, 2.5] 两处越界，相机落在墙**外**，
    // 而四面墙是实心 BoxGeometry（render/room.ts:311-365），会被完全挡住：
    //   - x=2.5：东墙在 x=+3、厚 0.15，内表面 x=2.925（勉强在内）
    //   - z=2.5：南墙在 z=+2.25，内表面 z=2.175 —— 2.5 在墙**外**，必被挡
    // 改为 [2.0, 2.2, 2.0]：三面内表面余量 ≥0.2m，不贴墙不穿墙。
    // 距 target 3.05m > OrbitControls.minDistance=1；
    // 水平视角 45° / 俯角 26°，从西南角上方俯瞰全屋（家具群 |x|≤2.3, |z|≤1.5）。
    key: 'overview',
    name: '全景位',
    position: [2.0, 2.2, 2.0],
    target: [0, 1.0, 0],
  },
];

/** 按 key 查预设；未命中返回 undefined（调用方决定兜底） */
export function cameraPresetByKey(key: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((p) => p.key === key);
}

/**
 * easeInOutQuad：[0,1]→[0,1]，端点 0/1，中点 0.5，[0,1] 内单调递增。
 * 起步慢、中段快、收尾慢 —— 比线性更像「镜头运镜」。
 * 不钳位：钳位在 sceneEngine.stepCameraTween 里做。
 */
export function easeInOutQuad(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

/** 线性插值；t=0 返回 a，t=1 返回 b。不钳位，越界即外插（调用方钳位）。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
