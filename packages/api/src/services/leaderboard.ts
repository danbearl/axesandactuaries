import { prisma } from '../lib/prisma.js';

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  guildName: string | null;
  score: number;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  me: LeaderboardEntry;
  nearby: LeaderboardEntry[];
}

const TOP_COUNT = 10;
const NEARBY_WINDOW = 5;

// Score = (10 * (Reputation + Avg. Adventurer Power) + Assets) * Contract Success %
// Assets = treasury gold + total invested (cost basis) in properties.
// Avg. Adventurer Power is averaged over the player's current, non-dead roster.
// Contract Success % is completed / (completed + failed) adventures, 0 with no history.
export async function getLeaderboard(viewingPlayerId: string): Promise<LeaderboardResult> {
  const [players, powerAgg, propertyAgg, adventureAgg] = await Promise.all([
    // Excludes players who haven't finished onboarding yet (no guildName) — nothing to rank.
    prisma.player.findMany({
      where: { guildName: { not: null } },
      select: { id: true, username: true, guildName: true, gold: true, reputation: true },
    }),
    prisma.adventurer.groupBy({
      by: ['employerId'],
      where: { employerId: { not: null }, status: { not: 'dead' } },
      _avg: { powerRating: true },
    }),
    prisma.property.groupBy({
      by: ['playerId'],
      _sum: { costBasis: true },
    }),
    prisma.adventure.groupBy({
      by: ['playerId', 'status'],
      where: { status: { in: ['completed', 'failed'] } },
      _count: true,
    }),
  ]);

  const avgPowerByPlayer = new Map(
    powerAgg.map((p) => [p.employerId as string, p._avg.powerRating ?? 0]),
  );
  const propertyValueByPlayer = new Map(
    propertyAgg.map((p) => [p.playerId, p._sum.costBasis ?? 0]),
  );

  const adventureCounts = new Map<string, { completed: number; failed: number }>();
  for (const row of adventureAgg) {
    const counts = adventureCounts.get(row.playerId) ?? { completed: 0, failed: 0 };
    if (row.status === 'completed') counts.completed += row._count;
    else if (row.status === 'failed') counts.failed += row._count;
    adventureCounts.set(row.playerId, counts);
  }

  const scored: LeaderboardEntry[] = players.map((p) => {
    const avgPower = avgPowerByPlayer.get(p.id) ?? 0;
    const assets = p.gold + (propertyValueByPlayer.get(p.id) ?? 0);
    const { completed, failed } = adventureCounts.get(p.id) ?? { completed: 0, failed: 0 };
    const total = completed + failed;
    const successRate = total > 0 ? completed / total : 0;
    const score = (10 * (p.reputation + avgPower) + assets) * successRate;

    return {
      rank:      0, // assigned after sorting
      playerId:  p.id,
      username:  p.username,
      guildName: p.guildName,
      score:     Math.round(score),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((entry, i) => { entry.rank = i + 1; });

  const top = scored.slice(0, TOP_COUNT);
  const meIndex = scored.findIndex((e) => e.playerId === viewingPlayerId);
  const me = scored[meIndex];

  const nearby = me.rank > TOP_COUNT
    ? scored.slice(
        Math.max(0, meIndex - NEARBY_WINDOW),
        Math.min(scored.length, meIndex + NEARBY_WINDOW + 1),
      )
    : [];

  return { top, me, nearby };
}
