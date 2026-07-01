import { prisma } from '../lib/prisma.js';
import { publish, CHANNELS } from '../lib/redis.js';

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
        data:  { status: 'awarded', awardedTo: winner.id },
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

  // Release injured adventurers who have recovered.
  const recovered = await prisma.adventurer.updateMany({
    where: {
      status:              'injured',
      injuryRecoveryUntil: { lte: now },
    },
    data: { status: 'hired', injuryRecoveryUntil: null },
  });

  const total = awarded + bidExpiredCount + marketExpired.count + recovered.count;
  if (total > 0) {
    console.log(
      `[market-gc] Awarded ${awarded} bid contract(s), expired ${bidExpiredCount + marketExpired.count} contract(s), ` +
      `recovered ${recovered.count} adventurer(s)`,
    );
    publish(CHANNELS.market, 'market_update', {
      type:      'gc',
      awarded,
      contracts: bidExpiredCount + marketExpired.count,
      recovered: recovered.count,
    }).catch(() => {});
  }
}
