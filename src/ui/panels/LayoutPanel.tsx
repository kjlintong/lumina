/**
 * 批量布灯面板（P34 · Phase 3 §1）。
 *
 * 4 个预设按钮 + 高级参数。点击后一次性 pushCommand（整批一条 Command），
 * 撤销时整批撤销——严格遵守 ADR-01「不级联」的反向（这里是"不拆分"）。
 *
 * 数据来源：`useProjectStore.getState().project.model`。
 *   - 若为 null 或空：提示「请先描墙或使用模板」，按钮禁用
 *   - 若有 rooms：默认选中第一个房间，用户可切换
 *   - 若为空 rooms 但有 walls：只显示 'perimeter' / 'grid'（用户需手输范围）
 */
import { useMemo, useState } from 'react';
import { useModelingStore } from '../../store/modelingStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';
import {
  rectangularGrid,
  perimeterAlongWalls,
  roomCenter,
  DEFAULT_LAYOUT_OPTIONS,
} from '../../render/layout.js';
import type { FixtureDraft, LayoutMode } from '../../render/layout.js';
import { makeFixture } from '../../core/makeFixture.js';
import type { Fixture } from '../../core/types.js';

export function LayoutPanel() {
  const model = useModelingStore((s) => s.model);
  const ceilingH = useProjectStore((s) => s.project.ceilingH);
  const [roomIdx, setRoomIdx] = useState(0);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [spacing, setSpacing] = useState(3); // perimeter 段数
  const [mode, setMode] = useState<LayoutMode>('grid');

  const hasModel = model !== null && model !== undefined;
  const roomCount = model?.rooms.length ?? 0;
  const wallCount = model?.walls.length ?? 0;

  const disabled = !hasModel || (roomCount === 0 && wallCount === 0);

  /**
   * 根据当前 mode + 参数生成 drafts。
   * 若 model 为空或 mode 无可用几何体，返回 []。
   */
  const buildDrafts = useMemo((): FixtureDraft[] => {
    if (!model) return [];
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, ceilingH, mode };

    switch (mode) {
      case 'grid': {
        // 用全部 walls 的 bounds（简单起见不局限于某个房间）
        const walls = model.walls;
        if (walls.length === 0) return [];
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (const w of walls) {
          x0 = Math.min(x0, w.a[0], w.b[0]);
          x1 = Math.max(x1, w.a[0], w.b[0]);
          z0 = Math.min(z0, w.a[1], w.b[1]);
          z1 = Math.max(z1, w.a[1], w.b[1]);
        }
        return rectangularGrid({ x0, x1, z0, z1 }, cols, rows, opts);
      }
      case 'perimeter':
        return perimeterAlongWalls(model.walls, spacing, opts);
      case 'sconce': {
        const sconceOpts = { ...opts, mode: 'sconce' as const };
        return perimeterAlongWalls(model.walls, spacing, sconceOpts);
      }
      case 'center': {
        if (model.rooms.length === 0) return [];
        const room = model.rooms[Math.min(roomIdx, model.rooms.length - 1)];
        if (!room) return [];
        return roomCenter(room.vertices, opts);
      }
    }
  }, [model, mode, cols, rows, spacing, roomIdx, ceilingH]);

  const apply = () => {
    if (buildDrafts.length === 0) return;
    const fixtures: Fixture[] = buildDrafts.map((d) => {
      const f = makeFixture({
        type: d.suggestedType,
        pos: [...d.pos] as [number, number, number],
      });
      return f;
    });
    useProjectStore.getState().addFixtures(fixtures);
  };

  return (
    <Panel title="批量布灯">
      {disabled && <div className="empty">请先描墙或选模板</div>}
      <div className="field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button
          type="button"
          className="btn"
          disabled={disabled || wallCount === 0}
          onClick={() => setMode('grid')}
          style={mode === 'grid' ? { fontWeight: 600 } : undefined}
        >
          矩形阵列
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || wallCount === 0}
          onClick={() => setMode('perimeter')}
          style={mode === 'perimeter' ? { fontWeight: 600 } : undefined}
        >
          沿墙等距
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || wallCount === 0}
          onClick={() => setMode('sconce')}
          style={mode === 'sconce' ? { fontWeight: 600 } : undefined}
        >
          沿墙壁灯
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || roomCount === 0}
          onClick={() => setMode('center')}
          style={mode === 'center' ? { fontWeight: 600 } : undefined}
        >
          房间居中
        </button>
      </div>
      {(mode === 'grid') && (
        <div className="field" style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <label className="field">
            <span className="field-label">列</span>
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="field">
            <span className="field-label">行</span>
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
      )}
      {(mode === 'perimeter' || mode === 'sconce') && (
        <div className="field" style={{ marginTop: 6 }}>
          <label className="field">
            <span className="field-label">每段墙灯数</span>
            <input
              type="number"
              min={1}
              max={10}
              value={spacing}
              onChange={(e) => setSpacing(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
      )}
      {roomCount > 1 && mode === 'center' && model && (
        <div className="field" style={{ marginTop: 6 }}>
          <label className="field">
            <span className="field-label">房间</span>
            <select value={roomIdx} onChange={(e) => setRoomIdx(Number(e.target.value))}>
              {model.rooms.map((r, i) => (
                <option key={r.id} value={i}>{r.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <button
        type="button"
        className="btn"
        style={{ marginTop: 6, width: '100%' }}
        disabled={disabled || buildDrafts.length === 0}
        onClick={apply}
      >
        应用（{buildDrafts.length} 盏）
      </button>
    </Panel>
  );
}
