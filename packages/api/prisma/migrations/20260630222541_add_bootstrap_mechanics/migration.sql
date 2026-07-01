-- AlterEnum
ALTER TYPE "TransactionReason" ADD VALUE 'property_sell';

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "last_welfare_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "cost_basis" INTEGER NOT NULL DEFAULT 0;
