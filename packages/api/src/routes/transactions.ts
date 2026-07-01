import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// GET /api/v1/transactions
// Returns the player's transaction ledger, newest first.
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { playerId: req.playerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where: { playerId: req.playerId } }),
  ]);

  res.json({ transactions, total, limit, offset });
});

export default router;
