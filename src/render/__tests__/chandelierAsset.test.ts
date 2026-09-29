import { describe, it, expect } from 'vitest';
import {
  LIGHT_ASSET_DEFS,
  ASSET_KEY_FOR_TYPE,
  FIXTURE_TYPES_WITH_ASSETS,
  assetKeyForType,
} from '../lightAssets.js';
import type { FixtureType } from '../../core/types.js';

describe('P37d：chandelier 资产接入', () => {
  it('LIGHT_ASSET_DEFS.chandelier.axis === vertical', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.axis).toBe('vertical');
  });

  it('LIGHT_ASSET_DEFS.chandelier.targetSize === 0.8', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.targetSize).toBeCloseTo(0.8, 5);
  });

  it('LIGHT_ASSET_DEFS.chandelier.anchor === top', () => {
    expect(LIGHT_ASSET_DEFS.chandelier.anchor).toBe('top');
  });

  it('ASSET_KEY_FOR_TYPE.chandelier === chandelier', () => {
    expect(ASSET_KEY_FOR_TYPE.chandelier).toBe('chandelier');
  });

  it('FIXTURE_TYPES_WITH_ASSETS 含 chandelier', () => {
    expect(FIXTURE_TYPES_WITH_ASSETS).toContain('chandelier');
  });

  it('assetKeyForType(chandelier) === chandelier', () => {
    expect(assetKeyForType('chandelier' as FixtureType)).toBe('chandelier');
  });
});
