/**
 * 活动区面板（需求侧，ADR-08）。
 *
 * 列表展示每个活动区的名称 / 类型 / 工作面高度 / 目标照度；
 * 支持新增（类型下拉，数据来自 ZONE_TYPE_TEMPLATES）、重命名、删除与点选。
 * 删除走 store.removeZone —— 不级联删灯，绑定灯自动解绑但保留原位（ADR-01）。
 */

import { useState } from 'react';
import type { ActivityZoneType } from '../../core/types.js';
import { ZONE_TYPE_TEMPLATES } from '../../core/zoneTypes.js';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';

const ZONE_TYPE_OPTIONS = Object.values(ZONE_TYPE_TEMPLATES);

function typeLabel(type: ActivityZoneType): string {
  return ZONE_TYPE_TEMPLATES[type]?.label ?? type;
}

export function ZonePanel() {
  const zones = useProjectStore((s) => s.project.zones);
  const selectedZoneKey = useProjectStore((s) => s.selectedZoneKey);
  const addZone = useProjectStore((s) => s.addZone);
  const removeZone = useProjectStore((s) => s.removeZone);
  const renameZone = useProjectStore((s) => s.renameZone);
  const selectZone = useProjectStore((s) => s.selectZone);

  const [newType, setNewType] = useState<ActivityZoneType>(ZONE_TYPE_OPTIONS[0]?.key ?? 'lounge');

  const zoneList = Object.values(zones);

  return (
    <Panel title={`活动区 (${zoneList.length})`}>
      <div className="panel-row">
        <select
          className="input"
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          aria-label="新增活动区类型"
        >
          {ZONE_TYPE_OPTIONS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => addZone(newType, [0, 0])}
        >
          新增
        </button>
      </div>

      {zoneList.length === 0 && <div className="empty">暂无活动区</div>}

      <ul className="item-list">
        {zoneList.map((z) => (
          <li
            key={z.key}
            className={`item${z.key === selectedZoneKey ? ' selected' : ''}`}
            onClick={() => selectZone(z.key)}
          >
            <div className="item-head">
              <input
                className="input item-name"
                value={z.name}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => renameZone(z.key, e.target.value)}
                aria-label="活动区名称"
              />
              <button
                type="button"
                className="btn btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeZone(z.key);
                }}
                aria-label={`删除 ${z.name}`}
              >
                删
              </button>
            </div>
            <div className="item-meta">
              {typeLabel(z.type)} · 工作面 {z.planeH.toFixed(2)}m · 目标 {z.lux} lx
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
