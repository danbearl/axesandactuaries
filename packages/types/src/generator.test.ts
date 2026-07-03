import { describe, it, expect } from 'vitest';
import { generateAdventurer, generateAdventurerPool, computeHireCost, computeDailyWage } from './generator.js';
import { STATS } from './game.js';

describe('computeDailyWage', () => {
  it('is deterministic and scales with power rating', () => {
    expect(computeDailyWage(0)).toBe(5);
    expect(computeDailyWage(10)).toBe(11); // round(5 + 6)
    expect(computeDailyWage(100)).toBe(65); // round(5 + 60)
  });
});

describe('computeHireCost', () => {
  it('falls within the expected range for a given power rating', () => {
    const pr = 20;
    const min = 50 + pr * 8;
    const max = min + 20;
    for (let i = 0; i < 50; i++) {
      const cost = computeHireCost(pr);
      expect(cost).toBeGreaterThanOrEqual(min);
      expect(cost).toBeLessThanOrEqual(max);
    }
  });
});

describe('generateAdventurer', () => {
  it('produces a structurally valid adventurer', () => {
    const adv = generateAdventurer();

    expect(adv.level).toBe(1);
    expect(adv.experience).toBe(0);
    expect(adv.status).toBe('available');
    expect(adv.id).toMatch(/^adv_/);

    for (const stat of STATS) {
      expect(adv.stats[stat]).toBeGreaterThanOrEqual(5);
      expect(adv.stats[stat]).toBeLessThanOrEqual(20);
    }

    expect(adv.personality.loyalty).toBeGreaterThanOrEqual(1);
    expect(adv.personality.loyalty).toBeLessThanOrEqual(5);
    expect(adv.personality.ambition).toBeGreaterThanOrEqual(1);
    expect(adv.personality.ambition).toBeLessThanOrEqual(5);

    // dailyWage is a deterministic function of powerRating; hireCost has a
    // random component but must still be consistent with computeHireCost's range.
    expect(adv.dailyWage).toBe(computeDailyWage(adv.powerRating));
    const minHire = 50 + adv.powerRating * 8;
    expect(adv.hireCost).toBeGreaterThanOrEqual(minHire);
    expect(adv.hireCost).toBeLessThanOrEqual(minHire + 20);
  });

  it('computes power rating from the average stat times level', () => {
    const adv = generateAdventurer();
    const statAvg = Object.values(adv.stats).reduce((a, b) => a + b, 0) / STATS.length;
    expect(adv.powerRating).toBe(Math.round(statAvg * adv.level));
  });
});

describe('generateAdventurerPool', () => {
  it('generates the requested count with unique ids', () => {
    const pool = generateAdventurerPool(25);
    expect(pool).toHaveLength(25);
    expect(new Set(pool.map((a) => a.id)).size).toBe(25);
  });
});
