import { describe, it, expect, vi, afterEach } from 'vitest';
import { XP_PER_GOLD, computeAmbitionXpMultiplier } from '@axes-actuaries/types';

// The createAdventurer fixture defaults to ambition: 3, which now carries a real XP
// multiplier (+5% per point above 1) — tests that don't override personality need to
// account for it rather than assuming a bare XP_PER_GOLD split.
const DEFAULT_AMBITION_MULTIPLIER = computeAmbitionXpMultiplier(3);
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

  it('forceOutcome bypasses both the completesAt gate and the success-chance roll', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.01) // outcomeRoll — would normally mean success, but is ignored
      .mockReturnValueOnce(0.99); // injuryRoll — above injuryChance, so no injury

    const { adventure } = await seedAdventure({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() + 60 * 60 * 1000), // an hour from now — normally a no-op
    });

    const result = await resolveAdventure(adventure.id, { forceOutcome: 'failure' });
    expect(result?.status).toBe('failed');
  });

  it('resolves a successful adventure: pays reward, grants xp and reputation', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)  // outcomeRoll — well below successChance (0.8)
      .mockReturnValueOnce(0.5)  // injuryRoll — well above the success-path injury chance (0.08)
      .mockReturnValueOnce(0.99); // reckless-bonus roll — above temperament 3's 15% chance, no bonus

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
    expect(updatedAdv.experience).toBe(Math.floor(300 * XP_PER_GOLD * DEFAULT_AMBITION_MULTIPLIER)); // sole party member gets the full share
    // A clean, healthy return still costs downtime before redeployment (25% of the 8h contract).
    expect(updatedAdv.restUntil).not.toBeNull();
    expect(updatedAdv.restUntil!.getTime()).toBeGreaterThan(Date.now());

    const report = await prisma.adventureAdventurer.findUniqueOrThrow({
      where: { adventureId_adventurerId: { adventureId: adventure.id, adventurerId: adventurer.id } },
    });
    expect(report.xpGained).toBe(Math.floor(300 * XP_PER_GOLD * DEFAULT_AMBITION_MULTIPLIER));
    expect(report.injured).toBe(false);
    expect(report.died).toBe(false);
    expect(report.recoveryHours).toBeNull();
  });

  it('splits XP evenly across a multi-member party', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99); // never injured (success or failure path)

    const player = await createPlayer({ gold: 500 });
    const a1 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1 });
    const a2 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1 });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.createMany({
      data: [
        { adventureId: adventure.id, adventurerId: a1.id },
        { adventureId: adventure.id, adventurerId: a2.id },
      ],
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    const expectedShare = Math.floor((300 * XP_PER_GOLD / 2) * DEFAULT_AMBITION_MULTIPLIER);
    const updated1 = await prisma.adventurer.findUniqueOrThrow({ where: { id: a1.id } });
    const updated2 = await prisma.adventurer.findUniqueOrThrow({ where: { id: a2.id } });
    expect(updated1.experience).toBe(expectedShare);
    expect(updated2.experience).toBe(expectedShare);
  });

  it('scales XP gain with ambition', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99); // never injured

    const player = await createPlayer({ gold: 500 });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1,
      personality: { loyalty: 3, ambition: 5, temperament: 3, disposition: 3 }, // max ambition -> +20% XP
    });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    // base xp = 300 * 0.1 / 1 party member = 30; ambition 5 -> x1.2 = 36
    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.experience).toBe(36);
  });

  it('grants a role-property XP bonus to fighter-vocation adventurers with an Armory', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99); // never injured

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'armory', level: 2, maintenanceCostDaily: 22, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1,
      vocation: 'Sellsword', // fighter role — matches Armory
    });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    // base xp = 300 * 0.1 / 1 = 30; ambition 3 (default) -> x1.1; Armory level 2 -> +20% -> x1.2
    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.experience).toBe(Math.floor(30 * DEFAULT_AMBITION_MULTIPLIER * 1.2));
  });

  it('does not grant the Armory XP bonus to a non-fighter vocation', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99); // never injured

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'armory', level: 2, maintenanceCostDaily: 22, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
    });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1,
      vocation: 'Arcanist', // wizard role — does not match Armory
    });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    // base xp = 300 * 0.1 / 1 = 30; ambition 3 (default) -> x1.1; no role match -> no bonus
    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.experience).toBe(Math.floor(30 * DEFAULT_AMBITION_MULTIPLIER));
  });

  it('can trigger a reckless-bonus gold payout on a successful adventure with high temperament', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.01) // outcomeRoll — unused, forceOutcome overrides it
      .mockReturnValueOnce(0.5)  // injuryRoll — above temperament 5's bumped injury chance (0.18), no injury
      .mockReturnValueOnce(0.1); // reckless-bonus roll — below temperament 5's 25% chance, triggers

    const player = await createPlayer({ gold: 500 });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1,
      personality: { loyalty: 3, ambition: 3, temperament: 5, disposition: 3 }, // max temperament -> 25% bonus chance
    });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    // base reward 300 + 10% reckless bonus = 330
    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    expect(updatedPlayer.gold).toBe(500 + 330);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { playerId: player.id } });
    expect(tx.amount).toBe(330);
    expect(tx.description).toContain('reckless bonus');
  });

  it('raises injury chance with higher temperament, even on a successful adventure', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.01) // outcomeRoll — unused, forceOutcome overrides it
      .mockReturnValueOnce(0.12) // injuryRoll — above the base success injury chance (0.08), below temperament 5's bumped chance (0.18)
      .mockReturnValueOnce(0.5)  // recovery-hours roll — value not asserted
      .mockReturnValueOnce(0.99); // reckless-bonus roll — no bonus, keep this test focused

    const player = await createPlayer({ gold: 500 });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50, experience: 0, level: 1,
      personality: { loyalty: 3, ambition: 3, temperament: 5, disposition: 3 }, // max temperament -> +10% injury chance
    });
    const contract = await createContract({
      requiredPower: 50, rewardGold: 300, reputationReward: 3,
      penaltyGold: 90, penaltyReputation: 1, status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id, { forceOutcome: 'success' });

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updatedAdv.status).toBe('injured');
  });

  it('can injure (but rarely kill) an adventurer even on a successful adventure', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.01)  // outcomeRoll — success
      .mockReturnValueOnce(0.05)  // injuryRoll — below the temperament-3-bumped injury chance (0.14), above the death cutoff
      .mockReturnValueOnce(0.5)   // recovery-hours roll — value not asserted
      .mockReturnValueOnce(0.99); // reckless-bonus roll — no bonus, keep this test focused

    const { adventurer, adventure } = await seedAdventure({
      requiredPower: 50, adventurerPowerRating: 50,
      rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      completesAt: new Date(Date.now() - 1000),
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('completed');

    const updatedAdv = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updatedAdv.status).toBe('injured');
    expect(updatedAdv.injuryRecoveryUntil).not.toBeNull();
    expect(updatedAdv.restUntil).toBeNull(); // injury supersedes the ordinary rest window
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

    const report = await prisma.adventureAdventurer.findUniqueOrThrow({
      where: { adventureId_adventurerId: { adventureId: adventure.id, adventurerId: adventurer.id } },
    });
    expect(report.xpGained).toBe(0);
    expect(report.injured).toBe(true);
    expect(report.died).toBe(false);
    expect(report.recoveryHours).toBe(36); // Math.floor(0.5 * 48) + 12
  });

  it('reduces recovery time based on infirmary level', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)  // outcomeRoll — failure
      .mockReturnValueOnce(0.3)  // injuryRoll — injured, not dead
      .mockReturnValueOnce(0.5); // recovery-hours roll

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'infirmary', level: 3, maintenanceCostDaily: 18, bonus: { injuryRecoveryRate: 0.15 } },
    });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 10, experience: 0, level: 1,
    });
    const contract = await createContract({
      requiredPower: 1000, rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id);

    const report = await prisma.adventureAdventurer.findUniqueOrThrow({
      where: { adventureId_adventurerId: { adventureId: adventure.id, adventurerId: adventurer.id } },
    });
    expect(report.injured).toBe(true);
    expect(report.died).toBe(false);
    // base = floor(0.5 * 48) + 12 = 36; level 3 * 0.15 rate = 45% reduction -> round(36 * 0.55) = 20
    expect(report.recoveryHours).toBe(20);
  });

  it('no longer reduces injury chance based on infirmary level — that moved to recovery time only', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)   // outcomeRoll — failure
      .mockReturnValueOnce(0.42)  // injuryRoll — below the base failure injury chance (0.46
                                  // including temperament); would have been safe under the
                                  // old infirmary-reduces-chance formula, but isn't anymore.
      .mockReturnValueOnce(0.5);  // recovery-hours roll — value not asserted

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'infirmary', level: 3, maintenanceCostDaily: 18, bonus: { injuryRecoveryRate: 0.15 } },
    });
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 10, experience: 0, level: 1,
    });
    const contract = await createContract({
      requiredPower: 1000, rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id);

    const report = await prisma.adventureAdventurer.findUniqueOrThrow({
      where: { adventureId_adventurerId: { adventureId: adventure.id, adventurerId: adventurer.id } },
    });
    expect(report.injured).toBe(true);
  });

  it('lowers success chance for an unmet contract requirement, changing the outcome', async () => {
    // ratio 1.0 -> base successChance 0.8; one unmet requirement -> 0.75. A roll of 0.77
    // would succeed under the old formula but fail once the requirement penalty applies.
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.77) // outcomeRoll
      .mockReturnValueOnce(0.99); // injuryRoll — no injury, keep this test focused

    const player = await createPlayer({ gold: 500, reputation: 10 });
    const adventurer = await createAdventurer({
      employerId: player.id,
      status: 'on_adventure',
      vocation: 'Sellsword',
      powerRating: 50,
      experience: 0,
      level: 1,
    });
    const contract = await createContract({
      requiredPower: 50,
      requiredVocation: 'Arcanist', // adventurer is a Sellsword — unmet
      rewardGold: 300, reputationReward: 3, penaltyGold: 90, penaltyReputation: 1,
      status: 'in_progress',
    });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id,
        playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('failed');
  });

  it('builds cohesion between party members after adventuring together, regardless of outcome', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99); // never injured, always fails outcomeRoll

    const player = await createPlayer({ gold: 500 });
    const a1 = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 10,
      personality: { loyalty: 3, ambition: 3, temperament: 3, disposition: 2 },
    });
    const a2 = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 10,
      personality: { loyalty: 3, ambition: 3, temperament: 3, disposition: 4 },
    });
    const contract = await createContract({ requiredPower: 1000, status: 'in_progress' }); // guarantees failure
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.createMany({
      data: [
        { adventureId: adventure.id, adventurerId: a1.id },
        { adventureId: adventure.id, adventurerId: a2.id },
      ],
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('failed'); // confirms this accrued despite a loss, not a win

    const [lowId, highId] = [a1.id, a2.id].sort();
    const row = await prisma.adventurerCohesion.findUniqueOrThrow({
      where: { adventurerLowId_adventurerHighId: { adventurerLowId: lowId, adventurerHighId: highId } },
    });
    expect(row.cohesion).toBe(11); // 5 base + disposition 2 + disposition 4
  });

  it('clamps cohesion at 100 rather than overflowing', async () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.01); // guarantees success, never injured

    const player = await createPlayer({ gold: 500 });
    const a1 = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50,
      personality: { loyalty: 3, ambition: 3, temperament: 3, disposition: 5 },
    });
    const a2 = await createAdventurer({
      employerId: player.id, status: 'on_adventure', powerRating: 50,
      personality: { loyalty: 3, ambition: 3, temperament: 3, disposition: 5 },
    });
    const [lowId, highId] = [a1.id, a2.id].sort();
    await prisma.adventurerCohesion.create({
      data: { adventurerLowId: lowId, adventurerHighId: highId, cohesion: 95 },
    });

    const contract = await createContract({ requiredPower: 1, status: 'in_progress' }); // guarantees success
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.createMany({
      data: [
        { adventureId: adventure.id, adventurerId: a1.id },
        { adventureId: adventure.id, adventurerId: a2.id },
      ],
    });

    await resolveAdventure(adventure.id);

    const row = await prisma.adventurerCohesion.findUniqueOrThrow({
      where: { adventurerLowId_adventurerHighId: { adventurerLowId: lowId, adventurerHighId: highId } },
    });
    expect(row.cohesion).toBe(100); // 95 + 15 (max disposition pair) would be 110, clamped to 100
  });

  it('raises party power via pre-existing cohesion, changing the outcome', async () => {
    // ratio 0.5 -> base successChance 0.55. Full cohesion (100) -> +50% power -> ratio 0.75
    // -> 0.675. A roll of 0.6 fails at 0.55 but succeeds once the cohesion bonus applies.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.6).mockReturnValue(0.99);

    const player = await createPlayer({ gold: 500 });
    const a1 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50 });
    const a2 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50 });
    const [lowId, highId] = [a1.id, a2.id].sort();
    await prisma.adventurerCohesion.create({
      data: { adventurerLowId: lowId, adventurerHighId: highId, cohesion: 100 },
    });

    const contract = await createContract({ requiredPower: 200, status: 'in_progress' });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.createMany({
      data: [
        { adventureId: adventure.id, adventurerId: a1.id },
        { adventureId: adventure.id, adventurerId: a2.id },
      ],
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('completed');
  });

  it('raises party power via a Training Hall, changing the outcome', async () => {
    // ratio 0.5 -> base successChance 0.55. Training Hall level 3 -> +30% power -> ratio 0.65
    // -> 0.625. A roll of 0.58 fails at 0.55 but succeeds once the training bonus applies.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.58).mockReturnValue(0.99);

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'training_hall', level: 3, maintenanceCostDaily: 20, bonus: { powerRatingBonus: 0.1 } },
    });
    const adventurer = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 100 });
    const contract = await createContract({ requiredPower: 200, status: 'in_progress' });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.create({
      data: { adventureId: adventure.id, adventurerId: adventurer.id },
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('completed');
  });

  it('combines Training Hall and Cohesion bonuses additively, not multiplicatively', async () => {
    // basePower 100, Training Hall level 3 (+30%), full Cohesion (+50%). Additive -> partyPower
    // 180 -> ratio 0.9 -> successChance 0.75. Multiplicative -> partyPower 195 -> ratio 0.975
    // -> successChance 0.7875. A roll of 0.76 fails additive but succeeds multiplicative —
    // this is the regression guard for which model is actually implemented.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.76).mockReturnValue(0.99);

    const player = await createPlayer({ gold: 500 });
    await prisma.property.create({
      data: { playerId: player.id, type: 'training_hall', level: 3, maintenanceCostDaily: 20, bonus: { powerRatingBonus: 0.1 } },
    });
    const a1 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50 });
    const a2 = await createAdventurer({ employerId: player.id, status: 'on_adventure', powerRating: 50 });
    const [lowId, highId] = [a1.id, a2.id].sort();
    await prisma.adventurerCohesion.create({
      data: { adventurerLowId: lowId, adventurerHighId: highId, cohesion: 100 },
    });

    const contract = await createContract({ requiredPower: 200, status: 'in_progress' });
    const adventure = await prisma.adventure.create({
      data: {
        contractId: contract.id, playerId: player.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        completesAt: new Date(Date.now() - 1000),
        status: 'in_progress',
      },
    });
    await prisma.adventureAdventurer.createMany({
      data: [
        { adventureId: adventure.id, adventurerId: a1.id },
        { adventureId: adventure.id, adventurerId: a2.id },
      ],
    });

    await resolveAdventure(adventure.id);

    const updatedAdventure = await prisma.adventure.findUniqueOrThrow({ where: { id: adventure.id } });
    expect(updatedAdventure.status).toBe('failed');
  });

  it('is idempotent — resolving an already-resolved adventure does nothing further', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)  // outcomeRoll — success
      .mockReturnValueOnce(0.5)  // injuryRoll — no injury
      .mockReturnValueOnce(0.99); // reckless-bonus roll — no bonus

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

  it('rejects when an adventurer is still resting from a prior adventure', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({
      employerId: player.id,
      status: 'hired',
      restUntil: new Date(Date.now() + 60 * 60 * 1000), // still an hour of rest left
    });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    await expect(startAdventure(player.id, contract.id, [adventurer.id]))
      .rejects.toThrow(ClaimConflictError);
  });

  it('allows deployment once a rest window has passed', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({
      employerId: player.id,
      status: 'hired',
      restUntil: new Date(Date.now() - 1000), // rest already over
    });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    const adventure = await startAdventure(player.id, contract.id, [adventurer.id]);
    expect(adventure.contractId).toBe(contract.id);
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

  it('rolls an ambition-scaled loyalty penalty when deployed below the adventurer\'s tolerance', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // force the mismatch roll to hit

    const player = await createPlayer();
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'hired', level: 6,
      personality: { loyalty: 3, ambition: 5, temperament: 3, disposition: 3 },
    });
    // Level 6 only tolerates dangerous+ — an errand is well below tolerance.
    const contract = await createContract({ status: 'awarded', awardedTo: player.id, tier: 'errand' });

    await startAdventure(player.id, contract.id, [adventurer.id]);

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.loyaltyPenalty).toBe(1);
  });

  it('does not penalize loyalty when deployed within the adventurer\'s tolerance', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // would force it to hit if the check even ran

    const player = await createPlayer();
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'hired', level: 6,
      personality: { loyalty: 3, ambition: 5, temperament: 3, disposition: 3 },
    });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id, tier: 'legendary' });

    await startAdventure(player.id, contract.id, [adventurer.id]);

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.loyaltyPenalty).toBe(0);
  });

  it('resets daysIdle to 0 on deployment', async () => {
    const player = await createPlayer();
    const adventurer = await createAdventurer({
      employerId: player.id, status: 'hired', daysIdle: 5,
    });
    const contract = await createContract({ status: 'awarded', awardedTo: player.id });

    await startAdventure(player.id, contract.id, [adventurer.id]);

    const updated = await prisma.adventurer.findUniqueOrThrow({ where: { id: adventurer.id } });
    expect(updated.daysIdle).toBe(0);
  });
});
