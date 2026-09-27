import { describe, expect, it } from 'vitest';
import { HOUSE_TEMPLATES, getTemplate } from '../templates.js';
import { checkTopology, roomArea } from '../topology.js';
import { DEFAULT_WALL_THICKNESS, MODEL_SCHEMA_ID } from '../modeling.js';
import { close } from '../units.js';

describe('templates', () => {
  it('has 8 templates', () => {
    expect(HOUSE_TEMPLATES.length).toBe(8);
  });

  it('all templates pass checkTopology (RED LINE 1: loop assertion)', () => {
    for (const t of HOUSE_TEMPLATES) {
      const report = checkTopology(t.model);
      expect(report.passed, JSON.stringify(report.violations, null, 2)).toBe(true);
    }
  });

  it('each template area equals sum of room areas within 5% tolerance', () => {
    for (const t of HOUSE_TEMPLATES) {
      const sum = t.model.rooms.reduce((s, r) => s + roomArea(r), 0);
      const relErr = Math.abs(sum - t.area) / t.area;
      expect(relErr, `${t.id}: area=${t.area} sum=${sum}`).toBeLessThanOrEqual(0.05);
    }
  });

  it('each template track is template with maxErrorCm=5', () => {
    for (const t of HOUSE_TEMPLATES) {
      expect(t.model.track.track).toBe('template');
      if (t.model.track.track === 'template') {
        expect(t.model.track.maxErrorCm).toBe(5);
      }
    }
  });

  it('each template calibration is non-null and unitConfirmed', () => {
    for (const t of HOUSE_TEMPLATES) {
      expect(t.model.calibration).not.toBe(null);
      expect(t.model.calibration?.unitConfirmed).toBe(true);
    }
  });

  it('each room vertices are closed (first === last within 0.01) and have >= 4 points', () => {
    for (const t of HOUSE_TEMPLATES) {
      for (const room of t.model.rooms) {
        expect(room.vertices.length).toBeGreaterThanOrEqual(4);
        const first = room.vertices[0]!;
        const last = room.vertices[room.vertices.length - 1]!;
        expect(close(first[0], last[0], 0.01)).toBe(true);
        expect(close(first[1], last[1], 0.01)).toBe(true);
      }
    }
  });

  it('each room provenance is model_inferred with house_template rule', () => {
    for (const t of HOUSE_TEMPLATES) {
      for (const room of t.model.rooms) {
        expect(room.provenance.kind).toBe('model_inferred');
        if (room.provenance.kind === 'model_inferred') {
          expect(room.provenance.rule).toBe('house_template');
        }
        expect(room.confidence).toBe(1);
      }
    }
  });

  it('each template has at least 1 door (sill=0) and 1 window (sill>0)', () => {
    for (const t of HOUSE_TEMPLATES) {
      const doors = t.model.openings.filter((o) => o.kind === 'door');
      const windows = t.model.openings.filter((o) => o.kind === 'window');
      expect(doors.length).toBeGreaterThanOrEqual(1);
      expect(windows.length).toBeGreaterThanOrEqual(1);
      expect(doors.every((d) => close(d.sill, 0))).toBe(true);
      expect(windows.every((w) => w.sill > 0)).toBe(true);
    }
  });

  it('all walls use DEFAULT_WALL_THICKNESS', () => {
    for (const t of HOUSE_TEMPLATES) {
      for (const wall of t.model.walls) {
        expect(close(wall.thickness, DEFAULT_WALL_THICKNESS)).toBe(true);
      }
    }
  });

  it('schemaId is stable', () => {
    for (const t of HOUSE_TEMPLATES) {
      expect(t.model.schemaId).toBe(MODEL_SCHEMA_ID);
    }
  });

  it('getTemplate returns matching template or undefined', () => {
    const t0 = getTemplate(HOUSE_TEMPLATES[0]!.id);
    expect(t0).toBe(HOUSE_TEMPLATES[0]);
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('getTemplate returns same reference (no copy)', () => {
    const t = getTemplate(HOUSE_TEMPLATES[0]!.id);
    expect(t).toBe(HOUSE_TEMPLATES[0]);
  });
});
