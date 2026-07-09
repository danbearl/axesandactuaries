import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { logPlayerEvent, listPlayerEvents } from '../src/services/playerEvents.js';
import { createPlayer } from './fixtures.js';

describe('logPlayerEvent', () => {
  it('creates a PlayerEvent row with the given fields', async () => {
    const player = await createPlayer();

    await logPlayerEvent({
      playerId:    player.id,
      type:        'contract_completed',
      summary:     'Completed: Clear the Millbrook Road',
      referenceId: 'adventure-1',
    });

    const event = await prisma.playerEvent.findFirstOrThrow({ where: { playerId: player.id } });
    expect(event.type).toBe('contract_completed');
    expect(event.summary).toBe('Completed: Clear the Millbrook Road');
    expect(event.referenceId).toBe('adventure-1');
  });

  it('defaults referenceId to null when omitted', async () => {
    const player = await createPlayer();

    await logPlayerEvent({ playerId: player.id, type: 'adventurer_quit', summary: 'Someone left.' });

    const event = await prisma.playerEvent.findFirstOrThrow({ where: { playerId: player.id } });
    expect(event.referenceId).toBeNull();
  });
});

describe('listPlayerEvents', () => {
  it('returns only the given player\'s events, newest first', async () => {
    const player = await createPlayer();
    const other = await createPlayer();

    await logPlayerEvent({ playerId: other.id, type: 'adventurer_quit', summary: 'Not mine.' });
    await logPlayerEvent({ playerId: player.id, type: 'contract_completed', summary: 'First.' });
    await logPlayerEvent({ playerId: player.id, type: 'contract_failed', summary: 'Second.' });

    const { events, total } = await listPlayerEvents(player.id, { limit: 20, offset: 0 });

    expect(total).toBe(2);
    expect(events.map(e => e.summary)).toEqual(['Second.', 'First.']);
  });

  it('narrows to a single type when given', async () => {
    const player = await createPlayer();
    await logPlayerEvent({ playerId: player.id, type: 'contract_completed', summary: 'A' });
    await logPlayerEvent({ playerId: player.id, type: 'adventurer_quit', summary: 'B' });

    const { events, total } = await listPlayerEvents(player.id, { limit: 20, offset: 0, type: 'contract_completed' });

    expect(total).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('A');
  });

  it('paginates via limit/offset', async () => {
    const player = await createPlayer();
    for (let i = 0; i < 5; i++) {
      await logPlayerEvent({ playerId: player.id, type: 'contract_completed', summary: `Event ${i}` });
    }

    const page1 = await listPlayerEvents(player.id, { limit: 2, offset: 0 });
    const page2 = await listPlayerEvents(player.id, { limit: 2, offset: 2 });

    expect(page1.total).toBe(5);
    expect(page1.events).toHaveLength(2);
    expect(page2.events).toHaveLength(2);
    expect(page1.events[0].id).not.toBe(page2.events[0].id);
  });
});
