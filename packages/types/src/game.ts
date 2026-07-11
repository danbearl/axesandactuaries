// ── Heritage ──────────────────────────────────────────────────────────────────

export const HERITAGES = [
  'Aethborn',
  'Stonemarked',
  'Verdant',
  'Cinder',
  'Saltblood',
  'Duskwalker',
  'Ironbound',
] as const;

export type Heritage = (typeof HERITAGES)[number];

// ── Vocation ──────────────────────────────────────────────────────────────────

export const VOCATIONS = [
  'Sellsword',
  'Outrider',
  'Arcanist',
  'Mender',
  'Trickster',
  'Invoker',
  'Chanter',
  'Alchemist',
] as const;

export type Vocation = (typeof VOCATIONS)[number];

// Vocation progression tiers (displayed as title at each level bracket)
export const VOCATION_TIERS: Record<Vocation, [string, string, string]> = {
  Sellsword:  ['Sellsword',  'Warblade',   'Ironclad'],
  Outrider:   ['Outrider',   'Pathfinder', 'Ghost'],
  Arcanist:   ['Arcanist',   'Invoker',    'Archon'],
  Mender:     ['Mender',     'Warden',     'Lifebinder'],
  Trickster:  ['Trickster',  'Phantom',    'Shadowblade'],
  Invoker:    ['Invoker',    'Stormbinder','Conduit'],
  Chanter:    ['Chanter',    'Liturgist',  'Hierophant'],
  Alchemist:  ['Alchemist',  'Distiller',  'Grandmaster'],
};

// ── Stats ─────────────────────────────────────────────────────────────────────

export const STATS = ['Might', 'Finesse', 'Grit', 'Cunning', 'Attunement', 'Influence'] as const;

export type Stat = (typeof STATS)[number];

export type StatBlock = Record<Stat, number>;

// Primary stat priority per vocation — determines which stats get the highest rolls
export const VOCATION_STAT_PRIORITY: Record<Vocation, Stat[]> = {
  Sellsword:  ['Might',      'Grit',       'Finesse'],
  Outrider:   ['Finesse',    'Grit',        'Cunning'],
  Arcanist:   ['Attunement', 'Cunning',     'Influence'],
  Mender:     ['Influence',  'Attunement',  'Grit'],
  Trickster:  ['Finesse',    'Cunning',      'Influence'],
  Invoker:    ['Attunement', 'Might',        'Grit'],
  // Influence-primary (matching Mender, the other priest-role vocation) with Cunning as a
  // secondary nod to its ritual/lore roots — related to but distinct from Mender's own
  // Influence/Attunement/Grit profile.
  Chanter:    ['Influence',  'Cunning',      'Attunement'],
  Alchemist:  ['Cunning',    'Attunement',   'Finesse'],
};

// ── Party Roles ───────────────────────────────────────────────────────────────
// Groups vocations into the classical fantasy party roles (fighter/wizard/rogue/priest),
// derived from VOCATION_STAT_PRIORITY above. Backs the property system's role-specific
// buildings (Armory -> fighter, Library -> wizard, Alchemy Lab -> rogue, Sanctuary -> priest;
// see PROPERTY_PARTY_ROLE) and, longer-term, a planned mechanic where contracts favor certain
// party compositions.
//
// Every vocation now has an assigned role — Chanter (formerly Chronicler, renamed and
// reworked to actually fit) fills out priest alongside Mender. The old Chronicler didn't fit
// any role cleanly: "Lorekeeper"/"Sage"-flavored and Cunning-primary read as an arcane
// historian, not a cleric, so retitling alone wouldn't have fixed it — replaced instead of
// force-fit. Existing adventurers with the old vocation string were migrated by
// prisma/renameChroniclerToChanter.ts.
export type PartyRole = 'fighter' | 'wizard' | 'rogue' | 'priest';

