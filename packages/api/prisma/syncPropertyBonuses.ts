import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import type { PropertyType } from '@prisma/client';
import { PROPERTY_CONFIG } from '../src/services/propertyCatalog.js';

// One-time data fix: every property-bonus redesign this project went through (Training
// Hall, Infirmary, Armory, Library, Alchemy Lab) updated PROPERTY_CONFIG going forward but
// never touched already-existing rows, which keep whatever `bonus` JSON they had at build
// time forever — the property-upgrade route only ever touched level/maintenance/costBasis,
// never bonus, until this same incident fixed that too (see propertyCatalog.ts). The
// surfacing incident: a Training Hall built before its flat-2-to-fraction-0.1 redesign
// showed a +600% power bonus at level 3 instead of +30%, since the old flat value got
// reinterpreted under the new percentage formula. This re-syncs every existing property row
// to its type's current catalog bonus, regardless of level (the bonus JSON itself doesn't
// vary by level — only the *effect* does, via the level multiplier applied at read time).
// Idempotent: safe to run more than once, and safe to run again after any future bonus
// schema change too.

export async function syncPropertyBonuses(prisma: PrismaClient): Promise<number> {
  let total = 0;
  for (const [type, config] of Object.entries(PROPERTY_CONFIG)) {
    const { count } = await prisma.property.updateMany({
      where: { type: type as PropertyType },
      data:  { bonus: config.bonus },
    });
    if (count > 0) {
      console.log(`  ✓ Re-synced ${count} ${type} propertie(s) to the current bonus catalog`);
    }
    total += count;
  }
  return total;
}

// Allow running standalone: `tsx prisma/syncPropertyBonuses.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  syncPropertyBonuses(prisma)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
