/**
 * 渲染控制面板（P7 后处理 + 项目管理）。
 *
 * Bloom 光晕：WebGL2 专属（EffectComposer），调用 backend.setBloom。
 * 导出/导入：localStorage 自动保存之外，提供 JSON 文件下载/上传（备份/分享）。
 * 项目名：编辑 LuminaProject.name。
 *
 * P26a：hidePostProcessing=true 时（生产环境）隐藏 Bloom / Godrays 调参；
 * 氛围层（尘埃 / 光柱）与项目管理对所有人可见。
 */

import { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore.js';
import { serializeProject, deserializeProject } from '../../core/serialize.js';
import type { GodraysSettings } from '../../render/godrays.js';
import { Panel } from './Panel.js';

interface RenderPanelProps {
  /** 生产模式（hidePostProcessing=true）时隐藏 Bloom / Godrays 区块；默认 false */
  hidePostProcessing?: boolean;
  /** 当前 Bloom 参数 */
  bloom: { strength: number; radius: number; threshold: number } | null;
  /** 设置 Bloom 参数 */
  onBloomChange: (strength: number, radius: number, threshold: number) => void;
  /** 当前 Godrays 参数 */
  godrays: GodraysSettings | null;
  /** 更新 Godrays 参数 */
  onGodraysChange: (partial: Partial<GodraysSettings>) => void;
  /** 当前尘埃粒子是否可见（P8b 性能开关） */
  dustVisible: boolean;
  /** 切换尘埃粒子可见性 */
  onDustVisibleChange: (enabled: boolean) => void;
  /** 当前体积光柱是否可见（P8b 性能开关） */
  lightShaftVisible: boolean;
  /** 切换体积光柱可见性 */
  onLightShaftVisibleChange: (enabled: boolean) => void;
}

export function RenderPanel({
  hidePostProcessing = false,
  bloom,
  onBloomChange,
  godrays,
  onGodraysChange,
  dustVisible,
  onDustVisibleChange,
  lightShaftVisible,
  onLightShaftVisibleChange,
}: RenderPanelProps) {
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
      {/* Bloom 光晕（仅 WebGL2；hidePostProcessing=true 时隐藏） */}
      {bloom && !hidePostProcessing && (
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
                onBloomChange(on ? 0.22 : 0, on ? 0.3 : 0, on ? 0.85 : 1);
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

      {/* 体积光 Godrays（仅 WebGL2；hidePostProcessing=true 时隐藏） */}
      {godrays && !hidePostProcessing && (
        <div className="field-group">
          <div className="field-group-title">体积光 (Godrays)</div>
          <label className="field">
            <span className="field-label">启用</span>
            <input
              type="checkbox"
              checked={godrays.enabled}
              onChange={(e) => onGodraysChange({ enabled: e.target.checked })}
            />
          </label>
          <label className="field">
            <span className="field-label">密度 {godrays.density.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={godrays.density}
              disabled={!godrays.enabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onGodraysChange({ density: v });
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">衰减 {godrays.decay.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={godrays.decay}
              disabled={!godrays.enabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onGodraysChange({ decay: v });
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">强度 {godrays.weight.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={godrays.weight}
              disabled={!godrays.enabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onGodraysChange({ weight: v });
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">光晕半径 {godrays.screenRadius.toFixed(2)}</span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={godrays.screenRadius}
              disabled={!godrays.enabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onGodraysChange({ screenRadius: v });
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">采样数 {godrays.sampleCount}</span>
            <input
              type="range"
              min={4}
              max={64}
              step={1}
              value={godrays.sampleCount}
              disabled={!godrays.enabled}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) onGodraysChange({ sampleCount: v });
              }}
            />
          </label>
        </div>
      )}

      {/* 氛围层（P8b）：尘埃粒子 + 体积光柱。性能开关——低端设备可关闭。
          不受 hidePostProcessing 限制：两者都是场景图对象（Points / Mesh），
          不依赖 EffectComposer。 */}
      <div className="field-group">
        <div className="field-group-title">氛围层</div>
        <label className="field">
          <span className="field-label">尘埃粒子</span>
          <input
            type="checkbox"
            checked={dustVisible}
            onChange={(e) => onDustVisibleChange(e.target.checked)}
          />
        </label>
        <label className="field">
          <span className="field-label">体积光柱</span>
          <input
            type="checkbox"
            checked={lightShaftVisible}
            onChange={(e) => onLightShaftVisibleChange(e.target.checked)}
          />
        </label>
      </div>

      {/* 项目管理：方案名称 + 重置示例。
          JSON 导入/导出属于开发者工具，移到下方「开发者」折叠区（P24-a），
          避免专业模式开启后与渲染调参混在同一面板。 */}
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
        <button type="button" className="btn btn-danger" onClick={handleReset}>
          重置为示例方案
        </button>
      </div>

      {/* 开发者（P24-a）：JSON 导入导出独立折叠区，默认收起。 */}
      <Panel title="开发者" defaultOpen={false}>
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
      </Panel>
    </Panel>
  );
}
