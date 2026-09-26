/**
 * 场景引擎（P1 渲染层）
 *
 * 将 backend.ts、room.ts、lightBuilder.ts、solar.ts、autoExposure.ts
 * 组装成一个可运行的渲染管线。
 *
 * 职责：
 * - 场景图构建（房间 + 灯具 + 太阳）
 * - 每帧更新（时间推进、太阳位置、曝光）
 * - 日落模拟（17:00→20:00）
 * - 渲染循环
 *
 * 架构依据：工程方案 §5.4（自动曝光）、§5.2（配光双轨）
 */

import type {
  Light,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ActivityZone, Fixture } from '../core/types.js';
import type { RenderBackend } from '../render/backend.js';
import { buildActivityZone } from '../render/activityZone.js';
import { buildFurniture } from '../render/furniture.js';
import { buildLightFromFixture, cctToRGB } from '../render/lightBuilder.js';
import { buildRoom } from '../render/room.js';
import { buildSkyScene, setSkyBackdropColors, skyColors } from '../render/sky.js';
import { AutoExposure } from '../render/autoExposure.js';
import { solarColor, solarPosition } from './solar.js';

/** 场景引擎配置 */
export interface SceneEngineConfig {
  /** 房间尺寸 */
  roomWidth?: number;
  roomDepth?: number;
  roomHeight?: number;
  /** 初始时间（小时，0-24） */
  initialHour?: number;
  /** 纬度（弧度） */
  latitude?: number;
  /** 一年中的第几天 */
  dayOfYear?: number;
  /** 是否启用自动曝光 */
  autoExposure?: boolean;
  /**
   * 时间推进速度（小时/秒）。**默认 0（时间冻结）** —— P8a 根因 A：
   * 旧默认 0.5 h/s 让页面挂几分钟就跑到后半夜、画面变黑。
   * 现在默认停在初始时刻，仅当用户拖动速度滑杆时才流逝。
   */
  timeSpeed?: number;
}

/** 日落时间配置（17:00 → 20:00） */
const SUNSET_START = 17.0;
const SUNSET_END = 20.0;

/** 太阳平行光距离（米）。限制在窗外 12–20m 区间（取景调整，见 updateSunPosition） */
const SUN_DIST = 15;
/** 窗外太阳圆盘的视觉距离（米），比平行光更远以免遮挡窗框 */
const SKY_SUN_DIST = 24;

/** 单盏灯在场景图中的登记项 */
interface FixtureLightEntry {
  /** 场景图根节点（光源 + 灯罩 Mesh） */
  object: Object3D;
  /** 物理光源（buildLightFromFixture 总能构建，但类型上允许缺省） */
  light: Light | undefined;
  /** 未调光时的原始强度（buildLightFromFixture 返回的 light.intensity） */
  baseIntensity: number;
  /** 配光是否为近似值（UI 标注用） */
  approximated: boolean;
}

/** 亮度截断到 [0, 1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 场景引擎：管理 Three.js 场景图、光源、太阳、曝光。
 */
export class SceneEngine {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private backend: RenderBackend;
  private autoExposure: AutoExposure | null;

  private sunLight: DirectionalLight;
  private ambientLight: AmbientLight;
  private hemiLight: HemisphereLight;

  private timeHour: number;
  private latitude: number;
  private dayOfYear: number;
  private timeSpeed: number;

  private fixtureLights = new Map<string, FixtureLightEntry>();

  /**
   * 活动区可视化 + 家具在场景图中的登记（zone.key -> wrapper Group）。
   * wrapper 名为 `zone:${key}`，含两个子 group：buildActivityZone 的半透明
   * 工作面包 + buildFurniture 的家具。名字带 `zone:` 前缀，不会与灯具 id
   * 冲突，App 的 findFixtureId 不会把区/家具误当灯具拾取。
   */
  private zoneObjects = new Map<string, Group>();

  /**
   * 每盏灯当前应用的亮度级别（0..1，1 = 全亮）。
   * 与 `Fixture.control.sceneLevels` 的区别：这里是**渲染实况**（动画中逐帧变化），
   * sceneLevels 是**数据模型**（场景目标，applyScene 时一次性落盘）。
   */
  private fixtureLevels = new Map<string, number>();

