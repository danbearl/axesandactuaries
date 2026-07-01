import type {
  Player, Adventurer, Contract, Adventure, Property, Transaction,
} from '@adventurer-manager/types';

export const MOCK_PLAYER: Player = {
  id:         'player_001',
  username:   'Thornwick & Associates',
  gold:       1240,
  reputation: 14,
  createdAt:  '2024-01-01T00:00:00Z',
};

// ── Hired Adventurers ─────────────────────────────────────────────────────────

export const MOCK_HIRED_ADVENTURERS: Adventurer[] = [
  {
    id: 'adv_001', name: 'Vorn Ironvein', heritage: 'Stonemarked', vocation: 'Sellsword',
    gender: 'Male', level: 3, experience: 420, powerRating: 38,
    stats: { Might: 17, Finesse: 10, Grit: 15, Cunning: 9, Attunement: 7, Influence: 8 },
    personality: { loyalty: 4, ambition: 2, temperament: 3, disposition: 2 },
    hireCost: 350, dailyWage: 24, status: 'hired',
    height: "5'8\"", build: 'stocky', complexion: 'stone-grey', hairColor: 'iron grey', eyeColor: 'grey',
    employerId: 'player_001',
  },
  {
    id: 'adv_002', name: 'Sylarra Willowmere', heritage: 'Verdant', vocation: 'Outrider',
    gender: 'Female', level: 2, experience: 180, powerRating: 26,
    stats: { Might: 9, Finesse: 16, Grit: 12, Cunning: 14, Attunement: 10, Influence: 11 },
    personality: { loyalty: 3, ambition: 4, temperament: 2, disposition: 4 },
    hireCost: 230, dailyWage: 16, status: 'on_adventure',
    height: "5'6\"", build: 'wiry', complexion: 'olive', hairColor: 'deep auburn', eyeColor: 'hazel',
    employerId: 'player_001',
  },
  {
    id: 'adv_003', name: 'Embrix Ashmantle', heritage: 'Cinder', vocation: 'Invoker',
    gender: 'Male', level: 2, experience: 210, powerRating: 28,
    stats: { Might: 12, Finesse: 10, Grit: 11, Cunning: 13, Attunement: 17, Influence: 9 },
    personality: { loyalty: 2, ambition: 5, temperament: 4, disposition: 2 },
    hireCost: 260, dailyWage: 18, status: 'hired',
    height: "5'7\"", build: 'sinewy', complexion: 'ash-grey', hairColor: 'ember red', eyeColor: 'amber',
    employerId: 'player_001',
  },
  {
    id: 'adv_004', name: 'Kelda Harborwatch', heritage: 'Saltblood', vocation: 'Mender',
    gender: 'Female', level: 1, experience: 60, powerRating: 14,
    stats: { Might: 8, Finesse: 11, Grit: 12, Cunning: 10, Attunement: 13, Influence: 15 },
    personality: { loyalty: 5, ambition: 2, temperament: 1, disposition: 5 },
    hireCost: 140, dailyWage: 10, status: 'injured',
    injuryRecoveryUntil: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    height: "5'4\"", build: 'sturdy', complexion: 'bronze', hairColor: 'sandy brown', eyeColor: 'sea green',
    employerId: 'player_001',
  },
];

// ── Market Adventurers ────────────────────────────────────────────────────────

