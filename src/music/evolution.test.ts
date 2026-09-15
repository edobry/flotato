import { describe, expect, it } from 'vitest';
import { arpShapeAt, barsPerSecond, layersAt } from './evolution';

describe('layersAt', () => {
  it('brings layers in on plateaus: kick at 0, arp at L, hats at 2L, sixteenths at 4L', () => {
    expect(layersAt(0, 4, 'plateau16')).toEqual({ kick: true, arp: false, hats: false, sixteenths: false });
    expect(layersAt(3.9, 4, 'plateau16')).toEqual({ kick: true, arp: false, hats: false, sixteenths: false });
    expect(layersAt(4, 4, 'plateau16')).toEqual({ kick: true, arp: true, hats: false, sixteenths: false });
    expect(layersAt(8, 4, 'plateau16')).toEqual({ kick: true, arp: true, hats: true, sixteenths: false });
    expect(layersAt(16, 4, 'plateau16')).toEqual({ kick: true, arp: true, hats: true, sixteenths: true });
    expect(layersAt(400, 4, 'plateau16')).toEqual({ kick: true, arp: true, hats: true, sixteenths: true });
  });

  it('respects the ceiling: eighths never doubles, sixteenths doubles with the arp', () => {
    expect(layersAt(100, 4, 'eighths').sixteenths).toBe(false);
    expect(layersAt(3, 4, 'sixteenths').sixteenths).toBe(false);
    expect(layersAt(4, 4, 'sixteenths').sixteenths).toBe(true);
  });

  it('scales with layerBars and tolerates bad values', () => {
    expect(layersAt(7, 8, 'plateau16').arp).toBe(false);
    expect(layersAt(8, 8, 'plateau16').arp).toBe(true);
    expect(layersAt(1, 0, 'plateau16').arp).toBe(true);
  });
});

describe('arpShapeAt', () => {
  it('rotates every 8 bars, adds the passing tone every 16, reverses every 32', () => {
    expect(arpShapeAt(0)).toEqual({ rotate: 0, passing: false, reverse: false });
    expect(arpShapeAt(8)).toEqual({ rotate: 1, passing: false, reverse: false });
    expect(arpShapeAt(16)).toEqual({ rotate: 2, passing: true, reverse: false });
    expect(arpShapeAt(24)).toEqual({ rotate: 3, passing: true, reverse: false });
    expect(arpShapeAt(32)).toEqual({ rotate: 0, passing: false, reverse: true });
    expect(arpShapeAt(48)).toEqual({ rotate: 2, passing: true, reverse: true });
    expect(arpShapeAt(64)).toEqual({ rotate: 0, passing: false, reverse: false });
  });

  it('is deterministic and never negative', () => {
    expect(arpShapeAt(-3)).toEqual(arpShapeAt(0));
    expect(arpShapeAt(1000)).toEqual(arpShapeAt(1000));
  });
});

describe('barsPerSecond', () => {
  it('turns tempo into bars per second', () => {
    expect(barsPerSecond(120)).toBeCloseTo(0.5, 6);
    // At 130 BPM, 60 seconds is about 32 bars, which is where plateau16 lands with layerBars 8.
    expect(60 * barsPerSecond(130)).toBeCloseTo(32.5, 6);
  });
});
