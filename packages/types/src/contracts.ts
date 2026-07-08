import type { ContractTier, Stat, StatBlock, Vocation } from './game.js';
import { STATS, VOCATIONS, VOCATION_STAT_PRIORITY, BIDDING_CONTRACT_TIERS } from './game.js';

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

// ── Market lifecycle ─────────────────────────────────────────────────────────
// Direct-accept tiers (errand/standard) and bidding tiers (dangerous/legendary) age off the
// market very differently — see workers/marketGC.ts and routes/contracts.ts for how these
// are actually applied.
//
// Direct-accept: a fixed clock from creation. Simple, since there's no auction to wait out.
export const DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS = 48;
//
// Bidding: no clock at all until the *first* bid lands — a contract nobody has bid on yet
// shouldn't vanish from the market just because time passed, otherwise the market goes
// through daily windows with zero dangerous/legendary contracts available at all. Once a
// first bid lands, everyone gets a fair, full window to counter-bid before it resolves to
// the highest-reputation bidder.
export const BID_WINDOW_HOURS = 4;
// Backstop for a contract that never receives a single bid — without this, an unpopular
// contract would occupy its market slot forever, since nothing else ever prompts its
// removal. Deliberately generous (days, not hours) since replenishment is reactive (see
// BIDDING_MARKET_TARGET below), so a longer backstop doesn't reintroduce an empty-market gap.
export const BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS = 96;

// ── Tier Configuration ────────────────────────────────────────────────────────

interface TierConfig {
  powerRange:        [number, number];
  rewardRange:       [number, number];
  durationRange:     [number, number]; // hours
  penaltyMultiplier: number;
  reputationReward:  number;
  penaltyReputation: number;
}

// powerRange for standard/dangerous/legendary is calibrated against the matching adventurer
// title tier (see VOCATION_TIERS in game.ts: tier 1 = levels 1-4, tier 2 = levels 5-8,
// tier 3 = levels 9-10) and a full 6-person party, using estimateSuccessChance's actual
// formula (0.3 + ratio*0.5, capped [0.3, 0.9] — so ratio 1.2 already hits the 90% cap).
// Average adventurer power is ~12.5 * level (stats are 3d6+2, averaging 12.5, independent
// of vocation), so a full party's power is ~75 * level. Each tier's `max` is set so the
// tier's *lowest* level, as a full party, gets roughly a 50% shot (ratio 0.4) against the
// hardest contract the tier can roll; `min` is set so the tier's *highest* level hits the
// 90% cap (ratio >= 1.2) against the easiest roll. Recalibrated 2026-07-08 after the
// previous ranges (still visible in git history) were found trivial for a full party of
// low-level adventurers — a party of six level 1-3s could clear legendary contracts (the
// old 140-280 range) at ~90%, since six adventurers' combined power outpaced what the range
// assumed. Errand deliberately untouched — stays easy, a way for new players to quickly
// earn gold regardless of roster strength.
export const CONTRACT_TIER_CONFIG: Record<ContractTier, TierConfig> = {
  errand: {
    powerRange:        [5,   25],
    rewardRange:       [50,  200],
    durationRange:     [1,   6],
    penaltyMultiplier: 0.2,
    reputationReward:  1,
    penaltyReputation: 0,
  },
  // Tier 1 (levels 1-4): full party 75-300 power. Tier 1's power growth (4x from level 1 to
  // 4) outpaces what a single range needs for the difficulty curve — a level-4 party clears
  // the low end of this range well past the 90% cap regardless, which is expected: you're
  // meant to be outgrowing Standard by the time you're near the top of Tier 1.
  standard: {
    powerRange:        [100, 190],
    rewardRange:       [200, 700],
    durationRange:     [4,   16],
    penaltyMultiplier: 0.3,
    reputationReward:  3,
    penaltyReputation: 1,
  },
  // Tier 2 (levels 5-8): full party ~375 (L5) to ~600 (L8) power.
  dangerous: {
    powerRange:        [500, 940],
    rewardRange:       [700, 2500],
    durationRange:     [12,  36],
    penaltyMultiplier: 0.5,
    reputationReward:  8,
    penaltyReputation: 3,
  },
  // Tier 3 (levels 9-10): full party ~675 (L9) to ~750 (L10) power — only an 11% spread
  // between the tier's own low and high end, so this tier leans hardest on its
  // requiredPower *range* itself (rather than the level gap) to create difficulty variance.
  legendary: {
    powerRange:        [625, 1700],
    rewardRange:       [2500, 7000],
    durationRange:     [24,  72],
    penaltyMultiplier: 0.7,
    reputationReward:  20,
    penaltyReputation: 8,
  },
};

