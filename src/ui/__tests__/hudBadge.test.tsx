import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HudStats, formatCount, formatFps } from '../panels/HudStats.js';
import { BuildBadge, formatBuildTime } from '../panels/BuildBadge.js';

describe('HudStats 纯函数', () => {
  it('formatCount 大数用 K 后缀、小数取整', () => {
    expect(formatCount(12400)).toBe('12.4K');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(9999)).toBe('9999');
    expect(formatCount(10000)).toBe('10.0K');
    expect(formatCount(86)).toBe('86');
  });

  it('formatCount 非法值（NaN / 负数 / Infinity）显示占位', () => {
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(-1)).toBe('—');
    expect(formatCount(Infinity)).toBe('—');
  });

  it('formatFps 取整，非法值显示占位', () => {
    expect(formatFps(58.4)).toBe('58');
    expect(formatFps(0)).toBe('0');
    expect(formatFps(Number.NaN)).toBe('—');
    expect(formatFps(-3)).toBe('—');
  });
});

describe('HudStats 组件（P10 默认折叠 / 展开交互）', () => {
  it('stats === null 时折叠态只显示 FPS 占位 —（不崩）', () => {
    const { container } = render(<HudStats stats={null} />);
    // 折叠态：没有 .hud-details，只有按钮里的 FPS 一行
    expect(container.querySelector('.hud-details')).toBeNull();
    const values = [...container.querySelectorAll('.hud-value')].map((n) => n.textContent);
    expect(values).toEqual(['—']);
  });

  it('折叠态只显示 FPS 一行；展开后追加"三角面""部件"两行（共三行）', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HudStats stats={{ triangles: 12400, objects: 86, fps: 58.2 }} />,
    );

    // 默认折叠：只有一个 .hud-value（FPS）
    const labelsBefore = [...container.querySelectorAll('.hud-label')].map((n) => n.textContent);
    expect(labelsBefore).toEqual(['帧/秒']);
    expect(container.querySelector('.hud-details')).toBeNull();
    expect([...container.querySelectorAll('.hud-value')].map((n) => n.textContent)).toEqual(['58']);

    // 点 .hud-toggle 展开
    const toggle = container.querySelector('.hud-toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);

    // 展开后：FPS + 三角面 + 部件 三行 hud-value
    expect(container.querySelector('.hud-details')).not.toBeNull();
    const labelsAfter = [...container.querySelectorAll('.hud-label')].map((n) => n.textContent);
    expect(labelsAfter).toEqual(['帧/秒', '三角面', '部件']);
    expect([...container.querySelectorAll('.hud-value')].map((n) => n.textContent)).toEqual([
      '58',
      '12.4K',
      '86',
    ]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // 再点一次折叠
    await user.click(toggle);
    expect(container.querySelector('.hud-details')).toBeNull();
    expect([...container.querySelectorAll('.hud-value')].map((n) => n.textContent)).toEqual(['58']);
  });

  it('WebGPU（triangles=null）折叠态只显示 FPS；展开后三角面为占位 —', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HudStats stats={{ triangles: null, objects: 86, fps: 59.7 }} />,
    );
    expect([...container.querySelectorAll('.hud-value')].map((n) => n.textContent)).toEqual(['60']);
    await user.click(container.querySelector('.hud-toggle') as HTMLElement);
    expect([...container.querySelectorAll('.hud-value')].map((n) => n.textContent)).toEqual([
      '60',
      '—',
      '86',
    ]);
  });
});

describe('BuildBadge 纯函数', () => {
  it('formatBuildTime 把 ISO 串格式化成 YYYY-MM-DD HH:MM', () => {
    // 用 UTC 固定时间，避免本机时区影响断言
    expect(formatBuildTime('2026-09-26T00:00:00.000Z')).toMatch(/2026-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('formatBuildTime 解析失败时原样返回', () => {
    expect(formatBuildTime('not-a-date')).toBe('not-a-date');
  });
});

describe('BuildBadge 组件', () => {
  it('渲染 build 串与后端标识', () => {
    const { container } = render(<BuildBadge backend="webgl2" />);
    const text = container.textContent ?? '';
    expect(text).toContain('build');
    expect(text).toContain('webgl2');
  });
});
