/**
 * 线段合并（P25 §1.2）。
 *
 * 近似共线的线段合并成一条。
 * 纯 TypeScript，无 DOM 依赖。
 */

import type { HoughLine } from './imagePreprocess.js';

export interface MergedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;
  votes: number;
}

export interface MergeOptions {
  /** 最大角度差（度），默认 5 */
  maxAngleDiff?: number;
  /** 最大端点距离（像素），默认 10 */
  maxEndpointDist?: number;
  /** 最大间隙（像素），默认 5 */
  maxGap?: number;
}

/**
 * 合并近似共线的线段。
 *
 * 算法：
 * 1. 按角度分组（角度差 < maxAngleDiff）
 * 2. 同角度组内，按投影到主轴的位置排序
 * 3. 相邻线段如果间隙 < maxGap，合并成一条
 * 4. 合并后线段取端点中点为端点，votes 累加
 *
 * @param lines 霍夫变换检测到的线段
 * @param options 合并参数
 */
export function mergeLines(
  lines: HoughLine[],
  options: MergeOptions = {},
): MergedLine[] {
  const {
    maxAngleDiff = 5,
    maxEndpointDist = 10,
    maxGap = 5,
  } = options;

  if (lines.length === 0) return [];

  // 1. 按角度分组
  const groups: HoughLine[][] = [];
  for (const line of lines) {
    let placed = false;
    for (const group of groups) {
      const refAngle = group[0]!.angle;
      const diff = Math.abs(angleDiff(line.angle, refAngle));
      if (diff <= maxAngleDiff) {
        group.push(line);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([line]);
    }
  }

  // 2. 每组内合并
  const result: MergedLine[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      result.push(toMerged(group[0]!));
      continue;
    }

    // 按主轴投影排序
    const avgAngle = group.reduce((s, l) => s + l.angle, 0) / group.length;
    const cosA = Math.cos((avgAngle * Math.PI) / 180);
    const sinA = Math.sin((avgAngle * Math.PI) / 180);

    // 计算每条线段在主轴上的投影区间
    const sorted = group.map((l) => {
      const p1 = projectToAxis(l.x1, l.y1, cosA, sinA);
      const p2 = projectToAxis(l.x2, l.y2, cosA, sinA);
      return { line: l, min: Math.min(p1, p2), max: Math.max(p1, p2) };
    }).sort((a, b) => a.min - b.min);

    // 合并相邻线段
    let current: { line: HoughLine; min: number; max: number } = sorted[0]!;

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]!;
      const gap = next.min - current.max;

      if (gap < maxGap && gap > -maxEndpointDist) {
        // 合并：扩展区间
        current.max = Math.max(current.max, next.max);
        current.line = {
          ...current.line,
          votes: current.line.votes + next.line.votes,
        };
      } else {
        // 输出当前合并结果
        result.push(buildMerged(current, avgAngle));
        current = { ...next };
      }
    }
    result.push(buildMerged(current, avgAngle));
  }

  return result;
}

/** 角度差（考虑 0-180 循环） */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 90 ? 180 - d : d;
}

/** 投影到主轴（cosA, sinA 为单位向量） */
function projectToAxis(x: number, y: number, cosA: number, sinA: number): number {
  return x * cosA + y * sinA;
}

/** 转 MergedLine */
function toMerged(l: HoughLine): MergedLine {
  return {
    x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
    length: l.length, angle: l.angle, votes: l.votes,
  };
}

/** 从合并区间构造 MergedLine */
function buildMerged(
  current: { line: HoughLine; min: number; max: number },
  avgAngle: number,
): MergedLine {
  const cosA = Math.cos((avgAngle * Math.PI) / 180);
  const sinA = Math.sin((avgAngle * Math.PI) / 180);

  // 端点：min 和 max 投影回空间坐标
  // 主轴上的 min/max 对应空间坐标 (min*cosA, min*sinA) 和 (max*cosA, max*sinA)
  const x1 = current.min * cosA;
  const y1 = current.min * sinA;
  const x2 = current.max * cosA;
  const y2 = current.max * sinA;
  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  return {
    x1, y1, x2, y2,
    length,
    angle: avgAngle,
    votes: current.line.votes,
  };
}
