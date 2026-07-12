import { describe, it, expect } from 'vitest';
import {
  generateContract, CONTRACT_TIER_CONFIG,
  countUnmetRequirements, adventurerMeetsAnyRequirement, estimateSuccessChance,
  estimateChainedSuccessChance,
  MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE, REQUIREMENT_PENALTY_PER_UNMET,
  MIN_ROLE_MODIFIER, MAX_ROLE_MODIFIER,
  DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS, BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS,
  CONTRACT_MARKET_BASE_RATE, resolutionObject, confrontPhrase, CONTRACT_LOCATIONS,
} from './contracts.js';
import { BIDDING_CONTRACT_TIERS, splitPowerByRole } from './game.js';
import type { ContractTier, ContractEncounter, PartyPowerByRole } from './game.js';

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

const ROLES = ['fighter', 'wizard', 'rogue', 'priest'] as const;
const EXPECTED_ENCOUNTER_COUNT: Record<ContractTier, number> = {
  errand: 1, standard: 2, dangerous: 3, legendary: 4,
};

describe('generateContract encounters', () => {
  for (const tier of TIERS) {
    it(`generates exactly the tier-scaled encounter count for ${tier}`, () => {
      const contract = generateContract(tier);
      expect(contract.encounters).toHaveLength(EXPECTED_ENCOUNTER_COUNT[tier]);
    });

    it(`every ${tier} encounter's role modifiers stay within [${MIN_ROLE_MODIFIER}, ${MAX_ROLE_MODIFIER}]`, () => {
      const contract = generateContract(tier);
      for (const encounter of contract.encounters) {
        for (const role of ROLES) {
          expect(encounter[role]).toBeGreaterThanOrEqual(MIN_ROLE_MODIFIER);
          expect(encounter[role]).toBeLessThanOrEqual(MAX_ROLE_MODIFIER);
        }
      }
    });

    it(`every role's modifier is identical across all of a ${tier} contract's encounters`, () => {
      // A contract's favored/unfavored pattern is a fixed property of that contract, not
      // something that varies encounter-to-encounter — see pickRoleBiasPattern's design
      // comment. Only meaningful to check when there's more than one encounter.
      if (EXPECTED_ENCOUNTER_COUNT[tier] < 2) return;
      const contract = generateContract(tier);
      for (const role of ROLES) {
        const values = contract.encounters.map(e => e[role]);
        expect(new Set(values).size).toBe(1);
      }
    });

    it(`every ${tier} role modifier is either exactly neutral or a real, visible swing (no near-1.0 dead zone)`, () => {
      const contract = generateContract(tier);
      for (const encounter of contract.encounters) {
        for (const role of ROLES) {
          const v = encounter[role];
          expect(v === 1 || v >= 1.15 || v <= 0.85).toBe(true);
        }
      }
    });
  }

  it('the number of favored roles varies across contracts, from none to all four', () => {
    // Statistical check across many draws — pickRoleBiasPattern samples 0-4 favored roles
    // uniformly, so with enough samples both extremes (and everything between) should appear.
    const favoredCounts = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const contract = generateContract('legendary');
      const favored = contract.encounters[0]
        ? ROLES.filter(role => contract.encounters[0][role] >= 1.15).length
        : 0;
      favoredCounts.add(favored);
    }
    expect(favoredCounts.has(0)).toBe(true);
    expect(favoredCounts.has(4)).toBe(true);
  });
});

function uniformParty(role: keyof PartyPowerByRole, count: number, powerRating: number) {
  const vocationByRole: Record<string, string> = {
    fighter: 'Sellsword', wizard: 'Arcanist', rogue: 'Trickster', priest: 'Mender',
  };
  return Array.from({ length: count }, () => ({ vocation: vocationByRole[role], powerRating }));
}

