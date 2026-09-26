import { useProjectStore } from '../../store/projectStore.js';
import {
  computeScale,
  fixturesToDots,
  planOrigin,
  roomRect,
  windowSegment,
  zonesToRects,
} from '../../render/planLayout.js';

/** 灯具类型 → SVG 符号（不同形状便于区分灯型） */
function dotSymbol(type: string): string {
  switch (type) {
    case 'pendant':
      return '◆';
    case 'floor':
      return '▲';
    case 'table':
      return '□';
    case 'downlight':
      return '·';
    default:
      return '●';
  }
}

/** 灯具类型 → 颜色（与色温对应） */
function dotColor(type: string): string {
  if (type === 'pendant' || type === 'floor') return '#f0a040'; // 暖色
  if (type === 'downlight') return '#e0c870'; // 暖白
  return '#d0d0d0';
}

/**
 * 2D 户型图（P8f）。
 *
 * 俯视平面图：房间外框 + 北墙开口（窗）+ 活动区矩形 + 灯具点。
 * 数据来自 useProjectStore，随 store 变更自动更新。
 * 房间尺寸与引擎 SceneEngineConfig 一致（6×4.5×2.8m）。
 */
export function FloorPlan({ width = 220, height = 170 }: { width?: number; height?: number }) {
  const project = useProjectStore((s) => s.project);
  const selectedZoneKey = useProjectStore((s) => s.selectedZoneKey);
  const selectZone = useProjectStore((s) => s.selectZone);

  // 房间尺寸（与引擎默认一致）
  const room = { width: 6, depth: 4.5, height: 2.8 };
  const config = { width, height };
  const scale = computeScale(room, config);
  const { ox, oy } = planOrigin(config);

  const r = roomRect(room, ox, oy, scale);
  const win = windowSegment(room, room.width * 0.7, ox, oy, scale);
  const rects = zonesToRects(project.zones, ox, oy, scale);
  const dots = fixturesToDots(project.fixtures, ox, oy, scale);

  return (
    <div className="floor-plan">
      <div className="floor-plan-title">户型图</div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        className="floor-plan-svg"
        role="img"
        aria-label="2D 户型平面图"
      >
        {/* 房间地板底色 */}
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="rgba(255,200,120,0.06)"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1.5}
        />

        {/* 活动区（点击选中，与 ZonePanel 联动） */}
        {rects.map((z) => (
          <g
            key={z.key}
            className="floor-plan-zone"
            style={{ cursor: 'pointer' }}
            onClick={() => selectZone(selectedZoneKey === z.key ? null : z.key)}
          >
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              fill="rgba(240,160,64,0.18)"
              stroke={selectedZoneKey === z.key ? '#f0a040' : 'rgba(240,160,64,0.5)'}
              strokeWidth={selectedZoneKey === z.key ? 1.5 : 1}
            />
            <text x={z.labelX} y={z.labelY} textAnchor="middle" fontSize={8} fill="#e0c870" className="floor-plan-label">
              {z.name.length > 6 ? z.name.slice(0, 6) + '…' : z.name}
            </text>
          </g>
        ))}

        {/* 北墙窗（开口） */}
        <line x1={win.x1} y1={win.y} x2={win.x2} y2={win.y} stroke="#60a0d0" strokeWidth={3} />
        <text x={(win.x1 + win.x2) / 2} y={win.y - 3} textAnchor="middle" fontSize={7} fill="#60a0d0">
          窗
        </text>

        {/* 灯具 */}
        {dots.map((d) => (
          <text key={d.id} x={d.x} y={d.y} textAnchor="middle" fontSize={10} fill={dotColor(d.type)} className="floor-plan-fixture">
            {dotSymbol(d.type)}
          </text>
        ))}
      </svg>
    </div>
  );
}