export const VOCATION_PARTY_ROLE: Partial<Record<Vocation, PartyRole>> = {
  Sellsword:  'fighter',
  Outrider:   'fighter',
  Arcanist:   'wizard',
  Invoker:    'wizard',
  Trickster:  'rogue',
  Alchemist:  'rogue',
  Mender:     'priest',
  Chanter:    'priest',
};

// ── Personality ───────────────────────────────────────────────────────────────

export type Loyalty     = 1 | 2 | 3 | 4 | 5; // 1 = mercenary, 5 = steadfast
export type Ambition    = 1 | 2 | 3 | 4 | 5; // 1 = content, 5 = driven
export type Temperament = 1 | 2 | 3 | 4 | 5; // 1 = cautious, 5 = reckless
export type Disposition = 1 | 2 | 3 | 4 | 5; // 1 = gruff, 5 = amiable

export interface Personality {
  loyalty:     Loyalty;
  ambition:    Ambition;
  temperament: Temperament;
  disposition: Disposition;
}

// ── Adventurer ────────────────────────────────────────────────────────────────

export type AdventurerStatus = 'available' | 'hired' | 'on_adventure' | 'injured' | 'dead';

export interface Adventurer {
  id:          string;
  name:        string;
  heritage:    Heritage;
  vocation:    Vocation;
  gender:      string;
  level:       number;
  experience:  number;
  powerRating: number;
  stats:       StatBlock;
  personality: Personality;
  hireCost:    number;
  dailyWage:   number;
  status:      AdventurerStatus;
  injuryRecoveryUntil?: string; // ISO timestamp
  restUntil?:  string; // ISO timestamp — mandatory downtime after a healthy return, even on success
  employerId?: string;
  wagesOwed?:      number; // back wages owed; accumulates when daily pay fails
  daysUnpaid?:     number; // consecutive days without full pay
  loyaltyPenalty?: number; // cumulative loyalty reduction from non-payment
  gearTier?:   number; // 0 = none, up to MAX_GEAR_TIER — see computeGearBonus
  // Physical appearance
  height:      string;
  build:       string;
  complexion:  string;
  hairColor:   string;
  eyeColor:    string;
}

// ── Contract ──────────────────────────────────────────────────────────────────

export type ContractStatus =
  | 'available'
  | 'bidding'
  | 'awarded'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'expired';

export type ContractTier = 'errand' | 'standard' | 'dangerous' | 'legendary';

export interface Contract {
  id:                  string;
  title:               string;
  description:         string;
  tier:                ContractTier;
  requiredPower:       number;
  requiredStats:       Partial<StatBlock>;
  requiredVocation?:   Vocation;
  rewardGold:          number;
  reputationReward:    number;
  penaltyGold:         number;
  penaltyReputation:   number;
  durationHours:       number;
  status:              ContractStatus;
  awardedTo?:          string;
  bidDeadline:         string | null; // ISO timestamp — null until a first bid starts the countdown
  expiresAt:           string; // ISO timestamp — contract removed from market if never taken
  bidCount?:           number; // populated on market listings; number of bids placed
  hasBid?:             boolean; // populated on market listings; whether current player has bid
}

// ── Adventure ─────────────────────────────────────────────────────────────────

export type AdventureStatus = 'in_progress' | 'completed' | 'failed';

export interface Adventure {
  id:               string;
  contract:         Contract;
  adventurerIds:    string[];
  startsAt:         string; // ISO timestamp
  completesAt:      string; // ISO timestamp
  status:           AdventureStatus;
  outcomeRoll?:     number;
  resolvedAt?:      string;
}

// ── Property ──────────────────────────────────────────────────────────────────

export type PropertyType =
  | 'dormitory'
  | 'training_hall'
  | 'alchemy_lab'
  | 'library'
  | 'infirmary'
  | 'armory'
  | 'sanctuary';

export interface PropertyBonus {
  injuryRecoveryRate?:    number;
  powerRatingBonus?:      number;
  xpBonusPerLevel?:       number; // role-vocation XP bonus (Armory/fighter, Library/wizard)
  loyaltyRecoveryBonus?:  number; // role-vocation loyalty-recovery bonus (Armory/fighter, Library/wizard)
}

