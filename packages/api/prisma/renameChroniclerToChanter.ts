import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// One-time data fix: the Chronicler vocation was renamed to Chanter and reworked to
// actually fit the priest party role (see VOCATION_PARTY_ROLE in packages/types/src/game.ts
// for the full reasoning). `vocation` is a plain string column, not a Prisma enum, so this
// is a data migration rather than a schema one — nothing to run via `prisma migrate`.
// Idempotent: safe to run more than once, since a second run simply matches zero rows.

export async function renameChroniclerToChanter(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.adventurer.updateMany({
    where: { vocation: 'Chronicler' },
    data: { vocation: 'Chanter' },
  });
  console.log(`  ✓ Renamed ${count} adventurer(s) from Chronicler to Chanter`);
  return count;
}

// Allow running standalone: `tsx prisma/renameChroniclerToChanter.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  renameChroniclerToChanter(prisma)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