  /**
   * 当前激活的场景 key（由 sceneController / App 在场景切换时同步过来）。
   * addFixture / updateFixture 重建光源后，优先按 `control.sceneLevels[activeSceneKey]`
   * 恢复亮度，避免重建把灯重置成全亮（规格 缺口 2）。
   */
  private activeSceneKey: string | null = null;

  private animationId: number | null = null;
  private lastTime = 0;
  private orbitControls: OrbitControls;

  /** 复用的背景色实例（每帧 setRGB 就地更新，避免每帧 new Color 的 GC 压力） */
  private bgColor = new Color();

  /** PMREM 环境贴图生成器与产物（仅 WebGL2；dispose 时清理） */
  private pmrem: PMREMGenerator | null = null;
  private envRenderTarget: WebGLRenderTarget | null = null;

  /** 窗外太阳圆盘（视觉锚点）与其材质；构造时由 buildSkyScene 给出 */
  private skySun: Mesh | null = null;
  private skySunMat: MeshBasicMaterial | null = null;
  /** 天空背板；构造时由 buildSkyScene 给出 */
  private skyBackdrop: Mesh | null = null;
  /** 窗中心世界坐标（sky-scene 组原点） */
  private skyOrigin = new Vector3();

  /** 复用临时向量（每帧太阳圆盘定位，避免每帧 new Vector3） */
  private _skyTmp = new Vector3();

  /**
   * 每帧回调（渲染循环内、render 之前调用）。App 用它把 sceneController.tick
   * 挂进引擎循环，驱动场景过渡动画，避免再起一个 rAF。
   */
  private frameCallback: ((timeMs: number) => void) | null = null;