export interface Property {
  id:                  string;
  type:                PropertyType;
  level:               number;
  maintenanceCostDaily: number;
  bonus:               PropertyBonus;
  builtAt:             string;
}

// Fractional bonus to a party's total power from Training Hall (0.10 = +10%/level, stored on
// the property itself — see routes/properties.ts). Shared between the backend's actual
// success-chance roll (computePartyPower in services/adventure.ts) and the frontend's live
// party-assembly preview, so what a player sees while picking a party always matches what
// resolution actually uses — the same reasoning Cohesion's shared bonus function follows.
export function computeTrainingHallBonus(properties: Array<{ type: string; level: number; bonus: PropertyBonus }>): number {
  return properties
    .filter((p) => p.type === 'training_hall')
    .reduce((sum, p) => sum + (p.bonus.powerRatingBonus ?? 0) * p.level, 0);
}

// Which property type serves each party role — the buildable counterpart to
// VOCATION_PARTY_ROLE above. Every role now has a property.
export const PROPERTY_PARTY_ROLE: Partial<Record<PropertyType, PartyRole>> = {
  armory:      'fighter',
  library:     'wizard',
  alchemy_lab: 'rogue',
  sanctuary:   'priest',
};

// Looks up the role-property bonus (by bonus key, e.g. 'xpBonusPerLevel' or
// 'loyaltyRecoveryBonus') that applies to a given adventurer, based on their vocation's party
// role and whichever property currently serves that role for this player. Shared by
// resolveAdventure (XP) and the daily wage/loyalty cycle (loyalty recovery) so both read the
// exact same matching logic rather than reimplementing it twice.
export function findRolePropertyBonus(
  vocation: Vocation,
  properties: Array<{ type: string; level: number; bonus: PropertyBonus }>,
  bonusKey: keyof PropertyBonus,
): number {
  const role = VOCATION_PARTY_ROLE[vocation];
  if (!role) return 0;
  const property = properties.find((p) => PROPERTY_PARTY_ROLE[p.type as PropertyType] === role);
  if (!property) return 0;
  const perLevel = property.bonus[bonusKey] ?? 0;
  return perLevel * property.level;
}

// ── Player ────────────────────────────────────────────────────────────────────

export interface Player {
  id:         string;
  username:   string;
  gold:       number;
  reputation: number;
  createdAt:  string;
}

// ── Market ────────────────────────────────────────────────────────────────────

export type ListingType = 'adventurer_hire' | 'contract_bid';

export interface MarketListing {
  id:           string;
  listingType:  ListingType;
  listedBy?:    string;
  adventurerId?: string;
  contractId?:  string;
  price:        number;
  status:       'active' | 'accepted' | 'expired' | 'withdrawn';
  expiresAt:    string;
}

// ── Reputation ────────────────────────────────────────────────────────────────

// Minimum reputation required to hire an adventurer of each level.
export const HIRE_REPUTATION_REQUIREMENTS: Readonly<Record<number, number>> = {
  1: 0,
  2: 0,
  3: 25,
  4: 75,
  5: 200,
  6: 500,
};

// Reputation lost per adventurer level when they quit due to unpaid wages.
// e.g. a level-3 adventurer quitting costs 30 reputation.
export const QUIT_REPUTATION_PENALTY_PER_LEVEL = 10;

// Minimum reputation required to bid on or accept contracts of each tier.
export const CONTRACT_TIER_REPUTATION_REQUIREMENTS: Readonly<Record<ContractTier, number>> = {
  errand:    0,
  standard:  0,
  dangerous: 50,
  legendary: 200,
};

// Tiers that use competitive bidding; all others support direct accept.
export const BIDDING_CONTRACT_TIERS: ReadonlyArray<ContractTier> = ['dangerous', 'legendary'] as const;

// ── Roster capacity ───────────────────────────────────────────────────────────
// Caps total roster size to slow how fast a guild can scale up, gated by
// dormitory investment (a gold sink that fights the same snowball).

