import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { sseHub } from '../lib/sse.js';

const router = Router();

// Was previously hand-rolling its own getAuth() check instead of using
// requireAuth like every other route — that inconsistency hid a bug where
// connections were keyed by the raw Clerk userId, but every publisher
// (services/adventure.ts, workers/dailyReset.ts, workers/marketGC.ts)
// publishes to `player:{internal player.id}`. The two never matched, so
// per-player events were silently never delivered over SSE.
router.get('/', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(': connected\n\n');

  sseHub.add(req.playerId, res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseHub.remove(req.playerId, res);
  });
});

export default router;
