import { describe, expect, it } from 'vitest';

import {
  solarCct,
  solarColor,
  solarDeclination,
  solarPosition,
  sunriseSunset,
} from '../solar.js';

describe('solarDeclination', () => {
  it('returns 0 at equinox (day 81 ≈ vernal equinox)', () => {
    // 春分赤纬接近 0
    expect(Math.abs(solarDeclination(81))).toBeLessThan(0.05);
  });

  it('returns max at summer solstice (day 172 ≈ 夏至)', () => {
    const d = solarDeclination(172);
    expect(Math.abs(d - (23.45 * Math.PI) / 180)).toBeLessThan(0.05);
  });

  it('returns min at winter solstice (day 355 ≈ 冬至)', () => {
    const d = solarDeclination(355);
    expect(Math.abs(d + (23.45 * Math.PI) / 180)).toBeLessThan(0.05);
  });
});

describe('solarPosition', () => {
  // 北京纬度 39.9°
  const BEIJING = (39.9 * Math.PI) / 180;

  it('noon (12:00) at equinox: sun is high and south', () => {
    const decl = 0; // 春分
    const pos = solarPosition(12, BEIJING, decl);
    // 正午太阳高度 = 90° - |lat - decl| = 90° - 39.9° ≈ 50.1°
    expect(pos.elevation).toBeCloseTo(Math.PI / 2 - BEIJING, 1);
    // 正午方位角应朝南 (π)
    expect(Math.abs(pos.azimuth - Math.PI)).toBeLessThan(0.1);
    expect(pos.belowHorizon).toBe(false);
  });

  it('sunrise: elevation ≈ 0', () => {
    const decl = (23.45 * Math.PI) / 180 * 0.5; // 春末
    const { sunrise } = sunriseSunset(BEIJING, decl);
    const pos = solarPosition(sunrise, BEIJING, decl);
    expect(pos.elevation).toBeCloseTo(0, 1);
    expect(pos.belowHorizon).toBe(false);
  });

  it('midnight: sun below horizon', () => {
    const pos = solarPosition(0, BEIJING, 0);
    expect(pos.belowHorizon).toBe(true);
  });

  it('noon at equator with zero declination: sun at zenith', () => {
    const pos = solarPosition(12, 0, 0);
    expect(pos.elevation).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('sunriseSunset', () => {
  const BEIJING = (39.9 * Math.PI) / 180;
  const DECL_MAX = (23.45 * Math.PI) / 180;
  const DECL_ZERO = 0;

  it('summer solstice: early sunrise, late sunset', () => {
    const { sunrise, sunset } = sunriseSunset(BEIJING, DECL_MAX);
    // 北京夏至日出约 4:35（4.58h）
    expect(sunrise).toBeLessThan(4.7);
    expect(sunset).toBeGreaterThan(19.3);
  });

  it('winter solstice: late sunrise, early sunset', () => {
    const { sunrise, sunset } = sunriseSunset(BEIJING, -DECL_MAX);
    expect(sunrise).toBeGreaterThan(7);
    expect(sunset).toBeLessThan(17);
  });

  it('equinox: symmetric sunrise/sunset around noon', () => {
    const { sunrise, sunset } = sunriseSunset(BEIJING, DECL_ZERO);
    const noon = 12;
    expect(noon - sunrise).toBeCloseTo(sunset - noon, 1);
  });

  it('polar day: sunrise=0, sunset=24 (high latitude summer)', () => {
    const polarLat = (80 * Math.PI) / 180;
    const { sunrise, sunset } = sunriseSunset(polarLat, DECL_MAX);
    expect(sunrise).toBe(0);
    expect(sunset).toBe(24);
  });

  it('polar night: sunrise=sunset=12 (high latitude winter)', () => {
    const polarLat = (80 * Math.PI) / 180;
    const { sunrise, sunset } = sunriseSunset(polarLat, -DECL_MAX);
    expect(sunrise).toBe(12);
    expect(sunset).toBe(12);
  });
});

describe('solarCct', () => {
  it('returns 2000K below horizon', () => {
    expect(solarCct(-0.1)).toBe(2000);
  });

  it('returns ~2000K at horizon', () => {
    expect(solarCct(0.01)).toBeLessThan(2500);
  });

  it('returns ~5500K at zenith', () => {
    expect(solarCct(Math.PI / 2)).toBeGreaterThan(5000);
  });

  it('increases with elevation (caps at 5500K for elevation >= π/4)', () => {
    // π/8 is in the ramp zone, π/4 is the cap boundary, π/2 is well above
    expect(solarCct(Math.PI / 8)).toBeLessThan(solarCct(Math.PI / 4));
    expect(solarCct(Math.PI / 4)).toBeLessThanOrEqual(solarCct(Math.PI / 2));
    // Both cap at 5500K
    expect(solarCct(Math.PI / 4)).toBe(5500);
    expect(solarCct(Math.PI / 2)).toBe(5500);
  });
});

describe('solarColor', () => {
  it('returns black (0,0,0) below horizon', () => {
    const c = solarColor(-0.1);
    expect(c).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns orange/red near horizon', () => {
    const c = solarColor(0.01);
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.b).toBeLessThan(0.4);
  });

  it('returns warm white at high elevation', () => {
    const c = solarColor(Math.PI / 2);
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.g).toBeGreaterThan(0.9);
    expect(c.b).toBeGreaterThan(0.9);
  });

  it('color components are always in [0,1]', () => {
    for (let i = 0; i <= 100; i++) {
      const elev = (i / 100) * (Math.PI / 2);
      const c = solarColor(elev);
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(1);
      expect(c.g).toBeGreaterThanOrEqual(0);
      expect(c.g).toBeLessThanOrEqual(1);
      expect(c.b).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeLessThanOrEqual(1);
    }
  });

  it('blue component increases with elevation', () => {
    const low = solarColor(0.1);
    const high = solarColor(Math.PI / 4);
    expect(high.b).toBeGreaterThan(low.b);
  });
});
