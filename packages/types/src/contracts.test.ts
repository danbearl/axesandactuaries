import { describe, it, expect } from 'vitest';
import { generateContract, generateDailyContracts, CONTRACT_TIER_CONFIG } from './contracts.js';
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
