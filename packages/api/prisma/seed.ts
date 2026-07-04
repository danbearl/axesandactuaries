import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { generateAdventurerPool } from '@adventurer-manager/types';

const prisma = new PrismaClient();

// ── Contract templates ────────────────────────────────────────────────────────

const CONTRACT_TEMPLATES = [
  // Errands
  {
    title: 'Exterminate the Root Cellar',
    description: 'An infestation of giant vermin has taken hold in the Hargrove estate root cellar. Lady Hargrove requires discreet and swift removal.',
    tier: 'errand' as const, requiredPower: 15, requiredStats: {},
    rewardGold: 80, reputationReward: 1, penaltyGold: 10, penaltyReputation: 0, durationHours: 2,
  },
  {
    title: 'Recover a Lost Shipment',
    description: 'A wagon carrying dry goods was abandoned on the Millbrook Road after the driver was spooked by wolves. Retrieve it before nightfall.',
    tier: 'errand' as const, requiredPower: 12, requiredStats: {},
    rewardGold: 60, reputationReward: 1, penaltyGold: 0, penaltyReputation: 0, durationHours: 1,
  },
  {
    title: 'Patrol the Northern Quarter',
    description: 'The city watch is understaffed this week. Walk the northern quarter and report anything unusual to the gatehouse sergeant.',
    tier: 'errand' as const, requiredPower: 10, requiredStats: {},
    rewardGold: 50, reputationReward: 1, penaltyGold: 5, penaltyReputation: 0, durationHours: 3,
  },
  // Standards
  {
    title: 'Clear the Millbrook Road',
    description: 'Brigands have been harassing merchant caravans on the Millbrook Road for three weeks. The Merchants\' Consortium has issued a standing contract for their removal.',
    tier: 'standard' as const, requiredPower: 40, requiredStats: { Might: 12 },
    rewardGold: 280, reputationReward: 3, penaltyGold: 50, penaltyReputation: 2, durationHours: 6,
  },
  {
    title: 'Retrieve the Alderman\'s Ledger',
    description: 'A civic ledger was stolen from the Hall of Records by persons unknown. The Alderman\'s office requires its recovery from a thieves\' den in the warehouse district.',
    tier: 'standard' as const, requiredPower: 38, requiredStats: { Cunning: 13, Finesse: 12 },
    rewardGold: 240, reputationReward: 3, penaltyGold: 40, penaltyReputation: 2, durationHours: 8,
  },
  {
    title: 'Survey the Greymoss Fens',
    description: 'The Cartographers\' Union requires a thorough survey of the Greymoss Fens following reports of unusual activity. Hazardous terrain and aggressive wildlife expected.',
    tier: 'standard' as const, requiredPower: 45, requiredStats: { Finesse: 13, Cunning: 12 },
    rewardGold: 310, reputationReward: 4, penaltyGold: 60, penaltyReputation: 2, durationHours: 16,
  },
  {
    title: 'Investigate the Collapsed Bridge',
    description: 'The old Dawnhaven bridge collapsed under mysterious circumstances. The city engineers need someone to examine the wreckage for signs of sabotage.',
    tier: 'standard' as const, requiredPower: 35, requiredStats: { Cunning: 12 },
    rewardGold: 200, reputationReward: 3, penaltyGold: 30, penaltyReputation: 1, durationHours: 5,
  },
  // Dangerous
  {
    title: 'Escort the Arcanist\'s Apprentice',
    description: 'The Collegium of Applied Mysteries requires an experienced escort party to accompany a junior arcanist to the Thornspire Research Station. Magical disturbances en route are expected.',
    tier: 'dangerous' as const, requiredPower: 75, requiredStats: { Attunement: 14, Grit: 14 },
    rewardGold: 520, reputationReward: 7, penaltyGold: 120, penaltyReputation: 4, durationHours: 24,
  },
  {
    title: 'Eliminate the Ashen Cult',
    description: 'A splinter cult operating from the old tannery district has been conducting rituals that have left three city blocks plagued with toxic vapours. Full eradication required.',
    tier: 'dangerous' as const, requiredPower: 90, requiredStats: { Might: 14, Grit: 13 },
    rewardGold: 680, reputationReward: 8, penaltyGold: 150, penaltyReputation: 5, durationHours: 18,
  },
  {
    title: 'Infiltrate the Merchant Prince\'s Vault',
    description: 'A rival power has hired us to acquire certain documents from a heavily guarded private vault. Discretion is paramount. Violence will void the contract.',
    tier: 'dangerous' as const, requiredPower: 80, requiredStats: { Finesse: 15, Cunning: 14, Influence: 13 },
    rewardGold: 750, reputationReward: 6, penaltyGold: 200, penaltyReputation: 6, durationHours: 12,
  },
  // Legendary
  {
    title: 'Recover the Sunken Archive',
    description: 'A pre-collapse archive lies submerged beneath the old quarter. The Historical Society wishes to recover as many documents as possible before the autumn floods seal access.',
    tier: 'legendary' as const, requiredPower: 140, requiredStats: { Cunning: 16, Attunement: 15, Influence: 14 },
    rewardGold: 1800, reputationReward: 20, penaltyGold: 400, penaltyReputation: 10, durationHours: 72,
  },
  {
    title: 'Slay the Ridgeback Drake',
    description: 'A mature drake has established a nest in the Ridgeback Pass, severing the eastern trade routes entirely. The Trade Assembly is offering a substantial bounty for its elimination.',
    tier: 'legendary' as const, requiredPower: 160, requiredStats: { Might: 16, Grit: 15 },
    rewardGold: 2200, reputationReward: 25, penaltyGold: 500, penaltyReputation: 12, durationHours: 48,
  },
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding database…');

  // Clear existing available adventurers and contracts so re-running is safe
  await prisma.adventurer.deleteMany({ where: { status: 'available', employerId: null } });
  await prisma.contract.deleteMany({ where: { status: 'available' } });

  // Generate adventurer pool (20 adventurers, pool valid for 48h)
  const pool = generateAdventurerPool(20);
  const poolExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await prisma.adventurer.createMany({
    data: pool.map(a => ({
      name:        a.name,
      heritage:    a.heritage,
      vocation:    a.vocation,
      gender:      a.gender,
      level:       a.level,
      experience:  a.experience,
      powerRating: a.powerRating,
      stats:       a.stats,
      personality: a.personality,
      hireCost:    a.hireCost,
      dailyWage:   a.dailyWage,
      status:      'available',
      height:      a.height,
      build:       a.build,
      complexion:  a.complexion,
      hairColor:   a.hairColor,
      eyeColor:    a.eyeColor,
      poolExpiresAt,
    })),
  });

  console.log(`  ✓ Created ${pool.length} adventurers`);

  // Create contracts (bid deadline 20h, expires 48h)
  const now = Date.now();
  const bidDeadline = new Date(now + 20 * 60 * 60 * 1000);
  const expiresAt   = new Date(now + 48 * 60 * 60 * 1000);

  await prisma.contract.createMany({
    data: CONTRACT_TEMPLATES.map(c => ({
      ...c,
      status: 'available',
      bidDeadline,
      expiresAt,
    })),
  });

  console.log(`  ✓ Created ${CONTRACT_TEMPLATES.length} contracts`);
  console.log('Done.');
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
