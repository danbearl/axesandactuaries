import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listPlayerEvents } from '../services/playerEvents.js';
import type { PlayerEventType } from '@prisma/client';

const router = Router();

const VALID_TYPES: PlayerEventType[] = [
  'contract_completed',
  'contract_failed',
  'adventurer_quit',
  'adventurer_recovered',
  'adventurer_rest_complete',
];

// GET /api/v1/feed?limit=&offset=&type=
// Paginated log of this player's guild events, most recent first. Optional `type` narrows to
// a single event type (e.g. "show me all contract completions").
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  let type: PlayerEventType | undefined;
  if (typeof req.query.type === 'string' && req.query.type !== 'all') {
    if (!VALID_TYPES.includes(req.query.type as PlayerEventType)) {
      res.status(400).json({ error: 'Invalid event type' });
      return;
    }
    type = req.query.type as PlayerEventType;
  }

  const { events, total } = await listPlayerEvents(req.playerId, { limit, offset, type });

  res.json({ events, total, limit, offset });
});

export default router;
