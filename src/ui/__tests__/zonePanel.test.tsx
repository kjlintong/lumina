import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZonePanel } from '../panels/ZonePanel.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';

describe('ZonePanel（P24-a：lux 收进专业模式）', () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createInitialProject() });
  });

  it('未开专业模式时不渲染 lux 数字', () => {
    render(<ZonePanel />);
    // 文本被拆到多个 DOM 节点，用 textContent 全文匹配
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/目标/);
    expect(text).not.toMatch(/lx/);
  });

  it('开启专业模式时渲染 lux 数字', () => {
    render(<ZonePanel professional />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/目标/);
    expect(text).toMatch(/lx/);
  });

  it('专业模式开关不影响分区名和工作面显示', () => {
    render(<ZonePanel />);
    // 文本被拆到多个 DOM 节点，用 textContent 全文匹配
    expect(document.body.textContent).toContain('工作面');
  });

  it('渲染分区列表（分区存在）', () => {
    render(<ZonePanel />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});
