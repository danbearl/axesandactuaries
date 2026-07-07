import { prisma } from '../lib/prisma.js';
import { collectDailyWages, chargePropertyMaintenance } from '../services/economy.js';
import { seedAdventurers, seedContracts } from '../services/marketSeeding.js';
import { publish, CHANNELS } from '../lib/redis.js';
import { COHESION_DAILY_DECAY } from '@axes-actuaries/types';

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
    decayCohesion(),
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

  // seedContracts only covers errand/standard — dangerous/legendary are maintained by
  // marketGC's reactive standing-target top-up instead (see BIDDING_MARKET_TARGET).
  const [adventurersAdded, contractsAdded] = await Promise.all([
    seedAdventurers(adventurerCount, now),
    seedContracts(now),
  ]);
  console.log(`[daily-reset] Added ${adventurersAdded} adventurer(s), ${contractsAdded} contract(s) to market`);

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

// Flat daily erosion of party cohesion (see COHESION_DAILY_DECAY in @axes-actuaries/types).
// Decrement-then-delete rather than a single floored update, since Prisma's typed API has
// no expression for "decrement, but not below 0" — and a row at 0 is redundant with having
// no row at all (both mean "never adventured together" to every reader of this table).
async function decayCohesion(): Promise<void> {
  await prisma.adventurerCohesion.updateMany({
    data: { cohesion: { decrement: COHESION_DAILY_DECAY } },
  });
  const pruned = await prisma.adventurerCohesion.deleteMany({
    where: { cohesion: { lte: 0 } },
  });
  if (pruned.count > 0) {
    console.log(`[daily-reset] Fully decayed ${pruned.count} cohesion pair(s)`);
  }
}
