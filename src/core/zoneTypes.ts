/**
 * 活动区类型库（§4.6.3 / ADR-16）：预设 10 类，用户可新建个人模板。
 *
 * 每类带默认工作面高度、目标照度、推荐色温、需求说明与建议灯型。
 * 数值取自工程方案 §4.6.5 的示例表与常见住宅经验值；均为**需求侧默认值**，
 * 用户可覆盖（§4.6.3「参数覆盖」）。
 */

import type { ActivityZone, ActivityZoneType, SuggestedFixture } from './types.js';

export interface ZoneTypeTemplate {
  key: ActivityZoneType;
  label: string;
  /** 工作面高度（米） */
  planeH: number;
  /** 目标照度（相对估算，lx，需求值） */
  lux: number;
  /** 推荐色温（K） */
  cct: number;
  need: string;
  suggestion: SuggestedFixture[];
  /** 默认区尺寸 [宽, 深] */
  defaultSize: readonly [w: number, d: number];
}

export const ZONE_TYPE_TEMPLATES: Record<string, ZoneTypeTemplate> = {
  sleep: {
    key: 'sleep',
    label: '睡眠',
    planeH: 0.6,
    lux: 50,
    cct: 2700,
    need: '低照度、暖色温，利于褪黑素分泌；避免正对床头的直射强光。',
    suggestion: [
      { type: 'sconce', count: 2, reason: '床头两侧对称壁灯，柔和局部照明' },
      { type: 'downlight', count: 1, reason: '低位主照明，可调光至低亮度' },
    ],
    defaultSize: [1.6, 2.1],
  },
  work: {
    key: 'work',
    label: '工作',
    planeH: 0.75,
    lux: 500,
    cct: 4000,
    need: '桌面 500lx 以上，中性色温，显色指数高，避免眩光与阴影。',
    suggestion: [
      { type: 'spot', count: 1, reason: '桌面重点照明，可调光调色温' },
      { type: 'downlight', count: 2, reason: '环境基础照明，补暗角' },
    ],
    defaultSize: [1.6, 0.8],
  },
  dining: {
    key: 'dining',
    label: '用餐',
    planeH: 0.78,
    lux: 150,
    cct: 3000,
    need: '餐桌面上方局部照明，暖色温突出食物质感；吊灯下沿距桌面约 0.75m。',
    suggestion: [
      { type: 'pendant', count: 1, reason: '餐桌正上方吊灯，沿长边排列' },
    ],
    defaultSize: [1.8, 1.0],
  },
  lounge: {
    key: 'lounge',
    label: '休闲',
    planeH: 0.45,
    lux: 100,
    cct: 2700,
    need: '放松氛围，可调至低亮度；重点照明与洗墙结合。',
    suggestion: [
      { type: 'floor', count: 1, reason: '角落落地灯，营造氛围' },
      { type: 'downlight', count: 2, reason: '环境照明基础' },
    ],
    defaultSize: [2.4, 1.2],
  },
  kitchen: {
    key: 'kitchen',
    label: '厨房操作',
    planeH: 0.9,
    lux: 300,
    cct: 4000,
    need: '操作台面 300lx 以上，操作面局部照明，避免台面阴影。',
    suggestion: [
      { type: 'downlight', count: 3, reason: '沿操作台等距嵌入，消除阴影' },
      { type: 'cove', count: 1, reason: '吊柜下灯带，洗台面' },
    ],
    defaultSize: [2.4, 0.65],
  },
  bathroom: {
    key: 'bathroom',
    label: '卫浴',
    planeH: 1.2,
    lux: 200,
    cct: 3500,
    need: '镜前均匀照明，显色指数高，利于化妆；注意防溅。',
    suggestion: [
      { type: 'sconce', count: 2, reason: '镜两侧对称壁灯，减少面部阴影' },
      { type: 'downlight', count: 2, reason: '基础照明，注意 IP 等级' },
    ],
    defaultSize: [0.9, 0.9],
  },
  reading: {
    key: 'reading',
    label: '阅读角',
    planeH: 0.45,
    lux: 300,
    cct: 3500,
    need: '阅读任务 300lx，色温适中，避免直射入眼。',
    suggestion: [
      { type: 'floor', count: 1, reason: '阅读角落地灯，可调角' },
    ],
    defaultSize: [1.2, 1.2],
  },
  nursery: {
    key: 'nursery',
    label: '婴儿房',
    planeH: 0.6,
    lux: 100,
    cct: 3000,
    need: '柔和暖光，夜间喂奶可用极低亮度；避免过亮影响婴儿作息。',
    suggestion: [
      { type: 'sconce', count: 1, reason: '床头壁灯，夜间低亮度可用' },
      { type: 'downlight', count: 1, reason: '基础照明，需可调至极低' },
    ],
    defaultSize: [1.5, 1.5],
  },
  wardrobe: {
    key: 'wardrobe',
    label: '衣帽间',
    planeH: 1.2,
    lux: 150,
    cct: 4000,
    need: '均匀照明避免衣物色差；显色指数高。',
    suggestion: [
      { type: 'cove', count: 1, reason: '层板灯带，均匀照明' },
      { type: 'downlight', count: 2, reason: '基础照明' },
    ],
    defaultSize: [1.6, 2.0],
  },
  entry: {
    key: 'entry',
    label: '玄关',
    planeH: 0.9,
    lux: 100,
    cct: 3000,
    need: '入口氛围，欢迎感；换鞋区局部照明。',
    suggestion: [
      { type: 'downlight', count: 1, reason: '入口基础照明' },
      { type: 'sconce', count: 1, reason: '装饰壁灯' },
    ],
    defaultSize: [1.2, 1.0],
  },
};

export const ZONE_TYPE_KEYS = Object.keys(ZONE_TYPE_TEMPLATES);

let zoneSeq = 0;

/** 按类型模板创建活动区。pos/size 不传则用模板默认值。 */
export function makeZone(
  type: ActivityZoneType,
  pos: readonly [x: number, z: number] = [0, 0],
  opts: { name?: string; key?: string; rotY?: number; size?: readonly [number, number] } = {},
): ActivityZone {
  const t = ZONE_TYPE_TEMPLATES[type];
  if (!t) {
    // 用户自定义类型：给一个保守默认
    return {
      key: opts.key ?? `zone-${++zoneSeq}`,
      type,
      name: opts.name ?? type,
      pos: [...pos],
      rotY: opts.rotY ?? 0,
      size: opts.size ? [...opts.size] : [1.5, 1.5],
      planeH: 0.75,
      lux: 100,
      cct: 3000,
      need: '',
      suggestion: [],
      fixtures: [],
    };
  }
  return {
    key: opts.key ?? `zone-${++zoneSeq}`,
    type,
    name: opts.name ?? t.label,
    pos: [...pos],
    rotY: opts.rotY ?? 0,
    size: opts.size ? [...opts.size] : [...t.defaultSize],
    planeH: t.planeH,
    lux: t.lux,
    cct: t.cct,
    need: t.need,
    suggestion: t.suggestion.map((s) => ({ ...s })),
    fixtures: [],
  };
}
