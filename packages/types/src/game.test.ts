import { describe, it, expect } from 'vitest';
import { levelForXp, XP_TO_LEVEL, MAX_LEVEL } from './game.js';

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
