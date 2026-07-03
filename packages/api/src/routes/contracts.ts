import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import {
  BIDDING_CONTRACT_TIERS,
  CONTRACT_TIER_REPUTATION_REQUIREMENTS,
} from '@adventurer-manager/types';
import type { ContractTier } from '@adventurer-manager/types';
import { getBootstrapStatus, WELFARE_COOLDOWN_HOURS } from '../services/bootstrap.js';

const WELFARE_CONTRACT = {
  title:             'Guild Charity Work: Delivery Run',
  description:       'The Adventurers\' Guild has arranged a simple delivery task for your company in its time of need. No penalty if things go awry — just get back on your feet.',
  tier:              'errand' as const,
  requiredPower:     1,
  requiredStats:     {},
  rewardGold:        200,
  reputationReward:  5,
  penaltyGold:       0,
  penaltyReputation: 0,
  durationHours:     2,
};

const router = Router();

// GET /api/v1/contracts/market
// Returns available and bidding contracts. Includes bid count and whether the
// current player has already placed a bid (for dangerous/legendary).
router.get('/market', requireAuth, async (req, res) => {
  const now = new Date();
  const raw = await prisma.contract.findMany({
    where: {
      status:    { in: ['available', 'bidding'] },
      expiresAt: { gt: now },
    },
    include: {
      _count: { select: { bids: true } },
      bids:   { where: { playerId: req.playerId }, select: { id: true } },
    },
    orderBy: [{ tier: 'asc' }, { rewardGold: 'desc' }],
  });

  const contracts = raw.map(({ _count, bids, ...c }) => ({
    ...c,
    bidCount: _count.bids,
    hasBid:   bids.length > 0,
  }));

  res.json({ contracts });
});

// GET /api/v1/contracts/mine
// Returns contracts awarded to the current player.
router.get('/mine', requireAuth, async (req, res) => {
  const contracts = await prisma.contract.findMany({
    where: { awardedTo: req.playerId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ contracts });
});

// GET /api/v1/contracts/welfare
// Returns welfare contract details and eligibility for the current player.
// Must be declared before /:id routes so Express doesn't capture "welfare" as an id.
router.get('/welfare', requireAuth, async (req, res) => {
  const status = await getBootstrapStatus(req.playerId);
  res.json({
    contract:      WELFARE_CONTRACT,
    available:     status.welfareContractAvailable,
    cooldownUntil: status.welfareContractCooldownUntil,
    cooldownHours: WELFARE_COOLDOWN_HOURS,
  });
});

// POST /api/v1/contracts/welfare/accept
// Creates and immediately awards a welfare contract. Enforces 48h cooldown.
router.post('/welfare/accept', requireAuth, async (req, res) => {
  const status = await getBootstrapStatus(req.playerId);
  if (!status.welfareContractAvailable) {
    const msg = status.welfareContractCooldownUntil
      ? `Guild charity work is on cooldown until ${status.welfareContractCooldownUntil.toISOString()}`
      : 'Guild charity work is not available — you must have no properties and insufficient gold to hire from the market';
    res.status(403).json({ error: msg });
    return;
  }

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [contract] = await prisma.$transaction([
    prisma.contract.create({
      data: {
        ...WELFARE_CONTRACT,
        status:      'awarded',
        awardedTo:   req.playerId,
        bidDeadline: expiresAt,
        expiresAt,
      },
    }),
    prisma.player.update({
      where: { id: req.playerId },
      data:  { lastWelfareAt: now },
    }),
  ]);

  console.log(`[bootstrap] ${req.playerId} claimed guild welfare contract`);
  res.status(201).json({ contract });
});

// POST /api/v1/contracts/:id/accept
// Direct accept — only available for errand and standard tier.
// Dangerous/legendary must go through bidding. Uses atomic UPDATE WHERE to
// prevent two players from accepting the same contract simultaneously.
router.post('/:id/accept', requireAuth, async (req, res) => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }
  if (BIDDING_CONTRACT_TIERS.includes(contract.tier as ContractTier)) {
    res.status(409).json({ error: 'Dangerous and legendary contracts are awarded through competitive bidding, not direct accept' });
    return;
  }
  if (contract.status !== 'available') {
    res.status(409).json({ error: 'Contract is no longer available' });
    return;
  }
  if (new Date(contract.expiresAt) <= new Date()) {
    res.status(409).json({ error: 'Contract has expired' });
    return;
  }

  // Atomic claim: only one player can win when multiple race for the same contract.
  const claimed = await prisma.contract.updateMany({
    where: { id, status: 'available' },
    data:  { status: 'awarded', awardedTo: req.playerId },
  });
  if (claimed.count === 0) {
    res.status(409).json({ error: 'Contract was just taken by another player' });
    return;
  }

  const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id } });
  res.json({ contract: updatedContract });
});

// POST /api/v1/contracts/:id/bid
// Place a bid on a dangerous or legendary contract. Highest-reputation bidder
// wins when the bid deadline passes and the Market GC runs.
router.post('/:id/bid', requireAuth, async (req, res) => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }
  if (!BIDDING_CONTRACT_TIERS.includes(contract.tier as ContractTier)) {
    res.status(409).json({ error: 'Only dangerous and legendary contracts use bidding' });
    return;
  }
  if (contract.status !== 'available' && contract.status !== 'bidding') {
    res.status(409).json({ error: 'Contract is no longer accepting bids' });
    return;
  }
  if (new Date(contract.bidDeadline) <= new Date()) {
    res.status(409).json({ error: 'The bidding window for this contract has closed' });
    return;
  }

  const repRequired = CONTRACT_TIER_REPUTATION_REQUIREMENTS[contract.tier as ContractTier];
  const player = await prisma.player.findUniqueOrThrow({ where: { id: req.playerId } });
  if (player.reputation < repRequired) {
    res.status(403).json({
      error:    `Requires ${repRequired} reputation to bid on ${contract.tier} contracts`,
      required: repRequired,
      current:  player.reputation,
    });
    return;
  }

  // Upsert bid + transition contract to 'bidding' on first bid (idempotent).
  await prisma.$transaction(async (tx) => {
    await tx.contractBid.upsert({
      where:  { contractId_playerId: { contractId: id, playerId: req.playerId } },
      create: { contractId: id, playerId: req.playerId },
      update: {},
    });
    // Safe to run even if contract is already 'bidding' — updateMany is a no-op then.
    await tx.contract.updateMany({
      where: { id, status: 'available' },
      data:  { status: 'bidding' },
    });
  });

  res.status(201).json({ placed: true });
});

export default router;
