import { useCallback, useEffect, useRef, useState } from 'react';
import { useModelingStore } from '../../store/modelingStore.js';
import type { LengthUnit } from '../../core/scale.js';
import { describeImporter } from '../../core/importers.js';

const UNIT_OPTIONS: { value: LengthUnit; label: string }[] = [
  { value: 'm', label: '米 (m)' },
  { value: 'mm', label: '毫米 (mm)' },
  { value: 'cm', label: '厘米 (cm)' },
  { value: 'in', label: '英寸 (in)' },
  { value: 'ft', label: '英尺 (ft)' },
];

/**
 * 上传户型图面板（P23 §1 + §2）。
 *
 * 交互流程：
 * 1. 点击或拖拽上传 JPG/PNG
 * 2. 显示缩略图 + 分档 SLA 提示
 * 3. 点击标定画布上的两点（标注一段已知长度）
 * 4. 输入实际距离 + 选择单位 → 确认标定
 * 5. 标定成功/失败反馈
 */
export function ImportPanel() {
  const {
    importedImage,
    importImageName,
    calibrationPoints,
    isCalibrating,
    calibrationError,
    importImage,
    clearImport,
    addCalibrationPoint,
    confirmCalibration,
    resetCalibration,
  } = useModelingStore();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [realDistance, setRealDistance] = useState('3');
  const [unit, setUnit] = useState<LengthUnit>('m');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // ImageBitmap → object URL
  useEffect(() => {
    if (importedImage === null) {
      setObjectUrl(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = importedImage.width || 1;
    canvas.height = importedImage.height || 1;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.drawImage(importedImage, 0, 0);
      const url = canvas.toDataURL('image/png');
      setObjectUrl(url);
    }
  }, [importedImage]);

  const descriptor = describeImporter({ kind: 'image', format: 'png' });

  const isImage = (f: File) => {
    return f.type.startsWith('image/');
  };

  const handleFile = (file: File) => {
    if (isImage(file)) {
      importImage(file);
    }
  };

  const handleCalibrationClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isCalibrating || importedImage === null) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const scaleX = (importedImage.width || 400) / rect.width;
      const scaleY = (importedImage.height || 400) / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      addCalibrationPoint(x, y);
    },
    [isCalibrating, importedImage, addCalibrationPoint],
  );

  // 未上传：显示上传按钮
  if (importedImage === null) {
    return (
      <div className="import-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          上传户型图
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div
          style={{
            padding: '24px 12px',
            border: '2px dashed rgba(255,255,255,0.2)',
            borderRadius: 8,
            textAlign: 'center',
            cursor: 'pointer',
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = e.dataTransfer.files[0];
            if (f && isImage(f)) handleFile(f);
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
            点击或拖拽上传 JPG/PNG
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          分档 SLA：{descriptor.track.track === 'scan' ? '扫描图路径，不承诺统一误差' : 'CAD 路径'}
        </div>
      </div>
    );
  }

  // 已上传：显示预览 + 标定
  const imgWidth = importedImage.width || 400;
  const imgHeight = importedImage.height || 400;

  return (
    <div className="import-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          {importImageName}
        </h3>
        <button
          type="button"
          onClick={() => clearImport()}
          style={{
            padding: '2px 6px',
            fontSize: 10,
            cursor: 'pointer',
            border: '1px solid rgba(255,80,80,0.3)',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          清除
        </button>
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        {objectUrl !== null && (
          <img
            src={objectUrl}
            style={{ width: '100%', display: 'block', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)' }}
            alt="户型图预览"
          />
        )}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: isCalibrating ? 'auto' : 'none',
            cursor: isCalibrating ? 'crosshair' : 'default',
          }}
          onClick={handleCalibrationClick}
          role="img"
          aria-label="户型图标定"
        >
          {calibrationPoints.map((p, i) => {
            const pctX = (p[0] / imgWidth) * 100;
            const pctY = (p[1] / imgHeight) * 100;
            return (
              <circle
                key={i}
                cx={`${pctX}%`}
                cy={`${pctY}%`}
                r="5"
                fill="none"
                stroke="#f0a040"
                strokeWidth={2}
              />
            );
          })}
          {calibrationPoints.length === 2 && (
            <line
              x1={`${(calibrationPoints[0]![0] / imgWidth) * 100}%`}
              y1={`${(calibrationPoints[0]![1] / imgHeight) * 100}%`}
              x2={`${(calibrationPoints[1]![0] / imgWidth) * 100}%`}
              y2={`${(calibrationPoints[1]![1] / imgHeight) * 100}%`}
              stroke="#f0a040"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
        </svg>
      </div>

      {isCalibrating && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          在图片上点击两点，标注一段已知长度的线段（如「这段 = 3m」）
        </div>
      )}

      {calibrationError && (
        <div style={{ fontSize: 11, color: '#e06060' }}>
          {calibrationError}
        </div>
      )}

      {!isCalibrating && (
        <div style={{ fontSize: 10, color: '#60c060' }}>
          ✓ 已标定
        </div>
      )}

      {/* 标定输入区 */}
      {isCalibrating && calibrationPoints.length >= 2 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={realDistance}
            onChange={(e) => setRealDistance(e.target.value)}
            placeholder="距离"
            style={{
              padding: '2px 4px',
              fontSize: 11,
              width: 50,
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.3)',
              color: 'rgba(255,255,255,0.8)',
            }}
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as LengthUnit)}
            style={{
              padding: '2px 4px',
              fontSize: 11,
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.3)',
              color: 'rgba(255,255,255,0.8)',
            }}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => confirmCalibration(parseFloat(realDistance), unit)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
              border: '1px solid rgba(96,192,96,0.4)',
              borderRadius: 4,
              background: 'rgba(96,192,96,0.2)',
              color: '#60c060',
            }}
          >
            确认
          </button>
          <button
            type="button"
            onClick={() => resetCalibration()}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            重置
          </button>
        </div>
      )}
    </div>
  );
}
