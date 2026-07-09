import { prisma } from '../lib/prisma.js';
import { MAX_GEAR_TIER, GEAR_TIER_LEVEL_REQUIREMENT, computeGearUpgradeCost } from '@axes-actuaries/types';
import type { Adventurer, Player } from '@prisma/client';

export type UpgradeGearResult =
  | { ok: true; player: Player; adventurer: Adventurer }
  | { ok: false; status: number; error: string; details?: Record<string, unknown> };

// Purchase the next gear tier for an adventurer — a late-game gold sink. Gated by the
// adventurer's own level; cost scales with their current power, so the top tiers are both
// level-gated and the most expensive purchases in the game (see GEAR_TIER_LEVEL_REQUIREMENT/
// computeGearUpgradeCost in @axes-actuaries/types). Returns a discriminated result rather than
// throwing, since — unlike most claim-conflict cases elsewhere in this codebase — the distinct
// failure modes here map to genuinely different HTTP statuses (404/403/409/400), not one
// uniform 409.
export async function upgradeGear(playerId: string, adventurerId: string): Promise<UpgradeGearResult> {
  const adventurer = await prisma.adventurer.findUnique({ where: { id: adventurerId } });
  if (!adventurer) {
    return { ok: false, status: 404, error: 'Adventurer not found' };
  }
  if (adventurer.employerId !== playerId) {
    return { ok: false, status: 403, error: 'This adventurer is not in your employ' };
  }
  if (adventurer.gearTier >= MAX_GEAR_TIER) {
    return { ok: false, status: 409, error: 'Adventurer already has the maximum gear tier' };
  }

  const nextTier = adventurer.gearTier + 1;
  const levelRequired = GEAR_TIER_LEVEL_REQUIREMENT[nextTier];
  if (adventurer.level < levelRequired) {
    return {
      ok:      false,
      status:  409,
      error:   `Requires level ${levelRequired} to reach gear tier ${nextTier}`,
      details: { required: levelRequired, current: adventurer.level },
    };
  }

  const cost = computeGearUpgradeCost(nextTier, adventurer.powerRating);
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
  if (player.gold < cost) {
    return {
      ok:      false,
      status:  400,
      error:   'Insufficient gold',
      details: { required: cost, available: player.gold },
    };
  }

  const [updatedPlayer, updatedAdventurer] = await prisma.$transaction([
    prisma.player.update({ where: { id: playerId }, data: { gold: { decrement: cost } } }),
    prisma.adventurer.update({ where: { id: adventurerId }, data: { gearTier: nextTier } }),
    prisma.transaction.create({
      data: {
        playerId,
        amount:      -cost,
        reason:      'gear_upgrade',
        description: `Upgraded ${adventurer.name}'s gear to tier ${nextTier}`,
        referenceId: adventurer.id,
      },
    }),
  ]);

  return { ok: true, player: updatedPlayer, adventurer: updatedAdventurer };
}
