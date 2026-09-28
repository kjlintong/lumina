/**
 * HUD 数字统计（P8c → P10 精简；P34 追加光源预算提示）。
 *
 * P10 起默认只显示 **FPS 一行**（用户真正关心的实时指标）；三角面 / 部件
 * 这两项属于渲染工程师术语，移入可展开子块 —— 点击小 ⓘ（caret）展开后
 * 会看到三行完整数据（帧/秒、三角面、部件），样式与 P8c 一致。
 *
 * P34 起，若光源总数 > MAX_REAL_LIGHTS，顶部会追加一行提示
 * 「光源 X/Y 实时，其余为投影」，让用户知道为何远处筒灯看不见光晕。
 *
 * 数字必须真实，全部来自 `SceneEngine.getRenderStats()`，由 App 以 500ms
 * 轮询注入。本组件只做格式化与展示；千分位压缩等数学在纯函数
 * `formatCount` 里，jsdom 下可直接单测（不碰 canvas）。
 */
import { useState } from 'react';

export interface HudStats {
  /** 三角面数；mock 后端无此数据，传 null 显示 `—` */
  triangles: number | null;
  /** 可渲染对象数（Mesh/Points/Line） */
  objects: number;
  /** 帧率（滑动平均） */
  fps: number;
}

export interface LightBudgetSummary {
  /** 当前真光源数 */
  realCount: number;
  /** 灯具总数 */
  total: number;
  /** user-locked 保留为真光源的盏数 */
  lockedDropped: number;
}

export interface HudStatsProps {
  /** null = 引擎尚未就绪，全部显示占位 `—` */
  stats: HudStats | null;
  /** P34：光源预算摘要（null = 尚未有灯具或预算未截断） */
  budget?: LightBudgetSummary | null;
}

/**
 * 大数压缩：`>9999` 用 K 后缀（12.4K），否则四舍五入取整。
 * 非法值（非有限 / 负数）显示占位 `—`。
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n > 9999) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** 帧率取整；非法值显示 `—` */
export function formatFps(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  return String(Math.round(n));
}

export function HudStats({ stats, budget }: HudStatsProps) {
  const [expanded, setExpanded] = useState(false);
  const triangles = stats && stats.triangles !== null ? formatCount(stats.triangles) : '—';
  const objects = stats ? formatCount(stats.objects) : '—';
  const fps = stats ? formatFps(stats.fps) : '—';

  const budgetTruncated = budget !== null && budget !== undefined
    && budget.total > budget.realCount;

  return (
    <div className="hud-stats">
      {budgetTruncated && (
        <div
          style={{
            color: 'rgba(255,200,120,0.75)',
            fontSize: 11,
            marginBottom: 4,
          }}
        >
          光源 {budget.realCount}/{budget.total} 实时，其余为投影
          {budget.lockedDropped > 0 ? `；${budget.lockedDropped} 盏锁定灯已保留` : ''}
        </div>
      )}
      <button
        type="button"
        className="hud-toggle"
        aria-expanded={expanded}
        title={expanded ? '折叠渲染统计' : '展开渲染统计'}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="hud-label">帧/秒</span>
        <span className="hud-value">{fps}</span>
        <span className="hud-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="hud-details">
          <div className="hud-row">
            <span className="hud-label">三角面</span>
            <span className="hud-value">{triangles}</span>
          </div>
          <div className="hud-row">
            <span className="hud-label">部件</span>
            <span className="hud-value">{objects}</span>
          </div>
        </div>
      )}
    </div>
  );
}
