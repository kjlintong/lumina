import { describe, expect, it, vi, beforeEach } from 'vitest';
import { extractWalls } from '../wallExtractor.js';
import type { ScaleCalibration } from '../scale.js';

// Mock ImageBitmap
class MockImageBitmap {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
}

// Mock canvas context for document.createElement('canvas')
beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            getImageData: (_x: number, _y: number, w: number, h: number) => {
              // Return a 2D image with a horizontal dark line
              const data = new Uint8ClampedArray(w * h * 4);
              // Fill with white (255)
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
              }
              // Draw a dark horizontal line at y=10
              for (let x = 0; x < w; x++) {
                const idx = (10 * w + x) * 4;
                data[idx] = 0; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 255;
              }
              return { data };
            },
          }),
        };
      }
      return {};
    },
  });
});

const calibration: ScaleCalibration = {
  measuredOnDrawing: 100,
  realDistance: 3,
  realUnit: 'm',
  unitConfirmed: true,
  toMeters: 0.03,
};

describe('wallExtractor (P25)', () => {
  it('returns ExtractResult structure', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('lines');
    expect(result).toHaveProperty('contours');
    expect(result).toHaveProperty('stats');
  });

  it('model has correct schemaId and track', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result.model.schemaId).toBe('lumina.model/1');
    expect(result.model.track).toEqual({ track: 'scan', guaranteesUniformError: false });
    expect(result.model.calibration).toBe(calibration);
  });

  it('slab has correct defaults', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result.model.slab.level).toBe(0);
    expect(result.model.slab.ceilingH).toBe(2.8);
  });

  it('stats report image dimensions', async () => {
    const image = new MockImageBitmap(150, 80) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result.stats.imageWidth).toBe(150);
    expect(result.stats.imageHeight).toBe(80);
  });

  it('wall length filter removes short segments', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration, { minWallLength: 0.5 });

    // All walls should be >= minWallLength meters
    for (const wall of result.model.walls) {
      const len = Math.hypot(
        wall.b[0] - wall.a[0],
        wall.b[1] - wall.a[1],
      );
      expect(len).toBeGreaterThanOrEqual(0.5 - 0.01); // small tolerance
    }
  });

  it('all walls have low confidence and image_element provenance', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    for (const wall of result.model.walls) {
      expect(wall.confidence).toBeLessThan(1);
      expect(wall.provenance.kind).toBe('image_element');
    }
  });

  it('all rooms have low confidence and image_element provenance', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    for (const room of result.model.rooms) {
      expect(room.confidence).toBeLessThan(1);
      expect(room.provenance.kind).toBe('image_element');
    }
  });

  it('opensings array is always empty (not yet implemented)', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result.model.openings).toEqual([]);
  });

  it('stats fields are consistent', async () => {
    const image = new MockImageBitmap(200, 100) as ImageBitmap;
    const result = await extractWalls(image, calibration);

    expect(result.stats.walls).toBe(result.model.walls.length);
    expect(result.stats.rooms).toBe(result.model.rooms.length);
    expect(result.stats.mergedLines).toBe(result.lines.length);
    expect(result.stats.contours).toBe(result.contours.length);
    expect(result.stats.totalWallLength).toBeGreaterThanOrEqual(0);
    expect(result.stats.totalRoomArea).toBeGreaterThanOrEqual(0);
  });
});
