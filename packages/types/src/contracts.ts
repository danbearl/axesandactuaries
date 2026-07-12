import type { ContractTier, Stat, StatBlock, Vocation, ContractEncounter, PartyPowerByRole, PartyRole } from './game.js';
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
// CONTRACT_MARKET_BASE_RATE below), so a longer backstop doesn't reintroduce an empty-market gap.
export const BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS = 96;

// A player can hold at most this many direct-accept (errand/standard) contracts
// simultaneously in 'awarded'-but-undeployed limbo. These two tiers have no reputation gate
// by design (see CONTRACT_TIER_REPUTATION_REQUIREMENTS), so without a cap a player could
// accept the entire market for free and just let each one lapse at its deploy-by penalty —
// denying every other player a contract to work in the meantime at essentially zero cost to
// themselves. Dangerous/legendary aren't capped: winning one already requires clearing a
// reputation gate and a competitive bid, a much higher-effort path.
export const MAX_CONCURRENT_DIRECT_ACCEPT_CONTRACTS = 3;

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

export const CONTRACT_LOCATIONS = [
  'Ironhaven', 'Duskfort', 'Ashveil', 'Thornwood', 'Greyspire', 'Ashfield Keep',
  'Coldmere', 'Greyfen', 'Ironspire', 'Thornwall', 'Ironmoor', 'Blackmere',
  'Ravenscar', 'Hollowfen', 'Wyrmwatch', 'Stonereach', 'Duskhollow', 'Grimwater',
] as const;

// What kind of noun the hook's head word actually is — patterns that refer back to the hook
// (a pronoun, or a "what needs to happen to it" verb) need to know this, or they produce
// grammatically broken or backwards-sounding prose: "it" doesn't fit a person or a plural
// ("needs it handled" applied to "a debtor"), and "put to rest" reads as an elimination order
// when pointed at someone the party is meant to protect or rescue, not confront.
// - 'thing'    — an impersonal situation, creature, or organization ("a vermin infestation",
//                "a smuggling ring") — "it" and "put to rest"/"handled" both fit naturally.
// - 'hostile'  — a person or people to be confronted, singular or plural ("a debtor",
//                "bandits") — needs "them", and a confrontation-flavored verb.
// - 'friendly' — someone the party is meant to help, not fight ("a lorekeeper who needs safe
//                passage") — needs "them", and a protective, not adversarial, verb.
export type FlavorSubject = 'thing' | 'hostile' | 'friendly';

interface FlavorEntry {
  label:   string; // Title Case noun phrase — drops cleanly into a contract title
  hook:    string; // lowercase noun phrase — drops cleanly into prose ("X is dealing with {hook}")
  subject: FlavorSubject;
}

interface FlavorPattern {
  title:       (flavor: FlavorEntry, location: string, client: string) => string;
  description: (flavor: FlavorEntry, location: string, client: string) => string;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// "needs/wants ___ before it gets worse/becomes a bigger problem" framing.
export function resolutionObject(subject: FlavorSubject): string {
  switch (subject) {
    case 'thing':    return 'it handled';
    case 'hostile':  return 'them dealt with';
    case 'friendly': return 'them looked after';
  }
}

// "a party that can ___" framing.
export function confrontPhrase(subject: FlavorSubject): string {
  switch (subject) {
    case 'thing':    return 'put it to rest';
    case 'hostile':  return 'bring them to heel';
    case 'friendly': return 'see them to safety';
  }
}

// ── Errand ──
const ERRAND_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Vermin Infestation',    hook: 'a vermin infestation working through the storerooms', subject: 'thing' },
  { label: 'Petty Theft',           hook: 'a string of petty thefts nobody has caught yet', subject: 'thing' },
  { label: 'Silent Debtor',         hook: 'a debtor who has gone conveniently quiet', subject: 'hostile' },
  { label: 'Squatters',             hook: 'squatters holed up in an empty granary', subject: 'hostile' },
  { label: 'Stray Dog Pack',        hook: 'a stray dog pack menacing the market stalls', subject: 'thing' },
  { label: 'Foul Well',             hook: 'a well that has gone foul overnight', subject: 'thing' },
  { label: 'Harvest Troublemakers', hook: 'a knot of drunks causing trouble at the harvest fair', subject: 'hostile' },
  { label: 'Missing Pouch',         hook: 'a courier pouch that never arrived', subject: 'thing' },
  { label: 'Overdue Shipment',      hook: 'a wagon shipment that never showed', subject: 'thing' },
  { label: 'Crooked Game',          hook: 'a rigged game of chance fleecing the regulars', subject: 'thing' },
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
    description: (f, _l, c) => `${capitalize(c)} has ${f.hook} and needs ${resolutionObject(f.subject)} before it becomes a bigger problem.`,
  },
  {
    title:       (f) => `Errand: ${f.label}`,
    description: (f, l, c) => `Word from ${l} is that ${c} is contending with ${f.hook}. Simple work, decent pay.`,
  },
];

