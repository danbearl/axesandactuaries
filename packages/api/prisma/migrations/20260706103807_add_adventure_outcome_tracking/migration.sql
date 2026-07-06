-- AlterTable
ALTER TABLE "adventure_adventurers" ADD COLUMN     "died" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "injured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recovery_hours" INTEGER,
ADD COLUMN     "xp_gained" INTEGER NOT NULL DEFAULT 0;
