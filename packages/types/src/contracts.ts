import type { ContractTier, Stat, StatBlock, Vocation } from './game.js';
import { STATS, VOCATIONS, VOCATION_STAT_PRIORITY } from './game.js';

// ── Utility ───────────────────────────────────────────────────────────────────

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ── Deploy-by deadlines ─────────────────────────────────────────────────────────
// An awarded contract that never gets a party deployed is treated as failed (same
// penaltyGold/penaltyReputation as an actually-failed adventure) once its deploy-by
// deadline passes — otherwise a player could accept/win contracts indefinitely without
// ever committing to them, denying them to everyone else with zero cost.
//
// Two different windows, because *who* controls the award moment differs:
// - Direct accept and welfare claims are player-initiated — the player is already at the
//   keyboard when they act, so a short clock starting immediately is fair.
// - Bid awards are decided by the market-GC sweep at an unpredictable time, entirely
//   outside the winner's control — a short clock could expire while they're asleep. A full
//   day guarantees at least one waking window regardless of timezone, while still bounding
//   the hoarding risk to "at most a day," not forever.
export const DIRECT_ACCEPT_DEPLOY_HOURS = 3;
export const BID_AWARD_DEPLOY_HOURS = 24;

// ── Tier Configuration ────────────────────────────────────────────────────────

interface TierConfig {
  powerRange:        [number, number];
  rewardRange:       [number, number];
  durationRange:     [number, number]; // hours
  penaltyMultiplier: number;
  reputationReward:  number;
  penaltyReputation: number;
}

export const CONTRACT_TIER_CONFIG: Record<ContractTier, TierConfig> = {
  errand: {
    powerRange:        [5,   25],
    rewardRange:       [50,  200],
    durationRange:     [1,   6],
    penaltyMultiplier: 0.2,
    reputationReward:  1,
    penaltyReputation: 0,
  },
  standard: {
    powerRange:        [25,  70],
    rewardRange:       [200, 700],
    durationRange:     [4,   16],
    penaltyMultiplier: 0.3,
    reputationReward:  3,
    penaltyReputation: 1,
  },
  dangerous: {
    powerRange:        [70,  140],
    rewardRange:       [700, 2500],
    durationRange:     [12,  36],
    penaltyMultiplier: 0.5,
    reputationReward:  8,
    penaltyReputation: 3,
  },
  legendary: {
    powerRange:        [140, 280],
    rewardRange:       [2500, 7000],
    durationRange:     [24,  72],
    penaltyMultiplier: 0.7,
    reputationReward:  20,
    penaltyReputation: 8,
  },
};

// ── Contract Templates ────────────────────────────────────────────────────────

interface ContractTemplate {
  title:       string;
  description: string;
}

const ERRAND_TEMPLATES: readonly ContractTemplate[] = [
  {
    title:       'Courier: Sealed Documents',
    description: 'Deliver a sealed diplomatic pouch to a contact across the city. Discretion required; the contents are time-sensitive.',
  },
  {
    title:       'Cellar Clearance',
    description: 'A warehouse owner reports a vermin infestation making off with stored goods. Route them before the next shipment arrives.',
  },
  {
    title:       'Scout the Mill Road',
    description: 'Merchant caravans have been turning back from the old mill road citing "unsettling activity." Verify the route is passable.',
  },
  {
    title:       'Recover Lost Cargo',
    description: 'A wagon driver abandoned his load after a spooked horse. Retrieve the crates and return them to the guild depot.',
  },
  {
    title:       'Drive Off River Bandits',
    description: 'A pair of thugs has been shaking down river traders at the north crossing. Encourage them to relocate — permanently.',
  },
  {
    title:       'Debt Collection',
    description: 'A local creditor needs persuasive company when calling on a debtor who has been avoiding payment. Presence only — no violence unless provoked.',
  },
  {
    title:       'Blocked Well Investigation',
    description: 'A neighborhood well has gone foul and residents suspect something fell in. Investigate and clear it.',
  },
  {
    title:       'Night Watch: Market District',
    description: 'A merchant cooperative needs overnight guards for their stalls during the harvest festival. Straightforward watch duty.',
  },
];

