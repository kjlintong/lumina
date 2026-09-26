/**
 * 右下角 build 版本号（P8c）：`build <YYYY-MM-DD HH:MM> · <backend>`。
 *
 * 构建时间从 `import.meta.env.VITE_BUILD_TIME`（vite.config.ts `define` 注入的
 * ISO 串）读取；取不到（如未注入）回退到当前时间。格式化数学在纯函数
 * `formatBuildTime` 里，便于 jsdom 单测。
 */

export interface BuildBadgeProps {
  /** 渲染后端标识（webgl2 / webgpu） */
  backend: string;
}

/** ISO 时间串 → `YYYY-MM-DD HH:MM`；解析失败原样返回 */
export function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function BuildBadge({ backend }: BuildBadgeProps) {
  const iso: string =
    (import.meta.env.VITE_BUILD_TIME as string | undefined) ?? new Date().toISOString();
  return (
    <div className="build-badge">
      build {formatBuildTime(iso)} · {backend}
    </div>
  );
}
