// TEMP-DEBUG (P9 视觉迭代): 供浏览器控制台驱动引擎做实测与截图对比。
// 由 main.tsx `import './dev-debug.ts'` 注入；App.tsx 把 {engine, backend}
// 挂到 window.__luminaReady 后本模块的 wait() 才会 resolve。
// P9 完成后连同 main.tsx 的 import 行一并删除本文件。

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useProjectStore } from './store/projectStore.js';

/**
 * P26a：性能账单探针 `__lumina.perfBill()`。
 *
 * 用法：访问 `/?debug`，在浏览器 console 里
 *   `__lumina.perfBill().then(console.table)`
 * 产出 7 行账单表（baseline + 6 个开关组合：shadows / godrays / bloom），
 * 每行记录中位数 FPS、draw calls、三角面。真实 GPU 上运行才有意义，
 * 单元测试与 jsdom 里不测。
 */
interface PerfBillCell {
  label: string;
  medianFps: number;
  drawCalls: number;
  triangles: number;
}
interface PerfBillResult {
  gpu: string;
  cells: PerfBillCell[];
  hour: number;
  toneMappingExposure: number;
}

/** 探测底层 GPU 型号（WEBGL_debug_renderer_info） */
function detectGPU(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '(no webgl)';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '(unknown)') : '(unknown)';
  } catch {
    return '(unknown)';
  }
}

declare global {
  interface Window {
    __luminaReady?: { engine: any; backend: any };
    __lumina?: any;
  }
}

const ready = (): { engine: any; backend: any } | undefined =>
  window.__luminaReady;

const V3Ctor = (engine: any) => engine.getCamera().position.constructor;

const project = (engine: any, sun: any) => {
  const cam = engine.getCamera();
  return new (V3Ctor(engine)) (sun.x, sun.y, sun.z).project(cam);
};

