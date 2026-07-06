import { prisma } from '../lib/prisma.js';
import { levelForXp, XP_PER_GOLD, MAX_LEVEL, computeDailyWage } from '@axes-actuaries/types';
import type { StatBlock } from '@axes-actuaries/types';
import { publish, CHANNELS } from '../lib/redis.js';
import { ClaimConflictError } from '../lib/errors.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
// Adventuring carries some baseline risk even on success, so an overpowered party
// farming easy contracts still has *some* downside — previously injury/death could
// only happen on failure, meaning zero risk at all once a party outscaled its targets.
const FAILURE_INJURY_CHANCE = 0.4;
const SUCCESS_INJURY_CHANCE = 0.08;
const MIN_FAILURE_INJURY_CHANCE = 0.05;
const MIN_SUCCESS_INJURY_CHANCE = 0.01;
const INFIRMARY_INJURY_REDUCTION_PER_LEVEL = 0.08;
// Share of injury-triggering rolls that are additionally fatal, expressed relative to
// injuryChance (rather than a fixed roll cutoff) so it scales consistently whether the
// base rate is the failure or success chance, or reduced by an infirmary.
const DEATH_SHARE_OF_INJURY = 0.25;

// A healthy return still costs downtime before redeployment — a flat fraction of how
// long the adventure itself took. Removes the "instant redeploy" loop that let a
// roster snowball throughput with zero pacing cost. Injured adventurers already have
// their own (longer) recovery window and don't need this stacked on top.
const REST_HOURS_FRACTION_OF_DURATION = 0.25;

// Assigns a party to an awarded contract, starting the adventure.
//
// Racing this with the same contractId (or an adventurerId already claimed
// by another in-flight request) must not let two Adventures form against the
// same contract — each Adventure independently pays out on resolution, so a
// lost race here would otherwise duplicate rewards. Both claims are atomic
// UPDATE WHERE operations inside one transaction: if either matches fewer
// rows than expected, the transaction throws and rolls back entirely.
export async function startAdventure(
  playerId: string,
  contractId: string,
  adventurerIds: string[],
) {
  const uniqueAdventurerIds = [...new Set(adventurerIds)];
  if (uniqueAdventurerIds.length !== adventurerIds.length) {
    throw new ClaimConflictError('adventurerIds contains duplicates');
  }

  return prisma.$transaction(async (tx) => {
    const claimedContract = await tx.contract.updateMany({
      where: { id: contractId, awardedTo: playerId, status: 'awarded' },
      data: { status: 'in_progress' },
    });
    if (claimedContract.count === 0) {
      throw new ClaimConflictError('Contract is not awarded to you or is not in awarded status');
    }

    const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });

    const claimedAdventurers = await tx.adventurer.updateMany({
      where: {
        id: { in: uniqueAdventurerIds },
        employerId: playerId,
        status: 'hired',
        OR: [{ restUntil: null }, { restUntil: { lte: new Date() } }],
      },
      data: { status: 'on_adventure' },
    });
    if (claimedAdventurers.count !== uniqueAdventurerIds.length) {
      throw new ClaimConflictError('One or more adventurers are unavailable or not in your employ');
    }

    const completesAt = new Date(Date.now() + contract.durationHours * 60 * 60 * 1000);

    return tx.adventure.create({
      data: {
        contractId,
        playerId,
        startsAt: new Date(),
        completesAt,
        adventurers: {
          create: uniqueAdventurerIds.map((aid) => ({ adventurerId: aid })),
        },
      },
      include: { contract: true, adventurers: { include: { adventurer: true } } },
    });
  });
}

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
//
// `forceOutcome` is admin-only tooling (see routes/admin.ts): it bypasses both the
// completesAt gate and the success-chance roll, but injury/death/XP rolls still run
// normally against whatever outcome was forced.
export async function resolveAdventure(
  adventureId: string,
  opts?: { forceOutcome?: 'success' | 'failure' },
) {
  const adventure = await prisma.adventure.findUnique({
    where: { id: adventureId },
    include: {
      contract: true,
      adventurers: { include: { adventurer: true } },
    },
  });

  if (!adventure || adventure.status !== 'in_progress') return adventure;
  if (!opts?.forceOutcome && adventure.completesAt > new Date()) return adventure;

  const partyPower = await computePartyPower(
    adventure.adventurers.map((aa) => aa.adventurerId),
    adventure.playerId,
  );

  const outcomeRoll = Math.random();
  const ratio = partyPower / adventure.contract.requiredPower;
  const successChance = Math.min(0.9, 0.3 + ratio * 0.5);
  const success = opts?.forceOutcome ? opts.forceOutcome === 'success' : outcomeRoll < successChance;

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

    const partySize = adventure.adventurers.length;

    for (const aa of adventure.adventurers) {
      const adv = aa.adventurer;
      const injuryRoll = Math.random();

      const baseInjuryChance = success ? SUCCESS_INJURY_CHANCE : FAILURE_INJURY_CHANCE;
      const minInjuryChance = success ? MIN_SUCCESS_INJURY_CHANCE : MIN_FAILURE_INJURY_CHANCE;
      const injuryChance = Math.max(
        minInjuryChance,
        baseInjuryChance - infirmaryLevel * INFIRMARY_INJURY_REDUCTION_PER_LEVEL,
      );
      const injured = injuryRoll < injuryChance;
      const dead = injured && injuryRoll < injuryChance * DEATH_SHARE_OF_INJURY;
      const recoveryHours = injured && !dead ? Math.floor(Math.random() * 48) + 12 : 0;
      const restHours = !injured && !dead
        ? Math.ceil(adventure.contract.durationHours * REST_HOURS_FRACTION_OF_DURATION)
        : 0;

      // XP split evenly across the party — a full contract's XP going to *every*
      // member regardless of party size rewarded stuffing parties just to multi-level.
      const xpGain = success ? Math.floor((adventure.contract.rewardGold * XP_PER_GOLD) / partySize) : 0;
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
          restUntil: restHours > 0
            ? new Date(Date.now() + restHours * 60 * 60 * 1000)
            : null,
          experience:  { increment: xpGain },
          level:       didLevelUp ? newLevel       : undefined,
          powerRating: didLevelUp ? newPowerRating : undefined,
          dailyWage:   didLevelUp ? newDailyWage   : undefined,
        },
      });

      await tx.adventureAdventurer.update({
        where: { adventureId_adventurerId: { adventureId, adventurerId: adv.id } },
        data: {
          xpGained: xpGain,
          injured,
          died: dead,
          recoveryHours: injured && !dead ? recoveryHours : null,
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
