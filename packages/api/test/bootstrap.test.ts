import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getBootstrapStatus } from '../src/services/bootstrap.js';
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
