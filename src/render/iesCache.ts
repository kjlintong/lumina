/**
 * IES 配光缓存（P6）
 *
 * 运行时异步加载并解析 public/ies/ 目录下的 IES 文件。
 *
 * 用法：
 * 1. App 启动时调用 `preloadIESFiles(paths)` 预加载所有 IES 文件。
 * 2. `buildLightFromFixture` 调用 `getIESForFixture(fixture)` 获取 IES 数据。
 * 3. 数据就绪后，SpotLight 会附加真实配光纹理。
 *
 * 设计考虑：
 * - public/ 目录文件由 Vite 静态服务，运行时通过 fetch 加载。
 * - 缓存按 IES 文件路径索引，同一文件只加载一次。
 * - 未就绪时返回 pending 状态，lightBuilder 回退到参数化路径。
 *
 * 架构依据：工程方案 §5.2（配光双轨）、ADR-18
 */

import type { Fixture } from '../core/types.js';
import type { IESData } from './iesParser.js';
import { parseIES } from './iesParser.js';

/** IES 文件状态 */
export type IESStatus = 'pending' | 'ready' | 'missing' | 'invalid';

/** IES 缓存结果 */
export interface IESResult {
  status: IESStatus;
  data?: IESData;
  error?: string;
}

/** 内部缓存：IES 文件路径 -> 解析结果 */
const cache = new Map<string, IESResult>();

/** IES 文本加载函数（用于测试或非浏览器环境） */
let textLoader: ((path: string) => Promise<string>) | null = null;

/**
 * 从 Fixture 的 photometric.ies 获取文件路径。
 */
export function iesPathOf(fixture: Fixture): string | null {
  return fixture.photometric.ies ?? null;
}

/**
 * 注入 IES 文本加载函数（用于测试或非浏览器环境）。
 *
 * @param fn 文本加载函数（路径 -> Promise<text>）
 */
export function setIESTextLoader(fn: (path: string) => Promise<string>): void {
  textLoader = fn;
}

/**
 * 异步加载并解析单个 IES 文件。
 * 浏览器环境通过 fetch，测试环境通过注入的 textLoader。
 */
export async function loadIESFile(path: string, signal?: AbortSignal): Promise<void> {
  if (cache.has(path)) return;

  if (textLoader) {
    // 使用注入的加载函数
    try {
      const text = await textLoader(path);
      const data = parseIES(text);
      if (data) {
        cache.set(path, { status: 'ready', data });
      } else {
        cache.set(path, { status: 'invalid', error: 'IES parsing failed' });
      }
    } catch (err) {
      if (signal?.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      cache.set(path, { status: 'invalid', error: msg });
    }
    return;
  }

  // 浏览器环境：直接 fetch
  if (typeof fetch !== 'function') return;
  try {
    const fetchOpts = signal ? { signal } : undefined;
    const res = await fetch(path, fetchOpts);
    if (!res.ok) {
      cache.set(path, { status: 'invalid', error: `HTTP ${res.status}` });
      return;
    }
    const text = await res.text();
    const data = parseIES(text);
    if (data) {
      cache.set(path, { status: 'ready', data });
    } else {
      cache.set(path, { status: 'invalid', error: 'IES parsing failed' });
    }
  } catch (err) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    cache.set(path, { status: 'invalid', error: msg });
  }
}

/**
 * 预加载指定路径列表的 IES 文件。
 *
 * @param paths IES 文件路径列表
 * @param signal AbortSignal（用于取消加载）
 */
export async function preloadIESFiles(paths: string[], signal?: AbortSignal): Promise<void> {
  for (const path of paths) {
    if (signal?.aborted) return;
    await loadIESFile(path, signal);
  }
}

/**
 * 从 Fixture 获取 IES 数据。
 *
 * @param fixture 灯具
 * @returns IES 结果（ready 时含 data）
 */
export function getIESForFixture(fixture: Fixture): IESResult {
  const path = iesPathOf(fixture);
  if (!path) return { status: 'missing' };

  const cached = cache.get(path);
  if (cached) return cached;

  return { status: 'pending' };
}

/**
 * 获取当前已缓存的 IES 文件路径列表。
 */
export function getCachePaths(): string[] {
  return Array.from(cache.keys());
}

/**
 * 清除缓存（用于测试）。
 */
export function clearIESCache(): void {
  cache.clear();
  textLoader = null;
}
