import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimeAxis, AXIS_MIN, AXIS_MAX, hourToRatio, trackGradient } from '../panels/TimeAxis.js';

describe('TimeAxis 纯函数', () => {
  it('hourToRatio 区间内正确换算（0..24 全天）', () => {
    expect(hourToRatio(0)).toBe(0);
    expect(hourToRatio(24)).toBe(1);
    expect(hourToRatio(12)).toBeCloseTo(0.5, 5);
    expect(hourToRatio(17.75)).toBeCloseTo(17.75 / 24, 5);
  });

  it('hourToRatio 越界钳到端点（不超 0..1）', () => {
    expect(hourToRatio(-5)).toBe(0);
    expect(hourToRatio(30)).toBe(1);
  });

  it('trackGradient 含全部 7 个颜色键，且首尾闭合回午夜蓝', () => {
    const g = trackGradient();
    // 6 个不同的颜色键都在
    for (const c of ['#1a1a3e', '#2a2a5e', '#ff9040', '#ffd24a', '#c44a2a', '#5a4a8a']) {
      expect(g).toContain(c);
    }
    // 首尾颜色键一致 → 午夜 → 午夜的闭合回环
    expect(g).toContain('#1a1a3e 0%');
    expect(g.endsWith('#1a1a3e 100%)')).toBe(true);
    // 共 7 个颜色键（午夜蓝出现两次：0% 与 100%）
    expect((g.match(/#[0-9a-f]{6}/g) ?? []).length).toBe(7);
  });
});

describe('TimeAxis 组件', () => {
  const props = {
    hour: 17.75,
    onHourChange: () => {},
    speed: 0.5,
    onSpeedChange: () => {},
    shadows: true,
    onShadowsChange: () => {},
  };

  it('渲染渐变轨道、手柄与 13 个整点刻度（每 2 小时：0..24）', () => {
    const { container } = render(<TimeAxis {...props} />);
    expect(container.querySelector('.time-track')).not.toBeNull();
    expect(container.querySelector('.time-knob')).not.toBeNull();
    expect(container.querySelectorAll('.time-tick')).toHaveLength(13);
  });

  it('药丸显示当前 HH:MM（17.75 → 17:45）', () => {
    const { container } = render(<TimeAxis {...props} />);
    expect(container.querySelector('.time-pill')!.textContent).toBe('17:45');
  });

  it('手柄有正确的 role / aria 可访问性属性（min=0 max=24）', () => {
    const { container } = render(<TimeAxis {...props} />);
    const knob = container.querySelector('.time-knob') as HTMLElement;
    expect(knob.getAttribute('role')).toBe('slider');
    expect(knob.getAttribute('aria-valuemin')).toBe('0');
    expect(knob.getAttribute('aria-valuemax')).toBe('24');
    expect(knob.getAttribute('aria-valuetext')).toBe('17:45');
  });

  it('手柄 left 跟随 hour 换算（12:00 在轨道正中间）', () => {
    const { container } = render(<TimeAxis {...props} hour={12} />);
    const knob = container.querySelector('.time-knob') as HTMLElement;
    expect(knob.style.left).toBe('50%');
  });

  it('键盘右键调大、左键调小，且钳在 [0, 24]', () => {
    const seen: number[] = [];
    const { container } = render(
      <TimeAxis {...props} hour={23.95} onHourChange={(h) => seen.push(h)} />,
    );
    const knob = container.querySelector('.time-knob') as HTMLElement;
    // 连续两次右键：23.95 → 23.983 → 24.025，最后一步被钳到上界 24
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(seen[seen.length - 1]).toBe(AXIS_MAX);
    // 非方向键不触发回调
    const before = seen.length;
    fireEvent.keyDown(knob, { key: 'Enter' });
    expect(seen.length).toBe(before);
    // 左键：23.95 - 1/12 = 23.8833，仍不小于下界
    fireEvent.keyDown(knob, { key: 'ArrowLeft' });
    expect(seen[seen.length - 1]).toBeCloseTo(23.95 - 1 / 12, 5);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(AXIS_MIN);
  });

  it('下界钳位：hour=0 时左键保持 0（不越界变负）', () => {
    const seen: number[] = [];
    const { container } = render(
      <TimeAxis {...props} hour={0} onHourChange={(h) => seen.push(h)} />,
    );
    const knob = container.querySelector('.time-knob') as HTMLElement;
    fireEvent.keyDown(knob, { key: 'ArrowLeft' });
    expect(seen[0]).toBe(AXIS_MIN);
  });

  it('区间常量符合规格（0..24 全天）', () => {
    expect(AXIS_MIN).toBe(0);
    expect(AXIS_MAX).toBe(24);
  });
});