describe('estimateChainedSuccessChance', () => {
  it('falls back to the flat formula when encounters is empty', () => {
    const powerByRole: PartyPowerByRole = { fighter: 60, wizard: 40, rogue: 0, priest: 0 };
    const chained = estimateChainedSuccessChance(powerByRole, 100, [], 0);
    const flat = estimateSuccessChance(100, 100, 0);
    expect(chained).toBe(flat);
  });

  it('matches the flat formula for a zero-variance chain (every encounter yields the same ratio)', () => {
    const powerByRole = splitPowerByRole(uniformParty('fighter', 6, 20));
    const totalPower = Object.values(powerByRole).reduce((a, b) => a + b, 0);
    // Every encounter weights the party's only present role identically — no variance.
    const encounters: ContractEncounter[] = [
      { fighter: 1.2, wizard: 1, rogue: 1, priest: 1 },
      { fighter: 1.2, wizard: 1, rogue: 1, priest: 1 },
      { fighter: 1.2, wizard: 1, rogue: 1, priest: 1 },
    ];
    const chained = estimateChainedSuccessChance(powerByRole, 100, encounters, 0);
    const flat = estimateSuccessChance(totalPower * 1.2, 100, 0);
    expect(chained).toBeCloseTo(flat, 10);
  });

  it('scores a role-balanced party higher than an equal-power single-role party against the same chain', () => {
    const requiredPower = 100;
    // Alternates which single role a given encounter favors — deliberately adversarial to a
    // single-role party, since it's guaranteed to hit at least one unfavorable encounter.
    const encounters: ContractEncounter[] = [
      { fighter: 1.5, wizard: 0.5, rogue: 1.0, priest: 1.0 },
      { fighter: 0.5, wizard: 1.5, rogue: 1.0, priest: 1.0 },
      { fighter: 1.0, wizard: 1.0, rogue: 1.5, priest: 0.5 },
    ];

    const singleRole = splitPowerByRole(uniformParty('fighter', 6, 20)); // 120 power, all fighter
    const balanced = splitPowerByRole([
      ...uniformParty('fighter', 2, 20),
      ...uniformParty('wizard', 2, 20),
      ...uniformParty('rogue', 1, 20),
      ...uniformParty('priest', 1, 20),
    ]); // same 120 total power, spread across all four roles

    const singleRoleChance = estimateChainedSuccessChance(singleRole, requiredPower, encounters, 0);
    const balancedChance = estimateChainedSuccessChance(balanced, requiredPower, encounters, 0);

    expect(balancedChance).toBeGreaterThan(singleRoleChance);
  });

  it('lets a party matched to a favored role exceed what the flat formula alone would give', () => {
    // Unlike the earlier per-encounter-noise design (where the flat formula was an
    // unreachable ceiling), a fixed favored-role bias is a real, direct bonus — a party
    // concentrated in a favored role should score strictly above the flat/neutral baseline
    // for the same total power, not just avoid falling short of it.
    const requiredPower = 100;
    const encounters: ContractEncounter[] = [
      { fighter: 1.3, wizard: 1, rogue: 1, priest: 1 },
      { fighter: 1.3, wizard: 1, rogue: 1, priest: 1 },
    ];
    const powerByRole = splitPowerByRole(uniformParty('fighter', 6, 20)); // 120 power, all fighter
    const totalPower = Object.values(powerByRole).reduce((a, b) => a + b, 0);

    const chained = estimateChainedSuccessChance(powerByRole, requiredPower, encounters, 0);
    const flat = estimateSuccessChance(totalPower, requiredPower, 0);

    expect(chained).toBeGreaterThan(flat);
  });

  it('never drops below the minimum floor, even with heavy requirement penalties', () => {
    const tiny: PartyPowerByRole = { fighter: 1, wizard: 0, rogue: 0, priest: 0 };
    const encounters: ContractEncounter[] = [{ fighter: 1, wizard: 1, rogue: 1, priest: 1 }];
    expect(estimateChainedSuccessChance(tiny, 1000, encounters, 10)).toBe(MIN_SUCCESS_CHANCE);
  });

  it('never exceeds the maximum ceiling regardless of overwhelming party power', () => {
    const huge: PartyPowerByRole = { fighter: 100000, wizard: 0, rogue: 0, priest: 0 };
    const encounters: ContractEncounter[] = [{ fighter: 1, wizard: 1, rogue: 1, priest: 1 }];
    expect(estimateChainedSuccessChance(huge, 1, encounters, 0)).toBe(MAX_SUCCESS_CHANCE);
  });
});
