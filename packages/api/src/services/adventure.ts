import { prisma } from '../lib/prisma.js';
import { levelForXp, XP_PER_GOLD, MAX_LEVEL, computeDailyWage } from '@adventurer-manager/types';
import type { StatBlock } from '@adventurer-manager/types';
import { publish, CHANNELS } from '../lib/redis.js';

// Returns the party's effective combined power, including property bonuses.
async function computePartyPower(
  adventurerIds: string[],
  playerId: string,
): Promise<number> {
  const [adventurers, properties] = await Promise.all([
    prisma.adventurer.findMany({ where: { id: { in: adventurerIds } } }),
    prisma.property.findMany({ where: { playerId } }),
  ]);

  const basePower = adventurers.reduce((sum, a) => sum + a.powerRating, 0);

  const trainingBonus = properties
    .filter((p) => p.type === 'training_hall')
    .reduce((sum, p) => {
      const bonus = p.bonus as { powerRatingBonus?: number };
      return sum + (bonus.powerRatingBonus ?? 0) * p.level;
    }, 0);

  return basePower + trainingBonus;
}

// Resolves an in-progress adventure whose completesAt has passed.
// Safe to call multiple times — returns early if already resolved.
export async function resolveAdventure(adventureId: string) {
  const adventure = await prisma.adventure.findUnique({
    where: { id: adventureId },
    include: {
      contract: true,
      adventurers: { include: { adventurer: true } },
    },
  });

  if (!adventure || adventure.status !== 'in_progress') return adventure;
  if (adventure.completesAt > new Date()) return adventure;

  const partyPower = await computePartyPower(
    adventure.adventurers.map((aa) => aa.adventurerId),
    adventure.playerId,
  );

  const outcomeRoll = Math.random();
  const ratio = partyPower / adventure.contract.requiredPower;
  const successChance = Math.min(0.9, 0.3 + ratio * 0.5);
  const success = outcomeRoll < successChance;

  const infirmaryLevel = (
    await prisma.property.findFirst({
      where: { playerId: adventure.playerId, type: 'infirmary' },
    })
  )?.level ?? 0;

  return prisma.$transaction(async (tx) => {
    const resolved = await tx.adventure.update({
      where: { id: adventureId },
      data: {
        status: success ? 'completed' : 'failed',
        outcomeRoll,
        resolvedAt: new Date(),
      },
      include: { contract: true, adventurers: { include: { adventurer: true } } },
    });

    await tx.contract.update({
      where: { id: adventure.contractId },
      data: { status: success ? 'completed' : 'failed' },
    });

    for (const aa of adventure.adventurers) {
      const adv = aa.adventurer;
      const injuryRoll = Math.random();
      // Infirmary reduces base injury chance (0.4) by 8% per level
      const injuryChance = Math.max(0.05, 0.4 - infirmaryLevel * 0.08);
      const injured = !success && injuryRoll < injuryChance;
      const dead = injured && injuryRoll < 0.1;
      const recoveryHours = injured ? Math.floor(Math.random() * 48) + 12 : 0;

      // XP and leveling
      const xpGain = success ? Math.floor(adventure.contract.rewardGold * XP_PER_GOLD) : 0;
      const newXp = adv.experience + xpGain;
      const newLevel = Math.min(MAX_LEVEL, levelForXp(newXp));
      const didLevelUp = newLevel > adv.level;

      // Recompute power rating and wage on level-up
      let newPowerRating = adv.powerRating;
      let newDailyWage: number | undefined;
      if (didLevelUp) {
        const stats = adv.stats as StatBlock;
        const statAvg = Object.values(stats).reduce((a, b) => a + b, 0) / Object.values(stats).length;
        newPowerRating = Math.round(statAvg * newLevel);
        newDailyWage = computeDailyWage(newPowerRating);
      }

      await tx.adventurer.update({
        where: { id: adv.id },
        data: {
          status: dead ? 'dead' : injured ? 'injured' : 'hired',
          injuryRecoveryUntil: injured && !dead
            ? new Date(Date.now() + recoveryHours * 60 * 60 * 1000)
            : null,
          experience:  { increment: xpGain },
          level:       didLevelUp ? newLevel       : undefined,
          powerRating: didLevelUp ? newPowerRating : undefined,
          dailyWage:   didLevelUp ? newDailyWage   : undefined,
        },
      });
    }

    const goldDelta = success ? adventure.contract.rewardGold : -adventure.contract.penaltyGold;
    const repDelta  = success ? adventure.contract.reputationReward : -adventure.contract.penaltyReputation;

    await tx.player.update({
      where: { id: adventure.playerId },
      data: {
        gold:       { increment: goldDelta },
        reputation: { increment: repDelta },
      },
    });

    await tx.transaction.create({
      data: {
        playerId:    adventure.playerId,
        amount:      goldDelta,
        reason:      success ? 'contract_payment' : 'penalty',
        description: success
          ? `Completed: ${adventure.contract.title}`
          : `Failed: ${adventure.contract.title}`,
        referenceId: adventure.contractId,
      },
    });

    publish(CHANNELS.player(adventure.playerId), 'adventure_completed', {
      adventureId,
      status:        resolved.status,
      contractTitle: resolved.contract.title,
      goldDelta,
    }).catch(() => { /* non-fatal if Redis is unavailable */ });

    return resolved;
  });
}
