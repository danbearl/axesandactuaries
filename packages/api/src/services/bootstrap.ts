import { prisma } from '../lib/prisma.js';

export const WELFARE_COOLDOWN_HOURS = 48;

export interface BootstrapStatus {
  // Player has zero hired adventurers, zero properties, and can't afford
  // the cheapest adventurer on the market — desperate hire is unlocked.
  desperateHireAvailable: boolean;
  // Player has zero properties and can't afford market hire (adventurer
  // count not required — they may already have the desperate hire in roster).
  welfareContractAvailable: boolean;
  welfareContractCooldownUntil: Date | null;
}

export async function getBootstrapStatus(playerId: string): Promise<BootstrapStatus> {
  const [hiredCount, propertyCount, cheapestAdventurer, player] = await Promise.all([
    prisma.adventurer.count({
      where: {
        employerId: playerId,
        status: { in: ['hired', 'on_adventure', 'injured'] },
      },
    }),
    prisma.property.count({ where: { playerId } }),
    prisma.adventurer.findFirst({
      where: {
        status: 'available',
        employerId: null,
        OR: [{ poolExpiresAt: null }, { poolExpiresAt: { gt: new Date() } }],
      },
      orderBy: { hireCost: 'asc' },
      select: { hireCost: true },
    }),
    prisma.player.findUniqueOrThrow({
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
