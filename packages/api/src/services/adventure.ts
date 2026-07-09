import { prisma } from '../lib/prisma.js';
import {
  levelForXp, XP_PER_GOLD, MAX_LEVEL, computeDailyWage,
  countUnmetRequirements, estimateSuccessChance,
  isTierBelowTolerance, computeAmbitionXpMultiplier, AMBITION_LOYALTY_CHANCE_PER_POINT,
  TEMPERAMENT_BONUS_CHANCE_PER_POINT, TEMPERAMENT_BONUS_GOLD_PER_TRIGGER,
  TEMPERAMENT_INJURY_BONUS_PER_POINT,
  computeCohesionBonus, computeCohesionIncrement, COHESION_MAX,
  computeTrainingHallBonus, findRolePropertyBonus, computeGearBonus,
} from '@axes-actuaries/types';
import type { StatBlock, ContractTier, PropertyBonus, Vocation } from '@axes-actuaries/types';
import { publish, CHANNELS } from '../lib/redis.js';
import { logPlayerEvent } from './playerEvents.js';
import { ClaimConflictError } from '../lib/errors.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
// Adventuring carries some baseline risk even on success, so an overpowered party
// farming easy contracts still has *some* downside — previously injury/death could
// only happen on failure, meaning zero risk at all once a party outscaled its targets.
const FAILURE_INJURY_CHANCE = 0.4;
const SUCCESS_INJURY_CHANCE = 0.08;
// Share of injury-triggering rolls that are additionally fatal, expressed relative to
// injuryChance (rather than a fixed roll cutoff) so it scales consistently whether the
// base rate is the failure or success chance.
const DEATH_SHARE_OF_INJURY = 0.25;

// A healthy return still costs downtime before redeployment — a flat fraction of how
// long the adventure itself took. Removes the "instant redeploy" loop that let a
// roster snowball throughput with zero pacing cost. Injured adventurers already have
// their own (longer) recovery window and don't need this stacked on top.
const REST_HOURS_FRACTION_OF_DURATION = 0.25;

// Infirmary property: shrinks recovery TIME (not injury chance — see ROADMAP for why that
// split was made). The per-level rate lives on the property itself (bonus.injuryRecoveryRate,
// set in routes/properties.ts) rather than a hardcoded constant here, matching how Training
// Hall's power bonus is read. This floor keeps recovery from ever fully trivializing, even at
// a hypothetical future level beyond today's level-3 cap.
const INFIRMARY_RECOVERY_FLOOR_FRACTION = 0.25;

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
      data: { status: 'in_progress', deployBy: null },
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

    // Ambition trade-off: sending an adventurer below their level's tolerance carries a
    // chance of losing a loyalty point, scaled by ambition (never a guaranteed hit — see
    // packages/types/src/game.ts). Also resets daysIdle now that they're back to work.
    const deployedAdventurers = await tx.adventurer.findMany({
      where: { id: { in: uniqueAdventurerIds } },
    });
    for (const adv of deployedAdventurers) {
      const personality = adv.personality as { ambition: number };
      const belowTolerance = isTierBelowTolerance(contract.tier as ContractTier, adv.level);
      const lostLoyalty = belowTolerance
        && Math.random() < personality.ambition * AMBITION_LOYALTY_CHANCE_PER_POINT;

      await tx.adventurer.update({
        where: { id: adv.id },
        data: {
          daysIdle:       0,
          loyaltyPenalty: lostLoyalty ? { increment: 1 } : undefined,
        },
      });
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

// Every unordered pair from a list, e.g. pairs([a,b,c]) -> [[a,b],[a,c],[b,c]].
function pairs<T>(items: T[]): [T, T][] {
  const result: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      result.push([items[i], items[j]]);
    }
  }
  return result;
}