// ── Standard ──
const STANDARD_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Warg Pack',        hook: 'a warg pack that has decimated three flocks this month', subject: 'thing' },
  { label: 'Bandit Ambush',    hook: 'bandits ambushing traders on the road', subject: 'hostile' },
  { label: 'Smuggling Ring',   hook: 'a smuggling ring moving contraband through the district', subject: 'thing' },
  { label: 'Deserter Camp',    hook: 'armed deserters squatting in a fortified ruin', subject: 'hostile' },
  { label: 'Missing Caravan',  hook: 'a trade caravan that vanished without a trace', subject: 'thing' },
  { label: 'Missing Healer',   hook: 'the only healer for three villages, gone missing', subject: 'friendly' },
  { label: 'Ledger Raid',      hook: 'a bandit raid that made off with irreplaceable ledgers', subject: 'thing' },
  { label: 'Land Dispute',     hook: 'a land dispute between two farmsteading families turning violent', subject: 'thing' },
  { label: 'Cave Threat',      hook: 'something driving miners out of a profitable vein', subject: 'thing' },
  { label: 'Escort Risk',      hook: 'a lorekeeper who needs safe passage through contested roads', subject: 'friendly' },
];
const STANDARD_CLIENTS = [
  'a shepherd', 'a trading post', 'the town council', 'a caravan master',
  'a lorekeeper', 'a mining guild', 'a pair of feuding families', 'a village elder',
] as const;
const STANDARD_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label}: ${l}`,
    description: (f, l, c) => `${l} has a problem with ${f.hook}. ${capitalize(c)} is offering solid pay for a party that can ${confrontPhrase(f.subject)}.`,
  },
  {
    title:       (f, l) => `${f.label} Near ${l}`,
    description: (f, l, c) => `${capitalize(c)} near ${l} is dealing with ${f.hook} — no small task, but not beyond a capable party either.`,
  },
  {
    title:       (f) => `Standard Contract: ${f.label}`,
    description: (f, l, c) => `Reports from ${l} describe ${f.hook}. ${capitalize(c)} wants ${resolutionObject(f.subject)} before it gets worse.`,
  },
];

// ── Dangerous ──
const DANGEROUS_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Wyvern',                hook: 'a territorial wyvern that has downed two merchant vessels', subject: 'thing' },
  { label: 'Cultist Enclave',       hook: 'a cult conducting escalating rituals in the salt flats', subject: 'thing' },
  { label: 'Vault Guardian',        hook: 'something inhuman guarding a half-submerged vault', subject: 'thing' },
  { label: 'Blight',                hook: 'a spreading corruption killing everything it touches', subject: 'thing' },
  { label: 'Siege Company',         hook: 'a mercenary company laying siege for tribute', subject: 'thing' },
  { label: 'Rival Agents',          hook: 'agents of a rival lord operating in the shadows', subject: 'hostile' },
  { label: 'Guarded Ruin',          hook: 'whatever has kept every prior expedition out of a fallen keep\'s ruins', subject: 'thing' },
  { label: 'Contested Passage',     hook: 'contested territory no diplomatic party has crossed safely', subject: 'thing' },
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
    description: (f, l, c) => `${l} holds ${f.hook}. ${capitalize(c)} needs ${resolutionObject(f.subject)} — permanently.`,
  },
  {
    title:       (f) => `Dangerous Contract: ${f.label}`,
    description: (f, l, c) => `${capitalize(c)} has confirmed ${f.hook} near ${l}. This is not a job for the unprepared.`,
  },
];

// ── Legendary ── (fewer patterns deliberately, so these still feel rare and singular — but
// both patterns now always include the location, unlike before: the second pattern's title
// used to be flavor-only, meaning its title didn't vary with location or client at all — the
// dominant source of legendary's title repetition, since every other tier's patterns all
// include location. Flavor/client pools were also both widened, roughly doubling this tier's
// combinatorics: it was the thinnest of the four, and generates least often (target of 2), so
// it's the tier most exposed to running out of fresh combinations.)
const LEGENDARY_FLAVORS: readonly FlavorEntry[] = [
  { label: 'Ancient Rift',      hook: 'a rift that tore open weeks ago and has not stopped growing', subject: 'thing' },
  { label: 'Risen Lichknight',  hook: 'a knight-commander who never stopped defending his post, even in death', subject: 'hostile' },
  { label: 'Awakened Horror',   hook: 'something ancient that has woken and is pulling ships off course from leagues away', subject: 'thing' },
  { label: 'Archive Race',      hook: 'a repository of pre-Collapse knowledge that every faction wants first', subject: 'thing' },
  { label: 'Brink of War',      hook: 'two great powers weeks from open war over disputed land', subject: 'thing' },
  { label: 'World-Ending Threat', hook: 'a threat the scholars believe can be destroyed, if anyone can get close enough', subject: 'thing' },
  { label: 'Drowned City',      hook: 'a city that sank whole a century ago and has just resurfaced', subject: 'thing' },
  { label: 'False God',         hook: 'someone gathering worshippers and calling itself divine', subject: 'hostile' },
  { label: 'Sundered Bloodline', hook: 'the last heir to a throne that three kingdoms are hunting', subject: 'friendly' },
  { label: 'Star Fall',         hook: 'something that fell from the sky and is still burning three days later', subject: 'thing' },
];
const LEGENDARY_CLIENTS = [
  'a neutral coalition', 'the last scholars who understand it',
  'a desperate garrison', 'three converging factions', 'those who remember what it did the first time',
  'the crownless heirs', 'a pact of desperate mages',
] as const;
const LEGENDARY_PATTERNS: readonly FlavorPattern[] = [
  {
    title:       (f, l) => `${f.label}: ${l}`,
    description: (f, l, c) => `${capitalize(c)} say ${f.hook}. Centered on ${l}. Nobody has come back from a serious attempt yet.`,
  },
  {
    title:       (f, l) => `Legendary Contract: ${f.label} — ${l}`,
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
//
// Kept **per tier**, not as one shared history — errand/standard generate far more often than
// dangerous/legendary (standing targets of 5-8 vs. 2-5), so a single shared window used to let
// their titles flood it and evict dangerous/legendary's own recent entries almost immediately,
// leaving the low-volume tiers with the least effective protection despite needing it most.
const TITLE_HISTORY_SIZE = 20;
const MAX_TITLE_RETRIES = 5;
const titleHistory: Record<ContractTier, { seen: Set<string>; order: string[] }> = {
  errand:    { seen: new Set(), order: [] },
  standard:  { seen: new Set(), order: [] },
  dangerous: { seen: new Set(), order: [] },
  legendary: { seen: new Set(), order: [] },
};

function recordTitle(tier: ContractTier, title: string): void {
  const history = titleHistory[tier];
  if (history.seen.has(title)) return;
  history.seen.add(title);
  history.order.push(title);
  if (history.order.length > TITLE_HISTORY_SIZE) {
    history.seen.delete(history.order.shift()!);
  }
}

function generateContractFlavor(tier: ContractTier): ContractFlavor {
  for (let i = 0; i < MAX_TITLE_RETRIES; i++) {
    const flavor = renderContractFlavor(tier);
    if (!titleHistory[tier].seen.has(flavor.title)) {
      recordTitle(tier, flavor.title);
      return flavor;
    }
  }
  const flavor = renderContractFlavor(tier);
  recordTitle(tier, flavor.title);
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
  encounters:        ContractEncounter[];
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

// ── Encounter chains ──────────────────────────────────────────────────────────
// A contract resolves as a short chain of internal encounters rather than one flat check —
// see estimateChainedSuccessChance below for how the chain feeds into a success chance, and
// ROADMAP.md's "Party vocation/role synergies" entry for the full design rationale (including
// why generation moved from per-encounter random noise to a fixed per-contract favored/
// unfavored role pattern, see pickRoleBiasPattern below). More encounters at higher tiers:
// bigger jobs feel more epic, and the chain length gives future narrative-beat work more room
// at the tiers where it matters most.
const ENCOUNTER_COUNT: Record<ContractTier, number> = {
  errand:    1,
  standard:  2,
  dangerous: 3,
  legendary: 4,
};

export const MIN_ROLE_MODIFIER = 0.5;
export const MAX_ROLE_MODIFIER = 1.5;

const PARTY_ROLES = ['fighter', 'wizard', 'rogue', 'priest'] as const;

// A role's modifier is guaranteed a real, visible swing once it's favored/unfavored at all —
// no "technically favored but 1.01x, indistinguishable from noise" case. Matches
// ContractCard.tsx's encounterModifierClass thresholds exactly, so a role that's mechanically
// favored/unfavored is always the one visually highlighted too.
const FAVORED_MODIFIER_RANGE:   [number, number] = [1.15, MAX_ROLE_MODIFIER];
const UNFAVORED_MODIFIER_RANGE: [number, number] = [MIN_ROLE_MODIFIER, 0.85];

const randomInRange = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

// Fisher-Yates — `.sort(() => Math.random() - 0.5)` is a well-known biased shuffle, worth
// avoiding even at n=4 since favored/unfavored role selection should be genuinely uniform.
function shuffled<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Each contract randomly gets its own favored/unfavored role pattern — how many of each (0-4,
// uniform) and which specific roles, independently per contract. This is a deliberate design
// choice over the previous per-encounter-noise approach: that version's gap between a
// well-matched and poorly-matched party was pure generation-time luck (sometimes ~0.1 points,
// sometimes several, depending on which role happened to draw a low-variance sequence for that
// specific contract) — see ROADMAP.md for the worked examples that motivated the switch. A
// fixed, per-contract bias makes the gap a real, guaranteed, legible property of the contract
// itself: 0 favored/0 unfavored contracts are fully composition-neutral (any roster, including
// an all-one-vocation party, does equally well — a "balanced-friendly" contract in the sense
// that nothing is punished, not that spreading out is specifically rewarded); a contract with
// few favored roles and several unfavored ones rewards specializing hard into what's favored.
function pickRoleBiasPattern(): { favored: PartyRole[]; unfavored: PartyRole[] } {
  const roles = shuffled(PARTY_ROLES);
  const favoredCount = randInt(0, PARTY_ROLES.length);
  const unfavoredCount = randInt(0, PARTY_ROLES.length - favoredCount);
  return {
    favored:   roles.slice(0, favoredCount),
    unfavored: roles.slice(favoredCount, favoredCount + unfavoredCount),
  };
}

// The same favored/unfavored/neutral modifier applies to every encounter in the chain — a
// contract's role preferences are a fixed property of that contract, not something that swings
// encounter-to-encounter. The per-encounter array is retained (tier-scaled count, see
// ENCOUNTER_COUNT above) for the existing UI display and for future narrative beats, not
// because the modifier values themselves vary within one contract's chain — see
// estimateChainedSuccessChance's comment for what that means for the aggregation math.
function generateEncounters(tier: ContractTier): ContractEncounter[] {
  const n = ENCOUNTER_COUNT[tier];
  const modifierByRole: ContractEncounter = { fighter: 1, wizard: 1, rogue: 1, priest: 1 };

  // Errand deliberately stays fully neutral — no favored/unfavored roles ever — matching
  // CONTRACT_TIER_CONFIG's existing "stays easy, a way for new players to quickly earn gold
  // regardless of roster strength" philosophy for this tier. A brand-new player's very first
  // adventurer shouldn't need to think about composition strategy yet.
  if (tier !== 'errand') {
    const { favored, unfavored } = pickRoleBiasPattern();
    for (const role of favored) modifierByRole[role] = randomInRange(FAVORED_MODIFIER_RANGE);
    for (const role of unfavored) modifierByRole[role] = randomInRange(UNFAVORED_MODIFIER_RANGE);
  }

  return Array.from({ length: n }, () => ({ ...modifierByRole }));
}

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
    encounters:        generateEncounters(tier),
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

// Whether a single adventurer, on their own, satisfies at least one of a contract's stat/
// vocation requirements — for surfacing which specific adventurers are worth assigning in
// the party-assembly UI, rather than leaving the player to guess from the aggregate "missing
// N requirements" count countUnmetRequirements produces for the whole party.
export function adventurerMeetsAnyRequirement(
  contract: { requiredStats: Partial<StatBlock>; requiredVocation?: string | null },
  adventurer: { vocation: string; stats: Partial<StatBlock> },
): boolean {
  if (contract.requiredVocation && adventurer.vocation === contract.requiredVocation) return true;

  for (const [stat, threshold] of Object.entries(contract.requiredStats)) {
    if (threshold === undefined) continue;
    if ((adventurer.stats[stat as Stat] ?? 0) >= threshold) return true;
  }

  return false;
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

// Encounter-chain-aware version of estimateSuccessChance above — same MIN/MAX clamp and
// unmetRequirements penalty, but the ratio fed into them is the **geometric mean** of each
// encounter's own power ratio (party power split by role, weighted by that encounter's
// modifiers) rather than one flat ratio.
//
// generateEncounters assigns each contract a fixed favored/unfavored/neutral bias per role,
// applied identically to every encounter in the chain — so for any contract generated today,
// there's no cross-encounter variance within a single role's own sequence, and this geometric
// mean is mathematically a pass-through (geomean of N identical values is that value). The
// aggregation is kept anyway rather than collapsed into a single check: it's what correctly
// resolves the legacy empty-encounters fallback below, and it stays forward-compatible if
// per-encounter variation is ever reintroduced on top of the per-contract bias (e.g. for
// narrative beats). Concretely, a party's result now comes directly from how much of its power
// sits in this specific contract's favored vs. unfavored roles: unlike an earlier per-encounter
// -noise version of this mechanism, a well-matched party can genuinely *exceed* what raw power
// alone would suggest (a favored role is a real bonus, not just "avoiding a penalty"), capped
// by MAX_SUCCESS_CHANCE same as everything else — and a contract with zero favored/unfavored
// roles (see pickRoleBiasPattern) is fully composition-neutral, behaving exactly like the flat
// formula regardless of party makeup.
//
// Falls back to the flat formula when `encounters` is empty (contracts generated before this
// field existed, migrated with a `[]` default).
export function estimateChainedSuccessChance(
  powerByRole: PartyPowerByRole,
  requiredPower: number,
  encounters: ContractEncounter[],
  unmetRequirements = 0,
): number {
  if (encounters.length === 0) {
    const totalPower = PARTY_ROLES.reduce((sum, role) => sum + powerByRole[role], 0);
    return estimateSuccessChance(totalPower, requiredPower, unmetRequirements);
  }

  const ratios = encounters.map((encounter) => {
    const effectivePower = PARTY_ROLES.reduce(
      (sum, role) => sum + powerByRole[role] * encounter[role],
      0,
    );
    return requiredPower > 0 ? effectivePower / requiredPower : 1;
  });

  // Geometric mean via log-space average — avoids overflow on long chains of large ratios
  // that a direct running product could hit.
  const logSum = ratios.reduce((sum, ratio) => sum + Math.log(Math.max(ratio, 1e-6)), 0);
  const geometricMeanRatio = Math.exp(logSum / ratios.length);

  const raw = MIN_SUCCESS_CHANCE + geometricMeanRatio * 0.5
    - unmetRequirements * REQUIREMENT_PENALTY_PER_UNMET;
  return Math.max(MIN_SUCCESS_CHANCE, Math.min(MAX_SUCCESS_CHANCE, raw));
}

// Per-active-player rate for every tier's standing market target — the whole market (not
// just the bidding tiers) is maintained continuously by workers/marketGC.ts (checked every
// 15 minutes, topped up to max(rate, ceil(rate * activePlayerCount)) whenever a slot opens
// up) rather than a once-daily fixed add, so the market scales with how many people are
// actually playing instead of staying a constant regardless of guild size. "Active" means
// took some action in the last 7 days — see api's services/activity.ts.
//
// The rate also doubles as a floor: at zero or one active players this reduces to today's
// original fixed numbers, so a quiet market (or a fresh deploy, before anyone's activity
// clears the 7-day window) never drops to zero contracts and locks new players out.
export const CONTRACT_MARKET_BASE_RATE: Record<ContractTier, number> = {
  errand:    5,
  standard:  8,
  dangerous: 5,
  legendary: 2,
};
