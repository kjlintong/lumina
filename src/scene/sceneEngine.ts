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

import type { Object3D } from 'three';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Fixture } from '../core/types.js';
import type { RenderBackend } from '../render/backend.js';
import { buildLightFromFixture } from '../render/lightBuilder.js';
import { buildRoom } from '../render/room.js';
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
  /** 时间推进速度（小时/秒） */
  timeSpeed?: number;
}

/** 日落时间配置（17:00 → 20:00） */
const SUNSET_START = 17.0;
const SUNSET_END = 20.0;

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

  private fixtureLights = new Map<string, { object: Object3D; approximated: boolean }>();

  private animationId: number | null = null;
  private lastTime = 0;
  private orbitControls: OrbitControls;

  constructor(backend: RenderBackend, config: SceneEngineConfig = {}) {
    this.backend = backend;
    this.timeHour = config.initialHour ?? 18.0;
    this.latitude = config.latitude ?? (39.9 * Math.PI) / 180; // 北京
    this.dayOfYear = config.dayOfYear ?? 180; // 夏至
    this.timeSpeed = config.timeSpeed ?? 0.5;

    this.scene = new Scene();
    this.scene.background = new Color(0x0a0a1a);

    this.camera = new PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 1.5, 0);

    // 轨道控制器：鼠标拖拽旋转、滚轮缩放、右键平移
    this.orbitControls = new OrbitControls(this.camera, backend.canvas);
    this.orbitControls.target.set(0, 1.5, 0);
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
    } else {
      this.autoExposure = null;
    }

    // 构建房间
    const { group } = buildRoom(
      config.roomWidth ?? 6,
      config.roomDepth ?? 4.5,
      config.roomHeight ?? 2.8,
    );
    this.scene.add(group);

    // 初始更新太阳
    this.updateSunPosition();
  }

  /** 添加灯具到场景 */
  addFixture(fixture: Fixture): void {
    const { object, approximated } = buildLightFromFixture(fixture);
    this.scene.add(object);
    this.fixtureLights.set(fixture.id, { object, approximated });
  }

  /** 移除灯具 */
  removeFixture(fixtureId: string): void {
    const entry = this.fixtureLights.get(fixtureId);
    if (entry) {
      this.scene.remove(entry.object);
      this.fixtureLights.delete(fixtureId);
    }
  }

  /** 更新太阳位置（根据当前时间） */
  private updateSunPosition(): void {
    const declination = 23.45 * (Math.PI / 180) * Math.sin(((2 * Math.PI) / 365) * (this.dayOfYear - 81));
    const pos = solarPosition(this.timeHour, this.latitude, declination);
    const { elevation, azimuth, belowHorizon } = pos;

    // 太阳位置
    const dist = 20;
    this.sunLight.position.set(
      Math.cos(elevation) * Math.sin(azimuth) * dist,
      Math.sin(elevation) * dist,
      Math.cos(elevation) * Math.cos(azimuth) * dist,
    );

    if (belowHorizon) {
      this.sunLight.intensity = 0;
      this.sunLight.color.setRGB(0, 0, 0);
    } else {
      // 根据太阳高度计算强度
      const intensity = Math.sin(elevation) * 3.0;
      this.sunLight.intensity = intensity;

      // 根据太阳高度计算颜色
      const { r, g, b } = solarColor(elevation);
      this.sunLight.color.setRGB(r, g, b);
    }

    // 环境光随太阳调整
    const dayFactor = Math.max(0, Math.sin(elevation));
    this.ambientLight.intensity = 0.1 + dayFactor * 0.4;
    this.hemiLight.intensity = 0.05 + dayFactor * 0.3;

    // 背景色随太阳调整
    if (belowHorizon) {
      this.scene.background = new Color(0x0a0a1a);
    } else if (elevation < Math.PI / 12) {
      // 日出日落：深橙色
      this.scene.background = new Color(0x1a0a05);
    } else if (elevation < Math.PI / 4) {
      // 傍晚：暖色
      this.scene.background = new Color(0x1a1520);
    } else {
      // 白天：浅蓝
      this.scene.background = new Color(0x87ceeb);
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

  /** 设置相机位置 */
  setCameraPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 1.5, 0);
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
    this.backend.dispose();
  }
}
