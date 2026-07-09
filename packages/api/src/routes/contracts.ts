import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../lib/prisma.js';
import {
  BIDDING_CONTRACT_TIERS,
  CONTRACT_TIER_REPUTATION_REQUIREMENTS,
  BID_WINDOW_HOURS,
} from '@axes-actuaries/types';
import type { ContractTier } from '@axes-actuaries/types';
import { getBootstrapStatus, WELFARE_COOLDOWN_HOURS, WELFARE_CONTRACT, claimWelfareContract } from '../services/bootstrap.js';
import { acceptContract } from '../services/contracts.js';
import { ClaimConflictError } from '../lib/errors.js';
import { publish, CHANNELS } from '../lib/redis.js';

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

  try {
    const contract = await claimWelfareContract(req.playerId);
    console.log(`[bootstrap] ${req.playerId} claimed guild welfare contract`);
    res.status(201).json({ contract });
  } catch (err) {
    if (err instanceof ClaimConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// POST /api/v1/contracts/:id/accept
// Direct accept — only available for errand and standard tier.
// Dangerous/legendary must go through bidding. See services/contracts.ts for the
// tier/status/expiry/cap checks and the atomic claim that prevents two players from
// accepting the same contract simultaneously.
router.post('/:id/accept', requireAuth, async (req, res) => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }

  try {
    const updatedContract = await acceptContract(req.playerId, contract);

    publish(CHANNELS.market, 'market_update', { type: 'contract_accept', contractId: id })
      .catch(() => { /* non-fatal if Redis is unavailable */ });

    res.json({ contract: updatedContract });
  } catch (err) {
    if (err instanceof ClaimConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  // Null bidDeadline means no bid has landed yet — the contract has no clock running at all
  // (see BID_WINDOW_HOURS), so only a *set* deadline in the past should reject a bid.
  if (contract.bidDeadline && new Date(contract.bidDeadline) <= new Date()) {
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

  // Upsert bid + transition contract to 'bidding' on first bid (idempotent). The first bid
  // is also what starts the countdown — everyone gets the same full BID_WINDOW_HOURS to
  // counter-bid regardless of when the first bid happened to land. Gated on status:'available'
  // so a second/third bid on an already-'bidding' contract is a no-op here and never resets
  // the clock.
  await prisma.$transaction(async (tx) => {
    await tx.contractBid.upsert({
      where:  { contractId_playerId: { contractId: id, playerId: req.playerId } },
      create: { contractId: id, playerId: req.playerId },
      update: {},
    });
    await tx.contract.updateMany({
      where: { id, status: 'available' },
      data:  {
        status:      'bidding',
        bidDeadline: new Date(Date.now() + BID_WINDOW_HOURS * 60 * 60 * 1000),
      },
    });
  });

  publish(CHANNELS.market, 'market_update', { type: 'contract_bid', contractId: id })
    .catch(() => { /* non-fatal if Redis is unavailable */ });

  res.status(201).json({ placed: true });
});

export default router;
