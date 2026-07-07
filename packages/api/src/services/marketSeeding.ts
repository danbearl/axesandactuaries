import { prisma } from '../lib/prisma.js';
import { generateAdventurer, generateDailyContracts, generateContract, BIDDING_MARKET_TARGET } from '@axes-actuaries/types';

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

// Direct-accept tiers (errand/standard) only — a fixed once-daily batch. Bidding tiers
// (dangerous/legendary) don't use this; see replenishBiddingMarket below.
export async function seedContracts(now = new Date()): Promise<number> {
  const contracts = generateDailyContracts(now);
  await prisma.contract.createMany({ data: contracts });
  return contracts.length;
}

// Tops up dangerous/legendary contracts to their standing target (BIDDING_MARKET_TARGET),
// counting anything still live on the market (available or bidding). Called from
// workers/marketGC.ts on its existing 15-minute cycle rather than once daily — bidding-tier
// contracts don't age off on a fixed clock (see BID_WINDOW_HOURS), so replenishment has to be
// reactive to whenever a slot actually opens up, or the market would sit under target for up
// to a day at a time.
export async function replenishBiddingMarket(now = new Date()): Promise<number> {
  let added = 0;

  for (const [tier, target] of Object.entries(BIDDING_MARKET_TARGET) as ['dangerous' | 'legendary', number][]) {
    const current = await prisma.contract.count({
      where: { tier, status: { in: ['available', 'bidding'] } },
    });
    const shortfall = target - current;
    if (shortfall <= 0) continue;

    const contracts = Array.from({ length: shortfall }, () => generateContract(tier, now));
    await prisma.contract.createMany({ data: contracts });
    added += shortfall;
  }

  return added;
}