export const BASE_ROSTER_CAP = 4;
export const ROSTER_CAP_PER_DORM_LEVEL = 4;

export function computeRosterCap(dormitoryLevel: number): number {
  return BASE_ROSTER_CAP + dormitoryLevel * ROSTER_CAP_PER_DORM_LEVEL;
}

// ── Leveling ──────────────────────────────────────────────────────────────────

// Cumulative XP required to reach each level (index = target level). Levels 7-10 continue
// the same doubling curve already established by levels 3-6 (each jump exactly 2x the
// previous: 250, 500, 1000, 2000, so 4000/8000/16000/32000 next) — MAX_LEVEL was raised from
// 6 to 10 (2026-07-08, was a placeholder from initial design) without changing the curve's
// shape, just extending it.
export const XP_TO_LEVEL = [0, 0, 100, 350, 850, 1850, 3850, 7850, 15850, 31850, 63850] as const;
export const MAX_LEVEL = 10;

export function levelForXp(xp: number): number {
  for (let lvl = MAX_LEVEL; lvl >= 2; lvl--) {
    if (xp >= XP_TO_LEVEL[lvl]) return lvl;
  }
  return 1;
}

// XP awarded per gold earned on a contract
export const XP_PER_GOLD = 0.1;

// ── Equipment ─────────────────────────────────────────────────────────────────
// A late-game gold sink: a single per-adventurer gear tier (0 = none), each tier gated by the
// adventurer's own level and costing more the higher that adventurer's power already is. Power
// rises with level, so the top tiers are both level-gated *and* the most expensive purchases in
// the game — the bulk of the spend lands exactly where a maxed-out roster already sits, unlike
// properties (fixed cap at level 3) or leveling itself (free, a contract-income byproduct).
// Deliberately a flat tier rather than a full item/inventory system — see the design writeup
// captured in ROADMAP.md for the fuller rationale and the options not taken.
export const MAX_GEAR_TIER = 5;

export const GEAR_TIER_LEVEL_REQUIREMENT: Record<number, number> = {
  1: 1,
  2: 3,
  3: 5,
  4: 7,
  5: MAX_LEVEL,
};

export const GEAR_TIER_POWER_BONUS: Record<number, number> = {
  1: 0.05,
  2: 0.10,
  3: 0.15,
  4: 0.20,
  5: 0.25,
};

// Illustrative starting costs, not a final balance pass — tune once there's real playtesting
// data, same as contract power ranges were recalibrated earlier this project.
const GEAR_TIER_COST: Record<number, { base: number; perPower: number }> = {
  1: { base: 200,  perPower: 3 },
  2: { base: 500,  perPower: 6 },
  3: { base: 1000, perPower: 10 },
  4: { base: 2000, perPower: 15 },
  5: { base: 4000, perPower: 25 },
};

// Bonus fraction applied to this adventurer's own power contribution — combined additively
// alongside Training Hall/Cohesion in computePartyPower, same pattern, not written back into
// the adventurer's stored powerRating (so it doesn't affect hire cost, wages, or the
// Leaderboard's avgPower term, matching how Training Hall/Cohesion already don't either).
export function computeGearBonus(gearTier: number): number {
  return GEAR_TIER_POWER_BONUS[gearTier] ?? 0;
}

// Gold cost to upgrade to `nextTier`, scaled by the adventurer's current power rating.
export function computeGearUpgradeCost(nextTier: number, currentPower: number): number {
  const cfg = GEAR_TIER_COST[nextTier];
  if (!cfg) return 0;
  return Math.round(cfg.base + currentPower * cfg.perPower);
}

// ── Ambition / Loyalty ──────────────────────────────────────────────────────────
// First personality trait with real gameplay effects beyond Loyalty's existing unpaid-wage
// quit risk. High Ambition is a genuine trade-off: faster leveling, but a growing risk of
// quitting (independent of pay) if the adventurer feels under-utilized — sent on contracts
// beneath their level, or left idle too long. See services/economy.ts for how the resulting
// loyaltyPenalty (shared with the existing wage-based accumulator) feeds a unified daily
// quit-roll for every hired adventurer, not just unpaid ones.

