/**
 * 50mm 网格吸附（P28，3D）。
 *
 * 与 P22 的 2D 网格吸附不同：那是 PlanToWorld 的 0.1m 网格。这里 0.05m
 * 是产品体验上更好的粒度（审查方案 §Phase 1 第 4 项明确「50mm 网格吸附」）。
 *
 * 用于拖放落点（App.handleDropFixture）。TransformControls 的拖拽吸附走
 * three.js 自带的 `tc.translationSnap = 0.05`（不重复造轮子）。
 *
 * 吸附策略：`Math.round(v / step) * step`；负值正常四舍五入（round 而非 floor）。
 */

export const FIXTURE_GRID_M = 0.05;

export function snapFixturePos(
  pos: readonly [number, number, number],
  step: number = FIXTURE_GRID_M,
): readonly [number, number, number] {
  const round = (v: number) => Math.round(v / step) * step;
  return [round(pos[0]), round(pos[1]), round(pos[2])];
}
