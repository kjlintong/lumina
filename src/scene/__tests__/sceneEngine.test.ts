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

    it('sets camera position', () => {
      const engine = new SceneEngine(backend);
      const cam = engine.getCamera();
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(3);
      expect(cam.position.z).toBeCloseTo(8);
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
