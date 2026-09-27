/**
 * 场景预设 -> 曝光的纯查表（P20，§5 曝光矩阵）。
 *
 * 独立成文件而非写在 sceneEngine 里：曝光矩阵是数据不是逻辑，
 * 抽出来可以让 sceneEngine 只做「查 → 用」，单测不必构造引擎实例。
 *
 * 为什么不直接 import PRESET_SCENES：那是 sceneSystem.ts 的运行时表，
 * 由用户可扩展（SceneSystem.create 可加自定义场景）。查表必须容忍
 * 表里查不到（自定义场景 / key 已删），所以这里做成纯函数而非闭包。
 */
import { PRESET_SCENES } from '../scene/sceneSystem.js';

/** 按场景 key 取预设曝光；未命中或未定义返回 undefined。 */
export function presetExposureBySceneKey(sceneKey: string): number | undefined {
  const preset = PRESET_SCENES[sceneKey as keyof typeof PRESET_SCENES];
  return preset?.exposure;
}
