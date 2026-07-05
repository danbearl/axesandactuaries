import { describe, it, expect, vi, afterEach } from 'vitest';
import { XP_PER_GOLD } from '@axes-actuaries/types';
import { prisma } from '../src/lib/prisma.js';
import { resolveAdventure, startAdventure } from '../src/services/adventure.js';
import { ClaimConflictError } from '../src/lib/errors.js';
import { createPlayer, createAdventurer, createContract } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedAdventure(opts: {
  playerGold?: number;
  playerReputation?: number;
  adventurerPowerRating?: number;
  requiredPower: number;
  rewardGold: number;
  reputationReward: number;
  penaltyGold: number;
  penaltyReputation: number;
  completesAt: Date;
}) {
  const player = await createPlayer({ gold: opts.playerGold ?? 500, reputation: opts.playerReputation ?? 0 });
  const adventurer = await createAdventurer({
    employerId: player.id,
    status: 'on_adventure',
    powerRating: opts.adventurerPowerRating ?? 50,
    experience: 0,
    level: 1,
  });
  const contract = await createContract({
    requiredPower: opts.requiredPower,
    rewardGold: opts.rewardGold,
    reputationReward: opts.reputationReward,
    penaltyGold: opts.penaltyGold,
    penaltyReputation: opts.penaltyReputation,
    status: 'in_progress',
  });
  const adventure = await prisma.adventure.create({
    data: {
      contractId: contract.id,
      playerId: player.id,
      startsAt: new Date(opts.completesAt.getTime() - 60 * 60 * 1000),
      completesAt: opts.completesAt,
      status: 'in_progress',
    },
  });
  await prisma.adventureAdventurer.create({
    data: { adventureId: adventure.id, adventurerId: adventurer.id },
  });
  return { player, adventurer, contract, adventure };
}

describe('resolveAdventure', () => {
  it('does nothing for adventures whose completesAt has not passed', async () => {
    const { adventure } = await seedAdventure({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() + 60 * 60 * 1000), // an hour from now
    });

    const result = await resolveAdventure(adventure.id);
    expect(result?.status).toBe('in_progress');
  });

  it('resolves a successful adventure: pays reward, grants xp and reputation', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)  // outcomeRoll — well below successChance (0.8)
      .mockReturnValueOnce(0.5); // injuryRoll — irrelevant since success short-circuits injury

    const { player, adventurer, contract, adventure } = await seedAdventure({
      playerGold: 500, playerReputation: 10,
      adventurerPowerRating: 50, requiredPower: 50, // ratio 1.0 -> successChance 0.8
      rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() - 1000),
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('completed');

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.status).toBe('completed');

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(500 + 300);
    expect(updatedPlayer.reputation).toBe(10 + 3);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('contract_payment');
    expect(tx.amount).toBe(300);

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updatedAdv.status).toBe('hired');
    expect(updatedAdv.injuryRecoveryUntil).toBeNull();
    expect(updatedAdv.experience).toBe(Math.floor(300 * XP_PER_GOLD));
  });

  it('resolves a failed adventure: applies penalty and can injure adventurers', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)  // outcomeRoll — above successChance (~0.305)
      .mockReturnValueOnce(0.2)  // injuryRoll — below injuryChance (0.4) -> injured, not dead (>0.1)
      .mockReturnValueOnce(0.5); // recovery-hours roll

    const { player, adventurer, contract, adventure } = await seedAdventure({
      playerGold: 500, playerReputation: 10,
      adventurerPowerRating: 10, requiredPower: 1000, // ratio ~0.01 -> successChance ~0.305
      rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() - 1000),
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('failed');

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.status).toBe('failed');

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(500 - 90);
    expect(updatedPlayer.reputation).toBe(10 - 1);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.reason).toBe('penalty');
    expect(tx.amount).toBe(-90);

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updatedAdv.status).toBe('injured');
    expect(updatedAdv.injuryRecoveryUntil).not.toBeNull();
    expect(updatedAdv.experience).toBe(0);
  });

  it('is idempotent — resolving an already-resolved adventure does nothing further', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.5);

    const { player, adventure } = await seedAdventure({
      playerGold: 500, adventurerPowerRating: 50, requiredPower: 50,
      rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() - 1000),
    });

    await resolveAdventure(adventure.id);
    const afterFirst = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });

    const secondResult = await resolveAdventure(adventure.id);
    expect(secondResult?.status).toBe('completed');

    const afterSecond = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(afterSecond.gold).toBe(afterFirst.gold);

    const txCount = await prisma.transaction.count({ where: { playerId: player.id } });
    expect(txCount).toBe(1);
  });
});

describe('startAdventure', () => {
  it('assigns the party and moves contract/adventurers to in-progress', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({ employerId: player.id, status: 'hired' });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    const adventure = await startAdventure(player.id, contract.id, [adventurer.id]);
    expect(adventure.contractId).toBe(contract.id);

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.status).toBe('in_progress');

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updatedAdv.status).toBe('on_adventure');
  });

  it('rejects when the contract is not awarded to the caller', async () => {
    const player = await createPlayer();
    const other = await createPlayer();
    const adventurer = await createAdventurer({ employerId: player.id, status: 'hired' });
    const contract = await createContract({ status: 'awarded', awardedTo: other.id });

    await expect(startAdventure(player.id, contract.id, [adventurer.id]))
      .rejects.toThrow(ClaimConflictError);
  });

  it('rejects when an adventurer is not hired by the caller', async () => {
    const player = await createPlayer();
    const other = await createPlayer();
    const adventurer = await createAdventurer({ employerId: other.id, status: 'hired' });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    await expect(startAdventure(player.id, contract.id, [adventurer.id]))
      .rejects.toThrow(ClaimConflictError);
  });

  it('lets only one of two concurrent requests claim the same contract', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({ employerId: player.id, status: 'hired' });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    const results = await Promise.allSettled([
      startAdventure(player.id, contract.id, [adventurer.id]),
      startAdventure(player.id, contract.id, [adventurer.id]),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ClaimConflictError);

    const adventureCount = await prisma.adventure.count({ where: { contractId: contract.id } });
    expect(adventureCount).toBe(1);
  });
});
