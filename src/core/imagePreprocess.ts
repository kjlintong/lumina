/**
 * 图像预处理（P23 §3 + P25 §1.1）。
 *
 * 纯 TypeScript，无 DOM / canvas 依赖，jsdom 下可单测。
 * 所有函数操作 `Uint8ClampedArray`（与 ImageData.data 同构）。
 *
 * 管线：灰度化 → Otsu 阈值 → 二值化 → Sobel 边缘 → 霍夫变换
 */

// ---------------------------------------------------------------------------
// 灰度化
// ---------------------------------------------------------------------------

/**
 * RGB → 灰度（ITU-R BT.601 加权：0.299R + 0.587G + 0.114B）。
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
// Otsu 自动阈值（P25 §1.1.1）
// ---------------------------------------------------------------------------

/**
 * Otsu 最大类间方差法自动阈值。
 *
 * 遍历 0-255 灰度值，计算每个候选阈值对应的类间方差：
 *   σ²_B(t) = ω₀(t) · ω₁(t) · [μ₀(t) - μ₁(t)]²
 * 返回使类间方差最大的阈值。
 *
 * @param gray 灰度图像（单通道，长度 = w*h）
 * @returns 最佳阈值（0-255）
 */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const total = gray.length;
  if (total === 0) return 128;

  // 直方图
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) {
    const v = Number(gray[i]!);
    hist[v] = (hist[v] ?? 0) + 1;
  }

  // 累积矩 Σ t·n_t（用于 μ₁ 计算）
  let sumT = 0;
  for (let t = 0; t < 256; t++) sumT += t * (hist[t] ?? 0);

  let omega = 0;    // 累积权重 ω₀(t) = Σ_{s≤t} n_s
  let sumW = 0;     // 累积矩 Σ_{s≤t} s · n_s
  let maxVar = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    omega += hist[t]!;
    if (omega === 0) continue;            // 背景为空，跳过
    const w1 = total - omega;
    if (w1 === 0) break;                  // 前景为空，停止

    sumW += t * hist[t]!;
    const mu0 = sumW / omega;             // 类均值（前景）
    const mu1 = (sumT - sumW) / w1;       // 类均值（背景）

    const varB = omega * w1 * (mu0 - mu1) * (mu0 - mu1);
    if (varB > maxVar) {
      maxVar = varB;
      threshold = t;
    }
  }

  return threshold;
}

// ---------------------------------------------------------------------------
// 二值化
// ---------------------------------------------------------------------------

/**
 * 灰度 → 二值（0 或 255）。
 * @param gray 灰度图像
 * @param threshold 阈值（默认 128）
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
// Sobel 边缘检测（P25 §1.1.2）
// ---------------------------------------------------------------------------

/**
 * Sobel 边缘检测。
 *
 * 计算 x/y 方向的 Sobel 梯度，合成梯度幅值（sqrt(gx² + gy²)），
 * 返回边缘强度图（0-255）。
 *
 * Sobel 核：
 *   Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
 *   Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]
 *
 * @param gray 灰度图像
 * @param width 图像宽
 * @param height 图像高
 * @returns 边缘强度图（0-255）
 */
export function sobelEdges(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const tl = gray[idx - width - 1]!;
      const tc = gray[idx - width]!;
      const tr = gray[idx - width + 1]!;
      const ml = gray[idx - 1]!;
      const mr = gray[idx + 1]!;
      const bl = gray[idx + width - 1]!;
      const bc = gray[idx + width]!;
      const br = gray[idx + width + 1]!;

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      const mag = Math.sqrt(gx * gx + gy * gy);
      out[idx] = Math.min(255, Math.round(mag));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 霍夫变换（P25 §1.1.3）
// ---------------------------------------------------------------------------

export interface HoughLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;  // 度，0-180
  votes: number;  // 累加器票数
}

export interface HoughOptions {
  /** 累加器阈值，默认 50 */
  threshold?: number;
  /** 最短线段长度（像素），默认 40 */
  minSegmentLength?: number;
  /** 线段合并角度差（度），默认 5 */
  maxAngleDiff?: number;
}

/**
 * 霍夫变换检测直线。
 *
 * 极坐标累加器（ρ, θ）：
 * - ρ 范围：0 到 max(width, height) * 1.5
 * - θ 范围：0 到 180 度，步长 1 度
 * - 对边缘像素投票
 * - 找局部峰值，从峰值反推线段端点
 *
 * @param edges 边缘强度图（sobelEdges 输出）
 * @param width 图像宽
 * @param height 图像高
 * @param options 霍夫参数
 */