// ── Contract Templates (procedural) ─────────────────────────────────────────────
// Titles/descriptions are composed from small word banks (a shared world of named
// locations, plus tier-scoped "flavor" entries and clients) combined through a handful of
// sentence patterns per tier, rather than picked from one fixed pool. This multiplies a
// previous ~30-entry fixed pool into many hundreds of combinations per tier, and a rolling
// recent-title dedup (mirroring generator.ts's adventurer-name history) keeps the same exact
// combination from resurfacing back-to-back. Every flavor entry carries both a Title Case
// `label` (for titles) and a lowercase `hook` fragment (for prose) so interpolation never
// has to guess at capitalization or grammar.

const CONTRACT_LOCATIONS = [
  'Ironhaven', 'Duskfort', 'Ashveil', 'Thornwood', 'Greyspire', 'Ashfield Keep',
  'Coldmere', 'Greyfen', 'Ironspire', 'Thornwall', 'Ironmoor', 'Blackmere',
  'Ravenscar', 'Hollowfen', 'Wyrmwatch', 'Stonereach', 'Duskhollow', 'Grimwater',
] as const;

interface FlavorEntry {
  label: string; // Title Case noun phrase — drops cleanly into a contract title
  hook:  string; // lowercase noun phrase — drops cleanly into prose ("X is dealing with {hook}")
}

interface FlavorPattern {
  title:       (flavor: FlavorEntry, location: string, client: string) => string;
  description: (flavor: FlavorEntry, location: string, client: string) => string;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ── Errand ──
const ERRAND_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Vermin Infestation',    hook: 'a vermin infestation working through the storerooms' },
  { label: 'Petty Theft',           hook: 'a string of petty thefts nobody has caught yet' },
  { label: 'Silent Debtor',         hook: 'a debtor who has gone conveniently quiet' },
  { label: 'Squatters',             hook: 'squatters holed up in an empty granary' },
  { label: 'Stray Dog Pack',        hook: 'a stray dog pack menacing the market stalls' },
  { label: 'Foul Well',             hook: 'a well that has gone foul overnight' },
  { label: 'Harvest Troublemakers', hook: 'a knot of drunks causing trouble at the harvest fair' },
  { label: 'Missing Pouch',         hook: 'a courier pouch that never arrived' },
  { label: 'Overdue Shipment',      hook: 'a wagon shipment that never showed' },
  { label: 'Crooked Game',          hook: 'a rigged game of chance fleecing the regulars' },
];
const ERRAND_CLIENTS = [
  'a warehouse owner', 'a tavern keeper', 'a worried parent', 'the courier office',
  'a local creditor', 'a market cooperative', 'a wagon driver', 'the neighborhood watch',
] as const;
const ERRAND_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label} Near ${l}`,
    description: (f, l, c) => `${capitalize(c)} near ${l} is dealing with ${f.hook}. Nothing that calls for heroics — just a steady hand and a bit of follow-through.`,
  },
  {
    title:       (f) => f.label,
    description: (f, _l, c) => `${capitalize(c)} has ${f.hook} and needs it handled before it becomes a bigger problem.`,
  },
  {
    title:       (f) => `Errand: ${f.label}`,
    description: (f, l, c) => `Word from ${l} is that ${c} is contending with ${f.hook}. Simple work, decent pay.`,
  },
];

// ── Standard ──
const STANDARD_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Warg Pack',        hook: 'a warg pack that has decimated three flocks this month' },
  { label: 'Bandit Ambush',    hook: 'bandits ambushing traders on the road' },
  { label: 'Smuggling Ring',   hook: 'a smuggling ring moving contraband through the district' },
  { label: 'Deserter Camp',    hook: 'armed deserters squatting in a fortified ruin' },
  { label: 'Missing Caravan',  hook: 'a trade caravan that vanished without a trace' },
  { label: 'Missing Healer',   hook: 'the only healer for three villages, gone missing' },
  { label: 'Ledger Raid',      hook: 'a bandit raid that made off with irreplaceable ledgers' },
  { label: 'Land Dispute',     hook: 'a land dispute between two farmsteading families turning violent' },
  { label: 'Cave Threat',      hook: 'something driving miners out of a profitable vein' },
  { label: 'Escort Risk',      hook: 'a lorekeeper who needs safe passage through contested roads' },
];
const STANDARD_CLIENTS = [
  'a shepherd', 'a trading post', 'the town council', 'a caravan master',
  'a lorekeeper', 'a mining guild', 'two feuding families', 'a village elder',
] as const;
const STANDARD_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label}: ${l}`,
    description: (f, l, c) => `${l} has a problem with ${f.hook}. ${capitalize(c)} is offering solid pay for a party that can put it to rest.`,
  },
  {
    title:       (f, l) => `${f.label} Near ${l}`,
    description: (f, l, c) => `${capitalize(c)} near ${l} is dealing with ${f.hook} — no small task, but not beyond a capable party either.`,
  },
  {
    title:       (f) => `Standard Contract: ${f.label}`,
    description: (f, l, c) => `Reports from ${l} describe ${f.hook}. ${capitalize(c)} wants it resolved before it gets worse.`,
  },
];