  constructor(backend: RenderBackend, config: SceneEngineConfig = {}) {
    this.backend = backend;
    this.timeHour = config.initialHour ?? 18.0;
    this.latitude = config.latitude ?? (39.9 * Math.PI) / 180; // 北京
    this.dayOfYear = config.dayOfYear ?? 180; // 夏至
    // P8a 根因 A：默认 0（时间冻结）。旧的 0.5 h/s 让画面在页面挂几分钟后
    // 自动跑进深夜变黑。现在停在初始时刻，仅当用户拖速度滑杆才流逝。
    this.timeSpeed = config.timeSpeed ?? 0;

    this.scene = new Scene();
    // 背景色复用同一 Color 实例（bgColor），由 updateSunPosition 按天空渐变就地更新。
    this.scene.background = this.bgColor;

    // 相机初始在房间**内部**：这是室内灯光设计工具，用户以室内视角看灯效。
    // 房间默认 6×4.5×2.8（中心在原点，x∈±3，z∈±2.25），相机放东南角附近
    // 望向房间中心，两个初始活动区（休闲/用餐）都在视野内。
    // 注意：墙是 BoxGeometry 全封闭体积，相机若在房间外会被墙挡住看不到内部。
    this.camera = new PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(2.5, 1.8, 1.9);

    // 轨道控制器：鼠标拖拽旋转、滚轮缩放、右键平移
    this.orbitControls = new OrbitControls(this.camera, backend.canvas);
    this.orbitControls.target.set(0, 0.8, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.maxDistance = 20;
    this.orbitControls.minDistance = 1;
    this.orbitControls.maxPolarAngle = Math.PI * 0.85;

    // 光照
    this.sunLight = new DirectionalLight(0xffffff, 1);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 50;
    this.sunLight.shadow.camera.left = -10;
    this.sunLight.shadow.camera.right = 10;
    this.sunLight.shadow.camera.top = 10;
    this.sunLight.shadow.camera.bottom = -10;
    this.scene.add(this.sunLight);

    this.ambientLight = new AmbientLight(0x404040, 0.3);
    this.scene.add(this.ambientLight);

    this.hemiLight = new HemisphereLight(0x87ceeb, 0x362d1e, 0.2);
    this.scene.add(this.hemiLight);

    // 自动曝光
    if (config.autoExposure !== false) {
      this.autoExposure = new AutoExposure({
        sampleInterval: 18,
        targetLuminance: 0.17,
        speed: 0.03,
      });
      // 只有后端实现了像素采样（WebGL2）才接入采样器。
      // WebGPU 后端不实现 getAverageLuminance（异步 render + buffer 回读
      // 与同步调用模型冲突），此阶段曝光恒 1.0，后续单独接入。
      // 无采样器时 AutoExposure.update() 自然走固定曝光路径，不会空转。
      if (typeof this.backend.getAverageLuminance === 'function') {
        this.autoExposure.setSampler({
          getAverageLuminance: () => this.backend.getAverageLuminance?.() ?? 0,
        });
      }
    } else {
      this.autoExposure = null;
    }

    // 构建房间（P8a：北墙改落地窗，让夕阳从窗外打入在地板留光斑）
    const roomWidth = config.roomWidth ?? 6;
    const roomDepth = config.roomDepth ?? 4.5;
    const roomHeight = config.roomHeight ?? 2.8;
    const { group, windows } = buildRoom(roomWidth, roomDepth, roomHeight, { withWindow: true });
    this.scene.add(group);

    // 室外远景（太阳圆盘 + 远山/城市剪影）放在落地窗外。
    // 窗中心直接取玻璃 mesh 的位置（房间组在原点，局部坐标即世界坐标），
    // 外法线朝北 (0,0,-1)。sky-scene 不参与阴影、不受光照，始终可见。
    const glass = windows[0];
    if (glass) this.skyOrigin.copy(glass.position);
    const sky = buildSkyScene(this.skyOrigin, new Vector3(0, 0, -1));
    this.skySun = sky.sun;
    this.skySunMat = sky.sun.material as MeshBasicMaterial;
    this.skyBackdrop = sky.backdrop;
    this.scene.add(sky.group);

    // 环境反射（P8a 根因 C）：RoomEnvironment PMREM 让 PBR 材质「活起来」。
    // 仅 WebGL2 路径生成；WebGPU / 测试 mock 安全跳过（见 initEnvironment）。
    this.initEnvironment();

    // 初始更新太阳
    this.updateSunPosition();
  }

  /**
   * 生成 RoomEnvironment PMREM 环境贴图并赋给 scene.environment。
   *
   * PMREMGenerator 依赖 WebGL 内部 API（CubeUV render target / shader），
   * 仅 WebGL2 后端可用；WebGPU 后端跳过（保留 ambient/hemi 兜底）。
   * 红线：业务层不直接 new WebGLRenderer，经 backend.getRenderer() 转型。
   * 测试 mock 的 getRenderer 返回 undefined，同样安全跳过。
   */
  private initEnvironment(): void {
    if (this.backend.type !== 'webgl2') return;
    const renderer = this.backend.getRenderer() as WebGLRenderer;
    if (!renderer || typeof renderer.getRenderTarget !== 'function') return;
    try {
      const pmrem = new PMREMGenerator(renderer);
      this.pmrem = pmrem;
      const rt = pmrem.fromScene(new RoomEnvironment(), 0);
      this.envRenderTarget = rt;
      // 只赋 environment（提供环境反射），**不**赋 background ——
      // 背景仍由 skyColors 渐变负责，否则会变成灰白房间外壳。
      this.scene.environment = rt.texture;
    } catch {
      // headless / 无 WebGL 上下文等极端环境：跳过环境贴图，不致命
    }
  }

  /** 添加灯具到场景；已存在时等价 updateFixture（重建） */
  addFixture(fixture: Fixture): void {
    if (this.fixtureLights.has(fixture.id)) {
      this.updateFixture(fixture);
      return;
    }
    const { object, light, approximated } = buildLightFromFixture(fixture);
    this.scene.add(object);
    const baseIntensity = light ? light.intensity : 0;
    this.fixtureLights.set(fixture.id, { object, light, baseIntensity, approximated });
    // 应用当前亮度级别：优先该灯在当前场景下的 sceneLevels，默认全亮
    const level = this.resolveLevel(fixture);
    this.fixtureLevels.set(fixture.id, level);
    if (light) light.intensity = baseIntensity * level;
  }

  /** 移除灯具 */
  removeFixture(fixtureId: string): void {
    const entry = this.fixtureLights.get(fixtureId);
    if (entry) {
      this.scene.remove(entry.object);
      this.fixtureLights.delete(fixtureId);
      this.fixtureLevels.delete(fixtureId);
    }
  }

  // ---------------------------------------------------------------------------
  // 活动区可视化 + 家具（P4）
  // ---------------------------------------------------------------------------

  /** 添加活动区（可视化 + 家具）到场景；已存在时等价 updateZone（重建） */
  addZone(zone: ActivityZone, selected = false): void {
    if (this.zoneObjects.has(zone.key)) {
      this.updateZone(zone, selected);
      return;
    }
    const group = new Group();
    group.name = `zone:${zone.key}`;
    group.add(buildActivityZone(zone, selected));
    group.add(buildFurniture(zone));
    this.scene.add(group);
    this.zoneObjects.set(zone.key, group);
  }

  /** 移除活动区（可视化与家具一并移除） */
  removeZone(zoneKey: string): void {
    const group = this.zoneObjects.get(zoneKey);
    if (group) {
      this.scene.remove(group);
      this.zoneObjects.delete(zoneKey);
    }
  }

  /**
   * 更新活动区：移除旧 group、按最新 ActivityZone 重建并加回场景。
   * 重建比原地改属性简单可靠（pos/size/rotY/planeH/type/selected 都可能变）。
   * 不存在时等价 addZone。
   */
  updateZone(zone: ActivityZone, selected = false): void {
    if (!this.zoneObjects.has(zone.key)) {
      this.addZone(zone, selected);
      return;
    }
    this.removeZone(zone.key);
    this.addZone(zone, selected);
  }

  /**
   * 更新灯具：移除旧 object、按最新 Fixture 重建并加回场景。
   *
   * 重建比原地改属性简单可靠（类型/姿态/配光都可能变）。重建后必须
   * 重记 baseIntensity，并**重新应用当前 level**——否则重建会把亮度
   * 重置成全亮，场景切换后的调光状态就丢了（规格 缺口 2）。
   * 不存在时等价 addFixture。
   */
  updateFixture(fixture: Fixture): void {
    const existing = this.fixtureLights.get(fixture.id);
    if (!existing) {
      this.addFixture(fixture);
      return;
    }
    this.scene.remove(existing.object);
    const { object, light, approximated } = buildLightFromFixture(fixture);
    this.scene.add(object);
    const baseIntensity = light ? light.intensity : 0;
    this.fixtureLights.set(fixture.id, { object, light, baseIntensity, approximated });
    // resolveLevel 优先读 sceneLevels[activeSceneKey]，否则保留重建前的 level
    const level = this.resolveLevel(fixture);
    this.fixtureLevels.set(fixture.id, level);
    if (light) light.intensity = baseIntensity * level;
  }

  /**
   * 设置灯具亮度级别：`light.intensity = baseIntensity * clamp(level, 0, 1)`。
   * 只调强度，不重建光源——场景过渡动画每帧走这里。
   */
  setFixtureLevel(fixtureId: string, level: number): void {
    const clamped = clamp01(level);
    this.fixtureLevels.set(fixtureId, clamped);
    const entry = this.fixtureLights.get(fixtureId);
    if (entry?.light) {
      entry.light.intensity = entry.baseIntensity * clamped;
    }
  }

  /** 查询灯具当前亮度级别（过渡动画用它作为 from 端点）；未登记返回 undefined */
  getFixtureLevel(fixtureId: string): number | undefined {
    return this.fixtureLevels.get(fixtureId);
  }

  /**
   * 设置灯具色温（K）：直接改 light.color（cctToRGB），不重建光源。
   * 场景过渡期间每帧调用，比重建高效得多。
   */
  setFixtureCct(fixtureId: string, kelvin: number): void {
    const entry = this.fixtureLights.get(fixtureId);
    if (!entry?.light) return;
    const { r, g, b } = cctToRGB(kelvin);
    entry.light.color.setRGB(r, g, b);
  }

  /** 同步当前激活场景 key（影响 addFixture / updateFixture 的亮度恢复） */
  setActiveScene(sceneKey: string | null): void {
    this.activeSceneKey = sceneKey;
  }

  /**
   * 注册每帧回调（渲染循环内、render 之前调用）；传 null 解除。
   * 回调参数是 rAF 时间戳；场景过渡等需要墙钟时间的逻辑应自行取 Date.now()。
   */
  setFrameCallback(cb: ((timeMs: number) => void) | null): void {
    this.frameCallback = cb;
  }

  /**
   * 解析灯具当前应有的亮度级别：
   * 若该灯的 `control.sceneLevels[activeSceneKey]` 有值则用之（场景目标），
   * 否则沿用引擎已记录的 level，默认全亮（1）。
   */
  private resolveLevel(fixture: Fixture): number {
    const key = this.activeSceneKey;
    if (key !== null) {
      const v = fixture.control.sceneLevels[key];
      if (typeof v === 'number') return clamp01(v);
    }
    return this.fixtureLevels.get(fixture.id) ?? 1;
  }

  /** 更新太阳位置（根据当前时间） */
  private updateSunPosition(): void {
    const declination = 23.45 * (Math.PI / 180) * Math.sin(((2 * Math.PI) / 365) * (this.dayOfYear - 81));
    const pos = solarPosition(this.timeHour, this.latitude, declination);
    const { elevation, azimuth, belowHorizon } = pos;

    // ---- 太阳平行光位置（P8a 取景调整）----
    // solarPosition() 天文公式不变；这里只调整最终取景位置：
    // 落地窗在北墙（z = -depth/2）。为让夕阳从窗外打入、在地板留下光斑与
    // 窗框阴影，把太阳翻到北侧（z<0）并保证足够的北向分量穿透窗洞
    // （≥0.45，否则光只掠过墙面、进不了房间），距离限制在窗外 SUN_DIST(15m)。
    const px = Math.cos(elevation) * Math.sin(azimuth);
    const py = Math.sin(elevation);
    const pz = -Math.max(Math.abs(Math.cos(elevation) * Math.cos(azimuth)), 0.45);
    const len = Math.hypot(px, py, pz) || 1;
    const sunX = (px / len) * SUN_DIST;
    const sunY = (py / len) * SUN_DIST;
    const sunZ = (pz / len) * SUN_DIST;
    this.sunLight.position.set(sunX, sunY, sunZ);

    const sinEl = Math.sin(elevation);
    if (belowHorizon) {
      this.sunLight.intensity = 0;
      this.sunLight.color.setRGB(0, 0, 0);
    } else {
      // 日落前后（elevation∈(0,π/12)）用 pow(...,0.7) 让暖光贴近地平线仍有
      // 可见强度，避免线性 sin 在该区间断崖归零。
      this.sunLight.intensity = Math.pow(Math.max(0, sinEl), 0.7) * 3.0;
      const { r, g, b } = solarColor(elevation);
      this.sunLight.color.setRGB(r, g, b);
    }

    // ---- 环境光 / 半球光强度：白天拉高、夜晚压低但不归零 ----
    // （归零会被 ACES 压成纯黑；保留 ~0.04–0.05 让夜间仅靠灯具也有可读画面）
    const dayFactor = Math.max(0, sinEl);
    this.ambientLight.intensity = 0.04 + dayFactor * 0.55;
    this.hemiLight.intensity = 0.05 + dayFactor * 0.35;

    // ---- 背景 + 半球光颜色：随太阳高度角平滑渐变（P8a 根因 B/C）----
    // 复用 bgColor 实例、就地 setRGB，不每帧 new Color。SRGBColorSpace 让
    // skyColors 的 sRGB 关键帧正确转入线性工作空间。
    const c = skyColors(elevation);
    this.bgColor.setRGB(c.background.r, c.background.g, c.background.b, SRGBColorSpace);
    this.scene.background = this.bgColor;
    this.hemiLight.color.setRGB(c.ambientSky.r, c.ambientSky.g, c.ambientSky.b, SRGBColorSpace);
    this.hemiLight.groundColor.setRGB(
      c.ambientGround.r,
      c.ambientGround.g,
      c.ambientGround.b,
      SRGBColorSpace,
    );

    // ---- 窗外太阳圆盘：沿取景后的太阳方向放到窗外远处，作 bloom / 体积光的视觉锚点 ----
    if (this.skySun && this.skySunMat) {
      this.skySun.visible = !belowHorizon;
      const sd = this._skyTmp.set(sunX, sunY, sunZ).normalize().multiplyScalar(SKY_SUN_DIST);
      // sky-scene 组无旋转（仅平移到 skyOrigin），局部坐标 = 世界方向 - 组原点
      this.skySun.position.set(
        sd.x - this.skyOrigin.x,
        sd.y - this.skyOrigin.y,
        sd.z - this.skyOrigin.z,
      );
      if (belowHorizon) {
        this.skySunMat.color.setRGB(0, 0, 0);
      } else {
        const { r, g, b } = solarColor(elevation);
        // 注意：transmission 玻璃会采样本太阳圆盘，color > 1.0 会被 bloom 处理
        // 但同时让玻璃采样到 HDR 过曝值 → 窗全白。这里钳到 1.0，过曝感交给 bloom。
        this.skySunMat.color.setRGB(
          Math.min(r, 1),
          Math.min(g, 1),
          Math.min(b, 1),
        );
      }
    }

    // ---- 天空背板顶点色：按太阳高度更新渐变（天顶冷 → 地平线暖）----
    // c 来自 skyColors，是 0..1 sRGB。顶点色 attribute 存 sRGB 值即可：
    // MeshBasicMaterial 的 output-color-space 转换会把它和 material.color 同等对待，
    // 与 PlaneGeometry 默认的 sRGB hex 颜色行为一致（Three.js 不做顶点色 sRGB→linear）。
    if (this.skyBackdrop) {
      setSkyBackdropColors(this.skyBackdrop, c.top, c.horizon);
    }
  }

  /** 设置时间 */
  setHour(hour: number): void {
    this.timeHour = Math.max(0, Math.min(24, hour));
    this.updateSunPosition();
  }

  /** 获取当前时间 */
  getHour(): number {
    return this.timeHour;
  }

  /** 推进时间 */
  advanceTime(deltaTime: number): void {
    this.timeHour += this.timeSpeed * deltaTime;
    if (this.timeHour >= 24) this.timeHour -= 24;
    this.updateSunPosition();
  }

  /** 设置时间推进速度 */
  setTimeSpeed(speed: number): void {
    this.timeSpeed = speed;
  }

  /** 获取时间推进速度 */
  getTimeSpeed(): number {
    return this.timeSpeed;
  }

  /** 开始日落模拟（17:00 → 20:00） */
  startSunsetSimulation(): void {
    this.setHour(SUNSET_START);
  }

  /** 是否正在日落时段 */
  isSunsetActive(): boolean {
    return this.timeHour >= SUNSET_START && this.timeHour <= SUNSET_END;
  }

  /** 启动渲染循环 */
  start(): void {
    if (this.animationId !== null) return;

    const animate = (time: number) => {
      this.animationId = requestAnimationFrame(animate);

      const deltaTime = this.lastTime === 0 ? 0 : (time - this.lastTime) / 1000;
      this.lastTime = time;

      // 推进时间
      this.advanceTime(deltaTime);

      // 每帧回调（场景过渡动画等）
      this.frameCallback?.(time);

      // 更新轨道控制器
      this.orbitControls.update();

      // 更新自动曝光
      if (this.autoExposure) {
        const exposure = this.autoExposure.update();
        this.backend.setExposure(exposure);
      }

      // 渲染
      this.backend.render(this.scene, this.camera);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  /** 停止渲染循环 */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /** 渲染单帧（用于测试） */
  renderOnce(): void {
    this.backend.render(this.scene, this.camera);
  }

  /** 更新画布大小 */
  resize(width: number, height: number): void {
    this.backend.resize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 获取场景 */
  getScene(): Scene {
    return this.scene;
  }

  /** 获取相机 */
  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  /** 获取太阳光源世界坐标 */
  getSunPosition(): { x: number; y: number; z: number } {
    return {
      x: this.sunLight.position.x,
      y: this.sunLight.position.y,
      z: this.sunLight.position.z,
    };
  }

  /** 获取太阳强度（0 = 地平线以下） */
  getSunIntensity(): number {
    return this.sunLight.intensity;
  }

  /** 设置相机位置（朝向房间中心工作面高度；同步轨道控制器目标点保持一致） */
  setCameraPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
    this.orbitControls.target.set(0, 0.8, 0);
    this.orbitControls.update();
  }

  /** 设置阴影 */
  setShadows(enabled: boolean): void {
    this.backend.setShadows(enabled);
    this.sunLight.castShadow = enabled;
  }

  /** 释放资源 */
  dispose(): void {
    this.stop();
    this.orbitControls.dispose();
    // 清理 PMREM 环境贴图产物（仅 WebGL2 路径生成；未生成时为 null，安全跳过）
    this.scene.environment = null;
    this.envRenderTarget?.dispose();
    this.envRenderTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.backend.dispose();
  }
}