export const MOCK_MARKET_ADVENTURERS: Adventurer[] = [
  {
    id: 'adv_101', name: 'Shade Nightveil', heritage: 'Duskwalker', vocation: 'Trickster',
    gender: 'Male', level: 2, experience: 155, powerRating: 24,
    stats: { Might: 9, Finesse: 17, Grit: 10, Cunning: 15, Attunement: 11, Influence: 13 },
    personality: { loyalty: 2, ambition: 4, temperament: 3, disposition: 3 },
    hireCost: 220, dailyWage: 15, status: 'available',
    height: "5'11\"", build: 'slender', complexion: 'twilight purple', hairColor: 'midnight black', eyeColor: 'violet',
  },
  {
    id: 'adv_102', name: 'Forge Hammerfall', heritage: 'Ironbound', vocation: 'Sellsword',
    gender: 'Male', level: 4, experience: 720, powerRating: 52,
    stats: { Might: 19, Finesse: 11, Grit: 17, Cunning: 8, Attunement: 7, Influence: 9 },
    personality: { loyalty: 3, ambition: 3, temperament: 4, disposition: 2 },
    hireCost: 480, dailyWage: 33, status: 'available',
    height: "6'4\"", build: 'hulking', complexion: 'ruddy bronze', hairColor: 'dark brown', eyeColor: 'dark brown',
  },
  {
    id: 'adv_103', name: 'Caela Skymantle', heritage: 'Aethborn', vocation: 'Arcanist',
    gender: 'Female', level: 3, experience: 380, powerRating: 35,
    stats: { Might: 8, Finesse: 12, Grit: 10, Cunning: 14, Attunement: 18, Influence: 12 },
    personality: { loyalty: 3, ambition: 5, temperament: 2, disposition: 4 },
    hireCost: 340, dailyWage: 22, status: 'available',
    height: "5'7\"", build: 'willowy', complexion: 'pale silver', hairColor: 'silver-white', eyeColor: 'pale blue',
  },
  {
    id: 'adv_104', name: 'Haunda Deepcarve', heritage: 'Stonemarked', vocation: 'Mender',
    gender: 'Female', level: 1, experience: 0, powerRating: 12,
    stats: { Might: 9, Finesse: 10, Grit: 13, Cunning: 11, Attunement: 12, Influence: 14 },
    personality: { loyalty: 4, ambition: 2, temperament: 1, disposition: 5 },
    hireCost: 110, dailyWage: 8, status: 'available',
    height: "4'11\"", build: 'compact', complexion: 'dark brown', hairColor: 'salt-and-pepper', eyeColor: 'amber',
  },
  {
    id: 'adv_105', name: 'Faene Briarhold', heritage: 'Verdant', vocation: 'Chronicler',
    gender: 'Female', level: 2, experience: 200, powerRating: 22,
    stats: { Might: 8, Finesse: 13, Grit: 10, Cunning: 17, Attunement: 13, Influence: 14 },
    personality: { loyalty: 3, ambition: 4, temperament: 1, disposition: 4 },
    hireCost: 195, dailyWage: 14, status: 'available',
    height: "5'5\"", build: 'lean', complexion: 'warm tan', hairColor: 'earthy brown', eyeColor: 'deep green',
  },
  {
    id: 'adv_106', name: 'Pyra Emberveil', heritage: 'Cinder', vocation: 'Alchemist',
    gender: 'Female', level: 1, experience: 30, powerRating: 11,
    stats: { Might: 8, Finesse: 12, Grit: 9, Cunning: 15, Attunement: 14, Influence: 9 },
    personality: { loyalty: 3, ambition: 5, temperament: 3, disposition: 3 },
    hireCost: 100, dailyWage: 8, status: 'available',
    height: "5'4\"", build: 'compact', complexion: 'charcoal', hairColor: 'ash white', eyeColor: 'red',
  },
];

// ── Active Adventures ─────────────────────────────────────────────────────────

export const MOCK_ADVENTURES: Adventure[] = [
  {
    id: 'adv_run_001',
    contract: {
      id: 'con_001',
      title: 'Clear the Millbrook Road',
      description: 'Brigands have been harassing merchant caravans on the Millbrook Road for three weeks. The Merchants\' Consortium has issued a standing contract for their removal.',
      tier: 'standard',
      requiredPower: 45,
      requiredStats: { Might: 12 },
      rewardGold: 280,
      reputationReward: 4,
      penaltyGold: 50,
      penaltyReputation: 2,
      durationHours: 6,
      status: 'in_progress',
      awardedTo: 'player_001',
      bidDeadline: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    adventurerIds: ['adv_002'],
    startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    completesAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    status: 'in_progress',
  },
];

// ── Available Contracts ───────────────────────────────────────────────────────

export const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'con_002',
    title: 'Exterminate the Root Cellar',
    description: 'An infestation of giant vermin has taken hold in the Hargrove estate root cellar. Lady Hargrove requires discreet and swift removal.',
    tier: 'errand',
    requiredPower: 20,
    requiredStats: {},
    rewardGold: 80,
    reputationReward: 1,
    penaltyGold: 10,
    penaltyReputation: 0,
    durationHours: 2,
    status: 'available',
    bidDeadline: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 40 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'con_003',
    title: 'Retrieve the Alderman\'s Ledger',
    description: 'A civic ledger was stolen from the Hall of Records by persons unknown. The Alderman\'s office requires its recovery from a thieves\' den in the warehouse district.',
    tier: 'standard',
    requiredPower: 40,
    requiredStats: { Cunning: 13, Finesse: 12 },
    rewardGold: 240,
    reputationReward: 3,
    penaltyGold: 40,
    penaltyReputation: 2,
    durationHours: 8,
    status: 'available',
    bidDeadline: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'con_004',
    title: 'Escort the Arcanist\'s Apprentice',
    description: 'The Collegium of Applied Mysteries requires an experienced escort party to accompany a junior arcanist to the Thornspire Research Station. Magical disturbances en route are expected.',
    tier: 'dangerous',
    requiredPower: 80,
    requiredStats: { Attunement: 14, Grit: 14 },
    rewardGold: 520,
    reputationReward: 7,
    penaltyGold: 120,
    penaltyReputation: 4,
    durationHours: 24,
    status: 'available',
    bidDeadline: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'con_005',
    title: 'Survey the Greymoss Fens',
    description: 'The Cartographers\' Union requires a thorough survey of the Greymoss Fens following reports of unusual activity. Hazardous terrain and aggressive wildlife expected.',
    tier: 'standard',
    requiredPower: 50,
    requiredStats: { Finesse: 13, Cunning: 12 },
    rewardGold: 310,
    reputationReward: 4,
    penaltyGold: 60,
    penaltyReputation: 2,
    durationHours: 16,
    status: 'available',
    bidDeadline: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 44 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'con_006',
    title: 'Recover the Sunken Archive',
    description: 'A pre-collapse archive lies submerged beneath the old quarter. The Historical Society wishes to recover as many documents as possible before the autumn floods seal access.',
    tier: 'legendary',
    requiredPower: 150,
    requiredStats: { Cunning: 16, Attunement: 15, Influence: 14 },
    rewardGold: 1800,
    reputationReward: 20,
    penaltyGold: 400,
    penaltyReputation: 10,
    durationHours: 72,
    status: 'available',
    bidDeadline: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
  },
];

