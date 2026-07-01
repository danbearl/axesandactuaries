import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// GET /api/v1/player/me
// Returns full player state in one call: player info, properties, hired adventurers, active adventures.
router.get('/me', requireAuth, async (req, res) => {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: req.playerId },
  });

  const [adventurers, properties, adventures] = await Promise.all([
    prisma.adventurer.findMany({
      where: { employerId: req.playerId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.property.findMany({
      where: { playerId: req.playerId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.adventure.findMany({
      where: { playerId: req.playerId, status: 'in_progress' },
      include: {
        contract: true,
        adventurers: { include: { adventurer: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({ player, adventurers, properties, adventures });
});

export default router;
