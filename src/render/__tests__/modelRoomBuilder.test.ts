import { describe, expect, it } from 'vitest';
import { buildModelRoom, FLOOR_MATERIAL, WALL_MATERIAL, WINDOW_GLASS_MATERIAL } from '../modelRoomBuilder.js';
import type { ModelGeometry } from '../../core/modeling.js';
import { DEFAULT_WALL_THICKNESS, MODEL_SCHEMA_ID } from '../../core/modeling.js';

function makeMinimalModel(): ModelGeometry {
  return {
    schemaId: MODEL_SCHEMA_ID,
    walls: [],
    openings: [],
    rooms: [],
    slab: { level: 0, thickness: DEFAULT_WALL_THICKNESS, ceilingH: 2.8 },
    calibration: null,
    track: { track: 'scan', guaranteesUniformError: false },
  };
}

function makeRoomModel(): ModelGeometry {
  return {
    schemaId: MODEL_SCHEMA_ID,
    walls: [
      {
        id: 'w1',
        a: [0, 0],
        b: [3, 0],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
      {
        id: 'w2',
        a: [3, 0],
        b: [3, 3],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
      {
        id: 'w3',
        a: [3, 3],
        b: [0, 3],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
      {
        id: 'w4',
        a: [0, 3],
        b: [0, 0],
        thickness: 0.15,
        height: 2.8,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
    ],
    openings: [
      {
        id: 'win1',
        wallId: 'w1',
        kind: 'window',
        offset: 0.5,
        width: 1.5,
        height: 1.2,
        sill: 0.9,
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
    ],
    rooms: [
      {
        id: 'r1',
        name: 'Living Room',
        vertices: [[0, 0], [3, 0], [3, 3], [0, 3]],
        confidence: 1,
        provenance: { kind: 'user_edit' },
      },
    ],
    slab: { level: 0, thickness: 0.15, ceilingH: 2.8 },
    calibration: null,
    track: { track: 'scan', guaranteesUniformError: false },
  };
}

describe('modelRoomBuilder', () => {
  it('buildModelRoom on empty model returns empty Group', () => {
    const model = makeMinimalModel();
    const group = buildModelRoom(model);
    expect(group.children).toHaveLength(0);
  });

  it('buildModelRoom with walls returns Group containing Meshes', () => {
    const model = makeRoomModel();
    const group = buildModelRoom(model);
    // 4 walls + 1 window + floor + ceiling = 7 children
    expect(group.children.length).toBeGreaterThanOrEqual(6);
    const meshes = group.children.filter(
      (c) => (c as { isMesh?: boolean }).isMesh,
    );
    expect(meshes.length).toBeGreaterThanOrEqual(4);
  });

  it('buildModelRoom with window opening returns Mesh with glass material', () => {
    const model = makeRoomModel();
    const group = buildModelRoom(model);
    const glassMeshes = group.children.filter(
      (c) => {
        const mesh = c as unknown as { isMesh?: boolean; material?: { transmission?: number } };
        return mesh.isMesh && mesh.material !== undefined && mesh.material.transmission === 1.0;
      },
    );
    expect(glassMeshes.length).toBeGreaterThanOrEqual(1);
  });

  it('floor material has correct roughness', () => {
    expect(FLOOR_MATERIAL.roughness).toBeCloseTo(0.4, 1);
  });

  it('wall material has correct roughness', () => {
    expect(WALL_MATERIAL.roughness).toBeCloseTo(0.9, 1);
  });

  it('window glass material has transmission 1.0 and ior 1.5', () => {
    expect(WINDOW_GLASS_MATERIAL.transmission).toBe(1.0);
    expect(WINDOW_GLASS_MATERIAL.ior).toBe(1.5);
  });

  it('buildModelRoom groups are named model-room', () => {
    const group = buildModelRoom(makeRoomModel());
    expect(group.name).toBe('model-room');
  });
});
