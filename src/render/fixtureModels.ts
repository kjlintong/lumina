/**
 * P30 · 灯具类型独立几何模型
 *
 * P29b 前 `buildLightFromFixture` 里 shade 只按 `shape.form` 落到七种兜底
 * 几何里，8 种灯具类型的可视化几乎无差别（筒灯/射灯/落地灯/台灯看着
 * 都是圆柱或圆盘）。P30 给每类灯具写独立几何：外壳（不发光的金属质感）
 * + 灯罩（发光体，供 sceneEngine 做选中高亮）+ 支架/底座。
 *
 * 物理量口径不变：
 *  - light 位置与参数（SpotLight/PointLight/RectAreaLight/IES）由
 *    lightBuilder 负责，本文件只生成可视化替身。
 *  - SHADE_VISUAL_SCALE 保留 P29 的 6.0，几何都在这个尺度下放大到可见。
 *  - 灯罩 material 必须有 `emissive`（sceneEngine.applyFixtureIntensity
 *    与 applyFixtureCct 依赖 `entry.shade.material.emissive`）。
 *  - 每个模型的 shade Mesh 由 lightBuilder 打 `-shade` 后缀名（P29b
 *    拖放命中判定依赖 `name.endsWith('-shade')`）。
 *
 * 本文件不改 store / ui / sceneEngine / types，不引入新依赖。
 */

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Fixture, FixtureType, ShadeMaterial } from '../core/types.js';
import { SHADE_VISUAL_SCALE } from './lightBuilder.js';

/** 视觉尺度：由 lightBuilder 集中导出（P29 的 6.0，不可本地覆写）。 */
const S = SHADE_VISUAL_SCALE;

export interface FixtureModelResult {
  /** 灯具组（含外壳 + 灯罩 + 支架，不含 light） */
  group: Group;
  /** 主灯罩 Mesh（发光体，供 sceneEngine 选中高亮 emissive 更新） */
  shade: Mesh;
  /** 冗余记录灯具类型，便于调试 */
  type: FixtureType;
}

// ---------------------------------------------------------------------------
// 材质工厂
// ---------------------------------------------------------------------------

/**
 * 外壳材质：暗色金属漆（不发光）。所有 shell/trim/base/pole/wire 用它。
 */
export function makeShellMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color('#2a2a2e'),
    roughness: 0.4,
    metalness: 0.85,
  });
}

/**
 * 乳白扩散板材质（半透）。P30 保留工厂以便未来做扩散板独立几何，
 * 当前无调用点——保留为公开 API（未来 Phase 2 可能接内部光源可视化）。
 */
export function makeDiffuserMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color('#f5f0e8'),
    roughness: 0.8,
    transmission: 0.2,
    thickness: 0.01,
  });
}

/**
 * 灯罩（发光体）材质。
 *
 * 初始 emissive 为纯白、emissiveIntensity=0；lightBuilder 会在 group 装好
 * 后按色温（cctToRGB）和 SHADE_EMISSIVE_SCALE 更新 emissive 与 intensity，
 * 之后 sceneEngine 按 level/选中态维护。mat 参数用来设置 diffuse base
 * 颜色（保持 Fixture.shape.shade.color 的数据契约）。
 */
function makeGlowMaterial(mat: ShadeMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(mat.color),
    emissive: new Color('#ffffff'),
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0,
  });
}

// ---------------------------------------------------------------------------
// 8 类灯具独立几何
// ---------------------------------------------------------------------------

/** 筒灯：天花板嵌入圆环（trim）+ 圆形乳白扩散板（发光） */
export function buildDownlightModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 外壳：扁圆环（trim）
  const trimGeo = new TorusGeometry(r, r * 0.08, 8, 32);
  const trim = new Mesh(trimGeo, makeShellMaterial());
  trim.rotation.x = Math.PI / 2;
  trim.position.y = -0.01 * S; // 略低于天花
  group.add(trim);
  // 灯罩：圆形扩散板（发光）
  const shadeGeo = new CircleGeometry(r * 0.85, 32);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.rotation.x = -Math.PI / 2; // 面朝 -Y（朝下）
  shade.position.y = -0.005 * S;
  group.add(shade);
  return { group, shade, type: 'downlight' };
}