// XP multiplier from Ambition: +5% per point above 1, so ambition 1 (Content) gets none and
// ambition 5 (Obsessed) gets +20%.
export const AMBITION_XP_BONUS_PER_POINT = 0.05;

export function computeAmbitionXpMultiplier(ambition: number): number {
  return 1 + (ambition - 1) * AMBITION_XP_BONUS_PER_POINT;
}

// Minimum contract tier an adventurer's level will tolerate without feeling under-used.
// Levels 1-2 take anything; 3-4 want standard+; 5-8 want dangerous+; 9-10 want legendary+.
// These breakpoints mirror VOCATION_TIERS' title tiers and CONTRACT_TIER_CONFIG's power-range
// calibration (both split 1-4/5-8/9-10 — see contracts.ts), so tolerance now actually reflects
// the tier of work the game expects someone that level to be doing.
//
// Legendary *does* act as a floor for levels 9-10 — a deliberate reversal of this function's
// original "legendary should never be a hard floor" framing, which predates MAX_LEVEL being
// raised from 6 to 10 (2026-07-08). Back when 6 was the cap, the old uncapped "5+ -> dangerous"
// branch only ever covered a tight 2-level top band; once the cap rose, that same branch
// silently swallowed the new 7-10 range too, so a level-10 adventurer (the current ceiling)
// was tolerated by the exact same floor as a level-5 one, and legendary could never register
// as expected work for anyone. Since CONTRACT_TIER_CONFIG already calibrates legendary
// specifically as levels 9-10's home difficulty, it's the more correct floor for that band now,
// not an exception to avoid.
const TIER_ORDER: readonly ContractTier[] = ['errand', 'standard', 'dangerous', 'legendary'];

export function minSatisfyingTier(level: number): ContractTier {
  if (level <= 2) return 'errand';
  if (level <= 4) return 'standard';
  if (level <= 8) return 'dangerous';
  return 'legendary';
}

export function isTierBelowTolerance(contractTier: ContractTier, adventurerLevel: number): boolean {
  return TIER_ORDER.indexOf(contractTier) < TIER_ORDER.indexOf(minSatisfyingTier(adventurerLevel));
}

// Both the tier-mismatch and idle-neglect loyalty triggers use the same shape: an
// ambition-scaled *chance* per trigger event to lose 1 loyalty point, rather than a
// guaranteed hit — so a single unlucky assignment doesn't wreck a high-loyalty adventurer
// outright. 8% per ambition point: ambition 1 -> 8% per trigger, ambition 5 -> 40%.
export const AMBITION_LOYALTY_CHANCE_PER_POINT = 0.08;

// Idle days (hired, not deployed, not injured/resting) before neglect can start costing
// loyalty at all — a short grace period so normal day-to-day gaps between contracts aren't
// punished.
export const IDLE_LOYALTY_GRACE_DAYS = 2;

// ── Temperament ───────────────────────────────────────────────────────────────
// Second personality trait with a real trade-off: higher Temperament means a reckless
// adventurer, individually rolled per party member in resolveAdventure. Trades safety for
// upside — more likely to come home with a bonus, but also more likely to get hurt, on
// both a successful and a failed contract.

// Chance (per adventurer, only on a successful contract) that their own recklessness
// bumps the contract's gold reward. 5% per temperament point: temperament 1 -> 5%,
// temperament 5 -> 25%. Multiple party members can each trigger independently, stacking.
export const TEMPERAMENT_BONUS_CHANCE_PER_POINT = 0.05;

// Gold bonus added to the contract's reward per adventurer who triggers it, as a fraction
// of the base reward (stacks additively across the party).
export const TEMPERAMENT_BONUS_GOLD_PER_TRIGGER = 0.10;

// Additive bump to that adventurer's own injury chance per temperament point, applied on
// top of the existing success/failure base injury rate — recklessness carries risk
// regardless of outcome. 2% per point: up to +10% at temperament 5.
export const TEMPERAMENT_INJURY_BONUS_PER_POINT = 0.02;

