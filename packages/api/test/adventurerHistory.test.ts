import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getAdventurerHistory } from '../src/services/adventurerHistory.js';
import { createPlayer, createAdventurer, createContract } from './fixtures.js';

async function linkAdventure(playerId: string, adventurerId: string, status: string) {
  const contract = await createContract();
  const adventure = await prisma.adventure.create({
    data: { contractId: contract.id, playerId, startsAt: new Date(), completesAt: new Date(), status },
  });
  await prisma.adventureAdventurer.create({
    data: { adventureId: adventure.id, adventurerId },
  });
  return { contract, adventure };
}

describe('getAdventurerHistory', () => {
  it('returns zeroed stats and empty history for an adventurer with no adventures', async () => {
    const adventurer = await createAdventurer();
    const history = await getAdventurerHistory(adventurer.id);
    expect(history.stats).toEqual({ totalAdventures: 0, completed: 0, failed: 0 });
    expect(history.recent).toEqual([]);
  });

  it('counts completed/failed adventures and returns recent history entries', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({ employerId: player.id });

    const { contract: c1 } = await linkAdventure(player.id, adventurer.id, 'completed');
    await linkAdventure(player.id, adventurer.id, 'failed');
    await linkAdventure(player.id, adventurer.id, 'in_progress');

    const history = await getAdventurerHistory(adventurer.id);
    expect(history.stats).toEqual({ totalAdventures: 3, completed: 1, failed: 1 });
    expect(history.recent).toHaveLength(3);
    expect(history.recent.map((r) => r.contractTitle)).toContain(c1.title);
  });

  it('only counts a given adventurer\'s own participation, not another adventurer\'s', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({ employerId: player.id });
    const other = await createAdventurer({ employerId: player.id });

    await linkAdventure(player.id, other.id, 'completed');

    const history = await getAdventurerHistory(adventurer.id);
    expect(history.stats).toEqual({ totalAdventures: 0, completed: 0, failed: 0 });
  });
});
