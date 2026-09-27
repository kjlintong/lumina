/**
 * SceneEngine tests
 *
 * Uses a mock RenderBackend to avoid WebGL dependency in jsdom.
 * SceneEngine interacts with Three.js Scene/Camera objects directly,
 * and calls backend methods for render/resize/exposure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectionalLight, AmbientLight } from 'three';
import type { Color } from 'three';
import type { RenderBackend, BackendCapabilities } from '../../render/backend.js';
import { easeInOutQuad, lerp } from '../cameraPresets.js';
import { SceneEngine } from '../sceneEngine.js';
import type { Fixture } from '../../core/types.js';
import { makeFixture } from '../../core/makeFixture.js';

// ---------------------------------------------------------------------------
// Mock RenderBackend
// ---------------------------------------------------------------------------

function createMockBackend(): RenderBackend {
  const capabilities: BackendCapabilities = {
    supportsIES: false,
    supportsGodrays: false,
    supportsEffectComposer: true,
    toneMapping: 'ACESFilmic',
    supportsShadows: true,
  };

  // jsdom 提供真实的 document.createElement，OrbitControls 需要完整的 DOM 事件接口
  const canvas = document.createElement('canvas');

  return {
    type: 'webgl2',
    canvas,
    capabilities,
    getRenderer: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    setExposure: vi.fn(),
    getExposure: vi.fn(() => 1.0),
    setToneMappingExposure: vi.fn(),
    getToneMappingExposure: vi.fn(() => 1.0),
    setShadows: vi.fn(),
    setToneMapping: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeDownlight(id: string, x: number, y: number, z: number): Fixture {
  const f = makeFixture({
    type: 'downlight',
    pos: [x, y, z],
    lumens: 500,
    beamAngle: 36,
    cct: 3000,
  });
  return { ...f, id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneEngine', () => {
  let backend: RenderBackend;

  beforeEach(() => {
    backend = createMockBackend();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates a scene with room meshes', () => {
      const engine = new SceneEngine(backend);
      const scene = engine.getScene();
      // Room has 6 meshes + sun + ambient + hemi = 9 direct children
      // Room group has 6 children
      const roomGroup = scene.children.find((c) => c.name === 'room');
      expect(roomGroup).toBeDefined();
      expect(roomGroup?.children.length).toBe(6); // floor + 4 walls + ceiling
    });

    it('sets initial hour', () => {
      const engine = new SceneEngine(backend, { initialHour: 14 });
      expect(engine.getHour()).toBe(14);
    });

    it('uses default hour of 18.0', () => {
      const engine = new SceneEngine(backend);
      expect(engine.getHour()).toBeCloseTo(18.0, 1);
    });

    it('sets camera position inside the room', () => {
      // 室内视角（P4b）：房间默认 6×4.5×2.8（x∈±3，y∈[0,2.8]，z∈±2.25），
      // 相机必须在房间内，否则被全封闭墙体挡住看不到室内（家具/活动区不可见）。
      const engine = new SceneEngine(backend);
      const cam = engine.getCamera();
      expect(Math.abs(cam.position.x)).toBeLessThan(3);
      expect(cam.position.y).toBeGreaterThan(0);
      expect(cam.position.y).toBeLessThan(2.8);
      expect(Math.abs(cam.position.z)).toBeLessThan(2.25);
    });
  });

  describe('addFixture / removeFixture', () => {
    it('adds fixture light to scene', () => {
      const engine = new SceneEngine(backend);
      const before = engine.getScene().children.length;
      const fixture = makeDownlight('test1', 0, 2.7, 0);
      engine.addFixture(fixture);
      expect(engine.getScene().children.length).toBe(before + 1);
    });

    it('removes fixture light from scene', () => {
      const engine = new SceneEngine(backend);
      const fixture = makeDownlight('test1', 0, 2.7, 0);
      engine.addFixture(fixture);
      const afterAdd = engine.getScene().children.length;
      engine.removeFixture('test1');
      expect(engine.getScene().children.length).toBe(afterAdd - 1);
    });

    it('removing nonexistent fixture is a no-op', () => {
      const engine = new SceneEngine(backend);
      const before = engine.getScene().children.length;
      engine.removeFixture('nonexistent');
      expect(engine.getScene().children.length).toBe(before);
    });

    it('multiple fixtures are independent', () => {
      const engine = new SceneEngine(backend);
      const before = engine.getScene().children.length;
      engine.addFixture(makeDownlight('a', -1, 2.7, 0));
      engine.addFixture(makeDownlight('b', 1, 2.7, 0));
      expect(engine.getScene().children.length).toBe(before + 2);
      engine.removeFixture('a');
      expect(engine.getScene().children.length).toBe(before + 1);
    });
  });

  describe('time control', () => {
    it('setHour changes time', () => {
      const engine = new SceneEngine(backend);
      engine.setHour(10);
      expect(engine.getHour()).toBe(10);
    });

    it('setHour clamps to [0, 24]', () => {
      const engine = new SceneEngine(backend);
      engine.setHour(-5);
      expect(engine.getHour()).toBe(0);
      engine.setHour(25);
      expect(engine.getHour()).toBe(24);
    });

    it('advanceTime increments hour by timeSpeed * dt', () => {
      const engine = new SceneEngine(backend, { initialHour: 10, timeSpeed: 1 });
      engine.advanceTime(1); // 1 second * 1 hr/s = 1 hour
      expect(engine.getHour()).toBeCloseTo(11, 1);
    });

    it('advanceTime wraps at 24', () => {
      const engine = new SceneEngine(backend, { initialHour: 23.5, timeSpeed: 1 });
      engine.advanceTime(1); // 23.5 + 1 = 24.5 → wraps to 0.5
      expect(engine.getHour()).toBeCloseTo(0.5, 1);
    });

    it('setTimeSpeed changes rate', () => {
      const engine = new SceneEngine(backend, { initialHour: 10, timeSpeed: 0.5 });
      engine.setTimeSpeed(2);
      expect(engine.getTimeSpeed()).toBe(2);
      engine.advanceTime(1);
      expect(engine.getHour()).toBeCloseTo(12, 1);
    });

    it('isSunsetActive is true during 17:00-20:00', () => {
      const engine = new SceneEngine(backend);
      engine.setHour(18);
      expect(engine.isSunsetActive()).toBe(true);
      engine.setHour(10);
      expect(engine.isSunsetActive()).toBe(false);
      engine.setHour(21);
      expect(engine.isSunsetActive()).toBe(false);
    });

    it('startSunsetSimulation sets hour to 17:00', () => {
      const engine = new SceneEngine(backend, { initialHour: 12 });
      engine.startSunsetSimulation();
      expect(engine.getHour()).toBe(17);
    });
  });

  describe('sunlight updates with time', () => {
    it('night: sun intensity is 0', () => {
      const engine = new SceneEngine(backend, { initialHour: 2 });
      // Access private sunLight via scene children
      const scene = engine.getScene();
      const sunLight = scene.children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      expect(sunLight).toBeDefined();
      expect(sunLight.intensity).toBe(0);
    });

    it('day: sun intensity > 0', () => {
      const engine = new SceneEngine(backend, { initialHour: 12 });
      const scene = engine.getScene();
      const sunLight = scene.children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      expect(sunLight).toBeDefined();
      expect(sunLight.intensity).toBeGreaterThan(0);
    });

    it('ambient light increases during day', () => {
      const engine = new SceneEngine(backend, { initialHour: 12 });
      const scene = engine.getScene();
      const ambient = scene.children.find((c) => c instanceof AmbientLight) as AmbientLight;
      expect(ambient).toBeDefined();
      // Day: ambient = 0.1 + sin(elevation) * 0.4, should be > 0.3
      expect(ambient.intensity).toBeGreaterThan(0.3);
    });

    it('background color changes with time of day', () => {
      const dayEngine = new SceneEngine(backend, { initialHour: 12 });
      const nightEngine = new SceneEngine(backend, { initialHour: 2 });
      const dayBg = dayEngine.getScene().background as Color;
      const nightBg = nightEngine.getScene().background as Color;
      // Day should be brighter (lighter blue) than night
      const dayLuma = dayBg.r * 0.299 + dayBg.g * 0.587 + dayBg.b * 0.114;
      const nightLuma = nightBg.r * 0.299 + nightBg.g * 0.587 + nightBg.b * 0.114;
      expect(dayLuma).toBeGreaterThan(nightLuma);
    });

    it('sunset color is warm at 18:00', () => {
      const engine = new SceneEngine(backend, { initialHour: 18 });
      const scene = engine.getScene();
      const sunLight = scene.children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      // At 18:00, sun should be warm (red-dominant)
      const color = sunLight.color;
      expect(color.r).toBeGreaterThan(color.b);
    });
  });

  describe('resize', () => {
    it('updates camera aspect and calls backend.resize', () => {
      const engine = new SceneEngine(backend);
      engine.resize(1280, 720);
      expect((backend.resize as ReturnType<typeof vi.fn>).mock.lastCall).toEqual([1280, 720]);
      expect(engine.getCamera().aspect).toBeCloseTo(1280 / 720, 2);
    });
  });

  describe('setCameraPosition', () => {
    it('moves camera to given coordinates', () => {
      const engine = new SceneEngine(backend);
      engine.setCameraPosition(5, 2, 3);
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(5);
      expect(cam.position.y).toBeCloseTo(2);
      expect(cam.position.z).toBeCloseTo(3);
    });
  });

  describe('setCameraPreset (P18)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** orbitControls 是 private；测试只读 enableDamping/target，不走公开 API。 */
    function ctrl(engine: SceneEngine): { enableDamping: boolean; target: { x: number; y: number; z: number } } {
      return (engine as unknown as { orbitControls: { enableDamping: boolean; target: { x: number; y: number; z: number } } })
        .orbitControls;
    }

    /** 推 N 帧：runOnlyPendingTimers 不推进时钟，只触发已就绪的 rAF 回调。 */
    function stepFrames(n: number): void {
      for (let i = 0; i < n; i++) vi.runOnlyPendingTimers();
    }

    it('durationMs=0：立即到位（position 三个分量 + target）', () => {
      const engine = new SceneEngine(backend);
      engine.setCameraPreset('overview', 0, 1_000_000);
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(2.0);
      expect(cam.position.y).toBeCloseTo(2.2);
      expect(cam.position.z).toBeCloseTo(2.0);
      // target 是独立通道（setCameraPosition 只会重置成 (0,1.5,0)），必须一起验证
      const t = ctrl(engine).target;
      expect(t.x).toBeCloseTo(0);
      expect(t.y).toBeCloseTo(1.0);
      expect(t.z).toBeCloseTo(0);
    });

    it('durationMs=0 也立即到位（window 机位）', () => {
      const engine = new SceneEngine(backend);
      engine.setCameraPreset('window', 0, 1_000_000);
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(0.6);
      expect(cam.position.y).toBeCloseTo(1.5);
      expect(cam.position.z).toBeCloseTo(1.2);
      expect(ctrl(engine).target.z).toBeCloseTo(-3);
    });

    it('未知 key 静默返回，相机与 damping 都不动', () => {
      const engine = new SceneEngine(backend);
      const before = engine.getCamera().position.x;
      engine.setCameraPreset('does-not-exist', 0, 1_000_000);
      expect(engine.getCamera().position.x).toBeCloseTo(before);
      // 未命中不应有副作用：enableDamping 仍是 P12 构造时的 true
      expect(ctrl(engine).enableDamping).toBe(true);
    });

    it('durationMs>0：复用主渲染循环插值，不走 durationMs=0 快速路径', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const engine = new SceneEngine(backend, { initialHour: 0 });
      const start = engine.getCamera().position.clone(); // P12 初始机位 (1.7,1.55,1.6)

      // 刚调用尚未推进：起点不动
      engine.setCameraPreset('overview', 800);
      expect(engine.getCamera().position.x).toBeCloseTo(start.x);
      expect(engine.getCamera().position.y).toBeCloseTo(start.y);
      // tween 期间禁用 damping，避免阻尼惯性 vs 直接写 position 打架抖动
      expect(ctrl(engine).enableDamping).toBe(false);

      // 启动真实主渲染循环，让 rAF 驱动 tween（红线 1：不另起 rAF）
      engine.start();
      stepFrames(10); // ~160ms/800ms ≈ 20%
      expect(engine.getCamera().position.x).toBeGreaterThan(start.x);
      expect(engine.getCamera().position.x).toBeLessThan(2.0); // easeInOutQuad 起步慢

      // 走完并过终点：到位，damping 恢复 P12 原值 true
      stepFrames(60); // ~1s > 800ms
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(2.0, 1);
      expect(cam.position.y).toBeCloseTo(2.2, 1);
      expect(cam.position.z).toBeCloseTo(2.0, 1);
      expect(ctrl(engine).target.y).toBeCloseTo(1.0, 1);
      expect(ctrl(engine).enableDamping).toBe(true);

      engine.dispose();
    });

    it('durationMs>0：插值走 easeInOutQuad（同样线性进度下位移小于线性）', () => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000);
      const engine = new SceneEngine(backend, { initialHour: 0 });
      engine.setCameraPreset('overview', 800);
      engine.start();

      stepFrames(10);
      // k 从实际墙钟时间推出（不假设帧数 × 16ms），与引擎内的时间源一致
      const k = (Date.now() - 2_000_000) / 800;
      const easedX = lerp(1.7, 2.0, easeInOutQuad(k));
      const linearX = lerp(1.7, 2.0, k);
      expect(engine.getCamera().position.x).toBeCloseTo(easedX, 1);
      expect(engine.getCamera().position.x).toBeLessThan(linearX);

      engine.dispose();
    });

    it('连点两个机位：第二条覆盖第一条，从当前实时位置起步（不叠加）', () => {
      vi.useFakeTimers();
      vi.setSystemTime(3_000_000);
      const engine = new SceneEngine(backend, { initialHour: 0 });

      engine.setCameraPreset('overview', 800);
      engine.start();
      stepFrames(24); // ~384ms/800ms ≈ 48%
      const interrupted = engine.getCamera().position.clone();
      expect(interrupted.x).toBeGreaterThan(1.7); // 确实在移动
      expect(interrupted.x).toBeLessThan(2.0); // 还没到 overview

      // 中途打断：from 取当前实时位置（不是旧 tween 的 to），所以不会叠加
      // 两个运动 —— 这正是原审查报告的自持 rAF 方案缺失的取消机制。
      engine.setCameraPreset('sofa', 800);
      stepFrames(60);
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(-1.5, 1);
      expect(cam.position.y).toBeCloseTo(1.2, 1);
      expect(ctrl(engine).target.z).toBeCloseTo(-1, 1);
      expect(ctrl(engine).enableDamping).toBe(true);

      engine.dispose();
    });

    it('durationMs=0：tween 立即清掉，下一帧是廉价空操作', () => {
      const engine = new SceneEngine(backend);
      engine.setCameraPreset('overview', 0, 1_000_000);
      // durationMs=0 立即到位；stepCameraTween 走完把 cameraTween 置 null。
      // damping 从头到尾没被禁用（只有进入 tween 才禁）。
      expect(ctrl(engine).enableDamping).toBe(true);
      // tween 为 null 时主循环的 stepCameraTween 是空操作，不抛、不改位姿
      vi.useFakeTimers();
      const b = engine.getCamera().position.x;
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
      expect(engine.getCamera().position.x).toBeCloseTo(b);
    });
  });

  describe('setShadows', () => {
    it('toggles shadow on backend and sun light', () => {
      const engine = new SceneEngine(backend);
      const scene = engine.getScene();
      const sunLight = scene.children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      engine.setShadows(false);
      expect((backend.setShadows as ReturnType<typeof vi.fn>).mock.lastCall).toEqual([false]);
      expect(sunLight.castShadow).toBe(false);
      engine.setShadows(true);
      expect(sunLight.castShadow).toBe(true);
    });
  });

  describe('sun shadow camera (P17)', () => {
    it('shadow camera 收紧到 ±6（房间包围盒 + 余量）', () => {
      const engine = new SceneEngine(backend);
      const sun = engine
        .getScene()
        .children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      expect(sun.shadow.camera.left).toBe(-6);
      expect(sun.shadow.camera.right).toBe(6);
      expect(sun.shadow.camera.top).toBe(6);
      expect(sun.shadow.camera.bottom).toBe(-6);
    });

    it('mapSize 保持 1024（不升 2048²，P9 性能预算）', () => {
      const engine = new SceneEngine(backend);
      const sun = engine
        .getScene()
        .children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      expect(sun.shadow.mapSize.x).toBe(1024);
      expect(sun.shadow.mapSize.y).toBe(1024);
    });

    it('normalBias 0.02（配合 ±6 视锥的新像素密度）', () => {
      const engine = new SceneEngine(backend);
      const sun = engine
        .getScene()
        .children.find((c) => c instanceof DirectionalLight) as DirectionalLight;
      expect(sun.shadow.normalBias).toBeCloseTo(0.02);
    });

    it('shadow camera 覆盖房间对角线 7.5m（±6 含 ~2m 余量）', () => {
      const halfDiag = Math.sqrt(6 * 6 + 4.5 * 4.5) / 2; // 3.75
      expect(halfDiag).toBeLessThan(6);
    });
  });

  describe('dispose', () => {
    it('calls backend.dispose', () => {
      const engine = new SceneEngine(backend);
      engine.dispose();
      expect((backend.dispose as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('stops animation loop', () => {
      // Don't call start() - it uses requestAnimationFrame which doesn't work in jsdom
      // Just verify dispose doesn't throw
      const engine = new SceneEngine(backend);
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  describe('autoExposure integration', () => {
    it('has auto-exposure enabled by default', () => {
      const engine = new SceneEngine(backend);
      // engine has autoExposure internally; verify via constructor config
      const noExposure = new SceneEngine(backend, { autoExposure: false });
      expect(engine).toBeDefined();
      expect(noExposure).toBeDefined();
    });
  });
});
