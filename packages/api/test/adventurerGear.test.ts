import { describe, it, expect } from 'vitest';
import { MAX_GEAR_TIER, GEAR_TIER_LEVEL_REQUIREMENT, computeGearUpgradeCost } from '@axes-actuaries/types';
import { prisma } from '../src/lib/prisma.js';
import { upgradeGear } from '../src/services/adventurerGear.js';
import { createPlayer, createAdventurer } from './fixtures.js';

describe('upgradeGear', () => {
  it('purchases the next tier: deducts gold, increments gearTier, records a transaction', async () => {
    const player = await createPlayer({ gold: 100_000 });
    const adv = await createAdventurer({
      name: 'Kessa Vane', employerId: player.id, level: 1, powerRating: 10, gearTier: 0,
    });
    const cost = computeGearUpgradeCost(1, 10);

    const result = await upgradeGear(player.id, adv.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.adventurer.gearTier).toBe(1);
    expect(result.player.gold).toBe(100_000 - cost);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('gear_upgrade');
    expect(tx.amount).toBe(-cost);
    expect(tx.referenceId).toBe(adv.id);
  });

  it('returns 404 for a nonexistent adventurer', async () => {
    const player = await createPlayer();
    const result = await upgradeGear(player.id, 'does-not-exist');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 403 when the adventurer is not in the caller\'s employ', async () => {
    const owner = await createPlayer();
    const other = await createPlayer();
    const adv = await createAdventurer({ employerId: owner.id });

    const result = await upgradeGear(other.id, adv.id);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('returns 409 once already at the maximum gear tier', async () => {
    const player = await createPlayer({ gold: 1_000_000 });
    const adv = await createAdventurer({
      employerId: player.id, level: 10, gearTier: MAX_GEAR_TIER,
    });

    const result = await upgradeGear(player.id, adv.id);
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('returns 409 when the adventurer\'s level is below the next tier\'s requirement', async () => {
    const player = await createPlayer({ gold: 1_000_000 });
    const adv = await createAdventurer({ employerId: player.id, level: 1, gearTier: 1 });
    // Tier 2 requires level 3 (GEAR_TIER_LEVEL_REQUIREMENT) — this adventurer is only level 1.
    expect(GEAR_TIER_LEVEL_REQUIREMENT[2]).toBeGreaterThan(1);

    const result = await upgradeGear(player.id, adv.id);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details).toMatchObject({ required: GEAR_TIER_LEVEL_REQUIREMENT[2], current: 1 });
  });

  it('returns 400 on insufficient gold, without mutating gearTier', async () => {
    const player = await createPlayer({ gold: 0 });
    const adv = await createAdventurer({ employerId: player.id, level: 1, powerRating: 10, gearTier: 0 });

    const result = await upgradeGear(player.id, adv.id);
    expect(result).toMatchObject({ ok: false, status: 400 });

    const unchanged = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(unchanged.gearTier).toBe(0);
  });
});
