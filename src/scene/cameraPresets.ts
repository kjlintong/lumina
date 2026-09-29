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
  key: 'window' | 'sofa' | 'dining' | 'overview' | 'plan';
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
    // 餐桌位：餐桌西侧斜上俯视，桌面居中（用餐视角）
    //
    // 坐标依据 projectStore.ts:179 的 dining zone (1.4, -1.0) + zoneTypes.ts:65
    // 的 defaultSize [1.8, 1.0] → 桌面 1.35×0.7m、顶面 y=0.74（furniture.ts:151）。
    // 原 target [0,1,-0.5] 指向房间中部偏北，相机在餐桌东侧朝西北看，餐桌落在
    // 画面外右后方：桌面中心投影到 uv=(0.867, -0.224)，而 fov 37 / aspect 1.71
    // 的右边界只有 0.572 —— 只有 2/4 桌角在视野内。
    // 现改为相机在餐桌西侧 [0.5, 1.4, 0.6]，俯视桌面中心 [1.4, 0.74, -1.0]：
    // 桌面中心 uv=(0,0) 正中，4/4 桌角在视野内，距桌面 1.95m。
    // 不撞家具：lounge 区覆盖 x∈[-1.95,-0.45]（相机 x=0.5 在外），dining 区
    // 覆盖 z∈[-1.5,-0.5]（相机 z=0.6 在外），吊灯 y≈2.1 在相机上方不遮挡。
    key: 'dining',
    name: '餐桌位',
    position: [0.5, 1.4, 0.6],
    target: [1.4, 0.74, -1.0],
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
  {
    // 顶视（正交近似）：3D 视口垂直俯视房间，与 2D FloorPlan 视觉对齐。
    // P36 · Phase 3 §3.3：3D 里能直接看到 2D 户型图的内容，选中态可跨视图同步。
    //
    // 坐标依据：room 尺寸 6×4.5×2.8（projectStore.ts:245 默认），房间中心 (0,0,0)。
    // 相机放在正上方 z=0.001（防 lookAt 除零），target 是地面中心。
    // fov=37° + distance=6m 时垂直视角覆盖约 3.6m 宽，正好铺满房间 4.5m 深边
    // 的一半，配合 OrbitControls 缩放能铺满全景。
    //
    // **切到 plan 机位后，`sceneEngine.setCameraPreset` 调 `orbitControls.enableRotate = false`**
    // ——见 sceneEngine.ts 修改项。
    key: 'plan',
    name: '顶视',
    position: [0, 6, 0.001],
    target: [0, 0, 0],
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
