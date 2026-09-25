/**
 * 平均亮度采样纯函数（P5）
 *
 * 把 WebGL `readRenderTargetPixels` 回读的 RGBA8 像素转成线性空间平均亮度。
 * 放在独立文件便于单测：不依赖 three、不依赖 DOM。
 *
 * 算法（docs/00-p0-version-verification.md §7）：
 * 1. RGBA8 字节 → [0,1] sRGB 分量
 * 2. sRGB → 线性（反 gamma，per-component）
 * 3. Rec.709 权重算每像素亮度
 * 4. 全块求平均
 *
 * 调用方负责先做空间降采样（16×16 RT + `readRenderTargetPixels`）；
 * 本函数只关心「给一摊像素，算出平均亮度」。
 */

/** Rec.709 亮度权重（sRGB 视频标准，线性空间适用） */
const W_R = 0.2126;
const W_G = 0.7152;
const W_B = 0.0722;

/** sRGB → 线性（单分量，输入输出均在 [0,1]） */
function srgbToLinear(c: number): number {
  // 避免对 0 求幂（幂函数对 0 是定义良好的，但分支更快且数值更稳）
  if (c <= 0.04045) return c / 12.92;
  return ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 从 RGBA8 像素数组计算平均亮度（线性空间，0-1）。
 *
 * 像素按行优先排列，每像素 4 字节（R,G,B,A）。
 * 长度不是 4 的倍数时，尾部不足一像素的字节被忽略。
 * alpha 通道不参与亮度计算（亮度只取 RGB）。
 * 空数组返回 0。
 */
export function averageLuminanceFromRGBA(rgba: Uint8Array): number {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return 0;

  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const r = srgbToLinear((rgba[off] ?? 0) / 255);
    const g = srgbToLinear((rgba[off + 1] ?? 0) / 255);
    const b = srgbToLinear((rgba[off + 2] ?? 0) / 255);
    sum += W_R * r + W_G * g + W_B * b;
  }
  return sum / pixelCount;
}
