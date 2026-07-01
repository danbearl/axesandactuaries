-- AlterTable
ALTER TABLE "adventurers" ADD COLUMN     "days_unpaid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyalty_penalty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wages_owed" INTEGER NOT NULL DEFAULT 0;
