import { describe, it, expect } from 'vitest';
import {
  levelForXp, XP_TO_LEVEL, MAX_LEVEL,
  computeCohesionIncrement, computeCohesionBonus, COHESION_MAX, COHESION_MAX_POWER_BONUS,
  computeTrainingHallBonus, findRolePropertyBonus,
  VOCATION_PARTY_ROLE, VOCATIONS,
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
