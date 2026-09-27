import { useCallback, useRef, useState } from 'react';
import { useModelingStore } from '../../store/modelingStore.js';
import {
  modelBounds,
  snapToGrid,
  snapOrtho,
  planToWorld,
  worldToPlan,
  modelPlanOrigin,
  computeModelScale,
  GRID_SNAP_M,
} from '../../render/modelPlanLayout.js';

/**
 * 描墙画布（P22 §3.4）。
 *
 * 交互流程：
 *   1. 点「描墙」→ isDrawing = true
 *   2. 在 SVG 上点击 → planToWorld → snapToGrid → snapOrtho → addPendingVertex
 *   3. onPointerMove 画预览虚线 + 显示长度（米，保留 2 位）
 *   4. ≥ 3 点时显示首末闭合预览线（不同颜色）
 *   5. 输入房间名 + 点「完成房间」或按 Enter → commitRoom(name)
 *   6. Esc → cancelPending
 *
 * 吸附：网格吸附（0.1m）+ 正交吸附（15° 阈值），两个 checkbox 控制。
 */
export function ModelCanvas() {
  const {
    model,
    pendingVertices,
    pendingRoomName,
    gridSnap,
    orthoSnap,
    isDrawing,
    addPendingVertex,
    cancelPending,
    commitRoom,
    setGridSnap,
    setOrthoSnap,
    startDrawing,
    stopDrawing,
  } = useModelingStore();

  const [roomName, setRoomName] = useState(pendingRoomName);
  const [mouseWorld, setMouseWorld] = useState<readonly [number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const width = 400;
  const height = 400;

  // 计算视图参数（有 model 时居中显示，空画布时用固定缩放）
  const bounds = modelBounds(model);
  const { ox, oy } = modelPlanOrigin({ width, height });
  const scale = bounds
    ? computeModelScale(bounds, { width, height })
    : 40; // 默认 40 px/m（空画布）

  // 鼠标 SVG 坐标 → 世界坐标 → 吸附
  const getWorldPoint = useCallback(
    (clientX: number, clientY: number): readonly [number, number] | null => {
      const svg = svgRef.current;
      if (svg === null) return null;
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * width;
      const sy = ((clientY - rect.top) / rect.height) * height;
      let [wx, wz] = planToWorld(sx, sy, ox, oy, scale);
      if (gridSnap) [wx, wz] = snapToGrid([wx, wz], GRID_SNAP_M);
      if (orthoSnap && pendingVertices.length > 0) {
        [wx, wz] = snapOrtho(pendingVertices[pendingVertices.length - 1]!, [wx, wz]);
      }
      return [wx, wz] as readonly [number, number];
    },
    [gridSnap, orthoSnap, pendingVertices, ox, oy, scale],
  );

  // onPointerMove：更新预览线
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing) return;
      setMouseWorld(getWorldPoint(e.clientX, e.clientY));
    },
    [isDrawing, getWorldPoint],
  );

  // onClick：追加顶点
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return;
      const p = getWorldPoint(e.clientX, e.clientY);
      if (p !== null) addPendingVertex([p[0], p[1]]);
    },
    [isDrawing, getWorldPoint, addPendingVertex],
  );

  // Esc 取消
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') cancelPending();
    },
    [cancelPending],
  );

  // Enter 提交
  const onSubmit = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && pendingVertices.length >= 3) {
        commitRoom(roomName || '房间');
        setMouseWorld(null);
      }
    },
    [pendingVertices.length, roomName, commitRoom],
  );

  // 完成房间按钮
  const onComplete = useCallback(() => {
    if (pendingVertices.length >= 3) {
      commitRoom(roomName || '房间');
      setMouseWorld(null);
    }
  }, [pendingVertices.length, roomName, commitRoom]);

  // 把世界坐标顶点转成 SVG 坐标
  const toSvg = useCallback(
    (wx: number, wz: number) => worldToPlan(wx, wz, ox, oy, scale),
    [ox, oy, scale],
  );

  // 计算预览线（最后一点 → 鼠标）
  let previewLine: { x1: number; y1: number; x2: number; y2: number; len: number } | null = null;
  if (isDrawing && pendingVertices.length > 0 && mouseWorld !== null) {
    const last = pendingVertices[pendingVertices.length - 1]!;
    const p1 = toSvg(last[0], last[1]);
    const p2 = toSvg(mouseWorld[0], mouseWorld[1]);
    const dx = mouseWorld[0] - last[0];
    const dz = mouseWorld[1] - last[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    previewLine = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, len };
  }

  // 闭合预览线（≥ 3 点时，首末连线）
  let closePreview: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (pendingVertices.length >= 3) {
    const first = pendingVertices[0]!;
    const last = pendingVertices[pendingVertices.length - 1]!;
    const p1 = toSvg(first[0], first[1]);
    const p2 = toSvg(last[0], last[1]);
    closePreview = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }

  return (
    <div className="model-canvas" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="model-canvas-title" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
        描墙画布
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: 'block', cursor: isDrawing ? 'crosshair' : 'default' }}
        onPointerMove={onPointerMove}
        onClick={onClick}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="img"
        aria-label="描墙画布"
      >
        {/* 网格背景 */}
        {isDrawing && gridSnap && (
          <g opacity={0.15}>
            {Array.from({ length: Math.ceil(width / 10) }, (_, i) => (
              <line key={`gv${i}`} x1={i * 10} y1={0} x2={i * 10} y2={height} stroke="#fff" strokeWidth={0.5} />
            ))}
            {Array.from({ length: Math.ceil(height / 10) }, (_, i) => (
              <line key={`gh${i}`} x1={0} y1={i * 10} x2={width} y2={i * 10} stroke="#fff" strokeWidth={0.5} />
            ))}
          </g>
        )}

        {/* 已有模型（墙体 + 房间） */}
        {model.walls.length > 0 && (
          <g opacity={0.3}>
            {model.walls.map((w) => {
              const p1 = toSvg(w.a[0], w.a[1]);
              const p2 = toSvg(w.b[0], w.b[1]);
              return (
                <line key={w.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
              );
            })}
          </g>
        )}

        {/* 已放置顶点 → 小圆 */}
        {pendingVertices.map((v, i) => {
          const p = toSvg(v[0], v[1]);
          return (
            <circle key={i} cx={p.x} cy={p.y} r={4} fill="#f0a040" stroke="#fff" strokeWidth={1} />
          );
        })}

        {/* 预览虚线（最后一点 → 鼠标） */}
        {previewLine && (
          <line
            x1={previewLine.x1}
            y1={previewLine.y1}
            x2={previewLine.x2}
            y2={previewLine.y2}
            stroke="#f0a040"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        )}

        {/* 闭合预览线（首末连线，蓝色） */}
        {closePreview && (
          <line
            x1={closePreview.x1}
            y1={closePreview.y1}
            x2={closePreview.x2}
            y2={closePreview.y2}
            stroke="#60a0d0"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        )}

        {/* 长度标注 */}
        {previewLine && (
          <text
            x={(previewLine.x1 + previewLine.x2) / 2 + 8}
            y={(previewLine.y1 + previewLine.y2) / 2 - 6}
            fontSize={10}
            fill="#f0a040"
          >
            {previewLine.len.toFixed(2)} m
          </text>
        )}
      </svg>

      {/* 控制栏 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <button
          type="button"
          onClick={() => (isDrawing ? stopDrawing() : startDrawing())}
          style={{
            padding: '3px 8px',
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            background: isDrawing ? 'rgba(240,160,64,0.3)' : 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          {isDrawing ? '停止' : '描墙'}
        </button>

        {isDrawing && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'rgba(255,255,255,0.6)' }}>
              <input
                type="checkbox"
                checked={gridSnap}
                onChange={(e) => setGridSnap(e.target.checked)}
              />
              网格
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'rgba(255,255,255,0.6)' }}>
              <input
                type="checkbox"
                checked={orthoSnap}
                onChange={(e) => setOrthoSnap(e.target.checked)}
              />
              正交
            </label>

            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={onSubmit}
              placeholder="房间名"
              style={{
                padding: '2px 4px',
                fontSize: 11,
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 3,
                background: 'rgba(0,0,0,0.3)',
                color: 'rgba(255,255,255,0.8)',
                width: 60,
              }}
            />

            <button
              type="button"
              disabled={pendingVertices.length < 3}
              onClick={onComplete}
              style={{
                padding: '3px 8px',
                cursor: pendingVertices.length < 3 ? 'default' : 'pointer',
                border: '1px solid rgba(96,192,96,0.4)',
                borderRadius: 4,
                background: pendingVertices.length < 3
                  ? 'rgba(255,255,255,0.03)'
                  : 'rgba(96,192,96,0.2)',
                color: pendingVertices.length < 3
                  ? 'rgba(255,255,255,0.3)'
                  : 'rgba(96,192,96,0.9)',
                fontSize: 11,
              }}
            >
              完成房间 ({pendingVertices.length})
            </button>
          </>
        )}
      </div>
    </div>
  );
}
