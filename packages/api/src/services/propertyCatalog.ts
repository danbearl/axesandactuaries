// Build costs and bonuses per property type — the single source of truth for what a
// property costs and what its `bonus` JSON should contain. Shared between routes/
// properties.ts (build/upgrade) and prisma/syncPropertyBonuses.ts (the one-off migration
// that re-syncs existing rows after a bonus schema changes) so the two can never drift
// apart the way they did before this was extracted: PROPERTY_CONFIG used to live directly
// in routes/properties.ts, and every property-bonus redesign this project went through
// (Training Hall, Infirmary, Armory, Library, Alchemy Lab) updated this catalog but never
// touched already-existing rows, silently leaving pre-redesign properties running on stale
// bonus values — Training Hall's flat-2-to-fraction-0.1 change is the one that actually
// surfaced visibly (a level-3 pre-redesign Training Hall showed +600% instead of +30%,
// since the old flat value got reinterpreted under the new percentage formula), but
// Infirmary/Armory/Library/Alchemy Lab had the same class of bug silently granting the
// wrong (usually zero) bonus instead of a visibly wrong one.
export const PROPERTY_CONFIG = {
  // No `bonus` entry — dormitory's only mechanical effect is roster capacity
  // (computeRosterCap, keyed off the property's level directly), not the generic
  // bonus-JSON path every other property uses. Deliberately kept distinct from
  // Training Hall/Library/etc. to avoid functional overlap with a future XP-focused
  // property.
  dormitory:     { baseCost: 200, maintenanceDaily: 15, bonus: {} },
  // powerRatingBonus is a fraction of the party's total power added per level (0.10 =
  // +10%/level, read directly off the property row by computePartyPower — see
  // services/adventure.ts). No xpMultiplier — dropped as dead weight, same call as
  // Dormitory: one property, one clear job.
  training_hall: { baseCost: 350, maintenanceDaily: 20, bonus: { powerRatingBonus: 0.1 } },
  // The four party-role properties (Armory/fighter, Library/wizard, Alchemy Lab/rogue,
  // Sanctuary/priest) share an identical cost structure — 500 base, 30/day maintenance —
  // normalized on top of an already-identical mechanic (xpBonusPerLevel: 0.10,
  // loyaltyRecoveryBonus: 1 for the matching vocation role; see services/adventure.ts and
  // services/economy.ts). xpBonusPerLevel is deliberately paired with loyaltyRecoveryBonus
  // (+1 extra loyaltyPenalty point recovered per day per level, on top of the base -1/day)
  // so each property stays valuable even for an adventurer who's already hit MAX_LEVEL and
  // can no longer benefit from the XP side.
  alchemy_lab:   { baseCost: 500, maintenanceDaily: 30, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
  library:       { baseCost: 500, maintenanceDaily: 30, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
  // injuryRecoveryRate is a fraction shaved off recovery time per level (0.15 = 15%/level,
  // read directly off the property row by resolveAdventure — see services/adventure.ts).
  infirmary:     { baseCost: 300, maintenanceDaily: 18, bonus: { injuryRecoveryRate: 0.15 } },
  armory:        { baseCost: 500, maintenanceDaily: 30, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
  sanctuary:     { baseCost: 500, maintenanceDaily: 30, bonus: { xpBonusPerLevel: 0.1, loyaltyRecoveryBonus: 1 } },
} as const;

// Upgrade cost to reach each level (key = current level before upgrade)
export const UPGRADE_COSTS: Record<number, number> = { 1: 150, 2: 350, 3: 700 };
