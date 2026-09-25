import { describe, expect, it, beforeEach } from 'vitest';

import { clearIESCache, setIESTextLoader, getIESForFixture, preloadIESFiles, loadIESFile, iesPathOf, getCachePaths } from '../iesCache.js';
import { makeFixture } from '../../core/makeFixture.js';

// 合法 IES 文本
const VALID_IES = `IESNA:LM-63-2002
TILT=NONE
1     1000    1.0     3      1      0      0      0.1    0.1    0.1
1.00    1.00    10.0
0      90    180
0
1000  500     0`;

// 无效 IES 文本
const INVALID_IES = `TILT=NONE
`;

describe('iesCache — IES 配光缓存', () => {
  beforeEach(() => {
    clearIESCache();
  });

  it('无 IES 声明的 fixture 返回 missing', () => {
    const f = makeFixture({ type: 'downlight' });
    expect(getIESForFixture(f).status).toBe('missing');
  });

  it('有 IES 声明但未加载时返回 pending', () => {
    const f = makeFixture({ type: 'downlight', ies: 'ies/test.ies' });
    expect(getIESForFixture(f).status).toBe('pending');
  });

  it('加载成功后返回 ready 含 data', async () => {
    setIESTextLoader(() => Promise.resolve(VALID_IES));
    await loadIESFile('ies/test.ies');
    const f = makeFixture({ type: 'downlight', ies: 'ies/test.ies' });
    const result = getIESForFixture(f);
    expect(result.status).toBe('ready');
    expect(result.data).toBeDefined();
    expect(result.data!.lumens).toBe(1000);
  });

  it('加载失败时返回 invalid 含 error', async () => {
    setIESTextLoader(() => Promise.resolve(INVALID_IES));
    await loadIESFile('ies/bad.ies');
    const f = makeFixture({ type: 'downlight', ies: 'ies/bad.ies' });
    const result = getIESForFixture(f);
    expect(result.status).toBe('invalid');
    expect(result.error).toBeDefined();
  });

  it('加载器抛错时返回 invalid', async () => {
    setIESTextLoader(() => Promise.reject(new Error('network error')));
    await loadIESFile('ies/fail.ies');
    const f = makeFixture({ type: 'downlight', ies: 'ies/fail.ies' });
    const result = getIESForFixture(f);
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('network');
  });

  it('同一文件只加载一次（缓存命中）', async () => {
    let loadCount = 0;
    setIESTextLoader(() => {
      loadCount++;
      return Promise.resolve(VALID_IES);
    });
    await loadIESFile('ies/same.ies');
    await loadIESFile('ies/same.ies');
    expect(loadCount).toBe(1);
  });

  it('预加载多个文件', async () => {
    setIESTextLoader((path) => {
      if (path === 'ies/a.ies') return Promise.resolve(VALID_IES);
      if (path === 'ies/b.ies') return Promise.resolve(INVALID_IES);
      return Promise.reject(new Error('unknown'));
    });
    await preloadIESFiles(['ies/a.ies', 'ies/b.ies']);
    expect(getIESForFixture(makeFixture({ type: 'downlight', ies: 'ies/a.ies' })).status).toBe('ready');
    expect(getIESForFixture(makeFixture({ type: 'downlight', ies: 'ies/b.ies' })).status).toBe('invalid');
  });

  it('iesPathOf 返回 IES 路径', () => {
    const f1 = makeFixture({ type: 'downlight', ies: 'ies/foo.ies' });
    const f2 = makeFixture({ type: 'downlight' });
    expect(iesPathOf(f1)).toBe('ies/foo.ies');
    expect(iesPathOf(f2)).toBeNull();
  });

  it('getCachePaths 返回已缓存的路径', async () => {
    setIESTextLoader(() => Promise.resolve(VALID_IES));
    await loadIESFile('ies/x.ies');
    await loadIESFile('ies/y.ies');
    expect(getCachePaths()).toContain('ies/x.ies');
    expect(getCachePaths()).toContain('ies/y.ies');
  });

  it('clearIESCache 清空缓存', async () => {
    setIESTextLoader(() => Promise.resolve(VALID_IES));
    await loadIESFile('ies/x.ies');
    expect(getIESForFixture(makeFixture({ type: 'downlight', ies: 'ies/x.ies' })).status).toBe('ready');
    clearIESCache();
    expect(getIESForFixture(makeFixture({ type: 'downlight', ies: 'ies/x.ies' })).status).toBe('pending');
  });
});
