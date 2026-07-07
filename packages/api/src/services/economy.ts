import { prisma } from '../lib/prisma.js';
import type { Adventurer } from '@prisma/client';
import {
  QUIT_REPUTATION_PENALTY_PER_LEVEL, computeHireCost, computeDailyWage,
  AMBITION_LOYALTY_CHANCE_PER_POINT, IDLE_LOYALTY_GRACE_DAYS,
} from '@axes-actuaries/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyWageResult {
  playerId: string;
  paid:     number; // adventurers paid in full this cycle
  unpaid:   number; // adventurers who did not receive wages
  quit:     number; // adventurers who quit (non-payment, idle neglect, or a mix)
}

// ── Daily Wage Collection & Loyalty ────────────────────────────────────────────
//
// Payment rules:
//   1. Adventurers are paid in full, highest level first.
//   2. Any surplus after current wages is applied to outstanding back wages,
//      also highest level first.
//   3. Adventurers not paid accumulate wages_owed, days_unpaid, and a growing
//      loyalty_penalty (penalty increases by days_unpaid each day, compounding).
//   4. Adventurers who were paid and are fully caught up recover 1 loyalty point.
//
// Loyalty is a single shared pool (loyaltyPenalty) fed by three independent sources, so an
// adventurer can become a flight risk even when perfectly paid:
//   - Unpaid wages (above).
//   - Idle neglect: an ambition-scaled chance per day sitting on the roster (hired, not
//     deployed, not injured/resting) past a short grace period — see IDLE_LOYALTY_GRACE_DAYS.
//   - Contract-tier mismatch: an ambition-scaled chance each time they're deployed below
//     their level's tolerance — see services/adventure.ts's startAdventure.
//
// Every hired adventurer with any accumulated loyaltyPenalty (regardless of source) rolls a
// quit check once a day, using the same (6 - effectiveLoyalty) / 6 formula the wage system
// already used. Adventurers with zero penalty never roll — this is a consequence of
// mistreatment/neglect, not a standing background risk for a well-treated adventurer.
// Adventurers on an active adventure cannot leave mid-contract. Quitting forgives any owed
// wages on the way out.

export async function collectDailyWages(): Promise<DailyWageResult[]> {
  const results: DailyWageResult[] = [];
  const hired = await prisma.adventurer.findMany({
    where: {
      status:     { in: ['hired', 'on_adventure'] },
      employerId: { not: null },
    },
    orderBy: [
      { employerId: 'asc' },
      { level:      'desc' }, // highest level paid first
      { dailyWage:  'desc' }, // tiebreak by wage
    ],
  });

  if (hired.length === 0) return results;

  const byPlayer = new Map<string, Adventurer[]>();
  for (const adv of hired) {
    const pid = adv.employerId!;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push(adv);
  }

  for (const [playerId, adventurers] of byPlayer) {
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) continue;
    const result = await processPlayerWages(player, adventurers);
    results.push({ playerId, ...result });
  }

  return results;
}