// AdventurerCohesion rows are keyed by (low, high) with the pair's IDs sorted
// lexicographically — every read/write in this file must sort before touching the table.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// Fractional power bonus (0 to COHESION_MAX_POWER_BONUS) from the party's average pairwise
// cohesion — see COHESION_* in @axes-actuaries/types. Missing rows (a pair that's never
// adventured together) count as 0 rather than being excluded from the average.
async function computePartyCohesionBonus(adventurerIds: string[]): Promise<number> {
  const idPairs = pairs(adventurerIds);
  if (idPairs.length === 0) return 0;

  const rows = await prisma.adventurerCohesion.findMany({
    where: {
      adventurerLowId:  { in: adventurerIds },
      adventurerHighId: { in: adventurerIds },
    },
  });
  const cohesionByPair = new Map(rows.map((r) => [pairKey(r.adventurerLowId, r.adventurerHighId), r.cohesion]));

  const values = idPairs.map(([a, b]) => cohesionByPair.get(pairKey(a, b)) ?? 0);
  return computeCohesionBonus(values);
}

// Returns the party's effective combined power, including property and cohesion bonuses.
async function computePartyPower(
  adventurerIds: string[],
  playerId: string,
): Promise<number> {
  const [adventurers, properties, cohesionBonus] = await Promise.all([
    prisma.adventurer.findMany({ where: { id: { in: adventurerIds } } }),
    prisma.property.findMany({ where: { playerId } }),
    computePartyCohesionBonus(adventurerIds),
  ]);

  // Gear is a per-adventurer bonus (unlike Training Hall/Cohesion, which apply uniformly to
  // the whole party) — each adventurer's own gearTier boosts only their own contribution to
  // basePower, before the party-wide bonuses below are layered on top.
  const basePower = adventurers.reduce((sum, a) => sum + a.powerRating * (1 + computeGearBonus(a.gearTier)), 0);

  // Combined additively with cohesion (not multiplicatively/compounded) so the total bonus
  // stays easy to reason about as more power-affecting mechanics are added.
  const trainingBonus = computeTrainingHallBonus(
    properties.map((p) => ({ type: p.type, level: p.level, bonus: p.bonus as PropertyBonus })),
  );

  return Math.round(basePower * (1 + trainingBonus + cohesionBonus));
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

  const unmetRequirements = countUnmetRequirements(
    {
      requiredStats:    adventure.contract.requiredStats as Partial<StatBlock>,
      requiredVocation: adventure.contract.requiredVocation,
    },
    adventure.adventurers.map((aa) => ({
      vocation: aa.adventurer.vocation,
      stats:    aa.adventurer.stats as Partial<StatBlock>,
    })),
  );

  const outcomeRoll = Math.random();
  const successChance = estimateSuccessChance(partyPower, adventure.contract.requiredPower, unmetRequirements);
  const success = opts?.forceOutcome ? opts.forceOutcome === 'success' : outcomeRoll < successChance;

  const properties = await prisma.property.findMany({
    where: { playerId: adventure.playerId },
  });
  const infirmary = properties.find((p) => p.type === 'infirmary');
  const infirmaryLevel = infirmary?.level ?? 0;
  const infirmaryRecoveryRate = (infirmary?.bonus as { injuryRecoveryRate?: number } | undefined)?.injuryRecoveryRate ?? 0;
  const recoveryMultiplier = Math.max(
    INFIRMARY_RECOVERY_FLOOR_FRACTION,
    1 - infirmaryLevel * infirmaryRecoveryRate,
  );
  const roleProperties = properties.map((p) => ({ type: p.type, level: p.level, bonus: p.bonus as PropertyBonus }));

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
    // Temperament trade-off: each party member independently rolls a chance (on success
    // only) to bump the contract's gold reward, stacking additively across the party.
    let bonusGoldMultiplier = 0;

    for (const aa of adventure.adventurers) {
      const adv = aa.adventurer;
      const injuryRoll = Math.random();
      const temperament = (adv.personality as { temperament: number }).temperament;

      const baseInjuryChance = success ? SUCCESS_INJURY_CHANCE : FAILURE_INJURY_CHANCE;
      // Recklessness carries risk regardless of outcome — the temperament bump applies on
      // top of the success/failure base rate.
      const injuryChance = baseInjuryChance + temperament * TEMPERAMENT_INJURY_BONUS_PER_POINT;
      const injured = injuryRoll < injuryChance;
      const dead = injured && injuryRoll < injuryChance * DEATH_SHARE_OF_INJURY;
      // Infirmary shrinks recovery time (not injury chance — see the constant above), applied
      // to the same 12-60h base roll a healthy infirmary-free adventurer would get.
      const recoveryHours = injured && !dead
        ? Math.round((Math.floor(Math.random() * 48) + 12) * recoveryMultiplier)
        : 0;
      const restHours = !injured && !dead
        ? Math.ceil(adventure.contract.durationHours * REST_HOURS_FRACTION_OF_DURATION)
        : 0;

      if (success && Math.random() < temperament * TEMPERAMENT_BONUS_CHANCE_PER_POINT) {
        bonusGoldMultiplier += TEMPERAMENT_BONUS_GOLD_PER_TRIGGER;
      }

      // XP split evenly across the party — a full contract's XP going to *every*
      // member regardless of party size rewarded stuffing parties just to multi-level.
      // Ambition then scales each member's own share individually (the trade-off's upside).
      const ambitionMultiplier = computeAmbitionXpMultiplier((adv.personality as { ambition: number }).ambition);
      // Party-role property bonus (e.g. Armory for fighter-role vocations) — only applies to
      // adventurers whose vocation matches a role a currently-owned property serves.
      const roleXpMultiplier = 1 + findRolePropertyBonus(adv.vocation as Vocation, roleProperties, 'xpBonusPerLevel');
      const xpGain = success
        ? Math.floor((adventure.contract.rewardGold * XP_PER_GOLD / partySize) * ambitionMultiplier * roleXpMultiplier)
        : 0;
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

    // Cohesion (Disposition): every pair of party members builds affinity from adventuring
    // together, regardless of whether the contract succeeds — see COHESION_* in
    // @axes-actuaries/types. One upsert per pair, clamped at COHESION_MAX.
    const partyMemberIds = adventure.adventurers.map((aa) => aa.adventurerId);
    if (partyMemberIds.length >= 2) {
      const cohesionRows = await tx.adventurerCohesion.findMany({
        where: {
          adventurerLowId:  { in: partyMemberIds },
          adventurerHighId: { in: partyMemberIds },
        },
      });
      const cohesionByPair = new Map(cohesionRows.map((r) => [pairKey(r.adventurerLowId, r.adventurerHighId), r.cohesion]));

      for (const [aa1, aa2] of pairs(adventure.adventurers)) {
        const [low, high] = aa1.adventurerId < aa2.adventurerId ? [aa1, aa2] : [aa2, aa1];
        const dispositionLow  = (low.adventurer.personality as { disposition: number }).disposition;
        const dispositionHigh = (high.adventurer.personality as { disposition: number }).disposition;
        const increment = computeCohesionIncrement(dispositionLow, dispositionHigh);
        const current = cohesionByPair.get(pairKey(low.adventurerId, high.adventurerId)) ?? 0;
        const newCohesion = Math.min(COHESION_MAX, current + increment);

        await tx.adventurerCohesion.upsert({
          where: {
            adventurerLowId_adventurerHighId: {
              adventurerLowId:  low.adventurerId,
              adventurerHighId: high.adventurerId,
            },
          },
          create: { adventurerLowId: low.adventurerId, adventurerHighId: high.adventurerId, cohesion: newCohesion },
          update: { cohesion: newCohesion },
        });
      }
    }

    const bonusGold = success ? Math.round(adventure.contract.rewardGold * bonusGoldMultiplier) : 0;
    const goldDelta  = success ? adventure.contract.rewardGold + bonusGold : -adventure.contract.penaltyGold;
    const repDelta   = success ? adventure.contract.reputationReward : -adventure.contract.penaltyReputation;

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
          ? `Completed: ${adventure.contract.title}${bonusGold > 0 ? ` (+${bonusGold} gp reckless bonus)` : ''}`
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

    await logPlayerEvent({
      playerId:    adventure.playerId,
      type:        success ? 'contract_completed' : 'contract_failed',
      summary:     success
        ? `Completed: ${adventure.contract.title}`
        : `Failed: ${adventure.contract.title}`,
      referenceId: adventureId,
    }).catch(() => { /* non-fatal if Redis is unavailable */ });

    return resolved;
  });
}
