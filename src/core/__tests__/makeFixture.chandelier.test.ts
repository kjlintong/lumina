import { describe, it, expect } from 'vitest';
import { makeFixture } from '../makeFixture.js';
import { hasVerifiedIES } from '../types.js';
import type { Fixture } from '../types.js';

/** 收窄到参数化 Photometric 分支（makeFixture 未给 ies 时总是参数化） */
function paramsOf(f: Fixture) {
  expect(hasVerifiedIES(f.photometric)).toBe(false);
  const p = f.photometric;
  if (p.ies === undefined) return p;
  throw new Error('expected parametric photometric');
}

describe('P37d：makeFixture 支持 chandelier', () => {
  it('默认 mount=suspended', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.type).toBe('chandelier');
    expect(f.mount).toBe('suspended');
  });

  it('默认 form=sphere', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(f.shape.form).toBe('sphere');
  });

  it('默认 photometric.lumens=1200', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(paramsOf(f).lumens).toBe(1200);
  });

  it('默认 photometric.beamAngle=100', () => {
    const f = makeFixture({ type: 'chandelier' });
    expect(paramsOf(f).beamAngle).toBe(100);
  });

  it('opts 可覆盖', () => {
    const f = makeFixture({ type: 'chandelier', lumens: 2000, beamAngle: 120 });
    const p = paramsOf(f);
    expect(p.lumens).toBe(2000);
    expect(p.beamAngle).toBe(120);
  });
});
