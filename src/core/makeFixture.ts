/**
 * 灯具工厂（ADR-18 双轨：SKU 真实灯 + 参数化自由灯）。
 *
 * - makeFixture(custom)：参数化自由灯，仅方案推敲，不进采购清单。
 * - makeFixture(sku)：带 IES 的真实产品，可进采购清单。
 *
 * source 字段决定后续是否进入 BOM（§8）。
 */

import type { CCTValue, Fixture, FixtureType, MountType, Photometric, ShadeForm } from './types.js';

let fixtureSeq = 0;

export interface FixtureOptions {
  type?: FixtureType;
  mount?: MountType;
  form?: ShadeForm;
  diameter?: number;
  height?: number;
  aperture?: number;
  /** 光通量 lm（参数化路径） */
  lumens?: number;
  /** 光束角，度 */
  beamAngle?: number;
  /** 配光类型描述 */
  distribution?: string;
  /** IES 文件路径（给了就用真实配光） */
  ies?: string;
  cct?: CCTValue;
  cri?: number;
  watt?: number;
  dimFloor?: number;
  group?: string;
  circuit?: string;
  pos?: readonly [x: number, y: number, z: number];
  /** P37c-fix：安装面法线（朝房间内）。仅 mount='wall' 时需要。 */
  installNormal?: readonly [x: number, y: number, z: number];
  rot?: { pitch: number; yaw: number };
  source?: 'sku' | 'custom';
  skuId?: string;
}

const FORM_DEFAULTS: Record<ShadeForm, { diameter: number; height: number; aperture: number }> = {
  // P29：适度提升（真实数据），与 SHADE_VISUAL_SCALE=6.0 配合让默认工程 3 盏灯更醒目
  cone: { diameter: 0.14, height: 0.22, aperture: 0.11 },
  cylinder: { diameter: 0.18, height: 0.35, aperture: 0.17 },
  sphere: { diameter: 0.28, height: 0.28, aperture: 0.28 },
  disc: { diameter: 0.22, height: 0.05, aperture: 0.20 },
  line: { diameter: 0.05, height: 1.4, aperture: 0.05 },
  plane: { diameter: 0.7, height: 0.03, aperture: 0.68 },
  custom: { diameter: 0.22, height: 0.22, aperture: 0.22 },
};

const TYPE_DEFAULTS: Record<FixtureType, { form: ShadeForm; mount: MountType; lumens: number; beamAngle: number }> =
  {
    downlight: { form: 'disc', mount: 'recessed', lumens: 400, beamAngle: 36 },
    spot: { form: 'cone', mount: 'recessed', lumens: 500, beamAngle: 24 },
    pendant: { form: 'cylinder', mount: 'suspended', lumens: 800, beamAngle: 60 },
    linear: { form: 'line', mount: 'ceiling', lumens: 1600, beamAngle: 90 },
    cove: { form: 'plane', mount: 'ceiling', lumens: 2000, beamAngle: 120 },
    sconce: { form: 'cone', mount: 'wall', lumens: 300, beamAngle: 45 },
    floor: { form: 'cylinder', mount: 'floor', lumens: 600, beamAngle: 60 },
    table: { form: 'cylinder', mount: 'tabletop', lumens: 400, beamAngle: 50 },
    chandelier: { form: 'sphere', mount: 'suspended', lumens: 1200, beamAngle: 100 },  // P37d
  };

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const type = opts.type ?? 'downlight';
  const td = TYPE_DEFAULTS[type];
  const form = opts.form ?? td.form;
  const fd = FORM_DEFAULTS[form];

  const photometric: Photometric = opts.ies
    ? { ies: opts.ies, iesVerified: true }
    : {
        lumens: opts.lumens ?? td.lumens,
        beamAngle: opts.beamAngle ?? td.beamAngle,
        distribution: opts.distribution ?? 'symmetric',
        ies: undefined,
        iesVerified: false,
        iesChecksum: undefined,
      };

  return {
    id: opts.skuId ?? `fx-${++fixtureSeq}`,
    type,
    mount: opts.mount ?? td.mount,
    shape: {
      form,
      diameter: opts.diameter ?? fd.diameter,
      height: opts.height ?? fd.height,
      aperture: opts.aperture ?? fd.aperture,
      shade: { transmission: 0.85, roughness: 0.4, metalness: 0.1, color: '#ffffff' },
    },
    pos: opts.pos ?? [0, 2.4, 0],
    ...(opts.installNormal !== undefined
      ? { installNormal: opts.installNormal }
      : {}),
    rot: opts.rot ?? { pitch: 0, yaw: 0 },
    photometric,
    electrical: {
      cct: opts.cct ?? 3000,
      cri: opts.cri ?? 85,
      watt: opts.watt ?? 9,
      dimFloor: opts.dimFloor ?? 0.1,
    },
    control: { group: opts.group ?? 'ambient', circuit: opts.circuit ?? 'main', sceneLevels: {} },
    binding: null,
    lockedFields: new Set(),
    source: opts.source ?? 'custom',
  };
}
