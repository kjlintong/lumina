/**
 * 可折叠面板容器：深色 .overlay 风格的侧栏区块。
 * 标题栏点击可展开/收起内容。
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** 默认是否展开 */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Panel({ title, defaultOpen = true, children }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel${open ? '' : ' collapsed'}`}>
      <button
        type="button"
        className="panel-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="panel-caret">{open ? '▾' : '▸'}</span>
        <span className="panel-title">{title}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
