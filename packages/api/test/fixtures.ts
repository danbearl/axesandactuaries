import { prisma } from '../src/lib/prisma.js';
import type { Adventurer, Player, Contract } from '@prisma/client';

let counter = 0;
const nextId = () => `${Date.now()}_${counter++}`;

export async function createPlayer(overrides: Partial<Player> = {}): Promise<Player> {
  const id = nextId();
  return prisma.player.create({
    data: {
      clerkUserId: `clerk_${id}`,
      username: `player_${id}`,
      gold: 500,
      reputation: 0,
      ...overrides,
    },
  });
}

export async function createAdventurer(overrides: Partial<Adventurer> = {}): Promise<Adventurer> {
  const id = nextId();
  return prisma.adventurer.create({
    data: {
      name: `Adventurer ${id}`,
      heritage: 'Aethborn',
      vocation: 'Sellsword',
      gender: 'Male',
      level: 1,
      experience: 0,
      powerRating: 10,
      stats: { Might: 10, Finesse: 10, Grit: 10, Cunning: 10, Attunement: 10, Influence: 10 },
      personality: { loyalty: 3, ambition: 3, temperament: 3, disposition: 3 },
      hireCost: 100,
      dailyWage: 10,
      status: 'available',
      height: `5'10"`,
      build: 'lean',
      complexion: 'tan',
      hairColor: 'brown',
      eyeColor: 'brown',
      ...overrides,
    },
  });
}

export async function createContract(overrides: Partial<Contract> = {}): Promise<Contract> {
  const now = new Date();
  return prisma.contract.create({
    data: {
      title: 'Test Contract',
      description: 'A contract created for tests.',
      tier: 'standard',
      requiredPower: 30,
      requiredStats: {},
      rewardGold: 300,
      reputationReward: 3,
      penaltyGold: 90,
      penaltyReputation: 1,
      durationHours: 8,
      status: 'available',
      // Matches real generation: null until a first bid lands (see routes/contracts.ts).
      bidDeadline: null,
      expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      ...overrides,
    },
  });
}
