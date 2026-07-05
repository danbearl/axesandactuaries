import { prisma } from '../lib/prisma.js';

export interface AdventurerHistoryEntry {
  adventureId: string;
  contractTitle: string;
  contractTier: string;
  status: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface AdventurerHistory {
  stats: {
    totalAdventures: number;
    completed: number;
    failed: number;
  };
  recent: AdventurerHistoryEntry[];
}

const RECENT_LIMIT = 20;

export async function getAdventurerHistory(adventurerId: string): Promise<AdventurerHistory> {
  const [totalAdventures, completed, failed, recentLinks] = await Promise.all([
    prisma.adventureAdventurer.count({ where: { adventurerId } }),
    prisma.adventureAdventurer.count({ where: { adventurerId, adventure: { status: 'completed' } } }),
    prisma.adventureAdventurer.count({ where: { adventurerId, adventure: { status: 'failed' } } }),
    prisma.adventureAdventurer.findMany({
      where: { adventurerId },
      include: { adventure: { include: { contract: true } } },
      orderBy: { adventure: { createdAt: 'desc' } },
      take: RECENT_LIMIT,
    }),
  ]);

  const recent: AdventurerHistoryEntry[] = recentLinks.map((link) => ({
    adventureId:   link.adventure.id,
    contractTitle: link.adventure.contract.title,
    contractTier:  link.adventure.contract.tier,
    status:        link.adventure.status,
    resolvedAt:    link.adventure.resolvedAt,
    createdAt:     link.adventure.createdAt,
  }));

  return {
    stats: { totalAdventures, completed, failed },
    recent,
  };
}
