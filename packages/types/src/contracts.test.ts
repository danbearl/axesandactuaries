import { describe, it, expect } from 'vitest';
import {
  generateContract, CONTRACT_TIER_CONFIG,
  countUnmetRequirements, adventurerMeetsAnyRequirement, estimateSuccessChance,
  MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE, REQUIREMENT_PENALTY_PER_UNMET,
  DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS, BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS,
  CONTRACT_MARKET_BASE_RATE, resolutionObject, confrontPhrase, CONTRACT_LOCATIONS,
} from './contracts.js';
import { BIDDING_CONTRACT_TIERS } from './game.js';
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

      // No deadline until a first bid lands — see routes/contracts.ts.
      expect(contract.bidDeadline).toBeNull();

      const isBiddingTier = BIDDING_CONTRACT_TIERS.includes(tier);
      const expectedExpiryHours = isBiddingTier
        ? BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS
        : DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS;
      expect(contract.expiresAt.getTime()).toBe(now.getTime() + expectedExpiryHours * 60 * 60 * 1000);
    });
  }
});

describe('generateContract procedural naming', () => {
  for (const tier of TIERS) {
    it(`generates a non-empty title and description for ${tier}`, () => {
      const contract = generateContract(tier);
      expect(contract.title.length).toBeGreaterThan(0);
      expect(contract.description.length).toBeGreaterThan(0);
    });

    it(`produces a wide variety of ${tier} titles rather than a small fixed pool`, () => {
      const titles = new Set<string>();
      for (let i = 0; i < 60; i++) {
        titles.add(generateContract(tier).title);
      }
      // The old fixed pool topped out at 10 per tier; procedural generation should clear
      // that by a wide margin even over a modest sample, without asserting an exact count
      // (which would make this test brittle against word-bank size changes).
      expect(titles.size).toBeGreaterThan(15);
    });
  }

  // No test asserts zero back-to-back repeats: the recent-title dedup (mirroring
  // generator.ts's adventurer-name history) retries a fixed number of times and then
  // accepts whatever it gets — a deliberate best-effort design, not a hard uniqueness
  // guarantee (see the comment above generateContractFlavor in contracts.ts). An earlier
  // version of this test asserted exactly that guarantee across 20 real-random draws per
  // tier and failed intermittently in CI — legendary's pool was thin enough (one of its two
  // patterns used to ignore location entirely, leaving only 6 "hot" title values out of ~114)
  // that a genuine, expected collision surfaced often enough to make the assertion flaky
  // rather than a real regression signal. Both issues (the location-less pattern, and a
  // shared-across-tiers dedup window that let errand/standard's volume evict legendary's own
  // recent history) were fixed 2026-07-10 — legendary's combinatorics and dedup fairness are
  // both meaningfully better now, but the assertion here is still left loose rather than
  // reintroducing a hard uniqueness guarantee.

  it('every legendary title includes a location', () => {
    // Regression guard for the specific bug that made legendary the most repetitive tier:
    // one of its two title patterns used to ignore location/client entirely, so every title
    // from that pattern was identical for a given flavor regardless of which of the 18
    // locations got picked.
    for (let i = 0; i < 100; i++) {
      const { title } = generateContract('legendary');
      expect(CONTRACT_LOCATIONS.some((loc) => title.includes(loc))).toBe(true);
    }
  });
});

describe('resolutionObject', () => {
  it('uses "it" for an impersonal thing', () => {
    expect(resolutionObject('thing')).toBe('it handled');
  });

  it('uses "them" for a hostile person or people, with a confrontational verb', () => {
    expect(resolutionObject('hostile')).toBe('them dealt with');
  });

  it('uses "them" for someone the party is meant to help, with a protective verb', () => {
    expect(resolutionObject('friendly')).toBe('them looked after');
  });
});

describe('confrontPhrase', () => {
  it('never uses a violent verb ("put to rest") for someone the party is meant to protect', () => {
    expect(confrontPhrase('friendly')).not.toContain('rest');
    expect(confrontPhrase('friendly')).not.toContain('heel');
  });

  it('differs across all three subjects', () => {
    const phrases = new Set([confrontPhrase('thing'), confrontPhrase('hostile'), confrontPhrase('friendly')]);
    expect(phrases.size).toBe(3);
  });
});