// ── Cohesion (Disposition) ───────────────────────────────────────────────────
// Third personality trait with a real trade-off: pairs of adventurers who complete a
// contract together build affinity over time, and a party's average affinity grants a
// small, capped bonus to its total power. Unlike Temperament's bonus roll, this accrues
// regardless of whether the contract succeeds or fails — deliberately not gated on
// success, both because shared hardship on a loss still counts as time spent together and
// to avoid a compounding loop where already-successful parties get progressively stronger.

// Cohesion between any two adventurers is stored 0-100 and clamped at the ceiling.
export const COHESION_MAX = 100;

// Flat amount every shared contract adds, plus the sum of both adventurers' Disposition
// (1-5 each), so the increment ranges 7 (disposition 1+1) to 15 (disposition 5+5) per
// shared contract.
export const COHESION_BASE_INCREMENT = 5;

export function computeCohesionIncrement(dispositionA: number, dispositionB: number): number {
  return COHESION_BASE_INCREMENT + dispositionA + dispositionB;
}

// Party power bonus at maximum cohesion (100 average across all party pairs) — a party
// that has never worked together gets none; full affinity across the board caps at +50%.
// Deliberately large: losing a high-cohesion member (injury, death, being fired) should be
// felt as a real hit to the party's remaining strength, not a rounding error.
export const COHESION_MAX_POWER_BONUS = 0.50;

// Given the pairwise cohesion values (0-100) among the members of a candidate or actual
// party, returns the fractional power bonus (0 to COHESION_MAX_POWER_BONUS). A party of
// one, or a party whose members have never adventured together, has no pairs and no bonus.
export function computeCohesionBonus(pairwiseCohesion: number[]): number {
  if (pairwiseCohesion.length === 0) return 0;
  const avg = pairwiseCohesion.reduce((sum, c) => sum + c, 0) / pairwiseCohesion.length;
  return (avg / COHESION_MAX) * COHESION_MAX_POWER_BONUS;
}

// Flat daily erosion applied to every cohesion pair (see workers/dailyReset.ts) — a pair
// that stops adventuring together drifts back toward 0 over time. Negligible day-to-day for
// a pair still working together regularly (each shared contract adds 7-15, versus -1/day),
// but erodes a maxed-out pair (100) to nothing over a few months of inactivity.
export const COHESION_DAILY_DECAY = 1;

// ── Transaction ───────────────────────────────────────────────────────────────

export type TransactionReason =
  | 'contract_payment'
  | 'wage'
  | 'hire_cost'
  | 'property_build'
  | 'property_sell'
  | 'property_maintenance'
  | 'penalty'
  | 'debt_forgiven'
  | 'starting_gold'
  | 'admin_adjustment'
  | 'contract_abandoned'
  | 'gear_upgrade';

export interface Transaction {
  id:          string;
  amount:      number; // positive = income, negative = expense
  reason:      TransactionReason;
  description: string;
  referenceId?: string;
  createdAt:   string;
}

// ── Player Events ─────────────────────────────────────────────────────────────
// Mirrors TransactionReason/Transaction's shape — an extensible, typed per-player event log
// (see api's services/playerEvents.ts). Adding a future event type costs one enum value here
// (kept in sync with the matching Prisma enum) plus one call site, no schema/route changes.

export type PlayerEventType =
  | 'contract_completed'
  | 'contract_failed'
  | 'adventurer_quit'
  | 'adventurer_recovered'
  | 'adventurer_rest_complete';

export interface PlayerEvent {
  id:          string;
  type:        PlayerEventType;
  summary:     string;
  referenceId?: string;
  createdAt:   string;
}

// ── Announcements ─────────────────────────────────────────────────────────────
// Kept in sync with the matching Prisma enum (see CLAUDE.md: a cross-stack enum value
// needs both sides updated together).

export type AnnouncementStatus = 'draft' | 'published';
