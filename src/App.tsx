import { useEffect, useRef, useState } from 'react';
import { Raycaster, Vector2, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { ActivityZone, Fixture } from './core/types.js';
import { createBackend } from './render/backend.js';
import type { BackendType, RenderBackend } from './render/backend.js';
import type { BloomSettings } from './render/postProcessing.js';
import type { GodraysSettings } from './render/godrays.js';
import { DEFAULT_GODRAYS } from './render/godrays.js';
import { preloadIESFiles } from './render/iesCache.js';
import { serializeProject, deserializeProject } from './core/serialize.js';
import { SceneEngine } from './scene/sceneEngine.js';
import { SceneController } from './scene/sceneController.js';
import { MANUAL_LEVEL_KEY, useProjectStore } from './store/projectStore.js';
import { ZonePanel } from './ui/panels/ZonePanel.js';
import { FixturePanel } from './ui/panels/FixturePanel.js';
import { ScenePanel } from './ui/panels/ScenePanel.js';
import { IlluminancePanel } from './ui/panels/IlluminancePanel.js';
import { RenderPanel } from './ui/panels/RenderPanel.js';

// ---------------------------------------------------------------------------
// store → engine 同步（transient subscribe，不触发 React 重渲染）
// ---------------------------------------------------------------------------

function eqArr3(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function cctOf(f: Fixture): number {
  const c = f.electrical.cct;
  return typeof c === 'number' ? c : (c[0] + c[1]) / 2;
}

function lumensOf(f: Fixture): number | undefined {
  return 'lumens' in f.photometric ? f.photometric.lumens : undefined;
}

function beamAngleOf(f: Fixture): number | undefined {
  return 'beamAngle' in f.photometric ? f.photometric.beamAngle : undefined;
}

/**
 * 同步一盏已变更的灯具。
 * 结构性变更（位置/姿态/配光/类型）才重建光源；仅色温变化走 setFixtureCct、
 * 仅亮度变化走 setFixtureLevel —— 都不重建，滑杆拖动才够流畅。
 */
function syncChangedFixture(
  engine: SceneEngine,
  prev: Fixture,
  next: Fixture,
  activeSceneKey: string | null,
): void {
  const structural =
    next.type !== prev.type ||
    !eqArr3(prev.pos, next.pos) ||
    prev.rot.pitch !== next.rot.pitch ||
    prev.rot.yaw !== next.rot.yaw ||
    lumensOf(prev) !== lumensOf(next) ||
    beamAngleOf(prev) !== beamAngleOf(next);

  if (structural) {
    engine.updateFixture(next);
  } else {
    const cct = cctOf(next);
    if (cct !== cctOf(prev)) engine.setFixtureCct(next.id, cct);
  }

  // 亮度：活跃场景或 manual 键有记录则同步引擎实况
  const lvl = activeSceneKey
    ? next.control.sceneLevels[activeSceneKey]
    : next.control.sceneLevels[MANUAL_LEVEL_KEY];
  if (typeof lvl === 'number') engine.setFixtureLevel(next.id, lvl);
}

/** 对比前后 fixture 集合，对引擎做 add / remove / update */
function syncFixtures(
  engine: SceneEngine,
  prev: Record<string, Fixture>,
  next: Record<string, Fixture>,
  transitioning: boolean,
  activeSceneKey: string | null,
): void {
  for (const id of Object.keys(prev)) {
    if (!(id in next)) engine.removeFixture(id);
  }
  for (const [id, f] of Object.entries(next)) {
    const pf = prev[id];
    if (pf === undefined) {
      engine.addFixture(f);
      continue;
    }
    if (pf === f) continue;
    // 场景过渡期间 level/cct 由 sceneController.tick 逐帧驱动，这里跳过，
    // 避免把终值一次性写死造成闪烁（场景不改结构性字段）。
    if (transitioning) continue;
    syncChangedFixture(engine, pf, f, activeSceneKey);
  }
}

// ---------------------------------------------------------------------------
// store → engine 活动区同步（P4：可视化 + 家具）
// ---------------------------------------------------------------------------

/**
 * 活动区是否需要重建 3D 表示：几何 / 朝向 / 类型变化才重建。
 * name/lux/cct/need 等非几何字段不影响 3D，跳过以省重建。
 */
function zoneNeedsRebuild(prev: ActivityZone, next: ActivityZone): boolean {
  return (
    prev.type !== next.type ||
    prev.pos[0] !== next.pos[0] ||
    prev.pos[1] !== next.pos[1] ||
    prev.size[0] !== next.size[0] ||
    prev.size[1] !== next.size[1] ||
    prev.rotY !== next.rotY ||
    prev.planeH !== next.planeH
  );
}

/**
 * 对比前后 zones 集合，对引擎做 add / remove / update。
 * 选中态变化也触发重建（选中区边框高亮，与 ZonePanel 呼应）。
 */
function syncZones(
  engine: SceneEngine,
  prev: Record<string, ActivityZone>,
  next: Record<string, ActivityZone>,
  prevSelectedKey: string | null,
  selectedKey: string | null,
): void {
  for (const key of Object.keys(prev)) {
    if (!(key in next)) engine.removeZone(key);
  }
  for (const [key, z] of Object.entries(next)) {
    const selected = key === selectedKey;
    const pz = prev[key];
    if (pz === undefined) {
      engine.addZone(z, selected);
      continue;
    }
    const selectionChanged = (key === prevSelectedKey) !== selected;
    if (pz === z && !selectionChanged) continue;
    if (!zoneNeedsRebuild(pz, z) && !selectionChanged) continue;
    engine.updateZone(z, selected);
  }
}

// ---------------------------------------------------------------------------
// 画布点击选灯（Raycaster 拾取；仅拾取，不改渲染）
// ---------------------------------------------------------------------------

const raycaster = new Raycaster();
const pointerNdc = new Vector2();

/** 从命中对象向上找 name 为 fixtureId 的祖先（灯组 name = fixture.id，子 mesh 名带后缀） */
function findFixtureId(obj: Object3D | null, fixtures: Record<string, Fixture>): string | null {
  let cur: Object3D | null = obj;
  while (cur) {
    if (cur.name && cur.name in fixtures) return cur.name;
    cur = cur.parent;
  }
  return null;
}

/** 点击画布拾取灯具：命中则 selectFixture；未命中不改变选中态 */
function pickFixture(engine: SceneEngine, canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, engine.getCamera());
  const hits = raycaster.intersectObjects(engine.getScene().children, true);
  const fixtures = useProjectStore.getState().project.fixtures;
  for (const hit of hits) {
    const id = findFixtureId(hit.object, fixtures);
    if (id) {
      useProjectStore.getState().selectFixture(id);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Lumina 主应用。
 * 中间 canvas 内建渲染引擎；左侧活动区/灯具面板，右侧场景/照度面板；
 * 底部时间/速度/阴影控制。store 是唯一权威数据源，引擎是渲染投影。
 */
export default function App() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const controllerRef = useRef<SceneController | null>(null);

  const [ready, setReady] = useState(false);
  const [backendType, setBackendType] = useState<BackendType>('webgl2');
  const [degradation, setDegradation] = useState<string | null>(null);

  // 时间 / 速度 / 阴影控制（React 组件状态，调用 engine 对应方法）
  const [timeValue, setTimeValue] = useState('18:00');
  const [timeInfo, setTimeInfo] = useState('18:00');
  const [sunset, setSunset] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const [shadows, setShadows] = useState(true);

  // Bloom 光晕参数（WebGL2 后处理，WebGPU 无此功能）
  const [bloom, setBloom] = useState<BloomSettings | null>(null);
  // Godrays 体积光参数（WebGL2 后处理）
  const [godrays, setGodrays] = useState<GodraysSettings | null>(null);
  const backendRef = useRef<RenderBackend | null>(null);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    let disposed = false;
    let canvas: HTMLCanvasElement | null = null;
    let unsub: (() => void) | null = null;
    let infoInterval: ReturnType<typeof setInterval> | null = null;

    const onResize = () => {
      const container = canvasContainerRef.current;
      const engine = engineRef.current;
      if (container && engine) engine.resize(container.clientWidth, container.clientHeight);
    };

    // 点击选灯：与 OrbitControls 共存，按下与抬起位移 < 5px 才算"点击"（排除旋转拖拽）
    let downX = 0;
    let downY = 0;
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.abs(e.clientX - downX) >= 5 || Math.abs(e.clientY - downY) >= 5) return;
      const engine = engineRef.current;
      if (engine && canvas) pickFixture(engine, canvas, e.clientX, e.clientY);
    };

    async function init() {
      const container = canvasContainerRef.current;
      if (!container) return;

      // 尝试从 localStorage 恢复项目
      try {
        const saved = localStorage.getItem('lumina-project');
        if (saved) {
          const loaded = deserializeProject(JSON.parse(saved) as Parameters<typeof deserializeProject>[0]);
          if (Object.keys(loaded.fixtures).length > 0) {
            useProjectStore.setState({ project: loaded });
          }
        }
      } catch {
        // localStorage 损坏则忽略，用默认工程
      }

      canvas = document.createElement('canvas');
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
        if (disposed) {
          result.backend.dispose();
          return;
        }

        // 预加载 IES 文件（异步，不阻塞渲染初始化）
        const iesFixtures = Object.values(useProjectStore.getState().project.fixtures).filter(
          (f) => f.photometric.ies !== undefined,
        );
        const iesPaths = [...new Set(iesFixtures.map((f) => f.photometric.ies!).filter(Boolean))];
        if (iesPaths.length > 0) {
          void preloadIESFiles(iesPaths).then(() => {
            if (disposed) return;
            // IES 就绪后重建有 IES 的灯具光源
            const eng = engineRef.current;
            if (!eng) return;
            for (const f of Object.values(useProjectStore.getState().project.fixtures)) {
              if (f.photometric.ies !== undefined) eng.updateFixture(f);
            }
          });
        }

        const engine = new SceneEngine(result.backend, {
          roomWidth: 6,
          roomDepth: 4.5,
          roomHeight: 2.8,
          initialHour: 18.0,
          timeSpeed: 0.5,
        });
        engineRef.current = engine;
        backendRef.current = result.backend;
        const controller = new SceneController(engine);
        controllerRef.current = controller;

        // 初始化 Bloom + Godrays 状态（WebGL2 后处理，WebGPU 无此功能）
        setBloom(result.backend.getBloom?.() ?? null);
        setGodrays(result.backend.getGodrays?.() ?? null);

        // 初始灯具与活动区进引擎（订阅只处理之后的变更）
        const st = useProjectStore.getState();
        engine.setActiveScene(st.activeSceneKey);
        for (const f of Object.values(st.project.fixtures)) engine.addFixture(f);
        for (const z of Object.values(st.project.zones)) {
          engine.addZone(z, z.key === st.selectedZoneKey);
        }

        // 订阅 store：transient，不触发 React 重渲染
        unsub = useProjectStore.subscribe((state, prev) => {
          const eng = engineRef.current;
          if (!eng) return;
          if (state.activeSceneKey !== prev.activeSceneKey) {
            eng.setActiveScene(state.activeSceneKey);
          }
          const transitioning = controllerRef.current?.isRunning() ?? false;
          syncFixtures(eng, prev.project.fixtures, state.project.fixtures, transitioning, state.activeSceneKey);
          syncZones(eng, prev.project.zones, state.project.zones, prev.selectedZoneKey, state.selectedZoneKey);
          // 自动保存到 localStorage（防抖：只在 project 对象引用变化时保存）
          if (state.project !== prev.project) {
            try {
              localStorage.setItem('lumina-project', JSON.stringify(serializeProject(state.project)));
            } catch {
              // localStorage 满或不可用时静默失败
            }
          }
        });

        // 场景过渡动画 + Godrays 光源跟随太阳（挂进渲染循环）
        const _tmpVec = new Vector3();
        engine.setFrameCallback(() => {
          controller.tick();
          // 将太阳世界坐标投影到屏幕 UV，驱动体积光光源位置
          const eng = engineRef.current;
          const bkd = backendRef.current;
          if (eng && bkd?.setGodraysLightPosition) {
            const sun = eng.getSunPosition();
            if (eng.getSunIntensity() > 0) {
              _tmpVec.set(sun.x, sun.y, sun.z).project(eng.getCamera());
              // NDC → UV (0-1)
              const uvX = (_tmpVec.x + 1) / 2;
              const uvY = (_tmpVec.y + 1) / 2;
              // 仅当太阳在可视范围内时更新（z < 1 表示在近平面之前）
              if (_tmpVec.z < 1) {
                bkd.setGodraysLightPosition(uvX, uvY);
              }
            }
          }
        });

        engine.resize(container.clientWidth, container.clientHeight);
        // 相机初始位由 SceneEngine 构造器给出（房间内东南角望中心，P4b 修复：
        // 此前在房间外 (0,3.5,7)，被南墙挡住看不到室内家具）
        engine.start();

        setBackendType(result.backend.type);
        setDegradation(result.degradationReason ?? null);
        setReady(true);

        window.addEventListener('resize', onResize);
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointerup', onPointerUp);
        infoInterval = setInterval(() => {
          const eng = engineRef.current;
          if (!eng) return;
          setTimeInfo(formatHour(eng.getHour()));
          setSunset(eng.isSunsetActive());
        }, 500);
      } catch (err) {
        setDegradation(`初始化失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    void init();

    return () => {
      disposed = true;
      unsub?.();
      if (infoInterval) clearInterval(infoInterval);
      window.removeEventListener('resize', onResize);
      canvas?.removeEventListener('pointerdown', onPointerDown);
      canvas?.removeEventListener('pointerup', onPointerUp);
      engineRef.current?.dispose();
      engineRef.current = null;
      backendRef.current = null;
      controllerRef.current = null;
      canvas?.remove();
      canvas = null;
    };
  }, []);

  const handleTimeChange = (value: string) => {
    setTimeValue(value);
    const [h, m] = value.split(':').map(Number);
    engineRef.current?.setHour((h ?? 0) + (m ?? 0) / 60);
  };

  const handleSpeedChange = (value: number) => {
    setSpeed(value);
    engineRef.current?.setTimeSpeed(value);
  };

  const handleShadowsChange = (enabled: boolean) => {
    setShadows(enabled);
    engineRef.current?.setShadows(enabled);
  };

  const handleBloomChange = (strength: number, radius: number, threshold: number) => {
    backendRef.current?.setBloom?.(strength, radius, threshold);
    setBloom({ strength, radius, threshold });
  };

  const handleGodraysChange = (partial: Partial<GodraysSettings>) => {
    backendRef.current?.setGodrays?.(partial);
    const current = godrays ?? { ...DEFAULT_GODRAYS };
    setGodrays({ ...current, ...partial });
  };

  // 解绑提示：store.notice 变化时显示 toast，4 秒后自动消失
  const notice = useProjectStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useProjectStore.getState().setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="app-root">
      <div ref={canvasContainerRef} className="canvas-container" />

      {notice && <div className="toast">{notice}</div>}

      <div className="overlay">
        <div className="title">Lumina — 灯光设计系统</div>
        <div className="info">渲染后端: {backendType.toUpperCase()}</div>
        <div className="info">时间: {timeInfo}</div>
        {degradation && <div className="warning">{degradation}</div>}
        {sunset && <div className="warning">日落时段 — 暖光模拟中</div>}
      </div>

      <aside className={`sidebar sidebar-left${leftOpen ? '' : ' collapsed'}`}>
        <button type="button" className="sidebar-toggle" onClick={() => setLeftOpen((v) => !v)}>
          {leftOpen ? '◀' : '▶'}
        </button>
        {leftOpen && (
          <div className="sidebar-content">
            <ZonePanel />
            <FixturePanel />
          </div>
        )}
      </aside>

      <aside className={`sidebar sidebar-right${rightOpen ? '' : ' collapsed'}`}>
        <button type="button" className="sidebar-toggle" onClick={() => setRightOpen((v) => !v)}>
          {rightOpen ? '▶' : '◀'}
        </button>
        {rightOpen && (
          <div className="sidebar-content">
            <ScenePanel onApplyScene={(key) => controllerRef.current?.applyScene(key)} />
            <IlluminancePanel />
            <RenderPanel
              postProcessing={backendType === 'webgl2'}
              bloom={bloom}
              onBloomChange={handleBloomChange}
              godrays={godrays}
              onGodraysChange={handleGodraysChange}
            />
          </div>
        )}
      </aside>

      <div className="controls">
        <label>
          时间: <input type="time" value={timeValue} step={600} onChange={(e) => handleTimeChange(e.target.value)} />
        </label>
        <label>
          速度:{' '}
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={speed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={shadows} onChange={(e) => handleShadowsChange(e.target.checked)} /> 阴影
        </label>
      </div>

      {!ready && !degradation && <div className="loading">加载中...</div>}
    </div>
  );
}
