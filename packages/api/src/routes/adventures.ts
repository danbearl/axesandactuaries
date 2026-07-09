import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { resolveAdventure, startAdventure } from '../services/adventure.js';
import { ClaimConflictError } from '../lib/errors.js';
import { zodErrorMessage } from '../lib/zodError.js';

const router = Router();

const StartAdventureBody = z.object({
  contractId: z.string(),
  adventurerIds: z.array(z.string())
    .min(1, 'Select at least one adventurer')
    .max(6, 'You can deploy at most 6 adventurers on a single contract'),
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
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
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