/** 射灯：嵌入圆环 + 向下突出的圆锥灯罩 */
export function buildSpotModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 外壳圆环
  const trimGeo = new TorusGeometry(r, r * 0.06, 8, 24);
  const trim = new Mesh(trimGeo, makeShellMaterial());
  trim.rotation.x = Math.PI / 2;
  group.add(trim);
  // 灯罩外壳：向下突出的圆锥（开口朝下）
  const coneGeo = new CylinderGeometry(r * 0.5, r * 0.85, r * 1.5, 24, 1, true);
  const cone = new Mesh(coneGeo, makeShellMaterial());
  cone.position.y = -r * 0.6;
  group.add(cone);
  // 发光盘：锥形底部开口
  const shadeGeo = new CircleGeometry(r * 0.5, 24);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -r * 1.3;
  group.add(shade);
  return { group, shade, type: 'spot' };
}

/** 吊灯：1m 长吊线 + 球形灯罩 + 顶部装饰帽（连接天花） */
export function buildPendantModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 吊线：细长圆柱
  const wireGeo = new CylinderGeometry(0.005 * S, 0.005 * S, 1.0 * S, 8);
  const wire = new Mesh(wireGeo, makeShellMaterial());
  wire.position.y = 0.5 * S;
  group.add(wire);
  // 灯罩：球形
  const shadeGeo = new SphereGeometry(r, 24, 16);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.position.y = -0.1 * S;
  group.add(shade);
  // 顶部装饰（连接天花）
  const capGeo = new CylinderGeometry(r * 0.15, r * 0.15, 0.03 * S, 16);
  const cap = new Mesh(capGeo, makeShellMaterial());
  cap.position.y = 1.0 * S;
  group.add(cap);
  return { group, shade, type: 'pendant' };
}

/** 线条灯：水平长条灯管 + 两端端盖 + 下侧发光面 */
export function buildLinearModel(d: number, h: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const width = Math.max(0.05, d) * S; // 长条长（沿世界 X）
  const tubeR = Math.max(0.02, h / 2) * S;
  // 灯管：水平圆柱（rotation.z = π/2 让 axis 沿 X）
  const tubeGeo = new CylinderGeometry(tubeR, tubeR, width, 16, 1);
  const tube = new Mesh(tubeGeo, makeShellMaterial());
  tube.rotation.z = Math.PI / 2;
  group.add(tube);
  // 发光面：贴在灯管下侧
  const shadeGeo = new BoxGeometry(width * 0.9, tubeR * 0.3, tubeR * 1.4);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.position.y = -tubeR * 0.5;
  group.add(shade);
  // 两端端盖
  for (const sign of [-1, 1]) {
    const capGeo = new CylinderGeometry(tubeR * 1.1, tubeR * 1.1, 0.02 * S, 16);
    const cap = new Mesh(capGeo, makeShellMaterial());
    cap.rotation.z = Math.PI / 2;
    cap.position.x = sign * width * 0.5;
    group.add(cap);
  }
  return { group, shade, type: 'linear' };
}

/** 灯带：贴合墙/天花边的细长条（暗槽造型） */
export function buildCoveModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const width = Math.max(0.3, d) * S;
  const height = 0.02 * S;
  // 外壳槽
  const shellGeo = new BoxGeometry(width, height, height * 2);
  const shell = new Mesh(shellGeo, makeShellMaterial());
  group.add(shell);
  // 发光条：贴在槽内底
  const shadeGeo = new BoxGeometry(width * 0.98, height * 0.15, height * 0.8);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.position.y = -height * 0.3;
  group.add(shade);
  return { group, shade, type: 'cove' };
}

