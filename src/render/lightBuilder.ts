/**
 * Fixture 数据 → Three.js 光源对象转换（P1 渲染层）
 *
 * 把领域层 `Fixture`（供给侧实体，见 src/core/types.ts）翻译成场景图节点：
 * 一个 `Object3D` 根，内含一枚物理光源 + 一枚用于可视化的灯罩 Mesh。
 *
 * 物理量口径（工程红线，见 types.ts 顶部注释 §6.3 / ADR-15）：
 *   - `Fixture.electrical.cct` 是色温（K），**不是**颜色，必须经色温→RGB 转换。
 *     用 Tanner Helland 近似：对黑体辐射曲线做分段解析拟合。
 *   - `Fixture.photometric.lumens` 是光通量 Φ（lm，单位时间发出的总光功率）。
 *     Three.js 的 SpotLight / PointLight 的 `intensity` 单位是**坎德拉 cd**
 *     （单位立体角光强 I），RectAreaLight 的 `intensity` 单位是**勒克司 lx**
 *     （被照面照度 E）。三者物理量不同，不能共用一个换算：
 *       均匀向四周发射的光源：Φ = I · ∫dΩ = I · 4π  →  I = Φ / 4π
 *     这里按均匀球面（全 4π 立体角）折算。对聚光灯这会把实际中心光强
 *     估低约 (2π/Ω_beam) 倍 —— 这是**已知且可接受的近似**，因为真实配光
 *     要读 IES 文件，而本阶段明确没有 IES 解析器（见 `approximated`）。
 *   - RectAreaLight 走面积光源模型，输入近似取 Φ/10 的量级，
 *     仅用于在场景中形成可读的面光响应，不代表实测照度。
 *
 * 配光双轨（ADR-18 / types.ts 红线 5）：
 *   - `photometric.ies` 有值且 IES 缓存就绪 → `isIES = true` 且 `approximated = false`。
 *     此时从 IES 文件解析真实光强矩阵，计算光束角，生成投影纹理附加到 SpotLight.map，
 *     UI 无需标注「配光为近似值」。
 *   - `photometric.ies` 有值但 IES 未就绪/解析失败 → `isIES = true` 且 `approximated = true`。
 *     回退到参数化几何光近似其效果，UI 必须标注「配光为近似值」。
 *   - 无 IES → `isIES = false`，`approximated = false`（纯参数化，无需标注）。
 *
 * 阴影：所有物理光源 `castShadow = true`（配合 backend.ts 中
 * `renderer.shadowMap.enabled = true` + `PCFSoftShadowMap`）。
 * 例外：RectAreaLight 不支持阴影（Three.js 引擎限制），不进入该路径。
 * 灯罩 Mesh 一律 `castShadow = receiveShadow = false`：它是光源本身的
 * 可视化替身，若让它投射阴影，会把自己的光照成一片黑斑。
 */

import {
  CircleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  RectAreaLight,
  SphereGeometry,
  SpotLight,
} from 'three';
import type { DataTexture, Light } from 'three';
import type { Fixture, Photometric, ShadeForm } from '../core/types.js';
import { computeBeamAngle } from './iesParser.js';
import { createSpotlightPatternTexture } from './iesTexture.js';
import { getIESForFixture } from './iesCache.js';

/** 均匀球面折算系数：lm → cd（I = Φ / 4π） */
const STERADIAN_SPHERE = 4 * Math.PI;

/** 无光通量数据时的最低强度（避免完全看不见的黑灯） */
const MIN_INTENSITY = 0.1;

/** SpotLight 默认投射距离（米） */
const SPOT_DISTANCE = 10;

/** 全向点光源默认投射距离（米） */
const POINT_DISTANCE = 5;

/** SpotLight 半角下限：为 0 时 Three.js 会产生 NaN */
const MIN_HALF_ANGLE = 0.02;

/** 阴影贴图尺寸（P9 从 2048 降到 1024：阴影预算收敛，恢复帧率） */
const SHADOW_MAP_SIZE = 1024;

/** 点光源阴影贴图尺寸（已不投阴影，保留以防回退） */
const POINT_SHADOW_MAP_SIZE = 512;

/**
 * P9 阴影预算：**只有向下投射的光投阴影**。
 *
 * 实测：默认场景 4 盏投阴影光（1 directional + 1 spot + 2 point），
 * 每帧渲染 14 张阴影贴图（PointLight 是立方体贴图 = 6 面），
 * HUD 帧率 5-8 FPS，控制台 `Runtime.evaluate` 都会超时。
 *
 * `downlight` / `spot` 的阴影落在活动区工作面上，视觉价值最高；
 * `pendant` / `sconce` / `floor` / `table` 的阴影是「灯下暗斑」，
 * 视觉收益低、性能成本高，一律不投。这是**有意的产品取舍**，
 * 不是 bug —— 若未来需要恢复，改这里即可。
 */
