import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import { zodErrorMessage } from '../lib/zodError.js';

const router = Router();

// Build costs and bonuses per property type and level
const PROPERTY_CONFIG = {
  // No `bonus` entry — dormitory's only mechanical effect is roster capacity
  // (computeRosterCap, keyed off the property's level directly), not the generic
  // bonus-JSON path every other property uses. Deliberately kept distinct from
  // Training Hall/Library/etc. to avoid functional overlap with a future XP-focused
  // property.
  dormitory:     { baseCost: 200, maintenanceDaily: 15, bonus: {} },
  // powerRatingBonus is a fraction of the party's total power added per level (0.10 =
  // +10%/level, read directly off the property row by computePartyPower — see
  // services/adventure.ts). No xpMultiplier — dropped as dead weight, same call as
  // Dormitory: one property, one clear job. A future XP-focused property (Library) picks
  // up XP gain instead, so the two don't overlap.
  training_hall: { baseCost: 350, maintenanceDaily: 20, bonus: { powerRatingBonus: 0.1 } },
  alchemy_lab:   { baseCost: 500, maintenanceDaily: 30, bonus: { powerRatingBonus: 3 } },
  library:       { baseCost: 400, maintenanceDaily: 25, bonus: { xpMultiplier: 1.2 } },
  // injuryRecoveryRate is a fraction shaved off recovery time per level (0.15 = 15%/level,
  // read directly off the property row by resolveAdventure — see services/adventure.ts).
  infirmary:     { baseCost: 300, maintenanceDaily: 18, bonus: { injuryRecoveryRate: 0.15 } },
  armory:        { baseCost: 450, maintenanceDaily: 22, bonus: { wageDiscount: 0.1 } },
} as const;

// Upgrade cost to reach each level (key = current level before upgrade)
const UPGRADE_COSTS: Record<number, number> = { 1: 150, 2: 350, 3: 700 };

const BuildPropertyBody = z.object({
  type: z.enum(['dormitory', 'training_hall', 'alchemy_lab', 'library', 'infirmary', 'armory']),
});

// GET /api/v1/properties
router.get('/', requireAuth, async (req, res) => {
  const properties = await prisma.property.findMany({
    where: { playerId: req.playerId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ properties });
});

// POST /api/v1/properties
// Build a new property. A player can only have one of each type.
router.post('/', requireAuth, async (req, res) => {
  const parsed = BuildPropertyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const { type } = parsed.data;

  const existing = await prisma.property.findFirst({
    where: { playerId: req.playerId, type },
  });
  if (existing) {
    res.status(409).json({ error: `You already own a ${type.replace('_', ' ')}` });
    return;
  }

  const config = PROPERTY_CONFIG[type];
  const player = await prisma.player.findUniqueOrThrow({ where: { id: req.playerId } });

  if (player.gold < config.baseCost) {
    res.status(400).json({ error: 'Insufficient gold', required: config.baseCost, available: player.gold });
    return;
  }

  const [, property] = await prisma.$transaction([
    prisma.player.update({
      where: { id: req.playerId },
      data: { gold: { decrement: config.baseCost } },
    }),
    prisma.property.create({
      data: {
        playerId: req.playerId,
        type,
        level: 1,
        maintenanceCostDaily: config.maintenanceDaily,
        bonus: config.bonus,
        costBasis: config.baseCost,
      },
    }),
    prisma.transaction.create({
      data: {
        playerId: req.playerId,
        amount: -config.baseCost,
        reason: 'property_build',
        description: `Constructed ${type.replace(/_/g, ' ')} (Level 1)`,
      },
    }),
  ]);

  res.status(201).json({ property });
});

// POST /api/v1/properties/:id/sell
// Liquidate a property for 50% of its cost basis.
router.post('/:id/sell', requireAuth, async (req, res) => {
  const { id } = req.params;

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.playerId !== req.playerId) {
    res.status(404).json({ error: 'Property not found' });
    return;
  }

  const salePrice = Math.max(1, Math.floor(property.costBasis / 2));
  const label = property.type.replace(/_/g, ' ');

  await prisma.$transaction([
    prisma.property.delete({ where: { id } }),
    prisma.player.update({
      where: { id: req.playerId },
      data: { gold: { increment: salePrice } },
    }),
    prisma.transaction.create({
      data: {
        playerId:    req.playerId,
        amount:      salePrice,
        reason:      'property_sell',
        description: `Sold ${label} for ${salePrice} gp (50% of cost basis)`,
        referenceId: id,
      },
    }),
  ]);

  res.json({ salePrice });
});

// POST /api/v1/properties/:id/upgrade
// Upgrade a property to the next level. Scales maintenance cost; the stored
// bonus JSON represents a per-level rate and is intentionally left unchanged
// (game engine multiplies it by p.level at resolution time).
router.post('/:id/upgrade', requireAuth, async (req, res) => {
  const { id } = req.params;

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.playerId !== req.playerId) {
    res.status(404).json({ error: 'Property not found' });
    return;
  }
  if (property.level >= 3) {
    res.status(409).json({ error: 'Property is already at maximum level' });
    return;
  }

  const upgradeCost = UPGRADE_COSTS[property.level];
  const player = await prisma.player.findUniqueOrThrow({ where: { id: req.playerId } });
  if (player.gold < upgradeCost) {
    res.status(400).json({ error: 'Insufficient gold', required: upgradeCost, available: player.gold });
    return;
  }

  const config = PROPERTY_CONFIG[property.type as keyof typeof PROPERTY_CONFIG];
  const newLevel = property.level + 1;
  // Each level adds 50% of base daily maintenance on top of level 1 cost.
  const newMaintenanceCostDaily = config.maintenanceDaily + Math.round(config.maintenanceDaily * 0.5 * (newLevel - 1));
  const label = property.type.replace(/_/g, ' ');

  const [, updatedProperty] = await prisma.$transaction([
    prisma.player.update({
      where: { id: req.playerId },
      data:  { gold: { decrement: upgradeCost } },
    }),
    prisma.property.update({
      where: { id },
      data: {
        level:                newLevel,
        maintenanceCostDaily: newMaintenanceCostDaily,
        costBasis:            { increment: upgradeCost },
      },
    }),
    prisma.transaction.create({
      data: {
        playerId:    req.playerId,
        amount:      -upgradeCost,
        reason:      'property_build',
        description: `Upgraded ${label} to Level ${newLevel}`,
        referenceId: id,
      },
    }),
  ]);

  res.json({ property: updatedProperty });
});

export default router;
