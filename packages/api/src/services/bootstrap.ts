import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateAdventurer } from '@adventurer-manager/types';
import { ClaimConflictError } from '../lib/errors.js';

export const WELFARE_COOLDOWN_HOURS = 48;

export const WELFARE_CONTRACT = {
  title:             'Guild Charity Work: Delivery Run',
  description:       'The Adventurers\' Guild has arranged a simple delivery task for your company in its time of need. No penalty if things go awry — just get back on your feet.',
  tier:              'errand' as const,
  requiredPower:     1,
  requiredStats:     {},
  rewardGold:        200,
  reputationReward:  5,
  penaltyGold:       0,
  penaltyReputation: 0,
  durationHours:     2,
};

export interface BootstrapStatus {
  // Player has zero hired adventurers, zero properties, and can't afford
  // the cheapest adventurer on the market — desperate hire is unlocked.
  desperateHireAvailable: boolean;
  // Player has zero properties and can't afford market hire (adventurer
  // count not required — they may already have the desperate hire in roster).
  welfareContractAvailable: boolean;
  welfareContractCooldownUntil: Date | null;
}

// Accepts either the singleton client or an interactive-transaction client so
// callers that need to re-verify eligibility atomically (e.g. desperate-hire,
// which has no single row to gate an atomic UPDATE WHERE on) can run this
// check inside the same transaction that acts on the result.
type Db = PrismaClient | Prisma.TransactionClient;

export async function getBootstrapStatus(playerId: string, db: Db = prisma): Promise<BootstrapStatus> {
  const [hiredCount, propertyCount, cheapestAdventurer, player] = await Promise.all([
    db.adventurer.count({
      where: {
        employerId: playerId,
        status: { in: ['hired', 'on_adventure', 'injured'] },
      },
    }),
    db.property.count({ where: { playerId } }),
    db.adventurer.findFirst({
      where: {
        status: 'available',
        employerId: null,
        OR: [{ poolExpiresAt: null }, { poolExpiresAt: { gt: new Date() } }],
      },
      orderBy: { hireCost: 'asc' },
      select: { hireCost: true },
    }),
    db.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { gold: true, lastWelfareAt: true },
    }),
  ]);

  const cheapestHire = cheapestAdventurer?.hireCost ?? Infinity;
  const canAfford    = player.gold >= cheapestHire;
  const hasNoProps   = propertyCount === 0;

  const cooldownExpiry = player.lastWelfareAt
    ? new Date(player.lastWelfareAt.getTime() + WELFARE_COOLDOWN_HOURS * 60 * 60 * 1000)
    : null;
  const onCooldown = cooldownExpiry !== null && new Date() < cooldownExpiry;

  return {
    desperateHireAvailable:    hiredCount === 0 && hasNoProps && !canAfford,
    welfareContractAvailable:  hasNoProps && !canAfford && !onCooldown,
    welfareContractCooldownUntil: onCooldown ? cooldownExpiry : null,
  };
}

// Awards a welfare contract and starts its cooldown.
//
// The cooldown check-then-act must be atomic: two concurrent requests both
// reading "not on cooldown" before either commits would otherwise grant
// unlimited free welfare contracts. The UPDATE WHERE below only matches if
// the cooldown is still actually expired at the moment it runs.
export async function claimWelfareContract(playerId: string) {
  const now            = new Date();
  const cooldownCutoff = new Date(now.getTime() - WELFARE_COOLDOWN_HOURS * 60 * 60 * 1000);
  const expiresAt      = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.player.updateMany({
      where: {
        id: playerId,
        OR: [{ lastWelfareAt: null }, { lastWelfareAt: { lt: cooldownCutoff } }],
      },
      data: { lastWelfareAt: now },
    });
    if (claimed.count === 0) {
      throw new ClaimConflictError('Guild charity work is on cooldown');
    }

    return tx.contract.create({
      data: {
        ...WELFARE_CONTRACT,
        status:      'awarded',
        awardedTo:   playerId,
        bidDeadline: expiresAt,
        expiresAt,
      },
    });
  });
}

// Grants a free, minimum-loyalty adventurer to a player who has none.
//
// Eligibility here is a derived count (zero adventurers/properties, can't
// afford market) rather than a single row an atomic UPDATE WHERE can gate
// on, so it's re-verified inside a Serializable transaction — Postgres will
// abort one side of a race instead of letting two concurrent requests both
// read "eligible" and both create a free adventurer.
export async function claimDesperateHire(playerId: string) {
  return prisma.$transaction(async (tx) => {
    const status = await getBootstrapStatus(playerId, tx);
    if (!status.desperateHireAvailable) {
      throw new ClaimConflictError(
        'Desperate hire is not available — you must have no adventurers, no properties, and insufficient gold to hire from the market',
      );
    }

    const a = generateAdventurer();
    // Override: free hire, minimum loyalty so they leave quickly if neglected
    const personality = { ...(a.personality as unknown as Record<string, number>), loyalty: 1 };

    return tx.adventurer.create({
      data: {
        name:         a.name,
        heritage:     a.heritage,
        vocation:     a.vocation,
        gender:       a.gender,
        level:        1,
        experience:   0,
        powerRating:  a.powerRating,
        stats:        a.stats       as object,
        personality:  personality   as object,
        hireCost:     0,
        dailyWage:    a.dailyWage,
        status:       'hired',
        employerId:   playerId,
        height:       a.height,
        build:        a.build,
        complexion:   a.complexion,
        hairColor:    a.hairColor,
        eyeColor:     a.eyeColor,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
