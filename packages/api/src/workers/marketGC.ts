import { prisma } from '../lib/prisma.js';
import { publish, CHANNELS } from '../lib/redis.js';
import { BID_AWARD_DEPLOY_HOURS } from '@axes-actuaries/types';

// Runs every 15 minutes.
export async function runMarketGC(): Promise<void> {
  const now = new Date();

  // Award bidding contracts whose bid deadline has passed.
  // Winner = highest reputation; earliest bid breaks ties.
  const biddingExpired = await prisma.contract.findMany({
    where: { status: 'bidding', bidDeadline: { lt: now } },
    include: {
      bids: {
        include: { player: { select: { id: true, reputation: true } } },
        orderBy: [
          { player: { reputation: 'desc' } },
          { createdAt: 'asc' },
        ],
        take: 1,
      },
    },
  });

  let awarded = 0;
  let bidExpiredCount = 0;

  for (const contract of biddingExpired) {
    if (contract.bids.length > 0) {
      const winner = contract.bids[0].player;
      await prisma.contract.update({
        where: { id: contract.id },
        data:  {
          status:     'awarded',
          awardedTo:  winner.id,
          deployBy:   new Date(now.getTime() + BID_AWARD_DEPLOY_HOURS * 60 * 60 * 1000),
        },
      });
      publish(CHANNELS.player(winner.id), 'contract_awarded', {
        contractId:    contract.id,
        contractTitle: contract.title,
        tier:          contract.tier,
        rewardGold:    contract.rewardGold,
      }).catch(() => {});
      awarded++;
    } else {
      await prisma.contract.update({
        where: { id: contract.id },
        data:  { status: 'expired' },
      });
      bidExpiredCount++;
    }
  }

  // Expire available contracts past their expiry date.
  const marketExpired = await prisma.contract.updateMany({
    where: { status: 'available', expiresAt: { lt: now } },
    data:  { status: 'expired' },
  });

  // Fail awarded contracts whose deploy-by deadline passed without a party ever being sent
  // — otherwise a player could accept/win contracts indefinitely without committing to
  // them, denying them to everyone else at zero cost. Treated exactly like a failed
  // adventure: the same penaltyGold/penaltyReputation already defined on the contract
  // (0 for welfare contracts, so this is a no-op penalty there — still clears them out of
  // "awaiting deployment" limbo).
  const deployMissed = await prisma.contract.findMany({
    where: { status: 'awarded', deployBy: { lt: now } },
  });

  for (const contract of deployMissed) {
    if (!contract.awardedTo) continue; // shouldn't happen — awarded contracts always have an owner
    const playerId = contract.awardedTo;

    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contract.id },
        data:  { status: 'failed' },
      });
      await tx.player.update({
        where: { id: playerId },
        data: {
          gold:       { decrement: contract.penaltyGold },
          reputation: { decrement: contract.penaltyReputation },
        },
      });
      if (contract.penaltyGold > 0) {
        await tx.transaction.create({
          data: {
            playerId,
            amount:      -contract.penaltyGold,
            reason:      'contract_abandoned',
            description: `Missed deployment deadline: ${contract.title}`,
            referenceId: contract.id,
          },
        });
      }
    });

    publish(CHANNELS.player(playerId), 'contract_expired', {
      contractId:    contract.id,
      contractTitle: contract.title,
      penaltyGold:   contract.penaltyGold,
    }).catch(() => {});
  }

  // Release injured adventurers who have recovered — still employed ones return to duty;
  // ones released (fired) while injured re-enter the open market instead, since they have
  // no employer to return to. Split into two updates since the target status differs.
  const recoveredEmployed = await prisma.adventurer.updateMany({
    where: {
      status:              'injured',
      injuryRecoveryUntil: { lte: now },
      employerId:          { not: null },
    },
    data: { status: 'hired', injuryRecoveryUntil: null },
  });
  const recoveredUnemployed = await prisma.adventurer.updateMany({
    where: {
      status:              'injured',
      injuryRecoveryUntil: { lte: now },
      employerId:          null,
    },
    data: {
      status:              'available',
      injuryRecoveryUntil: null,
      poolExpiresAt:       new Date(now.getTime() + 48 * 60 * 60 * 1000),
    },
  });
  const recoveredCount = recoveredEmployed.count + recoveredUnemployed.count;

  const total = awarded + bidExpiredCount + marketExpired.count + deployMissed.length + recoveredCount;
  if (total > 0) {
    console.log(
      `[market-gc] Awarded ${awarded} bid contract(s), expired ${bidExpiredCount + marketExpired.count} contract(s), ` +
      `failed ${deployMissed.length} contract(s) for missed deploy-by, recovered ${recoveredCount} adventurer(s)`,
    );
    publish(CHANNELS.market, 'market_update', {
      type:      'gc',
      awarded,
      contracts: bidExpiredCount + marketExpired.count,
      deployMissed: deployMissed.length,
      recovered: recoveredCount,
    }).catch(() => {});
  }
}