// ── Dangerous ──
const DANGEROUS_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Wyvern',                hook: 'a territorial wyvern that has downed two merchant vessels' },
  { label: 'Cultist Enclave',       hook: 'a cult conducting escalating rituals in the salt flats' },
  { label: 'Vault Guardian',        hook: 'something inhuman guarding a half-submerged vault' },
  { label: 'Blight',                hook: 'a spreading corruption killing everything it touches' },
  { label: 'Siege Company',         hook: 'a mercenary company laying siege for tribute' },
  { label: 'Rival Agents',          hook: 'agents of a rival lord operating in the shadows' },
  { label: 'Guarded Ruin',          hook: 'whatever has kept every prior expedition out of a fallen keep\'s ruins' },
  { label: 'Contested Passage',     hook: 'contested territory no diplomatic party has crossed safely' },
];
const DANGEROUS_CLIENTS = [
  'a coalition of traders', 'the Crown', 'a besieged garrison',
  'a scholars\' guild', 'a border lord', 'the merchant council',
] as const;
const DANGEROUS_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label} of ${l}`,
    description: (f, l, c) => `${capitalize(c)} is offering a substantial bounty: ${f.hook}, centered on ${l}. Every previous attempt has failed.`,
  },
  {
    title:       (_f, l) => `Breach ${l}`,
    description: (f, l, c) => `${l} holds ${f.hook}. ${capitalize(c)} needs it dealt with — permanently.`,
  },
  {
    title:       (f) => `Dangerous Contract: ${f.label}`,
    description: (f, l, c) => `${capitalize(c)} has confirmed ${f.hook} near ${l}. This is not a job for the unprepared.`,
  },
];

// ── Legendary ── (fewer patterns deliberately, so these still feel rare and singular)
const LEGENDARY_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Ancient Rift',      hook: 'a rift that tore open weeks ago and has not stopped growing' },
  { label: 'Risen Lichknight',  hook: 'a knight-commander who never stopped defending his post, even in death' },
  { label: 'Awakened Horror',   hook: 'something ancient that has woken and is pulling ships off course from leagues away' },
  { label: 'Archive Race',      hook: 'a repository of pre-Collapse knowledge that every faction wants first' },
  { label: 'Brink of War',      hook: 'two great powers weeks from open war over disputed land' },
  { label: 'World-Ending Threat', hook: 'a threat the scholars believe can be destroyed, if anyone can get close enough' },
];
const LEGENDARY_CLIENTS = [
  'a neutral coalition', 'the last scholars who understand it',
  'a desperate garrison', 'three converging factions', 'those who remember what it did the first time',
] as const;
const LEGENDARY_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label}: ${l}`,
    description: (f, l, c) => `${capitalize(c)} say ${f.hook}. It is centered on ${l}. Nobody has come back from a serious attempt yet.`,
  },
  {
    title:       (f) => `Legendary Contract: ${f.label}`,
    description: (f, l, c) => `${l} is ground zero. ${capitalize(c)} say ${f.hook}. Whoever takes this will be remembered — one way or another.`,
  },
];

interface TierFlavorPool {
  flavors:  readonly FlavorEntry[];
  clients:  readonly string[];
  patterns: readonly FlavorPattern[];
}

