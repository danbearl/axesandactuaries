import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { generateAdventurer, HIRE_REPUTATION_REQUIREMENTS, computeHireCost, computeDailyWage } from '@adventurer-manager/types';
import { getBootstrapStatus } from '../services/bootstrap.js';

const router = Router();

// GET /api/v1/adventurers/market
// Returns adventurers available for hire (not yet assigned to any employer, pool not expired).
router.get('/market', requireAuth, async (req, res) => {
  const adventurers = await prisma.adventurer.findMany({
    where: {
      status: 'available',
      employerId: null,
      OR: [{ poolExpiresAt: null }, { poolExpiresAt: { gt: new Date() } }],
    },
    orderBy: [{ powerRating: 'desc' }, { createdAt: 'asc' }],
  });
  res.json({ adventurers });
});

// POST /api/v1/adventurers/:id/hire
// Hire an available adventurer. Deducts hire_cost from player gold.
router.post('/:id/hire', requireAuth, async (req, res) => {
  const { id } = req.params;

  const adventurer = await prisma.adventurer.findUnique({ where: { id } });
  if (!adventurer) {
    res.status(404).json({ error: 'Adventurer not found' });
    return;
  }
  if (adventurer.status !== 'available' || adventurer.employerId !== null) {
    res.status(409).json({ error: 'Adventurer is not available for hire' });
    return;
  }

  const player = await prisma.player.findUniqueOrThrow({ where: { id: req.playerId } });
  if (player.gold < adventurer.hireCost) {
    res.status(400).json({ error: 'Insufficient gold', required: adventurer.hireCost, available: player.gold });
    return;
  }

  const repRequired = HIRE_REPUTATION_REQUIREMENTS[adventurer.level] ?? 0;
  if (player.reputation < repRequired) {
    res.status(403).json({ error: `Requires ${repRequired} reputation to hire a level ${adventurer.level} adventurer`, required: repRequired, current: player.reputation });
    return;
  }

  // Atomic claim: UPDATE WHERE status='available' guards against two players racing for the same adventurer.
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.adventurer.updateMany({
      where: { id, status: 'available', employerId: null },
      data: { status: 'hired', employerId: req.playerId },
    });
    if (claimed.count === 0) return null; // adventurer was taken by another player

    const [updatedPlayer, updatedAdventurer] = await Promise.all([
      tx.player.update({ where: { id: req.playerId }, data: { gold: { decrement: adventurer.hireCost } } }),
      tx.adventurer.findUniqueOrThrow({ where: { id } }),
    ]);
    await tx.transaction.create({
      data: {
        playerId:    req.playerId,
        amount:      -adventurer.hireCost,
        reason:      'hire_cost',
        description: `Hired ${adventurer.name} (${adventurer.vocation}, Lv.${adventurer.level})`,
        referenceId: adventurer.id,
      },
    });
    return { updatedPlayer, updatedAdventurer };
  });

  if (!result) {
    res.status(409).json({ error: 'Adventurer was hired by another player' });
    return;
  }
  res.json({ player: result.updatedPlayer, adventurer: result.updatedAdventurer });
});

// POST /api/v1/adventurers/desperate-hire
// When a player has no adventurers, no properties, and can't afford the market,
// hire a free adventurer with minimum loyalty who's willing to work for nothing upfront.
router.post('/desperate-hire', requireAuth, async (req, res) => {
  const status = await getBootstrapStatus(req.playerId);
  if (!status.desperateHireAvailable) {
    res.status(403).json({ error: 'Desperate hire is not available — you must have no adventurers, no properties, and insufficient gold to hire from the market' });
    return;
  }

  const a = generateAdventurer();
  // Override: free hire, minimum loyalty so they leave quickly if neglected
  const personality = { ...(a.personality as unknown as Record<string, number>), loyalty: 1 };

  const adventurer = await prisma.adventurer.create({
    data: {
      name:         a.name,
      heritage:     a.heritage,
      vocation:     a.vocation,
      gender:       a.gender,
      level:        1,
      experience:   0,
      powerRating:  a.powerRating,
      stats:        a.stats       as object,
      personality:  personality   as object,
      hireCost:     0,
      dailyWage:    a.dailyWage,
      status:       'hired',
      employerId:   req.playerId,
      height:       a.height,
      build:        a.build,
      complexion:   a.complexion,
      hairColor:    a.hairColor,
      eyeColor:     a.eyeColor,
    },
  });

  console.log(`[bootstrap] ${req.playerId} used desperate hire — ${adventurer.name} joins for free`);
  res.status(201).json({ adventurer });
});

// POST /api/v1/adventurers/:id/fire
// Release a hired adventurer back to the market.
router.post('/:id/fire', requireAuth, async (req, res) => {
  const { id } = req.params;

  const adventurer = await prisma.adventurer.findUnique({ where: { id } });
  if (!adventurer) {
    res.status(404).json({ error: 'Adventurer not found' });
    return;
  }
  if (adventurer.employerId !== req.playerId) {
    res.status(403).json({ error: 'This adventurer is not in your employ' });
    return;
  }
  if (adventurer.status === 'on_adventure') {
    res.status(409).json({ error: 'Cannot fire an adventurer who is on an active adventure' });
    return;
  }

  const player = await prisma.player.findUniqueOrThrow({ where: { id: req.playerId } });

  // Pay as much of the outstanding back wages as the treasury allows.
  // Gold is floored at zero — the employer eats any shortfall.
  const severancePaid = Math.min(adventurer.wagesOwed, player.gold);

  const updatedAdventurer = await prisma.$transaction(async (tx) => {
    const released = await tx.adventurer.update({
      where: { id },
      data: {
        status:         'available',
        employerId:     null,
        poolExpiresAt:  new Date(Date.now() + 48 * 60 * 60 * 1000),
        wagesOwed:      0,
        daysUnpaid:     0,
        loyaltyPenalty: 0,
        hireCost:       computeHireCost(adventurer.powerRating),
        dailyWage:      computeDailyWage(adventurer.powerRating),
      },
    });

    if (severancePaid > 0) {
      await tx.player.update({
        where: { id: req.playerId },
        data:  { gold: { decrement: severancePaid } },
      });
      await tx.transaction.create({
        data: {
          playerId:    req.playerId,
          amount:      -severancePaid,
          reason:      'wage',
          description: `Severance: back wages paid to ${adventurer.name} on release`,
          referenceId: adventurer.id,
        },
      });
    }

    return released;
  });

  res.json({ adventurer: updatedAdventurer });
});

export default router;
