import { describe, it, expect } from 'vitest';
import {
  generateContract, generateDailyContracts, CONTRACT_TIER_CONFIG,
  countUnmetRequirements, estimateSuccessChance,
  MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE, REQUIREMENT_PENALTY_PER_UNMET,
} from './contracts.js';
import type { ContractTier } from './game.js';

const TIERS: ContractTier[] = ['errand', 'standard', 'dangerous', 'legendary'];

describe('generateContract', () => {
  for (const tier of TIERS) {
    it(`generates a ${tier} contract within its configured ranges`, () => {
      const cfg = CONTRACT_TIER_CONFIG[tier];
      const now = new Date('2026-01-01T00:00:00.000Z');
      const contract = generateContract(tier, now);

      expect(contract.tier).toBe(tier);
      expect(contract.rewardGold).toBeGreaterThanOrEqual(cfg.rewardRange[0]);
      expect(contract.rewardGold).toBeLessThanOrEqual(cfg.rewardRange[1]);
      expect(contract.requiredPower).toBeGreaterThanOrEqual(cfg.powerRange[0]);
      expect(contract.requiredPower).toBeLessThanOrEqual(cfg.powerRange[1]);
      expect(contract.durationHours).toBeGreaterThanOrEqual(cfg.durationRange[0]);
      expect(contract.durationHours).toBeLessThanOrEqual(cfg.durationRange[1]);

      // penaltyGold is a deterministic function of the rolled rewardGold
      expect(contract.penaltyGold).toBe(Math.round(contract.rewardGold * cfg.penaltyMultiplier));
      expect(contract.reputationReward).toBe(cfg.reputationReward);
      expect(contract.penaltyReputation).toBe(cfg.penaltyReputation);

      expect(contract.bidDeadline.getTime()).toBe(now.getTime() + 20 * 60 * 60 * 1000);
      expect(contract.expiresAt.getTime()).toBe(now.getTime() + 48 * 60 * 60 * 1000);
    });
  }
});

describe('generateContract requirements', () => {
  it('never rolls a stat or vocation requirement for errand contracts', () => {
    for (let i = 0; i < 200; i++) {
      const contract = generateContract('errand');
      expect(Object.keys(contract.requiredStats)).toHaveLength(0);
      expect(contract.requiredVocation).toBeUndefined();
    }
  });

  it('never rolls a vocation requirement for standard contracts', () => {
    for (let i = 0; i < 200; i++) {
      const contract = generateContract('standard');
      expect(contract.requiredVocation).toBeUndefined();
    }
  });

  it('always rolls a stat requirement for dangerous and legendary contracts', () => {
    for (const tier of ['dangerous', 'legendary'] as ContractTier[]) {
      for (let i = 0; i < 100; i++) {
        const contract = generateContract(tier);
        expect(Object.keys(contract.requiredStats)).toHaveLength(1);
      }
    }
  });

  it('rolls a vocation requirement more often for legendary than dangerous contracts', () => {
    const countWithVocation = (tier: ContractTier) => {
      let count = 0;
      for (let i = 0; i < 200; i++) {
        if (generateContract(tier).requiredVocation) count++;
      }
      return count;
    };

    // dangerous ~50%, legendary ~80% — generous bounds to avoid flakiness.
    expect(countWithVocation('dangerous')).toBeGreaterThan(50);
    expect(countWithVocation('dangerous')).toBeLessThan(150);
    expect(countWithVocation('legendary')).toBeGreaterThan(120);
  });
});

describe('countUnmetRequirements', () => {
  it('returns 0 when the contract has no requirements', () => {
    const contract = { requiredStats: {}, requiredVocation: undefined };
    expect(countUnmetRequirements(contract, [])).toBe(0);
  });

  it('counts an unmet stat requirement', () => {
    const contract = { requiredStats: { Might: 15 }, requiredVocation: undefined };
    const party = [{ vocation: 'Sellsword', stats: { Might: 10 } }];
    expect(countUnmetRequirements(contract, party)).toBe(1);
  });

  it('does not count a stat requirement met by any single party member', () => {
    const contract = { requiredStats: { Might: 15 }, requiredVocation: undefined };
    const party = [
      { vocation: 'Chronicler', stats: { Might: 8 } },
      { vocation: 'Sellsword', stats: { Might: 16 } },
    ];
    expect(countUnmetRequirements(contract, party)).toBe(0);
  });

  it('counts an unmet vocation requirement', () => {
    const contract = { requiredStats: {}, requiredVocation: 'Arcanist' };
    const party = [{ vocation: 'Sellsword', stats: {} }];
    expect(countUnmetRequirements(contract, party)).toBe(1);
  });

  it('does not count a vocation requirement met by any single party member', () => {
    const contract = { requiredStats: {}, requiredVocation: 'Arcanist' };
    const party = [
      { vocation: 'Sellsword', stats: {} },
      { vocation: 'Arcanist', stats: {} },
    ];
    expect(countUnmetRequirements(contract, party)).toBe(0);
  });

  it('counts both an unmet stat and an unmet vocation requirement independently', () => {
    const contract = { requiredStats: { Attunement: 16 }, requiredVocation: 'Arcanist' };
    const party = [{ vocation: 'Sellsword', stats: { Attunement: 5 } }];
    expect(countUnmetRequirements(contract, party)).toBe(2);
  });
});

describe('estimateSuccessChance', () => {
  it('matches the base power-ratio formula with no unmet requirements', () => {
    // ratio 1.0 -> 0.3 + 1.0*0.5 = 0.8
    expect(estimateSuccessChance(100, 100, 0)).toBeCloseTo(0.8);
  });

  it('subtracts a fixed penalty per unmet requirement', () => {
    const base = estimateSuccessChance(100, 100, 0);
    const withOnePenalty = estimateSuccessChance(100, 100, 1);
    expect(base - withOnePenalty).toBeCloseTo(REQUIREMENT_PENALTY_PER_UNMET);
  });

  it('never drops below the minimum floor, even with heavy penalties', () => {
    expect(estimateSuccessChance(1, 1000, 10)).toBe(MIN_SUCCESS_CHANCE);
  });

  it('never exceeds the maximum ceiling regardless of overwhelming party power', () => {
    expect(estimateSuccessChance(10000, 1, 0)).toBe(MAX_SUCCESS_CHANCE);
  });
});

describe('generateDailyContracts', () => {
  it('produces the expected tier distribution', () => {
    const contracts = generateDailyContracts(new Date());
    const counts = contracts.reduce<Record<string, number>>((acc, c) => {
      acc[c.tier] = (acc[c.tier] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts.errand).toBe(5);
    expect(counts.standard).toBe(8);
    expect(counts.dangerous).toBe(5);
    expect(counts.legendary).toBe(2);
    expect(contracts).toHaveLength(20);
  });
});
