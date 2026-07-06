import { Router } from 'express';
import { z } from 'zod';
import type { AdventureStatus } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { prisma } from '../lib/prisma.js';
import { resolveAdventure } from '../services/adventure.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/v1/admin/players
router.get('/players', async (_req, res) => {
  const players = await prisma.player.findMany({
    select: { id: true, username: true, guildName: true, gold: true, reputation: true },
    orderBy: { username: 'asc' },
  });
  res.json({ players });
});

const AdjustPlayerBody = z.object({
  gold: z.number().int().optional(),
  reputation: z.number().int().optional(),
});

// PATCH /api/v1/admin/players/:id
// Sets gold/reputation to absolute values (not increments). Gold changes are logged as a
// transaction (reason: admin_adjustment) so the ledger stays reconcilable; reputation has
// no transaction ledger to begin with, so it's just a raw update.
router.patch('/players/:id', async (req, res) => {
  const parsed = AdjustPlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { gold, reputation } = parsed.data;

  const existing = await prisma.player.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  const player = await prisma.$transaction(async (tx) => {
    const updated = await tx.player.update({
      where: { id: req.params.id },
      data: { gold, reputation },
    });

    if (gold !== undefined && gold !== existing.gold) {
      await tx.transaction.create({
        data: {
          playerId:    existing.id,
          amount:      gold - existing.gold,
          reason:      'admin_adjustment',
          description: `Admin set treasury to ${gold.toLocaleString()} gp`,
        },
      });
    }

    return updated;
  });

  res.json({ player });
});

// GET /api/v1/admin/adventures?status=in_progress
router.get('/adventures', async (req, res) => {
  const status = (typeof req.query.status === 'string' ? req.query.status : 'in_progress') as AdventureStatus;

  const adventures = await prisma.adventure.findMany({
    where: { status },
    include: {
      contract: { select: { title: true } },
      player:   { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ adventures });
});

const ForceResolveBody = z.object({ outcome: z.enum(['success', 'failure']) });

// POST /api/v1/admin/adventures/:id/resolve
// Immediately resolves an in-progress adventure with the given outcome, bypassing the
// completion timer and success-chance roll (injury/death/XP rolls still apply normally).
router.post('/adventures/:id/resolve', async (req, res) => {
  const parsed = ForceResolveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const adventure = await resolveAdventure(req.params.id, { forceOutcome: parsed.data.outcome });
  if (!adventure) {
    res.status(404).json({ error: 'Adventure not found' });
    return;
  }
  res.json({ adventure });
});

export default router;
