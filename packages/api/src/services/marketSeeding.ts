import { prisma } from '../lib/prisma.js';
import { generateAdventurer, generateContract, CONTRACT_MARKET_BASE_RATE } from '@axes-actuaries/types';
import type { ContractTier } from '@axes-actuaries/types';
import { getActivePlayerCount } from './activity.js';

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

// Tops up every contract tier to its population-scaled standing target
// (CONTRACT_MARKET_BASE_RATE * active player count, floored at the base rate itself),
// counting anything still live on the market (available or bidding). Called from
// workers/marketGC.ts on its existing 15-minute cycle — contracts don't all age off on the
// same clock (direct-accept tiers use a fixed expiry, bidding tiers mostly don't, see
// BID_WINDOW_HOURS), so replenishment has to be reactive to whenever a slot actually opens
// up, or the market would sit under target for hours at a time.
export async function replenishContractMarket(now = new Date()): Promise<number> {
  const activePlayerCount = await getActivePlayerCount(now);
  let added = 0;

  for (const [tier, rate] of Object.entries(CONTRACT_MARKET_BASE_RATE) as [ContractTier, number][]) {
    const target = Math.max(rate, Math.ceil(rate * activePlayerCount));
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
