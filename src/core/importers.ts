/**
 * 导入源与分档 SLA 声明（执行规格 §6 范围 1 与「明确不做」）。
 *
 * §6 范围 1：「上传入口：PDF / 图片（JPG/PNG）。**DWG/DXF/IFC 本周不做**，
 * 但 `src/core` 里预留 parser 接口与分档 SLA 字段。」
 *
 * §6「明确不做」：DWG/DXF/IFC 解析。
 *
 * §6 结尾：「**分档承诺是产品可信度的关键**：不要让扫描图路径背负 CAD 路径
 * 的精度承诺，也不要因为扫描图不准就放弃自动化。UI 上必须显式区分。」
 *
 * 本文件**只定义接口与分档声明，不实现任何真实解析**：CAD/IFC 路径
 * `available === false` 且带人话提示，这是「分档 SLA」在数据层的落地。
 *
 * 纯 TypeScript 接口 + 声明函数，无 DOM / canvas 依赖，jsdom 下可单测。
 */

import type { ImportTrack } from './modeling.js';

/**
 * 支持的导入源。
 *
 * CAD/IFC 在类型上占位以保留扩展点（§6 范围 1：「预留 parser 接口」），
 * 但本期**不实现**真实解析 —— `describeImporter` 对它们返回
 * `available: false` + 人话提示。
 */
export type ImportSource =
  | { kind: 'image'; format: 'pdf' | 'jpg' | 'png' }
  | { kind: 'cad'; format: 'dwg' | 'dxf' }
  | { kind: 'ifc' }
  | { kind: 'template'; templateId: string };

/**
 * 解析入口的 descriptor。UI 据此：
 *  - 决定上传按钮是否启用（`available`）
 *  - 决定显示哪个精度承诺文案（`track`）
 *  - 对不可用路径显示人话提示（`unavailableReason`）
 *
 * 这是「分档 SLA」在数据层的落地 —— §6 结尾明说「UI 上必须显式区分」，
 * 数据层不显式区分，UI 层就没有可信来源可读。
 */
export interface ImporterDescriptor {
  source: ImportSource;
  /** 本期能否真跑：cad/ifc 必须 false */
  available: boolean;
  /** 分档 SLA（与 `modeling.ts` 的 `ImportTrack` 对齐） */
  track: ImportTrack;
  /** 不支持时给用户的可理解提示，不得是技术报错 */
  unavailableReason?: string;
}

/** 不可用路径的提示语。用产品语言而非技术语言（§6 范围 1 的「分档 SLA」）。 */
const UNAVAILABLE_REASON = {
  cad: 'DWG / DXF 解析功能本期未上线，敬请期待。当前请使用图片上传或户型库模板起步。',
  ifc: 'IFC 模型解析功能本期未上线，敬请期待。当前请使用图片上传或户型库模板起步。',
} as const;

/** 图片路径：可用，走 scan 分档（不承诺统一误差） */
const IMAGE_TRACK: ImportTrack = {
  track: 'scan',
  guaranteesUniformError: false,
};

/** CAD 路径：本期不可用 */
const CAD_TRACK: ImportTrack = {
  track: 'cad',
  guaranteesUniformError: true,
  maxErrorCm: 5,
};

/** IFC 路径：本期不可用 */
const IFC_TRACK: ImportTrack = {
  track: 'cad',
  guaranteesUniformError: true,
  maxErrorCm: 5,
};

/** 户型库模板：可用，走 template 分档（模板本身可信，承诺统一误差） */
const TEMPLATE_TRACK: ImportTrack = {
  track: 'template',
  guaranteesUniformError: true,
  maxErrorCm: 5,
};

/**
 * 解析入口的 descriptor 查询。
 *
 * **不实现任何真实解析**：本函数只返回 descriptor，不读取文件、不解析内容。
 * 真实解析器属 P23（图像预处理 + 墙体分割）。
 *
 * 所有 5 种 source（image 3 种 + cad 2 种 + ifc + template）都必须返回合法
 * descriptor（§4 必测清单）。
 */
export function describeImporter(source: ImportSource): ImporterDescriptor {
  switch (source.kind) {
    case 'image':
      return { source, available: true, track: IMAGE_TRACK };
    case 'cad':
      return { source, available: false, track: CAD_TRACK, unavailableReason: UNAVAILABLE_REASON.cad };
    case 'ifc':
      return { source, available: false, track: IFC_TRACK, unavailableReason: UNAVAILABLE_REASON.ifc };
    case 'template':
      return { source, available: true, track: TEMPLATE_TRACK };
    default:
      // 穷尽性检查：新增 source kind 时编译器会在此报错，强制更新 switch
      return exhaustiveCheck(source);
  }
}

/**
 * 穷尽性检查工具函数：编译器强制 switch 覆盖所有分支。
 * 新增 `ImportSource` kind 但未更新 `describeImporter` 时，此函数触发编译错误。
 */
function exhaustiveCheck(source: never): ImporterDescriptor {
  throw new Error(`describeImporter: 未处理的导入源 ${JSON.stringify(source)}`);
}
