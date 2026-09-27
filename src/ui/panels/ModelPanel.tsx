import { useMemo } from 'react';
import { useModelingStore } from '../../store/modelingStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { checkTopology, roomArea } from '../../core/topology.js';

/**
 * 建模控制面板（P22 §3.4）。
 *
 * 包含：
 * 1. 模板选择按钮（8 个户型模板 + 空画布）
 * 2. 拓扑校验报告（通过/违规，带 elementId 定位 — 红线 2）
 * 3. undo / redo 按钮
 *
 * 坐标系与显示详见 ModelPlan.tsx。
 */
export function ModelPanel() {
  const {
    model,
    selectedTemplateId,
    applyTemplate,
    clearModel,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useModelingStore();

  // 拓扑校验报告
  const report = useMemo(() => checkTopology(model), [model]);

  // 总面积
  const totalArea = useMemo(() => {
    let sum = 0;
    for (const r of model.rooms) {
      sum += roomArea(r);
    }
    return sum;
  }, [model]);

  return (
    <div className="model-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
        户型建模
      </h3>

      {/* 模板选择 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {HOUSE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`model-template-btn${selectedTemplateId === t.id ? ' active' : ''}`}
            onClick={() => applyTemplate(t.id)}
            style={{
              padding: '4px 6px',
              fontSize: 11,
              cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4,
              background: selectedTemplateId === t.id
                ? 'rgba(240,192,64,0.2)'
                : 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.8)',
              textAlign: 'left',
            }}
          >
            {t.name}
          </button>
        ))}
        <button
          type="button"
          className="model-template-btn"
          onClick={() => clearModel()}
          style={{
            padding: '4px 6px',
            fontSize: 11,
            cursor: 'pointer',
            border: '1px solid rgba(255,80,80,0.3)',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.8)',
            textAlign: 'left',
          }}
        >
          空画布
        </button>
      </div>

      {/* 拓扑报告 */}
      <div style={{ padding: '6px 8px', borderRadius: 4, fontSize: 11 }}>
        {report.passed ? (
          <div style={{ color: '#60c060' }}>
            <strong>✓ 拓扑通过</strong>
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 6 }}>
              {model.rooms.length} 房间 · {totalArea.toFixed(1)} ㎡
            </span>
          </div>
        ) : (
          <div style={{ color: '#e06060' }}>
            <strong>✗ 拓扑违规 {report.violations.length} 条</strong>
            {report.violations.slice(0, 5).map((v, i) => (
              <div key={i} style={{ margin: '2px 0 0', paddingLeft: 8 }}>
                <span style={{ color: '#e0a040' }}>[{v.rule}]</span>{' '}
                {v.message}
                {v.elementIds && v.elementIds.length > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {' '}({v.elementIds.join(', ')})
                  </span>
                )}
              </div>
            ))}
            {report.violations.length > 5 && (
              <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                …还有 {report.violations.length - 5} 条
              </div>
            )}
          </div>
        )}
      </div>

      {/* undo / redo */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          disabled={canUndo() === false}
          onClick={() => undo()}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            cursor: canUndo() === false ? 'default' : 'pointer',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            background: canUndo() === false
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.08)',
            color: canUndo() === false
              ? 'rgba(255,255,255,0.3)'
              : 'rgba(255,255,255,0.8)',
          }}
        >
          ← 撤销
        </button>
        <button
          type="button"
          disabled={canRedo() === false}
          onClick={() => redo()}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            cursor: canRedo() === false ? 'default' : 'pointer',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            background: canRedo() === false
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.08)',
            color: canRedo() === false
              ? 'rgba(255,255,255,0.3)'
              : 'rgba(255,255,255,0.8)',
          }}
        >
          重做 →
        </button>
      </div>
    </div>
  );
}
