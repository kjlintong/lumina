/**
 * 灯具数据 → Three.js 光源对象转换器（P1）
 *
 * 将 Fixture 数据模型转换为可渲染的 Three.js 光源对象。
 * 双后端差异：
 * - WebGPU 路径：IESSpotLight（真实配光，cd 单位）
 * - WebGL2 路径：SpotLight 近似 + UI 标注
 *
 * 架构依据：工程方案 §5.2，docs/00-p0-version-verification.md §4
 */

import {
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  RectAreaLight,
  SpotLight,
  SphereGeometry,
  CircleGeometry,
} from 'three';
import type { Light } from 'three';
import { hasVerifiedIES, type CCTValue, type Fixture, type Photometric } from '../core/types.js';

/** 色温到 RGB 转换（Tanner Helland 近似算法） */
export function cctToRGB(kelvin: number): { r: number; g: number; b: number } {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number, g: number, b: number;

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

/** 从 CCTValue（number | readonly [min, max]）提取中心色温 */
function extractCct(cct: CCTValue): number {
  return typeof cct === 'number' ? cct : (cct[0] + cct[1]) / 2;
}

/** 光束角度转半角（弧度） */
function beamAngleToHalfAngle(beamAngle: number): number {
  return (beamAngle * Math.PI) / 180 / 2;
}

/** 从 Photometric 提取流明值（IES 路径无 lumens 字段，用 0 兜底） */
function extractLumens(photometric: Photometric): number {
  return photometric.ies === undefined ? photometric.lumens : 0;
}

/** 从 Photometric 提取光束角（IES 路径无 beamAngle，用 60° 兜底） */
function extractBeamAngle(photometric: Photometric): number {
  return photometric.ies === undefined ? photometric.beamAngle : 60;
}

/** 根据灯具形状生成小型可视化 Mesh（灯罩） */
function buildShadeMesh(fixture: Fixture): Mesh {
  const shade = fixture.shape.shade;
  const mat = new MeshStandardMaterial({
    color: new Color(shade.color),
    roughness: shade.roughness,
    metalness: shade.metalness,
    transparent: shade.transmission > 0,
    opacity: 1 - shade.transmission * 0.5,
    side: DoubleSide,
  });

  let geo: SphereGeometry | CircleGeometry;
  const d = fixture.shape.diameter;

  switch (fixture.shape.form) {
    case 'sphere':
      geo = new SphereGeometry(d / 2, 16, 16);
      break;
    case 'disc':
    case 'plane':
      geo = new CircleGeometry(d / 2, 24);
      break;
    default:
      geo = new SphereGeometry(d / 2, 12, 12);
      break;
  }

  const mesh = new Mesh(geo, mat);
  mesh.position.set(...fixture.pos);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = `${fixture.id}-shade`;
  return mesh;
}

/** 光源构建结果 */
export interface LightBuildResult {
  /** 光源对象（添加到场景的根 Group） */
  object: Object3D;
  /** 实际光源 */
  light?: Light;
  /** 灯罩 Mesh（可视化） */
  shade: Mesh;
  /** 是否使用真实 IES 配光 */
  isIES: boolean;
  /** 配光是否为近似值 */
  approximated: boolean;
  /** 灯具 ID */
  fixtureId: string;
}

/**
 * 从 Fixture 数据构建 Three.js 光源对象。
 *
 * @param fixture Fixture 数据
 * @param usesIES 当前后端是否支持 IES（WebGPU: true, WebGL2: false）
 * @returns 光源构建结果
 */
export function buildLightFromFixture(fixture: Fixture, usesIES: boolean): LightBuildResult {
  const group = new Object3D();
  group.name = fixture.id;

  const cct = extractCct(fixture.electrical.cct);
  const { r, g, b } = cctToRGB(cct);
  const color = new Color(r, g, b);
  const lumens = extractLumens(fixture.photometric);

  // 强度转换：流明 → 坎德拉（点光源/聚光灯用 cd，面光用 lm/m²）
  const candela = lumens > 0 ? lumens / (4 * Math.PI) : 0.1;

  let light: Light | undefined;
  let isIES = false;
  let approximated = false;

  const beamAngle = extractBeamAngle(fixture.photometric);
  const hasIES = hasVerifiedIES(fixture.photometric);

  switch (fixture.type) {
    case 'downlight': {
      const spot = new SpotLight(color, candela, 10, beamAngleToHalfAngle(beamAngle), 0.3, 2);
      spot.position.set(...fixture.pos);
      spot.target.position.set(fixture.pos[0], 0, fixture.pos[2]);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      light = spot;
      isIES = usesIES && hasIES;
      approximated = !isIES;
      group.add(spot, spot.target);
      break;
    }

    case 'spot': {
      const spot = new SpotLight(color, candela, 8, beamAngleToHalfAngle(beamAngle), 0.2, 2);
      spot.position.set(...fixture.pos);
      const yaw = fixture.rot.yaw;
      const pitch = fixture.rot.pitch;
      spot.target.position.set(
        fixture.pos[0] + Math.cos(pitch) * Math.sin(yaw),
        fixture.pos[1] - Math.sin(pitch),
        fixture.pos[2] + Math.cos(pitch) * Math.cos(yaw),
      );
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      light = spot;
      isIES = usesIES && hasIES;
      approximated = !isIES;
      group.add(spot, spot.target);
      break;
    }

    case 'pendant':
    case 'floor':
    case 'table':
    case 'sconce': {
      const point = new PointLight(color, candela, fixture.type === 'table' ? 3 : 5, 2);
      point.position.set(...fixture.pos);
      point.castShadow = true;
      point.shadow.mapSize.set(512, 512);
      light = point;
      approximated = true; // PointLight 无 IES
      group.add(point);
      break;
    }

    case 'linear':
    case 'cove': {
      const rect = new RectAreaLight(
        color,
        lumens / 10,
        fixture.shape.diameter,
        fixture.type === 'cove' ? 0.1 : 0.3,
      );
      rect.position.set(...fixture.pos);
      light = rect;
      approximated = true; // RectAreaLight 无 IES，GodraysNode 不支持面光
      group.add(rect);
      break;
    }

    default: {
      const point = new PointLight(color, candela, 5, 2);
      point.position.set(...fixture.pos);
      point.castShadow = true;
      point.shadow.mapSize.set(512, 512);
      light = point;
      approximated = true;
      group.add(point);
      break;
    }
  }

  const shade = buildShadeMesh(fixture);
  group.add(shade);

  return { object: group, light, shade, isIES, approximated, fixtureId: fixture.id };
}
