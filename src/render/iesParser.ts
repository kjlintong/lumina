/**
 * IES (LM-63) 配光文件解析器（P6）
 *
 * 纯函数解析器，不依赖 three.js、不依赖 DOM。
 * 输入 IES 文本，输出结构化光强分布数据。
 *
 * IES 文件格式（LM-63-2002）：
 * - 头部：TILT 数据（通常 NONE）
 * - 灯具参数：10 个字段（数量、光通量、乘数、垂直/水平角度数等）
 * - 灯因素：3 个字段（球面修正、灯泡修正、输入功率）
 * - 垂直角度列表（numVerAngles 个）
 * - 水平角度列表（numHorAngles 个）
 * - 光强值：numHorAngles × numVerAngles 矩阵
 *
 * 与 three.js IESLoader 的差异：
 * - three.js 的 IESLamp 构造函数 line 342 有 bug：
 *   `candelaValues[i][j] *= candelaValues[i][j] * multiplier * ballFactor * blpFactor`
 *   这会平方原值（`x *= x * f` = `x² * f`，应该是 `x *= f` = `x * f`）。
 *   本解析器修正了这个 bug。
 * - 本解析器不生成纹理，只返回结构化数据，便于单测和复用。
 *
 * 架构依据：工程方案 §5.2（配光双轨）、ADR-18
 */

/** IES 解析结果 */
export interface IESData {
  /** 总光通量（lm），从 IES 文件头读取 */
  lumens: number;
  /** 光强矩阵 [horAngleIndex][verAngleIndex]，单位 cd，已乘以 multiplier/ballFactor/blpFactor */
  candela: number[][];
  /** 垂直角度（度），0=正前方，180=正后方 */
  verAngles: number[];
  /** 水平角度（度），0=正前方，180=正后方（对称性可能只列到 180） */
  horAngles: number[];
  /** 垂直角度数 */
  numVerAngles: number;
  /** 水平角度数 */
  numHorAngles: number;
  /** IES 乘数因子 */
  multiplier: number;
  /** 球面修正因子 */
  ballFactor: number;
  /** 灯泡修正因子 */
  blpFactor: number;
}

/** 解析错误类型 */
export interface IESParseError {
  line: number;
  message: string;
}

/**
 * 解析 IES 文本为结构化数据。
 *
 * @param text IES 文件全文
 * @returns 解析成功返回 IESData；解析失败返回 null
 */
export function parseIES(text: string): IESData | null {
  const lines = text.split(/\r?\n/);
  let lineIdx = 0;

  // 辅助：从当前行开始读取指定数量的数值，跨行续读
  function readValues(count: number): number[] | null {
    const result: number[] = [];
    while (result.length < count) {
      if (lineIdx >= lines.length) return null;
      const line = (lines[lineIdx] ?? '').trim();
      lineIdx++;
      if (line.length === 0) continue;
      // 替换逗号为空格，合并多空格
      const tokens = line.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
      for (const t of tokens) {
        if (result.length >= count) break;
        const v = Number(t);
        if (Number.isNaN(v)) return null;
        result.push(v);
      }
    }
    return result.length === count ? result : null;
  }

  // --- 1. 读取头部（跳过非 TILT 行，直到找到 TILT 行）---
  while (lineIdx < lines.length) {
    const line = (lines[lineIdx] ?? '').trim();
    lineIdx++;
    if (line.includes('TILT')) {
      // TILT NONE 或 TILT INCLUDE filename
      break;
    }
    // 跳过注释行（以 ! 开头）和空白行
  }

  // --- 2. 读取灯具参数（10 个字段）---
  const params = readValues(10);
  if (!params) return null;

  const lumens = params[1] ?? 0;
  const multiplier = params[2] ?? 1;
  const numVerAngles = Math.round(params[3] ?? 0);
  const numHorAngles = Math.round(params[4] ?? 0);
  // params[0] = 灯具数量，params[5] = gonioType（0=对称,1=半对称,2=非对称）
  // params[6] = units, params[7..9] = 灯具物理尺寸（米）

  if (numVerAngles <= 0 || numHorAngles <= 0) return null;

  // --- 3. 读取灯因素（3 个字段）---
  const factors = readValues(3);
  if (!factors) return null;

  const ballFactor = factors[0] ?? 1;
  const blpFactor = factors[1] ?? 1;
  // inputWatts = factors[2]

  // --- 4. 读取角度列表 ---
  const verAngles = readValues(numVerAngles);
  if (!verAngles) return null;

  const horAngles = readValues(numHorAngles);
  if (!horAngles) return null;

  // --- 5. 读取光强矩阵 ---
  const candela: number[][] = [];
  for (let h = 0; h < numHorAngles; h++) {
    const row = readValues(numVerAngles);
    if (!row) return null;
    candela.push(row);
  }

  // --- 6. 应用修正因子 ---
  // 修正 three.js IESLoader 的平方 bug：
  // three.js: v *= v * multiplier * ballFactor * blpFactor  → v² * f（错误，平方了）
  // 正确：    v *= multiplier * ballFactor * blpFactor      → v * f
  const correction = multiplier * ballFactor * blpFactor;
  for (let h = 0; h < numHorAngles; h++) {
    for (let v = 0; v < numVerAngles; v++) {
      const idx = candela[h]?.[v];
      if (idx !== undefined) {
        candela[h]![v] = idx * correction;
      }
    }
  }

  return {
    lumens,
    candela,
    verAngles,
    horAngles,
    numVerAngles,
    numHorAngles,
    multiplier,
    ballFactor,
    blpFactor,
  };
}