const STANDARD_TEMPLATES: readonly ContractTemplate[] = [
  {
    title:       'Secure Shepherd\'s Pass',
    description: 'Warg activity has disrupted the mountain pass, costing shepherds their flocks. Establish a deterrent patrol and eliminate the pack leader.',
  },
  {
    title:       'Investigate the Missing Caravan',
    description: 'A trade caravan out of Ironhaven vanished three days ago. Find out what happened and recover the crew if they still live.',
  },
  {
    title:       'Hunt the Thornwood Pack',
    description: 'A grey-furred predator and its kin have been stalking the southern farmsteads. Track them into Thornwood and remove the threat.',
  },
  {
    title:       'Recover the Merchant\'s Ledgers',
    description: 'Bandits raided a trading post and made off with irreplaceable record books. Retrieve them from their camp in the Ashveil foothills.',
  },
  {
    title:       'Escort the Scholar to Duskfort',
    description: 'A lorekeeper carrying sensitive research must reach Duskfort before the week\'s end. See her there safely.',
  },
  {
    title:       'Clear Ashveil Caverns',
    description: 'Miners refuse to return to a profitable vein after disappearances were reported. Clear the caverns of whatever lurks in the lower passages.',
  },
  {
    title:       'Disrupt the Smuggling Ring',
    description: 'Contraband is moving through the warehouse district. Identify the ringleader, seize the goods, and hand the evidence to the authorities.',
  },
  {
    title:       'Find the Missing Mender',
    description: 'The only healer serving three villages vanished on the road north. Locate her and determine whether foul play was involved.',
  },
  {
    title:       'Patrol the Eastern Farmsteads',
    description: 'Tension between two landholding families has turned violent. Maintain a visible deterrent presence through the harvest until tempers cool.',
  },
  {
    title:       'Rout the Ironmoor Squatters',
    description: 'An abandoned fortress has been occupied by armed deserters using it as a base for raids. Drive them out and hold the position until a garrison arrives.',
  },
];

const DANGEROUS_TEMPLATES: readonly ContractTemplate[] = [
  {
    title:       'Breach the Sunken Vault',
    description: 'An ancient vault lies half-submerged beneath the flooded Greyfen. Its current occupants are not archaeological. Clear them out and document what\'s inside.',
  },
  {
    title:       'Slay the Wyvern of Greyspire',
    description: 'A territorial wyvern has claimed the Greyspire peak and downed two merchant vessels. A coalition of traders is offering a substantial bounty for its head.',
  },
  {
    title:       'Retrieve the Loremark',
    description: 'A powerful artifact was lost when Ashfield Keep fell. Intelligence places it in the ruins\' lower levels — now inhabited by something that has kept every prior expedition out.',
  },
  {
    title:       'Neutralize the Cultist Enclave',
    description: 'A Cinder-worshipping cult has been conducting rituals in the salt flats, and their activities are escalating. Dismantle the enclave before they complete whatever they\'re building toward.',
  },
  {
    title:       'Escort the Crown Envoy',
    description: 'A sensitive diplomatic mission requires armed escort through territory contested by two rival lords, both of whom would benefit from the envoy never arriving.',
  },
  {
    title:       'Purge the Blighted Grove',
    description: 'The Verdant Grove east of Thornwall has been corrupted — game dies within, travelers emerge sick, and the blight is spreading. Find the source and burn it out.',
  },
  {
    title:       'Break the Siege at Thornwall',
    description: 'A mercenary company has surrounded a small fortress and is demanding tribute. The defenders can hold two more days. Relieve them.',
  },
];

const LEGENDARY_TEMPLATES: readonly ContractTemplate[] = [
  {
    title:       'Seal the Rift Beneath Ironspire',
    description: 'Something tore open beneath Ironspire Mine three weeks ago. Three excavation teams went in. None returned. What comes out at night is getting worse. Seal it.',
  },
  {
    title:       'Recover the Jade Archive',
    description: 'The Jade Archive — a repository of pre-Collapse knowledge — was rediscovered in the deep Ashveil. Multiple factions are converging on it. Reach it first, secure it, and get it out.',
  },
  {
    title:       'Vanquish the Lichknight of Coldmere',
    description: 'The knight-commander who held Coldmere Pass never stopped defending it — even after death. He\'s raised the garrison, and they\'ve stopped letting anyone through. Put him down for good.',
  },
  {
    title:       'Negotiate the Ashfall Accord',
    description: 'Two major powers are weeks from open war over disputed saltfields. A neutral party is requesting skilled mediators — with the kind of backup that encourages good-faith negotiation.',
  },
  {
    title:       'The Sundering of Greyfen Spire',
    description: 'Something ancient woke in Greyfen Spire and has begun pulling ships off course from fifty leagues away. Scholars believe it can be destroyed. Nobody has gotten close enough to try.',
  },
];

const TEMPLATES: Record<ContractTier, readonly ContractTemplate[]> = {
  errand:    ERRAND_TEMPLATES,
  standard:  STANDARD_TEMPLATES,
  dangerous: DANGEROUS_TEMPLATES,
  legendary: LEGENDARY_TEMPLATES,
};

// ── Generator ─────────────────────────────────────────────────────────────────

export interface GeneratedContract {
  title:             string;
  description:       string;
  tier:              ContractTier;
  requiredPower:     number;
  requiredStats:     Partial<StatBlock>;
  requiredVocation?: Vocation;
  rewardGold:        number;
  reputationReward:  number;
  penaltyGold:       number;
  penaltyReputation: number;
  durationHours:     number;
  bidDeadline:       Date;
  expiresAt:         Date;
}

// Odds of rolling a stat/vocation requirement, and the stat threshold used, scaled by tier
// so higher-stakes contracts ask more of a party's composition. These are soft requirements
// (see estimateSuccessChance below) — never a hard gate on accepting/deploying, consistent
// with how requiredPower itself only ever affects odds, never blocks an attempt outright.
interface RequirementConfig {
  statChance:     number;
  statThreshold:  number;
  vocationChance: number;
}

