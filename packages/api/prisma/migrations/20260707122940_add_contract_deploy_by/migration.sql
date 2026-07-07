-- AlterEnum
ALTER TYPE "TransactionReason" ADD VALUE 'contract_abandoned';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "deploy_by" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "contracts_status_deploy_by_idx" ON "contracts"("status", "deploy_by");
