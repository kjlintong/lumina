/**
 * 墙体提取（P25 §1.4）。
 *
 * 从 ImageBitmap + ScaleCalibration 提取 ModelGeometry。
 * 管线：灰度化 → Otsu → 二值化 → Sobel → 霍夫 → 合并 → 轮廓 → ModelGeometry
 *
 * 纯 TypeScript，无 DOM 依赖（除 ImageBitmap → ImageData 转换）。
 */

import type {
  ModelGeometry,
  WallSegment,
  RoomPolygon,
  PlanePoint,
} from './modeling.js';
import type { ScaleCalibration } from './scale.js';
import {
  toGrayscale,
  otsuThreshold,
  binarize,
  sobelEdges,
  houghLines,
} from './imagePreprocess.js';
import { mergeLines } from './lineMerging.js';
import type { MergedLine } from './lineMerging.js';
import { extractContours } from './contourExtraction.js';
import type { Contour } from './contourExtraction.js';

export interface ExtractResult {
  model: ModelGeometry;
  lines: MergedLine[];
  contours: Contour[];
  stats: ExtractStats;
}

export interface ExtractStats {
  imageWidth: number;
  imageHeight: number;
  otsuThreshold: number;
  edgePixels: number;
  houghLines: number;
  mergedLines: number;
  contours: number;
  walls: number;
  rooms: number;
  totalWallLength: number;
  totalRoomArea: number;
}

export interface ExtractOptions {
  minWallLength?: number;
  minRoomArea?: number;
  houghThreshold?: number;
  minSegmentLength?: number;
  maxAngleDiff?: number;
  contourEndpointDist?: number;
  contourMinArea?: number;
}

/**
 * 从 ImageBitmap 提取墙体和房间。
 *
 * @param image 输入的 ImageBitmap（户型图）
 * @param calibration 比例尺标定（像素→米）
 * @param options 提取参数
 * @returns 提取结果（ModelGeometry + 中间数据 + 统计）
 */
export async function extractWalls(
  image: ImageBitmap,
  calibration: ScaleCalibration,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const {
    minWallLength = 0.3,
    minRoomArea = 1.0,
    houghThreshold = 50,
    minSegmentLength = 40,
    maxAngleDiff = 5,
    contourEndpointDist = 10,
    contourMinArea = 500,
  } = options;

  const width = image.width;
  const height = image.height;

  // 1. 读取像素数据（通过 canvas）
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 canvas 上下文');
  }
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;

  // 2. 预处理管线
  const gray = toGrayscale(data, width, height);
  const threshold = otsuThreshold(gray);
  binarize(gray, threshold);
  const edges = sobelEdges(gray, width, height);

  // 统计边缘像素
  let edgePixels = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i]! > 50) edgePixels++;
  }

  // 3. 霍夫变换
  const houghResults = houghLines(edges, width, height, {
    threshold: houghThreshold,
    minSegmentLength,
    maxAngleDiff,
  });

  // 4. 线段合并
  const mergedLines: MergedLine[] = mergeLines(houghResults, {
    maxAngleDiff,
  });

  // 5. 轮廓提取
  const contours: Contour[] = extractContours(mergedLines, {
    maxEndpointDist: contourEndpointDist,
    minArea: contourMinArea,
  });

  // 6. 像素→米坐标转换
  const toMeters = calibration.toMeters;

  // 7. 构造 WallSegment
  const walls: WallSegment[] = [];
  let totalWallLength = 0;

  for (let i = 0; i < mergedLines.length; i++) {
    const line = mergedLines[i]!;
    const lengthM = line.length * toMeters;
    if (lengthM < minWallLength) continue;

    const wall: WallSegment = {
      id: `auto_w${i}`,
      a: [line.x1 * toMeters, line.y1 * toMeters] as PlanePoint,
      b: [line.x2 * toMeters, line.y2 * toMeters] as PlanePoint,
      thickness: 0.15,
      height: 2.8,
      confidence: 0.5, // LOW_CONFIDENCE
      provenance: {
        kind: 'image_element',
        elementId: `auto_w${i}`,
      },
    };
    walls.push(wall);
    totalWallLength += lengthM;
  }

  // 8. 构造 RoomPolygon
  const rooms: RoomPolygon[] = [];
  let totalRoomArea = 0;

  for (let i = 0; i < contours.length; i++) {
    const contour = contours[i]!;
    const vertices = contour.points.map(
      (p) => [p[0] * toMeters, p[1] * toMeters] as PlanePoint,
    );
    // 闭合
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      vertices.push(first);
    }

    // 面积（米²）
    const areaM2 = contour.area * toMeters * toMeters;
    if (areaM2 < minRoomArea) continue;

    const room: RoomPolygon = {
      id: `auto_r${i}`,
      name: `房间 ${i + 1}`,
      vertices: vertices as readonly PlanePoint[],
      labeledArea: areaM2,
      confidence: 0.5, // LOW_CONFIDENCE
      provenance: {
        kind: 'image_element',
        elementId: `auto_r${i}`,
      },
    };
    rooms.push(room);
    totalRoomArea += areaM2;
  }

  // 9. 构造 ModelGeometry
  const model: ModelGeometry = {
    schemaId: 'lumina.model/1',
    walls,
    openings: [],
    rooms,
    slab: { level: 0, thickness: 0.1, ceilingH: 2.8 },
    calibration,
    track: { track: 'scan', guaranteesUniformError: false },
  };

  return {
    model,
    lines: mergedLines,
    contours,
    stats: {
      imageWidth: width,
      imageHeight: height,
      otsuThreshold: threshold,
      edgePixels,
      houghLines: houghResults.length,
      mergedLines: mergedLines.length,
      contours: contours.length,
      walls: walls.length,
      rooms: rooms.length,
      totalWallLength,
      totalRoomArea,
    },
  };
}
