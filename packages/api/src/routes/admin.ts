import { Router } from 'express';
import { z } from 'zod';
import type { AdventureStatus } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { prisma } from '../lib/prisma.js';
import { resolveAdventure } from '../services/adventure.js';
import { seedAdventurers, seedContracts, replenishBiddingMarket } from '../services/marketSeeding.js';
import { zodErrorMessage } from '../lib/zodError.js';

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
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
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

// GET /api/v1/admin/players/:id/adventurers
// A player's full roster (any status) — for picking who to reset in the clear-status tool.
router.get('/players/:id/adventurers', async (req, res) => {
  const adventurers = await prisma.adventurer.findMany({
    where: { employerId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ adventurers });
});

// POST /api/v1/admin/adventurers/:id/clear-status
// Testing convenience: forces an adventurer out of injured/resting/dead back to a clean
// working state, bypassing the normal recovery timers and (for dead) permanence entirely.
router.post('/adventurers/:id/clear-status', async (req, res) => {
  const adventurer = await prisma.adventurer.findUnique({ where: { id: req.params.id } });
  if (!adventurer) {
    res.status(404).json({ error: 'Adventurer not found' });
    return;
  }

  const updated = await prisma.adventurer.update({
    where: { id: req.params.id },
    data: {
      status:              adventurer.employerId ? 'hired' : 'available',
      injuryRecoveryUntil: null,
      restUntil:           null,
      wagesOwed:           0,
      daysUnpaid:          0,
      loyaltyPenalty:      0,
      poolExpiresAt:       adventurer.employerId ? adventurer.poolExpiresAt : new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });

  res.json({ adventurer: updated });
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
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const adventure = await resolveAdventure(req.params.id, { forceOutcome: parsed.data.outcome });
  if (!adventure) {
    res.status(404).json({ error: 'Adventure not found' });
    return;
  }
  res.json({ adventure });
});

const SeedAdventurersBody = z.object({ count: z.number().int().min(1).max(100) });

// POST /api/v1/admin/adventurers/seed
// Adds new available adventurers to the market without touching anything already there —
// unlike `pnpm db:seed`, which wipes the available pool first and is meant for a fresh
// dev/local database, not topping up a live one.
router.post('/adventurers/seed', async (req, res) => {
  const parsed = SeedAdventurersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const added = await seedAdventurers(parsed.data.count);
  res.json({ added });
});

// POST /api/v1/admin/contracts/seed
// Adds one daily batch of errand/standard contracts, and tops up dangerous/legendary up to
// their standing target if under (see BIDDING_MARKET_TARGET) — without touching anything
// already on the market.
router.post('/contracts/seed', async (_req, res) => {
  const [dailyAdded, biddingAdded] = await Promise.all([
    seedContracts(),
    replenishBiddingMarket(),
  ]);
  res.json({ added: dailyAdded + biddingAdded });
});

export default router;
