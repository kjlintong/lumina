import { describe, expect, it } from 'vitest';
import { toGrayscale, binarize, detectLines, preprocessForCalibration } from '../imagePreprocess.js';

describe('imagePreprocess', () => {
  it('toGrayscale outputs correct gray values', () => {
    // RGBA: [255, 0, 0, 255] -> 0.299*255 = 76
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    const gray = toGrayscale(data, 1, 1);
    expect(gray[0]).toBe(76);
  });

  it('toGrayscale white pixel -> 255', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    const gray = toGrayscale(data, 1, 1);
    expect(gray[0]).toBe(255);
  });

  it('toGrayscale black pixel -> 0', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    const gray = toGrayscale(data, 1, 1);
    expect(gray[0]).toBe(0);
  });

  it('binarize at threshold 128 produces correct binary output', () => {
    const gray = new Uint8ClampedArray([50, 100, 150, 200, 250]);
    const binary = binarize(gray, 128);
    expect(binary[0]).toBe(0);
    expect(binary[1]).toBe(0);
    expect(binary[2]).toBe(255);
    expect(binary[3]).toBe(255);
    expect(binary[4]).toBe(255);
  });

  it('binarize default threshold is 128', () => {
    const gray = new Uint8ClampedArray([127, 128, 129]);
    const binary = binarize(gray);
    expect(binary[0]).toBe(0);
    expect(binary[1]).toBe(255);
    expect(binary[2]).toBe(255);
  });

  it('detectLines returns at least 1 line for a known horizontal line', () => {
    const width = 100;
    const height = 10;
    const binary = new Uint8ClampedArray(width * height).fill(255);
    // Draw a dark horizontal line at y=5, x=10..50
    for (let x = 10; x < 50; x++) {
      binary[5 * width + x] = 0;
    }
    const lines = detectLines(binary, width, height, 20);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]!.y1).toBe(5);
    expect(lines[0]!.y2).toBe(5);
  });

  it('detectLines returns at least 1 line for a known vertical line', () => {
    const width = 10;
    const height = 100;
    const binary = new Uint8ClampedArray(width * height).fill(255);
    // Draw a dark vertical line at x=5, y=20..60
    for (let y = 20; y < 60; y++) {
      binary[y * width + 5] = 0;
    }
    const lines = detectLines(binary, width, height, 20);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.x1 === 5 && l.x2 === 5)).toBe(true);
  });

  it('detectLines returns empty for uniform image', () => {
    const binary = new Uint8ClampedArray(100).fill(255);
    const lines = detectLines(binary, 10, 10, 20);
    expect(lines).toHaveLength(0);
  });

  it('preprocessForCalibration returns both gray and binary', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const result = preprocessForCalibration(data, 3, 1, 128);
    expect(result.gray).toBeDefined();
    expect(result.binary).toBeDefined();
    expect(result.gray.length).toBe(3);
    expect(result.binary.length).toBe(3);
  });
});
