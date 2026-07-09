import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { HIRE_REPUTATION_REQUIREMENTS, computeHireCost, computeDailyWage, computeRosterCap } from '@axes-actuaries/types';
import { getBootstrapStatus, claimDesperateHire } from '../services/bootstrap.js';
import { getAdventurerHistory } from '../services/adventurerHistory.js';
import { upgradeGear } from '../services/adventurerGear.js';
import { ClaimConflictError } from '../lib/errors.js';
import { publish, CHANNELS } from '../lib/redis.js';

const router = Router();

// GET /api/v1/adventurers/market
// Returns adventurers available for hire (not yet assigned to any employer, pool not expired).
// Must be declared before /:id so Express doesn't capture "market" as an id.
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

// GET /api/v1/adventurers/:id
// Adventurer detail + contract-participation history/stats. Only the employer
// can view it — no player directory/other-player visibility exists yet.
router.get('/:id', requireAuth, async (req, res) => {
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

  const history = await getAdventurerHistory(id);

  // Affinity list: every other adventurer this one has ever adventured with, regardless of
  // whether that adventurer is still employed (or even still alive) — see COHESION_* in
  // @axes-actuaries/types. Sorted strongest-bond first.
  const [cohesionAsLow, cohesionAsHigh] = await Promise.all([
    prisma.adventurerCohesion.findMany({
      where: { adventurerLowId: id },
      include: { adventurerHigh: { select: { id: true, name: true, vocation: true, level: true, status: true } } },
    }),
    prisma.adventurerCohesion.findMany({
      where: { adventurerHighId: id },
      include: { adventurerLow: { select: { id: true, name: true, vocation: true, level: true, status: true } } },
    }),
  ]);
  const affinities = [
    ...cohesionAsLow.map((c) => ({ adventurer: c.adventurerHigh, cohesion: c.cohesion })),
    ...cohesionAsHigh.map((c) => ({ adventurer: c.adventurerLow, cohesion: c.cohesion })),
  ].sort((a, b) => b.cohesion - a.cohesion);

  res.json({ adventurer, ...history, affinities });
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
  // A requirement of 0 means "no gate" — it must never block a player, even one who has
  // gone into negative reputation (a legitimate state, not a hard floor).
  if (repRequired > 0 && player.reputation < repRequired) {
    res.status(403).json({ error: `Requires ${repRequired} reputation to hire a level ${adventurer.level} adventurer`, required: repRequired, current: player.reputation });
    return;
  }

  const [dormitory, rosterCount] = await Promise.all([
    prisma.property.findFirst({ where: { playerId: req.playerId, type: 'dormitory' } }),
    // A dead adventurer still occupies a roster slot until the employer releases them —
    // it doesn't just vanish, so it shouldn't be free real estate either.
    prisma.adventurer.count({ where: { employerId: req.playerId } }),
  ]);
  const rosterCap = computeRosterCap(dormitory?.level ?? 0);
  if (rosterCount >= rosterCap) {
    res.status(403).json({
      error: `Roster is full (${rosterCount}/${rosterCap}). Build or upgrade a dormitory to hire more.`,
      rosterCount,
      rosterCap,
    });
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

  publish(CHANNELS.market, 'market_update', { type: 'hire', adventurerId: id })
    .catch(() => { /* non-fatal if Redis is unavailable */ });

  res.json({ player: result.updatedPlayer, adventurer: result.updatedAdventurer });
});

// POST /api/v1/adventurers/desperate-hire
// When a player has no adventurers, no properties, and can't afford the market,
// hire a free adventurer with minimum loyalty who's willing to work for nothing upfront.
router.post('/desperate-hire', requireAuth, async (req, res) => {
  // Fast-path check for a clean error message in the common (non-racing) case.
  const status = await getBootstrapStatus(req.playerId);
  if (!status.desperateHireAvailable) {
    res.status(403).json({ error: 'Desperate hire is not available — you must have no adventurers, no properties, and insufficient gold to hire from the market' });
    return;
  }

  try {
    const adventurer = await claimDesperateHire(req.playerId);
    console.log(`[bootstrap] ${req.playerId} used desperate hire — ${adventurer.name} joins for free`);
    res.status(201).json({ adventurer });
  } catch (err) {
    if (err instanceof ClaimConflictError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      res.status(409).json({ error: 'Desperate hire is being claimed by another request — please retry' });
      return;
    }
    throw err;
  }
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

  // An injured adventurer stays injured through the release — otherwise fire-then-rehire
  // (even by a different employer) would instantly clear an injury that should still be
  // recovering. They re-enter the market pool once marketGC sees their recovery timer has
  // actually passed, not before. A dead adventurer stays dead, full stop — release just
  // clears them off the employer's roster without resurrecting them into the market.
  const stillInjured = adventurer.status === 'injured';
  const stillDead = adventurer.status === 'dead';

  const updatedAdventurer = await prisma.$transaction(async (tx) => {
    const released = await tx.adventurer.update({
      where: { id },
      data: {
        status:         stillDead ? 'dead' : stillInjured ? 'injured' : 'available',
        employerId:     null,
        poolExpiresAt:  (stillDead || stillInjured) ? null : new Date(Date.now() + 48 * 60 * 60 * 1000),
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

  publish(CHANNELS.market, 'market_update', { type: 'fire', adventurerId: id })
    .catch(() => { /* non-fatal if Redis is unavailable */ });

  res.json({ adventurer: updatedAdventurer });
});

// POST /api/v1/adventurers/:id/gear/upgrade
// Purchase the next gear tier — a late-game gold sink. See services/adventurerGear.ts for the
// validation/atomic-purchase logic.
router.post('/:id/gear/upgrade', requireAuth, async (req, res) => {
  const result = await upgradeGear(req.playerId, req.params.id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.details ?? {}) });
    return;
  }
  res.json({ player: result.player, adventurer: result.adventurer });
});

export default router;