const SHADOW_CASTING_FIXTURE_TYPES: ReadonlySet<string> = new Set([
  'downlight',
  'spot',
]);

/**
 * 判断某灯具类型是否投阴影（纯函数，供单测）。
 * 未在集合内的类型（pendant / sconce / floor / table / linear / cove）都不投。
 */
export function fixtureCastsShadow(type: string): boolean {
  return SHADOW_CASTING_FIXTURE_TYPES.has(type);
}

/**
 * 灯罩发光强度满量程系数（P8b）。emissiveIntensity = clamp(level,0,1) * 该值
 * （规格公式另乘 shade.intensity，但 ShadeMaterial 当前无此字段，取 1）。
 * 3.0 让灯罩亮度超过 bloom threshold（0.85）被辉光抓到；MeshStandardMaterial
 * 的 emissiveIntensity 可 >1（HDR），配合 ACESFilmic 不会溢出屏幕。
 */
export const SHADE_EMISSIVE_SCALE = 3.0;

// ---------------------------------------------------------------------------
// 物理量换算
// ---------------------------------------------------------------------------

/**
 * 色温（K）→ 归一化 sRGB 分量。
 *
 * Tanner Helland 近似算法：temp 以 100K 为单位。
 *   - ≤ 6600K：R 恒为 255，G / B 随色温单调变化；
 *     B 在 ≤ 1900K 时为 0（极暖白光几乎无蓝分量）。
 *   - > 6600K：R / G 随色温升高而衰减（越冷越蓝），B 恒为 255。
 *
 * 输入经 [1000, 40000] 截断：超出该区间公式无物理意义，
 * 截断比静默返回 NaN 更安全。
 *
 * @param kelvin 色温，K
 * @returns 归一化到 0..1 的 sRGB 分量
 */
export function cctToRGB(kelvin: number): { r: number; g: number; b: number } {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = Math.min(255, Math.max(0, 99.476 * Math.log(temp) - 161.12));
    b = temp <= 19 ? 0 : Math.min(255, Math.max(0, 138.52 * Math.log(temp - 10) - 305.04));
  } else {
    r = Math.min(255, Math.max(0, 329.7 * Math.pow(temp - 60, -0.1332)));
    g = Math.min(255, Math.max(0, 288.12 * Math.pow(temp - 60, -0.0755)));
    b = 255;
  }

  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** 光束角（度）→ 半角（弧度）。Three.js SpotLight 的 `angle` 是半角。 */
function beamAngleToHalfAngle(beamAngle: number): number {
  return Math.max(MIN_HALF_ANGLE, ((beamAngle * Math.PI) / 180) / 2);
}

/** 从 Photometric 取光通量（lm）。IES 分支无 `lumens` 字段，返回 0。 */
function extractLumens(photometric: Photometric): number {
  return photometric.ies === undefined ? photometric.lumens : 0;
}

/** 从 Photometric 取光束角（度）。IES 分支无 `beamAngle`，用 60° 兜底。 */
function extractBeamAngle(photometric: Photometric): number {
  return photometric.ies === undefined ? photometric.beamAngle : 60;
}

/**
 * 配光是否声明了 IES 文件。
 * 直接读 `photometric.ies !== undefined`：本阶段无法校验 IES 校验和，
 * 声明即视为「走 IES 近似路径」。
 */
function declaresIES(photometric: Photometric): boolean {
  return photometric.ies !== undefined;
}

// ---------------------------------------------------------------------------
// 灯罩可视化
// ---------------------------------------------------------------------------

/** 按 shape.form 选择灯罩几何：球/盘类用贴合造型，其余一律小球兜底。 */
function shadeGeometry(form: ShadeForm, diameter: number): SphereGeometry | CircleGeometry {
  const radius = Math.max(0.005, diameter / 2);
  switch (form) {
    case 'sphere':
      return new SphereGeometry(radius, 16, 12);
    case 'disc':
    case 'plane':
      return new CircleGeometry(radius, 24);
    default:
      return new SphereGeometry(radius, 12, 8);
  }
}

// ---------------------------------------------------------------------------
// 构建结果
// ---------------------------------------------------------------------------

