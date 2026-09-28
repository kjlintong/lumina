/**
 * 按安装方式决定 TransformControls 允许的轴（P28）。
 *
 * TransformControls 三个 mode：'translate' / 'rotate' / 'scale'。
 * 轴字段的语义：''（禁用）/ 'X' / 'Y' / 'Z' / 'XY' / 'XZ' / 'YZ' / 'XYZ'。
 * 本模块只给语义化配置，落到 TransformControls 的具体 show* 位由
 * `SceneEngine.applyMountAxes` 处理（three r186 的 showX / showXZ 等组合面）。
 *
 * 详见 docs/p28-phase1-fixture-drag-spec.md §2.1。
 */

import type { MountType } from '../core/types.js';

export interface MountAxesConfig {
  translateMode: 'translate';
  rotateMode: 'rotate';
  /** translate 允许的轴（TransformControls 内部字符串） */
  translateAxis: '' | 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ' | 'XYZ';
  /** rotate 允许的轴 */
  rotateAxis: '' | 'X' | 'Y' | 'Z';
}

export function axesForMount(mount: MountType): MountAxesConfig {
  switch (mount) {
    case 'ceiling':
    case 'recessed':
      // 吸顶 / 筒灯：贴天花，沿天花面 XZ 平移 + 绕 Y 旋转灯体
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'wall':
      // 壁灯：贴墙；简化为 XZ 平移 + Y 旋转（真实墙上滑轨留后续阶段）
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'suspended':
      // 吊灯：全轴平移（悬空任意方向都可动）+ Y 旋转
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XYZ', rotateAxis: 'Y' };
    case 'track':
      // 轨道灯：贴轨道面，简化同 ceiling
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
    case 'floor':
    case 'tabletop':
      // 落地 / 桌面：XZ 平移 + Y 旋转
      return { translateMode: 'translate', rotateMode: 'rotate', translateAxis: 'XZ', rotateAxis: 'Y' };
  }
}
