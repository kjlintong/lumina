import { useMemo, useState } from 'react';
import { useModelingStore } from '../../store/modelingStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { isLowConfidence } from '../../core/confidence.js';
import {
  luminanceGrid,
  luminanceToColor,
  rgbaToString,
} from '../../lighting/heatmap.js';
import {
  modelBounds,
  wallsToSvg,
  roomsToPaths,
  openingsToSvg,
  modelPlanOrigin,
  computeModelScale,
  wallLabels,
  roomLabels,
  worldToPlan,
} from '../../render/modelPlanLayout.js';

/**
 * 2D 户型图面板（P22 §3.4）。
 *
 * 显示 `project.model`（`ModelGeometry`）的墙体、房间、开口。
 * 坐标系约定（与 `modelPlanLayout.ts` 一致）：
 *   - 世界 x：东西向，右为正
 *   - 世界 z：南北向，负为北
 *   - SVG y：向下为正
 */
export function ModelPlan() {
  const { model } = useModelingStore();
  const fixtures = useProjectStore((s) => s.project.fixtures);
  const width = 400;
  const height = 400;

  const bounds = useMemo(() => modelBounds(model), [model]);
  const { ox, oy } = useMemo(
    () => modelPlanOrigin({ width, height }),
    [width, height],
  );
  const scale = useMemo(
    () => (bounds ? computeModelScale(bounds, { width, height }) : 0),
    [bounds, width, height],
  );
  const [showDims, setShowDims] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);

  // modelBounds 返回 { width, depth }（未中心归零）；heatmap 需要 x0/x1/z0/z1。
  // 由于场景模型的中心在世界原点（见 modelPlanLayout.modelBounds 注释），
  // 世界坐标范围就是 ±width/2、±depth/2。
  const heat = useMemo(() => {
    if (!showHeatmap || !bounds) return null;
    const half = bounds.width / 2;
    const halfD = bounds.depth / 2;
    return luminanceGrid(Object.values(fixtures), {
      bounds: { x0: -half, x1: half, z0: -halfD, z1: halfD },
      step: 0.4,
    });
  }, [showHeatmap, bounds, fixtures]);

  if (!bounds) {
    return (
      <div className="model-plan" style={{ width, height }}>
        <p style={{ textAlign: 'center', color: '#888', padding: '2em' }}>
          空画布：点击「描墙」或选择模板
        </p>
      </div>
    );
  }

  const walls = wallsToSvg(model.walls, ox, oy, scale);
  const rooms = roomsToPaths(model.rooms, ox, oy, scale);
  const openings = openingsToSvg(model.openings, model.walls, ox, oy, scale);

  return (
    <div className="model-plan" style={{ width, height, position: 'relative' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {/* 房间填充 */}
        {rooms.map((r) => {
          const room = model.rooms.find((rm) => rm.id === r.id);
          const isLow = room ? isLowConfidence(room.confidence) : false;
          return (
            <path
              key={r.id}
              d={r.d}
              fill={isLow ? 'rgba(255, 80, 80, 0.15)' : 'rgba(240, 192, 64, 0.08)'}
              stroke={isLow ? 'rgba(255, 80, 80, 0.6)' : 'rgba(255, 255, 255, 0.15)'}
              strokeWidth={1}
            />
          );
        })}

        {/* 照度伪彩（P34 Part D）—— 叠加在墙线下方 */}
        {heat && (
          <g opacity={0.55} style={{ pointerEvents: 'none' }} aria-hidden>
            {heat.lx.map((v, idx) => {
              const center = heat.cellCenters[idx]!;
              const p = worldToPlan(center[0], center[1], ox, oy, scale);
              const cellPx = 0.4 * scale;
              const color = rgbaToString(luminanceToColor(v, heat.maxLx));
              return (
                <rect
                  key={`h-${idx}`}
                  x={p.x - cellPx / 2}
                  y={p.y - cellPx / 2}
                  width={cellPx}
                  height={cellPx}
                  fill={color}
                />
              );
            })}
          </g>
        )}

        {/* 墙体 */}
        {walls.map((w) => (
          <line
            key={w.id}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke="rgba(255, 255, 255, 0.8)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}

        {/* 开口 */}
        {openings.map((o) => (
          <line
            key={o.id}
            x1={o.x1}
            y1={o.y1}
            x2={o.x2}
            y2={o.y2}
            stroke={o.kind === 'window' ? '#60a0d0' : '#e0a040'}
            strokeWidth={o.kind === 'window' ? 2 : 1.5}
            strokeDasharray={o.kind === 'door' ? '4 2' : undefined}
          />
        ))}

        {/* 墙段尺寸标注（P33） */}
        {showDims &&
          wallLabels(model.walls, ox, oy, scale).map((l, i) => (
            <text
              key={`wlabel-${i}`}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              fill="rgba(255, 255, 255, 0.7)"
              fontSize={9}
              transform={`rotate(${l.angle} ${l.x} ${l.y})`}
              style={{ userSelect: 'none' }}
            >
              {l.text}
            </text>
          ))}

        {/* 房间标签（P33：可选追加面积行） */}
        {showDims
          ? roomLabels(model.rooms, ox, oy, scale).map((l) => (
              <text
                key={`rlabel-${l.name}`}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fill="rgba(255, 255, 255, 0.6)"
                fontSize={10}
                style={{ userSelect: 'none' }}
              >
                <tspan x={l.x} dy={0}>
                  {l.name}
                </tspan>
                <tspan x={l.x} dy={12}>
                  {l.areaText}
                </tspan>
              </text>
            ))
          : rooms.map((r) => (
              <text
                key={`label-${r.id}`}
                x={r.cx}
                y={r.cy}
                textAnchor="middle"
                fill="rgba(255, 255, 255, 0.5)"
                fontSize={10}
                style={{ userSelect: 'none' }}
              >
                {r.name}
              </text>
            ))}
      </svg>

      {/* 面积显示 */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          right: 8,
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.5)',
        }}
      >
        {model.rooms.length} 房间 · {model.walls.length} 墙段
      </div>

      {/* 尺寸标注开关（P33） */}
      <label
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.7)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={showDims}
          onChange={(e) => setShowDims(e.target.checked)}
        />
        尺寸
      </label>

      {/* 照度伪彩开关（P34 Part D）—— 尺寸下方 */}
      <label
        style={{
          position: 'absolute',
          top: 22,
          right: 8,
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.7)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={showHeatmap}
          onChange={(e) => setShowHeatmap(e.target.checked)}
        />
        照度
      </label>
    </div>
  );
}
