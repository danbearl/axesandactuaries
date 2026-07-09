-- CreateEnum
CREATE TYPE "PlayerEventType" AS ENUM ('contract_completed', 'contract_failed', 'adventurer_quit', 'adventurer_recovered', 'adventurer_rest_complete');

-- CreateTable
CREATE TABLE "player_events" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "type" "PlayerEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_events_player_id_created_at_idx" ON "player_events"("player_id", "created_at");

-- CreateIndex
CREATE INDEX "player_events_player_id_type_idx" ON "player_events"("player_id", "type");

-- AddForeignKey
ALTER TABLE "player_events" ADD CONSTRAINT "player_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
