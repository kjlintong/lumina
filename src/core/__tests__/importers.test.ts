import { describe, expect, it } from 'vitest';

import { describeImporter, type ImportSource } from '../importers.js';

describe('describeImporter（§4 必测：全部 5 种 source 返回合法 descriptor）', () => {
  describe('image 路径（3 种 format）', () => {
    it('pdf 图片：available = true，track = scan', () => {
      const d = describeImporter({ kind: 'image', format: 'pdf' });
      expect(d.available).toBe(true);
      expect(d.track.track).toBe('scan');
      expect(d.track.guaranteesUniformError).toBe(false);
      expect(d.unavailableReason).toBeUndefined();
    });

    it('jpg 图片：available = true，track = scan', () => {
      const d = describeImporter({ kind: 'image', format: 'jpg' });
      expect(d.available).toBe(true);
      expect(d.track.track).toBe('scan');
      expect(d.track.guaranteesUniformError).toBe(false);
      expect(d.unavailableReason).toBeUndefined();
    });

    it('png 图片：available = true，track = scan', () => {
      const d = describeImporter({ kind: 'image', format: 'png' });
      expect(d.available).toBe(true);
      expect(d.track.track).toBe('scan');
      expect(d.track.guaranteesUniformError).toBe(false);
      expect(d.unavailableReason).toBeUndefined();
    });

    it('image descriptor 回传原 source（用于 UI 分支判断）', () => {
      const source: ImportSource = { kind: 'image', format: 'pdf' };
      const d = describeImporter(source);
      expect(d.source).toEqual(source);
    });
  });

  describe('cad 路径（dwg / dxf）—— §6 范围 1「DWG/DXF/IFC 本期不做」', () => {
    it('dwg：available = false，有 unavailableReason', () => {
      const d = describeImporter({ kind: 'cad', format: 'dwg' });
      expect(d.available).toBe(false);
      expect(d.unavailableReason).toBeDefined();
      expect(d.unavailableReason).toContain('DWG');
      expect(d.unavailableReason).toContain('DXF');
    });

    it('dxf：available = false，有 unavailableReason', () => {
      const d = describeImporter({ kind: 'cad', format: 'dxf' });
      expect(d.available).toBe(false);
      expect(d.unavailableReason).toBeDefined();
    });

    it('cad 的 track 仍是 cad（§6「分档 SLA」：分档本身不因不可用消失）', () => {
      const d = describeImporter({ kind: 'cad', format: 'dwg' });
      expect(d.track.track).toBe('cad');
      expect(d.track.guaranteesUniformError).toBe(true);
    });
  });

  describe('ifc 路径 —— §6 范围 1「DWG/DXF/IFC 本期不做」', () => {
    it('ifc：available = false，有 unavailableReason', () => {
      const d = describeImporter({ kind: 'ifc' });
      expect(d.available).toBe(false);
      expect(d.unavailableReason).toBeDefined();
      expect(d.unavailableReason).toContain('IFC');
    });
  });

  describe('template 路径', () => {
    it('template：available = true，track = template', () => {
      const d = describeImporter({ kind: 'template', templateId: 'two-bed' });
      expect(d.available).toBe(true);
      expect(d.track.track).toBe('template');
      expect(d.track.guaranteesUniformError).toBe(true);
      expect(d.unavailableReason).toBeUndefined();
    });

    it('templateId 被回传到 descriptor.source', () => {
      const d = describeImporter({ kind: 'template', templateId: 'three-bed-loft' });
      expect(d.source.kind).toBe('template');
      if (d.source.kind === 'template') {
        expect(d.source.templateId).toBe('three-bed-loft');
      }
    });
  });

  describe('§4 红线：不可用路径必须有可用的人话提示（不得是技术报错）', () => {
    it('cad 的 unavailableReason 是人话（不含技术术语如 ENOTFOUND / EACCES / 404）', () => {
      const d = describeImporter({ kind: 'cad', format: 'dwg' });
      expect(d.unavailableReason).toBeDefined();
      expect(d.unavailableReason).not.toMatch(/ENOTFOUND|EACCES|404|500|Error:|Exception/i);
    });

    it('ifc 的 unavailableReason 是人话', () => {
      const d = describeImporter({ kind: 'ifc' });
      expect(d.unavailableReason).toBeDefined();
      expect(d.unavailableReason).not.toMatch(/ENOTFOUND|EACCES|404|500|Error:|Exception/i);
    });

    it('available = true 的路径不应该有 unavailableReason', () => {
      for (const source of [
        { kind: 'image', format: 'pdf' },
        { kind: 'image', format: 'jpg' },
        { kind: 'image', format: 'png' },
        { kind: 'template', templateId: 'x' },
      ] as const) {
        const d = describeImporter(source);
        expect(d.available).toBe(true);
        expect(d.unavailableReason).toBeUndefined();
      }
    });
  });

  describe('§4 红线：分档 SLA 的语义一致性', () => {
    it('scan 分档 guaranteesUniformError = false', () => {
      const d = describeImporter({ kind: 'image', format: 'pdf' });
      expect(d.track.track).toBe('scan');
      expect(d.track.guaranteesUniformError).toBe(false);
    });

    it('cad / template 分档 guaranteesUniformError = true', () => {
      expect(describeImporter({ kind: 'cad', format: 'dwg' }).track.guaranteesUniformError).toBe(
        true,
      );
      expect(
        describeImporter({ kind: 'template', templateId: 'x' }).track.guaranteesUniformError,
      ).toBe(true);
    });

    it('cad / template 分档 maxErrorCm = 5（§6 验收判据：墙位误差 < 5cm）', () => {
      const cadD = describeImporter({ kind: 'cad', format: 'dwg' });
      if (cadD.track.track === 'cad') {
        expect(cadD.track.maxErrorCm).toBeLessThanOrEqual(5);
      }
      const tplD = describeImporter({ kind: 'template', templateId: 'x' });
      if (tplD.track.track === 'template') {
        expect(tplD.track.maxErrorCm).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('穷尽性检查（防止新增 source kind 漏改）', () => {
    it('所有 5 种 source kind 都有合法 descriptor', () => {
      const allSources: ImportSource[] = [
        { kind: 'image', format: 'pdf' },
        { kind: 'image', format: 'jpg' },
        { kind: 'image', format: 'png' },
        { kind: 'cad', format: 'dwg' },
        { kind: 'cad', format: 'dxf' },
        { kind: 'ifc' },
        { kind: 'template', templateId: 'x' },
      ];
      for (const source of allSources) {
        const d = describeImporter(source);
        expect(typeof d.available).toBe('boolean');
        expect(d.track.track).toBeDefined();
        expect(typeof d.track.guaranteesUniformError).toBe('boolean');
        expect(d.source).toEqual(source);
      }
    });
  });
});
