import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getLeaderboard } from '../src/services/leaderboard.js';
import { createPlayer, createAdventurer, createContract } from './fixtures.js';

async function createResolvedAdventure(playerId: string, contractId: string, status: 'completed' | 'failed') {
  return prisma.adventure.create({
    data: {
      contractId,
      playerId,
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      completesAt: new Date(Date.now() - 1000),
      status,
      resolvedAt: new Date(),
    },
  });
}

describe('getLeaderboard', () => {
  it('computes score from reputation, avg. adventurer power, assets, and success rate', async () => {
    const player = await createPlayer({ gold: 500, reputation: 100, guildName: 'The Ashen Compact' });
    await createAdventurer({ employerId: player.id, status: 'hired', powerRating: 50 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'dormitory', maintenanceCostDaily: 15, bonus: {}, costBasis: 200 },
    });
    const contract = await createContract({ status: 'available' });
    await createResolvedAdventure(player.id, contract.id, 'completed');
    await createResolvedAdventure(player.id, contract.id, 'completed');
    await createResolvedAdventure(player.id, contract.id, 'completed');
    await createResolvedAdventure(player.id, contract.id, 'failed');

    const { top, me } = await getLeaderboard(player.id);

    // score = (10 * (100 + 50) + (500 + 200)) * (3/4) = (1500 + 700) * 0.75 = 1650
    expect(me.score).toBe(1650);
    expect(me.rank).toBe(1);
    expect(top).toHaveLength(1);
    expect(top[0].playerId).toBe(player.id);
  });

  it('treats players with no adventure history as a 0% success rate', async () => {
    const player = await createPlayer({ gold: 500, reputation: 100, guildName: 'New Guild' });

    const { me } = await getLeaderboard(player.id);
    expect(me.score).toBe(0);
  });

  it('excludes players who have not finished onboarding (no guildName)', async () => {
    const viewer = await createPlayer({ guildName: 'Viewer Guild' });
    await createPlayer({ guildName: null, reputation: 99999 }); // would otherwise dominate the board

    const { top } = await getLeaderboard(viewer.id);
    expect(top.every((e) => e.playerId !== undefined)).toBe(true);
    expect(top).toHaveLength(1);
    expect(top[0].playerId).toBe(viewer.id);
  });

  it('omits the nearby window when the viewer is already in the top 10', async () => {
    const players = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPlayer({ guildName: `Guild ${i}`, reputation: i * 10 })),
    );

    const { nearby } = await getLeaderboard(players[0].id);
    expect(nearby).toHaveLength(0);
  });

  it('returns a +/-5 window around the viewer when ranked below the top 10', async () => {
    const contract = await createContract({ status: 'available' });
    // 15 players with strictly descending reputation, each with one completed adventure
    // (a 0% success rate would zero out every score and make ranking indeterminate).
    const players = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createPlayer({ guildName: `Guild ${i}`, reputation: (15 - i) * 10 })),
    );
    await Promise.all(players.map((p) => createResolvedAdventure(p.id, contract.id, 'completed')));
    const last = players[players.length - 1]; // lowest reputation -> lowest score -> rank 15

    const { me, nearby } = await getLeaderboard(last.id);
    expect(me.rank).toBe(15);
    // Window is rank 10..15 (5 above, clamped at the end of the list).
    expect(nearby).toHaveLength(6);
    expect(nearby[0].rank).toBe(10);
    expect(nearby[nearby.length - 1].rank).toBe(15);
  });
});
