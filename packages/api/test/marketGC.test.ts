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

    await runMarketGC();

    const bidding = await prisma.contract.findUniqueOrThrow({ where: { id: biddingContract.id } });
    const available = await prisma.contract.findUniqueOrThrow({ where: { id: availableContract.id } });
    expect(bidding.status).toBe('bidding');
    expect(available.status).toBe('available');
  });

  it('releases injured adventurers whose recovery time has passed', async () => {
    const adv = await createAdventurer({
      status: 'injured',
      injuryRecoveryUntil: past(1000),
    });

    await runMarketGC();

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(updated.status).toBe('hired');
    expect(updated.injuryRecoveryUntil).toBeNull();
  });
});