export function houghLines(
  edges: Uint8ClampedArray,
  width: number,
  height: number,
  options: HoughOptions = {},
): HoughLine[] {
  const {
    threshold = 50,
    minSegmentLength = 40,
  } = options;

  // 累加器
  const maxDim = Math.max(width, height);
  const rhoMax = Math.round(maxDim * 1.5);
  const thetaMax = 180;
  const accumulator = new Uint32Array(rhoMax * thetaMax);

  // 对边缘像素投票
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = edges[y * width + x]!;
      if (edge < 50) continue; // 跳过弱边缘

      for (let t = 0; t < thetaMax; t++) {
        const theta = (t * Math.PI) / 180;
        const rho = Math.round(x * Math.cos(theta) + y * Math.sin(theta));
        if (rho >= 0 && rho < rhoMax) {
          const accIdx = rho * thetaMax + t;
          const cur = accumulator[accIdx] ?? 0;
          accumulator[accIdx] = cur + 1;
        }
      }
    }
  }

  // 找局部峰值
  const peaks: { rho: number; theta: number; votes: number }[] = [];
  for (let rho = 0; rho < rhoMax; rho++) {
    for (let theta = 0; theta < thetaMax; theta++) {
      const votes = accumulator[rho * thetaMax + theta]!;
      if (votes < threshold) continue;

      // 检查是否为局部峰值（3x3 邻域内最大）
      let isPeak = true;
      for (let dr = -1; dr <= 1 && isPeak; dr++) {
        for (let dt = -1; dt <= 1 && isPeak; dt++) {
          const nr = rho + dr;
          const nt = theta + dt;
          if (nr < 0 || nr >= rhoMax || nt < 0 || nt >= thetaMax) continue;
          if (accumulator[nr * thetaMax + nt]! > votes) isPeak = false;
        }
      }

      if (isPeak) {
        peaks.push({ rho, theta, votes });
      }
    }
  }

  // 峰值转线段端点
  const lines: HoughLine[] = [];
  for (const { rho, theta, votes } of peaks) {
    const thetaRad = (theta * Math.PI) / 180;
    const cosT = Math.cos(thetaRad);
    const sinT = Math.sin(thetaRad);

    // 线段在图像内的两个端点
    let x1: number, y1: number, x2: number, y2: number;

    if (Math.abs(sinT) < 0.01) {
      // 垂直线
      x1 = rho / cosT;
      x2 = x1;
      y1 = 0;
      y2 = height - 1;
    } else if (Math.abs(cosT) < 0.01) {
      // 水平线
      y1 = rho / sinT;
      y2 = y1;
      x1 = 0;
      x2 = width - 1;
    } else {
      // 一般线
      x1 = 0;
      y1 = (rho - x1 * cosT) / sinT;
      x2 = width - 1;
      y2 = (rho - x2 * cosT) / sinT;

      // 裁剪到图像范围内
      if (y1 < 0) {
        x1 = (rho - 0) / cosT;
        y1 = 0;
      } else if (y1 >= height) {
        x1 = (rho - (height - 1) * sinT) / cosT;
        y1 = height - 1;
      }
      if (y2 < 0) {
        x2 = (rho - 0) / cosT;
        y2 = 0;
      } else if (y2 >= height) {
        x2 = (rho - (height - 1) * sinT) / cosT;
        y2 = height - 1;
      }
    }

    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (length < minSegmentLength) continue;

    lines.push({
      x1, y1, x2, y2,
      length,
      angle: theta,
      votes,
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 组合预处理
// ---------------------------------------------------------------------------

export interface PreprocessResult {
  gray: Uint8ClampedArray;
  binary: Uint8ClampedArray;
  edges: Uint8ClampedArray;
  threshold: number;
}

/**
 * 完整预处理管线：灰度化 → Otsu 阈值 → 二值化 → Sobel 边缘。
 */
export function preprocessFull(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): PreprocessResult {
  const gray = toGrayscale(data, width, height);
  const threshold = otsuThreshold(gray);
  const binary = binarize(gray, threshold);
  const edges = sobelEdges(gray, width, height);
  return { gray, binary, edges, threshold };
}

/**
 * 兼容旧接口：灰度化 → 二值化（固定阈值）。
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

// ---------------------------------------------------------------------------
// 兼容旧接口：简单线段检测
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
 * （兼容旧接口，新代码应使用 houghLines）
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