async function processPlayerWages(
  player: { id: string; gold: number },
  adventurers: Adventurer[],
): Promise<{ paid: number; unpaid: number; quit: number }> {
  let remainingGold = player.gold;
  let totalDeducted  = 0;
  let quitCount      = 0;

  const paidSet   = new Set<string>();
  const unpaidSet = new Set<string>();

  // ── Step 1: Pay current daily wages, highest level first ──────────────────
  for (const adv of adventurers) {
    if (remainingGold >= adv.dailyWage) {
      remainingGold -= adv.dailyWage;
      totalDeducted += adv.dailyWage;
      paidSet.add(adv.id);
    } else {
      unpaidSet.add(adv.id);
    }
  }

  // ── Step 2: Apply surplus gold to back wages, highest level first ─────────
  const backWageRepayments = new Map<string, number>();
  for (const adv of adventurers) {
    if (paidSet.has(adv.id) && adv.wagesOwed > 0 && remainingGold > 0) {
      const repay = Math.min(remainingGold, adv.wagesOwed);
      backWageRepayments.set(adv.id, repay);
      remainingGold -= repay;
      totalDeducted += repay;
    }
  }

  // ── Step 3: Deduct from player gold ───────────────────────────────────────
  if (totalDeducted > 0) {
    const unpaidCount = unpaidSet.size;
    await prisma.$transaction([
      prisma.player.update({
        where: { id: player.id },
        data:  { gold: { decrement: totalDeducted } },
      }),
      prisma.transaction.create({
        data: {
          playerId:    player.id,
          amount:      -totalDeducted,
          reason:      'wage',
          description: buildWageDescription(paidSet.size, unpaidCount, backWageRepayments.size),
        },
      }),
    ]);
  }

  // ── Step 4: Compute each adventurer's updated wage/idle/loyalty standing ──
  // (before rolling anyone's quit chance, so idle neglect and wage recovery this same
  // cycle both land before the roll uses them).
  interface Pending {
    adv: Adventurer;
    wagesOwed: number;
    daysUnpaid: number;
    daysIdle: number;
    loyaltyPenalty: number;
  }
  const pending: Pending[] = [];

  for (const adv of adventurers) {
    let wagesOwed = adv.wagesOwed;
    let daysUnpaid = adv.daysUnpaid;
    let loyaltyPenalty = adv.loyaltyPenalty;

    if (paidSet.has(adv.id)) {
      const repaid = backWageRepayments.get(adv.id) ?? 0;
      wagesOwed = adv.wagesOwed - repaid;
      const fullySettled = wagesOwed === 0;
      daysUnpaid = fullySettled ? 0 : adv.daysUnpaid;
      // Recover 1 loyalty point per day fully in good standing
      loyaltyPenalty = fullySettled ? Math.max(0, loyaltyPenalty - 1) : loyaltyPenalty;
    } else {
      // Increasing penalty: day 1 adds 1, day 2 adds 2, etc. (triangular growth)
      daysUnpaid = adv.daysUnpaid + 1;
      loyaltyPenalty = loyaltyPenalty + daysUnpaid;
      wagesOwed = adv.wagesOwed + adv.dailyWage;
    }

    // Idle neglect: only for adventurers actually sitting on the roster unused today
    // (hired, not deployed, not resting off a prior mission — resting isn't neglect).
    const isResting = adv.restUntil !== null && adv.restUntil > new Date();
    let daysIdle = adv.daysIdle;
    if (adv.status === 'hired' && !isResting) {
      daysIdle = adv.daysIdle + 1;
      if (daysIdle > IDLE_LOYALTY_GRACE_DAYS) {
        const ambition = (adv.personality as { ambition: number }).ambition;
        if (Math.random() < ambition * AMBITION_LOYALTY_CHANCE_PER_POINT) {
          loyaltyPenalty += 1;
        }
      }
    } else {
      daysIdle = 0; // deployed (or resting) — not idle right now
    }

    pending.push({ adv, wagesOwed, daysUnpaid, daysIdle, loyaltyPenalty });
  }

  // ── Step 5: Unified quit check ────────────────────────────────────────────
  // Only adventurers carrying any accumulated penalty roll at all — this is strictly a
  // consequence of mistreatment/neglect, never a standing risk for a well-treated
  // adventurer with a neutral personality.loyalty score.
  for (const p of pending) {
    const { adv } = p;

    if (p.loyaltyPenalty <= 0) {
      await prisma.adventurer.update({
        where: { id: adv.id },
        data: { wagesOwed: p.wagesOwed, daysUnpaid: p.daysUnpaid, daysIdle: p.daysIdle, loyaltyPenalty: 0 },
      });
      continue;
    }

    const personality      = adv.personality as { loyalty: number };
    const effectiveLoyalty = Math.max(1, personality.loyalty - p.loyaltyPenalty);
    // Leave chance scales with how degraded loyalty is: loyalty 5 → ~17%, loyalty 1 → ~83%
    const leaveChance      = (6 - effectiveLoyalty) / 6;
    // Adventurers on active adventures can't abandon their party mid-contract
    const canLeave         = adv.status !== 'on_adventure';
    const leaves           = canLeave && Math.random() < leaveChance;

    if (leaves) {
      quitCount++;
      const repPenalty = adv.level * QUIT_REPUTATION_PENALTY_PER_LEVEL;
      const debtNote = p.wagesOwed > 0 ? ` — ${p.wagesOwed} gp forgiven` : '';
      await prisma.$transaction([
        prisma.adventurer.update({
          where: { id: adv.id },
          data: {
            status:         'available',
            employerId:     null,
            poolExpiresAt:  new Date(Date.now() + 48 * 60 * 60 * 1000),
            wagesOwed:      0,
            daysUnpaid:     0,
            daysIdle:       0,
            loyaltyPenalty: 0,
            hireCost:       computeHireCost(adv.powerRating),
            dailyWage:      computeDailyWage(adv.powerRating),
          },
        }),
        prisma.player.update({
          where: { id: player.id },
          data:  { reputation: { decrement: repPenalty } },
        }),
        prisma.transaction.create({
          data: {
            playerId:    player.id,
            amount:      0,
            reason:      'debt_forgiven',
            description: `${adv.name} left to seek better opportunities (effective loyalty ${effectiveLoyalty}/5)${debtNote} — -${repPenalty} reputation`,
            referenceId: adv.id,
          },
        }),
      ]);
      console.log(
        `[loyalty] ${adv.name} left (effective loyalty ${effectiveLoyalty}/5${debtNote}, -${repPenalty} rep)`,
      );
    } else {
      await prisma.adventurer.update({
        where: { id: adv.id },
        data: {
          wagesOwed:      p.wagesOwed,
          daysUnpaid:     p.daysUnpaid,
          daysIdle:       p.daysIdle,
          loyaltyPenalty: p.loyaltyPenalty,
        },
      });
    }
  }

  return { paid: paidSet.size, unpaid: unpaidSet.size - quitCount, quit: quitCount };
}

function buildWageDescription(paid: number, unpaid: number, backRepaid: number): string {
  const parts: string[] = [`Daily wages: ${paid} paid`];
  if (backRepaid > 0) parts.push('back wages partially repaid');
  if (unpaid > 0)     parts.push(`${unpaid} could not be paid`);
  return parts.join(', ');
}

// ── Property Maintenance ──────────────────────────────────────────────────────

export async function chargePropertyMaintenance(): Promise<void> {
  const properties = await prisma.property.findMany({
    where: { maintenanceCostDaily: { gt: 0 } },
  });

  const byPlayer = new Map<string, typeof properties>();
  for (const prop of properties) {
    const pid = prop.playerId;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push(prop);
  }

  for (const [playerId, props] of byPlayer) {
    const totalCost = props.reduce((sum, p) => sum + p.maintenanceCostDaily, 0);
    if (totalCost === 0) continue;

    await prisma.$transaction([
      prisma.player.update({
        where: { id: playerId },
        data:  { gold: { decrement: totalCost } },
      }),
      prisma.transaction.create({
        data: {
          playerId,
          amount:      -totalCost,
          reason:      'property_maintenance',
          description: `Daily maintenance for ${props.length} propert${props.length > 1 ? 'ies' : 'y'}`,
        },
      }),
    ]);
  }
}
