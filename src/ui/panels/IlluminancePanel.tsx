/**
 * 照度面板：每个活动区一行相对照度估算。
 *
 * 数据从 store 的 project 现算：calculateAllZones(project.zones, project.fixtures)。
 *
 * 红线（§6.3 / ADR-15）：所有 lx 展示必须经 formatIlluminance —— 它统一在
 * 行尾追加「相对估算，非实测照度」。这里**不自己拼 lx 字符串**。
 */

import { useMemo } from 'react';
import { calculateAllZones, formatIlluminance } from '../../lighting/illuminance.js';
import { useProjectStore } from '../../store/projectStore.js';
import { Panel } from './Panel.js';

export function IlluminancePanel() {
  const zones = useProjectStore((s) => s.project.zones);
  const fixtures = useProjectStore((s) => s.project.fixtures);

  const results = useMemo(() => calculateAllZones(zones, fixtures), [zones, fixtures]);

  const entries = Object.entries(zones);

  return (
    <Panel title="照度估算">
      {entries.length === 0 && <div className="empty">暂无活动区</div>}
      <ul className="item-list">
        {entries.map(([key, zone]) => {
          const result = results[key];
          return (
            <li key={key} className="illuminance-row">
              <div className="illuminance-name">{zone.name}</div>
              <div className="illuminance-value">
                {result ? formatIlluminance(result) : '—'}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