const TIER_FLAVOR: Record<ContractTier, TierFlavorPool> = {
  errand:    { flavors: ERRAND_FLAVORS,    clients: ERRAND_CLIENTS,    patterns: ERRAND_PATTERNS },
  standard:  { flavors: STANDARD_FLAVORS,  clients: STANDARD_CLIENTS,  patterns: STANDARD_PATTERNS },
  dangerous: { flavors: DANGEROUS_FLAVORS, clients: DANGEROUS_CLIENTS, patterns: DANGEROUS_PATTERNS },
  legendary: { flavors: LEGENDARY_FLAVORS, clients: LEGENDARY_CLIENTS, patterns: LEGENDARY_PATTERNS },
};

interface ContractFlavor {
  title:       string;
  description: string;
}

function renderContractFlavor(tier: ContractTier): ContractFlavor {
  const location = pick(CONTRACT_LOCATIONS);
  const { flavors, clients, patterns } = TIER_FLAVOR[tier];
  const flavor = pick(flavors);
  const client = pick(clients);
  const pattern = pick(patterns);
  return {
    title:       pattern.title(flavor, location, client),
    description: pattern.description(flavor, location, client),
  };
}

// Recent-title dedup — same rolling-history approach as generator.ts's adventurer names. Not
// a hard uniqueness guarantee (retries a fixed number of times, then accepts whatever it
// gets), but the word-bank combinatorics are large enough that this comfortably prevents the
// same title from resurfacing back-to-back.
const TITLE_HISTORY_SIZE = 20;
const MAX_TITLE_RETRIES = 5;
const titleHistory = new Set<string>();
const titleHistoryOrder: string[] = [];

function recordTitle(title: string): void {
  if (titleHistory.has(title)) return;
  titleHistory.add(title);
  titleHistoryOrder.push(title);
  if (titleHistoryOrder.length > TITLE_HISTORY_SIZE) {
    titleHistory.delete(titleHistoryOrder.shift()!);
  }
}

function generateContractFlavor(tier: ContractTier): ContractFlavor {
  for (let i = 0; i < MAX_TITLE_RETRIES; i++) {
    const flavor = renderContractFlavor(tier);
    if (!titleHistory.has(flavor.title)) {
      recordTitle(flavor.title);
      return flavor;
    }
  }
  const flavor = renderContractFlavor(tier);
  recordTitle(flavor.title);
  return flavor;
}

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
  // Null for every freshly-generated contract, including bidding tiers — only set once a
  // first bid actually lands (routes/contracts.ts), never at generation time.
  bidDeadline:       Date | null;
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
  const template = generateContractFlavor(tier);
  const reqCfg = REQUIREMENT_CONFIG[tier];

  const rewardGold = randInt(cfg.rewardRange[0], cfg.rewardRange[1]);
  const penaltyGold = Math.round(rewardGold * cfg.penaltyMultiplier);
  const requiredPower = randInt(cfg.powerRange[0], cfg.powerRange[1]);
  const durationHours = randInt(cfg.durationRange[0], cfg.durationRange[1]);

  const isBiddingTier = BIDDING_CONTRACT_TIERS.includes(tier);
  const expiresAt = new Date(now.getTime() + (
    isBiddingTier ? BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS : DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS
  ) * 60 * 60 * 1000);
  const bidDeadline = null;

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

// Direct-accept tiers only: a fixed once-daily batch, added on top of whatever's already on
// the market (contracts age off individually via DIRECT_ACCEPT_CONTRACT_EXPIRY_HOURS, so this
// never needs to be target-aware the way the bidding tiers do — see BIDDING_MARKET_TARGET).
const DAILY_CONTRACT_COUNTS: Record<'errand' | 'standard', number> = {
  errand:   5,
  standard: 8,
};

// Bidding tiers only: a standing target maintained continuously by workers/marketGC.ts
// (checked every 15 minutes, topped up whenever a contract resolves or backstop-expires)
// rather than a once-daily add — since these contracts don't age off on a fixed clock, a flat
// daily add would let the market grow unbounded over multiple days instead of holding steady.
export const BIDDING_MARKET_TARGET: Record<'dangerous' | 'legendary', number> = {
  dangerous: 5,
  legendary: 2,
};

export function generateDailyContracts(now = new Date()): GeneratedContract[] {
  const contracts: GeneratedContract[] = [];
  for (const [tier, count] of Object.entries(DAILY_CONTRACT_COUNTS) as ['errand' | 'standard', number][]) {
    for (let i = 0; i < count; i++) {
      contracts.push(generateContract(tier, now));
    }
  }
  return contracts;
}