/** 壁灯：墙面背板 + 面向房间的半圆柱灯罩（凸出） */
export function buildSconceModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 背板：贴在墙上的扁圆柱（axis 沿 Z）
  const plateGeo = new CylinderGeometry(r * 0.4, r * 0.4, 0.02 * S, 16);
  const plate = new Mesh(plateGeo, makeShellMaterial());
  plate.rotation.x = Math.PI / 2;
  group.add(plate);
  // 灯罩：半圆柱（thetaStart=0, length=π 是 +X 侧半柱；rotation.x = -π/2 让平切口朝 -Y，凸出朝 +Z）
  const shadeGeo = new CylinderGeometry(r, r, r * 1.5, 16, 1, true, 0, Math.PI);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.rotation.x = -Math.PI / 2;
  shade.position.z = r * 0.5;
  group.add(shade);
  return { group, shade, type: 'sconce' };
}

/** 落地灯：地面底座圆盘 + 细杆支架 + 顶部球形灯罩 */
export function buildFloorModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 底座
  const baseGeo = new CylinderGeometry(r * 0.4, r * 0.4, 0.02 * S, 16);
  const base = new Mesh(baseGeo, makeShellMaterial());
  base.position.y = 0.01 * S;
  group.add(base);
  // 支架杆
  const poleGeo = new CylinderGeometry(0.015 * S, 0.015 * S, 1.5 * S, 8);
  const pole = new Mesh(poleGeo, makeShellMaterial());
  pole.position.y = 0.75 * S;
  group.add(pole);
  // 顶部灯罩（球）
  const shadeGeo = new SphereGeometry(r, 20, 14);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.position.y = 1.55 * S;
  group.add(shade);
  return { group, shade, type: 'floor' };
}

/** 台灯：桌面矮底座 + 短杆 + 圆筒灯罩 */
export function buildTableModel(d: number, mat: ShadeMaterial): FixtureModelResult {
  const group = new Group();
  const r = Math.max(0.02, d / 2) * S;
  // 底座
  const baseGeo = new CylinderGeometry(r * 0.35, r * 0.35, 0.03 * S, 16);
  const base = new Mesh(baseGeo, makeShellMaterial());
  base.position.y = 0.015 * S;
  group.add(base);
  // 短杆
  const poleGeo = new CylinderGeometry(0.01 * S, 0.01 * S, 0.35 * S, 8);
  const pole = new Mesh(poleGeo, makeShellMaterial());
  pole.position.y = 0.2 * S;
  group.add(pole);
  // 圆筒灯罩（开口上下，发光）
  const shadeGeo = new CylinderGeometry(r * 0.7, r * 0.7, r * 0.7, 16, 1, true);
  const shade = new Mesh(shadeGeo, makeGlowMaterial(mat));
  shade.position.y = 0.4 * S;
  group.add(shade);
  return { group, shade, type: 'table' };
}

// ---------------------------------------------------------------------------
// 分发
// ---------------------------------------------------------------------------

/**
 * 按 fixture.type 分发到对应模型构建器。所有 8 类都返回 { group, shade, type }；
 * 未识别类型回落 pendant（保守兜底，避免 sceneEngine 拿不到 shade Mesh）。
 */
export function buildFixtureModel(f: Fixture): FixtureModelResult {
  switch (f.type) {
    case 'downlight':
      return buildDownlightModel(f.shape.diameter, f.shape.shade);
    case 'spot':
      return buildSpotModel(f.shape.diameter, f.shape.shade);
    case 'pendant':
      return buildPendantModel(f.shape.diameter, f.shape.shade);
    case 'linear':
      return buildLinearModel(f.shape.diameter, f.shape.height, f.shape.shade);
    case 'cove':
      return buildCoveModel(f.shape.diameter, f.shape.shade);
    case 'sconce':
      return buildSconceModel(f.shape.diameter, f.shape.shade);
    case 'floor':
      return buildFloorModel(f.shape.diameter, f.shape.shade);
    case 'table':
      return buildTableModel(f.shape.diameter, f.shape.shade);
    default:
      return buildPendantModel(f.shape.diameter, f.shape.shade);
  }
}
