// Dev-only calibration tool — not imported by the app, run on demand via
// `pnpm --filter @axes-actuaries/types simulate-balance`.
//
// The geometric-mean encounter-chain formula (estimateChainedSuccessChance) structurally
// means any real role imbalance scores below what the old flat formula would have given —
// see its design comment in contracts.ts. CONTRACT_TIER_CONFIG.powerRange was calibrated
// against that old flat formula (bottom of a level tier ~50%, top ~90%), so this script
// re-checks that calibration against a "reasonably balanced" (not perfectly balanced) party —
// the kind a real roster naturally looks like — and reports the gap, if any, so powerRange
// (or the [MIN_ROLE_MODIFIER, MAX_ROLE_MODIFIER] range itself) can be re-tuned with real
// numbers instead of guesswork.
import {
  CONTRACT_TIER_CONFIG, generateContract, estimateChainedSuccessChance,
  MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE,
} from '../src/contracts.js';
import type { ContractTier, PartyPowerByRole } from '../src/game.js';

const SAMPLES = 20_000;

// Matches CONTRACT_TIER_CONFIG's own calibration comment in contracts.ts: standard = levels
// 1-4, dangerous = 5-8, legendary = 9-10. Errand isn't tied to a level tier (stays easy at
// every level by design), so it's not included here.
const TIER_LEVEL_RANGE: Record<'standard' | 'dangerous' | 'legendary', [number, number]> = {
  standard:  [1, 4],
  dangerous: [5, 8],
  legendary: [9, 10],
};

// Average adventurer power is ~12.5 * level (stats are 3d6+2, averaging 12.5, independent of
// vocation) — same assumption CONTRACT_TIER_CONFIG's own comment already makes.
const POWER_PER_LEVEL = 12.5;

// A 6-person roster split 2/2/1/1 across fighter/wizard/rogue/priest — "reasonably balanced,"
// not perfectly even (impossible to split 6 across 4 roles exactly), matching how a real
// roster naturally looks rather than an idealized best case.
function reasonablyBalancedParty(level: number): PartyPowerByRole {
  const perMember = POWER_PER_LEVEL * level;
  return {
    fighter: perMember * 2,
    wizard:  perMember * 2,
    rogue:   perMember * 1,
    priest:  perMember * 1,
  };
}

// Worst case for contrast: same total power as reasonablyBalancedParty, but all 6 members
// are one vocation/role — quantifies how much the geometric-mean mechanic actually punishes
// zero diversification, not just whether a balanced party still hits its target.
function singleRoleParty(level: number): PartyPowerByRole {
  const totalPower = POWER_PER_LEVEL * level * 6;
  return { fighter: totalPower, wizard: 0, rogue: 0, priest: 0 };
}

// Averages estimateChainedSuccessChance over many independently-generated encounter chains
// for the tier (encounters are randomized per contract, so a single sample isn't
// representative — this is the expected chance a "reasonably balanced" party gets across the
// whole population of contracts a tier can generate, not any one specific roll).
function averageChance(tier: ContractTier, powerByRole: PartyPowerByRole, requiredPower: number): number {
  let total = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const { encounters } = generateContract(tier);
    total += estimateChainedSuccessChance(powerByRole, requiredPower, encounters, 0);
  }
  return total / SAMPLES;
}

console.log(`Simulating ${SAMPLES.toLocaleString()} encounter chains per edge...\n`);

for (const tier of Object.keys(TIER_LEVEL_RANGE) as Array<keyof typeof TIER_LEVEL_RANGE>) {
  const [minLevel, maxLevel] = TIER_LEVEL_RANGE[tier];
  const { powerRange } = CONTRACT_TIER_CONFIG[tier];

  // Bottom of tier: lowest level in the tier, against the hardest (max) requiredPower the
  // tier can roll — target ~MIN_SUCCESS_CHANCE (0.3 == "50% shot" in the original comment's
  // ratio terms, i.e. a roll right at the middle of the 0.3-0.9 range).
  const bottomChance = averageChance(tier, reasonablyBalancedParty(minLevel), powerRange[1]);
  const bottomChanceSingleRole = averageChance(tier, singleRoleParty(minLevel), powerRange[1]);

  // Top of tier: highest level, against the easiest (min) requiredPower — target the
  // MAX_SUCCESS_CHANCE cap.
  const topChance = averageChance(tier, reasonablyBalancedParty(maxLevel), powerRange[0]);
  const topChanceSingleRole = averageChance(tier, singleRoleParty(maxLevel), powerRange[0]);

  console.log(`${tier} (levels ${minLevel}-${maxLevel}, powerRange [${powerRange[0]}, ${powerRange[1]}])`);
  console.log(`  bottom, balanced (2/2/1/1):  ${(bottomChance * 100).toFixed(1)}% (target ~50%, floor ${(MIN_SUCCESS_CHANCE * 100).toFixed(0)}%)`);
  console.log(`  bottom, single-role (6/0/0/0): ${(bottomChanceSingleRole * 100).toFixed(1)}% — same total power, zero diversification`);
  console.log(`  top, balanced (2/2/1/1):     ${(topChance * 100).toFixed(1)}% (target ~90%, cap ${(MAX_SUCCESS_CHANCE * 100).toFixed(0)}%)`);
  console.log(`  top, single-role (6/0/0/0):    ${(topChanceSingleRole * 100).toFixed(1)}% — same total power, zero diversification`);
  console.log();
}
