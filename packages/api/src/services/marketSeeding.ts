import { prisma } from '../lib/prisma.js';
import { generateAdventurer, generateDailyContracts } from '@axes-actuaries/types';

// Purely additive — only ever createMany, never deletes or modifies existing rows. Safe to
// call any time, including on demand (see routes/admin.ts's seed endpoints), unlike
// prisma/seed.ts which wipes the available pool first and is meant for a fresh dev/local
// database, not topping up a live one.

export async function seedAdventurers(count: number, now = new Date()): Promise<number> {
  const poolExpiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const data = Array.from({ length: count }, () => {
    const a = generateAdventurer();
    return {
      name:         a.name,
      heritage:     a.heritage,
      vocation:     a.vocation,
      gender:       a.gender,
      level:        a.level,
      experience:   a.experience,
      powerRating:  a.powerRating,
      stats:        a.stats       as object,
      personality:  a.personality as object,
      hireCost:     a.hireCost,
      dailyWage:    a.dailyWage,
      status:       'available'   as const,
      height:       a.height,
      build:        a.build,
      complexion:   a.complexion,
      hairColor:    a.hairColor,
      eyeColor:     a.eyeColor,
      poolExpiresAt,
    };
  });

  await prisma.adventurer.createMany({ data });
  return data.length;
}

export async function seedContracts(now = new Date()): Promise<number> {
  const contracts = generateDailyContracts(now);
  await prisma.contract.createMany({ data: contracts });
  return contracts.length;
}