/** buildLightFromFixture 的返回值 */
export interface LightBuildResult {
  /** 场景图根节点：内含光源 + 灯罩 Mesh，整体加入场景即可 */
  object: Object3D;
  /** 物理光源（本实现所有类型都能建模，故总有值） */
  light?: Light;
  /**
   * 灯罩可视化 Mesh（P8b）。暴露给引擎：setFixtureLevel 同步
   * `emissiveIntensity`、setFixtureCct 同步 `emissive` 颜色，
   * 让灯具是「可见的发光体」而非隐形光源。
   */
  shade: Mesh | null;
  /** 声明了 IES 文件（但本阶段未真实解析，仍为近似） */
  isIES: boolean;
  /** 配光是否为近似值（用于 UI 标注，工程红线 5） */
  approximated: boolean;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 由 Fixture 构建 Three.js 光源 + 灯罩。
 *
 * 类型 → 光源映射：
 *   downlight / recessed → SpotLight，朝正下方，半角取 beamAngle
 *   spot                 → SpotLight，按 rot.pitch / rot.yaw 偏转
 *   pendant              → PointLight（悬挂，全向）
 *   linear               → RectAreaLight（长条面光）
 *   cove                 → RectAreaLight（极窄面光，灯槽洗墙）
 *   sconce               → PointLight（壁灯，全向）
 *   floor                → PointLight（落地灯，全向）
 *   table                → PointLight（台灯，投射距离较短）
 *
 * `mount` 表达安装姿态（ceiling / recessed / suspended / wall / floor /
 * tabletop）；出光方向由类型 + `rot` 决定，`mount` 主要用于约束姿态合法性。
 *
 * @param f Fixture 数据（pos 为世界坐标，唯一权威数据源）
 */
export function buildLightFromFixture(f: Fixture): LightBuildResult {
  const [fx, fy, fz] = f.pos;

  const group = new Object3D();
  group.name = f.id;
  group.position.set(fx, fy, fz);

  // --- 色温 → 颜色 --------------------------------------------------------
  // cct 可以是固定值或可调区间；区间取中点作为渲染色。
  const kelvin =
    typeof f.electrical.cct === 'number'
      ? f.electrical.cct
      : (f.electrical.cct[0] + f.electrical.cct[1]) / 2;
  const { r, g, b } = cctToRGB(kelvin);
  const color = new Color(r, g, b);

  // --- IES 配光数据（P6）-------------------------------------------------
  // 从缓存获取 IES 数据；就绪时使用真实配光，未就绪时回退到参数化路径。
  const iesResult = getIESForFixture(f);
  const iesData = iesResult.status === 'ready' ? iesResult.data : undefined;
  const hasIES = iesData !== undefined;

  // --- 光通量 → 光强（lm → cd，均匀球面折算）-----------------------------
  // IES 就绪：从 IES 文件读取光通量，用 computeTotalLumens 计算实际光通量
  // 参数化路径：从 photometric.lumens 读取
  const lumens = hasIES && iesData ? iesData.lumens : extractLumens(f.photometric);
  const candela = lumens > 0 ? lumens / STERADIAN_SPHERE : MIN_INTENSITY;

  // --- IES 分支判定 -------------------------------------------------------
  // isIES：声明了 IES 文件
  // approximated：声明了 IES 但未成功解析（回退到参数化）→ true
  //             成功解析了 IES → false（真实配光，UI 无需标注"近似"）
  //             无 IES 声明 → false（纯参数化，不需要标注）
  const isIES = declaresIES(f.photometric);
  const approximated = isIES && !hasIES;

  // --- 光束角 -------------------------------------------------------------
  // IES 就绪：从 IES 光强矩阵计算光束角
  // 参数化路径：从 photometric.beamAngle 读取
  const beamAngle = hasIES && iesData
    ? beamAngleToHalfAngle(computeBeamAngle(iesData))
    : beamAngleToHalfAngle(extractBeamAngle(f.photometric));

  // --- IES 投影纹理（供 SpotLight.map）-----------------------------------
  // 仅 SpotLight 类型使用（downlight / spot），PointLight/RectAreaLight 不用
  let iesPatternTexture: DataTexture | null = null;
  if (hasIES && iesData && (f.type === 'downlight' || f.type === 'spot')) {
    iesPatternTexture = createSpotlightPatternTexture(iesData);
  }

  let light: Light;

  switch (f.type) {
    case 'downlight': {
      // 嵌入式筒灯：固定朝正下方，光束角即配光半角。
      // penumbra 0.25 模拟真实筒灯的柔边；decay 2 = 物理平方反比衰减。
      // IES 就绪时附加投影纹理，按真实配光调制光强。
      const spot = new SpotLight(color, candela, SPOT_DISTANCE, beamAngle, 0.25, 2);
      spot.position.set(fx, fy, fz);
      spot.target.position.set(fx, 0, fz); // 指向地面上的同 x/z 点
      spot.castShadow = true;
      spot.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      if (iesPatternTexture) {
        spot.map = iesPatternTexture;
      }
      group.add(spot, spot.target);
      light = spot;
      break;
    }

    case 'spot': {
      // 可调角度射灯：按 rot.pitch（俯仰，向下为正）+ rot.yaw（方位）投射。
      const pitch = f.rot.pitch;
      const yaw = f.rot.yaw;
      const spot = new SpotLight(color, candela, SPOT_DISTANCE, beamAngle, 0.15, 2);
      spot.position.set(fx, fy, fz);
      // 单位方向向量外推 5m 得到 target 落点
      const dist = 5;
      spot.target.position.set(
        fx + Math.cos(pitch) * Math.sin(yaw) * dist,
        fy - Math.sin(pitch) * dist,
        fz + Math.cos(pitch) * Math.cos(yaw) * dist,
      );
      spot.castShadow = true;
      spot.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      if (iesPatternTexture) {
        spot.map = iesPatternTexture;
      }
      group.add(spot, spot.target);
      light = spot;
      break;
    }

    case 'pendant':
    case 'sconce':
    case 'floor':
    case 'table': {
      // 全向点光源：吊灯 / 壁灯 / 落地灯 / 台灯。
      // decay 2 = 物理平方反比衰减；台灯距离更短（近距离照明）。
      // P9 阴影预算：不投阴影（立方体贴图 6 面/盏，成本高、视觉收益低）。
      const distance = f.type === 'table' ? POINT_DISTANCE * 0.6 : POINT_DISTANCE;
      const point = new PointLight(color, candela, distance, 2);
      point.position.set(fx, fy, fz);
      point.castShadow = fixtureCastsShadow(f.type);
      if (point.castShadow) {
        point.shadow.mapSize.set(POINT_SHADOW_MAP_SIZE, POINT_SHADOW_MAP_SIZE);
      }
      group.add(point);
      light = point;
      break;
    }

    case 'linear':
    case 'cove': {
      // 面光源：线性灯（linear）为长条，灯槽（cove）为极窄条用于洗墙。
      // RectAreaLight.intensity 单位为 lx（照度），量级取 Φ/10 作可读近似。
      // RectAreaLight 不支持阴影（引擎限制），故不设置 castShadow。
      const width = f.shape.diameter;
      const depthDim = f.type === 'cove' ? 0.1 : 0.3;
      const rect = new RectAreaLight(color, lumens > 0 ? lumens / 10 : MIN_INTENSITY, width, depthDim);
      rect.position.set(fx, fy, fz);
      // 默认面朝 +Z，按 rot 旋转到出光方向
      rect.rotation.set(f.rot.pitch, f.rot.yaw, 0);
      group.add(rect);
      light = rect;
      break;
    }

    default: {
      // 兜底：任何未显式映射的类型用 PointLight，保证场景不会缺一盏灯。
      // P9 阴影预算：兜底点光源也不投阴影（立方体贴图 6 面/盏，成本高、视觉收益低）。
      const point = new PointLight(color, candela, POINT_DISTANCE, 2);
      point.position.set(fx, fy, fz);
      point.castShadow = fixtureCastsShadow(f.type);
      group.add(point);
      light = point;
      break;
    }
  }

  // --- 灯罩 Mesh（可视化替身 + 可见发光体，P8b） --------------------------
  // 除反射光外，让灯罩自身发光（emissive）：灯具是「可见的亮点」而非隐形光源。
  // emissive 颜色 = 光源色温色（cctToRGB）；emissiveIntensity 初始按全亮，
  // 由引擎 setFixtureLevel 按当前 level 同步（公式见 sceneEngine）。
  const shade = f.shape.shade;
  const shadeMat = new MeshStandardMaterial({
    color: new Color(shade.color),
    roughness: shade.roughness,
    metalness: shade.metalness,
    emissive: new Color(r, g, b),
    emissiveIntensity: SHADE_EMISSIVE_SCALE,
  });
  const shadeMesh = new Mesh(shadeGeometry(f.shape.form, f.shape.diameter), shadeMat);
  shadeMesh.position.set(fx, fy, fz);
  // 出光面朝向 = rot 姿态
  shadeMesh.rotation.set(f.rot.pitch, f.rot.yaw, 0);
  // 灯罩不投/收阴影：否则它会把自家光源照成黑斑
  shadeMesh.castShadow = false;
  shadeMesh.receiveShadow = false;
  shadeMesh.name = `${f.id}-shade`;
  group.add(shadeMesh);

  return { object: group, light, shade: shadeMesh, isIES, approximated };
}
