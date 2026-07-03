import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { getBootstrapStatus, claimWelfareContract, claimDesperateHire } from '../src/services/bootstrap.js';
import { ClaimConflictError } from '../src/lib/errors.js';
import { createPlayer, createAdventurer } from './fixtures.js';

async function seedMarketAdventurer(hireCost: number) {
  return createAdventurer({ status: 'available', employerId: null, hireCost });
}

describe('getBootstrapStatus', () => {
  it('is unavailable for a player who can afford the cheapest adventurer', async () => {
    const player = await createPlayer({ gold: 500 });
    await seedMarketAdventurer(100);

    const status = await getBootstrapStatus(player.id);
    expect(status.desperateHireAvailable).toBe(false);
    expect(status.welfareContractAvailable).toBe(false);
  });

  it('is available for a broke player with no roster or properties', async () => {
    const player = await createPlayer({ gold: 10 });
    await seedMarketAdventurer(100);

    const status = await getBootstrapStatus(player.id);
    expect(status.desperateHireAvailable).toBe(true);
    expect(status.welfareContractAvailable).toBe(true);
    expect(status.welfareContractCooldownUntil).toBeNull();
  });

  it('is unavailable once the player owns any property', async () => {
    const player = await createPlayer({ gold: 10 });
    await seedMarketAdventurer(100);
    await prisma.property.create({
      data: { playerId: player.id, type: 'dormitory', maintenanceCostDaily: 5, bonus: {} },
    });

    const status = await getBootstrapStatus(player.id);
    expect(status.desperateHireAvailable).toBe(false);
    expect(status.welfareContractAvailable).toBe(false);
  });

  it('disallows desperate hire once the player has a hired adventurer, but not welfare', async () => {
    const player = await createPlayer({ gold: 10 });
    await seedMarketAdventurer(100);
    await createAdventurer({ employerId: player.id, status: 'hired' });

    const status = await getBootstrapStatus(player.id);
    expect(status.desperateHireAvailable).toBe(false);
    expect(status.welfareContractAvailable).toBe(true);
  });

  it('respects the welfare cooldown window', async () => {
    const player = await createPlayer({
      gold: 10,
      lastWelfareAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago, well within 48h cooldown
    });
    await seedMarketAdventurer(100);

    const status = await getBootstrapStatus(player.id);
    expect(status.welfareContractAvailable).toBe(false);
    expect(status.welfareContractCooldownUntil).not.toBeNull();
  });

  it('allows welfare again once the cooldown has expired', async () => {
    const player = await createPlayer({
      gold: 10,
      lastWelfareAt: new Date(Date.now() - 49 * 60 * 60 * 1000), // 49 hours ago, past 48h cooldown
    });
    await seedMarketAdventurer(100);

    const status = await getBootstrapStatus(player.id);
    expect(status.welfareContractAvailable).toBe(true);
    expect(status.welfareContractCooldownUntil).toBeNull();
  });
});

describe('claimWelfareContract', () => {
  it('awards a contract and starts the cooldown', async () => {
    const player = await createPlayer({ gold: 10 });

    const contract = await claimWelfareContract(player.id);
    expect(contract.awardedTo).toBe(player.id);
    expect(contract.status).toBe('awarded');

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.lastWelfareAt).not.toBeNull();
  });

  it('rejects a claim while on cooldown', async () => {
    const player = await createPlayer({
      gold: 10,
      lastWelfareAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    await expect(claimWelfareContract(player.id)).rejects.toThrow(ClaimConflictError);
  });

  it('lets only one of two concurrent claims for the same player succeed', async () => {
    const player = await createPlayer({ gold: 10 });

    const results = await Promise.allSettled([
      claimWelfareContract(player.id),
      claimWelfareContract(player.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ClaimConflictError);

    const contractCount = await prisma.contract.count({ where: { awardedTo: player.id } });
    expect(contractCount).toBe(1);
  });
});

describe('claimDesperateHire', () => {
  it('creates a free, minimum-loyalty adventurer for an eligible player', async () => {
    const player = await createPlayer({ gold: 0 });

    const adventurer = await claimDesperateHire(player.id);
    expect(adventurer.employerId).toBe(player.id);
    expect(adventurer.hireCost).toBe(0);
    expect(adventurer.status).toBe('hired');
    expect((adventurer.personality as { loyalty: number }).loyalty).toBe(1);
  });

  it('rejects a claim once the player already has an adventurer', async () => {
    const player = await createPlayer({ gold: 0 });
    await createAdventurer({ employerId: player.id, status: 'hired' });

    await expect(claimDesperateHire(player.id)).rejects.toThrow(ClaimConflictError);
  });

  it('lets only one of two concurrent claims for the same player succeed', async () => {
    const player = await createPlayer({ gold: 0 });

    const results = await Promise.allSettled([
      claimDesperateHire(player.id),
      claimDesperateHire(player.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser can either fail the re-check (ClaimConflictError) or lose the
    // Postgres serializable-transaction race (Prisma P2034) depending on timing.
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    const isExpectedRejection =
      rejection instanceof ClaimConflictError ||
      (rejection instanceof Prisma.PrismaClientKnownRequestError && rejection.code === 'P2034');
    expect(isExpectedRejection).toBe(true);

    const hiredCount = await prisma.adventurer.count({ where: { employerId: player.id, status: 'hired' } });
    expect(hiredCount).toBe(1);
  });
});
