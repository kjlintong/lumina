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
  Camera,
  Light,
  Line,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
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
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ActivityZone, Fixture } from '../core/types.js';
import type { RenderBackend } from '../render/backend.js';
import { buildActivityZone } from '../render/activityZone.js';
import { buildDustParticles, updateDustPoints } from '../render/dustParticles.js';
import { buildFurniture } from '../render/furniture.js';
import { buildLightFromFixture, cctToRGB, SHADE_EMISSIVE_SCALE } from '../render/lightBuilder.js';
import { buildRoom } from '../render/room.js';
import { buildSkyScene, setSkyBackdropColors, skyColors } from '../render/sky.js';
import { buildSkyline } from '../render/skyline.js';
import { buildLightShaft } from '../render/volumetricShaft.js';
import { buildPlanter, buildPlant } from '../render/plants.js';
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

/**
 * 太阳阴影贴图边长（P9 从 2048 降到 1024）。
 *
 * 2048² 是全场景最大的单张阴影贴图，也是 5-8 FPS 的主要成本之一。
 * 太阳用正交相机（非立方体），1024² 投影到 ±10m 的视锥上，
 * 每像素覆盖约 2cm，对 6×4.5m 的房间足够。
 */
const SUN_SHADOW_MAP_SIZE = 1024;

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
  /**
   * 灯罩 Mesh（P8b）。其 material 的 `emissive` / `emissiveIntensity` 由
   * setFixtureCct / setFixtureLevel 就地同步，让灯具成为「可见的亮点」。
   */
  shade: Mesh | null;
}

/** 亮度截断到 [0, 1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 统计场景中可渲染对象数（只数 Mesh / Points / Line，不数 Group / Light / 相机）。
 * 抽成纯函数：HUD 统计单测直接喂一个手工 Scene 即可，无需起引擎。
 */
export function countRenderableObjects(scene: Scene): number {
  let count = 0;
  scene.traverse((obj) => {
    const o = obj as Mesh & Points & Line;
    if (o.isMesh || o.isPoints || o.isLine) count++;
  });
  return count;
}

/**
 * 把世界坐标投影到屏幕 UV（0..1）。P9 交付物 2：godrays 屏幕锚点必须落在
 * 相机视野内，否则 shader 的 lightScreen 采样会退化（旧实现把太阳世界坐标
 * 直接投影，太阳在窗外 15m+ 外，投影 UV.x 恒为负 → 锚点永远停在默认值）。
 *
 * 纯几何计算，不分配对象（复用 out），便于单测（无需真实 WebGL 渲染）。
 *
 * @param worldPos 世界坐标
 * @param camera   已完成 updateMatrixWorld / updateProjectionMatrix 的相机
 * @param out      复用的 NDC 载体（默认新建一个 Vector3）
 * @returns 屏幕 UV + NDC z；`z >= 1`（近平面外/相机背后）或 UV 落在 [0,1] 之外
 *          返回 null（调用方应保持上一个锚点，不要复位）
 */
