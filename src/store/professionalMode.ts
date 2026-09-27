/**
 * 「专业模式」开关的持久化存取。
 *
 * 依据 LUMINA 两周执行规格 §4 Day 6 j：JSON 导入导出 / lux / XYZ 坐标 /
 * 渲染调参属工程控件，默认对 C 端用户不可见，收进「专业模式」开关后。
 *
 * 用 localStorage 持久化而非 session：一次开启后跨刷新保留，避免用户
 * 反复手动开一次、刷一次。key 带 `lumina.` 前缀，与 projectStore 的
 * 项目自动保存 key 分家，互不干扰。
 *
 * 无持久化能力（SSR / 隐私模式 / localStorage 抛错）时**静默兜底 false**，
 * 不 throw —— 本模块只服务 UI 可见性，不能因为一个开关把整个 App 打挂。
 */

const STORAGE_KEY = 'lumina.professionalMode';

/** 读当前状态。读取失败/缺失返回 false。 */
export function readProfessionalMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 写当前状态。写入失败静默忽略（同上）。 */
export function writeProfessionalMode(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 静默
  }
}
