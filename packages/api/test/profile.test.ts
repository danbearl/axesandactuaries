import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getPlayerProfileStats } from '../src/services/profile.js';
import { createPlayer, createContract } from './fixtures.js';

describe('getPlayerProfileStats', () => {
  it('returns zeroed stats for a player with no history', async () => {
    const player = await createPlayer();
    const stats = await getPlayerProfileStats(player.id);
    expect(stats).toEqual({
      adventuresCompleted: 0,
      adventuresFailed: 0,
      lifetimeGoldEarned: 0,
      adventurersHired: 0,
    });
  });

  it('counts completed/failed adventures, lifetime gold, and paid hires', async () => {
    const player = await createPlayer();
    const contract = await createContract();

    await prisma.adventure.create({
      data: { contractId: contract.id, playerId: player.id, startsAt: new Date(), completesAt: new Date(), status: 'completed' },
    });
    await prisma.adventure.create({
      data: { contractId: contract.id, playerId: player.id, startsAt: new Date(), completesAt: new Date(), status: 'failed' },
    });
    await prisma.adventure.create({
      data: { contractId: contract.id, playerId: player.id, startsAt: new Date(), completesAt: new Date(), status: 'in_progress' },
    });

    await prisma.transaction.create({
      data: { playerId: player.id, amount: 300, reason: 'contract_payment', description: 'test' },
    });
    await prisma.transaction.create({
      data: { playerId: player.id, amount: 500, reason: 'contract_payment', description: 'test' },
    });
    await prisma.transaction.create({
      data: { playerId: player.id, amount: -100, reason: 'hire_cost', description: 'test' },
    });
    // Desperate hires don't record a transaction — a plain starting_gold entry
    // shouldn't count toward adventurersHired.
    await prisma.transaction.create({
      data: { playerId: player.id, amount: 500, reason: 'starting_gold', description: 'test' },
    });

    const stats = await getPlayerProfileStats(player.id);
    expect(stats).toEqual({
      adventuresCompleted: 1,
      adventuresFailed: 1,
      lifetimeGoldEarned: 800,
      adventurersHired: 1,
    });
  });

  it('only counts a player\'s own history, not other players\'', async () => {
    const player = await createPlayer();
    const other = await createPlayer();
    const contract = await createContract();

    await prisma.adventure.create({
      data: { contractId: contract.id, playerId: other.id, startsAt: new Date(), completesAt: new Date(), status: 'completed' },
    });
    await prisma.transaction.create({
      data: { playerId: other.id, amount: 999, reason: 'contract_payment', description: 'test' },
    });

    const stats = await getPlayerProfileStats(player.id);
    expect(stats.adventuresCompleted).toBe(0);
    expect(stats.lifetimeGoldEarned).toBe(0);
  });
});