const REQUIREMENT_CONFIG: Record<ContractTier, RequirementConfig> = {
  errand:    { statChance: 0,   statThreshold: 0,  vocationChance: 0 },
  standard:  { statChance: 0.4, statThreshold: 12, vocationChance: 0 },
  dangerous: { statChance: 1,   statThreshold: 14, vocationChance: 0.5 },
  legendary: { statChance: 1,   statThreshold: 16, vocationChance: 0.8 },
};

export function generateContract(tier: ContractTier, now = new Date()): GeneratedContract {
  const cfg = CONTRACT_TIER_CONFIG[tier];
  const template = pick(TEMPLATES[tier]);
  const reqCfg = REQUIREMENT_CONFIG[tier];

  const rewardGold = randInt(cfg.rewardRange[0], cfg.rewardRange[1]);
  const penaltyGold = Math.round(rewardGold * cfg.penaltyMultiplier);
  const requiredPower = randInt(cfg.powerRange[0], cfg.powerRange[1]);
  const durationHours = randInt(cfg.durationRange[0], cfg.durationRange[1]);

  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const bidDeadline = new Date(now.getTime() + 20 * 60 * 60 * 1000);

  const requiredVocation = Math.random() < reqCfg.vocationChance ? pick(VOCATIONS) : undefined;

  let requiredStats: Partial<StatBlock> = {};
  if (Math.random() < reqCfg.statChance) {
    // When a vocation is also required, bias the stat toward that vocation's top-2
    // priority stats so the pairing reads coherently ("needs an Arcanist with Attunement"),
    // rather than an unrelated stat on an unrelated vocation.
    const stat: Stat = requiredVocation
      ? pick(VOCATION_STAT_PRIORITY[requiredVocation].slice(0, 2) as Stat[])
      : pick(STATS);
    requiredStats = { [stat]: reqCfg.statThreshold };
  }

  return {
    title:             template.title,
    description:       template.description,
    tier,
    requiredPower,
    requiredStats,
    requiredVocation,
    rewardGold,
    reputationReward:  cfg.reputationReward,
    penaltyGold,
    penaltyReputation: cfg.penaltyReputation,
    durationHours,
    bidDeadline,
    expiresAt,
  };
}

// ── Requirements & success chance ──────────────────────────────────────────────
// Shared by both the API (resolveAdventure, the real roll) and the frontend (live
// success-chance previews in the deploy modals), so the estimate a player sees before
// deploying always matches what actually happens.

export const REQUIREMENT_PENALTY_PER_UNMET = 0.05;
export const MIN_SUCCESS_CHANCE = 0.3;
export const MAX_SUCCESS_CHANCE = 0.9;

// Counts how many of a contract's stat/vocation requirements no party member satisfies.
// A requirement is met if *any* single party member meets it alone — the party doesn't
// need one member covering every requirement simultaneously. `requiredVocation`/`vocation`
// are plain `string` rather than the narrower `Vocation` type — this only ever does a `===`
// comparison, and keeping it loose avoids forcing a cast at every call site bridging from
// API response shapes (which type these fields as plain strings).
export function countUnmetRequirements(
  contract: { requiredStats: Partial<StatBlock>; requiredVocation?: string | null },
  party: Array<{ vocation: string; stats: Partial<StatBlock> }>,
): number {
  let unmet = 0;

  if (contract.requiredVocation) {
    const hasVocation = party.some((a) => a.vocation === contract.requiredVocation);
    if (!hasVocation) unmet++;
  }

  for (const [stat, threshold] of Object.entries(contract.requiredStats)) {
    if (threshold === undefined) continue;
    const meetsStat = party.some((a) => (a.stats[stat as Stat] ?? 0) >= threshold);
    if (!meetsStat) unmet++;
  }

  return unmet;
}

// Returns a 0–1 success chance. `unmetRequirements` defaults to 0 so existing callers that
// haven't been updated yet still get sensible behavior.
export function estimateSuccessChance(
  partyPower: number,
  requiredPower: number,
  unmetRequirements = 0,
): number {
  const ratio = requiredPower > 0 ? partyPower / requiredPower : 1;
  const raw = MIN_SUCCESS_CHANCE + ratio * 0.5 - unmetRequirements * REQUIREMENT_PENALTY_PER_UNMET;
  return Math.max(MIN_SUCCESS_CHANCE, Math.min(MAX_SUCCESS_CHANCE, raw));
}

// Default distribution: 5 errand, 8 standard, 5 dangerous, 2 legendary
const DAILY_CONTRACT_COUNTS: Record<ContractTier, number> = {
  errand:    5,
  standard:  8,
  dangerous: 5,
  legendary: 2,
};

export function generateDailyContracts(now = new Date()): GeneratedContract[] {
  const contracts: GeneratedContract[] = [];
  for (const [tier, count] of Object.entries(DAILY_CONTRACT_COUNTS) as [ContractTier, number][]) {
    for (let i = 0; i < count; i++) {
      contracts.push(generateContract(tier, now));
    }
  }
  return contracts;
}
