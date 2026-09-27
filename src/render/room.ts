/**
 * 房间外壳构建（P1 渲染层 / P8a 视觉升级）
 *
 * 由 (宽, 深, 高) 生成一个房间：
 *  - 地面位于 y = 0（P8a：木地板 CanvasTexture 或木色兜底）
 *  - 四面墙体从地面升到 y = height（P8a：轻微法线起伏，非死平一块色）
 *  - 天花板位于 y = height
 *  - P8a：北墙（z = -depth/2）可改为「落地窗」——墙体分段 + 窗框 + 玻璃，
 *    让夕阳从窗外打入、在地板留下光斑与窗框阴影（验收判据 4）。
 *
 * 坐标系约定（与领域模型 §5 一致）：房间中心位于世界原点，
 * x = 东西，z = 南北，y 向上。
 *
 * 材质选择：墙体 / 天花板用 MeshStandardMaterial，地面（橡木地板 + 清漆层）
 * 与玻璃（transmission）用 MeshPhysicalMaterial（高粗糙度、无金属度）。
 * 用 PBR 材质而非默认的 MeshBasicMaterial 是关键 ——
 * MeshBasicMaterial 完全忽略光照，会把物理光全部吃掉，场景将一片死色。
 *
 * 阴影策略（配合 backend.ts 中 renderer.shadowMap.enabled = true）：
 *  - 地面：只 receiveShadow，castShadow = false（最低面，投影零收益且产生 acne）。
 *  - 墙体 / 天花板：receiveShadow + castShadow 均为 true（否则光穿透墙体 / 泄漏到屋顶）。
 *  - 窗框：castShadow = true（在地板投出窗框阴影，是「窗内光斑」的关键）。
 *  - 玻璃：castShadow = false（transmission 透光，不挡光；否则窗框阴影会被整面玻璃吃掉）。
 *
 * 结构注意（为兼容既有测试断言）：
 *  - 无窗时：group 直接含 6 个 Mesh（1 地板 + 4 墙 + 1 天花板）。
 *  - 有窗时：北墙整体收进一个名为 'window-north' 的子 Group（墙体分段 + 窗框 + 玻璃），
 *    作为房间组的**一个**子节点 —— 房间组仍是 6 个直接子节点
 *    （floor / ceiling / south / east / west / window-north），
 *    sceneEngine 的「房间组 6 子节点」断言因此不受影响。
 *
 * 默认 `withWindow: false`：保证 `buildRoom(w, d, h)` 的既有语义与
 * room.test.ts 的 7 个断言（6 Mesh / walls.length=4 / 阴影标志）完全不变。
 * 需要窗的调用方（SceneEngine）显式传 `{ withWindow: true }`。
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
} from 'three';
import type { CanvasTexture } from 'three';
import {
  makeWallNormalTexture,
  makeWoodFloorNormalTexture,
  makeWoodFloorRoughnessTexture,
  makeWoodFloorTexture,
} from './materials.js';

/** 房间构建结果 */
export interface RoomBuildResult {
  /** 包含所有几何体的 Group */
  group: Group;
  /** 墙体网格（无窗 = 4 面整墙；有窗 = 3 面整墙 + 北墙各分段） */
  walls: Mesh[];
  /** 地板 */
  floor: Mesh;
  /** 天花板 */
  ceiling: Mesh;
  /** 玻璃窗网格（无窗时为空数组） */
  windows: Mesh[];
  /** 窗框网格（无窗时为空数组） */
  windowFrame: Mesh[];
}

/** 房间构建可选参数（P8a） */
export interface RoomBuildOptions {
  /**
   * 是否在北墙建落地窗。默认 **false** —— 保持 buildRoom 既有语义与既有测试不变；
   * SceneEngine 显式传 true。
   */
  withWindow?: boolean;
  /** 窗宽（米），默认 width * 0.7 */
  windowWidth?: number;
  /** 窗高（米），默认 height * 0.8 */
  windowHeight?: number;
  /** 窗台高度（米），默认 0.25 */
  windowSill?: number;
  /** 地板木纹贴图（可选注入；缺省调用 makeWoodFloorTexture()，jsdom 返回 null 时跳过） */
  floorTexture?: CanvasTexture | null;
  /** 地板法线贴图（可选注入；缺省调用 makeWoodFloorNormalTexture()，jsdom 返回 null 时跳过） */
  floorNormalTexture?: CanvasTexture | null;
  /** 地板粗糙度贴图（可选注入；缺省调用 makeWoodFloorRoughnessTexture()，jsdom 返回 null 时跳过） */
  floorRoughnessTexture?: CanvasTexture | null;
  /** 墙面法线贴图（可选注入；缺省调用 makeWallNormalTexture()，jsdom 返回 null 时跳过） */
  wallNormalTexture?: CanvasTexture | null;
}