export function projectToScreenUV(
  worldPos: Vector3,
  camera: Camera,
  out: Vector3 = new Vector3(),
): { x: number; y: number; z: number } | null {
  out.copy(worldPos).project(camera);
  if (out.z >= 1) return null;
  const uvX = (out.x + 1) / 2;
  const uvY = (out.y + 1) / 2;
  if (uvX < 0 || uvX > 1 || uvY < 0 || uvY > 1) return null;
  return { x: uvX, y: uvY, z: out.z };
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

  /** 帧率滑动平均（P8c HUD）。animate 内按 `0.9*fps + 0.1*(1/dt)` 更新。 */
  private fps = 0;

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

  /**
   * 窗玻璃 mesh（P9 交付物 2）。getWindowScreenAnchor 用它的局部原点做锚点：
   * 玻璃 PlaneGeometry 的局部 (0,0) 就是窗洞中心，经 localToWorld 转到世界坐标。
   * **不能**直接用 `this.skyOrigin` —— 那是 `glass.position`（包含窗台高度），
   * 恰好等于窗洞中心的世界坐标只有在 `matrixWorld` 恒等时成立，而玻璃嵌在
   * room/window-north 两级 group 下，必须走 localToWorld 才对。
   */
  private windowGlass: Mesh | null = null;

  /**
   * 窗外城市天际线（P8e）。嵌套在 sky-scene group 内，继承窗中心原点，
   * 因此局部坐标即世界坐标偏移。静态剪影：MeshBasicMaterial 不受光照、
   * 不参与阴影，始终可见。sky-scene 整组移除时本字段一并回收，不需单独 dispose。
   */
  private skyline: Group | null = null;

  /** 复用临时向量（每帧太阳圆盘定位，避免每帧 new Vector3） */
  private _skyTmp = new Vector3();

  /**
   * 复用临时向量（P9 交付物 2：每帧算窗中心屏幕锚点）。避免每帧 new Vector3。
   * 与 `_skyTmp` 分开：updateSunPosition 里 _skyTmp 持有太阳方向，
   * getWindowScreenAnchor 被 App 的 frame callback 在渲染前调用，两者不重叠。
   * `_anchorWorld` 承接 localToWorld 的世界坐标结果，`_anchorTmp` 承接 project 的 NDC。
   */
  private _anchorWorld = new Vector3();
  private _anchorTmp = new Vector3();

  /**
   * 尘埃粒子云（P8b）。渲染层构建，animate 循环每帧用**真实 dt** 漂移
   * （不乘 timeSpeed——粒子是物理漂浮，不随虚拟时间加速）。
   */
  private dustPoints: Points | null = null;

  /**
   * 假体积光柱（P8b）。opacity 随太阳高度角联动：太阳低于地平线或高于
   * π/4（正午，光柱不自然）时归零，仅在日出/日落低角度时段可见。
   */
  private lightShaft: Mesh | null = null;
  /**
   * 光柱交叉平面（P9 交付物 4）。单片光柱在正对/正侧视角下几乎是零面积、看不见；
   * 克隆一片并绕光柱轴（世界 Y）转 90°，任意视角都能看到一片。构造期一次性
   * 创建（不是每帧 new），两个平面各自持有独立 material 实例（opacity 互不影响）。
   */
  private lightShaftCross: Mesh | null = null;
  /**
   * 光柱基准不透明度（updateSunPosition 按太阳高度角缩放它的基准）。
   * P9：0.15 → 0.28（实测有效不透明度只有 0.080，几乎不可见）。
   */
  private shaftBaseOpacity = 0.6;
  /** 用户是否要求显示光柱（P8b UI 开关；与太阳高度角渐隐相乘） */
  private shaftUserEnabled = true;

  /**
   * 装饰绿植（P8d）。与房间一样属于静态几何，构造时一次性构建，不参与
   * 阴影之外的任何每帧更新。与家具一致：castShadow = receiveShadow = true
   * （遮挡上下文红线）。
   */
  private decorPlants: Group | null = null;

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
    // P9 阴影预算：2048 → 1024（2048² 是 5 FPS 的主要成本之一）。
    // 太阳只有一张、且是正交相机（非立方体），1024² 足够 6×4.5m 的房间。
    this.sunLight.shadow.mapSize.set(SUN_SHADOW_MAP_SIZE, SUN_SHADOW_MAP_SIZE);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 50;
    this.sunLight.shadow.camera.left = -10;
    this.sunLight.shadow.camera.right = 10;
    this.sunLight.shadow.camera.top = 10;
    this.sunLight.shadow.camera.bottom = -10;
    // P9 关键修复：**必须把 target 加入场景**。
    // DirectionalLight.target 不参与场景图时，Three.js 每帧无法更新它的
    // matrixWorld（见 `WebGLShadowMap` 的注释：target 的矩阵只在其是场景
    // 子对象时更新），shadow camera 就会朝向 (0,0,0) 的默认位而不是我们
    // 期望的方向 —— 这是「阴影开关 0 像素变化」的根因。
    // updateSunPosition 每帧只改 sunLight.position，target 恒在原点，
    // 因此必须显式 add，让 shadow camera 稳定朝房间中心。
    this.sunLight.target.position.set(0, 0.5, 0);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    // P9：偏置调优。directional 光下 `bias` 用负值抵消「自遮挡」剥离线；
    // `normalBias` 让顶点沿法线偏移采样，消除墙面/天花板附近的阴影泄漏。
    // 不要把 bias 设成很大的负数（会导致阴影从物体表面剥离成一条亮线）。
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.03;

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
    if (glass) {
      this.skyOrigin.copy(glass.position);
      // P9 交付物 2：保存玻璃 mesh 本身（不是 skyOrigin 位置），
      // getWindowScreenAnchor 需要它的 localToWorld 才能得到窗洞中心。
      this.windowGlass = glass;
    }
    const sky = buildSkyScene(this.skyOrigin, new Vector3(0, 0, -1));
    this.skySun = sky.sun;
    this.skySunMat = sky.sun.material as MeshBasicMaterial;
    this.skyBackdrop = sky.backdrop;
    this.scene.add(sky.group);

    // 窗外城市天际线（P8e）：替代 P8a 的三块扁平剪影色块，对标参考 2 的水岸城市。
    // 嵌套进 sky-scene group，继承窗中心原点，因此局部坐标即世界坐标偏移。
    // 排在楼群 z=-22..-34，远于 P8a 剪影（12..28）以免重叠；水面/吊桥在 -14/-18。
    // 静态剪影，不参与阴影、不受光照，始终可见。sky-scene 整组移除时一并回收。
    this.skyline = buildSkyline(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    sky.group.add(this.skyline);

    // 尘埃粒子（P8b）：悬浮在房间中部高度，营造「空气中漂浮的尘埃」质感。
    // 体积略小于房间，避免粒子贴墙显得假。
    this.dustPoints = buildDustParticles({
      count: 350,
      volumeSize: [roomWidth * 0.8, roomHeight * 0.75, roomDepth * 0.8],
    });
    this.dustPoints.position.y = roomHeight * 0.5;
    this.scene.add(this.dustPoints);

    // 假体积光柱（P8b）：从窗中心射向房间中心的地板落点，正对相机视野。
    // 几何构建一次固定不变；updateSunPosition 每帧只改 opacity 做渐隐。
    //
    // P9 交付物 4：做**双平面交叉**。单片光柱在正对或正侧视角下投影面积
    // 趋近于零、几乎不可见；克隆一片绕光柱轴转 90°，任意视角都能看见一片。
    // 两平面各自持有独立 material 实例（clone 一次），opacity 互不影响。
    // buildLightShaft 签名保持不变（volumetricShaft.test.ts 依赖单 Mesh 返回值）。
    const shaft = buildLightShaft(this.skyOrigin.clone(), new Vector3(0, 0, 0), {
      opacity: this.shaftBaseOpacity,
    });
    // buildLightShaft 内部用 MeshBasicMaterial 构建，但 Mesh.material 类型是
    // `Material | Material[]`，clone() 不在 Material 基类上 → 需断言。
    shaft.material = (shaft.material as MeshBasicMaterial).clone();
    const cross = shaft.clone();
    cross.material = (shaft.material as MeshBasicMaterial).clone();
    cross.position.copy(shaft.position);
    cross.quaternion.copy(shaft.quaternion);
    const quarter = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    cross.quaternion.multiply(quarter);
    // 第二片色调略偏红，强化交叉处的体积厚度感（主片暖橙 0xffc080）
    (cross.material as MeshBasicMaterial).color.setHex(0xff9a4d);
    this.lightShaft = shaft;
    this.lightShaftCross = cross;
    this.scene.add(shaft);
    this.scene.add(cross);

    // 装饰绿植（P8d）：放在窗侧角落，承接「绿植点缀」——冷色家具与暖色夕照
    // 之间的色彩过渡。位置按房间尺寸算出，并避开已知活动区（lounge/dining）
    // 与相机前景，保证不挡光、不挡视线。静态几何，不参与每帧更新。
    this.decorPlants = this.buildDecorPlants(roomWidth, roomDepth);
    this.scene.add(this.decorPlants);

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
  /**
   * 构建装饰绿植组。放在窗侧（北墙）角落，承接参考项目的「绿植点缀」：
   * 冷色家具与暖色夕照之间的色彩过渡，并让窗外光影有个可投影的主体。
   *
   * 位置说明：窗在北墙（z = -depth/2），相机在 (2.5, 1.8, 1.9) 望西北。
   * 所以 NW 角落（x 负、z 负）最显眼且承接窗外光。这里避开光柱路径
   * （窗中心 → 房间中心，即 z = -depth/2 → 0 的对角线），把绿植放在
   * 更靠窗台、更靠边的一侧，让它投影在地板上但不挡光柱。
   */
  private buildDecorPlants(roomWidth: number, roomDepth: number): Group {
    const group = new Group();
    group.name = 'decor-plants';
    const margin = 0.12; // 离墙边距，避免贴墙显得假
    const x = -roomWidth / 2 + margin + 0.34; // 0.34 = 绿植半径
    const z = -roomDepth / 2 + margin + 0.22;
    const pot = buildPlant({ heightScale: 0.85, seed: 7, x, z });
    group.add(pot);
    // 一个略小的木箱绿植，放在旁边做层次
    const planter = buildPlanter({ x: x + 0.62, z: z + 0.18, boxSize: 0.4 });
    group.add(planter);
    return group;
  }

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

      // P9 交付物 4：环境反射只做「细节补充」而非主光。PMREM 会让所有 PBR 面
      // 都反射环境光，室内白天整体发灰亮（压掉太阳的冷暖对比）。降到 0.35，
      // 主光交给太阳与灯具。r163+ 支持 `Scene.environmentIntensity`。
      const sceneWithIntensity = this.scene as Scene & { environmentIntensity?: number };
      if ('environmentIntensity' in this.scene) {
        sceneWithIntensity.environmentIntensity = 0.35;
      }
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
    const { object, light, approximated, shade } = buildLightFromFixture(fixture);
    this.scene.add(object);
    const baseIntensity = light ? light.intensity : 0;
    this.fixtureLights.set(fixture.id, { object, light, baseIntensity, approximated, shade });
    // 应用当前亮度级别：优先该灯在当前场景下的 sceneLevels，默认全亮
    const level = this.resolveLevel(fixture);
    this.fixtureLevels.set(fixture.id, level);
    this.applyFixtureIntensity(fixture.id, level);
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
    const { object, light, approximated, shade } = buildLightFromFixture(fixture);
    this.scene.add(object);
    const baseIntensity = light ? light.intensity : 0;
    this.fixtureLights.set(fixture.id, { object, light, baseIntensity, approximated, shade });
    // resolveLevel 优先读 sceneLevels[activeSceneKey]，否则保留重建前的 level
    const level = this.resolveLevel(fixture);
    this.fixtureLevels.set(fixture.id, level);
    this.applyFixtureIntensity(fixture.id, level);
  }

  /**
   * 按当前 level 同步灯罩 emissiveIntensity。
   * emissiveIntensity = clamp(level,0,1) * SHADE_EMISSIVE_SCALE（3.0 让灯罩超过
   * bloom threshold 0.85 被辉光抓到；HDR 值配合 ACES 不会溢出屏幕）。
   * 抽成方法：addFixture / updateFixture / setFixtureLevel 三处共用。
   */
  private applyFixtureIntensity(fixtureId: string, level: number): void {
    const entry = this.fixtureLights.get(fixtureId);
    if (!entry) return;
    if (entry.light) entry.light.intensity = entry.baseIntensity * level;
    const shadeMat = entry.shade?.material as MeshStandardMaterial | undefined;
    if (shadeMat) shadeMat.emissiveIntensity = clamp01(level) * SHADE_EMISSIVE_SCALE;
  }

  /**
   * 设置灯具亮度级别：`light.intensity = baseIntensity * clamp(level, 0, 1)`，
   * 并同步灯罩 emissiveIntensity（P8b：灯具是可见亮点）。
   * 只调强度，不重建光源——场景过渡动画每帧走这里。
   */
  setFixtureLevel(fixtureId: string, level: number): void {
    const clamped = clamp01(level);
    this.fixtureLevels.set(fixtureId, clamped);
    this.applyFixtureIntensity(fixtureId, clamped);
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
    // P8b：灯罩 emissive 颜色跟随色温，保持「灯罩亮色 = 光源颜色」一致。
    const shadeMat = entry.shade?.material as MeshStandardMaterial | undefined;
    if (shadeMat) shadeMat.emissive.setRGB(r, g, b);
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
   * 窗洞中心在当前相机下投影到屏幕 UV（P9 交付物 2，godrays 锚点）。
   *
   * 锚点取法：玻璃 mesh 局部 (0,0) 即窗洞中心（PlaneGeometry 以自身中心为原点），
   * 经 `localToWorld` 转到世界坐标再投影。**不是** `this.skyOrigin` —— 那是
   * `glass.position` 的一份拷贝，在玻璃嵌于 room/window-north 两级 group 下时
   * 与世界坐标不重合。
   *
   * @returns 窗在视野内返回 UV（0..1）；窗不在视野内（UV 出界或 z>=1）返回 null。
   *          调用方在 null 时**保持上一个锚点**，不要复位到默认值。
   */
  getWindowScreenAnchor(camera: Camera): { x: number; y: number } | null {
    const glass = this.windowGlass;
    if (!glass) return null;
    // 相机矩阵可能刚被 orbitControls 更新过（update() 改了 position/quaternion
    // 但 matrixWorld 在下一次渲染才刷新），显式刷新保证 project() 用的是当前位姿。
    camera.updateMatrixWorld();
    const worldCenter = this._anchorWorld.set(0, 0, 0);
    glass.localToWorld(worldCenter);
    const uv = projectToScreenUV(worldCenter, camera, this._anchorTmp);
    if (!uv) return null;
    return { x: uv.x, y: uv.y };
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
        // P9 交付物 4：钳到 3.0（旧值 1.0 已过期）。圆盘从 1.4m 缩到 0.55m 后
        // 不再糊满窗洞，用 HDR 值让 bloom 抓到它本体；玻璃是 opacity 0.12 的
        // 透明面（非 transmission），采样不受 3.0 影响，不会把窗染白。
        // toneMapped=false 保留 —— 太阳圆盘是画面里最亮的点，正是 bloom 目标。
        this.skySunMat.color.setRGB(
          Math.min(r, 3.0),
          Math.min(g, 3.0),
          Math.min(b, 3.0),
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

    // ---- 假体积光柱：仅由太阳高度角驱动不透明度（P8b）----
    // 几何固定为「窗中心 → 房间中心地板」：相机在东南角望北墙，这道光柱
    // 正对视野，视觉最稳。不重建几何（PlaneGeometry 尺寸固定，每帧重建浪费）；
    // 只按太阳高度角做渐隐——日出/日落低角度可见，太阳高于 π/4（正午）或
    // 低于地平线时归零隐藏。
    // 注意：不能复用 _skyTmp，它此刻仍持有下方太阳圆盘定位需要的天空方向。
    // P9 交付物 4：主片与交叉片必须**同时**更新 opacity / visible（两片独立
    // material 实例，只更新一片会让另一片停在构造期基准值）。
    if (this.lightShaft) {
      // P9b：分母从 π/4 改成 π/6。太阳在 30° 以上（比原来 45° 更早）就保持
      // 满强度，让下午时段（elevation 30°–60°）也有光柱可见性；低于 30°
      // 时 sinEl 线性衰减。18:30 太阳高度 23° 时 opacity ≈ 0.6 × 0.77 × 1.4
      // ≈ 0.65，肉眼可辨。
      const lowAngleFactor = clamp01(Math.min(sinEl, Math.PI / 6) / (Math.PI / 6));
      const opacity = this.shaftBaseOpacity * lowAngleFactor * 1.4;
      const visible = this.shaftUserEnabled && opacity > 0.001;
      (this.lightShaft.material as MeshBasicMaterial).opacity = opacity;
      this.lightShaft.visible = visible;
      if (this.lightShaftCross) {
        (this.lightShaftCross.material as MeshBasicMaterial).opacity = opacity;
        this.lightShaftCross.visible = visible;
      }
    }

    // ---- P9b 曝光分档 ----
    // 旧逻辑用 AutoExposure.targetLuminance = 0.17 做动态曝光，但 0.17 是
    // sRGB 中间灰，对应的 linear 亮度 ≈ 0.024；我们的场景是 HDR 渲染
    // （sunLight.intensity 最高 3.0、灯罩 emissive 无上限），采样回来的 linear
    // 亮度全是 1+ 量级。算法必然把 targetExposure 压到 0.02 上下——实测中午
    // 和夜晚都是 0.14，整个白天看起来像深夜。
    //
    // 新方案：按太阳状态分两档曝光，不做完整 autoExposure。
    //   - 白天（sunInt > 0.2）：exposure = 1.0（ACES 自己处理 HDR）
    //   - 夜晚（sunInt < 0.05）：exposure = 0.5（让室内灯具成为主视觉）
    //   - 过渡：线性插值
    // AutoExposure 类保留（未来可能恢复），但 update() 不再被每帧调用。
    const nightFactor = clamp01((0.2 - this.sunLight.intensity) / 0.15); // 0（白天）→ 1（夜晚）
    const targetExposure = 1.0 - nightFactor * 0.5; // 1.0 → 0.5
    this.backend.setToneMappingExposure(targetExposure);
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

      // 帧率滑动平均（P8c HUD）：delta<=0（首帧/回表）不更新，避免除零污染。
      if (deltaTime > 0) {
        this.fps = 0.9 * this.fps + 0.1 * (1 / deltaTime);
      }

      // 推进时间
      this.advanceTime(deltaTime);

      // 尘埃漂移（P8b）：用**真实墙钟 dt**，不乘 timeSpeed——粒子是物理漂浮，
      // 即使虚拟时间冻结/加速，尘埃仍按真实节奏缓缓浮动。
      if (this.dustPoints && deltaTime > 0) {
        updateDustPoints(this.dustPoints, deltaTime, time / 1000);
      }

      // 每帧回调（场景过渡动画等）
      this.frameCallback?.(time);

      // 更新轨道控制器
      this.orbitControls.update();

      // P9b：不再每帧调用 autoExposure.update()。曝光改由 updateSunPosition()
      // 按太阳状态分档设置（白天 1.0 / 夜晚 0.5 / 过渡插值）。
      // AutoExposure 类保留供未来恢复，但当前不参与渲染管线。

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

  /**
   * 渲染统计（P8c HUD）。数字全部真实：
   * - triangles：WebGL2 取 `renderer.info.render.triangles`；WebGPU 无此 API，
   *   返回 0（UI 显示 `—`，不虚报）。
   * - objects：遍历 scene，只数 Mesh / Points / Line（见 countRenderableObjects）。
   * - fps：animate 循环内维护的滑动平均；未渲染过时为 0。
   */
  getRenderStats(): { triangles: number; objects: number; fps: number } {
    let triangles = 0;
    if (this.backend.type === 'webgl2') {
      const renderer = this.backend.getRenderer() as WebGLRenderer | undefined;
      const t = renderer?.info?.render?.triangles;
      if (typeof t === 'number' && Number.isFinite(t)) triangles = t;
    }
    return {
      triangles,
      objects: countRenderableObjects(this.scene),
      fps: this.fps,
    };
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

  /** 设置尘埃粒子可见性（P8b 性能开关；粒子始终漂移，仅切换是否渲染） */
  setDustVisible(enabled: boolean): void {
    if (this.dustPoints) this.dustPoints.visible = enabled;
  }

  /** 设置体积光柱可见性（P8b 性能开关；与太阳高度角的渐隐相乘） */
  setLightShaftVisible(enabled: boolean): void {
    if (this.lightShaft) {
      // 记录用户意图；updateSunPosition 每次按其 × 太阳高度角 决定最终 visible。
      this.shaftUserEnabled = enabled;
      this.lightShaft.visible = enabled && this.lightShaft.visible;
    }
    // P9 交付物 4：交叉片与主片同步（否则用户关光柱时另一片仍显示）
    if (this.lightShaftCross) {
      this.lightShaftCross.visible = enabled && this.lightShaftCross.visible;
    }
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
    // 清理 P8b 体积光 / 尘埃粒子（CanvasTexture + BufferGeometry 都需显式释放）
    if (this.dustPoints) {
      this.scene.remove(this.dustPoints);
      this.dustPoints.geometry.dispose();
      const dustMat = this.dustPoints.material as PointsMaterial;
      if (dustMat.map) dustMat.map.dispose();
      dustMat.dispose();
      this.dustPoints = null;
    }
    if (this.lightShaft) {
      this.scene.remove(this.lightShaft);
      this.lightShaft.geometry.dispose();
      const shaftMat = this.lightShaft.material as MeshBasicMaterial;
      if (shaftMat.map) shaftMat.map.dispose();
      shaftMat.dispose();
      this.lightShaft = null;
    }
    // P9 交付物 4：交叉片独立 material（克隆），需单独 dispose；geometry 与主片
    // 共享同一 PlaneGeometry，主片已 dispose，这里不再重复调用。
    if (this.lightShaftCross) {
      this.scene.remove(this.lightShaftCross);
      const crossMat = this.lightShaftCross.material as MeshBasicMaterial;
      if (crossMat.map) crossMat.map.dispose();
      crossMat.dispose();
      this.lightShaftCross = null;
    }
    // 清理装饰绿植（P8d）：BoxGeometry/ConeGeometry/CylinderGeometry + 各自 material
    if (this.decorPlants) {
      this.scene.remove(this.decorPlants);
      this.decorPlants.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          const m = obj as Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material.dispose();
        }
      });
      this.decorPlants = null;
    }
    // 清理 PMREM 环境贴图产物（仅 WebGL2 路径生成；未生成时为 null，安全跳过）
    this.scene.environment = null;
    this.envRenderTarget?.dispose();
    this.envRenderTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.backend.dispose();
  }
}
