import { describe, expect, it } from 'vitest';
import {
  modelBounds,
  modelToRoomDims,
  snapToGrid,
  snapOrtho,
  planToWorld,
  worldToPlan,
  closeVertices,
  GRID_SNAP_M,
  ORTHO_ANGLE_DEG,
} from '../../render/modelPlanLayout.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { close } from '../../core/units.js';

function emptyModel() {
  return {
    schemaId: 'lumina.model/1' as const,
    walls: [],
    openings: [],
    rooms: [],
    slab: { level: 0, thickness: 0.15, ceilingH: 2.8 },
    calibration: null,
    track: { track: 'scan', guaranteesUniformError: false } as const,
  };
}

function rectModel() {
  const t = HOUSE_TEMPLATES[0]!;
  return structuredClone(t.model);
}

describe('modelPlanLayout', () => {
  describe('modelBounds / modelToRoomDims', () => {
    it('returns correct width/depth for a template (centered at origin)', () => {
      const m = rectModel();
      const b = modelBounds(m);
      expect(b).not.toBeNull();
      expect(b!.width).toBeGreaterThanOrEqual(2.5);
      expect(b!.depth).toBeGreaterThanOrEqual(3.0);
    });

    it('returns null for empty model', () => {
      expect(modelBounds(emptyModel())).toBeNull();
    });

    it('modelToRoomDims returns height from slab.ceilingH', () => {
      const m = rectModel();
      const d = modelToRoomDims(m);
      expect(d).not.toBeNull();
      expect(d!.height).toBe(2.8);
    });

    it('modelToRoomDims returns null for empty model', () => {
      expect(modelToRoomDims(emptyModel())).toBeNull();
    });
  });

  describe('snapToGrid', () => {
    it('snaps to nearest grid intersection', () => {
      const result = snapToGrid([0.13, 0.17], GRID_SNAP_M);
      expect(close(result[0], 0.1)).toBe(true);
      expect(close(result[1], 0.2)).toBe(true);
    });

    it('exactly on grid intersection stays', () => {
      const result = snapToGrid([0.1, 0.2], GRID_SNAP_M);
      expect(close(result[0], 0.1)).toBe(true);
      expect(close(result[1], 0.2)).toBe(true);
    });

    it('exactly half grid goes to nearest', () => {
      const result = snapToGrid([0.05, 0.15], GRID_SNAP_M);
      expect(close(result[0], 0.0) || close(result[0], 0.1)).toBe(true);
      expect(close(result[1], 0.1) || close(result[1], 0.2)).toBe(true);
    });
  });

  describe('snapOrtho', () => {
    it('snaps to horizontal within 15 degrees', () => {
      const from: [number, number] = [0, 0];
      const to: [number, number] = [1.0, 0.1]; // ~5.7 degrees
      const result = snapOrtho(from, to);
      expect(close(result[1], 0)).toBe(true);
      expect(close(result[0], 1.0)).toBe(true);
    });

    it('snaps to vertical within 15 degrees', () => {
      const from: [number, number] = [0, 0];
      const to: [number, number] = [0.1, 1.0]; // ~84.3 degrees
      const result = snapOrtho(from, to);
      expect(close(result[0], 0)).toBe(true);
      expect(close(result[1], 1.0)).toBe(true);
    });

    it('does not snap beyond 15 degrees (at 30 degrees)', () => {
      const from: [number, number] = [0, 0];
      const to: [number, number] = [0.866, 0.5]; // ~30 degrees
      const result = snapOrtho(from, to);
      expect(close(result[0], 0.866)).toBe(true);
      expect(close(result[1], 0.5)).toBe(true);
    });

    it('exactly 15 degrees snaps', () => {
      const from: [number, number] = [0, 0];
      // 15 degrees: tan(15) = 0.2679
      const to: [number, number] = [0.9659, 0.2588]; // normalized
      const result = snapOrtho(from, to);
      expect(close(result[1], 0)).toBe(true);
    });
  });

  describe('planToWorld / worldToPlan roundtrip', () => {
    it('planToWorld and worldToPlan are inverses', () => {
      const ox = 100, oy = 100, scale = 20;
      const [wx, wz] = planToWorld(150, 130, ox, oy, scale);
      expect(close(wx, 2.5)).toBe(true);
      expect(close(wz, 1.5)).toBe(true);

      const back = worldToPlan(wx, wz, ox, oy, scale);
      expect(close(back.x, 150)).toBe(true);
      expect(close(back.y, 130)).toBe(true);
    });

    it('roundtrip preserves precision', () => {
      const ox = 0, oy = 0, scale = 1;
      const [wx, wz] = planToWorld(1.234, 5.678, ox, oy, scale);
      expect(close(wx, 1.234)).toBe(true);
      expect(close(wz, 5.678)).toBe(true);

      const back = worldToPlan(wx, wz, ox, oy, scale);
      expect(close(back.x, 1.234)).toBe(true);
      expect(close(back.y, 5.678)).toBe(true);
    });
  });

  describe('closeVertices', () => {
    it('removes duplicate end point when already closed', () => {
      const pts: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
      const result = closeVertices(pts);
      expect(result.length).toBe(3);
      expect(result[2]).toEqual([1, 1]);
    });

    it('appends first point when not closed', () => {
      const pts: [number, number][] = [[0, 0], [1, 0], [1, 1]];
      const result = closeVertices(pts);
      expect(result.length).toBe(4);
      expect(result[3]).toEqual([0, 0]);
    });

    it('returns as-is for < 3 points', () => {
      const pts: [number, number][] = [[0, 0], [1, 0]];
      const result = closeVertices(pts);
      expect(result).toBe(pts);
    });
  });

  describe('constants', () => {
    it('GRID_SNAP_M is 0.1', () => {
      expect(GRID_SNAP_M).toBe(0.1);
    });

    it('ORTHO_ANGLE_DEG is 15', () => {
      expect(ORTHO_ANGLE_DEG).toBe(15);
    });
  });
});