const WALL_THICKNESS = 0.15;

/** 北墙落地窗构件（墙体分段 + 窗框 + 玻璃） */
interface NorthWindowAssembly {
  /** 收拢全部窗体构件的子 Group（命名为 'window-north'），作为房间组的一个子节点 */
  group: Group;
  /** 窗洞四周的墙体分段（左 / 右 / 过梁 / 窗台墙） */
  wallSegments: Mesh[];
  /** 窗框木条 */
  frame: Mesh[];
  /** 玻璃 */
  glass: Mesh;
}

/**
 * 构建北墙落地窗构件。所有子 mesh 用房间世界坐标（group 置于原点）。
 *
 * 玻璃用 MeshPhysicalMaterial.transmission 表达「透光但保留反射」：
 * transmission 走**独立的 transmissionRenderTarget**（渲染器先把场景渲到
 * 一个 RT，物理材质再经 transmissionSamplerMap 采样该 RT 做折射），与
 * `transparent` 标志完全无关。这里仍保留 `transparent: true`（无害，且保证
 * transparent pass 正确排序），但 `opacity` 保持 1.0——低 opacity 会把折射
 * 结果再按 alpha 压淡一遍。
 */
function buildNorthWindow(
  width: number,
  height: number,
  depth: number,
  windowWidth: number,
  windowHeight: number,
  windowSill: number,
  makeWallMaterial: () => MeshStandardMaterial,
): NorthWindowAssembly {
  const z = -depth / 2;
  const group = new Group();
  group.name = 'window-north';

  const wallSegments: Mesh[] = [];
  const seg = (w: number, h: number, x: number, yBottom: number): void => {
    const m = new Mesh(new BoxGeometry(w, h, WALL_THICKNESS), makeWallMaterial());
    m.position.set(x, yBottom + h / 2, z);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
    wallSegments.push(m);
  };

  // 窗左 / 窗右墙体（整高）
  const sideWidth = (width - windowWidth) / 2;
  const sideX = windowWidth / 2 + sideWidth / 2;
  seg(sideWidth, height, -sideX, 0);
  seg(sideWidth, height, sideX, 0);
  // 窗下窗台墙
  if (windowSill > 0) seg(windowWidth, windowSill, 0, 0);
  // 窗上过梁
  const lintelHeight = height - (windowSill + windowHeight);
  if (lintelHeight > 0) seg(windowWidth, lintelHeight, 0, windowSill + windowHeight);

  // 窗框：5 根细木条（深色木），投出窗框阴影
  const frameMaterial = new MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7, metalness: 0.0 });
  // P9 交付物 4：0.06 → 0.09。旧框太细（6cm），投影几乎看不见，光斑整片糊在地板上。
  const frameT = 0.09;
  const frameD = WALL_THICKNESS + 0.02; // 略凸出墙面，避免 z-fighting
  const winCenterY = windowSill + windowHeight / 2;
  const frame: Mesh[] = [];
  const bar = (w: number, h: number, x: number, y: number): void => {
    const m = new Mesh(new BoxGeometry(w, h, frameD), frameMaterial);
    m.position.set(x, y, z);
    m.castShadow = true; // 窗框阴影是「窗内光斑」的关键
    m.receiveShadow = true;
    group.add(m);
    frame.push(m);
  };
  bar(frameT, windowHeight, -windowWidth / 2, winCenterY); // 左梃
  bar(frameT, windowHeight, windowWidth / 2, winCenterY); // 右梃
  bar(windowWidth + frameT, frameT, 0, windowSill + windowHeight); // 上框
  bar(windowWidth + frameT, frameT, 0, windowSill); // 下框
  // P9 交付物 4：窗中梃（vertical mullion），在左右梃正中。
  // 让落日光斑被切成 2 格，是「落地窗室内光斑」的视觉核心。
  // 走同一个 bar 工厂函数，继承 castShadow/receiveShadow 与 frame 数组登记。
  bar(frameT, windowHeight, 0, winCenterY);

  // 玻璃：transmission 物理透光平面。
  // transmission 走独立 transmissionRenderTarget，与 transparent 无关——
  // P8a 的「死白窗」根因是当时**没有用 transmission**，只用了 opacity 0.12
  // 的半透明白板，那是「没用 transmission」的后果，而非它的副作用。
  // 这里 transmission=1.0 + ior=1.5 + thickness=0.01：室外天空/太阳圆盘经
  // 折射透入室内；roughness 0.05 让玻璃接近镜面。保留 transparent:true
  // （保证 transparent pass 排序），但 opacity=1.0，避免把折射结果再压淡。
  const glassMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.05,
    transmission: 1.0,
    ior: 1.5,
    thickness: 0.01,
    transparent: true,
    opacity: 1.0,
  });
  const glass = new Mesh(new PlaneGeometry(windowWidth, windowHeight), glassMaterial);
  glass.position.set(0, winCenterY, z);
  // 玻璃不投影，否则窗框阴影会被整面玻璃吃掉
  glass.castShadow = false;
  glass.receiveShadow = false;
  // 渲染在最上层：室内家具先画，玻璃后画并混合，保证室外内容可见
  glass.renderOrder = 999;
  group.add(glass);

  return { group, wallSegments, frame, glass };
}

