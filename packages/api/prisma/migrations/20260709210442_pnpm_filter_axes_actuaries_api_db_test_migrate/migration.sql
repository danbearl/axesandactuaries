-- AlterEnum
ALTER TYPE "TransactionReason" ADD VALUE 'gear_upgrade';

-- AlterTable
ALTER TABLE "adventurers" ADD COLUMN     "gear_tier" INTEGER NOT NULL DEFAULT 0;