// ── Properties ────────────────────────────────────────────────────────────────

export const MOCK_PROPERTIES: Property[] = [
  {
    id: 'prop_001',
    type: 'dormitory',
    level: 2,
    maintenanceCostDaily: 15,
    bonus: { xpMultiplier: 1.1 },
    builtAt: '2024-01-05T00:00:00Z',
  },
  {
    id: 'prop_002',
    type: 'training_hall',
    level: 1,
    maintenanceCostDaily: 10,
    bonus: { xpMultiplier: 1.15, powerRatingBonus: 2 },
    builtAt: '2024-01-08T00:00:00Z',
  },
];

// ── Transactions ──────────────────────────────────────────────────────────────

export const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx_001', amount: 500, reason: 'starting_gold',
    description: 'Initial guild charter funds', createdAt: '2024-01-01T08:00:00Z',
  },
  {
    id: 'tx_002', amount: -350, reason: 'hire_cost',
    description: 'Hired Vorn Ironvein (Sellsword, Lv.3)', referenceId: 'adv_001',
    createdAt: '2024-01-03T10:22:00Z',
  },
  {
    id: 'tx_003', amount: -230, reason: 'hire_cost',
    description: 'Hired Sylarra Willowmere (Outrider, Lv.2)', referenceId: 'adv_002',
    createdAt: '2024-01-03T10:45:00Z',
  },
  {
    id: 'tx_004', amount: -200, reason: 'property_build',
    description: 'Constructed Dormitory (Level 1)', referenceId: 'prop_001',
    createdAt: '2024-01-05T14:00:00Z',
  },
  {
    id: 'tx_005', amount: 160, reason: 'contract_payment',
    description: 'Completed: Patrol the Northern Quarter', referenceId: 'con_old_001',
    createdAt: '2024-01-07T18:30:00Z',
  },
  {
    id: 'tx_006', amount: -15, reason: 'property_maintenance',
    description: 'Daily maintenance: Dormitory', referenceId: 'prop_001',
    createdAt: '2024-01-08T00:00:00Z',
  },
  {
    id: 'tx_007', amount: -260, reason: 'hire_cost',
    description: 'Hired Embrix Ashmantle (Invoker, Lv.2)', referenceId: 'adv_003',
    createdAt: '2024-01-08T09:10:00Z',
  },
  {
    id: 'tx_008', amount: -140, reason: 'property_build',
    description: 'Constructed Training Hall (Level 1)', referenceId: 'prop_002',
    createdAt: '2024-01-08T11:00:00Z',
  },
  {
    id: 'tx_009', amount: 200, reason: 'contract_payment',
    description: 'Completed: Escort the Merchant\'s Daughter', referenceId: 'con_old_002',
    createdAt: '2024-01-10T20:00:00Z',
  },
  {
    id: 'tx_010', amount: -48, reason: 'wage',
    description: 'Wages paid: 4 adventurers (daily)', createdAt: '2024-01-11T00:00:00Z',
  },
  {
    id: 'tx_011', amount: -140, reason: 'hire_cost',
    description: 'Hired Kelda Harborwatch (Mender, Lv.1)', referenceId: 'adv_004',
    createdAt: '2024-01-11T08:30:00Z',
  },
  {
    id: 'tx_012', amount: 220, reason: 'contract_payment',
    description: 'Completed: Investigate the Collapsed Bridge', referenceId: 'con_old_003',
    createdAt: '2024-01-12T16:45:00Z',
  },
  {
    id: 'tx_013', amount: -48, reason: 'wage',
    description: 'Wages paid: 4 adventurers (daily)', createdAt: '2024-01-12T00:00:00Z',
  },
];
