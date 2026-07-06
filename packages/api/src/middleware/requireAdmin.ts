import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

// Must run after requireAuth — relies on req.playerId already being set.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const player = await prisma.player.findUnique({
    where: { id: req.playerId },
    select: { isAdmin: true },
  });
  if (!player?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
