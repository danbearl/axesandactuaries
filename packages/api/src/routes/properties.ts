import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Build costs and bonuses per property type and level
const PROPERTY_CONFIG = {
  dormitory:     { baseCost: 200, maintenanceDaily: 15, bonus: { xpMultiplier: 1.1 } },
  training_hall: { baseCost: 350, maintenanceDaily: 20, bonus: { powerRatingBonus: 2, xpMultiplier: 1.15 } },
  alchemy_lab:   { baseCost: 500, maintenanceDaily: 30, bonus: { powerRatingBonus: 3 } },
  library:       { baseCost: 400, maintenanceDaily: 25, bonus: { xpMultiplier: 1.2 } },
  infirmary:     { baseCost: 300, maintenanceDaily: 18, bonus: { injuryRecoveryRate: 2.0 } },
  armory:        { baseCost: 450, maintenanceDaily: 22, bonus: { wageDiscount: 0.1 } },
} as const;

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
    res.status(400).json({ error: parsed.error.flatten() });
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

export default router;
