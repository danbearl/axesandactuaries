import { prisma } from '../lib/prisma.js';

export interface PlayerProfileStats {
  adventuresCompleted: number;
  adventuresFailed: number;
  lifetimeGoldEarned: number;
  // Paid hires only — desperate-hire (free, hireCost 0) doesn't record a
  // 'hire_cost' transaction, so this undercounts free hires by design.
  adventurersHired: number;
}

export async function getPlayerProfileStats(playerId: string): Promise<PlayerProfileStats> {
  const [adventuresCompleted, adventuresFailed, goldEarned, adventurersHired] = await Promise.all([
    prisma.adventure.count({ where: { playerId, status: 'completed' } }),
    prisma.adventure.count({ where: { playerId, status: 'failed' } }),
    prisma.transaction.aggregate({
      where: { playerId, reason: 'contract_payment' },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { playerId, reason: 'hire_cost' } }),
  ]);

  return {
    adventuresCompleted,
    adventuresFailed,
    lifetimeGoldEarned: goldEarned._sum.amount ?? 0,
    adventurersHired,
  };
}
