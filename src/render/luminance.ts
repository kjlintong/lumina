/**
 * 平均亮度采样纯函数（P5 / P9 修复）
 *
 * 把 WebGL `readRenderTargetPixels` 回读的 HalfFloat RGBA 像素转成线性空间
 * 平均亮度。放在独立文件便于单测：不依赖 three、不依赖 DOM。
 *
 * P9 根因 A：旧实现采样 UnsignedByteType RT，且渲染时 ACES 色调映射仍生效，
 * RT 色深/色彩空间与输出链不一致，暗部被 clamp 成全 0 字节 → 返回恒 0，
 * 自动曝光整条链路死掉。修复后：采样 RT 改 HalfFloatType（HDR，不丢暗部），
 * 采样时临时关闭色调映射（backend.ts），回读到的就是**线性 HDR 值**，
 * 本函数直接按 Rec.709 权重求平均，不再做 sRGB→线性反变换。
 *
 * 调用方负责先做空间降采样（16×16 RT + `readRenderTargetPixels`）；
 * 本函数只关心「给一摊像素，算出平均亮度」。
 */

/** Rec.709 亮度权重（sRGB 视频标准，线性空间适用） */
const W_R = 0.2126;
const W_G = 0.7152;
const W_B = 0.0722;

/**
 * HalfFloat（IEEE 754 binary16，uint16 位型）→ float32。纯函数。
 *
 * 布局：1 符号位 | 5 指数位（bias 15）| 10 尾数位。
 *   - exp = 0：次正规数 value = mant / 1024 × 2^-14
 *   - exp = 31：Inf（mant=0）/ NaN（mant≠0）
 *   - 其余：value = (1 + mant/1024) × 2^(exp-15)
 *
 * 参考：halfToFloat(0) = 0；halfToFloat(0x3C00) = 1.0；halfToFloat(0x7BFF) = 65504。
 */
export function halfToFloat(v: number): number {
  const bits = v & 0xffff; // 规范化到 16 位（防御高位污染）
  const sign = (bits >>> 15) & 1 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant !== 0 ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/**
 * 从 HalfFloat RGBA 像素数组计算平均亮度（线性空间）。
 *
 * 像素按行优先排列，每像素 4 个 uint16（R,G,B,A 的 binary16 位型）。
 * 采样时色调映射已临时关闭（见 backend.ts getAverageLuminance），
 * 因此分量是**线性 HDR 值**，直接使用，不再做 sRGB 反变换。
 *
 * 长度不是 4 的倍数时，尾部不足一像素的部分被忽略。
 * alpha 通道不参与亮度计算（亮度只取 RGB）。
 * 空数组返回 0。NaN/Inf 分量按 0 计（防御：HDR 采样的极端像素不应拖垮曝光）。
 */
export function averageLuminanceFromRGBA(rgba: Uint16Array): number {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return 0;

  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const r = halfToFloat(rgba[off] ?? 0);
    const g = halfToFloat(rgba[off + 1] ?? 0);
    const b = halfToFloat(rgba[off + 2] ?? 0);
    const lum = W_R * r + W_G * g + W_B * b;
    if (Number.isFinite(lum)) sum += lum;
  }
  return sum / pixelCount;
}