/**
 * 由房间尺寸构建房间外壳。
 *
 * @param width  房间宽度（x 方向，米），必须为正
 * @param depth  房间深度（z 方向，米），必须为正
 * @param height 层高（y 方向，米），必须为正
 * @param options 可选：是否建窗、窗尺寸、贴图注入（见 RoomBuildOptions）
 * @throws 任一尺寸非正数时抛出 —— 零 / 负尺寸的 Plane 与 Box 会产生退化几何，
 *         让光照与阴影静默出错，因此在入口处直接拒绝
 */
export function buildRoom(
  width: number,
  depth: number,
  height: number,
  options: RoomBuildOptions = {},
): RoomBuildResult {
  if (!(width > 0) || !(depth > 0) || !(height > 0)) {
    throw new Error(`buildRoom: 尺寸必须为正数，收到 (width=${width}, depth=${depth}, height=${height})`);
  }

  const {
    withWindow = false,
    windowWidth = width * 0.7,
    windowHeight = height * 0.8,
    windowSill = 0.25,
    floorTexture,
    floorNormalTexture,
    floorRoughnessTexture,
    wallNormalTexture,
  } = options;

  // 乳胶漆 / 石膏浅灰，高粗糙度无金属度。
  // P12：墙面 0.95 → 0.90（报告数值），天花独立 0.95（见 makeCeilingMaterial）。
  const surfaceColor = 0xe6e6e6;
  const surfaceRoughness = 0.9;
  const surfaceMetalness = 0.0;

  // 墙面法线贴图（jsdom 下为 null → 跳过 normalMap，保持纯色墙面）
  const wallNormalTex = wallNormalTexture ?? makeWallNormalTexture();
  const makeWallMaterial = (): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({
      color: surfaceColor,
      roughness: surfaceRoughness,
      metalness: surfaceMetalness,
    });
    if (wallNormalTex) {
      m.normalMap = wallNormalTex;
      m.normalScale = new Vector2(0.4, 0.4); // 轻微起伏，非浮雕
    }
    return m;
  };
  // P12：天花独立材质（旧实现复用 makeSurfaceMaterial，跟墙面同粗糙度）。
  // roughness 0.95 高于墙面 0.90，保持较高反射以承接「天花最亮」的层次；
  // 颜色仍用 surfaceColor（报告未要求改色），不加 normalMap（旧行为保留）。
  const makeCeilingMaterial = (): MeshStandardMaterial =>
    new MeshStandardMaterial({
      color: surfaceColor,
      roughness: 0.95,
      metalness: surfaceMetalness,
    });

  // 地板（xz 平面，y=0）。法线经 rotation.x = -PI/2 由 +Z 转为 +Y（朝上）。
  // P8a：木地板。有贴图时 color 置白让贴图显色；无贴图（jsdom）用木色兜底。
  // P14：升级为 MeshPhysicalMaterial 以支持 clearcoat（橡木清漆层）。
  // MeshPhysicalMaterial extends MeshStandardMaterial，既有 instanceof
  // MeshStandardMaterial 断言不受影响。三件套（map + normalMap + roughnessMap）
  // 共用同一板缝布局，逐像素对齐。
  const floorMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.4, // P12：橡木地板区间中值（0.35–0.45），太阳斜射时出现高光带
    metalness: 0.0,
    clearcoat: 0.15, // P14：橡木表面清漆层
    clearcoatRoughness: 0.4,
  });
  const floorTex = floorTexture ?? makeWoodFloorTexture();
  if (floorTex) {
    floorMaterial.map = floorTex;
  } else {
    floorMaterial.color.setHex(0x9c7048);
  }
  const floorNormalTex = floorNormalTexture ?? makeWoodFloorNormalTexture();
  if (floorNormalTex) {
    floorMaterial.normalMap = floorNormalTex;
    floorMaterial.normalScale = new Vector2(0.6, 0.6); // 板缝凹陷 + 板内细木纹
  }
  const floorRoughnessTex = floorRoughnessTexture ?? makeWoodFloorRoughnessTexture();
  if (floorRoughnessTex) {
    floorMaterial.roughnessMap = floorRoughnessTex; // 板缝更光滑 → 高光带
  }
  floorMaterial.displacementScale = 0; // 不需要位移
  const floor = new Mesh(new PlaneGeometry(width, depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // 地面在 y=0，是房间内最低物体，不可能遮挡任何灯具（灯具 y>0），
  // 因此投阴影毫无收益，反而因近平行产生 acne 伪影 → 不投射。
  floor.castShadow = false;

  // 天花板（xz 平面，y=height）。法线经 rotation.x = +PI/2 转为 -Y（朝房间内部）。
  const ceiling = new Mesh(new PlaneGeometry(width, depth), makeCeilingMaterial());
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  ceiling.receiveShadow = true;
  // 天花板必须投射阴影，否则墙灯/落地灯的光会穿透天花板打到房间外。
  ceiling.castShadow = true;

  // 南墙（z = +depth/2）
  const southWall = new Mesh(
    new BoxGeometry(width, height, WALL_THICKNESS),
    makeWallMaterial(),
  );
  southWall.position.set(0, height / 2, depth / 2);
  southWall.receiveShadow = true;
  southWall.castShadow = true;

  // 东墙（x = +width/2）
  const eastWall = new Mesh(
    new BoxGeometry(WALL_THICKNESS, height, depth),
    makeWallMaterial(),
  );
  eastWall.position.set(width / 2, height / 2, 0);
  eastWall.receiveShadow = true;
  eastWall.castShadow = true;

  // 西墙（x = -width/2）
  const westWall = new Mesh(
    new BoxGeometry(WALL_THICKNESS, height, depth),
    makeWallMaterial(),
  );
  westWall.position.set(-width / 2, height / 2, 0);
  westWall.receiveShadow = true;
  westWall.castShadow = true;

  const windows: Mesh[] = [];
  const windowFrame: Mesh[] = [];
  let walls: Mesh[];

  const group = new Group();
  group.name = 'room';

  if (withWindow) {
    // 北墙 → 落地窗（墙体分段 + 窗框 + 玻璃），收进一个子 Group，
    // 作为房间组的第 6 个直接子节点（保持房间组直接子节点数 = 6）。
    const north = buildNorthWindow(
      width,
      height,
      depth,
      windowWidth,
      windowHeight,
      windowSill,
      makeWallMaterial,
    );
    group.add(floor, ceiling, southWall, eastWall, westWall, north.group);
    windows.push(north.glass);
    windowFrame.push(...north.frame);
    walls = [southWall, eastWall, westWall, ...north.wallSegments];
  } else {
    // 北墙（z = -depth/2）整墙
    const northWall = new Mesh(
      new BoxGeometry(width, height, WALL_THICKNESS),
      makeWallMaterial(),
    );
    northWall.position.set(0, height / 2, -depth / 2);
    northWall.receiveShadow = true;
    northWall.castShadow = true;
    group.add(floor, ceiling, northWall, southWall, eastWall, westWall);
    walls = [northWall, southWall, eastWall, westWall];
  }

  return { group, walls, floor, ceiling, windows, windowFrame };
}
