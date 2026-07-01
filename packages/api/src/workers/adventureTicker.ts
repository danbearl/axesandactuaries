import { prisma } from '../lib/prisma.js';
import { resolveAdventure } from '../services/adventure.js';

// Runs every minute. Finds overdue in-progress adventures and resolves them.
export async function runAdventureTicker(): Promise<void> {
  const overdue = await prisma.adventure.findMany({
    where: { status: 'in_progress', completesAt: { lte: new Date() } },
    select: { id: true },
  });

  if (overdue.length === 0) return;

  console.log(`[adventure-ticker] Resolving ${overdue.length} overdue adventure(s)`);

  await Promise.allSettled(
    overdue.map(({ id }) =>
      resolveAdventure(id).catch((err) =>
        console.error(`[adventure-ticker] Failed to resolve adventure ${id}:`, err),
      ),
    ),
  );
}
