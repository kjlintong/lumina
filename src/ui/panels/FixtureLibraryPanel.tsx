/**
 * 灯具库面板（P28）。
 *
 * 列出全部 8 种 FixtureType，每项含：
 *   - 中文标签（与 projectStore.FIXTURE_TYPE_LABELS 一致）
 *   - 简笔 SVG 图标（stroke + fill:currentColor，24×24 viewBox）
 *   - 拖入提示（简短说明安装位置）
 *   - draggable + data-fixture-type + onDragStart 设置 dataTransfer
 *
 * HTML5 DnD：drop 端由 App.tsx 处理（raycast 命中 → mountFromNormal → addFixture）。
 * 本组件只负责「拉数据源」——把类型字符串放进 dataTransfer 的自定义 MIME 类型。
 *
 * 参见 docs/p28-phase1-fixture-drag-spec.md §2.5。
 */

import type { FixtureType } from '../../core/types.js';
import type { ReactElement } from 'react';
import { Panel } from './Panel.js';

/** 8 种灯具的库元数据：type + 中文标签 + 拖入提示 + 简笔图标 */
const LIBRARY: ReadonlyArray<{
  type: FixtureType;
  label: string;
  hint: string;
  icon: ReactElement;
}> = [
  {
    type: 'downlight',
    label: '筒灯',
    hint: '嵌入天花',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="10" r="4" />
        <path d="M6 10 L4 20" />
        <path d="M18 10 L20 20" />
      </svg>
    ),
  },
  {
    type: 'spot',
    label: '射灯',
    hint: '嵌入天花，聚光',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="10" r="3" />
        <path d="M9 10 L6 20 L18 20 L15 10" />
      </svg>
    ),
  },
  {
    type: 'pendant',
    label: '吊灯',
    hint: '悬挂天花板',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="2" x2="12" y2="10" />
        <circle cx="12" cy="14" r="4" />
      </svg>
    ),
  },
  {
    type: 'linear',
    label: '线条灯',
    hint: '线性连续',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="4" y1="12" x2="20" y2="12" strokeWidth="3" />
      </svg>
    ),
  },
  {
    type: 'cove',
    label: '灯带',
    hint: '暗藏灯槽',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 8 L20 8 L18 20 L6 20 Z" fill="currentColor" opacity="0.3" />
        <line x1="4" y1="8" x2="20" y2="8" />
      </svg>
    ),
  },
  {
    type: 'sconce',
    label: '壁灯',
    hint: '贴墙',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="4" y1="12" x2="10" y2="12" />
        <circle cx="14" cy="12" r="4" />
      </svg>
    ),
  },
  {
    type: 'floor',
    label: '落地灯',
    hint: '独立地面',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="4" x2="12" y2="20" />
        <circle cx="12" cy="6" r="3" />
        <line x1="8" y1="20" x2="16" y2="20" />
      </svg>
    ),
  },
  {
    type: 'table',
    label: '台灯',
    hint: '桌面',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="6" x2="12" y2="14" />
        <circle cx="12" cy="8" r="3" />
        <line x1="4" y1="16" x2="20" y2="16" />
      </svg>
    ),
  },
];

/**
 * DnD 自定义 MIME 类型：drop 端用 getData 读取。
 * 用 'application/x-lumina-*' 命名空间，避免与浏览器/第三方 MIME 冲突。
 */
export const LUMINA_FIXTURE_DND_MIME = 'application/x-lumina-fixture-type';

export function FixtureLibraryPanel() {
  return (
    <Panel title="灯具库" defaultOpen={true}>
      <div className="field-note">
        把灯具拖到场景中；按命中面自动决定安装方式，50mm 网格吸附。
      </div>
      <div className="fixture-library-grid">
        {LIBRARY.map(({ type, label, hint, icon }) => (
          <div
            key={type}
            className="fixture-library-item"
            draggable={true}
            data-fixture-type={type}
            onDragStart={(e) => {
              e.dataTransfer.setData(LUMINA_FIXTURE_DND_MIME, type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <div className="fixture-library-icon">{icon}</div>
            <div className="fixture-library-label">
              {label}
              <div className="fixture-library-hint">{hint}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
