import { prisma } from '../lib/prisma.js';
import { generateAdventurer } from '@adventurer-manager/types';
import { generateDailyContracts } from '@adventurer-manager/types';
import { collectDailyWages, chargePropertyMaintenance } from '../services/economy.js';
import { publish, CHANNELS } from '../lib/redis.js';

const DAILY_ADVENTURER_MIN        = 15;
const DAILY_ADVENTURERS_PER_PLAYER = 3;

// Runs at 00:00 UTC.
// Order: financial obligations first (wages, maintenance), then market refresh.
export async function runDailyReset(): Promise<void> {
  console.log('[daily-reset] Starting daily reset');
  const now = new Date();

  // Financial obligations run sequentially: wages before maintenance
  const wageResults = await collectDailyWages();
  await chargePropertyMaintenance();

  // Notify each player of their daily summary
  await Promise.allSettled(
    wageResults.map((r) =>
      publish(CHANNELS.player(r.playerId), 'daily_summary', r),
    ),
  );

  // Market cleanup and refresh can run in parallel
  await Promise.all([
    expireOldAdventurers(now),
    expireOldContracts(now),
  ]);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const playerCount = await prisma.player.count({
    where: {
      OR: [
        // Deliberate hire / build / sell actions in the last 7 days
        {
          transactions: {
            some: {
              createdAt: { gte: sevenDaysAgo },
              reason: { in: ['hire_cost', 'property_build', 'property_sell'] },
            },
          },
        },
        // Or sent a party on at least one adventure in the last 7 days
        { adventures: { some: { createdAt: { gte: sevenDaysAgo } } } },
      ],
    },
  });
  const adventurerCount = Math.max(
    DAILY_ADVENTURER_MIN,
    Math.ceil(playerCount * DAILY_ADVENTURERS_PER_PLAYER),
  );

  await Promise.all([
    seedAdventurers(now, adventurerCount),
    seedContracts(now),
  ]);

  publish(CHANNELS.market, 'market_update', { type: 'daily_reset' })
    .catch(() => { /* non-fatal */ });

  console.log('[daily-reset] Complete');
}

async function expireOldAdventurers(now: Date): Promise<void> {
  const result = await prisma.adventurer.updateMany({
    where: {
      status:       'available',
      employerId:   null,
      poolExpiresAt: { lt: now },
    },
    data: { status: 'dead' }, // "dead" used as soft-delete for expired pool entries
  });
  if (result.count > 0) {
    console.log(`[daily-reset] Expired ${result.count} old adventurer(s) from pool`);
  }
}

async function expireOldContracts(now: Date): Promise<void> {
  const result = await prisma.contract.updateMany({
    where: {
      status:    'available',
      expiresAt: { lt: now },
    },
    data: { status: 'expired' },
  });
  if (result.count > 0) {
    console.log(`[daily-reset] Expired ${result.count} old contract(s)`);
  }
}

async function seedAdventurers(now: Date, count: number): Promise<void> {
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
  console.log(`[daily-reset] Added ${data.length} adventurer(s) to market`);
}

async function seedContracts(now: Date): Promise<void> {
  const contracts = generateDailyContracts(now);
  await prisma.contract.createMany({ data: contracts });
  console.log(`[daily-reset] Added ${contracts.length} contract(s) to market`);
}
