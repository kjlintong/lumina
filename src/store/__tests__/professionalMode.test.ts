import { beforeEach, describe, expect, it } from 'vitest';
import { readProfessionalMode, writeProfessionalMode } from '../professionalMode.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('professionalMode', () => {
  it('未写入时默认 false', () => {
    expect(readProfessionalMode()).toBe(false);
  });

  it('写 true 后读回 true；写 false 后读回 false', () => {
    writeProfessionalMode(true);
    expect(readProfessionalMode()).toBe(true);
    writeProfessionalMode(false);
    expect(readProfessionalMode()).toBe(false);
  });

  it("localStorage 中残留非 '1' 值（如 '0'、'true'、'yes'、''）均为 false", () => {
    for (const bad of ['0', 'true', 'yes', '1 ', '']) {
      window.localStorage.setItem('lumina.professionalMode', bad);
      expect(readProfessionalMode()).toBe(false);
    }
  });

  it('localStorage 不可用时静默兜底（不 throw）', () => {
    // 通过覆盖 getItem/setItem 抛错来模拟隐私模式。
    // 必须在 try/finally 里恢复，否则会污染后续测试文件。
    const origGet = window.localStorage.getItem.bind(window.localStorage);
    const origSet = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.getItem = () => {
      throw new Error('denied');
    };
    window.localStorage.setItem = () => {
      throw new Error('denied');
    };
    try {
      expect(readProfessionalMode()).toBe(false);
      writeProfessionalMode(true); // 不应 throw
    } finally {
      window.localStorage.getItem = origGet;
      window.localStorage.setItem = origSet;
    }
  });
});
