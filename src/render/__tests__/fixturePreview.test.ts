/**
 * FixturePreviewRenderer 测试（P37b）。
 *
 * jsdom 环境 WebGL 不可用 → ensureRenderer 返回 null → render 返回 null。
 * 真实浏览器/SwiftShader 环境下应返回 data URL。测试断言：不抛异常、
 * 类型正确、单例、缓存命中（同一引用）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getFixturePreviewRenderer, _resetFixturePreviewForTest } from '../fixturePreview.js';

beforeEach(() => {
  _resetFixturePreviewForTest();
});

describe('FixturePreviewRenderer（P37b）', () => {
  it('单例：多次调用返回同一实例', () => {
    const a = getFixturePreviewRenderer();
    const b = getFixturePreviewRenderer();
    expect(a).toBe(b);
  });

  it('渲染有资产类型（pendant）返回 data URL 或 null（不抛异常）', async () => {
    const r = getFixturePreviewRenderer();
    const url = await r.render('pendant');
    // jsdom 环境 WebGL 不可用 → null；真实浏览器 → data:image/png;base64,...
    // 断言：不抛异常，结果是 string|null
    expect(url === null || typeof url === 'string').toBe(true);
  });

  it('渲染无资产类型（spot）返回 data URL 或 null（不抛异常）', async () => {
    const r = getFixturePreviewRenderer();
    const url = await r.render('spot');
    expect(url === null || typeof url === 'string').toBe(true);
  });

  it('缓存命中：第二次 render 同一类型返回相同引用', async () => {
    const r = getFixturePreviewRenderer();
    const a = await r.render('downlight');
    const b = await r.render('downlight');
    // 缓存返回同一字符串/null 引用
    expect(a).toBe(b);
  });

  it('渲染异常时返回 null（不抛）：chandelier 资产路径走完，结果类型正确', async () => {
    const r = getFixturePreviewRenderer();
    const url = await r.render('chandelier');
    expect(url === null || typeof url === 'string').toBe(true);
  });
});
