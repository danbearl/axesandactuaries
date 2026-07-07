import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { runMarketGC } from '../src/workers/marketGC.js';
import { createPlayer, createAdventurer, createContract } from './fixtures.js';

const past = (msAgo: number) => new Date(Date.now() - msAgo);
const future = (msAhead: number) => new Date(Date.now() + msAhead);

describe('runMarketGC', () => {
  it('awards a bidding contract to the highest-reputation bidder', async () => {
    const lowRep = await createPlayer({ reputation: 10 });
    const highRep = await createPlayer({ reputation: 100 });
    const contract = await createContract({ tier: 'dangerous', status: 'bidding', bidDeadline: past(1000) });

    await prisma.contractBid.create({ data: { contractId: contract.id, playerId: lowRep.id } });
    await prisma.contractBid.create({ data: { contractId: contract.id, playerId: highRep.id } });

    await runMarketGC();

    const updated = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updated.status).toBe('awarded');
    expect(updated.awardedTo).toBe(highRep.id);
    // Bid-award timing is outside the winner's control (could land during their sleep), so
    // it gets the longer 24h deploy-by window, not the short player-initiated one.
    expect(updated.deployBy).not.toBeNull();
    expect(updated.deployBy!.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 60 * 1000);
  });

  it('breaks reputation ties by earliest bid', async () => {
    const earlier = await createPlayer({ reputation: 50 });
    const later = await createPlayer({ reputation: 50 });
    const contract = await createContract({ tier: 'dangerous', status: 'bidding', bidDeadline: past(1000) });

    await prisma.contractBid.create({
      data: { contractId: contract.id, playerId: earlier.id, createdAt: past(60 * 60 * 1000) },
    });
    await prisma.contractBid.create({
      data: { contractId: contract.id, playerId: later.id, createdAt: past(1000) },
    });

    await runMarketGC();

    const updated = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updated.awardedTo).toBe(earlier.id);
  });

  it('expires a bidding contract with no bids once its deadline passes', async () => {
    const contract = await createContract({ tier: 'dangerous', status: 'bidding', bidDeadline: past(1000) });

    await runMarketGC();

    const updated = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updated.status).toBe('expired');
  });

  it('expires available contracts past their expiresAt', async () => {
    const contract = await createContract({ status: 'available', expiresAt: past(1000) });

    await runMarketGC();

    const updated = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updated.status).toBe('expired');
  });

  it('leaves contracts alone that are not yet due', async () => {
    const biddingContract = await createContract({ tier: 'dangerous', status: 'bidding', bidDeadline: future(60 * 60 * 1000) });
    const availableContract = await createContract({ status: 'available', expiresAt: future(60 * 60 * 1000) });
    const awardedContract = await createContract({ status: 'awarded', deployBy: future(60 * 60 * 1000) });

    await runMarketGC();

    const bidding = await prisma.contract.findUniqueOrThrow({ where: { id: biddingContract.id } });
    const available = await prisma.contract.findUniqueOrThrow({ where: { id: availableContract.id } });
    const awarded = await prisma.contract.findUniqueOrThrow({ where: { id: awardedContract.id } });
    expect(bidding.status).toBe('bidding');
    expect(available.status).toBe('available');
    expect(awarded.status).toBe('awarded');
  });

  it('fails an awarded contract whose deploy-by deadline passed, applying its penalty', async () => {
    const player = await createPlayer({ gold: 500, reputation: 20 });
    const contract = await createContract({
      status: 'awarded',
      awardedTo: player.id,
      deployBy: past(1000),
      penaltyGold: 90,
      penaltyReputation: 5,
    });

    await runMarketGC();

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.status).toBe('failed');

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(500 - 90);
    expect(updatedPlayer.reputation).toBe(20 - 5);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('contract_abandoned');
    expect(tx.amount).toBe(-90);
  });

  it('does not create a ledger entry when the missed contract has no gold penalty', async () => {
    // Matches welfare contracts, which are explicitly penalty-free.
    const player = await createPlayer({ gold: 500, reputation: 20 });
    const contract = await createContract({
      status: 'awarded',
      awardedTo: player.id,
      deployBy: past(1000),
      penaltyGold: 0,
      penaltyReputation: 0,
    });

    await runMarketGC();

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.status).toBe('failed');

    const txCount = await prisma.transaction.count({ where: { playerId: player.id } });
    expect(txCount).toBe(0);
  });

  it('returns a still-employed recovered adventurer to duty', async () => {
    const player = await createPlayer();
    const adv = await createAdventurer({
      employerId: player.id,
      status: 'injured',
      injuryRecoveryUntil: past(1000),
    });

    await runMarketGC();

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updated.status).toBe('hired');
    expect(updated.injuryRecoveryUntil).toBeNull();
  });

  it('returns an unemployed recovered adventurer to the open market, not "hired"', async () => {
    // Reachable by firing an adventurer while they're injured — they have no employer to
    // return to, so recovery should land them back in the market pool instead.
    const adv = await createAdventurer({
      employerId: null,
      status: 'injured',
      injuryRecoveryUntil: past(1000),
    });

    await runMarketGC();

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updated.status).toBe('available');
    expect(updated.injuryRecoveryUntil).toBeNull();
    expect(updated.poolExpiresAt).not.toBeNull();
  });
});
