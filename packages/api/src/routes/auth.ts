import { Router } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const router = Router();

const SyncBody = z.object({
  username: z.string().min(2).max(40).optional(),
});

// POST /api/v1/auth/sync
// Creates or returns the player record for the authenticated Clerk user.
router.post('/sync', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = SyncBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.player.findUnique({ where: { clerkUserId: userId } });
  if (existing) {
    res.json({ player: existing });
    return;
  }

  // Derive a username from Clerk user data if not provided
  let username = parsed.data.username;
  if (!username) {
    const clerkUser = await clerkClient.users.getUser(userId);
    const base =
      clerkUser.username ??
      clerkUser.firstName ??
      clerkUser.emailAddresses[0]?.emailAddress.split('@')[0] ??
      'Adventurer';
    // Ensure uniqueness by appending a short suffix
    const suffix = Math.floor(Math.random() * 9000) + 1000;
    username = `${base}${suffix}`;
  }

  // Guarantee uniqueness in the unlikely collision case
  const taken = await prisma.player.findUnique({ where: { username } });
  if (taken) {
    username = `${username}${Math.floor(Math.random() * 900) + 100}`;
  }

  try {
    const player = await prisma.$transaction(async (tx) => {
      const p = await tx.player.create({
        data: { clerkUserId: userId, username, gold: 500, reputation: 0 },
      });
      await tx.transaction.create({
        data: {
          playerId: p.id,
          amount: 500,
          reason: 'starting_gold',
          description: 'Initial guild charter funds',
        },
      });
      return p;
    });
    res.status(201).json({ player });
  } catch (e: unknown) {
    // P2002 = unique constraint violation — a concurrent request (e.g. React StrictMode
    // double-firing effects) already created the player. Return the existing record.
    if ((e as { code?: string })?.code === 'P2002') {
      const player = await prisma.player.findUnique({ where: { clerkUserId: userId } });
      res.json({ player });
    } else {
      throw e;
    }
  }
});

export default router;
