import { describe, it, expect } from 'vitest';
import { axesForMount } from '../mountAxes.js';

describe('axesForMount', () => {
  it('ceiling / recessed: XZ 平移 + Y 旋转', () => {
    expect(axesForMount('ceiling').translateAxis).toBe('XZ');
    expect(axesForMount('recessed').translateAxis).toBe('XZ');
    expect(axesForMount('ceiling').rotateAxis).toBe('Y');
    expect(axesForMount('recessed').rotateAxis).toBe('Y');
  });

  it('suspended: XYZ 平移 + Y 旋转', () => {
    expect(axesForMount('suspended').translateAxis).toBe('XYZ');
    expect(axesForMount('suspended').rotateAxis).toBe('Y');
  });

  it('wall: XZ + Y（P28 简化）', () => {
    expect(axesForMount('wall').translateAxis).toBe('XZ');
    expect(axesForMount('wall').rotateAxis).toBe('Y');
  });

  it('floor / tabletop: XZ + Y', () => {
    expect(axesForMount('floor').translateAxis).toBe('XZ');
    expect(axesForMount('tabletop').translateAxis).toBe('XZ');
    expect(axesForMount('floor').rotateAxis).toBe('Y');
    expect(axesForMount('tabletop').rotateAxis).toBe('Y');
  });

  it('track: 简化同 ceiling', () => {
    expect(axesForMount('track').translateAxis).toBe('XZ');
    expect(axesForMount('track').rotateAxis).toBe('Y');
  });

  it('所有 mount 都返回 translate + rotate mode', () => {
    for (const m of ['ceiling', 'recessed', 'wall', 'suspended', 'track', 'floor', 'tabletop'] as const) {
      const cfg = axesForMount(m);
      expect(cfg.translateMode).toBe('translate');
      expect(cfg.rotateMode).toBe('rotate');
    }
  });
});
