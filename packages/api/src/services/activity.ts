import { prisma } from '../lib/prisma.js';

const ACTIVE_WINDOW_DAYS = 7;

// A player counts as "active" if they took a deliberate, engaged action in the last week —
// not just having an account. Shared by workers/dailyReset.ts (adventurer pool sizing) and
// services/marketSeeding.ts (contract market sizing) so both scale off the same definition
// of the guild's actual current population instead of a number tuned once and left fixed
// regardless of how many people are actually playing.
export async function getActivePlayerCount(now = new Date()): Promise<number> {
  const windowStart = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.player.count({
    where: {
      OR: [
        // Deliberate hire / build / sell actions in the window
        {
          transactions: {
            some: {
              createdAt: { gte: windowStart },
              reason: { in: ['hire_cost', 'property_build', 'property_sell'] },
            },
          },
        },
        // Or sent a party on at least one adventure in the window
        { adventures: { some: { createdAt: { gte: windowStart } } } },
      ],
    },
  });
}
