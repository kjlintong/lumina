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
  snapEndpoint,
  collectSnapCandidates,
  wallLabels,
  roomLabels,
  ENDPOINT_SNAP_RADIUS_M,
} from '../../render/modelPlanLayout.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';
import { close } from '../../core/units.js';
import type { WallSegment } from '../../core/modeling.js';

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

  describe('snapEndpoint (P33)', () => {
    it('returns the nearest candidate within radius', () => {
      const cands = [
        { x: 0, z: 0 },
        { x: 3, z: 3 },
        { x: 0.05, z: 0.05 },
      ];
      const got = snapEndpoint([0.1, 0.1], cands);
      expect(got).toEqual({ x: 0.05, z: 0.05 });
    });

    it('returns null when no candidate is within radius', () => {
      const cands = [{ x: 5, z: 5 }, { x: -4, z: -4 }];
      expect(snapEndpoint([0, 0], cands, ENDPOINT_SNAP_RADIUS_M)).toBeNull();
    });

    it('returns null on empty candidate set', () => {
      expect(snapEndpoint([0, 0], [])).toBeNull();
    });

    it('uses the given radius parameter', () => {
      // 0.5 m 半径下 0.3 m 的候选能吸上；默认 0.15 半径吸不上
      const cands = [{ x: 0.3, z: 0.3 }];
      expect(snapEndpoint([0, 0], cands)).toBeNull();
      expect(snapEndpoint([0, 0], cands, 0.5)).toEqual({ x: 0.3, z: 0.3 });
    });

    it('snapEndpoint is deterministic on ties (first wins)', () => {
      // 等距候选：取遍历到的第一个，保证稳定
      const cands = [{ x: 0.1, z: 0 }, { x: -0.1, z: 0 }];
      expect(snapEndpoint([0, 0], cands)).toEqual({ x: 0.1, z: 0 });
    });
  });

  describe('collectSnapCandidates (P33)', () => {
    it('includes every wall endpoint and room vertex, excludes last pending', () => {
      const m = rectModel();
      const out = collectSnapCandidates(m);
      // 每个 wall 贡献 2 个端点；rooms 顶点全贡献
      const wallEnds = m.walls.length * 2;
      const roomVerts = m.rooms.reduce((s, r) => s + r.vertices.length, 0);
      expect(out.length).toBe(wallEnds + roomVerts);
    });

    it('includes pendingVertices except the last one (for closing the loop)', () => {
      const m = rectModel();
      const pend: [number, number][] = [
        [0, 0],
        [2, 0],
        [2, 2],
      ];
      const out = collectSnapCandidates(m, pend);
      const wallEnds = m.walls.length * 2;
      const roomVerts = m.rooms.reduce((s, r) => s + r.vertices.length, 0);
      // pendingVertices 排除最后一个 → 2 个候选（[0,0] 和 [2,0]）
      expect(out.length).toBe(wallEnds + roomVerts + 2);
      expect(out).toContainEqual({ x: 0, z: 0 });
      expect(out).toContainEqual({ x: 2, z: 0 });
      expect(out).not.toContainEqual({ x: 2, z: 2 });
    });
  });

  describe('wallLabels / roomLabels (P33)', () => {
    it('wallLabels emits one label per non-degenerate wall with meters text', () => {
      const m = rectModel();
      const labels = wallLabels(m.walls, 200, 200, 40);
      expect(labels.length).toBe(m.walls.length);
      for (const l of labels) {
        expect(l.text).toMatch(/^\d+\.\d{2}m$/);
        expect(Number.isFinite(l.angle)).toBe(true);
      }
    });

    it('axis-aligned walls produce angle 0 (readable horizontal text)', () => {
      // 构造一条水平墙 + 一条竖直墙
      const horizontal: WallSegment = {
        id: 'h',
        a: [0, 0],
        b: [2, 0],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      };
      const vertical: WallSegment = {
        id: 'v',
        a: [0, 0],
        b: [0, 2],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      };
      const labels = wallLabels([horizontal, vertical], 200, 200, 40);
      expect(labels.length).toBe(2);
      for (const l of labels) expect(l.angle).toBe(0);
      expect(labels[0]!.text).toBe('2.00m');
      expect(labels[1]!.text).toBe('2.00m');
    });

    it('roomLabels emits centroid + area text per room', () => {
      const m = rectModel();
      const labels = roomLabels(m.rooms, 200, 200, 40);
      expect(labels.length).toBe(m.rooms.length);
      for (const l of labels) {
        expect(l.area).toBeGreaterThan(0);
        expect(l.areaText).toMatch(/^\d+\.\d{2}㎡$/);
      }
    });
  });
});
