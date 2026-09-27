/**
 * 轮廓提取（P25 §1.3）。
 *
 * 从合并后的线段中提取闭合多边形轮廓。
 * 贪心连接法，best-effort：失败不影响墙体提取。
 * 纯 TypeScript，无 DOM 依赖。
 */

import type { MergedLine } from './lineMerging.js';

export interface Contour {
  points: [number, number][];
  area: number;
  isClosed: boolean;
}

export interface ContourOptions {
  maxEndpointDist?: number;
  minArea?: number;
  maxDepth?: number;
}

/**
 * 从线段中提取闭合多边形（贪心法，best-effort）。
 *
 * 对每条线段，从两端尝试延伸。延伸时找距离 < maxEndpointDist
 * 的未使用线段，如果回到起点则形成闭合路径。
 *
 * 注意：这是启发式算法，不保证找到所有轮廓，
 * 也不保证找到的轮廓正确。墙体提取不依赖轮廓，
 * 轮廓只是用于构造 RoomPolygon（加分项）。
 */
export function extractContours(
  lines: MergedLine[],
  options: ContourOptions = {},
): Contour[] {
  const {
    maxEndpointDist = 10,
    minArea = 500,
    maxDepth = 30,
  } = options;

  if (lines.length < 3) return [];

  const used = new Uint8Array(lines.length);
  const contours: Contour[] = [];

  const e1 = lines.map((l) => [l.x1, l.y1] as [number, number]);
  const e2 = lines.map((l) => [l.x2, l.y2] as [number, number]);

  function dist(a: [number, number], b: [number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function findNext(
    p: [number, number],
    excludeLine: number,
  ): { lineIdx: number; otherEnd: [number, number] } | null {
    let best: { lineIdx: number; otherEnd: [number, number]; d: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (used[i] || i === excludeLine) continue;
      const a = e1[i]!;
      const b = e2[i]!;
      const d1 = dist(p, a);
      const d2 = dist(p, b);
      if (d1 < maxEndpointDist && (!best || d1 < best.d)) {
        best = { lineIdx: i, otherEnd: b, d: d1 };
      }
      if (d2 < maxEndpointDist && (!best || d2 < best.d)) {
        best = { lineIdx: i, otherEnd: a, d: d2 };
      }
    }
    return best;
  }

  for (let startIdx = 0; startIdx < lines.length; startIdx++) {
    if (used[startIdx]) continue;

    for (let dir = 0; dir < 2; dir++) {
      if (used[startIdx]) continue;

      // 路径起点是 startIdx 的一个端点，从另一端开始延伸
      const startPt = dir === 0 ? e1[startIdx]! : e2[startIdx]!;
      const extendFrom = dir === 0 ? e2[startIdx]! : e1[startIdx]!;
      // 路径包含起点和起点线段的另一端（记录第一段）
      const path: [number, number][] = [startPt, extendFrom];
      const usedLines: number[] = [startIdx];
      used[startIdx] = 1;

      let current = extendFrom;
      let prevLine = startIdx;
      let closed = false;

      for (let depth = 0; depth < maxDepth; depth++) {
        const next = findNext(current, prevLine);
        if (next === null) break;

        if (dist(next.otherEnd, startPt) < maxEndpointDist && path.length >= 3) {
          usedLines.push(next.lineIdx);
          used[next.lineIdx] = 1;
          path.push(next.otherEnd);
          closed = true;
          break;
        }

        usedLines.push(next.lineIdx);
        used[next.lineIdx] = 1;
        path.push(next.otherEnd);
        current = next.otherEnd;
        prevLine = next.lineIdx;
      }

      if (closed) {
        const area = Math.abs(shoelaceArea(path));
        if (area >= minArea) {
          contours.push({ points: path, area, isClosed: true });
        }
      }

      // 回滚未闭合路径
      if (!closed) {
        for (const li of usedLines) {
          used[li] = 0;
        }
      }
    }
  }

  return contours;
}

/** Shoelace 公式计算多边形面积 */
export function shoelaceArea(points: [number, number][]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i]![0] * points[j]![1];
    area -= points[j]![0] * points[i]![1];
  }
  return area / 2;
}
