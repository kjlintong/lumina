import { useEffect, useRef, useState } from 'react';
import { makeFixture } from './core/makeFixture.js';
import { createBackend } from './render/backend.js';
import { SceneEngine } from './scene/sceneEngine.js';

type BackendType = 'webgpu' | 'webgl2';

/**
 * Lumina 主应用组件。
 * 创建渲染后端 → 初始化场景引擎 → 渲染房间 + 灯具。
 */
export default function App() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const backendTypeRef = useRef<BackendType>('webgl2');
  const degradationRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let engine: SceneEngine | null = null;

    async function init() {
      const container = canvasContainerRef.current;
      if (!container) return;

      const canvas = document.createElement('canvas');
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);

      try {
        const result = await createBackend({
          canvas,
          width: container.clientWidth,
          height: container.clientHeight,
        });

        const bt = result.backend.type;
        backendTypeRef.current = bt;
        degradationRef.current = result.degradationReason ?? null;

        engine = new SceneEngine(result.backend, {
          roomWidth: 6,
          roomDepth: 4.5,
          roomHeight: 2.8,
          initialHour: 18.0,
          timeSpeed: 0.5,
        });
        engineRef.current = engine;

        // 添加示例灯具
        const fixtures = [
          makeFixture({ type: 'downlight', pos: [0, 2.7, 0], lumens: 500, beamAngle: 36, cct: 3000 }),
          makeFixture({ type: 'downlight', pos: [-1.5, 2.7, 0], lumens: 500, beamAngle: 36, cct: 3000 }),
          makeFixture({ type: 'downlight', pos: [1.5, 2.7, 0], lumens: 500, beamAngle: 36, cct: 3000 }),
          makeFixture({ type: 'pendant', pos: [0, 1.8, -1.5], lumens: 800, cct: 2700 }),
          makeFixture({ type: 'spot', pos: [-2.5, 2.7, -2], lumens: 300, beamAngle: 24, cct: 4000 }),
          makeFixture({ type: 'sconce', pos: [2.9, 1.5, 0], lumens: 300, cct: 2700 }),
          makeFixture({ type: 'floor', pos: [-2, 1.5, 1.5], lumens: 600, cct: 3000 }),
        ];

        for (const f of fixtures) {
          engine.addFixture(f);
        }

        engine.resize(container.clientWidth, container.clientHeight);
        engine.setCameraPosition(0, 3.5, 7);
        engine.start();

        setReady(true);

        // 处理窗口大小变化
        const onResize = () => {
          if (engine) {
            engine.resize(container.clientWidth, container.clientHeight);
          }
        };
        window.addEventListener('resize', onResize);

        // 控制 UI
        const timeInput = document.getElementById('time-input') as HTMLInputElement | null;
        const speedInput = document.getElementById('speed-input') as HTMLInputElement | null;
        const shadowToggle = document.getElementById('shadow-toggle') as HTMLInputElement | null;

        const updateTime = () => {
          if (timeInput && engine) {
            const parts = timeInput.value.split(':').map(Number);
            const h = parts[0] ?? 0;
            const m = parts[1] ?? 0;
            const hour = h + m / 60;
            engine.setHour(hour);
            updateInfo();
          }
        };

        const updateSpeed = () => {
          if (speedInput && engine) {
            engine.setTimeSpeed(parseFloat(speedInput.value));
          }
        };

        const updateShadow = () => {
          if (shadowToggle && engine) {
            engine.setShadows(shadowToggle.checked);
          }
        };

        timeInput?.addEventListener('input', updateTime);
        speedInput?.addEventListener('input', updateSpeed);
        shadowToggle?.addEventListener('change', updateShadow);

        const timeInfoEl = document.getElementById('time-info');
        const warningInfoEl = document.getElementById('warning-info');
        const backendInfoEl = document.getElementById('backend-info');

        function updateInfo() {
          if (engine && timeInfoEl) {
            const h = engine.getHour();
            const hh = Math.floor(h);
            const mm = Math.round((h - hh) * 60);
            const hourStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            timeInfoEl.textContent = `时间: ${hourStr}`;

            if (warningInfoEl) {
              if (engine.isSunsetActive()) {
                warningInfoEl.textContent = '日落时段 — 暖光模拟中';
              } else {
                warningInfoEl.textContent = '';
              }
            }
          }
          if (backendInfoEl) {
            backendInfoEl.textContent = `渲染后端: ${backendTypeRef.current.toUpperCase()}`;
          }
        }

        // 定期更新 UI
        const infoInterval = setInterval(updateInfo, 500);

        // 清理
        return () => {
          window.removeEventListener('resize', onResize);
          timeInput?.removeEventListener('input', updateTime);
          speedInput?.removeEventListener('input', updateSpeed);
          shadowToggle?.removeEventListener('change', updateShadow);
          clearInterval(infoInterval);
          if (engine) {
            engine.dispose();
            engine = null;
          }
          canvas.remove();
        };
      } catch (err) {
        console.error('Lumina init failed:', err);
        degradationRef.current = `初始化失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    void init();

    return () => {
      if (engine) {
        engine.dispose();
      }
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div ref={canvasContainerRef} id="canvas-container" style={{ width: '100%', height: '100%' }} />
      {!ready && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 18 }}>
          加载中...
        </div>
      )}
    </div>
  );
}