window.__lumina = {
  get ready() {
    return !!window.__luminaReady;
  },

  wait(maxMs = 20000): Promise<boolean> {
    const start = Date.now();
    return new Promise((res) => {
      const tick = () => {
        if (window.__luminaReady) return res(true);
        if (Date.now() - start > maxMs) return res(false);
        setTimeout(tick, 80);
      };
      tick();
    });
  },

  setHour(h: number): number {
    const e = ready()?.engine;
    if (!e) return -1;
    e.setHour(h);
    return e.getHour();
  },

  setTimeSpeed(v: number): number {
    const e = ready()?.engine;
    if (!e) return -1;
    e.setTimeSpeed(v);
    return e.getTimeSpeed();
  },

  /** 阴影开关实测：直接改 renderer.shadowMap.enabled */
  toggleShadows(on: boolean): boolean {
    const R = ready()?.backend.getRenderer();
    if (!R) return false;
    R.shadowMap.enabled = on;
    R.shadowMap.needsUpdate = true;
    return R.shadowMap.enabled;
  },

  /** 强制渲染一帧（绕过 rAF，同步拿 draw call / 阴影图状态） */
  forceRender() {
    const r = ready();
    if (!r) return null;
    const R = r.backend.getRenderer();
    const before = { calls: R.info.render.calls, triangles: R.info.render.triangles };
    r.engine.renderOnce();
    return {
      before,
      after: { calls: R.info.render.calls, triangles: R.info.render.triangles },
    };
  },

  /** 只留太阳、关掉全部室内灯具，隔离验证阴影是否真的在画 */
  sunOnly(intensity = 8, keepShadows = true): { sun: boolean; disabled: number } {
    const r = ready();
    if (!r) return { sun: false, disabled: 0 };
    let sun: any = null;
    let n = 0;
    r.engine.getScene().traverse((o: any) => {
      if (!o?.isLight) return;
      if (o.isDirectionalLight) {
        sun = o;
      } else if (o.type !== 'AmbientLight' && o.type !== 'HemisphereLight') {
        o.visible = false;
        n++;
      }
    });
    if (sun) {
      sun.intensity = intensity;
      sun.color.set('#ffc090');
      sun.castShadow = keepShadows;
      if (sun.shadow) {
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.04;
        sun.shadow.camera.updateProjectionMatrix();
      }
    }
    return { sun: !!sun, disabled: n };
  },

  /** 从 store 重建全部灯具，恢复 sunOnly 的关闭状态 */
  restoreFixtures(): number {
    const r = ready();
    if (!r) return 0;
    const st = useProjectStore.getState();
    for (const f of Object.values(st.project.fixtures)) r.engine.updateFixture(f);
    return Object.keys(st.project.fixtures).length;
  },

  /** 抓真实引擎状态（数值，不是 vision 猜测） */
  stats(): any {
    const r = ready();
    if (!r) return { ready: false };
    const { engine: e, backend: b } = r;
    const R = b.getRenderer();
    const sun = e.getSunPosition();
    const ndc = project(e, sun);
    const lights: any[] = [];
    let cs = 0;
    e.getScene().traverse((o: any) => {
      if (!o?.isLight) return;
      if (o.castShadow) cs++;
      const sh = o.shadow;
      lights.push({
        type: o.type,
        intensity: +(o.intensity || 0).toFixed(3),
        castShadow: !!o.castShadow,
        visible: o.visible,
        hasMap: !!(sh && sh.map),
        mapSize: sh && sh.map
          ? [sh.map.width, sh.map.height]
          : sh && sh.mapSize
            ? [sh.mapSize.x, sh.mapSize.y]
            : null,
        bias: sh ? sh.bias : null,
        normalBias: sh ? sh.normalBias : null,
        targetInScene: o.target
          ? e.getScene().getObjectByProperty('uuid', o.target.uuid) !== undefined
          : null,
      });
    });
    return {
      hour: e.getHour(),
      timeSpeed: e.getTimeSpeed(),
      sunPos: { x: +sun.x.toFixed(2), y: +sun.y.toFixed(2), z: +sun.z.toFixed(2) },
      sunNDC: { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3), z: +ndc.z.toFixed(3) },
      sunUV: { x: +((ndc.x + 1) / 2).toFixed(3), y: +((ndc.y + 1) / 2).toFixed(3) },
      toneMapping: R.toneMapping,
      toneMappingExposure: R.toneMappingExposure,
      exposure: b.getExposure(),
      avgLum: b.getAverageLuminance ? +b.getAverageLuminance().toFixed(5) : null,
      bloom: b.getBloom(),
      godrays: b.getGodrays(),
      godraysLightPos: b.getGodraysLightPosition(),
      shadowMapEnabled: R.shadowMap.enabled,
      shadowMapAutoUpdate: R.shadowMap.autoUpdate,
      castShadowLights: cs,
      lights,
      renderStats: e.getRenderStats ? e.getRenderStats() : null,
      renderInfo: {
        calls: R.info.render.calls,
        triangles: R.info.render.triangles,
        textures: R.info.memory.textures,
      },
      fpsHud:
        (document.body.innerText.match(/帧\/秒\s*\n\s*(\d+)/) || [])[1] || null,
    };
  },

  /** 遍历 scene，按 name 找对象并报告关键材质属性 */
  find(names: string[]): any {
    const r = ready();
    if (!r) return {};
    const out: any = {};
    for (const n of names) {
      let f: any = null;
      r.engine.getScene().traverse((o: any) => {
        if (!f && o.name === n) f = o;
      });
      if (!f) {
        out[n] = 'not-found';
        continue;
      }
      const mats: any[] = Array.isArray(f.material)
        ? f.material
        : f.material
          ? [f.material]
          : [];
      out[n] = {
        visible: f.visible,
        pos: f.position
          ? { x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2) }
          : null,
        children: f.children ? f.children.length : 0,
        materials: mats.map((m: any) => ({
          type: m.type,
          opacity: typeof m.opacity === 'number' ? +m.opacity.toFixed(4) : null,
          color: m.color ? '#' + m.color.getHexString() : null,
          toneMapped: m.toneMapped,
        })),
      };
    }
    return out;
  },

  /**
   * 性能账单（P26a）：一次性跑 7 个开关组合（baseline + shadows / godrays / bloom 的
   * 6 个 on/off 变体），每个组合稳定 60 帧取中位数 FPS，附加当前 draw calls / 三角面。
   * 用法：`__lumina.perfBill().then(console.table)`。
   *
   * 注意：真实 GPU 上才有意义；jsdom / mock 环境下 engine.getRenderStats 返回 0。
   */
  perfBill(): Promise<PerfBillResult> {
    return (async () => {
      const r = ready();
      if (!r) return { gpu: '(engine not ready)', cells: [], hour: 0, toneMappingExposure: 0 };
      const engine = r.engine;
      const backend = r.backend;
      const R = backend.getRenderer();
      const gpu = detectGPU();
      const cells: PerfBillCell[] = [];
      const matrix: Array<{ label: string; apply: () => void }> = [
        { label: 'baseline', apply: () => {} },
        { label: 'shadows off', apply: () => { R.shadowMap.enabled = false; } },
        { label: 'shadows on', apply: () => { R.shadowMap.enabled = true; } },
        { label: 'godrays off', apply: () => { backend.setGodrays?.({ enabled: false }); } },
        { label: 'godrays on', apply: () => { backend.setGodrays?.({ enabled: true, weight: 1.0, density: 1.0, decay: 0.9, screenRadius: 0.35, sampleCount: 24 }); } },
        { label: 'bloom off', apply: () => { backend.setBloom?.(0, 0, 1); } },
        { label: 'bloom on', apply: () => { backend.setBloom?.(0.22, 0.3, 0.85); } },
      ];
      for (const { label, apply } of matrix) {
        apply();
        const fpsSamples: number[] = [];
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => requestAnimationFrame(res));
          fpsSamples.push(engine.getRenderStats().fps);
        }
        fpsSamples.sort((a, b) => a - b);
        const median = fpsSamples[Math.floor(fpsSamples.length / 2)] ?? 0;
        cells.push({
          label,
          medianFps: +median.toFixed(1),
          drawCalls: R.info.render.calls,
          triangles: R.info.render.triangles,
        });
      }
      return { gpu, cells, hour: engine.getHour(), toneMappingExposure: R.toneMappingExposure };
    })();
  },
};

export {};
