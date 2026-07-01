import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { resolveAdventure } from '../services/adventure.js';

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

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.awardedTo !== req.playerId || contract.status !== 'awarded') {
    res.status(400).json({ error: 'Contract is not awarded to you or is not in awarded status' });
    return;
  }

  const adventurers = await prisma.adventurer.findMany({
    where: { id: { in: adventurerIds }, employerId: req.playerId, status: 'hired' },
  });
  if (adventurers.length !== adventurerIds.length) {
    res.status(400).json({ error: 'One or more adventurers are unavailable or not in your employ' });
    return;
  }

  const completesAt = new Date(Date.now() + contract.durationHours * 60 * 60 * 1000);

  const adventure = await prisma.$transaction(async (tx) => {
    const a = await tx.adventure.create({
      data: {
        contractId,
        playerId: req.playerId,
        startsAt: new Date(),
        completesAt,
        adventurers: {
          create: adventurerIds.map((aid) => ({ adventurerId: aid })),
        },
      },
      include: { contract: true, adventurers: { include: { adventurer: true } } },
    });

    await tx.adventurer.updateMany({
      where: { id: { in: adventurerIds } },
      data: { status: 'on_adventure' },
    });

    await tx.contract.update({
      where: { id: contractId },
      data: { status: 'in_progress' },
    });

    return a;
  });

  res.status(201).json({ adventure });
});

export default router;
