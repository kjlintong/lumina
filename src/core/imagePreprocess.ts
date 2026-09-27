/**
 * 图像预处理（P23 §3）。
 *
 * 最小实现：灰度化 + 二值化 + 简单线段检测。
 * 不做：透视校正、去阴影、OCR。
 *
 * 纯 TypeScript，无 DOM / canvas 依赖，jsdom 下可单测。
 * 所有函数操作 `Uint8ClampedArray`（与 ImageData.data 同构）。
 */

// ---------------------------------------------------------------------------
// 灰度化
// ---------------------------------------------------------------------------

/**
 * RGB → 灰度。
 * 输出是单通道灰度数组（长度 = w * h）。
 * 使用 ITU-R BT.601 加权：0.299R + 0.587G + 0.114B。
 */
export function toGrayscale(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
): Uint8ClampedArray {
  const len = data.length / 4;
  const gray = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i++) {
    const j = i * 4;
    gray[i] = Math.round(
      0.299 * data[j]! + 0.587 * data[j + 1]! + 0.114 * data[j + 2]!,
    );
  }
  return gray;
}

// ---------------------------------------------------------------------------
// 二值化
// ---------------------------------------------------------------------------

/**
 * 灰度 → 二值（0 或 255）。
 * 固定阈值法（Otsu 自动阈值留后续迭代）。
 */
export function binarize(
  gray: Uint8ClampedArray,
  threshold = 128,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = gray[i]! >= threshold ? 255 : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 简单线段检测
// ---------------------------------------------------------------------------

export interface DetectedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

/**
 * 简单线段检测：扫描边缘像素对，返回长度 > minLen 的线段。
 *
 * 这不是 Canny 或 LSD，只是「相邻暗像素构成直线」的极简检测。
 * 用途：给出草稿供手动描墙参考，不是最终产物。
 *
 * @param binary 二值图像
 * @param width 图像宽
 * @param height 图像高
 * @param minLen 最短线段长度（像素）
 */
export function detectLines(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  minLen = 20,
): DetectedLine[] {
  const lines: DetectedLine[] = [];

  // 扫描水平线段
  for (let y = 0; y < height; y++) {
    let startX = -1;
    for (let x = 0; x < width; x++) {
      const isDark = binary[y * width + x]! === 0;
      if (isDark && startX < 0) {
        startX = x;
      } else if (!isDark && startX >= 0) {
        const len = x - startX;
        if (len >= minLen) {
          lines.push({ x1: startX, y1: y, x2: x - 1, y2: y, confidence: 0.5 });
        }
        startX = -1;
      }
    }
  }

  // 扫描垂直线段
  for (let x = 0; x < width; x++) {
    let startY = -1;
    for (let y = 0; y < height; y++) {
      const isDark = binary[y * width + x]! === 0;
      if (isDark && startY < 0) {
        startY = y;
      } else if (!isDark && startY >= 0) {
        const len = y - startY;
        if (len >= minLen) {
          lines.push({ x1: x, y1: startY, x2: x, y2: y - 1, confidence: 0.5 });
        }
        startY = -1;
      }
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 组合预处理
// ---------------------------------------------------------------------------

/**
 * 预处理组合：灰度化 → 二值化。
 * 返回二值图像供描墙参考。
 */
export function preprocessForCalibration(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  threshold = 128,
): { binary: Uint8ClampedArray; gray: Uint8ClampedArray } {
  const gray = toGrayscale(data, _width, _height);
  const binary = binarize(gray, threshold);
  return { binary, gray };
}