/**
 * 从 IES 光强分布计算光束角（度）。
 *
 * 光束角定义为：光强降至峰值 50%（半功率）时的两个方向之间的夹角。
 * 对于对称配光，在水平面内取 0-180° 的切面计算。
 *
 * @param data IES 解析数据
 * @param halfAngleFactor 半功率因子，默认 0.5（即峰值的 50%）
 * @returns 光束角（度），0-180 范围
 */
export function computeBeamAngle(data: IESData | null, halfAngleFactor = 0.5): number {
  if (!data || data.numVerAngles === 0 || data.numHorAngles === 0) return 60;

  // 找峰值
  let peak = 0;
  let peakVerIdx = 0;
  for (let h = 0; h < data.numHorAngles; h++) {
    for (let v = 0; v < data.numVerAngles; v++) {
      const val = data.candela[h]?.[v] ?? 0;
      if (val > peak) {
        peak = val;
        peakVerIdx = v;
      }
    }
  }

  if (peak <= 0) return 60;

  const threshold = peak * halfAngleFactor;

  // 在峰值所在垂直角度上，找水平方向的光束角
  // 取第一个水平切面（horAngles[0] 通常是 0°）
  const hIdx = 0;
  const row = data.candela[hIdx];
  if (!row) return 60;

  // 找峰值在垂直方向的位置
  const peakVer = data.verAngles[peakVerIdx] ?? 0;

  // 从峰值向两侧扩展，找光强降到阈值以下的位置
  // 向上（角度增大方向）
  let upperIdx = peakVerIdx;
  while (upperIdx < data.numVerAngles - 1) {
    const val = row[upperIdx + 1] ?? 0;
    if (val < threshold) break;
    upperIdx++;
  }
  const upperAngle = data.verAngles[upperIdx] ?? peakVer;

  // 向下（角度减小方向）
  let lowerIdx = peakVerIdx;
  while (lowerIdx > 0) {
    const val = row[lowerIdx - 1] ?? 0;
    if (val < threshold) break;
    lowerIdx--;
  }
  const lowerAngle = data.verAngles[lowerIdx] ?? peakVer;

  const beamAngle = upperAngle - lowerAngle;
  return Math.max(0, Math.min(180, beamAngle));
}

/**
 * 从 IES 光强矩阵计算总光通量（lm）。
 *
 * 使用 Lambert 球面积分：
 * Φ = 2π × Σ_h Σ_v I(v,h) × sin(v) × cos(v) × Δv × (360/numH)
 *
 * 对于对称配光（gonioType=0），水平方向只需取一个切面再乘 360/numH。
 * 对于非对称配光，直接积分所有切面。
 *
 * @param data IES 解析数据
 * @returns 计算得到的总光通量（lm）
 */
export function computeTotalLumens(data: IESData): number {
  if (data.numVerAngles <= 1 || data.numHorAngles <= 0) return data.lumens;

  let totalCd = 0;
  for (let h = 0; h < data.numHorAngles; h++) {
    const row = data.candela[h];
    if (!row) continue;
    for (let v = 0; v < data.numVerAngles - 1; v++) {
      const v1 = (data.verAngles[v] ?? 0) * (Math.PI / 180);
      const v2 = (data.verAngles[v + 1] ?? 0) * (Math.PI / 180);
      const i1 = row[v] ?? 0;
      const i2 = row[v + 1] ?? 0;
      // 梯形积分：I_avg × sin(v) × Δv
      // 注意：这里简化处理，取平均光强 × 平均 sin(v)
      const avgI = (i1 + i2) / 2;
      const avgSinV = (Math.sin(v1) + Math.sin(v2)) / 2;
      const dV = v2 - v1;
      totalCd += avgI * avgSinV * dV;
    }
    // 加上最后一个区间的贡献（到 π）
    const lastV = (data.verAngles[data.numVerAngles - 1] ?? 180) * (Math.PI / 180);
    const lastI = row[data.numVerAngles - 1] ?? 0;
    if (lastV < Math.PI) {
      totalCd += lastI * Math.sin(lastV) * (Math.PI - lastV);
    }
  }

  // 光强积分 → 光通量：Φ = 2π × Σ(I × sin(v) × Δv × Δh)
  // 上面的 totalCd 已经包含了水平方向的 Δh 因子（每个切面代表 360/numH 度）
  // 所以需要乘以 2π × (360/numH) / 2π = 360/numH（弧度制下）
  // 简化：totalCd 已经是 ∫I sin(v) dv 对每个切面，乘以 2π 得到每个切面的光通量
  // 再乘以 (360/numH)/(2π) 的换算... 
  // 实际上：Φ = ∫∫ I(θ,φ) sin(θ) dθ dφ
  // 上面 totalCd 是 ∫ I sin(θ) dθ 对每个水平切面的积分
  // 水平方向的步长是 360/numHorAngles 度 = 2π/numHorAngles 弧度
  // 所以 Φ = totalCd × (2π / numHorAngles)
  const lumens = totalCd * (2 * Math.PI / data.numHorAngles);
  return lumens;
}

/**
 * 校验 IES 文本的基本结构是否有效。
 * 不返回完整解析数据，只检查能否正常解析。
 *
 * @param text IES 文件全文
 * @returns 有效返回 true
 */
export function isValidIES(text: string): boolean {
  return parseIES(text) !== null;
}
