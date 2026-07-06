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
  'Chronicler',
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
  Chronicler: ['Chronicler', 'Lorekeeper', 'Sage'],
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
  Chronicler: ['Cunning',    'Influence',    'Attunement'],
  Alchemist:  ['Cunning',    'Attunement',   'Finesse'],
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
  employerId?: string;
  wagesOwed?:      number; // back wages owed; accumulates when daily pay fails
  daysUnpaid?:     number; // consecutive days without full pay
  loyaltyPenalty?: number; // cumulative loyalty reduction from non-payment
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
  rewardGold:          number;
  reputationReward:    number;
  penaltyGold:         number;
  penaltyReputation:   number;
  durationHours:       number;
  status:              ContractStatus;
  awardedTo?:          string;
  bidDeadline:         string; // ISO timestamp — deadline for bidding window
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
  | 'armory';

export interface PropertyBonus {
  xpMultiplier?:       number;
  injuryRecoveryRate?: number;
  powerRatingBonus?:   number;
  wageDiscount?:       number;
}

export interface Property {
  id:                  string;
  type:                PropertyType;
  level:               number;
  maintenanceCostDaily: number;
  bonus:               PropertyBonus;
  builtAt:             string;
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

// ── Leveling ──────────────────────────────────────────────────────────────────

// Cumulative XP required to reach each level (index = target level)
export const XP_TO_LEVEL = [0, 0, 100, 350, 850, 1850, 3850] as const;
export const MAX_LEVEL = 6;

export function levelForXp(xp: number): number {
  for (let lvl = MAX_LEVEL; lvl >= 2; lvl--) {
    if (xp >= XP_TO_LEVEL[lvl]) return lvl;
  }
  return 1;
}

// XP awarded per gold earned on a contract
export const XP_PER_GOLD = 0.1;

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
  | 'admin_adjustment';

export interface Transaction {
  id:          string;
  amount:      number; // positive = income, negative = expense
  reason:      TransactionReason;
  description: string;
  referenceId?: string;
  createdAt:   string;
}
