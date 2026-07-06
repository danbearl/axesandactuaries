import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { getPlayerProfileStats } from '../services/profile.js';

const router = Router();

// Letters, numbers, spaces, and a handful of common punctuation — permissive enough for
// real names/guild themes, but blocks anything that would look broken in the UI.
const NAME_PATTERN = /^[\w'\- ]+$/;

const OnboardingBody = z.object({
  username: z.string().min(2).max(40).regex(NAME_PATTERN),
  guildName: z.string().min(2).max(60).regex(NAME_PATTERN),
});

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

// GET /api/v1/player/profile
// Identity + lifetime/career stats, distinct from /me's live operational state.
router.get('/profile', requireAuth, async (req, res) => {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: req.playerId },
  });

  const stats = await getPlayerProfileStats(req.playerId);

  res.json({ player, stats });
});

// PATCH /api/v1/player/onboarding
// Sets the player's chosen handle and guild name. Presence of `guildName` is what the
// frontend treats as "onboarding complete" — see App.tsx.
router.patch('/onboarding', requireAuth, async (req, res) => {
  const parsed = OnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { username, guildName } = parsed.data;

  const taken = await prisma.player.findUnique({ where: { username } });
  if (taken && taken.id !== req.playerId) {
    res.status(409).json({ error: 'That handle is already taken' });
    return;
  }

  const player = await prisma.player.update({
    where: { id: req.playerId },
    data: { username, guildName },
  });
  res.json({ player });
});

export default router;
