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
    // Recovering from loyaltyPenalty: 5 to 4 still leaves a nonzero penalty, which now
    // rolls a quit check under the unified loyalty system — pin it to never succeed so
    // this test stays about back-wage repayment, not the quit roll.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

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

  it('recovers extra loyalty for a fighter-vocation adventurer with an Armory', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // never quits

    const player = await createPlayer({ gold: 1000 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'armory', level: 2, maintenanceCostDaily: 22, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 100,
      wagesOwed: 0, daysUnpaid: 0, loyaltyPenalty: 5,
      vocation: 'Sellsword', // fighter role — matches Armory
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    // base 1 point + Armory level 2 * loyaltyRecoveryBonus 1 = 3 points recovered
    expect(updatedAdv.loyaltyPenalty).toBe(2);
  });

  it('does not grant the Armory loyalty bonus to a non-fighter vocation', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // never quits

    const player = await createPlayer({ gold: 1000 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'armory', level: 2, maintenanceCostDaily: 22, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 100,
      wagesOwed: 0, daysUnpaid: 0, loyaltyPenalty: 5,
      vocation: 'Arcanist', // wizard role — does not match Armory
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.loyaltyPenalty).toBe(4); // only the base 1 point, no role bonus
  });

  it('recovers extra loyalty for a wizard-vocation adventurer with a Library', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // never quits

    const player = await createPlayer({ gold: 1000 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'library', level: 2, maintenanceCostDaily: 25, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 100,
      wagesOwed: 0, daysUnpaid: 0, loyaltyPenalty: 5,
      vocation: 'Arcanist', // wizard role — matches Library
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    // base 1 point + Library level 2 * loyaltyRecoveryBonus 1 = 3 points recovered
    expect(updatedAdv.loyaltyPenalty).toBe(2);
  });

  it('recovers extra loyalty for a rogue-vocation adventurer with an Alchemy Lab', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // never quits

    const player = await createPlayer({ gold: 1000 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'alchemy_lab', level: 2, maintenanceCostDaily: 30, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 100,
      wagesOwed: 0, daysUnpaid: 0, loyaltyPenalty: 5,
      vocation: 'Trickster', // rogue role — matches Alchemy Lab
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    // base 1 point + Alchemy Lab level 2 * loyaltyRecoveryBonus 1 = 3 points recovered
    expect(updatedAdv.loyaltyPenalty).toBe(2);
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

  it('does not accrue idle loyalty penalty within the grace period', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // would force the idle roll to hit if it ran at all

    const player = await createPlayer({ gold: 1000 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 50,
      personality: { loyalty: 5, ambition: 5, temperament: 3, disposition: 3 },
      daysIdle: 1, // will become 2 this cycle — still within the grace period (2)
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.daysIdle).toBe(2);
    expect(updatedAdv.loyaltyPenalty).toBe(0);
  });

  it('can cause a fully-paid, high-ambition adventurer to quit purely from idle neglect', async () => {
    // Loyalty is fully independent of payment — this adventurer is paid in full every cycle
    // and still becomes a flight risk if left idle too long, matching the design goal.
    vi.spyOn(Math, 'random').mockReturnValue(0); // idle-penalty roll and quit roll both hit

    const player = await createPlayer({ gold: 1000, reputation: 100 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', level: 2, dailyWage: 50,
      personality: { loyalty: 1, ambition: 5, temperament: 3, disposition: 3 },
      daysIdle: 3, // past the 2-day grace period -> this cycle's idle roll applies
    });

    const [result] = await collectDailyWages();
    expect(result.quit).toBe(1);

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.status).toBe('available');
    expect(updatedAdv.employerId).toBeNull();

    // Confirm they were actually paid this cycle (proving the quit wasn't wage-driven).
    const wageTx = await prisma.transaction.findFirstOrThrow({
      where: { playerId: player.id, reason: 'wage' },
    });
    expect(wageTx.amount).toBe(-50);
  });

  it('does not accrue idle penalty while an adventurer is resting off a prior mission', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // would force the idle roll to hit if it ran at all

    const player = await createPlayer({ gold: 1000 });
    const adv = await createAdventurer({
      employerId: player.id, status: 'hired', dailyWage: 50,
      personality: { loyalty: 5, ambition: 5, temperament: 3, disposition: 3 },
      daysIdle: 5,
      restUntil: new Date(Date.now() + 60 * 60 * 1000), // still resting
    });

    await collectDailyWages();

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updatedAdv.daysIdle).toBe(0);
    expect(updatedAdv.loyaltyPenalty).toBe(0);
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
