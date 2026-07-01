-- CreateTable
CREATE TABLE "contract_bids" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_bids_contract_id_player_id_key" ON "contract_bids"("contract_id", "player_id");

-- AddForeignKey
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
