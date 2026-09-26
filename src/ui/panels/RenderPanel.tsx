/**
 * 渲染控制面板（P7 后处理 + 项目管理）。
 *
 * Bloom 光晕：WebGL2 专属（EffectComposer），调用 backend.setBloom。
 * 导出/导入：localStorage 自动保存之外，提供 JSON 文件下载/上传（备份/分享）。
 * 项目名：编辑 LuminaProject.name。
 */

import { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore.js';
import { serializeProject, deserializeProject } from '../../core/serialize.js';
import { Panel } from './Panel.js';

interface RenderPanelProps {
  /** 是否支持后处理（WebGL2 true，WebGPU false） */
  postProcessing: boolean;
  /** 当前 Bloom 参数 */
  bloom: { strength: number; radius: number; threshold: number } | null;
  /** 设置 Bloom 参数 */
  onBloomChange: (strength: number, radius: number, threshold: number) => void;
}

export function RenderPanel({ postProcessing, bloom, onBloomChange }: RenderPanelProps) {
  const [bloomOn, setBloomOn] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const project = useProjectStore((s) => s.project);
  const setNotice = useProjectStore((s) => s.setNotice);

  /** 导出项目为 JSON 文件下载 */
  const handleExport = () => {
    const json = JSON.stringify(serializeProject(project), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'lumina-project'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 导入 JSON 文件 */
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = deserializeProject(JSON.parse(reader.result as string) as Parameters<typeof deserializeProject>[0]);
        if (Object.keys(loaded.fixtures).length === 0) {
          setNotice('导入失败：文件中无灯具');
          return;
        }
        useProjectStore.setState({ project: loaded });
        setNotice(`已导入「${loaded.name}」`);
      } catch {
        setNotice('导入失败：文件格式无效');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /** 重置到示例方案 */
  const handleReset = () => {
    localStorage.removeItem('lumina-project');
    window.location.reload();
  };

  return (
    <Panel title="渲染与项目">
      {/* Bloom 光晕（仅 WebGL2） */}
      {postProcessing && bloom && (
        <div className="field-group">
          <div className="field-group-title">光晕 (Bloom)</div>
          <label className="field">
            <span className="field-label">启用</span>
            <input
              type="checkbox"
              checked={bloomOn}
              onChange={(e) => {
                const on = e.target.checked;
                setBloomOn(on);
                onBloomChange(on ? 0.35 : 0, on ? 0.4 : 0, on ? 0.85 : 1);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">强度 {bloom.strength.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={bloom.strength}
              disabled={!bloomOn}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onBloomChange(v, bloom.radius, bloom.threshold);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">半径 {bloom.radius.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={bloom.radius}
              disabled={!bloomOn}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onBloomChange(bloom.strength, v, bloom.threshold);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">阈值 {bloom.threshold.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={bloom.threshold}
              disabled={!bloomOn}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onBloomChange(bloom.strength, bloom.radius, v);
              }}
            />
          </label>
        </div>
      )}

      {/* 项目管理 */}
      <div className="field-group">
        <div className="field-group-title">项目管理</div>
        <div className="field">
          <span className="field-label">方案名称</span>
          <input
            className="input"
            type="text"
            value={project.name}
            onChange={(e) => useProjectStore.setState({ project: { ...project, name: e.target.value } })}
          />
        </div>
        <div className="panel-row">
          <button type="button" className="btn" onClick={handleExport}>
            导出 JSON
          </button>
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />
        </div>
        <button type="button" className="btn btn-danger" onClick={handleReset}>
          重置为示例方案
        </button>
      </div>
    </Panel>
  );
}
