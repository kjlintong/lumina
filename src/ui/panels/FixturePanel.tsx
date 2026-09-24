/**
 * 灯具参数面板（供给侧，ADR-08）。
 *
 * 选中一盏灯后编辑：位置 xyz / 姿态 pitch·yaw / 亮度 / 色温 K / 光通量 / 光束角。
 * 每个输入 onChange 都调 store.updateFixture —— 手动改 = 锁定（ADR-17），
 * 被改字段路径自动写入 lockedFields，此后场景预设不再覆盖该字段。
 *
 * 红线：无真实 IES 解析时显示「配光为近似值」徽标（hasVerifiedIES 判定）。
 *
 * 亮度读/写 `control.sceneLevels[activeSceneKey ?? MANUAL_LEVEL_KEY]`：
 * 有活跃场景时改的是该场景的亮度；无活跃场景时写入 manual 键（不被场景覆盖）。
 */

import type { CCTValue, Fixture, Photometric } from '../../core/types.js';
import { hasVerifiedIES } from '../../core/types.js';
import { MANUAL_LEVEL_KEY, useProjectStore } from '../../store/projectStore.js';
import { NumberField } from './NumberField.js';
import { Panel } from './Panel.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** 色温显示值：固定值直接用，可调区间取中点 */
function cctNumber(cct: CCTValue): number {
  return typeof cct === 'number' ? cct : (cct[0] + cct[1]) / 2;
}

/** 参数化配光读数；IES 配光无 lumens/beamAngle，返回 undefined */
function parametric(p: Photometric): { lumens?: number; beamAngle?: number } {
  return 'lumens' in p ? { lumens: p.lumens, beamAngle: p.beamAngle } : {};
}

function FixtureForm({ fixture }: { fixture: Fixture }) {
  const updateFixture = useProjectStore((s) => s.updateFixture);
  const activeSceneKey = useProjectStore((s) => s.activeSceneKey);

  const id = fixture.id;
  const [px, py, pz] = fixture.pos;
  const { lumens, beamAngle } = parametric(fixture.photometric);
  const verified = hasVerifiedIES(fixture.photometric);

  const levelKey = activeSceneKey ?? MANUAL_LEVEL_KEY;
  const level = fixture.control.sceneLevels[levelKey] ?? 1;

  return (
    <div className="fixture-form">
      <div className="fixture-head">
        <span className="fixture-type">{fixture.type}</span>
        <span className="fixture-id">{id}</span>
        {!verified && <span className="badge badge-warn">配光为近似值</span>}
      </div>

      <div className="field-group">
        <div className="field-group-title">位置 (m)</div>
        <div className="field-row">
          <NumberField label="X" value={px} step={0.1} onCommit={(v) => updateFixture(id, { pos: [v, py, pz] })} />
          <NumberField label="Y" value={py} step={0.1} onCommit={(v) => updateFixture(id, { pos: [px, v, pz] })} />
          <NumberField label="Z" value={pz} step={0.1} onCommit={(v) => updateFixture(id, { pos: [px, py, v] })} />
        </div>
      </div>

      <div className="field-group">
        <div className="field-group-title">姿态 (°)</div>
        <div className="field-row">
          <NumberField
            label="俯仰"
            value={fixture.rot.pitch * RAD2DEG}
            step={1}
            digits={0}
            onCommit={(v) => updateFixture(id, { rot: { pitch: v * DEG2RAD, yaw: fixture.rot.yaw } })}
          />
          <NumberField
            label="方位"
            value={fixture.rot.yaw * RAD2DEG}
            step={1}
            digits={0}
            onCommit={(v) => updateFixture(id, { rot: { pitch: fixture.rot.pitch, yaw: v * DEG2RAD } })}
          />
        </div>
      </div>

      <div className="field-group">
        <div className="field-group-title">光学</div>
        <label className="field">
          <span className="field-label">亮度 {Math.round(level * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={level}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) {
                updateFixture(id, { control: { sceneLevels: { ...fixture.control.sceneLevels, [levelKey]: v } } });
              }
            }}
          />
        </label>
        <div className="field-row">
          <NumberField
            label="色温 K"
            value={cctNumber(fixture.electrical.cct)}
            step={100}
            digits={0}
            onCommit={(v) => updateFixture(id, { electrical: { cct: v } })}
          />
          <NumberField
            label="光通量 lm"
            value={lumens ?? 0}
            step={50}
            digits={0}
            disabled={lumens === undefined}
            onCommit={(v) => updateFixture(id, { photometric: { lumens: v } })}
          />
          <NumberField
            label="光束角 °"
            value={beamAngle ?? 0}
            step={1}
            digits={0}
            disabled={beamAngle === undefined}
            onCommit={(v) => updateFixture(id, { photometric: { beamAngle: v } })}
          />
        </div>
      </div>
    </div>
  );
}

export function FixturePanel() {
  const fixture = useProjectStore((s) =>
    s.selectedFixtureId ? s.project.fixtures[s.selectedFixtureId] : undefined,
  );

  return (
    <Panel title="灯具参数">
      {fixture ? (
        <FixtureForm fixture={fixture} />
      ) : (
        <div className="empty">未选中灯具。点击场景中的灯，或在活动区面板旁选择。</div>
      )}
    </Panel>
  );
}
