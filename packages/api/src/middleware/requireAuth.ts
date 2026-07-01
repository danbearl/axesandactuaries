import { getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

declare global {
  namespace Express {
    interface Request {
      playerId: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const player = await prisma.player.findUnique({ where: { clerkUserId: userId } });
  if (!player) {
    res.status(403).json({ error: 'Player account not found. Call POST /api/v1/auth/sync first.' });
    return;
  }

  req.playerId = player.id;
  next();
}
