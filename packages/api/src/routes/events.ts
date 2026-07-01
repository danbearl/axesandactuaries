import { Router } from 'express';
import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { sseHub } from '../lib/sse.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(': connected\n\n');

  sseHub.add(userId, res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseHub.remove(userId, res);
  });
});

export default router;
