import { prisma } from '../lib/prisma.js';
import { publish, CHANNELS } from '../lib/redis.js';
import type { PlayerEventType } from '@axes-actuaries/types';

export interface LogPlayerEventInput {
  playerId:     string;
  type:         PlayerEventType;
  summary:      string;
  referenceId?: string | null;
}

// The one call every new event type needs: one enum value (schema.prisma + the matching
// packages/types union, together) plus one call here. The DB write is real and can throw (a
// genuine failure the caller should see); the SSE publish is best-effort and — like every
// other publish() call in this codebase — fire-and-forget, not awaited. This isn't just
// style: ioredis's default reconnect/offline-queue behavior can leave a queued command
// pending far longer than a caller should ever block on (confirmed in CI, which has no Redis
// service at all — an awaited publish() here made every direct caller, including this
// function's own tests, hang until vitest's timeout).
export async function logPlayerEvent(input: LogPlayerEventInput): Promise<void> {
  const event = await prisma.playerEvent.create({
    data: {
      playerId:    input.playerId,
      type:        input.type,
      summary:     input.summary,
      referenceId: input.referenceId ?? null,
    },
  });

  publish(CHANNELS.player(input.playerId), 'player_event', {
    id:          event.id,
    type:        event.type,
    summary:     event.summary,
    referenceId: event.referenceId,
    createdAt:   event.createdAt,
  }).catch(() => { /* non-fatal if Redis is unavailable */ });
}

export interface ListPlayerEventsOptions {
  limit:  number;
  offset: number;
  type?:  PlayerEventType;
}

export interface ListPlayerEventsResult {
  events: Awaited<ReturnType<typeof prisma.playerEvent.findMany>>;
  total:  number;
}

// Paginated, newest-first, optionally narrowed to a single type — powers the Feed page and
// the Dashboard "Recent Events" widget (see routes/feed.ts, a thin wrapper over this).
export async function listPlayerEvents(
  playerId: string,
  { limit, offset, type }: ListPlayerEventsOptions,
): Promise<ListPlayerEventsResult> {
  const where = { playerId, ...(type ? { type } : {}) };

  const [events, total] = await Promise.all([
    prisma.playerEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    limit,
      skip:    offset,
    }),
    prisma.playerEvent.count({ where }),
  ]);

  return { events, total };
}
