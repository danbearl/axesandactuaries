import { describe, it, expect } from 'vitest';
import {
  levelForXp, XP_TO_LEVEL, MAX_LEVEL,
  computeCohesionIncrement, computeCohesionBonus, COHESION_MAX, COHESION_MAX_POWER_BONUS,
  computeTrainingHallBonus,
} from './game.js';

describe('levelForXp', () => {
  it('returns level 1 for zero xp', () => {
    expect(levelForXp(0)).toBe(1);
  });

  it('returns level 1 for xp just below the level-2 threshold', () => {
    expect(levelForXp(XP_TO_LEVEL[2] - 1)).toBe(1);
  });

  it('returns the exact level at each threshold', () => {
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(levelForXp(XP_TO_LEVEL[lvl])).toBe(lvl);
    }
  });

  it('returns one level below threshold for xp just short of it', () => {
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(levelForXp(XP_TO_LEVEL[lvl] - 1)).toBe(lvl - 1);
    }
  });

  it('caps at MAX_LEVEL for arbitrarily large xp', () => {
    expect(levelForXp(1_000_000)).toBe(MAX_LEVEL);
  });
});

describe('computeCohesionIncrement', () => {
  it('adds the base amount plus both dispositions', () => {
    expect(computeCohesionIncrement(1, 1)).toBe(7);  // 5 + 1 + 1
    expect(computeCohesionIncrement(5, 5)).toBe(15); // 5 + 5 + 5
    expect(computeCohesionIncrement(3, 5)).toBe(13); // 5 + 3 + 5
  });
});

describe('computeCohesionBonus', () => {
  it('is zero for a party with no pairs', () => {
    expect(computeCohesionBonus([])).toBe(0);
  });

  it('is zero when every pair has never adventured together', () => {
    expect(computeCohesionBonus([0, 0, 0])).toBe(0);
  });

  it('scales linearly with average cohesion, capping at COHESION_MAX_POWER_BONUS', () => {
    expect(computeCohesionBonus([COHESION_MAX])).toBeCloseTo(COHESION_MAX_POWER_BONUS);
    expect(computeCohesionBonus([50])).toBeCloseTo(COHESION_MAX_POWER_BONUS / 2);
  });

  it('averages across mismatched pairs rather than excluding the never-partnered ones', () => {
    // one pair at max cohesion, one pair that's never worked together -> average 50
    expect(computeCohesionBonus([COHESION_MAX, 0])).toBeCloseTo(COHESION_MAX_POWER_BONUS / 2);
  });
});

describe('computeTrainingHallBonus', () => {
  it('is zero with no training hall', () => {
    expect(computeTrainingHallBonus([])).toBe(0);
    expect(computeTrainingHallBonus([{ type: 'infirmary', level: 3, bonus: {} }])).toBe(0);
  });

  it('scales with training hall level', () => {
    expect(computeTrainingHallBonus([
      { type: 'training_hall', level: 1, bonus: { powerRatingBonus: 0.1 } },
    ])).toBeCloseTo(0.1);
    expect(computeTrainingHallBonus([
      { type: 'training_hall', level: 3, bonus: { powerRatingBonus: 0.1 } },
    ])).toBeCloseTo(0.3);
  });

  it('ignores powerRatingBonus on non-training-hall properties', () => {
    // Alchemy Lab still has a dead powerRatingBonus field until its own redesign pass —
    // must not be picked up here.
    expect(computeTrainingHallBonus([
      { type: 'alchemy_lab', level: 3, bonus: { powerRatingBonus: 3 } },
    ])).toBe(0);
  });
});