describe('generateContract grammar correctness', () => {
  // Regression guard for the actual reported bug: hooks describing a person or people (e.g.
  // "a debtor who has gone conveniently quiet") used to be spliced into sentences with a
  // generic "it" ("needs it handled") and violent verbs ("put it to rest") regardless of
  // whether the hook was a hostile target or someone to protect. Each hook string below is
  // unique enough to identify which flavor was picked, so once it shows up in a generated
  // description, the surrounding phrasing can be checked directly rather than relying on
  // random luck to eventually hit every case.
  const HOSTILE_HOOKS = [
    'a debtor who has gone conveniently quiet', // errand: Silent Debtor
    'squatters holed up in an empty granary', // errand: Squatters
    'bandits ambushing traders on the road', // standard: Bandit Ambush
    'armed deserters squatting in a fortified ruin', // standard: Deserter Camp
    'agents of a rival lord operating in the shadows', // dangerous: Rival Agents
  ];
  const FRIENDLY_HOOKS = [
    'the only healer for three villages, gone missing', // standard: Missing Healer
    'a lorekeeper who needs safe passage through contested roads', // standard: Escort Risk
  ];

  it('never refers to a hostile-person hook with "it", and never uses "put ... to rest" on one', () => {
    const tiers: ContractTier[] = ['errand', 'standard', 'dangerous'];
    for (const tier of tiers) {
      for (let i = 0; i < 300; i++) {
        const { description } = generateContract(tier);
        const matchedHook = HOSTILE_HOOKS.find((hook) => description.includes(hook));
        if (!matchedHook) continue;
        expect(description).not.toContain('needs it');
        expect(description).not.toContain('put it to rest');
      }
    }
  });

  it('never refers to a friendly hook with "it", and never uses a confrontational verb on one', () => {
    for (let i = 0; i < 300; i++) {
      const { description } = generateContract('standard');
      const matchedHook = FRIENDLY_HOOKS.find((hook) => description.includes(hook));
      if (!matchedHook) continue;
      expect(description).not.toContain('needs it');
      expect(description).not.toContain('put it to rest');
      expect(description).not.toContain('dealt with');
      expect(description).not.toContain('bring them to heel');
    }
  });
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
      { vocation: 'Chanter', stats: { Might: 8 } },
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

describe('adventurerMeetsAnyRequirement', () => {
  it('is false when the contract has no requirements', () => {
    const contract = { requiredStats: {}, requiredVocation: undefined };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Sellsword', stats: {} })).toBe(false);
  });

  it('is true when the adventurer meets the vocation requirement', () => {
    const contract = { requiredStats: {}, requiredVocation: 'Arcanist' };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Arcanist', stats: {} })).toBe(true);
  });

  it('is false when the adventurer does not meet the vocation requirement', () => {
    const contract = { requiredStats: {}, requiredVocation: 'Arcanist' };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Sellsword', stats: {} })).toBe(false);
  });

  it('is true when the adventurer meets a stat requirement', () => {
    const contract = { requiredStats: { Might: 15 }, requiredVocation: undefined };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Sellsword', stats: { Might: 16 } })).toBe(true);
  });

  it('is false when the adventurer falls short of every stat requirement', () => {
    const contract = { requiredStats: { Might: 15 }, requiredVocation: undefined };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Sellsword', stats: { Might: 10 } })).toBe(false);
  });

  it('is true if any one of multiple requirements is met, without needing all of them', () => {
    const contract = { requiredStats: { Might: 15, Grit: 15 }, requiredVocation: 'Arcanist' };
    expect(adventurerMeetsAnyRequirement(contract, { vocation: 'Sellsword', stats: { Might: 16, Grit: 5 } })).toBe(true);
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

describe('CONTRACT_MARKET_BASE_RATE', () => {
  it('defines a per-active-player standing-target rate for every tier', () => {
    expect(CONTRACT_MARKET_BASE_RATE.errand).toBe(5);
    expect(CONTRACT_MARKET_BASE_RATE.standard).toBe(8);
    expect(CONTRACT_MARKET_BASE_RATE.dangerous).toBe(5);
    expect(CONTRACT_MARKET_BASE_RATE.legendary).toBe(2);
  });
});
