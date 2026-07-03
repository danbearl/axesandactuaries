import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { collectDailyWages, chargePropertyMaintenance } from '../src/services/economy.js';
import { createPlayer, createAdventurer } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectDailyWages', () => {
  it('pays adventurers in full when the player can afford it', async () => {
    const player = await createPlayer({ gold: 1000 });
    await createAdventurer({ employerId: player.id, status: 'hired', level: 2, dailyWage: 100 });
    await createAdventurer({ employerId: player.id, status: 'hired', level: 1, dailyWage: 50 });

    const [result] = await collectDailyWages();

    expect(result).toMatchObject({ playerId: player.id, paid: 2, unpaid: 0, quit: 0 });

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(850);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('wage');
    expect(tx.amount).toBe(-150);
  });

  it('pays the highest-level adventurer first when gold is short', async () => {
    // This test is about payment ordering, not the quit roll — pin Math.random
    // high enough that the unpaid adventurer's loyalty check never triggers a quit.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const player = await createPlayer({ gold: 40 });
    const highLevel = await createAdventurer({
      employerId: player.id, status: 'hired', level: 3, dailyWage: 40,
    });
    const lowLevel = await createAdventurer({
      employerId: player.id, status: 'hired', level: 1, dailyWage: 40,
    });

    const [result] = await collectDailyWages();
    expect(result).toMatchObject({ paid: 1, unpaid: 1, quit: 0 });

    const paid = await prisma.adventurer.findUniqueOrThrow({ where: { id: highLevel.id } });
    const unpaid = await prisma.adventurer.findUniqueOrThrow({ where: { id: lowLevel.id } });
    expect(paid.wagesOwed).toBe(0);
    expect(unpaid.wagesOwed).toBe(40);
    expect(unpaid.daysUnpaid).toBe(1);
  });

  it('applies surplus gold to back wages after current wages are paid', async () => {
    const player = await createPlayer({ gold: 1000 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 100,
      wagesOwed: 200, daysUnpaid: 2, loyaltyPenalty: 5,
    });

    await collectDailyWages();

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(700); // 1000 - 100 current - 200 back wages

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.wagesOwed).toBe(0);
    expect(updatedAdv.daysUnpaid).toBe(0);
    expect(updatedAdv.loyaltyPenalty).toBe(4); // recovered 1 point for being fully settled
  });

  it('rolls a quit check for unpaid adventurers and forgives their debt on quit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always "succeeds" the leave roll

    const player = await createPlayer({ gold: 0, reputation: 100 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', level: 2, dailyWage: 50,
      personality: { loyalty: 1, ambition: 3, temperament: 3, disposition: 3 },
      daysUnpaid: 5, loyaltyPenalty: 20,
    });

    const [result] = await collectDailyWages();
    expect(result.quit).toBe(1);

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.status).toBe('available');
    expect(updatedAdv.employerId).toBeNull();
    expect(updatedAdv.wagesOwed).toBe(0);

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.reputation).toBe(80); // level 2 * 10 penalty

    const forgiveness = await prisma.transaction.findFirstOrThrow({
      where: { playerId: player.id, reason: 'debt_forgiven' },
    });
    expect(forgiveness.referenceId).toBe(adv.id);
  });

  it('does not let adventurers on an active adventure quit even if unpaid', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // would force a quit if it were allowed to leave

    const player = await createPlayer({ gold: 0 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'on_adventure', dailyWage: 50,
      personality: { loyalty: 1, ambition: 3, temperament: 3, disposition: 3 },
      daysUnpaid: 5, loyaltyPenalty: 20,
    });

    const [result] = await collectDailyWages();
    expect(result.quit).toBe(0);

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.status).toBe('on_adventure');
    expect(updatedAdv.daysUnpaid).toBe(6);
    expect(updatedAdv.wagesOwed).toBe(50);
  });
});

describe('chargePropertyMaintenance', () => {
  it('charges the player and records a transaction for properties with upkeep', async () => {
    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: {
        playerId: player.id,
        type: 'dormitory',
        maintenanceCostDaily: 20,
        bonus: {},
      },
    });

    await chargePropertyMaintenance();

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(480);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('property_maintenance');
    expect(tx.amount).toBe(-20);
  });

  it('skips properties with zero maintenance cost', async () => {
    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: {
        playerId: player.id,
        type: 'library',
        maintenanceCostDaily: 0,
        bonus: {},
      },
    });

    await chargePropertyMaintenance();

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(500);
    const txCount = await prisma.transaction.count({ where: { playerId: player.id } });
    expect(txCount).toBe(0);
  });
});
