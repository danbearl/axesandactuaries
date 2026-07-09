import { prisma } from '../lib/prisma.js';
import { publish, CHANNELS } from '../lib/redis.js';
import { BID_AWARD_DEPLOY_HOURS } from '@axes-actuaries/types';
import { replenishContractMarket } from '../services/marketSeeding.js';
import { logPlayerEvent } from '../services/playerEvents.js';

// Runs every 15 minutes.
export async function runMarketGC(): Promise<void> {
  const now = new Date();

  // Award bidding contracts whose post-first-bid window has passed. A contract with no bids
  // at all has bidDeadline still null (only a first bid sets it — see routes/contracts.ts),
  // so it's never matched here; it stays on the market until either it gets a bid or its
  // much longer backstop expiresAt is hit (below).
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

  // Expire available contracts past their expiry date. For bidding tiers this is a backstop
  // for contracts that never received a single bid (see BIDDING_CONTRACT_BACKSTOP_EXPIRY_HOURS);
  // for direct-accept tiers it's the only expiry mechanism they have.
  const marketExpired = await prisma.contract.updateMany({
    where: { status: 'available', expiresAt: { lt: now } },
    data:  { status: 'expired' },
  });

  // Top up every tier back to its population-scaled standing target — runs after the
  // awarding/expiry passes above so it sees an up-to-date count, not one still including
  // contracts this same tick just resolved.
  const replenished = await replenishContractMarket(now);

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
  // no employer to return to. Split into two updates since the target status differs; the
  // employed case is found first (rather than a bare updateMany) so each one can get its own
  // logPlayerEvent — there's an owning player to notify, unlike the unemployed case.
  const recoveredEmployedList = await prisma.adventurer.findMany({
    where: {
      status:              'injured',
      injuryRecoveryUntil: { lte: now },
      employerId:          { not: null },
    },
    select: { id: true, name: true, employerId: true },
  });
  for (const adv of recoveredEmployedList) {
    await prisma.adventurer.update({
      where: { id: adv.id },
      data:  { status: 'hired', injuryRecoveryUntil: null },
    });
    await logPlayerEvent({
      playerId:    adv.employerId!,
      type:        'adventurer_recovered',
      summary:     `${adv.name} has recovered from injury and is ready to deploy.`,
      referenceId: adv.id,
    }).catch(() => {});
  }
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
  const recoveredCount = recoveredEmployedList.length + recoveredUnemployed.count;

  // Clear elapsed rest periods for hired adventurers — restUntil is otherwise only ever
  // checked lazily (party assembly, wage/loyalty accrual), never actively cleared, so this is
  // the one active moment a "finished resting" event can be logged. Only hired adventurers
  // are in scope: an unemployed one's stale restUntil isn't meaningful to any player.
  const restCompleteList = await prisma.adventurer.findMany({
    where: { status: 'hired', restUntil: { lte: now, not: null } },
    select: { id: true, name: true, employerId: true },
  });
  for (const adv of restCompleteList) {
    await prisma.adventurer.update({
      where: { id: adv.id },
      data:  { restUntil: null },
    });
    await logPlayerEvent({
      playerId:    adv.employerId!,
      type:        'adventurer_rest_complete',
      summary:     `${adv.name} has finished resting and is ready to deploy.`,
      referenceId: adv.id,
    }).catch(() => {});
  }

  const total = awarded + bidExpiredCount + marketExpired.count + replenished + deployMissed.length
    + recoveredCount + restCompleteList.length;
  if (total > 0) {
    console.log(
      `[market-gc] Awarded ${awarded} bid contract(s), expired ${bidExpiredCount + marketExpired.count} contract(s), ` +
      `replenished ${replenished} bidding-tier contract(s), failed ${deployMissed.length} contract(s) for missed ` +
      `deploy-by, recovered ${recoveredCount} adventurer(s), ${restCompleteList.length} adventurer(s) finished resting`,
    );
    publish(CHANNELS.market, 'market_update', {
      type:      'gc',
      awarded,
      contracts: bidExpiredCount + marketExpired.count,
      replenished,
      deployMissed: deployMissed.length,
      recovered: recoveredCount,
      restComplete: restCompleteList.length,
    }).catch(() => {});
  }
}
