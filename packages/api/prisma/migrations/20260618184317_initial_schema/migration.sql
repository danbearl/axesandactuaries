-- CreateEnum
CREATE TYPE "AdventurerStatus" AS ENUM ('available', 'hired', 'on_adventure', 'injured', 'dead');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('available', 'bidding', 'awarded', 'in_progress', 'completed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "ContractTier" AS ENUM ('errand', 'standard', 'dangerous', 'legendary');

-- CreateEnum
CREATE TYPE "AdventureStatus" AS ENUM ('in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('dormitory', 'training_hall', 'alchemy_lab', 'library', 'infirmary', 'armory');

-- CreateEnum
CREATE TYPE "TransactionReason" AS ENUM ('contract_payment', 'wage', 'hire_cost', 'property_build', 'property_maintenance', 'penalty', 'starting_gold');

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "gold" INTEGER NOT NULL DEFAULT 500,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adventurers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "heritage" TEXT NOT NULL,
    "vocation" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "power_rating" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "personality" JSONB NOT NULL,
    "hire_cost" INTEGER NOT NULL,
    "daily_wage" INTEGER NOT NULL,
    "status" "AdventurerStatus" NOT NULL DEFAULT 'available',
    "injury_recovery_until" TIMESTAMP(3),
    "employer_id" TEXT,
    "pool_expires_at" TIMESTAMP(3),
    "height" TEXT NOT NULL,
    "build" TEXT NOT NULL,
    "complexion" TEXT NOT NULL,
    "hair_color" TEXT NOT NULL,
    "eye_color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adventurers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" "ContractTier" NOT NULL,
    "required_power" INTEGER NOT NULL,
    "required_stats" JSONB NOT NULL,
    "reward_gold" INTEGER NOT NULL,
    "reputation_reward" INTEGER NOT NULL,
    "penalty_gold" INTEGER NOT NULL,
    "penalty_reputation" INTEGER NOT NULL,
    "duration_hours" INTEGER NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'available',
    "awarded_to" TEXT,
    "bid_deadline" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adventures" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "completes_at" TIMESTAMP(3) NOT NULL,
    "status" "AdventureStatus" NOT NULL DEFAULT 'in_progress',
    "outcome_roll" DOUBLE PRECISION,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adventures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adventure_adventurers" (
    "adventure_id" TEXT NOT NULL,
    "adventurer_id" TEXT NOT NULL,

    CONSTRAINT "adventure_adventurers_pkey" PRIMARY KEY ("adventure_id","adventurer_id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "maintenance_cost_daily" INTEGER NOT NULL,
    "bonus" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "TransactionReason" NOT NULL,
    "description" TEXT NOT NULL,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_clerk_user_id_key" ON "players"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_username_key" ON "players"("username");

-- CreateIndex
CREATE INDEX "adventurers_status_employer_id_idx" ON "adventurers"("status", "employer_id");

-- CreateIndex
CREATE INDEX "contracts_status_bid_deadline_idx" ON "contracts"("status", "bid_deadline");

-- CreateIndex
CREATE INDEX "adventures_completes_at_status_idx" ON "adventures"("completes_at", "status");

-- AddForeignKey
ALTER TABLE "adventurers" ADD CONSTRAINT "adventurers_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adventures" ADD CONSTRAINT "adventures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adventures" ADD CONSTRAINT "adventures_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adventure_adventurers" ADD CONSTRAINT "adventure_adventurers_adventure_id_fkey" FOREIGN KEY ("adventure_id") REFERENCES "adventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adventure_adventurers" ADD CONSTRAINT "adventure_adventurers_adventurer_id_fkey" FOREIGN KEY ("adventurer_id") REFERENCES "adventurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
