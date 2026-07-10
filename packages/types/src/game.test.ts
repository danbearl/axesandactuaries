import { describe, it, expect } from 'vitest';
import {
  levelForXp, XP_TO_LEVEL, MAX_LEVEL,
  computeCohesionIncrement, computeCohesionBonus, COHESION_MAX, COHESION_MAX_POWER_BONUS,
  computeTrainingHallBonus, findRolePropertyBonus,
  VOCATION_PARTY_ROLE, VOCATIONS,
  MAX_GEAR_TIER, GEAR_TIER_LEVEL_REQUIREMENT, computeGearBonus, computeGearUpgradeCost,
  minSatisfyingTier, isTierBelowTolerance,
} from './game.js';
import type { Vocation } from './game.js';

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

describe('computeGearBonus', () => {
  it('is zero with no gear', () => {
    expect(computeGearBonus(0)).toBe(0);
  });

  it('scales with gear tier', () => {
    expect(computeGearBonus(1)).toBeCloseTo(0.05);
    expect(computeGearBonus(MAX_GEAR_TIER)).toBeCloseTo(0.25);
  });

  it('is zero for an out-of-range tier rather than throwing', () => {
    expect(computeGearBonus(99)).toBe(0);
  });
});

describe('computeGearUpgradeCost', () => {
  it('rises with tier for the same power', () => {
    const costs = Array.from({ length: MAX_GEAR_TIER }, (_, i) => computeGearUpgradeCost(i + 1, 100));
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });

  it('rises with the adventurer\'s current power for the same tier', () => {
    expect(computeGearUpgradeCost(1, 200)).toBeGreaterThan(computeGearUpgradeCost(1, 50));
  });

  it('is zero for an out-of-range tier rather than throwing', () => {
    expect(computeGearUpgradeCost(99, 100)).toBe(0);
  });
});

describe('GEAR_TIER_LEVEL_REQUIREMENT', () => {
  it('gates the final tier behind MAX_LEVEL', () => {
    expect(GEAR_TIER_LEVEL_REQUIREMENT[MAX_GEAR_TIER]).toBe(MAX_LEVEL);
  });

  it('rises strictly with tier', () => {
    for (let t = 2; t <= MAX_GEAR_TIER; t++) {
      expect(GEAR_TIER_LEVEL_REQUIREMENT[t]).toBeGreaterThan(GEAR_TIER_LEVEL_REQUIREMENT[t - 1]);
    }
  });
});

describe('findRolePropertyBonus', () => {
  const armory = [{ type: 'armory', level: 2, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } }];

  it('applies to a fighter-role vocation when the matching property exists', () => {
    expect(findRolePropertyBonus('Sellsword', armory, 'xpBonusPerLevel')).toBeCloseTo(0.2);
    expect(findRolePropertyBonus('Outrider', armory, 'loyaltyRecoveryBonus')).toBe(2);
  });

  it('is zero for a vocation with no assigned role', () => {
    // Every current vocation has a role now, but the lookup must stay safe for a future
    // one that doesn't yet — the same situation Chanter itself was in (as "Chronicler")
    // before this rework assigned it to priest.
    expect(findRolePropertyBonus('Unassigned' as Vocation, armory, 'xpBonusPerLevel')).toBe(0);
  });

  it('is zero for a vocation whose role has no matching property', () => {
    expect(findRolePropertyBonus('Arcanist', armory, 'xpBonusPerLevel')).toBe(0);
  });

  it('is zero when the property has no properties at all', () => {
    expect(findRolePropertyBonus('Sellsword', [], 'xpBonusPerLevel')).toBe(0);
  });

  it('applies to a wizard-role vocation via a Library, independent of an owned Armory', () => {
    const library = { type: 'library', level: 1, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } };
    const both = [...armory, library];
    expect(findRolePropertyBonus('Arcanist', both, 'xpBonusPerLevel')).toBeCloseTo(0.1);
    expect(findRolePropertyBonus('Invoker', both, 'loyaltyRecoveryBonus')).toBe(1);
    // A fighter vocation still only matches Armory, not Library, when both are owned.
    expect(findRolePropertyBonus('Sellsword', both, 'xpBonusPerLevel')).toBeCloseTo(0.2);
  });

  it('applies to a rogue-role vocation via an Alchemy Lab', () => {
    const alchemyLab = [{ type: 'alchemy_lab', level: 3, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } }];
    expect(findRolePropertyBonus('Trickster', alchemyLab, 'xpBonusPerLevel')).toBeCloseTo(0.3);
    expect(findRolePropertyBonus('Alchemist', alchemyLab, 'loyaltyRecoveryBonus')).toBe(3);
  });

  it('applies to a priest-role vocation via a Sanctuary', () => {
    const sanctuary = [{ type: 'sanctuary', level: 1, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } }];
    expect(findRolePropertyBonus('Mender', sanctuary, 'xpBonusPerLevel')).toBeCloseTo(0.1);
    expect(findRolePropertyBonus('Chanter', sanctuary, 'loyaltyRecoveryBonus')).toBe(1);
  });
});

describe('VOCATION_PARTY_ROLE', () => {
  it('groups Chanter with Mender under priest', () => {
    expect(VOCATION_PARTY_ROLE.Chanter).toBe('priest');
    expect(VOCATION_PARTY_ROLE.Mender).toBe('priest');
  });

  it('assigns every vocation a role now that Chanter has replaced Chronicler', () => {
    for (const vocation of VOCATIONS) {
      expect(VOCATION_PARTY_ROLE[vocation]).toBeDefined();
    }
  });
});

describe('minSatisfyingTier', () => {
  it('maps each level band to the expected tier floor', () => {
    expect(minSatisfyingTier(1)).toBe('errand');
    expect(minSatisfyingTier(2)).toBe('errand');
    expect(minSatisfyingTier(3)).toBe('standard');
    expect(minSatisfyingTier(4)).toBe('standard');
    expect(minSatisfyingTier(5)).toBe('dangerous');
    expect(minSatisfyingTier(8)).toBe('dangerous');
    expect(minSatisfyingTier(9)).toBe('legendary');
    expect(minSatisfyingTier(MAX_LEVEL)).toBe('legendary');
  });

  it('gives a level-9 and a level-10 (max) adventurer different floors', () => {
    // Regression guard for the exact bug this was fixed for: before the MAX_LEVEL 6->10
    // rebalance, levels 5 and up (including the new 7-10 range) all mapped to the same
    // "dangerous" floor, so the current level cap was indistinguishable from a level barely
    // above the old threshold.
    expect(minSatisfyingTier(8)).not.toBe(minSatisfyingTier(9));
  });
});

describe('isTierBelowTolerance', () => {
  it('is false when the contract tier meets or exceeds what the level tolerates', () => {
    expect(isTierBelowTolerance('dangerous', 5)).toBe(false);
    expect(isTierBelowTolerance('legendary', 5)).toBe(false);
    expect(isTierBelowTolerance('legendary', MAX_LEVEL)).toBe(false);
  });

  it('is true when the contract tier falls short of what the level tolerates', () => {
    expect(isTierBelowTolerance('standard', 5)).toBe(true);
    expect(isTierBelowTolerance('dangerous', MAX_LEVEL)).toBe(true);
  });

  it('a max-level adventurer now tolerates only legendary, not dangerous', () => {
    expect(isTierBelowTolerance('dangerous', MAX_LEVEL)).toBe(true);
    expect(isTierBelowTolerance('legendary', MAX_LEVEL)).toBe(false);
  });
});
