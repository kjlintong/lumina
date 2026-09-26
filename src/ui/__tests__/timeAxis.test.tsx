import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimeAxis, AXIS_MIN, AXIS_MAX, hourToRatio, trackGradient } from '../panels/TimeAxis.js';

describe('TimeAxis 纯函数', () => {
  it('hourToRatio 区间内正确换算', () => {
    expect(hourToRatio(16)).toBeCloseTo(0, 5);
    expect(hourToRatio(21)).toBeCloseTo(1, 5);
    expect(hourToRatio(18.5)).toBeCloseTo(0.5, 5);
  });

  it('hourToRatio 越界钳到端点（不超 0..1）', () => {
    expect(hourToRatio(10)).toBe(0);
    expect(hourToRatio(30)).toBe(1);
    expect(hourToRatio(-5)).toBe(0);
  });

  it('trackGradient 含全部 5 个颜色键', () => {
    const g = trackGradient();
    for (const c of ['#ffcc66', '#ff8a3a', '#c44a2a', '#5a4a8a', '#2a2a5a']) {
      expect(g).toContain(c);
    }
  });
});

describe('TimeAxis 组件', () => {
  const props = {
    hour: 17.5,
    onHourChange: () => {},
    speed: 0.5,
    onSpeedChange: () => {},
    shadows: true,
    onShadowsChange: () => {},
  };

  it('渲染渐变轨道、手柄与 6 个整点刻度', () => {
    const { container } = render(<TimeAxis {...props} />);
    expect(container.querySelector('.time-track')).not.toBeNull();
    expect(container.querySelector('.time-knob')).not.toBeNull();
    const ticks = container.querySelectorAll('.time-tick');
    expect(ticks).toHaveLength(6);
  });

  it('药丸显示当前 HH:MM（17.5 → 17:30）', () => {
    const { container } = render(<TimeAxis {...props} />);
    expect(container.querySelector('.time-pill')!.textContent).toBe('17:30');
  });

  it('手柄有正确的 role / aria 可访问性属性', () => {
    const { container } = render(<TimeAxis {...props} />);
    const knob = container.querySelector('.time-knob') as HTMLElement;
    expect(knob.getAttribute('role')).toBe('slider');
    expect(knob.getAttribute('aria-valuemin')).toBe('16');
    expect(knob.getAttribute('aria-valuemax')).toBe('21');
    expect(knob.getAttribute('aria-valuetext')).toBe('17:30');
  });

  it('键盘右键调大、左键调小，且钳在 [16, 21]', () => {
    const seen: number[] = [];
    const { container } = render(
      <TimeAxis {...props} hour={20.95} onHourChange={(h) => seen.push(h)} />,
    );
    const knob = container.querySelector('.time-knob') as HTMLElement;
    // 连续两次右键：20.95 → 20.983 → 21.025，最后一步被钳到上界 21
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(seen[seen.length - 1]).toBe(AXIS_MAX);
    // 非方向键不触发回调
    const before = seen.length;
    fireEvent.keyDown(knob, { key: 'Enter' });
    expect(seen.length).toBe(before);
    // 左键：20.95 - 1/12 = 20.8833，仍不小于下界
    fireEvent.keyDown(knob, { key: 'ArrowLeft' });
    expect(seen[seen.length - 1]).toBeCloseTo(20.95 - 1 / 12, 5);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(AXIS_MIN);
  });

  it('区间常量符合规格（16..21）', () => {
    expect(AXIS_MIN).toBe(16);
    expect(AXIS_MAX).toBe(21);
  });
});
