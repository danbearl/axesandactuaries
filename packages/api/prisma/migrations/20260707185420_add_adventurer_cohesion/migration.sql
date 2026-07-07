-- CreateTable
CREATE TABLE "adventurer_cohesion" (
    "adventurer_low_id" TEXT NOT NULL,
    "adventurer_high_id" TEXT NOT NULL,
    "cohesion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "adventurer_cohesion_pkey" PRIMARY KEY ("adventurer_low_id","adventurer_high_id")
);

-- CreateIndex
CREATE INDEX "adventurer_cohesion_adventurer_high_id_idx" ON "adventurer_cohesion"("adventurer_high_id");

-- AddForeignKey
ALTER TABLE "adventurer_cohesion" ADD CONSTRAINT "adventurer_cohesion_adventurer_low_id_fkey" FOREIGN KEY ("adventurer_low_id") REFERENCES "adventurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adventurer_cohesion" ADD CONSTRAINT "adventurer_cohesion_adventurer_high_id_fkey" FOREIGN KEY ("adventurer_high_id") REFERENCES "adventurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
