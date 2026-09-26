/**
 * HUD 数字统计（P8c）：左上角三行 —— 三角面 / 部件 / 帧率。
 *
 * 数字必须真实，全部来自 `SceneEngine.getRenderStats()`，由 App 以 500ms
 * 轮询注入。本组件只做格式化与展示；千分位压缩等数学在纯函数
 * `formatCount` 里，jsdom 下可直接单测（不碰 canvas）。
 */

export interface HudStats {
  /** 三角面数；WebGPU 路径无此数据，传 null 显示 `—` */
  triangles: number | null;
  /** 可渲染对象数（Mesh/Points/Line） */
  objects: number;
  /** 帧率（滑动平均） */
  fps: number;
}

export interface HudStatsProps {
  /** null = 引擎尚未就绪，全部显示占位 `—` */
  stats: HudStats | null;
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

export function HudStats({ stats }: HudStatsProps) {
  const triangles = stats && stats.triangles !== null ? formatCount(stats.triangles) : '—';
  const objects = stats ? formatCount(stats.objects) : '—';
  const fps = stats ? formatFps(stats.fps) : '—';

  return (
    <div className="hud-stats">
      <div className="hud-row">
        <span className="hud-label">三角面</span>
        <span className="hud-value">{triangles}</span>
      </div>
      <div className="hud-row">
        <span className="hud-label">部件</span>
        <span className="hud-value">{objects}</span>
      </div>
      <div className="hud-row">
        <span className="hud-label">帧/秒</span>
        <span className="hud-value">{fps}</span>
      </div>
    </div>
  );
}
