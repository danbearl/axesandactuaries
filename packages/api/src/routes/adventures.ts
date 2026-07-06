import { Router } from 'express';
import { z } from 'zod';
import type { AdventureStatus } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { resolveAdventure, startAdventure } from '../services/adventure.js';
import { ClaimConflictError } from '../lib/errors.js';

const router = Router();

const StartAdventureBody = z.object({
  contractId: z.string(),
  adventurerIds: z.array(z.string()).min(1).max(6),
});

// GET /api/v1/adventures
router.get('/', requireAuth, async (req, res) => {
  const adventures = await prisma.adventure.findMany({
    where: { playerId: req.playerId },
    include: { contract: true, adventurers: { include: { adventurer: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Inline-resolve any overdue adventures
  const resolved = await Promise.all(
    adventures.map((a) => (a.status === 'in_progress' && a.completesAt <= new Date()
      ? resolveAdventure(a.id)
      : Promise.resolve(a)
    ))
  );

  res.json({ adventures: resolved });
});

// GET /api/v1/adventures/history?limit=&offset=
// Paginated log of resolved (completed or failed) adventures, most recent first.
// Declared before /:id so Express doesn't treat "history" as an :id value.
router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = { playerId: req.playerId, status: { in: ['completed', 'failed'] as AdventureStatus[] } };

  const [adventures, total] = await Promise.all([
    prisma.adventure.findMany({
      where,
      include: { contract: true, adventurers: { include: { adventurer: true } } },
      orderBy: { resolvedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.adventure.count({ where }),
  ]);

  res.json({ adventures, total, limit, offset });
});

// GET /api/v1/adventures/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const adventure = await prisma.adventure.findUnique({
    where: { id },
    include: { contract: true, adventurers: { include: { adventurer: true } } },
  });

  if (!adventure || adventure.playerId !== req.playerId) {
    res.status(404).json({ error: 'Adventure not found' });
    return;
  }

  const result = adventure.status === 'in_progress' && adventure.completesAt <= new Date()
    ? await resolveAdventure(id)
    : adventure;

  res.json({ adventure: result });
});

// POST /api/v1/adventures
// Start an adventure: assign adventurers to an awarded contract.
router.post('/', requireAuth, async (req, res) => {
  const parsed = StartAdventureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { contractId, adventurerIds } = parsed.data;

  try {
    const adventure = await startAdventure(req.playerId, contractId, adventurerIds);
    res.status(201).json({ adventure });
  } catch (err) {
    if (err instanceof ClaimConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
